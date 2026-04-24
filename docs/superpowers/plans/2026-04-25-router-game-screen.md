# Router on Game Screen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the existing isochrone router (already validated in `/dev/simulator`) into the in-game screen at `/play/[raceId]`, with a slide-out panel, route+isochrone display, and the ability to apply the computed route as programming (CAP schedule or waypoints).

**Architecture:** Reuse `packages/routing` and `routing.worker.ts` as-is. Move `RouteLayer` + `IsochroneLayer` to a shared location. New Zustand slice `routerSlice`. Add `WPT` order handling in the engine. New UI: `RouterPanel`, `RouterControls`, `RouterDestinationMarker`, `ConfirmReplaceProgModal`, `ZoomCompact`. Hotkey `R`. Cancel-by-genId pattern for worker invalidation.

**Tech Stack:** React 19, Next.js 16, Zustand, TypeScript strict, MapLibre GL JS, Vitest, packages/routing (isochrones), packages/game-engine-core.

**Spec reference:** [docs/superpowers/specs/2026-04-25-router-game-screen-design.md](../specs/2026-04-25-router-game-screen-design.md)

---

## Phase 1 — Move shared map-routing components

Goal: extract `RouteLayer.tsx` and `IsochroneLayer.tsx` from the simulator-specific directory to a shared location so both simu and play can import them. No behavior change.

### Task 1.1: Create shared directory and move files

**Files:**
- Move: `apps/web/src/app/dev/simulator/RouteLayer.tsx` → `apps/web/src/components/map/routing/RouteLayer.tsx`
- Move: `apps/web/src/app/dev/simulator/IsochroneLayer.tsx` → `apps/web/src/components/map/routing/IsochroneLayer.tsx`
- Modify: `apps/web/src/app/dev/simulator/DevSimulatorClient.tsx` (update imports)

- [ ] **Step 1: Create the directory**

```bash
mkdir -p apps/web/src/components/map/routing
```

- [ ] **Step 2: Move both files (preserve git history)**

```bash
git mv apps/web/src/app/dev/simulator/RouteLayer.tsx apps/web/src/components/map/routing/RouteLayer.tsx
git mv apps/web/src/app/dev/simulator/IsochroneLayer.tsx apps/web/src/components/map/routing/IsochroneLayer.tsx
```

- [ ] **Step 3: Update simulator imports**

In `apps/web/src/app/dev/simulator/DevSimulatorClient.tsx`, find the imports of `./RouteLayer` and `./IsochroneLayer` and update them to:

```ts
import RouteLayer from '@/components/map/routing/RouteLayer';
import IsochroneLayer from '@/components/map/routing/IsochroneLayer';
```

(Use whatever the current default-vs-named-export pattern is — keep matching it.)

- [ ] **Step 4: Verify the simulator still typechecks and renders**

Run:
```bash
pnpm --filter @nemo/web typecheck
```
Expected: 0 errors.

Then start the dev server and visit `/dev/simulator` to confirm the route + isochrone overlays still appear.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/map/routing apps/web/src/app/dev/simulator/DevSimulatorClient.tsx
git commit -m "refactor(map): move RouteLayer and IsochroneLayer to shared components/map/routing"
```

---

## Phase 2 — Store: panel + router slice + prog replace action

Goal: extend the panel store, create the router slice, and add a `replaceOrderQueue` action to the prog slice.

### Task 2.1: Add `'router'` to `PanelName` union

**Files:**
- Modify: `apps/web/src/lib/store/types.ts:100-104`

- [ ] **Step 1: Update the type**

In `apps/web/src/lib/store/types.ts`, find:
```ts
export type PanelName = 'ranking' | 'sails' | 'programming';
```

Change to:
```ts
export type PanelName = 'ranking' | 'sails' | 'programming' | 'router';
```

- [ ] **Step 2: Verify typecheck still passes**

```bash
pnpm --filter @nemo/web typecheck
```
Expected: 0 errors. (Existing callsites already accept any `PanelName`.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/store/types.ts
git commit -m "store(panel): add 'router' to PanelName union"
```

### Task 2.2: Define `RouterState` and `RouterActions` types

**Files:**
- Modify: `apps/web/src/lib/store/types.ts` (append router types)

- [ ] **Step 1: Append router types to types.ts**

At the bottom of `apps/web/src/lib/store/types.ts`, before the `GameStore` aggregator type, add:

```ts
import type { RoutePlan } from '@nemo/routing';

export type RouterPhase = 'idle' | 'placing' | 'calculating' | 'results';
export type RouterPreset = 'FAST' | 'BALANCED' | 'HIGHRES';

export interface RouterState {
  phase: RouterPhase;
  destination: { lat: number; lon: number } | null;
  preset: RouterPreset;
  coastDetection: boolean;
  coneHalfDeg: number;
  computedRoute: RoutePlan | null;
  error: string | null;
  /** Increments on every calculation start; results with stale id are dropped. */
  calcGenId: number;
}

export interface RouterActions {
  openRouter(): void;
  closeRouter(): void;
  enterPlacingMode(): void;
  exitPlacingMode(): void;
  setDestination(lat: number, lon: number): void;
  setRouterPreset(p: RouterPreset): void;
  setCoastDetection(v: boolean): void;
  setConeHalfDeg(deg: number): void;
  /** Returns the new calcGenId for the caller to track. */
  startRouterCalculation(): number;
  setRouteResult(plan: RoutePlan, genId: number): void;
  setRouteError(msg: string, genId: number): void;
  clearRoute(): void;
}
```

Then update the `GameStore` type to include `RouterState` (under a `router` key) and `RouterActions`. Find the existing aggregator (it's the type that uses all the slice states); add:
```ts
router: RouterState;
```
plus all action method signatures from `RouterActions`.

- [ ] **Step 2: Verify import path of `@nemo/routing`**

```bash
grep -l "@nemo/routing" apps/web/src
```
If not present, check what package alias `packages/routing` uses. Look at `packages/routing/package.json` for the `name` field. Adjust the import to the correct package name.

- [ ] **Step 3: Verify typecheck**

```bash
pnpm --filter @nemo/web typecheck
```
Expected: errors about missing `router` slice and missing actions in `useGameStore` — those will be fixed in the next task. Type definitions themselves should be valid.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/store/types.ts
git commit -m "store(router): add RouterState and RouterActions types"
```

### Task 2.3: Implement `routerSlice.ts` with TDD

**Files:**
- Create: `apps/web/src/lib/store/routerSlice.ts`
- Create: `apps/web/src/lib/store/routerSlice.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/lib/store/routerSlice.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useGameStore } from './index';

describe('routerSlice', () => {
  beforeEach(() => {
    useGameStore.setState((s) => ({
      router: {
        phase: 'idle',
        destination: null,
        preset: 'FAST',
        coastDetection: false,
        coneHalfDeg: 60,
        computedRoute: null,
        error: null,
        calcGenId: 0,
      },
      panel: { activePanel: null },
    }));
  });

  it('opens the router panel and sets activePanel', () => {
    useGameStore.getState().openRouter();
    expect(useGameStore.getState().panel.activePanel).toBe('router');
  });

  it('openRouter closes any other active panel and clears it on close', () => {
    useGameStore.getState().openPanel('sails');
    useGameStore.getState().openRouter();
    expect(useGameStore.getState().panel.activePanel).toBe('router');
    useGameStore.getState().closeRouter();
    expect(useGameStore.getState().panel.activePanel).toBe(null);
    expect(useGameStore.getState().router.computedRoute).toBe(null);
  });

  it('enterPlacingMode sets phase to placing', () => {
    useGameStore.getState().enterPlacingMode();
    expect(useGameStore.getState().router.phase).toBe('placing');
  });

  it('setDestination returns to idle and stores coords', () => {
    useGameStore.getState().enterPlacingMode();
    useGameStore.getState().setDestination(46.5, -4.2);
    const { phase, destination } = useGameStore.getState().router;
    expect(phase).toBe('idle');
    expect(destination).toEqual({ lat: 46.5, lon: -4.2 });
  });

  it('startRouterCalculation increments calcGenId and switches phase', () => {
    const genA = useGameStore.getState().startRouterCalculation();
    expect(useGameStore.getState().router.phase).toBe('calculating');
    expect(useGameStore.getState().router.calcGenId).toBe(genA);
    const genB = useGameStore.getState().startRouterCalculation();
    expect(genB).toBe(genA + 1);
  });

  it('setRouteResult only applies if genId matches current calcGenId', () => {
    const gen = useGameStore.getState().startRouterCalculation();
    useGameStore.getState().setRouteResult({} as never, gen);
    expect(useGameStore.getState().router.phase).toBe('results');

    // Stale result (lower genId) is ignored
    useGameStore.getState().startRouterCalculation();
    useGameStore.getState().setRouteResult({ stale: true } as never, gen);
    expect(useGameStore.getState().router.phase).toBe('calculating');
  });

  it('setRouteError applies only if genId matches', () => {
    const gen = useGameStore.getState().startRouterCalculation();
    useGameStore.getState().setRouteError('boom', gen);
    expect(useGameStore.getState().router.phase).toBe('idle');
    expect(useGameStore.getState().router.error).toBe('boom');
  });

  it('clearRoute removes computedRoute without changing phase or destination', () => {
    useGameStore.getState().setDestination(46, -4);
    const gen = useGameStore.getState().startRouterCalculation();
    useGameStore.getState().setRouteResult({} as never, gen);
    useGameStore.getState().clearRoute();
    expect(useGameStore.getState().router.computedRoute).toBe(null);
    expect(useGameStore.getState().router.destination).toEqual({ lat: 46, lon: -4 });
  });

  it('opening another panel closes router and clears its route', () => {
    useGameStore.getState().setDestination(46, -4);
    const gen = useGameStore.getState().startRouterCalculation();
    useGameStore.getState().setRouteResult({} as never, gen);
    useGameStore.getState().openRouter();
    useGameStore.getState().openPanel('sails');
    expect(useGameStore.getState().router.computedRoute).toBe(null);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
pnpm --filter @nemo/web test routerSlice
```
Expected: tests fail (routerSlice not implemented).

- [ ] **Step 3: Implement the slice**

Create `apps/web/src/lib/store/routerSlice.ts`:

```ts
'use client';
import type { GameStore, RouterState } from './types';
import type { RoutePlan } from '@nemo/routing';

export const INITIAL_ROUTER: RouterState = {
  phase: 'idle',
  destination: null,
  preset: 'FAST',
  coastDetection: false,
  coneHalfDeg: 60,
  computedRoute: null,
  error: null,
  calcGenId: 0,
};

export function createRouterSlice(
  set: (fn: (s: GameStore) => Partial<GameStore>) => void,
  get: () => GameStore,
) {
  return {
    router: INITIAL_ROUTER,

    openRouter: () =>
      set(() => ({ panel: { activePanel: 'router' } })),

    closeRouter: () =>
      set((s) => ({
        panel: { activePanel: s.panel.activePanel === 'router' ? null : s.panel.activePanel },
        router: { ...s.router, phase: 'idle', computedRoute: null, error: null, calcGenId: s.router.calcGenId + 1 },
      })),

    enterPlacingMode: () =>
      set((s) => ({ router: { ...s.router, phase: 'placing' } })),

    exitPlacingMode: () =>
      set((s) => ({ router: { ...s.router, phase: s.router.phase === 'placing' ? 'idle' : s.router.phase } })),

    setDestination: (lat: number, lon: number) =>
      set((s) => ({ router: { ...s.router, phase: 'idle', destination: { lat, lon }, computedRoute: null, error: null } })),

    setRouterPreset: (preset: RouterState['preset']) =>
      set((s) => ({ router: { ...s.router, preset, computedRoute: null } })),

    setCoastDetection: (coastDetection: boolean) =>
      set((s) => ({ router: { ...s.router, coastDetection, computedRoute: null } })),

    setConeHalfDeg: (coneHalfDeg: number) =>
      set((s) => ({ router: { ...s.router, coneHalfDeg, computedRoute: null } })),

    startRouterCalculation: (): number => {
      const next = get().router.calcGenId + 1;
      set((s) => ({ router: { ...s.router, phase: 'calculating', error: null, calcGenId: next } }));
      return next;
    },

    setRouteResult: (plan: RoutePlan, genId: number) =>
      set((s) => {
        if (s.router.calcGenId !== genId) return {}; // stale, drop
        return { router: { ...s.router, phase: 'results', computedRoute: plan } };
      }),

    setRouteError: (msg: string, genId: number) =>
      set((s) => {
        if (s.router.calcGenId !== genId) return {};
        return { router: { ...s.router, phase: 'idle', error: msg } };
      }),

    clearRoute: () =>
      set((s) => ({ router: { ...s.router, computedRoute: null, error: null } })),
  };
}
```

- [ ] **Step 4: Wire `openPanel` to clear router state when switching to another panel**

In `apps/web/src/lib/store/panelSlice.ts`, modify `openPanel` to clear the router when switching to a non-router panel:

```ts
openPanel: (p: PanelName) =>
  set((s) => {
    const closingRouter = s.panel.activePanel === 'router' && p !== 'router';
    return {
      panel: { activePanel: p },
      ...(closingRouter
        ? { router: { ...s.router, phase: 'idle', computedRoute: null, error: null, calcGenId: s.router.calcGenId + 1 } }
        : {}),
    };
  }),
```

- [ ] **Step 5: Register the slice in the store**

In `apps/web/src/lib/store/index.ts`, find the `useGameStore = create<GameStore>((set) => ({ ... }))` block. Update the create signature to also accept `get`:

```ts
export const useGameStore = create<GameStore>((set, get) => ({
  ...createHudSlice(set),
  ...createSailSlice(set),
  ...createMapSlice(set),
  ...createSelectionSlice(set),
  ...createTimelineSlice(set),
  ...createLayersSlice(set),
  ...createPanelSlice(set),
  ...createWeatherSlice(set),
  ...createConnectionSlice(set),
  ...createProgSlice(set),
  ...createPreviewSlice(set),
  ...createZonesSlice(set),
  ...createMapAppearanceSlice(set),
  ...createRouterSlice(set, get),  // NEW
  // ... existing standalone state and actions
}));
```

Add the import at top:
```ts
import { createRouterSlice } from './routerSlice';
```

- [ ] **Step 6: Run tests, verify they pass**

```bash
pnpm --filter @nemo/web test routerSlice
```
Expected: all tests pass.

- [ ] **Step 7: Verify typecheck**

```bash
pnpm --filter @nemo/web typecheck
```
Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/lib/store
git commit -m "store(router): add routerSlice with phase machine and genId invalidation"
```

### Task 2.4: Add `replaceOrderQueue` to progSlice

**Files:**
- Modify: `apps/web/src/lib/store/progSlice.ts`
- Modify: `apps/web/src/lib/store/types.ts` (add action signature to `GameStore`)
- Create: `apps/web/src/lib/store/progSlice.test.ts`

- [ ] **Step 1: Write failing test**

Create `apps/web/src/lib/store/progSlice.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useGameStore } from './index';
import type { OrderEntry } from './types';

const order = (id: string, type: OrderEntry['type'] = 'CAP'): OrderEntry => ({
  id, type, value: { cap: 0 }, trigger: { type: 'IMMEDIATE' }, label: id,
});

describe('progSlice', () => {
  beforeEach(() => {
    useGameStore.setState((s) => ({ prog: { orderQueue: [], serverQueue: [] } }));
  });

  it('replaceOrderQueue replaces all pending orders', () => {
    useGameStore.getState().addOrder(order('a'));
    useGameStore.getState().addOrder(order('b'));
    useGameStore.getState().replaceOrderQueue([order('x'), order('y'), order('z')]);
    const ids = useGameStore.getState().prog.orderQueue.map((o) => o.id);
    expect(ids).toEqual(['x', 'y', 'z']);
  });

  it('replaceOrderQueue leaves serverQueue untouched', () => {
    useGameStore.setState((s) => ({ prog: { orderQueue: [], serverQueue: [order('s1')] } }));
    useGameStore.getState().replaceOrderQueue([order('n1')]);
    expect(useGameStore.getState().prog.serverQueue.map((o) => o.id)).toEqual(['s1']);
  });
});
```

- [ ] **Step 2: Run, verify failure**

```bash
pnpm --filter @nemo/web test progSlice
```
Expected: fail (replaceOrderQueue is not a function).

- [ ] **Step 3: Implement**

In `apps/web/src/lib/store/progSlice.ts`, after `commitQueue`:

```ts
replaceOrderQueue: (orders: OrderEntry[]) =>
  set((s) => ({ prog: { ...s.prog, orderQueue: orders } })),
```

In `apps/web/src/lib/store/types.ts`, add to the `GameStore` aggregator:

```ts
replaceOrderQueue(orders: OrderEntry[]): void;
```

- [ ] **Step 4: Run tests pass**

```bash
pnpm --filter @nemo/web test progSlice
```
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/store
git commit -m "store(prog): add replaceOrderQueue action"
```

---

## Phase 3 — Engine: WPT order handling

Goal: the engine processes `WPT` orders by computing a great-circle bearing toward the waypoint each tick. When the boat enters the capture radius (default 0.5 nm), the order is consumed and the next active order applies.

### Task 3.1: Locate CAP/TWA processing in tick

**Files:**
- Read: `packages/game-engine-core/src/tick.ts`
- Read: `packages/game-engine-core/src/segments.ts` (or wherever `buildSegments` lives — find it)

- [ ] **Step 1: Find buildSegments**

```bash
grep -rn "function buildSegments" packages/game-engine-core/src
```

- [ ] **Step 2: Read it and identify how CAP / TWA orders set heading**

Read the file located in step 1. Find the per-segment heading computation. Note:
- Where the order's `value.cap` (CAP) or `value.twa` (TWA) is read
- Where heading is decided when no order exists vs when an order exists
- How `effectiveTs` is used for ordering

Document in your scratchpad: `CAP -> heading set to value.cap`, `TWA -> heading = twd + value.twa`, etc.

- [ ] **Step 3: No code change yet — just verify understanding before next task**

(No commit.)

### Task 3.2: Add WPT order handling to buildSegments — TDD

**Files:**
- Modify: `packages/game-engine-core/src/tick.ts` (or `segments.ts` based on Task 3.1)
- Create: `packages/game-engine-core/src/tick-wpt.test.ts` (or co-located)

- [ ] **Step 1: Write the failing test**

Create `packages/game-engine-core/src/tick-wpt.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { runTick } from './tick';
// import the BoatRuntime / TickDeps test helpers — locate the existing test
// helpers via: grep -rn "BoatRuntime" packages/game-engine-core/src --include="*.test.ts"

// Reuse whatever fixture helpers existing tests use. If none, build minimal:
import { makeRuntime, makeDeps } from './__test__/fixtures'; // adjust to actual path

describe('runTick — WPT order handling', () => {
  it('steers boat toward waypoint by setting heading to great-circle bearing', () => {
    const runtime = makeRuntime({
      position: { lat: 46.0, lon: -4.0 },
      heading: 0, // initially pointing north
      orderHistory: [
        {
          order: {
            id: 'wp1',
            type: 'WPT',
            value: { lat: 46.0, lon: -3.0 }, // due east
            trigger: { type: 'IMMEDIATE' },
          },
          effectiveTs: 0,
          // ... fill the rest of OrderEnvelope with test values
        } as never,
      ],
    });
    const tickStartMs = 1_000;
    const tickEndMs = 31_000;
    const out = runTick(runtime, makeDeps(), tickStartMs, tickEndMs);

    // Heading should be ~90° (east) since waypoint is due east
    expect(out.runtime.segmentState.heading).toBeGreaterThan(80);
    expect(out.runtime.segmentState.heading).toBeLessThan(100);
  });

  it('marks WPT order completed when boat enters capture radius', () => {
    const runtime = makeRuntime({
      position: { lat: 46.0, lon: -4.001 }, // ~ 0.05 nm from waypoint
      heading: 90,
      orderHistory: [
        {
          order: {
            id: 'wp1',
            type: 'WPT',
            value: { lat: 46.0, lon: -4.0, captureRadiusNm: 0.5 },
            trigger: { type: 'IMMEDIATE' },
          },
          effectiveTs: 0,
        } as never,
      ],
    });
    const out = runTick(runtime, makeDeps(), 1_000, 31_000);
    // The completed waypoint should no longer be in the active orderHistory
    // (depending on how the engine marks completed; verify via runtime.orderHistory)
    const stillActive = out.runtime.orderHistory.some((o) => o.order.id === 'wp1' && !o.order.completed);
    expect(stillActive).toBe(false);
  });
});
```

(Adjust fixture/import paths to match what exists. If fixtures don't exist, create minimal ones in `packages/game-engine-core/src/__test__/fixtures.ts`.)

- [ ] **Step 2: Run, verify failure**

```bash
pnpm --filter @nemo/game-engine-core test tick-wpt
```
Expected: fail (WPT not handled).

- [ ] **Step 3: Implement WPT handling in buildSegments**

In `tick.ts` (or `segments.ts`), within the per-segment heading determination logic — wherever CAP and TWA are processed — add a `case 'WPT':` that:

1. Reads `lat = order.value.lat`, `lon = order.value.lon`, `captureRadiusNm = order.value.captureRadiusNm ?? 0.5`
2. Computes great-circle bearing from current segment-start position to (lat, lon)
3. Uses that bearing as the segment's heading (same effect as CAP)
4. After the segment advances, if the new position is within `captureRadiusNm` of (lat, lon), mark the order completed (set `completed: true` on the order, or remove it from active orderHistory — match existing patterns).

Helper function (add to a utility module like `packages/game-engine-core/src/geo.ts` if not present):

```ts
const NM_PER_DEG_LAT = 60;

export function bearingDeg(from: { lat: number; lon: number }, to: { lat: number; lon: number }): number {
  const φ1 = (from.lat * Math.PI) / 180;
  const φ2 = (to.lat * Math.PI) / 180;
  const Δλ = ((to.lon - from.lon) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const θ = Math.atan2(y, x);
  return ((θ * 180) / Math.PI + 360) % 360;
}

export function distanceNm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const meanLat = ((a.lat + b.lat) / 2) * Math.PI / 180;
  const dLat = (b.lat - a.lat) * NM_PER_DEG_LAT;
  const dLon = (b.lon - a.lon) * NM_PER_DEG_LAT * Math.cos(meanLat);
  return Math.hypot(dLat, dLon);
}
```

(Check first if equivalents already exist via `grep -rn "bearingDeg\|distanceNm\|haversine" packages/game-engine-core/src` and reuse if so.)

- [ ] **Step 4: Run tests pass**

```bash
pnpm --filter @nemo/game-engine-core test tick-wpt
```
Expected: pass.

- [ ] **Step 5: Run full game-engine-core test suite to catch regressions**

```bash
pnpm --filter @nemo/game-engine-core test
```
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add packages/game-engine-core/src
git commit -m "engine(orders): add WPT order handling — bearing-to-waypoint with capture radius"
```

### Task 3.3: Server-side: ensure WPT envelope ingest works end-to-end

**Files:**
- Read: `apps/game-engine/src/engine/worker.ts` (or wherever orders are ingested server-side)
- Modify: any spot that whitelists order types

- [ ] **Step 1: Search for OrderType whitelist**

```bash
grep -rn "'CAP'\s*|\s*'TWA'\|order.type.*===" apps/game-engine/src apps/web/src/app/api --include="*.ts" | head -30
```

- [ ] **Step 2: Verify WPT is allowed**

If any guard rejects unknown types (e.g., `if (type !== 'CAP' && type !== 'TWA' ...)`), add `'WPT'`. If everything goes through `OrderType` (which already includes `WPT`), no change needed.

- [ ] **Step 3: Manual smoke test with engine running**

Start the local stack (`pnpm dev` per the project's dev runbook). In the browser console at `/play/[raceId]`, fire a manual WPT order via:

```js
window.__nemo?.sendOrder?.({ type: 'WPT', value: { lat: 46.5, lon: -4.5 }, trigger: { type: 'IMMEDIATE' } });
```

(If `__nemo` isn't exposed, do this from RouterPanel later in Phase 9 — the manual smoke is just a hint.)

If no code change happened in step 2, skip the commit. Otherwise:

```bash
git add apps/game-engine/src
git commit -m "engine(server): allow WPT orders through ingest"
```

---

## Phase 4 — Layout: Route button, hotkey, compact zoom

Goal: replace the rightStack zoom group with a compact zoom under the HUD, and add a "Route" action button.

### Task 4.1: Create `ZoomCompact.tsx`

**Files:**
- Create: `apps/web/src/components/play/ZoomCompact.tsx`
- Modify: `apps/web/src/app/play/[raceId]/page.module.css` (add `.zoomCompact` styles)

- [ ] **Step 1: Create the component**

Create `apps/web/src/components/play/ZoomCompact.tsx`:

```tsx
'use client';
import { Plus, Minus } from 'lucide-react';
import { useGameStore } from '@/lib/store';
import Tooltip from '@/components/ui/Tooltip';
import styles from '@/app/play/[raceId]/page.module.css';

export default function ZoomCompact(): React.ReactElement {
  const setMapView = useGameStore((s) => s.setMapView);
  const map = useGameStore((s) => s.map);
  return (
    <div className={styles.zoomCompact} role="group" aria-label="Zoom carte">
      <Tooltip text="Zoom +" position="left">
        <button
          type="button"
          className={styles.zoomCompactBtn}
          onClick={() => setMapView(map.center, Math.min(map.zoom + 1, 18))}
          aria-label="Zoomer"
        ><Plus size={14} strokeWidth={2.5} /></button>
      </Tooltip>
      <Tooltip text="Zoom −" position="left">
        <button
          type="button"
          className={styles.zoomCompactBtn}
          onClick={() => setMapView(map.center, Math.max(map.zoom - 1, 1))}
          aria-label="Dézoomer"
        ><Minus size={14} strokeWidth={2.5} /></button>
      </Tooltip>
    </div>
  );
}
```

- [ ] **Step 2: Add CSS**

Append to `apps/web/src/app/play/[raceId]/page.module.css`:

```css
/* ── Zoom compact (top-right under HUD) ──────────────────── */
.zoomCompact {
  position: absolute;
  top: 52px;
  right: 16px;
  z-index: 20;
  display: flex;
  flex-direction: column;
  border-radius: 4px;
  overflow: hidden;
  border: 1px solid rgba(245, 240, 232, 0.16);
  background: rgba(12, 20, 36, 0.88);
}
.zoomCompactBtn {
  width: 34px;
  height: 28px;
  background: transparent;
  border: none;
  color: #f5f0e8;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 150ms;
}
.zoomCompactBtn:hover { background: rgba(255, 255, 255, 0.06); }
.zoomCompactBtn + .zoomCompactBtn {
  border-top: 1px solid rgba(245, 240, 232, 0.16);
}

@media (max-width: 640px) {
  .zoomCompact { top: 50px; right: 8px; }
  .zoomCompactBtn { width: 30px; height: 26px; }
}
```

- [ ] **Step 3: Verify typecheck**

```bash
pnpm --filter @nemo/web typecheck
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/play/ZoomCompact.tsx apps/web/src/app/play/[raceId]/page.module.css
git commit -m "play(layout): add ZoomCompact under HUD"
```

### Task 4.2: Integrate Route button + ZoomCompact in PlayClient, remove rightStack zoom

**Files:**
- Modify: `apps/web/src/app/play/[raceId]/PlayClient.tsx`
- Modify: `apps/web/src/app/play/[raceId]/page.module.css` (remove obsolete zoom styles in rightStack)

- [ ] **Step 1: Remove the zoomGroup block from rightStack**

In `PlayClient.tsx`, find the block:
```tsx
<div className={styles.zoomGroup}>
  <Tooltip text="Zoom +" position="bottom">...</Tooltip>
  <Tooltip text="Zoom −" position="bottom">...</Tooltip>
</div>
```
Delete it entirely.

- [ ] **Step 2: Remove `Plus, Minus` from the lucide import (if not used elsewhere in PlayClient)**

Update the import at top of `PlayClient.tsx`:
```tsx
import { Trophy, Sailboat, Route, LocateFixed, MapPinned } from 'lucide-react';
```

(Add `MapPinned` for the new Route button. Remove `Plus, Minus`.)

- [ ] **Step 3: Add Route button to actionButtons**

After the "Centrer" button block in `PlayClient.tsx`:

```tsx
<Tooltip text="Routeur" shortcut="R" position="bottom">
  <button
    className={`${styles.actionBtn} ${activePanel === 'router' ? styles.actionBtnActive : ''}`}
    onClick={() => handlePanelToggle('router')}
    type="button"
  >
    <MapPinned size={18} strokeWidth={2} className={styles.actionBtnIcon} />
    <span>Route</span>
  </button>
</Tooltip>
```

- [ ] **Step 4: Update `handlePanelToggle` signature**

```tsx
const handlePanelToggle = (panel: 'ranking' | 'sails' | 'programming' | 'router') => {
  if (activePanel === panel) {
    useGameStore.getState().closePanel();
  } else {
    useGameStore.getState().openPanel(panel);
  }
};
```

- [ ] **Step 5: Add `<ZoomCompact />` inside the mapArea**

Just before the closing of the `mapArea` div, after `<CursorTooltip />`:

```tsx
{canInteract && <ZoomCompact />}
```

Add the import at top:
```tsx
import ZoomCompact from '@/components/play/ZoomCompact';
```

- [ ] **Step 6: Remove now-unused `.zoomGroup` and `.zoomBtn` CSS rules**

In `page.module.css`, delete the `.zoomGroup` and `.zoomBtn` blocks (lines around 101-120 and any media-query overrides — `grep -n "zoomBtn\|zoomGroup" page.module.css` to find them all).

- [ ] **Step 7: Run dev and verify**

```bash
pnpm --filter @nemo/web dev
```
Open `/play/<some-race-id>`:
- The bottom-right stack shows: Voiles, Prog., Centrer, **Route**, Compass.
- Top-right under HUD shows the new compact +/− zoom.
- The Route button is inactive (panel doesn't open yet — it has no content yet, but `activePanel` toggles).

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/app/play/[raceId]/PlayClient.tsx apps/web/src/app/play/[raceId]/page.module.css
git commit -m "play(layout): add Route button to rightStack, move zoom to compact under HUD"
```

### Task 4.3: Add `R` hotkey

**Files:**
- Modify: `apps/web/src/lib/useHotkeys.ts`

- [ ] **Step 1: Add R case**

In the keydown switch, after the `'p'` / `'P'` case:

```ts
case 'r':
case 'R': {
  e.preventDefault();
  if (store.panel.activePanel === 'router') store.closePanel();
  else store.openPanel('router');
  break;
}
```

(Match the formatting style of the other cases.)

- [ ] **Step 2: Manual verify**

Reload the page at `/play/<race>`. Press `R`. The router panel toggle (currently empty) should activate visually (the button turns gold via `actionBtnActive` class).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/useHotkeys.ts
git commit -m "play(hotkeys): add R shortcut to toggle router panel"
```

---

## Phase 5 — RouterPanel UI components

Goal: build the 4-state panel UI (idle/placing/calculating/results) and its sub-components.

### Task 5.1: `RouterControls.tsx` — preset/coast/cone

**Files:**
- Create: `apps/web/src/components/play/RouterControls.tsx`
- Create: `apps/web/src/components/play/RouterControls.module.css`

- [ ] **Step 1: Create the component**

Create `apps/web/src/components/play/RouterControls.tsx`:

```tsx
'use client';
import { useGameStore } from '@/lib/store';
import styles from './RouterControls.module.css';

const PRESETS: Array<{ value: 'FAST' | 'BALANCED' | 'HIGHRES'; label: string }> = [
  { value: 'FAST', label: 'FAST' },
  { value: 'BALANCED', label: 'EQUIL.' },
  { value: 'HIGHRES', label: 'HI-RES' },
];

interface Props {
  disabled: boolean;
}

export default function RouterControls({ disabled }: Props): React.ReactElement {
  const preset = useGameStore((s) => s.router.preset);
  const coast = useGameStore((s) => s.router.coastDetection);
  const cone = useGameStore((s) => s.router.coneHalfDeg);
  const setPreset = useGameStore((s) => s.setRouterPreset);
  const setCoast = useGameStore((s) => s.setCoastDetection);
  const setCone = useGameStore((s) => s.setConeHalfDeg);

  return (
    <div className={styles.controls} aria-disabled={disabled}>
      <div className={styles.label}>Configuration</div>

      <div className={styles.presetRow}>
        {PRESETS.map((p) => (
          <button
            key={p.value}
            type="button"
            disabled={disabled}
            className={`${styles.presetBtn} ${preset === p.value ? styles.presetActive : ''}`}
            onClick={() => setPreset(p.value)}
          >{p.label}</button>
        ))}
      </div>

      <label className={styles.toggle}>
        <input
          type="checkbox"
          disabled={disabled}
          checked={coast}
          onChange={(e) => setCoast(e.target.checked)}
        />
        <span>Détection des côtes</span>
      </label>

      <div className={styles.coneRow}>
        <span>Cône <strong>{cone}°</strong> (demi-angle)</span>
        <input
          type="range"
          min={30}
          max={180}
          step={5}
          disabled={disabled}
          value={cone}
          onChange={(e) => setCone(Number(e.target.value))}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create CSS**

Create `apps/web/src/components/play/RouterControls.module.css`:

```css
.controls {
  border-top: 1px solid rgba(245, 240, 232, 0.1);
  padding-top: 12px;
  margin-top: 14px;
  font-family: var(--font-mono);
  color: #f5f0e8;
  font-size: 11px;
}
.controls[aria-disabled='true'] { opacity: 0.5; pointer-events: none; }
.label {
  color: #8fa8c8;
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  margin-bottom: 8px;
}
.presetRow { display: flex; gap: 4px; margin-bottom: 10px; }
.presetBtn {
  flex: 1;
  background: transparent;
  color: #8fa8c8;
  border: 1px solid rgba(245, 240, 232, 0.16);
  border-radius: 3px;
  padding: 6px;
  font-family: var(--font-mono);
  font-size: 9px;
  cursor: pointer;
}
.presetActive { background: #c9a227; color: #1a2840; border-color: #c9a227; font-weight: 700; }
.toggle { display: flex; align-items: center; gap: 6px; color: #8fa8c8; margin-bottom: 8px; }
.coneRow { display: flex; flex-direction: column; gap: 4px; color: #8fa8c8; }
.coneRow input[type='range'] { width: 100%; }
```

- [ ] **Step 3: Verify typecheck**

```bash
pnpm --filter @nemo/web typecheck
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/play/RouterControls.tsx apps/web/src/components/play/RouterControls.module.css
git commit -m "play(router): add RouterControls component (preset/coast/cone)"
```

### Task 5.2: `RouterPanel.tsx` — main slide-out content

**Files:**
- Create: `apps/web/src/components/play/RouterPanel.tsx`
- Create: `apps/web/src/components/play/RouterPanel.module.css`

- [ ] **Step 1: Create the panel**

Create `apps/web/src/components/play/RouterPanel.tsx`:

```tsx
'use client';
import { useGameStore } from '@/lib/store';
import RouterControls from './RouterControls';
import styles from './RouterPanel.module.css';

export default function RouterPanel({
  onApply,
}: {
  onApply: (mode: 'WAYPOINTS' | 'CAP') => void;
}): React.ReactElement {
  const phase = useGameStore((s) => s.router.phase);
  const dest = useGameStore((s) => s.router.destination);
  const route = useGameStore((s) => s.router.computedRoute);
  const error = useGameStore((s) => s.router.error);
  const lat = useGameStore((s) => s.hud.lat);
  const lon = useGameStore((s) => s.hud.lon);
  const decodedGrid = useGameStore((s) => s.weather.decodedGrid);
  const isGridLoaded = decodedGrid !== null;

  const enterPlacing = useGameStore((s) => s.enterPlacingMode);
  const exitPlacing = useGameStore((s) => s.exitPlacingMode);

  const canRoute = dest !== null && phase === 'idle' && isGridLoaded;

  return (
    <div className={styles.panel}>
      {/* DEPART (auto = boat position) */}
      <section className={styles.section}>
        <div className={styles.label}>Point de départ</div>
        <div className={styles.coords}>
          ⚓ Position bateau<br />
          <span className={styles.subCoords}>
            {lat?.toFixed(2)}°{lat && lat >= 0 ? 'N' : 'S'} ·{' '}
            {lon?.toFixed(2)}°{lon && lon >= 0 ? 'E' : 'W'}
          </span>
        </div>
      </section>

      {/* ARRIVAL */}
      <section className={styles.section}>
        <div className={styles.label}>Point d'arrivée</div>
        {phase === 'placing' ? (
          <div className={styles.placingHint}>
            <div className={styles.placingIcon}>📍</div>
            <div>Cliquez (ou tapez) sur la carte<br />pour placer l'arrivée</div>
            <button type="button" className={styles.cancelBtn} onClick={exitPlacing}>
              Annuler
            </button>
          </div>
        ) : dest ? (
          <button type="button" className={styles.destBtn} onClick={enterPlacing}>
            📍 {dest.lat.toFixed(2)}° · {dest.lon.toFixed(2)}°
            <span className={styles.changeHint}>Changer</span>
          </button>
        ) : (
          <button type="button" className={styles.placeBtn} onClick={enterPlacing}>
            + Définir le point d'arrivée
          </button>
        )}
      </section>

      <RouterControls disabled={phase === 'placing' || phase === 'calculating'} />

      {/* PRIMARY ACTIONS depending on phase */}
      {phase === 'calculating' && (
        <section className={styles.calculating}>
          <div className={styles.spinner} />
          <div className={styles.calcLabel}>CALCUL EN COURS…</div>
          <div className={styles.calcSub}>Fermer le panneau pour annuler</div>
        </section>
      )}

      {phase === 'results' && route && <ResultsBlock plan={route} onApply={onApply} />}

      {phase === 'idle' && (
        <RouteButton canRoute={canRoute} isGridLoaded={isGridLoaded} />
      )}

      {error && <div className={styles.error}>{error}</div>}
    </div>
  );
}

function RouteButton({ canRoute, isGridLoaded }: { canRoute: boolean; isGridLoaded: boolean }): React.ReactElement {
  // The actual click is wired in PlayClient (worker invocation lives there);
  // here we only display a disabled-state stub that PlayClient overrides via context
  // — but to keep this file self-contained, dispatch via a custom event listened by PlayClient.
  return (
    <button
      type="button"
      className={`${styles.routeBtn} ${!canRoute ? styles.routeBtnDisabled : ''}`}
      disabled={!canRoute}
      onClick={() => window.dispatchEvent(new CustomEvent('nemo:router:route'))}
    >
      ROUTER
      {!isGridLoaded && <div className={styles.routeBtnSub}>Météo en chargement…</div>}
    </button>
  );
}

function ResultsBlock({
  plan,
  onApply,
}: {
  plan: import('@nemo/routing').RoutePlan;
  onApply: (mode: 'WAYPOINTS' | 'CAP') => void;
}): React.ReactElement {
  const totalNm = plan.totalDistanceNm.toFixed(0);
  const etaH = Math.floor(plan.eta / 3600);
  const etaM = Math.floor((plan.eta % 3600) / 60);
  return (
    <section className={styles.results}>
      <div className={styles.resultsHead}>✓ ROUTE CALCULÉE</div>
      <div className={styles.resultsGrid}>
        <div><span className={styles.metricLabel}>Distance</span><br /><strong>{totalNm} nm</strong></div>
        <div><span className={styles.metricLabel}>ETA</span><br /><strong>+{etaH}h {etaM}m</strong></div>
        <div><span className={styles.metricLabel}>Calcul</span><br /><strong>{(plan.computeTimeMs / 1000).toFixed(1)}s</strong></div>
        <div><span className={styles.metricLabel}>Manœuvres</span><br /><strong>{plan.capSchedule.length}</strong></div>
      </div>
      {!plan.reachedGoal && (
        <div className={styles.warning}>⚠ Route incomplète : météo limitée à J+7</div>
      )}
      <button type="button" className={styles.applyPrimary} onClick={() => onApply('WAYPOINTS')}>
        → WAYPOINTS (auto-voile)
      </button>
      <button type="button" className={styles.applySecondary} onClick={() => onApply('CAP')}>
        → CAP SCHEDULE (auto-voile)
      </button>
      <button
        type="button"
        className={styles.recalc}
        onClick={() => window.dispatchEvent(new CustomEvent('nemo:router:route'))}
      >↺ Recalculer</button>
    </section>
  );
}
```

- [ ] **Step 2: Create CSS**

Create `apps/web/src/components/play/RouterPanel.module.css`:

```css
.panel { padding: 14px; color: #f5f0e8; font-family: sans-serif; font-size: 11px; }
.section { margin-bottom: 14px; }
.label {
  color: #8fa8c8;
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  margin-bottom: 6px;
}
.coords {
  background: rgba(255, 255, 255, 0.04);
  border-radius: 3px;
  padding: 8px;
  font-family: var(--font-mono);
  font-size: 10px;
  color: #c9a227;
}
.subCoords { color: #8fa8c8; font-size: 9px; }
.placeBtn, .destBtn {
  width: 100%;
  background: #1a3a5c;
  border: 1px dashed #c9a22788;
  color: #c9a227;
  border-radius: 3px;
  padding: 10px;
  font-family: var(--font-mono);
  font-size: 10px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}
.changeHint { color: #8fa8c8; font-size: 9px; }
.placingHint {
  background: rgba(201, 162, 39, 0.1);
  border: 1px solid #c9a22788;
  border-radius: 3px;
  padding: 14px;
  text-align: center;
  color: #c9a227;
  font-family: var(--font-mono);
  font-size: 10px;
}
.placingIcon { font-size: 24px; margin-bottom: 6px; }
.cancelBtn {
  margin-top: 10px;
  background: transparent;
  border: 1px solid #8fa8c8;
  color: #8fa8c8;
  border-radius: 3px;
  padding: 4px 10px;
  cursor: pointer;
  font-family: var(--font-mono);
  font-size: 9px;
}
.calculating {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 20px 0;
  color: #c9a227;
}
.spinner {
  width: 42px;
  height: 42px;
  border: 3px solid rgba(201, 162, 39, 0.2);
  border-top-color: #c9a227;
  border-radius: 50%;
  animation: nemo-spin 1s linear infinite;
  margin-bottom: 14px;
}
@keyframes nemo-spin { to { transform: rotate(360deg); } }
.calcLabel { font-family: var(--font-mono); font-size: 11px; font-weight: 700; letter-spacing: 0.1em; }
.calcSub { color: #8fa8c8; font-size: 10px; margin-top: 4px; }
.routeBtn {
  width: 100%;
  background: #c9a227;
  color: #1a2840;
  border: none;
  border-radius: 3px;
  padding: 10px;
  font-family: var(--font-mono);
  font-weight: 700;
  font-size: 11px;
  letter-spacing: 0.1em;
  cursor: pointer;
}
.routeBtnDisabled { background: rgba(255, 255, 255, 0.04); color: #5c6b80; cursor: not-allowed; }
.routeBtnSub { font-size: 9px; font-weight: 400; margin-top: 4px; }
.error {
  margin-top: 10px;
  background: rgba(220, 70, 70, 0.1);
  border: 1px solid rgba(220, 70, 70, 0.4);
  border-radius: 3px;
  padding: 8px;
  color: #f08585;
  font-size: 10px;
}
.results {
  background: rgba(50, 180, 100, 0.06);
  border: 1px solid rgba(50, 180, 100, 0.4);
  border-radius: 3px;
  padding: 12px;
}
.resultsHead { color: #5cc88c; font-family: var(--font-mono); font-size: 9px; font-weight: 700; letter-spacing: 0.1em; margin-bottom: 8px; }
.resultsGrid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; font-family: var(--font-mono); font-size: 10px; margin-bottom: 10px; }
.metricLabel { color: #8fa8c8; }
.warning {
  background: rgba(240, 180, 50, 0.1);
  border: 1px solid rgba(240, 180, 50, 0.4);
  color: #ddc270;
  border-radius: 3px;
  padding: 6px;
  font-size: 10px;
  margin-bottom: 10px;
}
.applyPrimary, .applySecondary, .recalc {
  width: 100%;
  border-radius: 3px;
  padding: 9px;
  font-family: var(--font-mono);
  font-weight: 700;
  font-size: 10px;
  letter-spacing: 0.1em;
  cursor: pointer;
  margin-bottom: 6px;
}
.applyPrimary { background: #c9a227; color: #1a2840; border: none; }
.applySecondary { background: transparent; color: #c9a227; border: 1px solid #c9a227; }
.recalc { background: transparent; color: #8fa8c8; border: 1px solid rgba(245, 240, 232, 0.16); }
```

- [ ] **Step 3: Verify typecheck**

```bash
pnpm --filter @nemo/web typecheck
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/play/RouterPanel.tsx apps/web/src/components/play/RouterPanel.module.css
git commit -m "play(router): add RouterPanel with idle/placing/calculating/results states"
```

### Task 5.3: Wire `<SlidePanel>` + `<RouterPanel>` in `PlayClient.tsx`

**Files:**
- Modify: `apps/web/src/app/play/[raceId]/PlayClient.tsx`

- [ ] **Step 1: Import**

```tsx
import RouterPanel from '@/components/play/RouterPanel';
```

- [ ] **Step 2: Add SlidePanel inside the canInteract block**

Inside the `canInteract && (<>...</>)` group near the existing SlidePanel for "Voiles"/"Programmation":

```tsx
<SlidePanel
  side="right"
  width={420}
  title="Routeur"
  isOpen={activePanel === 'router'}
  onClose={() => useGameStore.getState().closeRouter()}
>
  <RouterPanel onApply={(mode) => { /* wired in Phase 9 */ }} />
</SlidePanel>
```

- [ ] **Step 3: Run dev, verify panel toggles**

```bash
pnpm --filter @nemo/web dev
```
Visit `/play/<race>`. Press R or click the Route button. The panel should slide in showing the idle UI: depart auto, "Définir l'arrivée", config controls, disabled "ROUTER" button.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/play/[raceId]/PlayClient.tsx
git commit -m "play(router): wire RouterPanel in SlidePanel inside PlayClient"
```

---

## Phase 6 — Map: placing mode click capture

Goal: when `routerPhase === 'placing'`, intercept map clicks to set the destination, with a CSS crosshair (desktop) and a top-of-map indicator (mobile + desktop).

### Task 6.1: Click handler + cursor in `MapCanvas.tsx`

**Files:**
- Modify: `apps/web/src/components/play/MapCanvas.tsx`
- Modify: `apps/web/src/app/play/[raceId]/page.module.css`

- [ ] **Step 1: Read MapCanvas to find the existing `map` instance reference**

```bash
grep -n "mapInstance\|map.on(" apps/web/src/components/play/MapCanvas.tsx | head -20
```

- [ ] **Step 2: Add click handler effect**

In `MapCanvas.tsx`, near the other `map.on()` registrations, add:

```tsx
const routerPhase = useGameStore((s) => s.router.phase);
const setDestination = useGameStore((s) => s.setDestination);

useEffect(() => {
  const map = (window as unknown as { mapInstance?: maplibregl.Map }).mapInstance;
  if (!map) return;
  if (routerPhase !== 'placing') return;

  const handleMapClick = (e: maplibregl.MapMouseEvent) => {
    setDestination(e.lngLat.lat, e.lngLat.lng);
  };
  map.on('click', handleMapClick);
  return () => { map.off('click', handleMapClick); };
}, [routerPhase, setDestination]);
```

(Adjust the `mapInstance` access pattern to whatever the file currently uses — `useRef`, global, etc.)

- [ ] **Step 3: Cursor + top indicator CSS**

In `page.module.css`, add:

```css
.mapAreaPlacing { cursor: crosshair; }

.placingIndicator {
  position: absolute;
  top: 52px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 25;
  background: rgba(201, 162, 39, 0.95);
  color: #1a2840;
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  padding: 6px 14px;
  border-radius: 4px;
  pointer-events: none;
}
@media (max-width: 640px) {
  .placingIndicator { top: 50px; font-size: 10px; padding: 5px 10px; }
}
```

- [ ] **Step 4: Apply class + render indicator in PlayClient**

In `PlayClient.tsx`:

```tsx
const routerPhase = useGameStore((s) => s.router.phase);
```

Apply class to the mapArea div:
```tsx
<div className={`${styles.mapArea} ${routerPhase === 'placing' ? styles.mapAreaPlacing : ''}`}>
```

Add the indicator inside `mapArea`:
```tsx
{routerPhase === 'placing' && (
  <div className={styles.placingIndicator}>CLIQUEZ POUR PLACER L'ARRIVÉE</div>
)}
```

- [ ] **Step 5: Manual verify**

Reload `/play/<race>`. Open router (R), click "Définir l'arrivée". Cursor changes to crosshair, banner appears. Click anywhere on the water — destination is recorded, panel returns to idle showing the coords.

- [ ] **Step 6: Mobile manual verify**

In Chrome DevTools, switch to a touch device profile. Open router, tap "Définir l'arrivée". Tap on the map. Confirm the destination is recorded.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/play/MapCanvas.tsx apps/web/src/app/play/[raceId]/PlayClient.tsx apps/web/src/app/play/[raceId]/page.module.css
git commit -m "play(router): intercept map clicks in placing mode with crosshair + banner"
```

---

## Phase 7 — Worker integration in PlayClient

Goal: wire the routing worker to the router state. Click "ROUTER" → start calc → display result. Closing the panel cancels via genId.

### Task 7.1: Reuse the routing worker via a small client helper

**Files:**
- Create: `apps/web/src/lib/routing/client.ts`

- [ ] **Step 1: Read DevSimulatorClient's existing pattern**

```bash
grep -n "getRoutingWorker\|routingPendingRef" apps/web/src/app/dev/simulator/DevSimulatorClient.tsx
```
And check if there is already a shared `getRoutingWorker()` function somewhere:
```bash
grep -rn "getRoutingWorker" apps/web/src
```

If no shared module exists, extract one. If there is one, use it directly.

- [ ] **Step 2: Create or reuse client**

If no shared client exists, create `apps/web/src/lib/routing/client.ts`:

```ts
'use client';
import type { RouteInput, RoutePlan } from '@nemo/routing';

let worker: Worker | null = null;
let nextReqId = 1;
const pending = new Map<number, { resolve: (p: RoutePlan) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('@/workers/routing.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<{ type: 'result' | 'error'; requestId: number; plan?: RoutePlan; message?: string }>) => {
    const { type, requestId } = e.data;
    const handler = pending.get(requestId);
    if (!handler) return;
    pending.delete(requestId);
    if (type === 'result' && e.data.plan) handler.resolve(e.data.plan);
    else handler.reject(new Error(e.data.message || 'Unknown router error'));
  };
  worker.onerror = (e) => {
    for (const h of pending.values()) h.reject(new Error(e.message || 'Worker crashed'));
    pending.clear();
  };
  return worker;
}

export function computeRoute(input: RouteInput, gameBalanceJson: unknown): Promise<RoutePlan> {
  const w = getWorker();
  const requestId = nextReqId++;
  return new Promise((resolve, reject) => {
    pending.set(requestId, { resolve, reject });
    w.postMessage({ type: 'compute', requestId, input, gameBalanceJson });
  });
}
```

- [ ] **Step 3: Update DevSimulatorClient to use the shared helper (optional refactor — only if Phase 1's task left this scattered)**

(Skip if simulator already uses a shared module from earlier exploration. Otherwise plan a separate refactor commit.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/routing/client.ts
git commit -m "routing: extract shared computeRoute client helper"
```

### Task 7.2: Wire the route invocation in PlayClient

**Files:**
- Modify: `apps/web/src/app/play/[raceId]/PlayClient.tsx`

- [ ] **Step 1: Add the `nemo:router:route` listener**

In `PlayClient.tsx`, add a useEffect:

```tsx
import { computeRoute } from '@/lib/routing/client';
import { GameBalance } from '@nemo/game-balance/browser';
import { getCachedPolar } from '@/lib/polar';

const decodedGrid = useGameStore((s) => s.weather.decodedGrid);
const prevDecodedGrid = useGameStore((s) => s.weather.prevDecodedGrid);
const boatClass = useGameStore((s) => s.hud.boatClass);

useEffect(() => {
  const onRoute = async () => {
    const state = useGameStore.getState();
    const dest = state.router.destination;
    const polar = boatClass ? getCachedPolar(boatClass) : null;
    if (!dest || !decodedGrid || !polar) return;

    const genId = state.startRouterCalculation();

    try {
      const input = {
        start: { lat: state.hud.lat, lon: state.hud.lon },
        end: { lat: dest.lat, lon: dest.lon },
        boatClass: state.hud.boatClass,
        polar,
        loadout: { items: [] },                        // TODO Task 7.3
        condition: state.hud.wearGlobal ?? 1.0,        // TODO Task 7.3
        startTimeMs: Date.now(),
        windGrid: decodedGrid,
        prevWindGrid: prevDecodedGrid ?? undefined,
        coastline: state.router.coastDetection ? undefined : undefined, // Task 7.3
        coastDetection: state.router.coastDetection,
        coneHalfDeg: state.router.coneHalfDeg,
        preset: state.router.preset,
      };
      const plan = await computeRoute(input as never, GameBalance.json);
      state.setRouteResult(plan, genId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur de calcul';
      state.setRouteError(msg, genId);
    }
  };
  window.addEventListener('nemo:router:route', onRoute);
  return () => window.removeEventListener('nemo:router:route', onRoute);
}, [decodedGrid, prevDecodedGrid, boatClass]);
```

- [ ] **Step 2: Run dev, verify the calc flow**

Reload `/play/<race>`. Open router. Place a destination. Click "ROUTER". Expect:
- Phase switches to `calculating` (panel shows spinner)
- 1-30s later (depending on preset), phase = `results` and the results card renders with distance/ETA
- Close panel → state returns to idle, computedRoute null

- [ ] **Step 3: Verify cancel-on-close**

Open router, place dest, click "ROUTER", **close panel mid-calc**. The worker still completes but the result is dropped (genId mismatch). Reopen — no stale results.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/play/[raceId]/PlayClient.tsx
git commit -m "play(router): wire computeRoute invocation with genId invalidation"
```

### Task 7.3: Polish RouteInput — proper loadout, condition, coastline

**Files:**
- Modify: `apps/web/src/app/play/[raceId]/PlayClient.tsx`

- [ ] **Step 1: Locate how the projection worker assembles the same RouteInput**

```bash
grep -n "RouteInput\|projection.worker" apps/web/src/app/play/[raceId]/PlayClient.tsx apps/web/src/hooks
```
Read whatever code currently builds the input for the 7-day projection — those fields (loadout, condition, coastline) are exactly what the router needs.

- [ ] **Step 2: Mirror that input assembly**

Replace the placeholder fields in the `nemo:router:route` listener with the same logic as the projection. Specifically:
- `loadout`: from `state.hud.loadout` (or wherever the boat's loadout is stored)
- `condition`: from `state.hud.wearGlobal` or whatever the projection uses
- `coastline`: load via `loadCoastline()` if `coastDetection` is true (mirror the simulator)

- [ ] **Step 3: Run, verify computed route is realistic**

Compare the route on `/play/<race>` to the same destination on `/dev/simulator` for the same boat — ETA and distance should match within seconds.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/play/[raceId]/PlayClient.tsx
git commit -m "play(router): align RouteInput with simulator (loadout, condition, coastline)"
```

---

## Phase 8 — Map layers: render route + isochrones + destination

Goal: when phase is `'results'`, render `<IsochroneLayer>` + `<RouteLayer>` + `<RouterDestinationMarker>`. When phase is `'idle'` (with dest) or `'placing'`, render only `<RouterDestinationMarker>`.

### Task 8.1: `RouterDestinationMarker.tsx`

**Files:**
- Create: `apps/web/src/components/map/routing/RouterDestinationMarker.tsx`

- [ ] **Step 1: Create the component**

```tsx
'use client';
import { useEffect } from 'react';

const SOURCE_ID = 'router-destination';
const LAYER_ID = 'router-destination-circle';

export default function RouterDestinationMarker({
  lat, lon,
}: { lat: number | null; lon: number | null }): null {
  useEffect(() => {
    const map = (window as unknown as { mapInstance?: maplibregl.Map }).mapInstance;
    if (!map) return;

    const ensure = () => {
      if (lat == null || lon == null) {
        if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
        if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
        return;
      }
      const data = {
        type: 'FeatureCollection' as const,
        features: [{
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [lon, lat] },
          properties: {},
        }],
      };
      const src = map.getSource(SOURCE_ID);
      if (src && 'setData' in src) (src as { setData: (d: typeof data) => void }).setData(data);
      else {
        map.addSource(SOURCE_ID, { type: 'geojson', data });
        map.addLayer({
          id: LAYER_ID,
          source: SOURCE_ID,
          type: 'circle',
          paint: {
            'circle-radius': 8,
            'circle-color': '#dc4646',
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 2,
          },
        });
      }
    };

    if (map.isStyleLoaded()) ensure();
    else map.once('styledata', ensure);

    return () => {
      if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
    };
  }, [lat, lon]);

  return null;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/map/routing/RouterDestinationMarker.tsx
git commit -m "play(router): add RouterDestinationMarker map layer"
```

### Task 8.2: Mount layers in `PlayClient.tsx`

**Files:**
- Modify: `apps/web/src/app/play/[raceId]/PlayClient.tsx`

- [ ] **Step 1: Import**

```tsx
import RouteLayer from '@/components/map/routing/RouteLayer';
import IsochroneLayer from '@/components/map/routing/IsochroneLayer';
import RouterDestinationMarker from '@/components/map/routing/RouterDestinationMarker';
```

- [ ] **Step 2: Read the router state in render**

```tsx
const routerDest = useGameStore((s) => s.router.destination);
const routerRoute = useGameStore((s) => s.router.computedRoute);
const routerPanelOpen = activePanel === 'router';
```

- [ ] **Step 3: Conditionally render layers inside the mapArea**

After `<MapCanvas />` and the existing overlays, before the right stack:

```tsx
{routerPanelOpen && routerDest && (
  <RouterDestinationMarker lat={routerDest.lat} lon={routerDest.lon} />
)}
{routerPanelOpen && routerRoute && (
  <>
    <IsochroneLayer plan={routerRoute} color="#3a9fff" />
    <RouteLayer
      routes={new Map([['user', routerRoute]])}
      primaryId="user"
      colorFor={() => '#c9a227'}
      nextGfsRunMs={Number.MAX_SAFE_INTEGER}
    />
  </>
)}
```

(`nextGfsRunMs` set to MAX makes the entire route render as "fresh" — no split. If you want the split, pass the actual next GFS run timestamp from `decodedGrid.header.nextRunExpectedUtc * 1000`.)

- [ ] **Step 4: Manual verify**

Reload `/play/<race>`. Open router, place dest, route. Expect: red destination marker visible from when dest is placed; once route is calculated, isochrones (translucent blue rings) + golden polyline appear overlaid on the map. Close panel → all overlays disappear.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/play/[raceId]/PlayClient.tsx
git commit -m "play(router): render route + isochrones + destination marker on map"
```

---

## Phase 9 — Apply route as programming

Goal: implement the two apply modes (CAP schedule, Waypoints) with confirmation modal, replace the local orderQueue, and send orders.

### Task 9.1: Conversion functions — TDD

**Files:**
- Create: `apps/web/src/lib/routing/applyRoute.ts`
- Create: `apps/web/src/lib/routing/applyRoute.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { capScheduleToOrders, waypointsToOrders } from './applyRoute';
import type { RoutePlan } from '@nemo/routing';

const baseTs = 1_000_000_000_000;

const fakePlan = (): RoutePlan => ({
  reachedGoal: true,
  polyline: [],
  waypoints: [
    { lat: 46, lon: -4, timeMs: 0, twa: 60, tws: 15, bsp: 8, sail: 'M0' },
    { lat: 46.5, lon: -3.5, timeMs: 3_600_000, twa: 70, tws: 14, bsp: 7.5, sail: 'M0' },
    { lat: 47, lon: -3, timeMs: 7_200_000, twa: 100, tws: 12, bsp: 6, sail: 'C0' },
  ],
  capSchedule: [
    { triggerMs: 0, cap: 60, sail: 'M0' },
    { triggerMs: 3_600_000, cap: 70, sail: 'M0' },
    { triggerMs: 7_200_000, cap: 90, twaLock: 50, sail: 'C0' },
  ],
  isochrones: [],
  totalDistanceNm: 100,
  eta: 7_200,
  computeTimeMs: 1_200,
});

describe('capScheduleToOrders', () => {
  it('emits MODE(auto:true) first, then CAP/TWA/SAIL orders triggered by AT_TIME', () => {
    const orders = capScheduleToOrders(fakePlan(), baseTs);
    expect(orders[0]?.type).toBe('MODE');
    expect(orders[0]?.value).toEqual({ auto: true });
    expect(orders.some((o) => o.type === 'CAP' && o.value['cap'] === 60)).toBe(true);
    expect(orders.some((o) => o.type === 'TWA' && o.value['twa'] === 50)).toBe(true);
  });

  it('emits SAIL orders when sail changes', () => {
    const orders = capScheduleToOrders(fakePlan(), baseTs);
    const sails = orders.filter((o) => o.type === 'SAIL');
    expect(sails.length).toBeGreaterThanOrEqual(2); // at least M0 then C0
  });
});

describe('waypointsToOrders', () => {
  it('emits MODE(auto:true) first then a WPT order per inflection waypoint (skipping first = boat pos)', () => {
    const orders = waypointsToOrders(fakePlan(), baseTs);
    expect(orders[0]?.type).toBe('MODE');
    const wpts = orders.filter((o) => o.type === 'WPT');
    // Plan has 3 waypoints, first is start; expect 2 WPT orders
    expect(wpts.length).toBe(2);
    expect(wpts[0]?.value['lat']).toBe(46.5);
  });

  it('chains WPT orders via AT_WAYPOINT trigger', () => {
    const orders = waypointsToOrders(fakePlan(), baseTs);
    const wpts = orders.filter((o) => o.type === 'WPT');
    expect(wpts[0]?.trigger).toEqual({ type: 'IMMEDIATE' });
    expect(wpts[1]?.trigger.type).toBe('AT_WAYPOINT');
  });
});
```

- [ ] **Step 2: Run, verify failure**

```bash
pnpm --filter @nemo/web test applyRoute
```
Expected: fail (functions not implemented).

- [ ] **Step 3: Implement**

Create `apps/web/src/lib/routing/applyRoute.ts`:

```ts
import type { RoutePlan } from '@nemo/routing';
import type { OrderEntry } from '@/lib/store/types';

let counter = 0;
function uid(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}`;
}

export function capScheduleToOrders(plan: RoutePlan, baseTs: number): OrderEntry[] {
  const orders: OrderEntry[] = [];
  // Always force sailAuto on first
  orders.push({
    id: uid('mode'),
    type: 'MODE',
    value: { auto: true },
    trigger: { type: 'IMMEDIATE' },
    label: 'Voile auto ON',
  });

  let prevSail: string | null = null;
  for (const entry of plan.capSchedule) {
    const triggerTime = baseTs + entry.triggerMs;
    if (entry.sail && entry.sail !== prevSail) {
      orders.push({
        id: uid('sail'),
        type: 'SAIL',
        value: { sail: entry.sail },
        trigger: { type: 'AT_TIME', time: triggerTime },
        label: `Voile ${entry.sail}`,
      });
      prevSail = entry.sail;
    }
    if (entry.twaLock !== undefined && entry.twaLock !== null) {
      orders.push({
        id: uid('twa'),
        type: 'TWA',
        value: { twa: entry.twaLock },
        trigger: { type: 'AT_TIME', time: triggerTime },
        label: `TWA ${entry.twaLock}°`,
      });
    } else {
      orders.push({
        id: uid('cap'),
        type: 'CAP',
        value: { cap: entry.cap },
        trigger: { type: 'AT_TIME', time: triggerTime },
        label: `CAP ${Math.round(entry.cap)}°`,
      });
    }
  }
  return orders;
}

export function waypointsToOrders(plan: RoutePlan, _baseTs: number): OrderEntry[] {
  const orders: OrderEntry[] = [];
  orders.push({
    id: uid('mode'),
    type: 'MODE',
    value: { auto: true },
    trigger: { type: 'IMMEDIATE' },
    label: 'Voile auto ON',
  });
  // Skip waypoints[0] — that's the boat's start position
  let prevId: string | null = null;
  for (let i = 1; i < plan.waypoints.length; i++) {
    const wp = plan.waypoints[i]!;
    const id = uid('wpt');
    orders.push({
      id,
      type: 'WPT',
      value: { lat: wp.lat, lon: wp.lon, captureRadiusNm: 0.5 },
      trigger: prevId ? { type: 'AT_WAYPOINT', waypointOrderId: prevId } : { type: 'IMMEDIATE' },
      label: `WPT ${wp.lat.toFixed(2)}°·${wp.lon.toFixed(2)}°`,
    });
    prevId = id;
  }
  return orders;
}
```

- [ ] **Step 4: Run, verify pass**

```bash
pnpm --filter @nemo/web test applyRoute
```
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/routing/applyRoute.ts apps/web/src/lib/routing/applyRoute.test.ts
git commit -m "routing(apply): conversion of RoutePlan to OrderEntry[] (CAP and WPT modes)"
```

### Task 9.2: `ConfirmReplaceProgModal.tsx`

**Files:**
- Create: `apps/web/src/components/play/ConfirmReplaceProgModal.tsx`
- Create: `apps/web/src/components/play/ConfirmReplaceProgModal.module.css`

- [ ] **Step 1: Component**

```tsx
'use client';
import styles from './ConfirmReplaceProgModal.module.css';

interface Props {
  isOpen: boolean;
  pendingCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmReplaceProgModal({
  isOpen, pendingCount, onConfirm, onCancel,
}: Props): React.ReactElement | null {
  if (!isOpen) return null;
  return (
    <div className={styles.overlay} role="dialog" aria-modal="true">
      <div className={styles.dialog}>
        <h3 className={styles.title}>Remplacer la programmation</h3>
        <p className={styles.body}>
          Vous avez <strong>{pendingCount}</strong> ordre{pendingCount > 1 ? 's' : ''} en attente.
          Appliquer la route va remplacer tous les ordres futurs et activer la voile automatique.
        </p>
        <p className={styles.body}>Les ordres déjà déclenchés sont conservés.</p>
        <div className={styles.actions}>
          <button type="button" className={styles.cancel} onClick={onCancel}>Annuler</button>
          <button type="button" className={styles.confirm} onClick={onConfirm}>Remplacer</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: CSS**

```css
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.dialog {
  background: #0c1424;
  border: 1px solid rgba(245, 240, 232, 0.16);
  border-radius: 6px;
  padding: 24px;
  max-width: 400px;
  color: #f5f0e8;
  font-family: sans-serif;
}
.title { font-family: var(--font-mono); font-size: 13px; font-weight: 700; letter-spacing: 0.1em; margin: 0 0 12px; color: #c9a227; }
.body { font-size: 13px; line-height: 1.5; margin-bottom: 12px; }
.actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
.cancel, .confirm {
  padding: 8px 14px;
  border-radius: 3px;
  font-family: var(--font-mono);
  font-weight: 700;
  font-size: 11px;
  letter-spacing: 0.1em;
  cursor: pointer;
}
.cancel { background: transparent; color: #8fa8c8; border: 1px solid rgba(245, 240, 232, 0.16); }
.confirm { background: #c9a227; color: #1a2840; border: none; }
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/play/ConfirmReplaceProgModal.tsx apps/web/src/components/play/ConfirmReplaceProgModal.module.css
git commit -m "play(router): add ConfirmReplaceProgModal"
```

### Task 9.3: Wire apply flow in PlayClient

**Files:**
- Modify: `apps/web/src/app/play/[raceId]/PlayClient.tsx`

- [ ] **Step 1: Add state + apply handler**

```tsx
import ConfirmReplaceProgModal from '@/components/play/ConfirmReplaceProgModal';
import { capScheduleToOrders, waypointsToOrders } from '@/lib/routing/applyRoute';
import { sendOrder } from '@/lib/store';

const [pendingApply, setPendingApply] = useState<'WAYPOINTS' | 'CAP' | null>(null);
const orderQueue = useGameStore((s) => s.prog.orderQueue);
const futureOrdersCount = orderQueue.length;

const performApply = (mode: 'WAYPOINTS' | 'CAP') => {
  const state = useGameStore.getState();
  const plan = state.router.computedRoute;
  if (!plan) return;
  const baseTs = Date.now();
  const orders = mode === 'WAYPOINTS' ? waypointsToOrders(plan, baseTs) : capScheduleToOrders(plan, baseTs);
  state.replaceOrderQueue(orders);
  for (const o of orders) sendOrder({ type: o.type, value: o.value, trigger: o.trigger });
  state.closeRouter();
};

const onApply = (mode: 'WAYPOINTS' | 'CAP') => {
  if (futureOrdersCount > 0) setPendingApply(mode);
  else performApply(mode);
};
```

- [ ] **Step 2: Wire `onApply` into `<RouterPanel>`**

```tsx
<RouterPanel onApply={onApply} />
```

- [ ] **Step 3: Render modal**

Inside the canInteract block:

```tsx
<ConfirmReplaceProgModal
  isOpen={pendingApply !== null}
  pendingCount={futureOrdersCount}
  onCancel={() => setPendingApply(null)}
  onConfirm={() => {
    if (pendingApply) performApply(pendingApply);
    setPendingApply(null);
  }}
/>
```

- [ ] **Step 4: Manual verify — CAP mode**

Reload `/play/<race>`. Open router, place dest, calc, click "CAP SCHEDULE". If ProgPanel had pending orders, modal asks confirmation; confirm → panel closes, ProgPanel shows the new orders.

- [ ] **Step 5: Manual verify — Waypoints mode**

Same, but click "WAYPOINTS". Boat should head toward each WPT in sequence over time (engine WPT handling kicks in).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/play/[raceId]/PlayClient.tsx
git commit -m "play(router): wire apply flow with replace-confirm modal and order dispatch"
```

---

## Phase 10 — Polish, edge cases, final test pass

### Task 10.1: Disable Route button when GFS grid not loaded

Already handled in `RouterPanel.tsx` Task 5.2 via the `isGridLoaded` check. Verify by manually clearing weather state in the store and confirming the button shows "Météo en chargement…".

- [ ] **Step 1: Verify behavior**

In a dev console:
```js
useGameStore.setState((s) => ({ weather: { ...s.weather, decodedGrid: null } }));
```
Open router, expect ROUTER button disabled with sub-label.

(No commit — verification only.)

### Task 10.2: Spectator mode — confirm Route button hidden

The Route button is already inside the `canInteract && (<>` block (Phase 4 Task 4.2). Verify:

- [ ] **Step 1: Manual check**

Visit `/play/<race-id>` while logged out (or on a race the user isn't registered for). The Route button should not be present in the right stack, and pressing R should do nothing.

(No commit — verification only.)

### Task 10.3: Mobile responsive sweep

- [ ] **Step 1: DevTools mobile profile**

In Chrome DevTools, switch to iPhone 13 / Pixel 7 profiles. Verify:
- The router panel slides in full-width
- The Route button shows icon-only (label hidden by `@media` rules)
- The compact zoom shrinks (per Task 4.1 CSS)
- Tapping the map in placing mode places the destination
- The placing indicator banner is readable

(No commit unless adjustments needed.)

### Task 10.4: Run full test suite

- [ ] **Step 1: Web tests**
```bash
pnpm --filter @nemo/web test
```

- [ ] **Step 2: Engine tests**
```bash
pnpm --filter @nemo/game-engine-core test
```

- [ ] **Step 3: Typecheck**
```bash
pnpm --filter @nemo/web typecheck
pnpm --filter @nemo/game-engine-core typecheck
```

- [ ] **Step 4: Build**
```bash
pnpm --filter @nemo/web build
```

All green, no errors.

### Task 10.5: Final manual smoke test

- [ ] **Step 1: Walk the full happy path**

1. Open `/play/<race-id>` as registered player
2. Press R, panel opens
3. Click "Définir l'arrivée", click on water far from boat
4. Click "ROUTER", spinner spins
5. Results appear with route + isos on map
6. Close panel → everything clears
7. Open again, repeat, this time click "WAYPOINTS"
8. Confirmation modal (if pending orders) → confirm
9. ProgPanel reflects new orders
10. After a few engine ticks, boat steers toward first waypoint

- [ ] **Step 2: Walk the cancellation flow**

1. Place dest, click "ROUTER"
2. Mid-spinner, close panel
3. Reopen — should be idle, no stale results
4. (Bonus) Confirm worker postMessage logs that the result was returned but ignored

### Task 10.6: Final commit & wrap

- [ ] **Step 1: Run lint/format if project uses it**
```bash
pnpm --filter @nemo/web lint
```

- [ ] **Step 2: Final commit if any cleanup needed**

```bash
git add -A
git commit -m "play(router): polish & manual verification pass"
```

---

## Acceptance criteria checklist

- [ ] Route button visible in rightStack (Voiles / Prog / Centrer / Route / Compass)
- [ ] Compact zoom +/− visible top-right under HUD
- [ ] Old +/− zoom in rightStack removed
- [ ] Hotkey `R` toggles router panel
- [ ] Click "Définir l'arrivée" → cursor crosshair + banner
- [ ] Map click in placing mode sets destination, returns to idle
- [ ] Mobile tap in placing mode works
- [ ] ROUTER button disabled when no destination or no GFS grid
- [ ] Spinner displays during calc, panel still closeable
- [ ] Closing panel mid-calc cancels (genId invalidation)
- [ ] Results show distance / ETA / maneuver count
- [ ] Polyline + isochrones render on map in results phase
- [ ] Destination marker visible when panel open + dest set
- [ ] Modal asks confirmation when applying with pending orders
- [ ] CAP mode: orderQueue replaced with MODE/SAIL/CAP/TWA orders, sent over WS
- [ ] Waypoints mode: orderQueue replaced with MODE/WPT orders, engine steers boat to each
- [ ] After apply: panel closes, route + isochrones cleared
- [ ] Spectator: Route button hidden
- [ ] All unit tests green
- [ ] Engine WPT processing tests green
