'use client';
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { GameBalance } from '@nemo/game-balance/browser';
import { useGameStore, commitDraft } from '@/lib/store';
import type { ProgMode } from '@/lib/prog/types';
import { defaultCapAnchor, defaultSailAnchor, floorForNow, isObsoleteAtTime } from '@/lib/prog/anchors';
import ProgQueueView from './prog/ProgQueueView';
import ProgFooter from './prog/ProgFooter';
import ProgBanner from './prog/ProgBanner';
import CapEditor from './prog/CapEditor';
import SailEditor from './prog/SailEditor';
import WpEditor from './prog/WpEditor';
import FinalCapEditor from './prog/FinalCapEditor';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { deepEqDraft } from '@/lib/prog/equality';

export default function ProgPanel(): ReactElement {
  const draft = useGameStore((s) => s.prog.draft);
  const committed = useGameStore((s) => s.prog.committed);
  const resetDraft = useGameStore((s) => s.resetDraft);
  const markCommitted = useGameStore((s) => s.markCommitted);
  const setProgMode = useGameStore((s) => s.setProgMode);
  const addCapOrder = useGameStore((s) => s.addCapOrder);
  const updateCapOrder = useGameStore((s) => s.updateCapOrder);
  const addSailOrder = useGameStore((s) => s.addSailOrder);
  const updateSailOrder = useGameStore((s) => s.updateSailOrder);
  const updateWpOrder = useGameStore((s) => s.updateWpOrder);
  const setFinalCap = useGameStore((s) => s.setFinalCap);
  const removeCapOrder = useGameStore((s) => s.removeCapOrder);
  const removeWpOrder = useGameStore((s) => s.removeWpOrder);
  const removeSailOrder = useGameStore((s) => s.removeSailOrder);
  const clearAllOrders = useGameStore((s) => s.clearAllOrders);
  const hudHdg = useGameStore((s) => Math.round(s.hud.hdg));
  const hudTwd = useGameStore((s) => s.hud.twd);
  const hudLat = useGameStore((s) => s.hud.lat);
  const hudLon = useGameStore((s) => s.hud.lon);
  const sailAuto = useGameStore((s) => s.sail.sailAuto);

  // Phase 2b Task 3: editing state lives in the store so MapCanvas marker
  // clicks can drive the editor. The 'NEW' magic id (cap/sail/wp create
  // mode) and the 'FINAL' literal (single-instance finalCap) are preserved
  // as ProgPanel-internal conventions on top of the EditingOrder.id field.
  const editing = useGameStore((s) => s.prog.editingOrder);
  const setEditing = useGameStore((s) => s.setEditingOrder);
  const pendingNewWpId = useGameStore((s) => s.prog.pendingNewWpId);
  const setPendingNewWpId = useGameStore((s) => s.setPendingNewWpId);
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
  const [deleteDialog, setDeleteDialog] = useState<{ kind: 'cap' | 'wp' | 'finalCap' | 'sail'; id: string } | null>(null);
  const [clearAllOpen, setClearAllOpen] = useState(false);
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

      // Determine the boat's auto-mode state at the moment THIS order would
      // fire. We only consider AT_TIME prior orders here — AT_WAYPOINT
      // triggers depend on routing dynamics that aren't ordered linearly
      // against AT_TIME triggers. If there's no AT_TIME predecessor, fall
      // back to the live boat state (`sail.sailAuto`). This is what powers
      // the "Auto button disabled when already in auto" UX in SailEditor.
      const editingTime = (initialOrder?.trigger.type === 'AT_TIME'
        ? initialOrder.trigger.time
        : null) ?? defaultSailAnchor(draft, nowSec);
      const priorAtTimeSails = draft.sailOrders
        .filter((s) => s.id !== editing.id && s.trigger.type === 'AT_TIME')
        .filter((s) => (s.trigger as { time: number }).time < editingTime)
        .sort((a, b) => (b.trigger as { time: number }).time - (a.trigger as { time: number }).time);
      const priorOrder = priorAtTimeSails[0];
      const priorIsAuto = priorOrder ? priorOrder.action.auto : sailAuto;

      return (
        <SailEditor
          initialOrder={initialOrder}
          draftMode={draft.mode}
          availableWps={availableWps}
          defaultTime={defaultSailAnchor(draft, nowSec)}
          minValueSec={floorForNow(nowSec)}
          nowSec={nowSec}
          priorIsAuto={priorIsAuto}
          onCancel={() => setEditing(null)}
          onSave={(order) => {
            if (isNew) {
              addSailOrder(order);
            } else {
              updateSailOrder(order.id, order);
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
          boat={{ lat: hudLat ?? 0, lon: hudLon ?? 0 }}
          minWpDistanceNm={GameBalance.programming?.minWpDistanceNm ?? 3}
          onCancel={() => {
            // If this WP was tentatively placed by a click-on-map and the
            // user is bailing out of the editor without confirming, remove
            // it from the draft so the placement is fully undone.
            if (pendingNewWpId && initialOrder?.id === pendingNewWpId) {
              removeWpOrder(pendingNewWpId);
              setPendingNewWpId(null);
            }
            setEditing(null);
          }}
          onSave={(order) => {
            // Confirmed — clear the tentative marker so the WP becomes a
            // regular committed-to-draft entry.
            if (pendingNewWpId && pendingNewWpId === order.id) {
              setPendingNewWpId(null);
            }
            updateWpOrder(order.id, order);
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
            setFinalCap(order);
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
          // Soft toggle — both tracks can coexist in the draft. The inactive
          // track is dropped only when the user commits (markCommitted) so
          // they can start drafting in the new mode without losing what they
          // had in the previous one.
          if (m === draft.mode) return;
          setProgMode(m);
        }}
        onAddCap={() => setEditing({ kind: 'cap', id: 'NEW' })}
        onAddWp={() => setEditing({ kind: 'wp', id: 'NEW' })}
        onAddFinalCap={() => setEditing({ kind: 'finalCap', id: 'FINAL' })}
        onAddSail={() => setEditing({ kind: 'sail', id: 'NEW' })}
        onEditCap={(id) => setEditing({ kind: 'cap', id })}
        onEditWp={(id) => setEditing({ kind: 'wp', id })}
        onEditFinalCap={() => setEditing({ kind: 'finalCap', id: 'FINAL' })}
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
          if (kind === 'cap') removeCapOrder(id);
          else if (kind === 'wp') removeWpOrder(id);
          else if (kind === 'finalCap') setFinalCap(null);
          else if (kind === 'sail') removeSailOrder(id);
          setDeleteDialog(null);
        }}
        onCancel={() => setDeleteDialog(null)}
      />

      <ConfirmDialog
        open={clearAllOpen}
        title="Tout effacer ?"
        body="Cela vide la programmation en cours d'édition. Vous pouvez annuler avec « Annuler »."
        confirmLabel="Tout effacer"
        tone="danger"
        onConfirm={() => {
          clearAllOrders();
          setClearAllOpen(false);
        }}
        onCancel={() => setClearAllOpen(false)}
      />

    </div>
  );
}
