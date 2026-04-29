'use client';
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { useGameStore, commitDraft } from '@/lib/store';
import type { ProgMode, ProgDraft } from '@/lib/prog/types';
import { defaultCapAnchor, defaultSailAnchor, floorForNow, isObsoleteAtTime } from '@/lib/prog/anchors';
import ProgQueueView from './prog/ProgQueueView';
import ProgFooter from './prog/ProgFooter';
import ProgBanner from './prog/ProgBanner';
import CapEditor from './prog/CapEditor';
import SailEditor from './prog/SailEditor';
import WpEditor from './prog/WpEditor';
import FinalCapEditor from './prog/FinalCapEditor';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

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
  const [deleteDialog, setDeleteDialog] = useState<{ kind: 'cap' | 'wp' | 'finalCap' | 'sail'; id: string } | null>(null);
  const [clearAllOpen, setClearAllOpen] = useState(false);
  const [switchModeTo, setSwitchModeTo] = useState<ProgMode | null>(null);
  const [bannerDismissedAtCount, setBannerDismissedAtCount] = useState<number | null>(null);

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
    if (editing.kind === 'sail') {
      const isNew = editing.id === 'NEW';
      const initialOrder = isNew ? null : draft.sailOrders.find((o) => o.id === editing.id) ?? null;

      // Filter WPs: exclude those already referenced by another sail order,
      // EXCEPT the one being edited (so the user can keep its current WP).
      const wpIdsUsedByOtherSails = new Set(
        draft.sailOrders
          .filter((s) => s.id !== editing.id && s.trigger.type === 'AT_WAYPOINT')
          .map((s) => (s.trigger as { waypointOrderId: string }).waypointOrderId),
      );
      const availableWps = draft.wpOrders.filter((wp) => !wpIdsUsedByOtherSails.has(wp.id));

      return (
        <SailEditor
          initialOrder={initialOrder}
          draftMode={draft.mode}
          availableWps={availableWps}
          defaultTime={defaultSailAnchor(draft, nowSec)}
          minValueSec={floorForNow(nowSec)}
          nowSec={nowSec}
          onCancel={() => setEditing(null)}
          onSave={(order) => {
            if (isNew) {
              useGameStore.getState().addSailOrder(order);
            } else {
              useGameStore.getState().updateSailOrder(order.id, order);
            }
            setEditing(null);
          }}
        />
      );
    }
    if (editing.kind === 'wp') {
      const isNew = editing.id === 'NEW';
      const initialOrder = isNew ? null : draft.wpOrders.find((o) => o.id === editing.id) ?? null;
      const index = isNew ? null : draft.wpOrders.findIndex((o) => o.id === editing.id) + 1;
      const predecessorIndex = (() => {
        if (!initialOrder) return null;
        const trig = initialOrder.trigger;
        if (trig.type === 'IMMEDIATE') return null;
        const predIdx = draft.wpOrders.findIndex((w) => w.id === trig.waypointOrderId);
        return predIdx >= 0 ? predIdx + 1 : null;
      })();
      return (
        <WpEditor
          initialOrder={initialOrder}
          index={index}
          predecessorIndex={predecessorIndex}
          onCancel={() => setEditing(null)}
          onSave={(order) => {
            useGameStore.getState().updateWpOrder(order.id, order);
            setEditing(null);
          }}
        />
      );
    }

    if (editing.kind === 'finalCap') {
      const initialOrder = draft.finalCap;
      const lastWp = draft.wpOrders[draft.wpOrders.length - 1];
      if (!lastWp) {
        // Defensive: shouldn't happen because the "+ Cap final" button is gated
        // by wpOrders.length >= 1.
        return (
          <div style={{ padding: 16, color: 'rgba(245,240,232,0.72)' }}>
            Aucun WP disponible.{' '}
            <button type="button" onClick={() => setEditing(null)}>Fermer</button>
          </div>
        );
      }
      return (
        <FinalCapEditor
          initialOrder={initialOrder}
          lastWpId={lastWp.id}
          lastWpIndex={draft.wpOrders.length}
          windDir={hudTwd}
          defaultHeading={hudHdg}
          onCancel={() => setEditing(null)}
          onSave={(order) => {
            useGameStore.getState().setFinalCap(order);
            setEditing(null);
          }}
        />
      );
    }

    // Defensive fallback for unknown editor kinds
    return (
      <div style={{ padding: 16, color: 'rgba(245,240,232,0.72)' }}>
        Editor placeholder — kind={(editing as { kind: string }).kind}
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

  // Helper: WP referenced by a sail order — needed for the delete dialog body.
  const wpHasSailOrder = (wpId: string): boolean =>
    draft.sailOrders.some(
      (s) => s.trigger.type === 'AT_WAYPOINT' && s.trigger.waypointOrderId === wpId,
    );

  // Idle / Dirty queue view
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {bannerDismissedAtCount !== obsoleteCount && obsoleteCount > 0 && (
        <ProgBanner
          obsoleteCount={obsoleteCount}
          onDismiss={() => setBannerDismissedAtCount(obsoleteCount)}
        />
      )}
      <ProgQueueView
        draft={draft}
        nowSec={nowSec}
        onSwitchMode={(m: ProgMode) => {
          // Same mode → no-op
          if (m === draft.mode) return;
          // Check if the OTHER track is non-empty
          const hasIncompatibleOrders =
            (m === 'cap' && (draft.wpOrders.length > 0 || draft.finalCap !== null))
            || (m === 'wp' && draft.capOrders.length > 0);
          // Also check sail orders that would be dropped (AT_WAYPOINT in cap mode)
          const hasIncompatibleSails =
            m === 'cap'
            && draft.sailOrders.some((o) => o.trigger.type === 'AT_WAYPOINT');
          if (hasIncompatibleOrders || hasIncompatibleSails) {
            setSwitchModeTo(m);
          } else {
            setProgMode(m);
          }
        }}
        onAddCap={() => setEditing({ kind: 'cap', id: 'NEW' })}
        onAddWp={() => setEditing({ kind: 'wp', id: 'NEW' })}
        onAddFinalCap={() => setEditing({ kind: 'finalCap' })}
        onAddSail={() => setEditing({ kind: 'sail', id: 'NEW' })}
        onEditCap={(id) => setEditing({ kind: 'cap', id })}
        onEditWp={(id) => setEditing({ kind: 'wp', id })}
        onEditFinalCap={() => setEditing({ kind: 'finalCap' })}
        onEditSail={(id) => setEditing({ kind: 'sail', id })}
        onAskDelete={(kind, id) => setDeleteDialog({ kind, id })}
        onAskClearAll={() => setClearAllOpen(true)}
      />
      <ProgFooter
        isDirty={isDirty}
        obsoleteCount={obsoleteCount}
        onCancelAll={handleCancelAll}
        onConfirm={handleConfirm}
      />

      <ConfirmDialog
        open={deleteDialog !== null}
        title="Supprimer cet ordre ?"
        body={
          deleteDialog?.kind === 'wp' && wpHasSailOrder(deleteDialog.id)
            ? 'Ce WP est référencé par un ordre voile. Les deux seront supprimés.'
            : 'Cette action est irréversible.'
        }
        confirmLabel="Supprimer"
        tone="danger"
        onConfirm={() => {
          if (!deleteDialog) return;
          const { kind, id } = deleteDialog;
          if (kind === 'cap') useGameStore.getState().removeCapOrder(id);
          else if (kind === 'wp') useGameStore.getState().removeWpOrder(id);
          else if (kind === 'finalCap') useGameStore.getState().setFinalCap(null);
          else if (kind === 'sail') useGameStore.getState().removeSailOrder(id);
          setDeleteDialog(null);
        }}
        onCancel={() => setDeleteDialog(null)}
      />

      <ConfirmDialog
        open={clearAllOpen}
        title="Tout effacer ?"
        body="Toutes les programmations en cours d'édition seront supprimées. La programmation déjà confirmée n'est pas affectée tant que vous ne cliquez pas sur Confirmer."
        confirmLabel="Tout effacer"
        tone="danger"
        onConfirm={() => {
          useGameStore.getState().clearAllOrders();
          setClearAllOpen(false);
        }}
        onCancel={() => setClearAllOpen(false)}
      />

      <ConfirmDialog
        open={switchModeTo !== null}
        title="Changer de mode ?"
        body={
          switchModeTo === 'cap'
            ? 'Les waypoints, le cap final, et les ordres voile à un waypoint seront supprimés. Les ordres voile à une heure seront conservés.'
            : 'Les ordres CAP seront supprimés.'
        }
        confirmLabel="Changer"
        tone="primary"
        onConfirm={() => {
          if (switchModeTo) setProgMode(switchModeTo);
          setSwitchModeTo(null);
        }}
        onCancel={() => setSwitchModeTo(null)}
      />
    </div>
  );
}
