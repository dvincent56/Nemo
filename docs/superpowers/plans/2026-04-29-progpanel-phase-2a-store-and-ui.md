# ProgPanel Phase 2a — Store schema + new UI (without map integration) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the existing `ProgPanel.tsx` (459 lines) with the new draft → Confirmer model. Adds a typed store schema (`CapOrder`/`WpOrder`/`SailOrder`/`FinalCapOrder`, `ProgDraft`, `ProgState` with `draft + committed`), the new ProgPanel queue view + sub-screen editors (cap, sail, wp display-only, final-cap), confirmations, obsolescence banner, default-time-anchor logic, sliding floor, auto-reorder, and the Confirmer wire flow using `sendOrderReplaceQueue` from Phase 0.

**Out of scope (Phase 2b):** map markers, click-to-place WPs on map, drag WPs on map, projection 2-layer rendering, `programming.minWpDistanceNm` game-balance validation. The WP editor in Phase 2a only displays existing WPs (from router-apply) and allows delete + capture-radius edit; manual WP placement and drag arrive in 2b.

**Architecture:** Strictly typed store slice (Zustand) with two states: `committed` (mirror of server) and `draft` (user's in-progress edits). All UI mutations work on `draft`. The `Confirmer` action filters obsolete AT_TIME orders, serializes the draft to the wire format (`OrderEntry[]`), calls `sendOrderReplaceQueue` from Phase 0, then optimistically copies `draft → committed`. Closing the panel without `Confirmer` resets `draft = clone(committed)`. Router-apply still bypasses the draft (writes both `committed` and `draft` directly).

**Tech Stack:** TypeScript strict, React 19.2, Zustand store, vitest with `// @vitest-environment jsdom` for component tests, plain `node` env for store/helper tests.

---

## File map

**Created:**
- `apps/web/src/lib/prog/types.ts` — typed `CapOrder` / `WpOrder` / `FinalCapOrder` / `SailOrder` / `ProgDraft` / `ProgState`
- `apps/web/src/lib/prog/serialize.ts` — typed → `OrderEntry[]` serializer + reverse helper
- `apps/web/src/lib/prog/serialize.test.ts` — round-trip tests
- `apps/web/src/lib/prog/anchors.ts` — default-anchor + sliding-floor + obsolete helpers
- `apps/web/src/lib/prog/anchors.test.ts` — unit tests for the helpers
- `apps/web/src/components/play/prog/ProgQueueView.tsx` — main idle/dirty queue UI
- `apps/web/src/components/play/prog/ProgQueueView.module.css`
- `apps/web/src/components/play/prog/ProgFooter.tsx` — Confirmer / Annuler tout footer
- `apps/web/src/components/play/prog/ProgFooter.module.css`
- `apps/web/src/components/play/prog/ProgBanner.tsx` — obsolete-orders banner
- `apps/web/src/components/play/prog/ProgBanner.module.css`
- `apps/web/src/components/play/prog/CapEditor.tsx` — cap order editor sub-screen
- `apps/web/src/components/play/prog/SailEditor.tsx` — sail order editor sub-screen
- `apps/web/src/components/play/prog/WpEditor.tsx` — wp order editor (display-only in 2a)
- `apps/web/src/components/play/prog/FinalCapEditor.tsx` — final cap editor
- `apps/web/src/components/play/prog/Editor.module.css` — shared sub-screen styles

**Modified:**
- `apps/web/src/lib/store/types.ts` — replace `ProgState` with the new shape (delete the legacy `orderQueue`/`serverQueue` exports — they're not consumed elsewhere besides `progSlice.ts`)
- `apps/web/src/lib/store/progSlice.ts` — rewrite with new mutations (`setProgMode`, `addCapOrder`, `updateCapOrder`, `removeCapOrder`, `addWpOrder`, `updateWpOrder`, `removeWpOrder`, `setFinalCap`, `addSailOrder`, `updateSailOrder`, `removeSailOrder`, `clearAllOrders`, `resetDraft`, `commitDraft`, `applyRouteAsCommitted`)
- `apps/web/src/lib/store/progSlice.test.ts` — rewrite tests for new mutations
- `apps/web/src/lib/routing/applyRoute.ts` — refactor `capScheduleToOrders` / `waypointsToOrders` to produce typed orders → call new `applyRouteAsCommitted`
- `apps/web/src/components/play/ProgPanel.tsx` — full rewrite, becomes a slim composition of the new sub-components
- `apps/web/src/app/play/[raceId]/PlayClient.tsx` — adjust the router-apply integration to call the new `applyRouteAsCommitted` helper (line ~360-380)

**Deleted:**
- The legacy `OrderEntry` type from `lib/store/types.ts` is **kept** as the wire-format type (it's still what we serialize to). But internal-only legacy consumers (anything that read `prog.orderQueue` directly) need rewriting to use the new typed shape. Audit before changing.

---

## Conventions used in this plan

- All work happens on a feature branch `feat/progpanel-phase-2a` created from `main`.
- Commit message style: `feat(prog): …` for new code, `refactor(prog): …` for rewrites, `test(prog): …` for tests.
- Run vitest with `pnpm --filter @nemo/web test` (full suite) or with a path argument for targeted runs.
- The plan uses `// @vitest-environment jsdom` directive for component tests; store/serialize/anchor tests run in `node` env.
- After each major task, the implementer should run `pnpm --filter @nemo/web typecheck` to catch consumer breakages early. Pre-existing `.next/dev/types/routes.d.ts` errors are expected and unrelated.

---

## Pre-task: branch state verification

Before starting Task 1:

- `git status` clean
- `pnpm --filter @nemo/web test` reports 148/148 (Phase 1c baseline)
- `pnpm --filter @nemo/web typecheck` reports clean (modulo `.next/dev` artifacts)

If any of these are off, stop and investigate.

---

## Task 1: New typed schema + store slice (TDD)

**Files:**
- Create: `apps/web/src/lib/prog/types.ts`
- Modify: `apps/web/src/lib/store/types.ts`
- Modify: `apps/web/src/lib/store/progSlice.ts`
- Replace: `apps/web/src/lib/store/progSlice.test.ts`

This task lays the foundation. No UI yet — just typed mutations the rest of the plan will consume.

### Step 1: Write the new typed shape

Create `apps/web/src/lib/prog/types.ts`:

```ts
import type { SailId } from '@nemo/shared-types';

/** Mode mutex: cap-based scheduling (AT_TIME) vs WP-based scheduling (AT_WAYPOINT chained). */
export type ProgMode = 'cap' | 'wp';

export interface CapOrder {
  id: string;
  trigger: { type: 'AT_TIME'; time: number }; // unix sec
  heading: number;       // 0..359
  twaLock: boolean;
}

export interface WpOrder {
  id: string;
  trigger: { type: 'IMMEDIATE' } | { type: 'AT_WAYPOINT'; waypointOrderId: string };
  lat: number;
  lon: number;
  captureRadiusNm: number;
}

export interface FinalCapOrder {
  id: string;
  trigger: { type: 'AT_WAYPOINT'; waypointOrderId: string }; // = id of last WP
  heading: number;
  twaLock: boolean;
}

export interface SailOrder {
  id: string;
  trigger:
    | { type: 'AT_TIME'; time: number }
    | { type: 'AT_WAYPOINT'; waypointOrderId: string };
  action: { auto: false; sail: SailId } | { auto: true };
}

export interface ProgDraft {
  mode: ProgMode;
  capOrders: CapOrder[];
  wpOrders: WpOrder[];
  finalCap: FinalCapOrder | null;
  sailOrders: SailOrder[];
}

export const EMPTY_DRAFT: ProgDraft = {
  mode: 'cap',
  capOrders: [],
  wpOrders: [],
  finalCap: null,
  sailOrders: [],
};

/** State the ProgPanel reads + writes. Lives inside the Zustand store at `state.prog`. */
export interface ProgState {
  draft: ProgDraft;
  committed: ProgDraft;
}
```

### Step 2: Update the store types

In `apps/web/src/lib/store/types.ts`:

1. Re-export `ProgState`, `ProgDraft`, etc. from `lib/prog/types`:
   ```ts
   export type { ProgMode, CapOrder, WpOrder, FinalCapOrder, SailOrder, ProgDraft, ProgState } from '@/lib/prog/types';
   ```
2. Remove the legacy `ProgState` definition (the one with `orderQueue: OrderEntry[]; serverQueue: OrderEntry[]`). Search the codebase for any consumer of `state.prog.orderQueue` — currently only `progSlice.ts` and `ProgPanel.tsx` and `applyRoute.ts`.
3. **Keep** the `OrderEntry` type — it's still the wire format and is referenced by `lib/orders/obsolete.ts`, `lib/routing/applyRoute.ts`, and elsewhere. Don't delete.

### Step 3: Write the failing slice tests

Replace `apps/web/src/lib/store/progSlice.test.ts` (the test file currently exercises `addOrder/removeOrder/reorderQueue/commitQueue`). Create new tests for the new mutations:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { create } from 'zustand';
import { createProgSlice, INITIAL_PROG } from './progSlice';
import type { ProgState, CapOrder, WpOrder, SailOrder } from '@/lib/prog/types';

interface TestStore {
  prog: ProgState;
  setProgMode: ReturnType<typeof createProgSlice>['setProgMode'];
  addCapOrder: ReturnType<typeof createProgSlice>['addCapOrder'];
  removeCapOrder: ReturnType<typeof createProgSlice>['removeCapOrder'];
  resetDraft: ReturnType<typeof createProgSlice>['resetDraft'];
  // ... add methods you exercise in tests
}

function makeCap(id: string, time: number, heading = 100): CapOrder {
  return { id, trigger: { type: 'AT_TIME', time }, heading, twaLock: false };
}

describe('progSlice', () => {
  it('starts with empty draft + committed', () => {
    expect(INITIAL_PROG.draft).toEqual(INITIAL_PROG.committed);
    expect(INITIAL_PROG.draft.capOrders).toEqual([]);
  });

  it('addCapOrder mutates draft only, not committed', () => {
    const useStore = create<TestStore>()((set) => ({
      prog: INITIAL_PROG,
      ...createProgSlice(set as any),
    }));
    useStore.getState().addCapOrder(makeCap('c1', 1000));
    expect(useStore.getState().prog.draft.capOrders).toHaveLength(1);
    expect(useStore.getState().prog.committed.capOrders).toHaveLength(0);
  });

  it('removeCapOrder filters by id', () => {
    // ... similar setup with addCapOrder twice, then remove, assert one remains
  });

  it('setProgMode switches the mode and clears the OTHER track', () => {
    // setProgMode('cap'), add a cap; setProgMode('wp') should clear capOrders
    // (per spec Section 1: switching mode clears the incompatible track).
    // Note: in Phase 2a, the slice exposes a clean setProgMode that does the
    // clearing. The UI confirmation modal happens at the consumer (Task 5).
  });

  it('resetDraft copies committed back to draft', () => {
    // Mutate draft, call resetDraft, assert draft === committed
  });

  // Add tests for: removeCapOrder/updateCapOrder, addWpOrder/removeWpOrder, addSailOrder, setFinalCap, clearAllOrders.
  // Aim for ~10-15 cases total covering the mutations you need for Phase 2a.
});
```

(The implementer writes the full test file; this is a sketch. Each mutation needs at least one happy-path test.)

Run: `pnpm --filter @nemo/web test src/lib/store/progSlice.test.ts` — expect FAIL (mutations don't exist yet).

### Step 4: Implement the new slice

Replace `apps/web/src/lib/store/progSlice.ts`:

```ts
'use client';
import type { ProgState, ProgDraft, CapOrder, WpOrder, FinalCapOrder, SailOrder, ProgMode } from '@/lib/prog/types';
import { EMPTY_DRAFT } from '@/lib/prog/types';
import type { GameStore } from './types';
import type { RoutePlan } from '@nemo/routing';

export const INITIAL_PROG: ProgState = {
  draft: { ...EMPTY_DRAFT, capOrders: [], wpOrders: [], sailOrders: [] },
  committed: { ...EMPTY_DRAFT, capOrders: [], wpOrders: [], sailOrders: [] },
};

type SetFn = (fn: (s: GameStore) => Partial<GameStore>) => void;

function clone(draft: ProgDraft): ProgDraft {
  return {
    mode: draft.mode,
    capOrders: draft.capOrders.map((o) => ({ ...o })),
    wpOrders: draft.wpOrders.map((o) => ({ ...o })),
    finalCap: draft.finalCap ? { ...draft.finalCap } : null,
    sailOrders: draft.sailOrders.map((o) => ({ ...o, action: { ...o.action } })),
  };
}

export function createProgSlice(set: SetFn) {
  return {
    prog: INITIAL_PROG,

    setProgMode: (mode: ProgMode) => set((s) => {
      const draft = { ...s.prog.draft, mode };
      // Clear the incompatible track. The consumer (UI) is responsible for
      // confirmation; the slice just executes.
      if (mode === 'cap') {
        draft.wpOrders = [];
        draft.finalCap = null;
        // Drop sail orders with AT_WAYPOINT triggers (incompatible with cap mode).
        draft.sailOrders = draft.sailOrders.filter((o) => o.trigger.type === 'AT_TIME');
      } else {
        draft.capOrders = [];
      }
      return { prog: { ...s.prog, draft } };
    }),

    addCapOrder: (o: CapOrder) => set((s) => ({
      prog: { ...s.prog, draft: { ...s.prog.draft, capOrders: [...s.prog.draft.capOrders, o] } }
    })),

    updateCapOrder: (id: string, patch: Partial<CapOrder>) => set((s) => ({
      prog: { ...s.prog, draft: {
        ...s.prog.draft,
        capOrders: s.prog.draft.capOrders.map((o) => o.id === id ? { ...o, ...patch } : o),
      } }
    })),

    removeCapOrder: (id: string) => set((s) => ({
      prog: { ...s.prog, draft: { ...s.prog.draft, capOrders: s.prog.draft.capOrders.filter((o) => o.id !== id) } }
    })),

    addWpOrder: (o: WpOrder) => set((s) => ({
      prog: { ...s.prog, draft: { ...s.prog.draft, wpOrders: [...s.prog.draft.wpOrders, o] } }
    })),

    updateWpOrder: (id: string, patch: Partial<WpOrder>) => set((s) => ({
      prog: { ...s.prog, draft: {
        ...s.prog.draft,
        wpOrders: s.prog.draft.wpOrders.map((o) => o.id === id ? { ...o, ...patch } : o),
      } }
    })),

    removeWpOrder: (id: string) => set((s) => {
      const wpOrders = s.prog.draft.wpOrders.filter((o) => o.id !== id);
      // Rebind successors: any WP whose trigger is AT_WAYPOINT(removed) needs to
      // point to the *predecessor* of the removed WP instead.
      const reboundWps = wpOrders.map((wp) => {
        if (wp.trigger.type === 'AT_WAYPOINT' && wp.trigger.waypointOrderId === id) {
          // Find the predecessor of `id` in the original list
          const removedIdx = s.prog.draft.wpOrders.findIndex((x) => x.id === id);
          if (removedIdx <= 0) {
            return { ...wp, trigger: { type: 'IMMEDIATE' as const } };
          }
          const predecessor = s.prog.draft.wpOrders[removedIdx - 1];
          return predecessor
            ? { ...wp, trigger: { type: 'AT_WAYPOINT' as const, waypointOrderId: predecessor.id } }
            : wp;
        }
        return wp;
      });
      // Drop sail orders that pointed to the removed WP (Phase 2 spec: max 1
      // sail order per WP, deleted on WP removal).
      const sailOrders = s.prog.draft.sailOrders.filter((so) =>
        !(so.trigger.type === 'AT_WAYPOINT' && so.trigger.waypointOrderId === id)
      );
      // If finalCap pointed to the removed WP, drop it.
      const finalCap = s.prog.draft.finalCap?.trigger.waypointOrderId === id
        ? null : s.prog.draft.finalCap;
      return { prog: { ...s.prog, draft: { ...s.prog.draft, wpOrders: reboundWps, sailOrders, finalCap } } };
    }),

    setFinalCap: (o: FinalCapOrder | null) => set((s) => ({
      prog: { ...s.prog, draft: { ...s.prog.draft, finalCap: o } }
    })),

    addSailOrder: (o: SailOrder) => set((s) => ({
      prog: { ...s.prog, draft: { ...s.prog.draft, sailOrders: [...s.prog.draft.sailOrders, o] } }
    })),

    updateSailOrder: (id: string, patch: Partial<SailOrder>) => set((s) => ({
      prog: { ...s.prog, draft: {
        ...s.prog.draft,
        sailOrders: s.prog.draft.sailOrders.map((o) => o.id === id ? { ...o, ...patch } : o),
      } }
    })),

    removeSailOrder: (id: string) => set((s) => ({
      prog: { ...s.prog, draft: { ...s.prog.draft, sailOrders: s.prog.draft.sailOrders.filter((o) => o.id !== id) } }
    })),

    clearAllOrders: () => set((s) => ({
      prog: { ...s.prog, draft: { ...s.prog.draft, capOrders: [], wpOrders: [], finalCap: null, sailOrders: [] } }
    })),

    resetDraft: () => set((s) => ({
      prog: { ...s.prog, draft: clone(s.prog.committed) }
    })),

    /** Mark a successful commit. Called after sendOrderReplaceQueue succeeds. */
    markCommitted: () => set((s) => ({
      prog: { ...s.prog, committed: clone(s.prog.draft) }
    })),

    /** Router-apply path: replace BOTH committed and draft directly (no draft cycle). */
    applyRouteAsCommitted: (next: ProgDraft) => set(() => ({
      prog: { draft: clone(next), committed: clone(next) }
    })),
  };
}
```

(`commitDraft`, the action that wraps wire-send + markCommitted, lives in Task 4 — leaving `markCommitted` here as the slice-level primitive.)

### Step 5: Update GameStore type

In `apps/web/src/lib/store/types.ts` (or wherever `GameStore` is composed), make sure the slice's exported actions are visible on the store type. The existing pattern uses the slice factory return — verify it propagates the new method names.

### Step 6: Verify all consumers compile

Run: `pnpm --filter @nemo/web typecheck`

Expected breakages — the implementer must fix each:
- `apps/web/src/components/play/ProgPanel.tsx` — uses `prog.orderQueue` extensively. **You will rewrite this in Task 5**, but for typecheck to pass NOW, comment out or stub the consumers temporarily. Easiest: make ProgPanel.tsx export a placeholder `export default function ProgPanel(): React.ReactElement { return <div>migrating…</div>; }` until Task 5 lands.
- `apps/web/src/lib/routing/applyRoute.ts` — produces the legacy `OrderEntry[]` and probably calls `addOrder` / `replaceOrderQueue`. **Refactored in Task 5** (the router-apply task), but for now you can leave its functions intact (they produce `OrderEntry[]` which is still a valid type) and just stub PlayClient's call site to a no-op.
- `apps/web/src/app/play/[raceId]/PlayClient.tsx` — calls `useGameStore.getState().replaceOrderQueue(...)` (or similar). Comment out the call temporarily.

Add inline `// PHASE_2A_TODO:` comments where you stub. Task 5 will resolve every one of them.

Run typecheck again — should be clean.

### Step 7: Run the slice tests

Run: `pnpm --filter @nemo/web test src/lib/store/progSlice.test.ts`
Expected: all your new tests pass.

### Step 8: Commit Task 1

```bash
git add apps/web/src/lib/prog/types.ts apps/web/src/lib/store/progSlice.ts apps/web/src/lib/store/progSlice.test.ts apps/web/src/lib/store/types.ts apps/web/src/components/play/ProgPanel.tsx apps/web/src/app/play/[raceId]/PlayClient.tsx apps/web/src/lib/routing/applyRoute.ts
git commit -m "feat(prog): typed ProgDraft/ProgState schema + new slice mutations"
```

(Adjust file list to match what you actually changed.)

---

## Task 2: Wire serialization (typed → OrderEntry[]) + tests (TDD)

**Files:**
- Create: `apps/web/src/lib/prog/serialize.ts`
- Create: `apps/web/src/lib/prog/serialize.test.ts`

The Confirmer flow (Task 4) needs to convert `ProgDraft` to `OrderEntry[]` for `sendOrderReplaceQueue`. This task implements that pure function with TDD.

### Step 1: Write the failing tests

Create `apps/web/src/lib/prog/serialize.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { serializeDraft } from './serialize';
import type { ProgDraft, CapOrder } from './types';

const empty: ProgDraft = {
  mode: 'cap',
  capOrders: [],
  wpOrders: [],
  finalCap: null,
  sailOrders: [],
};

describe('serializeDraft', () => {
  it('serializes an empty draft to an empty array', () => {
    expect(serializeDraft(empty)).toEqual([]);
  });

  it('serializes CAP with twaLock=false → CAP order', () => {
    const cap: CapOrder = { id: 'c1', trigger: { type: 'AT_TIME', time: 1000 }, heading: 225, twaLock: false };
    const out = serializeDraft({ ...empty, capOrders: [cap] });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: 'c1',
      type: 'CAP',
      value: { heading: 225 },
      trigger: { type: 'AT_TIME', time: 1000 },
    });
  });

  it('serializes CAP with twaLock=true → TWA order with computed twa value', () => {
    // For TWA we need twd (true wind direction) — but the design says we
    // store `heading` as the absolute heading even when twaLock=true.
    // The serializer sends a TWA order with value.twa = the heading value
    // (the engine interprets this as the locked TWA from the perspective
    // of the order). Verify the type=TWA branch.
    const cap: CapOrder = { id: 't1', trigger: { type: 'AT_TIME', time: 2000 }, heading: 100, twaLock: true };
    const out = serializeDraft({ ...empty, capOrders: [cap] });
    expect(out[0]).toMatchObject({
      id: 't1',
      type: 'TWA',
      value: { twa: 100 },
      trigger: { type: 'AT_TIME', time: 2000 },
    });
  });

  it('serializes WP orders with their trigger chain', () => {
    const draft: ProgDraft = {
      ...empty, mode: 'wp',
      wpOrders: [
        { id: 'w1', trigger: { type: 'IMMEDIATE' }, lat: 45, lon: -3, captureRadiusNm: 0.5 },
        { id: 'w2', trigger: { type: 'AT_WAYPOINT', waypointOrderId: 'w1' }, lat: 46, lon: -2, captureRadiusNm: 0.5 },
      ],
    };
    const out = serializeDraft(draft);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ id: 'w1', type: 'WPT', value: { lat: 45, lon: -3, captureRadiusNm: 0.5 }, trigger: { type: 'IMMEDIATE' } });
    expect(out[1]).toMatchObject({ id: 'w2', type: 'WPT', trigger: { type: 'AT_WAYPOINT', waypointOrderId: 'w1' } });
  });

  it('serializes FinalCap as a CAP/TWA order with AT_WAYPOINT trigger', () => {
    const draft: ProgDraft = {
      ...empty, mode: 'wp',
      wpOrders: [{ id: 'w1', trigger: { type: 'IMMEDIATE' }, lat: 45, lon: -3, captureRadiusNm: 0.5 }],
      finalCap: { id: 'fc', trigger: { type: 'AT_WAYPOINT', waypointOrderId: 'w1' }, heading: 45, twaLock: false },
    };
    const out = serializeDraft(draft);
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({ id: 'fc', type: 'CAP', value: { heading: 45 }, trigger: { type: 'AT_WAYPOINT', waypointOrderId: 'w1' } });
  });

  it('serializes SailOrder action.auto=true → MODE order with auto:true', () => {
    const draft: ProgDraft = {
      ...empty,
      sailOrders: [{ id: 's1', trigger: { type: 'AT_TIME', time: 5000 }, action: { auto: true } }],
    };
    const out = serializeDraft(draft);
    expect(out[0]).toMatchObject({
      id: 's1', type: 'MODE', value: { auto: true }, trigger: { type: 'AT_TIME', time: 5000 },
    });
  });

  it('serializes SailOrder action.auto=false → SAIL order with sail value', () => {
    const draft: ProgDraft = {
      ...empty,
      sailOrders: [{ id: 's2', trigger: { type: 'AT_TIME', time: 5000 }, action: { auto: false, sail: 'SPI' } }],
    };
    const out = serializeDraft(draft);
    expect(out[0]).toMatchObject({
      id: 's2', type: 'SAIL', value: { sail: 'SPI' }, trigger: { type: 'AT_TIME', time: 5000 },
    });
  });

  it('produces orders in track order: caps/wps/finalCap, then sails', () => {
    // The order in the output array doesn't matter for the engine (each is
    // dispatched standalone), but consistent ordering helps debug logs.
    // Verify the serializer puts cap/wp/finalCap before sail orders.
  });
});
```

### Step 2: Implement `serializeDraft`

Create `apps/web/src/lib/prog/serialize.ts`:

```ts
import type { ProgDraft } from './types';

/**
 * Wire-format order shape. Mirrors `OrderEntry` from `lib/store/types`
 * and the `ReplaceQueueOrderInput` from `lib/store/index.ts:sendOrderReplaceQueue`.
 */
export interface WireOrder {
  id: string;
  type: 'CAP' | 'TWA' | 'WPT' | 'SAIL' | 'MODE' | 'VMG';
  value: Record<string, unknown>;
  trigger:
    | { type: 'IMMEDIATE' }
    | { type: 'AT_TIME'; time: number }
    | { type: 'AT_WAYPOINT'; waypointOrderId: string };
}

export function serializeDraft(draft: ProgDraft): WireOrder[] {
  const out: WireOrder[] = [];

  for (const cap of draft.capOrders) {
    out.push({
      id: cap.id,
      type: cap.twaLock ? 'TWA' : 'CAP',
      value: cap.twaLock ? { twa: cap.heading } : { heading: cap.heading },
      trigger: cap.trigger,
    });
  }

  for (const wp of draft.wpOrders) {
    out.push({
      id: wp.id,
      type: 'WPT',
      value: { lat: wp.lat, lon: wp.lon, captureRadiusNm: wp.captureRadiusNm },
      trigger: wp.trigger,
    });
  }

  if (draft.finalCap) {
    const fc = draft.finalCap;
    out.push({
      id: fc.id,
      type: fc.twaLock ? 'TWA' : 'CAP',
      value: fc.twaLock ? { twa: fc.heading } : { heading: fc.heading },
      trigger: fc.trigger,
    });
  }

  for (const sail of draft.sailOrders) {
    out.push({
      id: sail.id,
      type: sail.action.auto ? 'MODE' : 'SAIL',
      value: sail.action.auto ? { auto: true } : { sail: sail.action.sail },
      trigger: sail.trigger,
    });
  }

  return out;
}
```

Run the tests, expect all pass.

### Step 3: Commit Task 2

```bash
git add apps/web/src/lib/prog/serialize.ts apps/web/src/lib/prog/serialize.test.ts
git commit -m "feat(prog): typed-draft → wire-format serializer + tests"
```

---

## Task 3: Anchors + obsolete helpers (TDD)

**Files:**
- Create: `apps/web/src/lib/prog/anchors.ts`
- Create: `apps/web/src/lib/prog/anchors.test.ts`

Pure helpers for default-time-anchor logic, sliding 5-min floor, and obsolete-order detection.

### Step 1: Write the failing tests

Create `apps/web/src/lib/prog/anchors.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { defaultCapAnchor, defaultSailAnchor, isObsoleteAtTime, FLOOR_OFFSET_SEC, DEFAULT_FAR_OFFSET_SEC, DEFAULT_LATEST_OFFSET_SEC } from './anchors';
import type { ProgDraft, CapOrder, SailOrder } from './types';

const NOW = 1700000000;
const empty: ProgDraft = { mode: 'cap', capOrders: [], wpOrders: [], finalCap: null, sailOrders: [] };

describe('defaultCapAnchor', () => {
  it('returns now + 1h when capOrders is empty', () => {
    expect(defaultCapAnchor(empty, NOW)).toBe(NOW + DEFAULT_FAR_OFFSET_SEC);
  });

  it('returns max(latest.time, now+10min) when capOrders is non-empty', () => {
    const cap: CapOrder = { id: 'c1', trigger: { type: 'AT_TIME', time: NOW + 3600 }, heading: 0, twaLock: false };
    expect(defaultCapAnchor({ ...empty, capOrders: [cap] }, NOW)).toBe(NOW + 3600);
  });

  it('clamps to now+10min if the latest is too close to now', () => {
    const cap: CapOrder = { id: 'c1', trigger: { type: 'AT_TIME', time: NOW + 60 }, heading: 0, twaLock: false };
    expect(defaultCapAnchor({ ...empty, capOrders: [cap] }, NOW)).toBe(NOW + DEFAULT_LATEST_OFFSET_SEC);
  });
});

describe('defaultSailAnchor', () => {
  it('mirrors defaultCapAnchor logic for sailOrders with AT_TIME triggers', () => {
    expect(defaultSailAnchor(empty, NOW)).toBe(NOW + DEFAULT_FAR_OFFSET_SEC);
    const sail: SailOrder = { id: 's1', trigger: { type: 'AT_TIME', time: NOW + 1800 }, action: { auto: true } };
    expect(defaultSailAnchor({ ...empty, sailOrders: [sail] }, NOW)).toBe(NOW + 1800);
  });

  it('ignores AT_WAYPOINT sailOrders when computing the latest', () => {
    const sail: SailOrder = {
      id: 's1', trigger: { type: 'AT_WAYPOINT', waypointOrderId: 'w1' }, action: { auto: true },
    };
    expect(defaultSailAnchor({ ...empty, sailOrders: [sail] }, NOW)).toBe(NOW + DEFAULT_FAR_OFFSET_SEC);
  });
});

describe('isObsoleteAtTime', () => {
  it('returns true when trigger.time < now + 5min', () => {
    expect(isObsoleteAtTime({ type: 'AT_TIME', time: NOW + 60 }, NOW)).toBe(true);
  });

  it('returns false when trigger.time >= now + 5min', () => {
    expect(isObsoleteAtTime({ type: 'AT_TIME', time: NOW + FLOOR_OFFSET_SEC }, NOW)).toBe(false);
  });

  it('returns false for non-AT_TIME triggers (AT_WAYPOINT, IMMEDIATE)', () => {
    expect(isObsoleteAtTime({ type: 'AT_WAYPOINT', waypointOrderId: 'w1' }, NOW)).toBe(false);
    expect(isObsoleteAtTime({ type: 'IMMEDIATE' }, NOW)).toBe(false);
  });
});
```

### Step 2: Implement

Create `apps/web/src/lib/prog/anchors.ts`:

```ts
import type { ProgDraft, CapOrder, SailOrder } from './types';

/** Floor — orders with trigger.time < now + 5min are obsolete. */
export const FLOOR_OFFSET_SEC = 5 * 60;

/** Default anchor for empty tracks: now + 1h gives the user breathing room. */
export const DEFAULT_FAR_OFFSET_SEC = 60 * 60;

/** Default anchor when piggy-backing on the latest order: max(latest, now + 10min). */
export const DEFAULT_LATEST_OFFSET_SEC = 10 * 60;

export function defaultCapAnchor(draft: ProgDraft, nowSec: number): number {
  if (draft.capOrders.length === 0) return nowSec + DEFAULT_FAR_OFFSET_SEC;
  const latest = draft.capOrders.reduce((max, o) => Math.max(max, o.trigger.time), 0);
  return Math.max(latest, nowSec + DEFAULT_LATEST_OFFSET_SEC);
}

export function defaultSailAnchor(draft: ProgDraft, nowSec: number): number {
  const atTimes = draft.sailOrders.filter((o) => o.trigger.type === 'AT_TIME') as Array<SailOrder & { trigger: { type: 'AT_TIME'; time: number } }>;
  if (atTimes.length === 0) return nowSec + DEFAULT_FAR_OFFSET_SEC;
  const latest = atTimes.reduce((max, o) => Math.max(max, o.trigger.time), 0);
  return Math.max(latest, nowSec + DEFAULT_LATEST_OFFSET_SEC);
}

export function isObsoleteAtTime(
  trigger: { type: 'AT_TIME'; time: number } | { type: 'AT_WAYPOINT'; waypointOrderId: string } | { type: 'IMMEDIATE' },
  nowSec: number,
): boolean {
  if (trigger.type !== 'AT_TIME') return false;
  return trigger.time < nowSec + FLOOR_OFFSET_SEC;
}

/** Floor for the TimeStepper — used as `minValue` prop. */
export function floorForNow(nowSec: number): number {
  return nowSec + FLOOR_OFFSET_SEC;
}
```

Run tests, expect pass.

### Step 3: Commit Task 3

```bash
git add apps/web/src/lib/prog/anchors.ts apps/web/src/lib/prog/anchors.test.ts
git commit -m "feat(prog): default-time-anchor + sliding floor + obsolete helpers"
```

---

## Task 4: Commit logic + router-apply

**Files:**
- Modify: `apps/web/src/lib/store/index.ts` (add `commitDraft` and `applyRouteAsCommitted` orchestration helpers)
- Modify: `apps/web/src/lib/routing/applyRoute.ts` (refactor to produce typed ProgDraft instead of OrderEntry[])
- Modify: `apps/web/src/app/play/[raceId]/PlayClient.tsx` (call new applyRouteAsCommitted)

### Step 1: Add orchestration helper for commit

In `apps/web/src/lib/store/index.ts`, add (after the existing `sendOrderReplaceQueue`):

```ts
import { serializeDraft } from '@/lib/prog/serialize';
import { isObsoleteAtTime } from '@/lib/prog/anchors';
import type { ProgDraft } from '@/lib/prog/types';

/**
 * Commit the current draft to the server.
 *
 * 1. Filter obsolete AT_TIME orders (silently dropped — UI surfaced them via the banner)
 * 2. Serialize to wire format
 * 3. Send via sendOrderReplaceQueue
 * 4. On success: caller is expected to invoke `markCommitted()` on the slice
 *
 * Returns:
 *   - { ok: true, droppedObsolete: number } if the wire send succeeded
 *   - { ok: false } if the WS isn't open or the send failed
 *
 * Does NOT update the local store — that's the caller's responsibility (UI
 * shows toast etc. before calling markCommitted).
 */
export function commitDraft(draft: ProgDraft, nowSec: number): { ok: boolean; droppedObsolete: number; sent: number } {
  // Filter out obsolete AT_TIME orders.
  const filteredCaps = draft.capOrders.filter((o) => !isObsoleteAtTime(o.trigger, nowSec));
  const filteredSails = draft.sailOrders.filter((o) => !isObsoleteAtTime(o.trigger, nowSec));
  const droppedObsolete = (draft.capOrders.length - filteredCaps.length) + (draft.sailOrders.length - filteredSails.length);
  const filtered: ProgDraft = { ...draft, capOrders: filteredCaps, sailOrders: filteredSails };

  const wireOrders = serializeDraft(filtered);
  const ok = sendOrderReplaceQueue(wireOrders.map((o) => ({ type: o.type, value: o.value, trigger: o.trigger })));

  return { ok, droppedObsolete, sent: wireOrders.length };
}
```

### Step 2: Refactor `applyRoute.ts` to produce typed `ProgDraft`

Modify `apps/web/src/lib/routing/applyRoute.ts`. The current functions `capScheduleToOrders` / `waypointsToOrders` produce `OrderEntry[]`. Add new helpers `capScheduleToProgDraft` / `waypointsToProgDraft` that produce typed `ProgDraft`:

```ts
import type { ProgDraft, CapOrder, WpOrder, SailOrder } from '@/lib/prog/types';
import type { RoutePlan } from '@nemo/routing';
import { haversinePosNM } from '@/lib/geo';

const MIN_WP_DISTANCE_NM = 1; // unchanged from original logic

let counter = 0;
function uid(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}`;
}

export function capScheduleToProgDraft(plan: RoutePlan, sailAutoAlready: boolean): ProgDraft {
  const sailOrders: SailOrder[] = [];
  if (!sailAutoAlready) {
    sailOrders.push({
      id: uid('mode'),
      trigger: { type: 'AT_TIME', time: Math.floor(Date.now() / 1000) }, // immediate-ish
      action: { auto: true },
    });
  }

  const capOrders: CapOrder[] = [];
  for (const entry of plan.capSchedule) {
    const triggerTimeSec = Math.floor(entry.triggerMs / 1000);
    if (entry.twaLock !== undefined && entry.twaLock !== null) {
      capOrders.push({
        id: uid('twa'),
        trigger: { type: 'AT_TIME', time: triggerTimeSec },
        heading: Math.round(entry.twaLock),
        twaLock: true,
      });
    } else {
      capOrders.push({
        id: uid('cap'),
        trigger: { type: 'AT_TIME', time: triggerTimeSec },
        heading: Math.round(entry.cap),
        twaLock: false,
      });
    }
  }

  return { mode: 'cap', capOrders, wpOrders: [], finalCap: null, sailOrders };
}

export function waypointsToProgDraft(plan: RoutePlan, sailAutoAlready: boolean): ProgDraft {
  const sailOrders: SailOrder[] = [];
  if (!sailAutoAlready) {
    sailOrders.push({
      id: uid('mode'),
      trigger: { type: 'AT_TIME', time: Math.floor(Date.now() / 1000) },
      action: { auto: true },
    });
  }

  const wpOrders: WpOrder[] = [];
  const start = plan.waypoints[0];
  let prevId: string | null = null;
  for (let i = 1; i < plan.waypoints.length; i++) {
    const wp = plan.waypoints[i]!;
    if (start && haversinePosNM(start, wp) < MIN_WP_DISTANCE_NM) continue;
    const id = uid('wpt');
    wpOrders.push({
      id,
      trigger: prevId ? { type: 'AT_WAYPOINT', waypointOrderId: prevId } : { type: 'IMMEDIATE' },
      lat: wp.lat,
      lon: wp.lon,
      captureRadiusNm: 0.5,
    });
    prevId = id;
  }

  return { mode: 'wp', capOrders: [], wpOrders, finalCap: null, sailOrders };
}
```

(You can optionally **keep** the old `capScheduleToOrders` / `waypointsToOrders` functions for backward compat with any test that still uses them. If no test does, delete them. Search before deleting.)

### Step 3: Update PlayClient.tsx router-apply integration

In `apps/web/src/app/play/[raceId]/PlayClient.tsx`, locate the router-apply path (around line 360-380). The current code looks something like:

```ts
const orders = preset === 'wp'
  ? waypointsToOrders(plan, baseTs, sailAutoAlready)
  : capScheduleToOrders(plan, baseTs, sailAutoAlready);
useGameStore.getState().replaceOrderQueue(orders);
// ... and a sendOrder() loop or similar
```

Replace with:

```ts
const draft = preset === 'wp'
  ? waypointsToProgDraft(plan, sailAutoAlready)
  : capScheduleToProgDraft(plan, sailAutoAlready);
useGameStore.getState().applyRouteAsCommitted(draft);

// Send to server
import { sendOrderReplaceQueue } from '@/lib/store'; // or wherever
import { serializeDraft } from '@/lib/prog/serialize';
const wireOrders = serializeDraft(draft);
sendOrderReplaceQueue(wireOrders.map((o) => ({ type: o.type, value: o.value, trigger: o.trigger })));
```

(The store action `applyRouteAsCommitted(next)` was added to the slice in Task 1.)

### Step 4: Update progSlice tests if needed

If the slice tests exercise `applyRouteAsCommitted` (recommended), make sure they still pass.

### Step 5: Typecheck + tests

Run: `pnpm --filter @nemo/web typecheck` — clean.
Run: `pnpm --filter @nemo/web test` — all green (the slice tests + serialize tests + anchors tests).

### Step 6: Commit Task 4

```bash
git add apps/web/src/lib/store/index.ts apps/web/src/lib/routing/applyRoute.ts apps/web/src/app/play/[raceId]/PlayClient.tsx
git commit -m "feat(prog): commitDraft + applyRouteAsCommitted orchestrators"
```

---

## Task 5: ProgPanel queue view (idle/dirty states)

**Files:**
- Modify: `apps/web/src/components/play/ProgPanel.tsx` (full rewrite)
- Create: `apps/web/src/components/play/prog/ProgQueueView.tsx`
- Create: `apps/web/src/components/play/prog/ProgQueueView.module.css`
- Create: `apps/web/src/components/play/prog/ProgFooter.tsx`
- Create: `apps/web/src/components/play/prog/ProgFooter.module.css`

This task implements the OUTER frame of ProgPanel: the queue view that's visible when no editor is open. Editors come in Tasks 6-9.

### Component breakdown

`<ProgPanel>` (the new top-level) is a thin orchestrator:
- Reads `prog.draft` and `prog.committed` from store
- Computes `isDirty = !deepEq(draft, committed)`
- Manages local state: `editingOrder: { kind: 'cap'|'sail'|'wp'|'finalCap'; id: string | null /* 'NEW' */ } | null`
- If `editingOrder === null`: renders `<ProgQueueView>` + `<ProgFooter>`
- Else: renders the matching editor sub-component (Tasks 6-9)

`<ProgQueueView>` shows:
- Mode tabs (Cap / Waypoints) — clicking the inactive tab triggers a confirm modal if the OTHER track is non-empty (handled in Task 9)
- Section "Cap programmé / Waypoints · N ordres" + list of orders with `<Pencil>` and `<Trash2>` actions per row
- "+ Ajouter un cap" / "+ Ajouter un WP" / "+ Cap final" buttons (Cap final only visible if `wpOrders.length ≥ 1 && finalCap === null`)
- Section "Voiles · N ordres" + list of sail orders + "+ Ajouter un changement de voile"
- "🗑 Tout effacer" discreet button at the bottom of the body

`<ProgFooter>` shows:
- Status text: "✓ Programmation à jour" (idle) / "● Modifications non enregistrées" (dirty)
- Buttons: "Annuler" (calls `resetDraft`) and "Confirmer" (calls `commitDraft`) — both disabled if not dirty

### Step 1: Implement `<ProgFooter>`

Create `apps/web/src/components/play/prog/ProgFooter.tsx`:

```tsx
'use client';
import type { ReactElement } from 'react';
import { Check } from 'lucide-react';
import styles from './ProgFooter.module.css';

export interface ProgFooterProps {
  isDirty: boolean;
  obsoleteCount: number;
  onCancelAll: () => void;
  onConfirm: () => void;
}

export default function ProgFooter({ isDirty, obsoleteCount, onCancelAll, onConfirm }: ProgFooterProps): ReactElement {
  return (
    <footer className={`${styles.footer} ${isDirty ? styles.dirty : ''}`}>
      <div className={styles.status}>
        {isDirty ? (
          <>
            <span className={styles.dot} />
            <span>Modifications non enregistrées{obsoleteCount > 0 ? ` · ${obsoleteCount} obsolète(s)` : ''}</span>
          </>
        ) : (
          <>
            <Check size={14} />
            <span>Programmation à jour</span>
          </>
        )}
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.cancel} onClick={onCancelAll} disabled={!isDirty}>Annuler</button>
        <button type="button" className={styles.confirm} onClick={onConfirm} disabled={!isDirty}>
          <Check size={14} />&nbsp;CONFIRMER
        </button>
      </div>
    </footer>
  );
}
```

CSS for `ProgFooter.module.css`: gold-glow accent when `.dirty`, navy background, status row + actions row layout. Keep it under 80 lines.

### Step 2: Implement `<ProgQueueView>`

Create `apps/web/src/components/play/prog/ProgQueueView.tsx`. This is the larger component: ~150 lines. Structure:

- Mode tabs at the top using `<button>` elements with `aria-pressed`
- Render `draft.mode === 'cap'`: list of `draft.capOrders` (sorted by `trigger.time` ascending) using `<Anchor>` icon + HH:MM + relative offset + heading display + edit/trash buttons
- Render `draft.mode === 'wp'`: list of `draft.wpOrders` with `<MapPin>` icon + "Au départ" / "Après WP n" labels + lat/lon + edit/trash buttons. If `finalCap` is set, append it after the last WP with a `<Anchor>` icon and gold accent.
- Always render the `Voiles` section with `draft.sailOrders` (sorted by trigger time/wp index)
- "+" buttons at the bottom of each section
- "🗑 Tout effacer" link button at the bottom
- The `onEdit(order)` / `onAdd(kind)` / `onAskDelete(id)` / `onAskClear()` props bubble up to ProgPanel for state changes

Props:
```ts
export interface ProgQueueViewProps {
  draft: ProgDraft;
  nowSec: number;
  onSwitchMode: (mode: ProgMode) => void;          // calls setProgMode (with confirm guard from Task 9)
  onAddCap: () => void;
  onAddWp: () => void;
  onAddFinalCap: () => void;
  onAddSail: () => void;
  onEditCap: (id: string) => void;
  onEditWp: (id: string) => void;
  onEditFinalCap: () => void;
  onEditSail: (id: string) => void;
  onAskDelete: (kind: 'cap'|'wp'|'finalCap'|'sail', id: string) => void;
  onAskClearAll: () => void;
}
```

Use `formatAbsolute` and `formatRelative` from `TimeStepper.tsx` if exposed (extract them to a shared utility if needed — see plan's Phase 1c notes).

### Step 3: Rewrite `ProgPanel.tsx` as the orchestrator

Replace the file entirely. New shape:

```tsx
'use client';
import { useEffect, useState, useMemo } from 'react';
import { useGameStore, commitDraft } from '@/lib/store';
import ProgQueueView from './prog/ProgQueueView';
import ProgFooter from './prog/ProgFooter';
// Import editors from Tasks 6-9 once they exist (placeholder for now)
import type { ProgMode, ProgDraft } from '@/lib/prog/types';
import { isObsoleteAtTime } from '@/lib/prog/anchors';

type EditingState =
  | null
  | { kind: 'cap'; id: string | 'NEW' }
  | { kind: 'sail'; id: string | 'NEW' }
  | { kind: 'wp'; id: string | 'NEW' }
  | { kind: 'finalCap' };

function deepEqDraft(a: ProgDraft, b: ProgDraft): boolean {
  // Cheap structural equality. JSON.stringify is OK here because the typed
  // shapes don't contain functions, undefined, or non-serializable values.
  return JSON.stringify(a) === JSON.stringify(b);
}

export default function ProgPanel(): React.ReactElement {
  const draft = useGameStore((s) => s.prog.draft);
  const committed = useGameStore((s) => s.prog.committed);
  const resetDraft = useGameStore((s) => s.resetDraft);
  const markCommitted = useGameStore((s) => s.markCommitted);
  const setProgMode = useGameStore((s) => s.setProgMode);

  const [editing, setEditing] = useState<EditingState>(null);
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));

  // 1Hz tick for sliding floor + obsolescence detection
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

  const handleConfirm = () => {
    const result = commitDraft(draft, nowSec);
    if (result.ok) markCommitted();
    // Toast handling could go here (omitted in 2a — keep minimal)
  };

  const handleCancelAll = () => {
    resetDraft();
  };

  // Editor dispatch (Tasks 6-9 expose components; for now placeholder)
  if (editing?.kind === 'cap') {
    // return <CapEditor ... />;
    return <div>Cap editor — pending Task 6</div>;
  }
  if (editing?.kind === 'sail') {
    return <div>Sail editor — pending Task 7</div>;
  }
  if (editing?.kind === 'wp') {
    return <div>WP editor — pending Task 8</div>;
  }
  if (editing?.kind === 'finalCap') {
    return <div>Final Cap editor — pending Task 9</div>;
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
        onAskDelete={(kind, id) => { /* Task 9 wires the ConfirmDialog */ }}
        onAskClearAll={() => { /* Task 9 wires the ConfirmDialog */ }}
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
```

### Step 4: Verify typecheck + tests

Run: `pnpm --filter @nemo/web typecheck` — clean (modulo pre-existing).
Run: `pnpm --filter @nemo/web test` — full suite still green (no new tests in this task; the ProgPanel rewrite is verified by manual smoke + Task 10).

### Step 5: Commit Task 5

```bash
git add apps/web/src/components/play/ProgPanel.tsx apps/web/src/components/play/prog/
git commit -m "feat(prog): new ProgPanel queue view + footer (idle/dirty states)"
```

---

## Task 6: Cap order editor sub-screen

**Files:**
- Create: `apps/web/src/components/play/prog/CapEditor.tsx`
- Create: `apps/web/src/components/play/prog/Editor.module.css` (shared sub-screen layout)
- Modify: `apps/web/src/components/play/ProgPanel.tsx` (replace the placeholder)

`<CapEditor>` is the cap order editor. Composes:
- `<CompassReadouts>` (no Vitesse cell — we don't compute polar speed for a future order)
- `<CompassDial>` size 180, ghostValue=current hud.hdg, onChange updates the draft
- `<CompassLockToggle>` with onToggle that flips `editForm.twaLock`
- `<TimeStepper>` with floor = `nowSec + 300`
- Footer: [Annuler] [OK]

Editor logic:
- Local state `editForm: CapOrder` initialized from existing order or new defaults
- Defaults for NEW: `heading = current hud.hdg`, `twaLock = false`, `time = defaultCapAnchor(draft, nowSec)`
- Defaults for edit: clone the existing order
- `Annuler` → caller closes editor without changes
- `OK` → caller commits to draft (addCapOrder for NEW, updateCapOrder for edit), then re-sort the capOrders by trigger.time, close editor

Props:
```ts
export interface CapEditorProps {
  initialOrder: CapOrder | null;  // null = new order
  windDir: number;                // hud.twd, for the compass tick
  defaultHeading: number;         // hud.hdg, for new-order default
  defaultTime: number;            // computed by parent via defaultCapAnchor()
  minValueSec: number;            // floor, computed by parent via floorForNow()
  nowSec: number;                 // for the relative offset
  onCancel: () => void;
  onSave: (next: CapOrder) => void;
}
```

The parent (`ProgPanel.tsx`) handles store mutations (addCapOrder/updateCapOrder + the sort) — the editor just bubbles up the new typed order.

Implement the component, wire to `ProgPanel.tsx` (replace the placeholder), and verify by manual smoke (controller — you don't have a dev server).

### Commit

```bash
git add apps/web/src/components/play/prog/CapEditor.tsx apps/web/src/components/play/prog/Editor.module.css apps/web/src/components/play/ProgPanel.tsx
git commit -m "feat(prog): cap order editor sub-screen"
```

---

## Task 7: Sail order editor sub-screen

**Files:**
- Create: `apps/web/src/components/play/prog/SailEditor.tsx`
- Modify: `apps/web/src/components/play/ProgPanel.tsx`

`<SailEditor>` composes:
- Auto / Manuel segmented toggle
- If Manuel: 7-sail grid (4+3 layout, using `SAIL_ICONS` from `lib/sails/icons`)
- Trigger picker:
  - In `mode === 'cap'`: only AT_TIME, show `<TimeStepper>`
  - In `mode === 'wp'`: segmented [À une heure | À un waypoint]; if AT_TIME → TimeStepper; if AT_WAYPOINT → list of WPs (filter out WPs that already have a sail order pointing to them, except the one being edited)
- Footer: [Annuler] [OK]

Reuse `SAIL_ICONS`/`SAIL_DEFS` from `@/lib/sails/icons`.

Props (similar to CapEditor):
```ts
export interface SailEditorProps {
  initialOrder: SailOrder | null;
  draftMode: ProgMode;
  wpOrdersForPicker: WpOrder[];     // filtered list
  defaultTime: number;
  minValueSec: number;
  nowSec: number;
  onCancel: () => void;
  onSave: (next: SailOrder) => void;
}
```

### Commit

```bash
git add apps/web/src/components/play/prog/SailEditor.tsx apps/web/src/components/play/ProgPanel.tsx
git commit -m "feat(prog): sail order editor sub-screen"
```

---

## Task 8: WP editor (display-only) + Final Cap editor

**Files:**
- Create: `apps/web/src/components/play/prog/WpEditor.tsx`
- Create: `apps/web/src/components/play/prog/FinalCapEditor.tsx`
- Modify: `apps/web/src/components/play/ProgPanel.tsx`

`<WpEditor>` for Phase 2a is intentionally limited:
- Display the WP's lat/lon (read-only — manual placement comes in Phase 2b with the map)
- Numeric input for `captureRadiusNm` (default 0.5)
- Trigger label "Au départ" or "Après WP n" (read-only — chain order)
- Footer: [Annuler] [OK]

If the WP is `id === 'NEW'`, the editor displays a message:
> "Pour ajouter un waypoint, utilisez le router (Phase 2a) ou cliquez sur la carte (Phase 2b — prochaine version)."

— and disables the OK button until 2b lands.

`<FinalCapEditor>` is structurally identical to CapEditor but:
- No TimeStepper (trigger is fixed AT_WAYPOINT(lastWP))
- The "trigger" line shows "Après {lastWP label}"
- Otherwise: CompassReadouts + CompassDial + CompassLockToggle + footer

### Commit

```bash
git add apps/web/src/components/play/prog/WpEditor.tsx apps/web/src/components/play/prog/FinalCapEditor.tsx apps/web/src/components/play/ProgPanel.tsx
git commit -m "feat(prog): wp display-only editor + final cap editor"
```

---

## Task 9: ConfirmDialogs + Banner + ClearAll

**Files:**
- Create: `apps/web/src/components/play/prog/ProgBanner.tsx`
- Create: `apps/web/src/components/play/prog/ProgBanner.module.css`
- Modify: `apps/web/src/components/play/ProgPanel.tsx` (wire ConfirmDialog + banner)

`<ProgBanner>` shows the obsolete-orders banner at the top of the body when `obsoleteCount > 0`:
> "⚠ N ordre(s) obsolète(s) (heure < now + 5min) — sera/seront retiré(s) à la confirmation. [✕ ignorer]"

Props:
```ts
export interface ProgBannerProps {
  obsoleteCount: number;
  onDismiss: () => void;
}
```

Add a dismissed-bool local state in `ProgPanel.tsx` so clicking ✕ hides until a new order becomes obsolete.

Wire 3 `<ConfirmDialog>`s in `ProgPanel.tsx`:
1. **Delete one order**: `onAskDelete(kind, id)` opens a dialog. On confirm, calls `removeXxxOrder(id)`. Special case for WP-with-sail-order: text changes to "Ce WP est référencé par 1 ordre voile. Supprimer les deux ?" — the slice's `removeWpOrder` already drops the sail order automatically.
2. **Clear all**: `onAskClearAll()` opens dialog. On confirm, calls `clearAllOrders()`.
3. **Switch mode with non-empty other track**: when `setProgMode(otherMode)` is called and the OTHER track is non-empty, intercept the call → open dialog → on confirm, call `setProgMode` (which clears the incompatible track per the slice).

Use the existing `<ConfirmDialog>` from `apps/web/src/components/ui/ConfirmDialog.tsx` (cf. spec).

### Commit

```bash
git add apps/web/src/components/play/prog/ProgBanner.tsx apps/web/src/components/play/prog/ProgBanner.module.css apps/web/src/components/play/ProgPanel.tsx
git commit -m "feat(prog): obsolete banner + delete/clear/switch-mode confirmations"
```

---

## Task 10: Repo verification

- [ ] **Step 1: Full repo tests**

Run: `pnpm -r test`
Expected: 269 + (Phase 2a tests: ~15-20 from progSlice + serialize + anchors) = ~285-290 passing.

- [ ] **Step 2: Repo typecheck**

Run: `pnpm -r typecheck`
Expected: pre-existing errors only (`.next/dev/types/routes.d.ts`).

- [ ] **Step 3: Manual smoke (CONTROLLER)**

The implementer typically can't run a dev server. Defer to the controller — they'll validate:
- Open ProgPanel from the play screen
- Idle state shows "✓ Programmation à jour"
- Switch to "Cap" mode, click "+ Ajouter un cap" → editor opens
- Edit time via TimeStepper, drag compass, click OK → return to queue, footer becomes dirty
- Click ✎ on an existing order → editor opens with that order
- Click 🗑 → confirm dialog appears
- Click "Annuler tout" → draft reverts to committed
- Click "Confirmer" → wire send happens (verify in browser dev tools / Redis if available)
- Switch to "Waypoints" mode (with router-applied WPs) → see WP list
- Click ✎ on a WP → editor shows lat/lon read-only, can edit captureRadiusNm
- Banner appears for obsolete orders, can be dismissed

If any UI is broken, fix and re-commit. Don't ship a half-working ProgPanel.

- [ ] **Step 4: Final tag commit (optional)**

```bash
git commit --allow-empty -m "chore: ProgPanel Phase 2a complete (store + UI without map)"
```

---

## Self-review notes (for the implementer)

- **Don't add map integration**. WP editor is intentionally limited to display + radius edit. Adding click-on-map or markers is Phase 2b.
- **The 1Hz tick** (`nowSec` state) lives in `ProgPanel.tsx` so the floor + banner update live without each editor having its own tick.
- **The `isDirty` deep-equality** uses `JSON.stringify`. If profiling shows it's a hot path, replace with a focused field-by-field comparator. Phase 2a accepts the simple version.
- **Auto-reorder of cap/sail orders** happens in the parent (ProgPanel.tsx) when the editor saves: after calling addXxxOrder/updateXxxOrder, the parent should call a separate `sortCapOrders` mutation (or the editor's onSave callback should trigger the sort). Add a `sortCapOrders` method to the slice if helpful — or do it inline in the parent.
- **The cap editor's `defaultHeading` for NEW orders**: use `useGameStore((s) => s.hud.hdg)` to read the current heading. Same for `windDir`.
- **The `<TimeStepper>` floor warning text** is hardcoded "Délai mini : now + 5min". Phase 2b should i18n this — flagged in the Phase 1c review.
- **The banner DOES NOT auto-fix obsolete orders** — they stay in the queue until either the user edits them or clicks Confirmer (which silently drops them). This matches the spec.
- **No keyboard support** for editor confirm/cancel in Phase 2a. Phase 2b can add Escape/Enter.
- **The `<ProgBanner>` close button** sets a local "dismissed" flag; if a NEW order becomes obsolete after dismissal, the banner re-appears (the count changed). Track this with a ref or compare counts.

## Phase 2b readiness

After Phase 2a:
- `<WpEditor>` is wired but its lat/lon edit is disabled. Phase 2b adds click-on-map → place + drag-on-map → move.
- `<MapCanvas>` continues to render the existing single projection. Phase 2b adds:
  - `progSnapshot: { committed, draft }` prop into the worker
  - Two-layer projection rendering (committed dimmed, draft full)
  - Markers per order kind (Anchor/Wind/MapPin/AlertTriangle from lucide)
  - Click marker → `setEditing({ kind, id })` on the panel
  - Drag WP marker → call `updateWpOrder(id, { lat, lon })` live
- Game-balance gets `programming.minWpDistanceNm: 3` and the WP placement validates against the boat position.
