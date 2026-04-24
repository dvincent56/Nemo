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
import { boatColor } from './colors';
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
import { fetchLatestWindGrid, packWindData } from '@/lib/projection/fetchWindGrid';
import { useGameStore } from '@/lib/store';
import { freezeProjection, projectionAt } from '@/lib/simulator/projectionFreeze';
import type { ProjectionResult } from '@/lib/projection/types';
import type { WindGridConfig } from '@/lib/projection/windLookup';
import type { Position } from '@nemo/shared-types';
import type { Preset, RoutePlan, RouteInput } from '@nemo/routing';
import styles from './DevSimulator.module.css';

import { haversinePosNM as haversineNM } from '@/lib/geo';

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

// For routing we only need polars + game balance. Coastline is fetched by the
// routing worker itself (once per worker lifetime) so the main thread doesn't
// waste bandwidth + JSON parsing re-fetching it here.
async function fetchRoutingAssets(classes: BoatClass[]): Promise<{
  polars: Record<BoatClass, Polar>;
  gameBalanceJson: unknown;
}> {
  const [gameBalanceJson, ...polarResults] = await Promise.all([
    fetch('/data/game-balance.json').then(r => r.json()),
    ...classes.map(c => fetch(`/data/polars/${POLAR_FILE[c]}`).then(r => r.json())),
  ]);
  const polars: Record<string, Polar> = {};
  classes.forEach((c, i) => { polars[c] = polarResults[i] as Polar; });
  return { polars: polars as Record<BoatClass, Polar>, gameBalanceJson };
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
  // Fast-by-default: the in-game panel mirrors this — expert mode flips
  // these on for tighter but slower results.
  const [preset, setPreset] = useState<Preset>('FAST');
  const [coastDetection, setCoastDetection] = useState(false);
  const [coneHalfDeg, setConeHalfDeg] = useState(60);
  const [routing, setRouting] = useState<{ status: 'idle' | 'computing' | 'done'; error?: string }>({ status: 'idle' });
  const [isoVisibleBoatId, setIsoVisibleBoatId] = useState<string | null>(null);
  // Keep a ref to the wind grid so the projection freeze can use it without
  // neutering the buffer that the sim worker already owns.
  const windGridRef = useRef<{ windGrid: WindGridConfig; windData: Float32Array } | null>(null);

  // Persistent routing worker — loads the coastline once at module scope and
  // reuses the built index for every `compute` call. Dramatically faster than
  // the previous "spawn + terminate per route" approach, and re-enables
  // coastline avoidance (routes no longer cross land).
  const routingWorkerRef = useRef<Worker | null>(null);
  const routingNextReqIdRef = useRef(0);
  const routingPendingRef = useRef<Map<number, { resolve: (plan: RoutePlan) => void; reject: (err: Error) => void }>>(new Map());

  function getRoutingWorker(): Worker {
    if (!routingWorkerRef.current) {
      const worker = new Worker(new URL('../../../workers/routing.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e) => {
        const msg = e.data as
          | { type: 'result'; requestId: number; plan: RoutePlan }
          | { type: 'error'; requestId: number; message: string };
        const pending = routingPendingRef.current.get(msg.requestId);
        if (!pending) return;
        routingPendingRef.current.delete(msg.requestId);
        if (msg.type === 'result') pending.resolve(msg.plan);
        else pending.reject(new Error(msg.message));
      };
      worker.onerror = (err) => {
        // A worker-level error fails every in-flight request rather than
        // leaving them hung (we can't tell which request faulted).
        for (const { reject } of routingPendingRef.current.values()) {
          reject(err instanceof ErrorEvent ? new Error(err.message) : new Error('routing worker error'));
        }
        routingPendingRef.current.clear();
      };
      routingWorkerRef.current = worker;
    }
    return routingWorkerRef.current;
  }

  useEffect(() => {
    return () => {
      routingWorkerRef.current?.terminate();
      routingWorkerRef.current = null;
      routingPendingRef.current.clear();
    };
  }, []);

  const { simTimeMs, fleet, status, post, setStatus, reinit } = useSimulatorWorker();
  const locked = status !== 'idle';

  // Subscribe to the decoded GFS grid pair (current + prev). When the store
  // rotates a new run in, push an `updateWindGrid` to the sim worker so the
  // in-flight simulation doesn't exhaust the old grid. Also feeds the router
  // call sites so recomputed routes use the freshest data with a fallback.
  const decodedGrid = useGameStore((s) => s.weather.decodedGrid);
  const prevDecodedGrid = useGameStore((s) => s.weather.prevDecodedGrid);

  // The moment the next GFS run is expected. Everything on the routed line
  // up to this point is computed from data that is *guaranteed* to still
  // be authoritative; beyond it, a new run will arrive and may reshape the
  // forecast. Displayed via the dashed-line style split in RouteLayer.
  // Falls back to the nearest upcoming 6 h boundary when no grid is loaded.
  const nextGfsRunMs = useMemo(() => {
    if (decodedGrid?.header.nextRunExpectedUtc) {
      return decodedGrid.header.nextRunExpectedUtc * 1000;
    }
    const sixH = 6 * 3_600_000;
    return Math.ceil(Date.now() / sixH) * sixH;
  }, [decodedGrid]);
  useEffect(() => {
    if (!decodedGrid) return;
    if (status === 'idle') return; // nothing to update until a sim is running
    const current = packWindData(decodedGrid);
    const prev = prevDecodedGrid ? packWindData(prevDecodedGrid) : null;
    post({
      type: 'updateWindGrid',
      windGrid: current.windGrid,
      windData: current.windData,
      ...(prev ? { prevWindGrid: prev.windGrid, prevWindData: prev.windData } : {}),
    });
    console.log('[dev-sim] pushed updateWindGrid to sim worker', {
      currentTimestamps: current.windGrid.timestamps.length,
      prevTimestamps: prev?.windGrid.timestamps.length ?? 0,
    });
  }, [decodedGrid, prevDecodedGrid, status, post]);

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
            console.log('[DevSim] projection frozen:', result.pointsCount, 'pts');
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
    // If a previous GFS run is already in the store at launch time, push it
    // immediately so the sim has a fallback from tick 1 instead of waiting
    // for the next store rotation.
    if (prevDecodedGrid) {
      const prevPack = packWindData(prevDecodedGrid);
      post({
        type: 'updateWindGrid',
        windGrid,
        windData,
        prevWindGrid: prevPack.windGrid,
        prevWindData: prevPack.windData,
      });
    }
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

  const colorFor = (boatId: string): string =>
    boatColor(boatId, primaryId, boats.map((b) => b.id));

  function routeOne(payload: { input: RouteInput; gameBalanceJson: unknown }): Promise<RoutePlan> {
    return new Promise((resolve, reject) => {
      const worker = getRoutingWorker();
      const requestId = ++routingNextReqIdRef.current;
      routingPendingRef.current.set(requestId, { resolve, reject });
      worker.postMessage({
        type: 'compute',
        requestId,
        input: payload.input,
        gameBalanceJson: payload.gameBalanceJson,
      });
    });
  }

  async function routeAllBoats() {
    if (!endPos || boats.length === 0 || !gameBalanceReady) return;
    setRouting({ status: 'computing' });
    setRoutes(new Map());

    try {
      const classes = Array.from(new Set(boats.map((b) => b.boatClass)));
      const { polars, gameBalanceJson } = await fetchRoutingAssets(classes);
      const { windGrid, windData } = await fetchLatestWindGrid();
      const prevPack = prevDecodedGrid ? packWindData(prevDecodedGrid) : null;

      const startTimeMs = Date.now();
      const plans = await Promise.all(boats.map((boat) => routeOne({
        input: {
          from: startPos,
          to: endPos,
          startTimeMs,
          boatClass: boat.boatClass,
          polar: polars[boat.boatClass]!,
          loadout: boat.loadout,
          condition: boat.initialCondition,
          windGrid,
          windData: new Float32Array(windData),  // per-worker copy
          preset,
          coastDetection,
          coneHalfDeg,
          ...(prevPack
            ? { prevWindGrid: prevPack.windGrid, prevWindData: new Float32Array(prevPack.windData) }
            : {}),
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
      const { polars, gameBalanceJson } = await fetchRoutingAssets(classes);
      const { windGrid, windData } = await fetchLatestWindGrid();
      const prevPack = prevDecodedGrid ? packWindData(prevDecodedGrid) : null;
      const simAbsMs = (launchTimeMs ?? Date.now()) + simTimeMs;

      const plans = await Promise.all(boats.map((boat) => {
        const live = fleet[boat.id];
        const from = live ? live.position : startPos;
        const condition = live ? live.condition : boat.initialCondition;
        return routeOne({
          input: {
            from, to: endPos!, startTimeMs: simAbsMs,
            boatClass: boat.boatClass,
            polar: polars[boat.boatClass]!, loadout: boat.loadout, condition,
            windGrid, windData: new Float32Array(windData),
            preset,
            coastDetection,
            coneHalfDeg,
            ...(prevPack
              ? { prevWindGrid: prevPack.windGrid, prevWindData: new Float32Array(prevPack.windData) }
              : {}),
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
        <RouteLayer routes={routes} primaryId={primaryId} colorFor={colorFor} nextGfsRunMs={nextGfsRunMs} />
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
          coastDetection={coastDetection}
          onSetCoastDetection={setCoastDetection}
          coneHalfDeg={coneHalfDeg}
          onSetConeHalfDeg={setConeHalfDeg}
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
