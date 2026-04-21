'use client';
// apps/web/src/app/dev/simulator/DevSimulatorClient.tsx

import { useState } from 'react';
import { SetupPanel } from './SetupPanel';
import { BoatSetupModal } from './BoatSetupModal';
import { SimControlsBar } from './SimControlsBar';
import { useSimulatorWorker } from '@/hooks/useSimulatorWorker';
import type { SimBoatSetup, SimSpeedFactor } from '@/lib/simulator/types';
import type { BoatClass, Polar } from '@nemo/shared-types';
import { fetchLatestWindGrid } from '@/lib/projection/fetchWindGrid';
import type { Position } from '@nemo/shared-types';

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

  const { simTimeMs, fleet, status, post, setStatus, reinit } = useSimulatorWorker();
  const locked = status !== 'idle';

  async function launch() {
    if (boats.length === 0) return;
    const classes = Array.from(new Set(boats.map(b => b.boatClass)));
    const { polars, gameBalanceJson, coastlineGeoJson } = await fetchSimAssets(classes);
    const { windGrid, windData } = await fetchLatestWindGrid();
    post({
      type: 'init',
      boats,
      startPos: START_POS,
      startTimeMs: Date.now(),
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
    post({ type: 'reset' });
    post({ type: 'setSpeed', factor: speed });
    post({ type: 'start' });
    setStatus('running');
  }

  function resetHard() {
    reinit(); // terminates the worker and recreates it
    setBoats([]);
    setPrimaryId(null);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: '#0a1f2e', color: '#d9c896' }}>
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
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

        {/* Right area — map placeholder (TODO(task-13): replace with MapCanvas + comparison panel) */}
        <div style={{ flex: 1, padding: 20, fontSize: 12, fontFamily: 'var(--font-mono, monospace)', overflow: 'auto' }}>
          <div style={{ marginBottom: 8, color: '#8ba8be' }}>sim t = {(simTimeMs / 3600000).toFixed(2)} h</div>
          <div style={{ marginBottom: 8, color: '#8ba8be' }}>status: {status}</div>
          <pre style={{ color: 'rgba(217,200,150,0.6)', fontSize: 11, lineHeight: 1.5, margin: 0 }}>
            {JSON.stringify(fleet, null, 2)}
          </pre>
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
