'use client';
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { useGameStore, commitDraft } from '@/lib/store';
import type { ProgMode, ProgDraft } from '@/lib/prog/types';
import { defaultCapAnchor, floorForNow, isObsoleteAtTime } from '@/lib/prog/anchors';
import ProgQueueView from './prog/ProgQueueView';
import ProgFooter from './prog/ProgFooter';
import CapEditor from './prog/CapEditor';

type EditingState =
  | null
  | { kind: 'cap'; id: string }
  | { kind: 'sail'; id: string }
  | { kind: 'wp'; id: string }
  | { kind: 'finalCap' };

function deepEqDraft(a: ProgDraft, b: ProgDraft): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export default function ProgPanel(): ReactElement {
  const draft = useGameStore((s) => s.prog.draft);
  const committed = useGameStore((s) => s.prog.committed);
  const resetDraft = useGameStore((s) => s.resetDraft);
  const markCommitted = useGameStore((s) => s.markCommitted);
  const setProgMode = useGameStore((s) => s.setProgMode);
  const addCapOrder = useGameStore((s) => s.addCapOrder);
  const updateCapOrder = useGameStore((s) => s.updateCapOrder);
  const hudHdg = useGameStore((s) => Math.round(s.hud.hdg));
  const hudTwd = useGameStore((s) => s.hud.twd);

  const [editing, setEditing] = useState<EditingState>(null);
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));

  // 1Hz tick for sliding floor + obsolescence
  useEffect(() => {
    const id = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  const isDirty = useMemo(() => !deepEqDraft(draft, committed), [draft, committed]);

  const obsoleteCount = useMemo(() => {
    const caps = draft.capOrders.filter((o) => isObsoleteAtTime(o.trigger, nowSec)).length;
    const sails = draft.sailOrders.filter((o) => isObsoleteAtTime(o.trigger, nowSec)).length;
    return caps + sails;
  }, [draft, nowSec]);

  const handleConfirm = (): void => {
    const result = commitDraft(draft, nowSec);
    if (result.ok) markCommitted();
    // Toast handling can be added here in a follow-up; the visual feedback is
    // the footer flipping back to "Programmation à jour" once committed.
  };

  const handleCancelAll = (): void => {
    resetDraft();
  };

  // Editor sub-screens (Tasks 7-8 wire the remaining real editors)
  if (editing) {
    if (editing.kind === 'cap') {
      const isNew = editing.id === 'NEW';
      const initialOrder = isNew
        ? null
        : draft.capOrders.find((o) => o.id === editing.id) ?? null;
      const sortedCaps = [...draft.capOrders].sort(
        (a, b) => a.trigger.time - b.trigger.time,
      );
      const index = isNew
        ? null
        : sortedCaps.findIndex((o) => o.id === editing.id) + 1;
      return (
        <CapEditor
          initialOrder={initialOrder}
          windDir={hudTwd}
          defaultHeading={hudHdg}
          defaultTime={defaultCapAnchor(draft, nowSec)}
          minValueSec={floorForNow(nowSec)}
          nowSec={nowSec}
          index={index}
          onCancel={() => setEditing(null)}
          onSave={(order) => {
            if (isNew) {
              addCapOrder(order);
            } else {
              updateCapOrder(order.id, order);
            }
            setEditing(null);
          }}
        />
      );
    }
    // Other editor placeholders remain (Tasks 7-8)
    return (
      <div style={{ padding: 16, color: 'rgba(245,240,232,0.72)' }}>
        Editor placeholder — kind={editing.kind}
        {' '}
        <button
          type="button"
          style={{ marginLeft: 8, padding: '4px 8px' }}
          onClick={() => setEditing(null)}
        >
          Fermer
        </button>
      </div>
    );
  }

  // Idle / Dirty queue view
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <ProgQueueView
        draft={draft}
        nowSec={nowSec}
        onSwitchMode={(m: ProgMode) => setProgMode(m)}
        onAddCap={() => setEditing({ kind: 'cap', id: 'NEW' })}
        onAddWp={() => setEditing({ kind: 'wp', id: 'NEW' })}
        onAddFinalCap={() => setEditing({ kind: 'finalCap' })}
        onAddSail={() => setEditing({ kind: 'sail', id: 'NEW' })}
        onEditCap={(id) => setEditing({ kind: 'cap', id })}
        onEditWp={(id) => setEditing({ kind: 'wp', id })}
        onEditFinalCap={() => setEditing({ kind: 'finalCap' })}
        onEditSail={(id) => setEditing({ kind: 'sail', id })}
        onAskDelete={(_kind, _id) => { /* Task 9 wires ConfirmDialog */ }}
        onAskClearAll={() => { /* Task 9 wires ConfirmDialog */ }}
      />
      <ProgFooter
        isDirty={isDirty}
        obsoleteCount={obsoleteCount}
        onCancelAll={handleCancelAll}
        onConfirm={handleConfirm}
      />
    </div>
  );
}
