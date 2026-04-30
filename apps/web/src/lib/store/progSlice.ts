'use client';
import type {
  ProgState,
  ProgDraft,
  CapOrder,
  WpOrder,
  FinalCapOrder,
  SailOrder,
  ProgMode,
  EditingOrder,
} from '@/lib/prog/types';
import { EMPTY_DRAFT } from '@/lib/prog/types';
import type { GameStore } from './types';

export const INITIAL_PROG: ProgState = {
  draft: { ...EMPTY_DRAFT, capOrders: [], wpOrders: [], sailOrders: [] },
  committed: { ...EMPTY_DRAFT, capOrders: [], wpOrders: [], sailOrders: [] },
  editingOrder: null,
  pickingWp: false,
  pendingNewWpId: null,
};

type SetFn = (fn: (s: GameStore) => Partial<GameStore>) => void;

function clone(draft: ProgDraft): ProgDraft {
  return {
    mode: draft.mode,
    capOrders: draft.capOrders.map((o) => ({ ...o, trigger: { ...o.trigger } })),
    wpOrders: draft.wpOrders.map((o) => ({ ...o, trigger: { ...o.trigger } })),
    finalCap: draft.finalCap
      ? { ...draft.finalCap, trigger: { ...draft.finalCap.trigger } }
      : null,
    sailOrders: draft.sailOrders.map((o) => ({
      ...o,
      trigger: { ...o.trigger },
      action: { ...o.action },
    })),
  };
}

export function createProgSlice(set: SetFn) {
  return {
    prog: INITIAL_PROG,

    setProgMode: (mode: ProgMode) =>
      // Soft toggle — both cap and wp tracks coexist in the draft. The
      // inactive track is dropped at commit time (see `markCommitted` and
      // `serializeDraft`). This lets the user start drafting waypoints
      // without losing their existing cap orders, and only commit one of
      // the two for the wire.
      set((s) => ({
        prog: { ...s.prog, draft: { ...s.prog.draft, mode } },
      })),

    addCapOrder: (o: CapOrder) =>
      set((s) => ({
        prog: {
          ...s.prog,
          draft: { ...s.prog.draft, capOrders: [...s.prog.draft.capOrders, o] },
        },
      })),

    updateCapOrder: (id: string, patch: Partial<CapOrder>) =>
      set((s) => ({
        prog: {
          ...s.prog,
          draft: {
            ...s.prog.draft,
            capOrders: s.prog.draft.capOrders.map((o) =>
              o.id === id ? { ...o, ...patch } : o,
            ),
          },
        },
      })),

    removeCapOrder: (id: string) =>
      set((s) => ({
        prog: {
          ...s.prog,
          draft: {
            ...s.prog.draft,
            capOrders: s.prog.draft.capOrders.filter((o) => o.id !== id),
          },
        },
      })),

    addWpOrder: (o: WpOrder) =>
      set((s) => ({
        prog: {
          ...s.prog,
          draft: { ...s.prog.draft, wpOrders: [...s.prog.draft.wpOrders, o] },
        },
      })),

    updateWpOrder: (id: string, patch: Partial<WpOrder>) =>
      set((s) => ({
        prog: {
          ...s.prog,
          draft: {
            ...s.prog.draft,
            wpOrders: s.prog.draft.wpOrders.map((o) =>
              o.id === id ? { ...o, ...patch } : o,
            ),
          },
        },
      })),

    removeWpOrder: (id: string) =>
      set((s) => {
        const wpOrders = s.prog.draft.wpOrders.filter((o) => o.id !== id);
        const reboundWps = wpOrders.map((wp) => {
          if (wp.trigger.type === 'AT_WAYPOINT' && wp.trigger.waypointOrderId === id) {
            const removedIdx = s.prog.draft.wpOrders.findIndex((x) => x.id === id);
            if (removedIdx <= 0) {
              return { ...wp, trigger: { type: 'IMMEDIATE' as const } };
            }
            const predecessor = s.prog.draft.wpOrders[removedIdx - 1];
            return predecessor
              ? {
                  ...wp,
                  trigger: {
                    type: 'AT_WAYPOINT' as const,
                    waypointOrderId: predecessor.id,
                  },
                }
              : wp;
          }
          return wp;
        });
        const sailOrders = s.prog.draft.sailOrders.filter(
          (so) =>
            !(so.trigger.type === 'AT_WAYPOINT' && so.trigger.waypointOrderId === id),
        );
        const finalCap =
          s.prog.draft.finalCap?.trigger.waypointOrderId === id
            ? null
            : s.prog.draft.finalCap;
        return {
          prog: {
            ...s.prog,
            draft: { ...s.prog.draft, wpOrders: reboundWps, sailOrders, finalCap },
          },
        };
      }),

    setFinalCap: (o: FinalCapOrder | null) =>
      set((s) => ({
        prog: { ...s.prog, draft: { ...s.prog.draft, finalCap: o } },
      })),

    addSailOrder: (o: SailOrder) =>
      set((s) => ({
        prog: {
          ...s.prog,
          draft: { ...s.prog.draft, sailOrders: [...s.prog.draft.sailOrders, o] },
        },
      })),

    updateSailOrder: (id: string, patch: Partial<SailOrder>) =>
      set((s) => ({
        prog: {
          ...s.prog,
          draft: {
            ...s.prog.draft,
            sailOrders: s.prog.draft.sailOrders.map((o) =>
              o.id === id ? { ...o, ...patch } : o,
            ),
          },
        },
      })),

    removeSailOrder: (id: string) =>
      set((s) => ({
        prog: {
          ...s.prog,
          draft: {
            ...s.prog.draft,
            sailOrders: s.prog.draft.sailOrders.filter((o) => o.id !== id),
          },
        },
      })),

    clearAllOrders: () =>
      set((s) => ({
        prog: {
          ...s.prog,
          draft: {
            ...s.prog.draft,
            capOrders: [],
            wpOrders: [],
            finalCap: null,
            sailOrders: [],
          },
        },
      })),

    resetDraft: () =>
      set((s) => ({
        prog: { ...s.prog, draft: clone(s.prog.committed) },
      })),

    markCommitted: () =>
      // Drop the inactive mode's track at commit so the dirty diff doesn't
      // light up against orders that were never sent. The cleaned shape is
      // pushed into BOTH committed and draft, matching the wire output.
      set((s) => {
        const d = s.prog.draft;
        const cleaned: ProgDraft = {
          mode: d.mode,
          capOrders: d.mode === 'cap'
            ? d.capOrders.map((o) => ({ ...o, trigger: { ...o.trigger } }))
            : [],
          wpOrders: d.mode === 'wp'
            ? d.wpOrders.map((o) => ({ ...o, trigger: { ...o.trigger } }))
            : [],
          finalCap: d.mode === 'wp' && d.finalCap
            ? { ...d.finalCap, trigger: { ...d.finalCap.trigger } }
            : null,
          sailOrders: d.sailOrders
            .filter((o) => !(d.mode === 'cap' && o.trigger.type === 'AT_WAYPOINT'))
            .map((o) => ({ ...o, trigger: { ...o.trigger }, action: { ...o.action } })),
        };
        return { prog: { ...s.prog, draft: cleaned, committed: cleaned } };
      }),

    applyRouteAsCommitted: (next: ProgDraft) =>
      set((s) => ({
        // Preserve editingOrder + pickingWp + pendingNewWpId — UI state mustn't
        // be squashed by an incoming route apply (so the user can click a
        // marker, then accept a route, and still see the editor where they
        // left it).
        prog: {
          draft: clone(next),
          committed: clone(next),
          editingOrder: s.prog.editingOrder,
          pickingWp: s.prog.pickingWp,
          pendingNewWpId: s.prog.pendingNewWpId,
        },
      })),

    setEditingOrder: (e: EditingOrder | null) =>
      set((s) => ({
        prog: { ...s.prog, editingOrder: e },
      })),

    setPickingWp: (b: boolean) =>
      set((s) => ({
        prog: { ...s.prog, pickingWp: b },
      })),

    setPendingNewWpId: (id: string | null) =>
      set((s) => ({
        prog: { ...s.prog, pendingNewWpId: id },
      })),
  };
}
