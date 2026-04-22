'use client';
// apps/web/src/app/dev/simulator/DevSimulatorClient.tsx

import { useState, useEffect, useRef, useMemo } from 'react';
import { GameBalance } from '@nemo/game-balance/browser';
import { SetupPanel } from './SetupPanel';
import { BoatSetupModal } from './BoatSetupModal';
import { SimControlsBar } from './SimControlsBar';
import { FleetLayer } from './FleetLayer';
// Projection layer removed — the frozen projection dashed line added
// visual noise without providing actionable signal once the routing
// engine became the canonical "planned path" reference.
import { StartPointLayer } from './StartPointLayer';
import { EndPointLayer } from './EndPointLayer';
import { RouteLayer } from './RouteLayer';
import { IsochroneLayer } from './IsochroneLayer';
import { RoutingControls } from './RoutingControls';
import { PRESETS, buildPresetBoat } from './presets';
import WindOverlay from '@/components/play/WindOverlay';
import SwellOverlay from '@/components/play/SwellOverlay';
import { ComparisonPanel } from './ComparisonPanel';
import { SimTimeReadout } from './SimTimeReadout';
import MapCanvas from '@/components/play/MapCanvas';
import { useSimulatorWorker } from '@/hooks/useSimulatorWorker';
import { useWeatherPrefetch } from '@/hooks/useWeatherPrefetch';
import type { SimBoatSetup, SimSpeedFactor, SimOrder } from '@/lib/simulator/types';
import type { BoatClass, Polar, SailId } from '@nemo/shared-types';
import type { OrderHistoryEntry } from './OrderHistory';
import { fetchLatestWindGrid } from '@/lib/projection/fetchWindGrid';
import { freezeProjection, projectionAt } from '@/lib/simulator/projectionFreeze';
import type { ProjectionResult } from '@/lib/projection/types';
import type { WindGridConfig } from '@/lib/projection/windLookup';
import type { Position } from '@nemo/shared-types';
import type { Preset, RoutePlan, RouteInput } from '@nemo/routing';
import styles from './DevSimulator.module.css';

/** Approximate haversine distance in nautical miles between two positions. */
function haversineNM(a: Position, b: Position): number {
  const R = 3440.065; // Earth radius in NM
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLon = (b.lon - a.lon) * toRad;
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h = sinLat * sinLat + Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * sinLon * sinLon;
  return R * 2 * Math.asin(Math.sqrt(h));
}

const DEFAULT_START_POS: Position = { lat: 47.0, lon: -3.0 };

const POLAR_FILE: Record<BoatClass, string> = {
  CRUISER_RACER: 'cruiser-racer.json',
  MINI650: 'mini650.json',
  FIGARO: 'figaro.json',
  CLASS40: 'class40.json',
  OCEAN_FIFTY: 'ocean-fifty.json',
  IMOCA60: 'imoca60.json',
  ULTIM: 'ultim.json',
};

async function fetchSimAssets(classes: BoatClass[]): Promise<{
  polars: Record<BoatClass, Polar>;
  gameBalanceJson: unknown;
  coastlineGeoJson: unknown;
}> {
  const [gameBalanceJson, coastlineGeoJson, ...polarResults] = await Promise.all([
    fetch('/data/game-balance.json').then(r => r.json()),
    fetch('/data/coastline.geojson').then(r => r.json()),
    ...classes.map(c => fetch(`/data/polars/${POLAR_FILE[c]}`).then(r => r.json())),
  ]);
  const polars: Record<string, Polar> = {};
  classes.forEach((c, i) => { polars[c] = polarResults[i] as Polar; });
  return {
    polars: polars as Record<BoatClass, Polar>,
    gameBalanceJson,
    coastlineGeoJson,
  };
}

export function DevSimulatorClient() {
  // Populate the wind grid + decoded grid in the store so MapCanvas overlays
  // can render + animate on simTimeMs like they do on /play.
  useWeatherPrefetch({ phase2: true });

  const [gameBalanceReady, setGameBalanceReady] = useState(GameBalance.isLoaded);
  useEffect(() => {
    if (GameBalance.isLoaded) return;
    fetch('/data/game-balance.json')
      .then((r) => r.json())
      .then((json) => { GameBalance.load(json); setGameBalanceReady(true); })
      .catch((err) => console.error('[dev-simulator] game-balance load failed', err));
  }, []);

  const [boats, setBoats] = useState<SimBoatSetup[]>([]);
  const [startPos, setStartPos] = useState<Position>(DEFAULT_START_POS);
  const [primaryId, setPrimaryId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [speed, setSpeed] = useState<SimSpeedFactor>(1800);
  const [trails, setTrails] = useState<Map<string, Position[]>>(new Map());
  const [launchTimeMs, setLaunchTimeMs] = useState<number | undefined>(undefined);
  const [projection, setProjection] = useState<ProjectionResult | null>(null);
  const [projectionDeviationNm, setProjectionDeviationNm] = useState<number | null>(null);
  const [orderHistory, setOrderHistory] = useState<OrderHistoryEntry[]>([]);
  const [endPos, setEndPos] = useState<Position | null>(null);
  const [routes, setRoutes] = useState<Map<string, RoutePlan>>(new Map());
  const [preset, setPreset] = useState<Preset>('BALANCED');
  const [routing, setRouting] = useState<{ status: 'idle' | 'computing' | 'done'; error?: string }>({ status: 'idle' });
  const [isoVisibleBoatId, setIsoVisibleBoatId] = useState<string | null>(null);
  // Keep a ref to the wind grid so the projection freeze can use it without
  // neutering the buffer that the sim worker already owns.
  const windGridRef = useRef<{ windGrid: WindGridConfig; windData: Float32Array } | null>(null);

  const { simTimeMs, fleet, status, post, setStatus, reinit } = useSimulatorWorker();
  const locked = status !== 'idle';

  // Derive available sails from the primary boat's polar keys if present.
  // The polar's `speeds` map has one entry per SailId — use those keys if possible,
  // otherwise fall back to the canonical list from shared-types.
  const availableSails = useMemo<SailId[]>(() => {
    const primary = boats.find(b => b.id === primaryId) ?? boats[0];
    if (!primary) return [];
    // Conservative fallback — the full canonical SailId list from shared-types.
    return ['JIB', 'LJ', 'SS', 'C0', 'SPI', 'HG', 'LG'] as SailId[];
  }, [boats, primaryId]);

  // Accumulate trail positions as fleet updates arrive.
  // Also compute the Δ projection deviation for the primary boat.
  useEffect(() => {
    if (Object.keys(fleet).length === 0) return;
    setTrails(prev => {
      const next = new Map(prev);
      for (const [id, state] of Object.entries(fleet)) {
        const prevTrail = next.get(id) ?? [];
        const last = prevTrail[prevTrail.length - 1];
        if (!last || haversineNM(last, state.position) > 0.005) {
          next.set(id, [...prevTrail, state.position]);
        }
      }
      return next;
    });
    // Δ projection: compare real position against the frozen projection polyline.
    if (projection !== null && primaryId && fleet[primaryId] && launchTimeMs !== undefined) {
      const absMs = launchTimeMs + simTimeMs;
      const projPos = projectionAt(projection, absMs);
      const realPos = fleet[primaryId]!.position;
      const deviation = haversineNM(realPos, projPos);
      setProjectionDeviationNm(deviation);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fleet]);

  async function launch() {
    if (boats.length === 0) return;
    const classes = Array.from(new Set(boats.map(b => b.boatClass)));
    const { polars, gameBalanceJson, coastlineGeoJson } = await fetchSimAssets(classes);
    const { windGrid, windData } = await fetchLatestWindGrid();
    const now = Date.now();

    // Keep a copy of the wind data so we can pass it to the freeze worker
    // independently of what the sim worker will transfer/neuter.
    windGridRef.current = { windGrid, windData: windData.slice() };

    // Freeze the projection for the primary boat before launching the sim.
    // If there is no primary boat, skip (no Δ to show).
    const primaryBoat = boats.find(b => b.id === primaryId) ?? boats[0];
    if (primaryBoat) {
      const primaryPolar = polars[primaryBoat.boatClass];
      if (primaryPolar) {
        freezeProjection({
          boat: primaryBoat,
          startPos,
          startTimeMs: now,
          windGrid,
          windData: windGridRef.current.windData,
          polar: primaryPolar,
        })
          .then(result => {
            console.log('[DevSim] projection frozen:', result.points.length, 'pts');
            setProjection(result);
          })
          .catch(err => {
            console.warn('[DevSim] projection freeze failed:', err);
          });
      }
    }

    setLaunchTimeMs(now);
    setTrails(new Map());
    post({
      type: 'init',
      boats,
      startPos,
      startTimeMs: now,
      windGrid,
      windData,
      coastlineGeoJson,
      polars,
      gameBalanceJson,
    });
    post({ type: 'setSpeed', factor: speed });
    for (const [id, plan] of routes) {
      post({ type: 'schedule', boatId: id, entries: plan.capSchedule });
    }
    post({ type: 'start' });
    setStatus('running');
  }

  function pause() { post({ type: 'pause' }); setStatus('paused'); }
  function resume() { post({ type: 'start' }); setStatus('running'); }

  function setSimSpeed(s: SimSpeedFactor) {
    setSpeed(s);
    post({ type: 'setSpeed', factor: s });
  }

  const onSubmitOrder = (order: SimOrder) => {
    post({ type: 'order', order, triggerSimMs: simTimeMs });
    setOrderHistory(prev => [...prev, { simTimeMs, order }]);
  };

  function resetSoft() {
    setTrails(new Map());
    setProjection(null);
    setProjectionDeviationNm(null);
    setOrderHistory([]);
    post({ type: 'reset' });
    post({ type: 'setSpeed', factor: speed });
    post({ type: 'start' });
    setStatus('running');
  }

  function resetHard() {
    reinit(); // terminates the worker and recreates it
    setBoats([]);
    setPrimaryId(null);
    setTrails(new Map());
    setLaunchTimeMs(undefined);
    setProjection(null);
    setProjectionDeviationNm(null);
    setOrderHistory([]);
    windGridRef.current = null;
  }

  const ROUTE_PALETTE = ['#c9a557', '#6ba3c9', '#a57cc9', '#7cc9a5', '#c98c6b'];
  function colorFor(boatId: string): string {
    if (boatId === primaryId) return ROUTE_PALETTE[0]!;
    const others = boats.filter((b) => b.id !== primaryId);
    const idx = others.findIndex((b) => b.id === boatId);
    return ROUTE_PALETTE[(idx + 1) % ROUTE_PALETTE.length]!;
  }

  function routeOne(payload: { input: RouteInput; gameBalanceJson: unknown }): Promise<RoutePlan> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('../../../workers/routing.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e) => {
        const msg = e.data as { type: 'result'; plan: RoutePlan } | { type: 'error'; message: string };
        if (msg.type === 'result') { resolve(msg.plan); worker.terminate(); }
        else { reject(new Error(msg.message)); worker.terminate(); }
      };
      worker.onerror = (err) => { reject(err); worker.terminate(); };
      worker.postMessage({ type: 'compute', input: payload.input, gameBalanceJson: payload.gameBalanceJson });
    });
  }

  async function routeAllBoats() {
    if (!endPos || boats.length === 0 || !gameBalanceReady) return;
    setRouting({ status: 'computing' });
    setRoutes(new Map());

    try {
      const classes = Array.from(new Set(boats.map((b) => b.boatClass)));
      const { polars, gameBalanceJson, coastlineGeoJson } = await fetchSimAssets(classes);
      const { windGrid, windData } = await fetchLatestWindGrid();

      const startTimeMs = Date.now();
      // Skip coastline: cloning 10 MB of GeoJSON into each routing worker
      // was the main cause of the first-version hang. Routes may cross land —
      // acceptable for the dev simulator for now, reintroduce when the
      // coastline is cached or compressed.
      void coastlineGeoJson;
      const plans = await Promise.all(boats.map((boat) => routeOne({
        input: {
          from: startPos,
          to: endPos,
          startTimeMs,
          polar: polars[boat.boatClass]!,
          loadout: boat.loadout,
          condition: boat.initialCondition,
          windGrid,
          windData: new Float32Array(windData),  // per-worker copy
          preset,
        },
        gameBalanceJson,
      }).then((plan) => [boat.id, plan] as const)));

      setRoutes(new Map(plans));
      setIsoVisibleBoatId(primaryId ?? boats[0]?.id ?? null);
      setRouting({ status: 'done' });
    } catch (err) {
      console.error('[dev-simulator] routing failed', err);
      setRouting({ status: 'idle', error: err instanceof Error ? err.message : String(err) });
    }
  }

  async function rerouteFromCurrent() {
    if (!endPos || boats.length === 0 || Object.keys(fleet).length === 0) return;
    setRouting({ status: 'computing' });

    try {
      const classes = Array.from(new Set(boats.map((b) => b.boatClass)));
      const { polars, gameBalanceJson, coastlineGeoJson } = await fetchSimAssets(classes);
      const { windGrid, windData } = await fetchLatestWindGrid();
      const simAbsMs = (launchTimeMs ?? Date.now()) + simTimeMs;
      void coastlineGeoJson;  // skipped — see routeAllBoats for rationale

      const plans = await Promise.all(boats.map((boat) => {
        const live = fleet[boat.id];
        const from = live ? live.position : startPos;
        const condition = live ? live.condition : boat.initialCondition;
        return routeOne({
          input: {
            from, to: endPos!, startTimeMs: simAbsMs,
            polar: polars[boat.boatClass]!, loadout: boat.loadout, condition,
            windGrid, windData: new Float32Array(windData),
            preset,
          },
          gameBalanceJson,
        }).then((plan) => [boat.id, plan] as const);
      }));

      const updated = new Map(plans);
      setRoutes(updated);
      for (const [id, plan] of updated) {
        post({ type: 'schedule', boatId: id, entries: plan.capSchedule });
      }
      setRouting({ status: 'done' });
    } catch (err) {
      console.error('[dev-simulator] reroute failed', err);
      setRouting({ status: 'idle', error: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <div className={styles.grid}>
      {/* Left panel — setup */}
      <div className={styles.setup}>
        <SetupPanel
          boats={boats}
          primaryId={primaryId}
          locked={locked}
          onAddBoat={() => { if (!gameBalanceReady) return; setEditingId(null); setModalOpen(true); }}
          onAddPreset={(presetId) => {
            if (!gameBalanceReady) return;
            const boatPreset = PRESETS.find((p) => p.id === presetId);
            if (!boatPreset) return;
            const boatId = `boat-${Date.now().toString(36)}`;
            const setup = buildPresetBoat(boatPreset, boatId);
            setBoats((prev) => [...prev, setup].slice(0, 4));
            if (!primaryId) setPrimaryId(setup.id);
          }}
          onEditBoat={(id) => { setEditingId(id); setModalOpen(true); }}
          onDeleteBoat={(id) => {
            setBoats(prev => prev.filter(b => b.id !== id));
            if (primaryId === id) setPrimaryId(null);
          }}
          onSetPrimary={setPrimaryId}
          orderHistory={orderHistory}
          availableSails={availableSails}
          onSubmitOrder={onSubmitOrder}
          simStatus={status}
        />
      </div>

      {/* Centre — map + fleet overlay + projection line + overlays */}
      <div className={styles.map}>
        <MapCanvas
          enableProjection={false}
          {...((status === 'running' || status === 'paused') && launchTimeMs !== undefined
            ? { simTimeMs: launchTimeMs + simTimeMs }
            : {})}
        />
        <WindOverlay />
        <SwellOverlay />
        <StartPointLayer startPos={startPos} status={status} onChange={setStartPos} />
        <FleetLayer
          fleet={fleet}
          primaryId={primaryId}
          boatIds={boats.map(b => b.id)}
          trails={trails}
          simStatus={status}
        />
        <EndPointLayer endPos={endPos} status={status} onChange={setEndPos} />
        <RouteLayer routes={routes} primaryId={primaryId} colorFor={colorFor} />
        <IsochroneLayer
          plan={isoVisibleBoatId ? (routes.get(isoVisibleBoatId) ?? null) : null}
          color={isoVisibleBoatId ? colorFor(isoVisibleBoatId) : '#c9a557'}
        />

        {/* Re-router button — top-left, visible only while paused */}
        {status === 'paused' && endPos && (
          <button
            onClick={rerouteFromCurrent}
            disabled={routing.status === 'computing'}
            style={{
              position: 'absolute', top: 16, left: 16, zIndex: 6,
              background: '#0f2a3d', border: '1px solid #c9a557', color: '#c9a557',
              padding: '6px 12px', borderRadius: 4, fontFamily: 'var(--font-mono)',
              fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
              cursor: 'pointer',
            }}
          >⟲ Re-router depuis ici</button>
        )}

        {/* Compass overlay — top-right, shows primary boat nav data */}
        {locked && primaryId && fleet[primaryId] && (
          <div className={styles.compassOverlay}>
            <div style={{ opacity: 0.7, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>Principal</div>
            <div className={styles.hdg}>HDG {Math.round(fleet[primaryId].heading)}° · TWA {Math.round(fleet[primaryId].twa)}°</div>
            <div>BSP {fleet[primaryId].bsp.toFixed(1)} kts</div>
          </div>
        )}

        {/* Sim time readout — bottom-left */}
        <SimTimeReadout
          simTimeMs={simTimeMs}
          launchTimeMs={launchTimeMs ?? null}
          locked={locked}
        />
      </div>

      {/* Right panel — comparison metrics */}
      <div className={styles.comparison}>
        <ComparisonPanel
          boats={boats}
          fleet={fleet}
          primaryId={primaryId}
          projectionDeviationNm={projectionDeviationNm}
        />
      </div>

      {/* Controls bar — pinned to bottom of layout */}
      <div className={styles.controls}>
        <RoutingControls
          preset={preset}
          onSetPreset={setPreset}
          canRoute={status === 'idle' && endPos !== null && boats.length > 0 && gameBalanceReady}
          isComputing={routing.status === 'computing'}
          onRoute={routeAllBoats}
          boatIds={boats.map((b) => b.id)}
          isoVisibleBoatId={isoVisibleBoatId}
          onSetIsoBoat={setIsoVisibleBoatId}
          primaryColorFor={colorFor}
        />
        <SimControlsBar
          status={status}
          speed={speed}
          canLaunch={boats.length > 0}
          onLaunch={launch}
          onPause={pause}
          onResume={resume}
          onSetSpeed={setSimSpeed}
          onResetSoft={resetSoft}
          onResetHard={resetHard}
        />
      </div>

      {/* Boat setup modal */}
      {modalOpen && (
        <BoatSetupModal
          initial={editingId ? (boats.find(b => b.id === editingId) ?? null) : null}
          onClose={() => { setModalOpen(false); setEditingId(null); }}
          onSave={(setup) => {
            setBoats(prev => {
              const others = prev.filter(b => b.id !== setup.id);
              return [...others, setup].slice(0, 4);
            });
            if (!primaryId) setPrimaryId(setup.id);
            setModalOpen(false);
            setEditingId(null);
          }}
        />
      )}
    </div>
  );
}
