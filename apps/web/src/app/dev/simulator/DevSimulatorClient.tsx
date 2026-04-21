'use client';
// apps/web/src/app/dev/simulator/DevSimulatorClient.tsx

import { useState } from 'react';
import { SetupPanel } from './SetupPanel';
import { BoatSetupModal } from './BoatSetupModal';
import type { SimBoatSetup } from '@/lib/simulator/types';

export function DevSimulatorClient() {
  const [boats, setBoats] = useState<SimBoatSetup[]>([]);
  const [primaryId, setPrimaryId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#0a1f2e', color: '#d9c896' }}>
      {/* Left panel — setup */}
      <div style={{ width: 280, borderRight: '1px solid #1a3a52', display: 'flex', flexDirection: 'column' }}>
        <SetupPanel
          boats={boats}
          primaryId={primaryId}
          locked={false}
          onAddBoat={() => { setEditingId(null); setModalOpen(true); }}
          onEditBoat={(id) => { setEditingId(id); setModalOpen(true); }}
          onDeleteBoat={(id) => {
            setBoats((prev) => {
              const next = prev.filter((b) => b.id !== id);
              // Transfer primary to first remaining boat if needed
              if (primaryId === id && next.length > 0) {
                setPrimaryId(next[0]?.id ?? null);
              } else if (primaryId === id) {
                setPrimaryId(null);
              }
              return next;
            });
          }}
          onSetPrimary={setPrimaryId}
        />
      </div>

      {/* Right area — map + comparison (Tasks 13-14) */}
      <div style={{ flex: 1, padding: 40 }}>
        <h1 style={{ color: '#e8d9a6', fontFamily: 'var(--font-display)', marginTop: 0 }}>
          Dev Simulator
        </h1>
        <p style={{ color: 'rgba(217, 200, 150, 0.5)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
          Map + comparison panel will mount here in Tasks 13–14.
        </p>
      </div>

      {/* Boat setup modal */}
      {modalOpen && (
        <BoatSetupModal
          initial={editingId ? (boats.find((b) => b.id === editingId) ?? null) : null}
          onClose={() => { setModalOpen(false); setEditingId(null); }}
          onSave={(setup) => {
            setBoats((prev) => {
              const others = prev.filter((b) => b.id !== setup.id);
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
