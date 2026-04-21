'use client';
// apps/web/src/app/dev/simulator/DevSimulatorClient.tsx

import { useState, useEffect } from 'react';
import { SetupPanel } from './SetupPanel';
import { BoatSetupModal } from './BoatSetupModal';
import { SimControlsBar } from './SimControlsBar';
import { FleetLayer } from './FleetLayer';
import MapCanvas from '@/components/play/MapCanvas';
import { useSimulatorWorker } from '@/hooks/useSimulatorWorker';
import type { SimBoatSetup, SimSpeedFactor } from '@/lib/simulator/types';
import type { BoatClass, Polar } from '@nemo/shared-types';
import { fetchLatestWindGrid } from '@/lib/projection/fetchWindGrid';
import type { Position } from '@nemo/shared-types';

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

const START_POS: Position = { lat: 47.0, lon: -3.0 };

const POLAR_FILE: Record<BoatClass, string> = {
  CRUISER_RACER: 'cruiser-racer.json',
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
  const [boats, setBoats] = useState<SimBoatSetup[]>([]);
  const [primaryId, setPrimaryId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [speed, setSpeed] = useState<SimSpeedFactor>(1800);
  const [trails, setTrails] = useState<Map<string, Position[]>>(new Map());
  const [launchTimeMs, setLaunchTimeMs] = useState<number | undefined>(undefined);

  const { simTimeMs, fleet, status, post, setStatus, reinit } = useSimulatorWorker();
  const locked = status !== 'idle';

  // Accumulate trail positions as fleet updates arrive
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
  }, [fleet]);

  async function launch() {
    if (boats.length === 0) return;
    const classes = Array.from(new Set(boats.map(b => b.boatClass)));
    const { polars, gameBalanceJson, coastlineGeoJson } = await fetchSimAssets(classes);
    const { windGrid, windData } = await fetchLatestWindGrid();
    const now = Date.now();
    setLaunchTimeMs(now);
    setTrails(new Map());
    post({
      type: 'init',
      boats,
      startPos: START_POS,
      startTimeMs: now,
      windGrid,
      windData,
      coastlineGeoJson,
      polars,
      gameBalanceJson,
    });
    post({ type: 'setSpeed', factor: speed });
    post({ type: 'start' });
    setStatus('running');
  }

  function pause() { post({ type: 'pause' }); setStatus('paused'); }
  function resume() { post({ type: 'start' }); setStatus('running'); }

  function setSimSpeed(s: SimSpeedFactor) {
    setSpeed(s);
    post({ type: 'setSpeed', factor: s });
  }

  function resetSoft() {
    setTrails(new Map());
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
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0a1f2e', color: '#d9c896' }}>
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
        {/* Left panel — setup */}
        <div style={{ width: 280, borderRight: '1px solid #1a3a52', flexShrink: 0 }}>
          <SetupPanel
            boats={boats}
            primaryId={primaryId}
            locked={locked}
            onAddBoat={() => { setEditingId(null); setModalOpen(true); }}
            onEditBoat={(id) => { setEditingId(id); setModalOpen(true); }}
            onDeleteBoat={(id) => {
              setBoats(prev => prev.filter(b => b.id !== id));
              if (primaryId === id) setPrimaryId(null);
            }}
            onSetPrimary={setPrimaryId}
          />
        </div>

        {/* Right area — map + fleet overlay */}
        <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
          <MapCanvas
            enableProjection={false}
            {...((status === 'running' || status === 'paused') && launchTimeMs !== undefined
              ? { simTimeMs: launchTimeMs + simTimeMs }
              : {})}
          />
          <FleetLayer
            fleet={fleet}
            primaryId={primaryId}
            boatIds={boats.map(b => b.id)}
            trails={trails}
            simStatus={status}
          />
        </div>
      </div>

      {/* Controls bar — pinned to bottom of layout */}
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
