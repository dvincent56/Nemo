# Routing Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reusable isochrones-based sailing routing engine (`@nemo/routing`) and integrate it into `/dev/simulator` so the user can click a destination, compute a per-boat optimal route (with 3 presets), visualize the isochrones, and auto-pilot up to 4 boats via generated CAP schedules.

**Architecture:** A new browser-safe workspace package `@nemo/routing` exposes a pure `computeRoute(input) → Promise<RoutePlan>` that runs the isochrones algorithm with angular-sector pruning. A dedicated `routing.worker.ts` spawns one routing per boat in parallel. The dev simulator adds an end-point marker, route/isochrone map layers, a preset selector + "Router tous les bateaux" button, and pipes each boat's resulting `capSchedule` into `SimulatorEngine` via a new `schedule` message.

**Tech Stack:** TypeScript strict, pnpm + Turborepo workspace, Web Workers, MapLibre GL (existing), node:test + tsx for unit tests. Depends on existing `@nemo/game-engine-core/browser`, `@nemo/polar-lib/browser`, `@nemo/shared-types`.

**Reference spec:** [docs/superpowers/specs/2026-04-22-routing-engine-design.md](../specs/2026-04-22-routing-engine-design.md)

---

## Phase 1 — Prerequisites shared between routing and web

### Task 1: Move `WindGridConfig` into `@nemo/game-engine-core`

Today `WindGridConfig` lives in `apps/web/src/lib/projection/windLookup.ts`. The routing package must consume it without depending on `apps/web`. Move only the type (leave `createWindLookup` in web).

**Files:**
- Modify: `packages/game-engine-core/src/weather.ts` — add `WindGridConfig` type
- Modify: `packages/game-engine-core/src/index.ts` — re-export it
- Modify: `apps/web/src/lib/projection/windLookup.ts` — import from core instead of declaring locally

- [ ] **Step 1: Read the current declaration**

Run: `head -30 apps/web/src/lib/projection/windLookup.ts`
Note the exact `WindGridConfig` shape before moving it.

- [ ] **Step 2: Add `WindGridConfig` to core `weather.ts`**

Append to `packages/game-engine-core/src/weather.ts`:

```ts
/**
 * Shape of a packed wind grid consumed by downstream weather samplers.
 * Timestamps are in Unix milliseconds, matching production flows.
 */
export interface WindGridConfig {
  bounds: { north: number; south: number; east: number; west: number };
  resolution: number;   // degrees per cell step (assumed square)
  cols: number;
  rows: number;
  timestamps: number[]; // one per forecast hour, in ms since epoch
}
```

- [ ] **Step 3: Re-export from core `index.ts`**

Add to `packages/game-engine-core/src/index.ts`:

```ts
export type { WindGridConfig } from './weather';
```

- [ ] **Step 4: Switch `windLookup.ts` to consume the shared type**

In `apps/web/src/lib/projection/windLookup.ts`, replace the local `WindGridConfig` declaration with:

```ts
import type { WindGridConfig } from '@nemo/game-engine-core/browser';
export type { WindGridConfig };
```

All other web-side files that import `WindGridConfig` from `windLookup` keep working.

- [ ] **Step 5: Verify**

Run: `pnpm typecheck`
Expected: 7/7 successful.
Run: `pnpm --filter @nemo/game-engine-core test`
Expected: 18 pass, 0 fail.

- [ ] **Step 6: Commit**

```bash
git add packages/game-engine-core/src/weather.ts packages/game-engine-core/src/index.ts apps/web/src/lib/projection/windLookup.ts
git commit -m "refactor(game-engine-core): move WindGridConfig to shared weather module"
```

---

### Task 2: Extract `computeBsp` from `tick.ts` into a shared helper

The routing algorithm needs the exact same speed formula the tick engine uses (polar × condition penalty × TWA band mul × TWS band mul). Today that math is inlined inside `runTick`. Extract it so both can call it.

**Files:**
- Modify: `packages/game-engine-core/src/tick.ts` — extract helper, keep runTick using it
- Modify: `packages/game-engine-core/src/index.ts` — export the helper

- [ ] **Step 1: Read the BSP math inside `runTick`**

Run: `grep -n "getPolarSpeed\|speedByTwa\|speedByTws\|conditionSpeedPenalty" packages/game-engine-core/src/tick.ts`
Locate the section where BSP is computed from polar × effects × condition. Usually a few consecutive lines.

- [ ] **Step 2: Add a `computeBsp` helper**

At the top of `packages/game-engine-core/src/tick.ts` (below imports), export:

```ts
import { bandFor } from './bands';

/**
 * Speed model shared between tick engine and routing engine.
 * Matches the effects aggregation used by runTick.
 */
export function computeBsp(
  polar: Polar,
  sail: SailId,
  twa: number,
  tws: number,
  effects: AggregatedEffects,
  condition: ConditionState,
): number {
  const twaAbs = Math.min(Math.abs(twa), 180);
  const base = getPolarSpeed(polar, sail, twaAbs, tws);
  const condMul = conditionSpeedPenalty(condition);
  const twaBand = bandFor(twaAbs, [60, 90, 120, 150]);
  const twsBand = bandFor(tws, [10, 20]);
  const twaMul = 1 + (effects.speedByTwa[twaBand] ?? 0);
  const twsMul = 1 + (effects.speedByTws[twsBand] ?? 0);
  return base * condMul * twaMul * twsMul;
}
```

Adjust the `AggregatedEffects` / `ConditionState` imports if already in scope — `conditionSpeedPenalty` is already imported from `./wear`.

- [ ] **Step 3: Replace the inlined math inside `runTick`**

Find the block that computes BSP (looks like `getPolarSpeed(...) * conditionSpeedPenalty(...) * ...`) and replace with a single `computeBsp(polar, sail, twa, weather.tws, effects, runtime.condition)` call. The numeric result must be identical.

- [ ] **Step 4: Export from index**

Append to `packages/game-engine-core/src/index.ts`:

```ts
export { computeBsp } from './tick';
```

- [ ] **Step 5: Verify determinism preserved**

Run: `pnpm --filter @nemo/game-engine-core test`
Expected: all 18 tests pass.

Run: `pnpm --filter @nemo/game-engine exec tsx src/test/e2e-tick.ts`
Expected: `✓ Phase 1 e2e OK — 0.661 NM est.` (the exact 0.661 result — any deviation means the extraction changed the formula).

- [ ] **Step 6: Commit**

```bash
git add packages/game-engine-core/src/tick.ts packages/game-engine-core/src/index.ts
git commit -m "refactor(game-engine-core): extract computeBsp helper for reuse"
```

---

## Phase 2 — Create the `@nemo/routing` package

### Task 3: Scaffold `@nemo/routing`

Empty package following the same pattern as other browser-safe workspace packages.

**Files:**
- Create: `packages/routing/package.json`
- Create: `packages/routing/tsconfig.json`
- Create: `packages/routing/src/index.ts` (empty placeholder)

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "@nemo/routing",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "default": "./src/index.ts"
    }
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "node --import tsx --test src/**/*.test.ts"
  },
  "dependencies": {
    "@nemo/shared-types": "workspace:*",
    "@nemo/polar-lib": "workspace:*",
    "@nemo/game-engine-core": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.7.2",
    "tsx": "^4.19.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

Copy `packages/polar-lib/tsconfig.json` into `packages/routing/tsconfig.json` unchanged.

- [ ] **Step 3: Placeholder `src/index.ts`**

```ts
// Populated by tasks 4-10.
export {};
```

- [ ] **Step 4: Install and typecheck**

Run: `pnpm install`
Run: `pnpm --filter @nemo/routing typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/routing pnpm-lock.yaml
git commit -m "chore(routing): scaffold empty @nemo/routing package"
```

---

### Task 4: Types, presets, and public contract

**Files:**
- Create: `packages/routing/src/types.ts`
- Create: `packages/routing/src/presets.ts`
- Modify: `packages/routing/src/index.ts`

- [ ] **Step 1: Write `types.ts`**

```ts
// packages/routing/src/types.ts
import type { Position, Polar, SailId } from '@nemo/shared-types';
import type {
  BoatLoadout,
  ConditionState,
  WindGridConfig,
} from '@nemo/game-engine-core/browser';

export type Preset = 'FAST' | 'BALANCED' | 'HIGHRES';

export interface PresetParams {
  timeStepSec: number;
  headingCount: number;
  horizonSec: number;
  sectorCount: number;
}

export interface RouteInput {
  from: Position;
  to: Position;
  startTimeMs: number;
  polar: Polar;
  loadout: BoatLoadout;
  condition: ConditionState;
  windGrid: WindGridConfig;
  windData: Float32Array;
  coastlineGeoJson: GeoJSON.FeatureCollection;
  preset: Preset;
}

export interface IsochronePoint {
  lat: number;
  lon: number;
  hdg: number;
  bsp: number;
  tws: number;
  twd: number;
  twa: number;
  sail: SailId;
  timeMs: number;
  distFromStartNm: number;
  parentIdx: number;
}

export interface RoutePolylinePoint {
  lat: number;
  lon: number;
  timeMs: number;
  twa: number;
  tws: number;
  bsp: number;
  sail: SailId;
}

export interface CapScheduleEntry {
  triggerMs: number;
  cap: number;
  sail?: SailId;
}

export interface RoutePlan {
  reachedGoal: boolean;
  polyline: RoutePolylinePoint[];
  waypoints: Position[];
  capSchedule: CapScheduleEntry[];
  isochrones: IsochronePoint[][];
  totalDistanceNm: number;
  eta: number;
  preset: Preset;
  computeTimeMs: number;
}
```

- [ ] **Step 2: Write `presets.ts`**

```ts
// packages/routing/src/presets.ts
import type { Preset, PresetParams } from './types';

export const PRESETS: Record<Preset, PresetParams> = {
  FAST:     { timeStepSec: 3 * 3600, headingCount: 24, horizonSec: 72 * 3600,  sectorCount: 360 },
  BALANCED: { timeStepSec: 2 * 3600, headingCount: 36, horizonSec: 168 * 3600, sectorCount: 720 },
  HIGHRES:  { timeStepSec: 1 * 3600, headingCount: 72, horizonSec: 168 * 3600, sectorCount: 1440 },
};
```

- [ ] **Step 3: Update `index.ts`**

```ts
// packages/routing/src/index.ts
export * from './types';
export { PRESETS } from './presets';
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @nemo/routing typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/routing/src
git commit -m "feat(routing): types, presets, public contract"
```

---

### Task 5: Angular-sector pruning + bearing helper

**Files:**
- Create: `packages/routing/src/pruning.ts`
- Create: `packages/routing/src/pruning.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/routing/src/pruning.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { IsochronePoint } from './types';
import { pruneBySector, bearingDeg } from './pruning';

function pt(lat: number, lon: number, dist: number): IsochronePoint {
  return {
    lat, lon, hdg: 0, bsp: 0, tws: 0, twd: 0, twa: 0, sail: 'JIB',
    timeMs: 0, distFromStartNm: dist, parentIdx: -1,
  };
}

test('bearingDeg is east = 90', () => {
  const b = bearingDeg({ lat: 0, lon: 0 }, { lat: 0, lon: 1 });
  assert.ok(Math.abs(b - 90) < 0.1, `expected ~90, got ${b}`);
});

test('bearingDeg is north = 0', () => {
  const b = bearingDeg({ lat: 0, lon: 0 }, { lat: 1, lon: 0 });
  assert.ok(Math.abs(b) < 0.1 || Math.abs(b - 360) < 0.1, `expected ~0, got ${b}`);
});

test('pruneBySector keeps furthest per sector', () => {
  const origin = { lat: 0, lon: 0 };
  const pts: IsochronePoint[] = [
    pt(0, 0.1, 1),     // east, near
    pt(0, 0.2, 2),     // east, far (should survive)
    pt(0, 0.05, 0.5),  // east, nearest (drop)
    pt(1, 0, 10),      // north, far (survives)
  ];
  const out = pruneBySector(pts, origin, 4);  // 4 sectors = 90° each
  assert.ok(out.length <= 4);
  assert.ok(out.some(p => Math.abs(p.lon - 0.2) < 1e-6), 'furthest east survives');
  assert.ok(out.some(p => Math.abs(p.lat - 1) < 1e-6), 'furthest north survives');
  assert.ok(!out.some(p => Math.abs(p.lon - 0.1) < 1e-6), 'nearer east pruned');
});

test('pruneBySector bounds output by sectorCount', () => {
  const origin = { lat: 0, lon: 0 };
  const pts: IsochronePoint[] = [];
  for (let i = 0; i < 10000; i++) {
    const brg = (i * 360) / 10000;
    const rad = brg * Math.PI / 180;
    pts.push(pt(Math.cos(rad) * 0.1, Math.sin(rad) * 0.1, Math.random() * 5));
  }
  const out = pruneBySector(pts, origin, 360);
  assert.ok(out.length <= 360, `expected <= 360, got ${out.length}`);
});
```

- [ ] **Step 2: Run to confirm it fails for the right reason**

Run: `pnpm --filter @nemo/routing test`
Expected: FAIL, module `./pruning` not found.

- [ ] **Step 3: Implement `pruning.ts`**

```ts
// packages/routing/src/pruning.ts
import type { Position } from '@nemo/shared-types';
import type { IsochronePoint } from './types';

const DEG = Math.PI / 180;

/**
 * Initial bearing in degrees from `a` to `b`, 0 = north, clockwise, 0..360.
 */
export function bearingDeg(a: Position, b: Position): number {
  const lat1 = a.lat * DEG;
  const lat2 = b.lat * DEG;
  const dLon = (b.lon - a.lon) * DEG;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (Math.atan2(y, x) / DEG + 360) % 360;
}

/**
 * Angular-sector pruning: group points by bearing-from-origin into
 * `sectorCount` bins and keep only the furthest-from-origin point per bin.
 * Drops dominated candidates; output has at most `sectorCount` points.
 */
export function pruneBySector(
  points: IsochronePoint[],
  origin: Position,
  sectorCount: number,
): IsochronePoint[] {
  const binWidth = 360 / sectorCount;
  const bins: (IsochronePoint | null)[] = new Array(sectorCount).fill(null);
  for (const p of points) {
    const brg = bearingDeg(origin, p);
    const idx = Math.floor(brg / binWidth) % sectorCount;
    const kept = bins[idx];
    if (!kept || p.distFromStartNm > kept.distFromStartNm) bins[idx] = p;
  }
  const out: IsochronePoint[] = [];
  for (const p of bins) if (p !== null) out.push(p);
  return out;
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @nemo/routing test`
Expected: 4 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add packages/routing/src/pruning.ts packages/routing/src/pruning.test.ts
git commit -m "feat(routing): angular-sector pruning with bearing helper"
```

---

### Task 6: Polyline backtrack + inflection extraction + schedule

**Files:**
- Create: `packages/routing/src/polyline.ts`
- Create: `packages/routing/src/schedule.ts`
- Create: `packages/routing/src/schedule.test.ts`

- [ ] **Step 1: Write `polyline.ts`**

```ts
// packages/routing/src/polyline.ts
import type { Position } from '@nemo/shared-types';
import type { IsochronePoint, RoutePolylinePoint } from './types';

/**
 * Walk parentIdx chains from the arrival point back to the start,
 * producing a chronologically-ordered polyline including the start.
 */
export function backtrackPolyline(
  isochrones: IsochronePoint[][],
  arrival: IsochronePoint,
  arrivalStep: number,
): RoutePolylinePoint[] {
  const chain: IsochronePoint[] = [];
  let current: IsochronePoint | null = arrival;
  let step = arrivalStep;
  while (current && step >= 0) {
    chain.push(current);
    if (current.parentIdx < 0 || step === 0) break;
    const prev = isochrones[step - 1];
    if (!prev) break;
    const next = prev[current.parentIdx];
    current = next ?? null;
    step--;
  }
  chain.reverse();
  return chain.map((p) => ({
    lat: p.lat, lon: p.lon, timeMs: p.timeMs,
    twa: p.twa, tws: p.tws, bsp: p.bsp, sail: p.sail,
  }));
}

const TWO_PI = 2 * Math.PI;
function angleDiffDeg(a: number, b: number): number {
  const d = ((a - b) * Math.PI / 180 + TWO_PI + Math.PI) % TWO_PI - Math.PI;
  return Math.abs(d * 180 / Math.PI);
}

/**
 * Decimate the polyline: keep first, last, and any point where the
 * outgoing heading (from this point to next) differs from the previous
 * outgoing heading by at least `minDegChange` degrees.
 */
export function extractInflectionPoints(
  polyline: RoutePolylinePoint[],
  minDegChange: number,
): Position[] {
  if (polyline.length < 2) return polyline.map((p) => ({ lat: p.lat, lon: p.lon }));
  const out: Position[] = [{ lat: polyline[0]!.lat, lon: polyline[0]!.lon }];
  let lastHdg = bearingBetween(polyline[0]!, polyline[1]!);
  for (let i = 1; i < polyline.length - 1; i++) {
    const hdgOut = bearingBetween(polyline[i]!, polyline[i + 1]!);
    if (angleDiffDeg(hdgOut, lastHdg) >= minDegChange) {
      out.push({ lat: polyline[i]!.lat, lon: polyline[i]!.lon });
      lastHdg = hdgOut;
    }
  }
  const last = polyline[polyline.length - 1]!;
  out.push({ lat: last.lat, lon: last.lon });
  return out;
}

function bearingBetween(a: Position, b: Position): number {
  const DEG = Math.PI / 180;
  const lat1 = a.lat * DEG;
  const lat2 = b.lat * DEG;
  const dLon = (b.lon - a.lon) * DEG;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (Math.atan2(y, x) / DEG + 360) % 360;
}
```

- [ ] **Step 2: Write failing tests for `schedule.ts`**

```ts
// packages/routing/src/schedule.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RoutePolylinePoint } from './types';
import { buildCapSchedule } from './schedule';

function pp(ms: number, lat: number, lon: number, sail: 'JIB'|'SPI'): RoutePolylinePoint {
  return { lat, lon, timeMs: ms, twa: 0, tws: 12, bsp: 8, sail };
}

test('buildCapSchedule emits on heading change above threshold', () => {
  // A -> B (cap east) -> C (cap east, same) -> D (cap north, big change)
  const line: RoutePolylinePoint[] = [
    pp(0, 0, 0, 'JIB'),
    pp(3600_000, 0, 0.5, 'JIB'),
    pp(7200_000, 0, 1.0, 'JIB'),
    pp(10800_000, 0.5, 1.0, 'JIB'),
  ];
  const sched = buildCapSchedule(line, 5);
  assert.equal(sched.length, 2, 'initial + one turn');
  assert.ok(Math.abs(sched[0]!.cap - 90) < 1, `initial cap ~east, got ${sched[0]!.cap}`);
  assert.ok(Math.abs(sched[1]!.cap) < 1 || Math.abs(sched[1]!.cap - 360) < 1, `turn to ~north, got ${sched[1]!.cap}`);
});

test('buildCapSchedule emits sail change on next segment', () => {
  const line: RoutePolylinePoint[] = [
    pp(0, 0, 0, 'JIB'),
    pp(3600_000, 0, 0.5, 'JIB'),
    pp(7200_000, 0, 1.0, 'SPI'),
  ];
  const sched = buildCapSchedule(line, 5);
  const withSail = sched.find((e) => e.sail === 'SPI');
  assert.ok(withSail, 'schedule contains a SPI entry');
});
```

- [ ] **Step 3: Verify test fails**

Run: `pnpm --filter @nemo/routing test`
Expected: FAIL, module `./schedule` not found.

- [ ] **Step 4: Implement `schedule.ts`**

```ts
// packages/routing/src/schedule.ts
import type { RoutePolylinePoint, CapScheduleEntry } from './types';

const DEG = Math.PI / 180;

function bearingBetween(a: RoutePolylinePoint, b: RoutePolylinePoint): number {
  const lat1 = a.lat * DEG;
  const lat2 = b.lat * DEG;
  const dLon = (b.lon - a.lon) * DEG;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (Math.atan2(y, x) / DEG + 360) % 360;
}

function angleDiffDeg(a: number, b: number): number {
  const d = (((a - b) + 540) % 360) - 180;
  return Math.abs(d);
}

/**
 * Emit CAP schedule entries at the start of each segment whose outgoing
 * heading differs from the previous segment's heading by >= minDegChange,
 * or whose sail differs.
 */
export function buildCapSchedule(
  polyline: RoutePolylinePoint[],
  minDegChange: number,
): CapScheduleEntry[] {
  if (polyline.length < 2) return [];
  const entries: CapScheduleEntry[] = [];

  const firstCap = bearingBetween(polyline[0]!, polyline[1]!);
  entries.push({ triggerMs: polyline[0]!.timeMs, cap: firstCap, sail: polyline[1]!.sail });

  let lastCap = firstCap;
  let lastSail = polyline[1]!.sail;
  for (let i = 1; i < polyline.length - 1; i++) {
    const cap = bearingBetween(polyline[i]!, polyline[i + 1]!);
    const sail = polyline[i + 1]!.sail;
    const headingChanged = angleDiffDeg(cap, lastCap) >= minDegChange;
    const sailChanged = sail !== lastSail;
    if (headingChanged || sailChanged) {
      const entry: CapScheduleEntry = { triggerMs: polyline[i]!.timeMs, cap };
      if (sailChanged) entry.sail = sail;
      entries.push(entry);
      lastCap = cap;
      lastSail = sail;
    }
  }
  return entries;
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @nemo/routing test`
Expected: 6 pass, 0 fail (4 pruning + 2 schedule).

- [ ] **Step 6: Commit**

```bash
git add packages/routing/src/polyline.ts packages/routing/src/schedule.ts packages/routing/src/schedule.test.ts
git commit -m "feat(routing): polyline backtrack, inflection points, cap schedule"
```

---

### Task 7: Main isochrones algorithm + end-to-end test

**Files:**
- Create: `packages/routing/src/weatherSampler.ts` (wraps windGrid lookup)
- Create: `packages/routing/src/isochrones.ts` (the main algorithm)
- Create: `packages/routing/src/isochrones.test.ts`
- Modify: `packages/routing/src/index.ts` (export `computeRoute`)

- [ ] **Step 1: Implement a minimal weather sampler**

```ts
// packages/routing/src/weatherSampler.ts
// Bilinear lookup in the packed Float32Array. Returns null if the time is
// outside the grid timestamps range. Fields are 5 per cell: tws, twd, swh,
// swellDir, swellPeriod (matches apps/web/src/lib/projection/windLookup.ts).
import type { WindGridConfig } from '@nemo/game-engine-core/browser';

export interface WindSample {
  tws: number;
  twd: number;
}

const FIELDS = 5;

export function sampleWind(
  grid: WindGridConfig,
  data: Float32Array,
  lat: number,
  lon: number,
  tMs: number,
): WindSample | null {
  const ts = grid.timestamps;
  if (ts.length === 0) return null;
  if (tMs < ts[0]! || tMs > ts[ts.length - 1]!) return null;

  // Find bracketing time layers
  let t0 = 0;
  for (let i = 1; i < ts.length; i++) {
    if (ts[i]! >= tMs) { t0 = i - 1; break; }
    t0 = i;
  }
  const t1 = Math.min(t0 + 1, ts.length - 1);
  const tFrac = t1 === t0 ? 0 : (tMs - ts[t0]!) / (ts[t1]! - ts[t0]!);

  // Spatial bilinear
  const { bounds, resolution, cols, rows } = grid;
  if (lat < bounds.south || lat > bounds.north) return null;
  if (lon < bounds.west || lon > bounds.east) return null;
  const fy = (lat - bounds.south) / resolution;
  const fx = (lon - bounds.west) / resolution;
  const iy0 = Math.min(Math.floor(fy), rows - 2);
  const ix0 = Math.min(Math.floor(fx), cols - 2);
  const dy = fy - iy0;
  const dx = fx - ix0;

  const pointsPerLayer = rows * cols;
  const at = (tIdx: number, iy: number, ix: number): [number, number] => {
    const base = (tIdx * pointsPerLayer + iy * cols + ix) * FIELDS;
    return [data[base]!, data[base + 1]!];
  };

  const interp = (tIdx: number): [number, number] => {
    const [t00, d00] = at(tIdx, iy0, ix0);
    const [t10, d10] = at(tIdx, iy0, ix0 + 1);
    const [t01, d01] = at(tIdx, iy0 + 1, ix0);
    const [t11, d11] = at(tIdx, iy0 + 1, ix0 + 1);
    const tws = (t00 * (1 - dx) + t10 * dx) * (1 - dy) + (t01 * (1 - dx) + t11 * dx) * dy;
    // TWD: interpolate via sin/cos to handle the 0/360 wrap
    const toRad = Math.PI / 180;
    const sx = (Math.sin(d00 * toRad) * (1 - dx) + Math.sin(d10 * toRad) * dx) * (1 - dy) +
               (Math.sin(d01 * toRad) * (1 - dx) + Math.sin(d11 * toRad) * dx) * dy;
    const cx = (Math.cos(d00 * toRad) * (1 - dx) + Math.cos(d10 * toRad) * dx) * (1 - dy) +
               (Math.cos(d01 * toRad) * (1 - dx) + Math.cos(d11 * toRad) * dx) * dy;
    const twd = ((Math.atan2(sx, cx) / toRad) + 360) % 360;
    return [tws, twd];
  };

  const [tws0, twd0] = interp(t0);
  const [tws1, twd1] = interp(t1);
  const tws = tws0 * (1 - tFrac) + tws1 * tFrac;
  // Same sin/cos dance for temporal interpolation
  const toRad = Math.PI / 180;
  const sx = Math.sin(twd0 * toRad) * (1 - tFrac) + Math.sin(twd1 * toRad) * tFrac;
  const cx = Math.cos(twd0 * toRad) * (1 - tFrac) + Math.cos(twd1 * toRad) * tFrac;
  const twd = ((Math.atan2(sx, cx) / toRad) + 360) % 360;

  return { tws, twd };
}
```

- [ ] **Step 2: Write the failing end-to-end test**

```ts
// packages/routing/src/isochrones.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Polar } from '@nemo/shared-types';
import { CoastlineIndex, resolveBoatLoadout, GameBalance } from '@nemo/game-engine-core';
import type { WindGridConfig } from '@nemo/game-engine-core';
import { computeRoute } from './index';
import { haversineNM } from '@nemo/polar-lib/browser';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../..');

function loadPolar(): Polar {
  return JSON.parse(readFileSync(resolve(repoRoot, 'packages/polar-lib/polars/class40.json'), 'utf-8'));
}

function loadGameBalance(): unknown {
  return JSON.parse(readFileSync(resolve(repoRoot, 'packages/game-balance/game-balance.json'), 'utf-8'));
}

// 2x2 grid covering 46..48 N, -4..-2 W, constant 12 kts from north over 48 h.
function constantWind(): { windGrid: WindGridConfig; windData: Float32Array } {
  const cols = 2, rows = 2;
  const now = 1_700_000_000_000;
  const timestamps = [now, now + 48 * 3_600_000];
  const windGrid: WindGridConfig = {
    bounds: { north: 48, south: 46, east: -2, west: -4 },
    resolution: 2, cols, rows, timestamps,
  };
  const points = cols * rows;
  const data = new Float32Array(timestamps.length * points * 5);
  for (let t = 0; t < timestamps.length; t++) {
    for (let i = 0; i < points; i++) {
      const base = (t * points + i) * 5;
      data[base + 0] = 12;       // tws
      data[base + 1] = 180;      // twd (north wind → blowing from 180)
      data[base + 2] = 0;
      data[base + 3] = 0;
      data[base + 4] = 0;
    }
  }
  return { windGrid, windData: data };
}

test('computeRoute reaches a 30 NM east target with constant wind', async () => {
  GameBalance.load(loadGameBalance());
  const polar = loadPolar();
  const loadout = resolveBoatLoadout('test', [], 'CLASS40');
  const { windGrid, windData } = constantWind();

  const from = { lat: 47, lon: -3 };
  const to   = { lat: 47, lon: -2.5 };  // ~21 NM east

  const plan = await computeRoute({
    from, to,
    startTimeMs: windGrid.timestamps[0]!,
    polar, loadout,
    condition: { hull: 100, rig: 100, sails: 100, electronics: 100 },
    windGrid, windData,
    coastlineGeoJson: { type: 'FeatureCollection', features: [] },
    preset: 'FAST',
  });

  assert.equal(plan.reachedGoal, true, 'expected to reach goal');
  const arrival = plan.polyline[plan.polyline.length - 1]!;
  const distanceToTarget = haversineNM(arrival, to);
  assert.ok(distanceToTarget < 5, `arrival within 5 NM of target, got ${distanceToTarget}`);
  assert.ok(plan.isochrones.length >= 1, 'isochrones captured');
  assert.ok(plan.capSchedule.length >= 1, 'capSchedule produced');
});

test('computeRoute is deterministic', async () => {
  GameBalance.load(loadGameBalance());
  const polar = loadPolar();
  const loadout = resolveBoatLoadout('det', [], 'CLASS40');
  const { windGrid, windData } = constantWind();
  const input = {
    from: { lat: 47, lon: -3 },
    to:   { lat: 47, lon: -2.5 },
    startTimeMs: windGrid.timestamps[0]!,
    polar, loadout,
    condition: { hull: 100, rig: 100, sails: 100, electronics: 100 },
    windGrid, windData,
    coastlineGeoJson: { type: 'FeatureCollection', features: [] },
    preset: 'FAST' as const,
  };
  const a = await computeRoute(input);
  const b = await computeRoute(input);
  assert.deepStrictEqual(a.polyline, b.polyline);
  assert.deepStrictEqual(a.capSchedule, b.capSchedule);
});
```

- [ ] **Step 3: Run to confirm failure**

Run: `pnpm --filter @nemo/routing test`
Expected: FAIL, `computeRoute` not exported.

- [ ] **Step 4: Implement `isochrones.ts`**

```ts
// packages/routing/src/isochrones.ts
import type { Position, Polar, SailId } from '@nemo/shared-types';
import {
  CoastlineIndex,
  aggregateEffects,
  computeBsp,
  type BoatLoadout,
  type ConditionState,
  type WindGridConfig,
} from '@nemo/game-engine-core/browser';
import { advancePosition, computeTWA, haversineNM } from '@nemo/polar-lib/browser';
import { pruneBySector } from './pruning';
import { backtrackPolyline, extractInflectionPoints } from './polyline';
import { buildCapSchedule } from './schedule';
import { sampleWind } from './weatherSampler';
import { PRESETS } from './presets';
import type {
  IsochronePoint, Preset, RouteInput, RoutePlan, RoutePolylinePoint,
} from './types';

const INFLECTION_DEG = 5;

function precomputeBspMax(polar: Polar): number {
  let max = 0;
  for (const sail of Object.keys(polar.speeds)) {
    const table = polar.speeds[sail];
    if (!table) continue;
    for (const row of table) for (const v of row) if (v > max) max = v;
  }
  return max;
}

function pickOptimalSailForRouting(polar: Polar, twaAbs: number, tws: number): SailId {
  let best: SailId | null = null;
  let bestBsp = -1;
  for (const sail of Object.keys(polar.speeds) as SailId[]) {
    const table = polar.speeds[sail];
    if (!table) continue;
    // Quick polar lookup: find nearest cell in twa/tws grids
    const twaIdx = nearestIdx(polar.twa, twaAbs);
    const twsIdx = nearestIdx(polar.tws, tws);
    const row = table[twaIdx];
    if (!row) continue;
    const v = row[twsIdx] ?? 0;
    if (v > bestBsp) { bestBsp = v; best = sail; }
  }
  return best ?? ('JIB' as SailId);
}

function nearestIdx(arr: readonly number[], v: number): number {
  let best = 0, bestDiff = Infinity;
  for (let i = 0; i < arr.length; i++) {
    const d = Math.abs(arr[i]! - v);
    if (d < bestDiff) { bestDiff = d; best = i; }
  }
  return best;
}

export async function computeRoute(input: RouteInput): Promise<RoutePlan> {
  const t0 = Date.now();
  const params = PRESETS[input.preset];
  const { timeStepSec, headingCount, horizonSec, sectorCount } = params;
  const stepHeading = 360 / headingCount;

  const coastline = new CoastlineIndex();
  coastline.loadFromGeoJson(input.coastlineGeoJson);

  const effects = aggregateEffects(input.loadout.items);
  const bspMax = precomputeBspMax(input.polar);
  const arrivalRadiusNm = Math.max(1, (bspMax * timeStepSec) / 3600 / 2);

  // Initial sample for iso[0] metadata
  const initSample = sampleWind(input.windGrid, input.windData, input.from.lat, input.from.lon, input.startTimeMs);
  const initTws = initSample?.tws ?? 0;
  const initTwd = initSample?.twd ?? 0;

  const isochrones: IsochronePoint[][] = [[{
    lat: input.from.lat, lon: input.from.lon, hdg: 0, bsp: 0,
    tws: initTws, twd: initTwd, twa: 0, sail: 'JIB' as SailId,
    timeMs: input.startTimeMs, distFromStartNm: 0, parentIdx: -1,
  }]];

  const maxSteps = Math.ceil(horizonSec / timeStepSec);
  let arrivalStep = -1;
  let arrivalPoint: IsochronePoint | null = null;

  for (let step = 1; step <= maxSteps; step++) {
    const prev = isochrones[step - 1]!;
    const candidates: IsochronePoint[] = [];

    for (let idx = 0; idx < prev.length; idx++) {
      const p = prev[idx]!;
      const weather = sampleWind(input.windGrid, input.windData, p.lat, p.lon, p.timeMs);
      if (!weather) continue;

      for (let h = 0; h < 360; h += stepHeading) {
        const twa = computeTWA(h, weather.twd);
        const twaAbs = Math.min(Math.abs(twa), 180);
        if (input.polar.twa[0] !== undefined && twaAbs < input.polar.twa[0]) continue;
        const sail = pickOptimalSailForRouting(input.polar, twaAbs, weather.tws);
        const bsp = computeBsp(input.polar, sail, twa, weather.tws, effects, input.condition);
        if (bsp < 0.1) continue;

        const distNm = bsp * (timeStepSec / 3600);
        const newPos = advancePosition({ lat: p.lat, lon: p.lon }, h, bsp, timeStepSec);
        if (coastline.segmentCrossesCoast({ lat: p.lat, lon: p.lon }, newPos)) continue;

        candidates.push({
          lat: newPos.lat, lon: newPos.lon, hdg: h, bsp,
          tws: weather.tws, twd: weather.twd, twa, sail,
          timeMs: p.timeMs + timeStepSec * 1000,
          distFromStartNm: p.distFromStartNm + distNm,
          parentIdx: idx,
        });
      }
    }

    const pruned = pruneBySector(candidates, input.from, sectorCount);
    isochrones.push(pruned);

    const hit = pruned.find((q) => haversineNM({ lat: q.lat, lon: q.lon }, input.to) <= arrivalRadiusNm);
    if (hit) {
      arrivalStep = step;
      arrivalPoint = hit;
      break;
    }
  }

  const reachedGoal = arrivalPoint !== null;
  if (!arrivalPoint) {
    const last = isochrones[isochrones.length - 1]!;
    let best = last[0]!;
    let bestDist = haversineNM({ lat: best.lat, lon: best.lon }, input.to);
    for (const q of last) {
      const d = haversineNM({ lat: q.lat, lon: q.lon }, input.to);
      if (d < bestDist) { bestDist = d; best = q; }
    }
    arrivalPoint = best;
    arrivalStep = isochrones.length - 1;
  }

  const polyline = backtrackPolyline(isochrones, arrivalPoint, arrivalStep);
  const waypoints = extractInflectionPoints(polyline, INFLECTION_DEG);
  const capSchedule = buildCapSchedule(polyline, INFLECTION_DEG);
  const eta = reachedGoal ? arrivalPoint.timeMs : Number.POSITIVE_INFINITY;
  const totalDistanceNm = arrivalPoint.distFromStartNm;

  return {
    reachedGoal, polyline, waypoints, capSchedule, isochrones,
    totalDistanceNm, eta, preset: input.preset,
    computeTimeMs: Date.now() - t0,
  };
}
```

- [ ] **Step 5: Export from index**

Update `packages/routing/src/index.ts`:

```ts
export * from './types';
export { PRESETS } from './presets';
export { computeRoute } from './isochrones';
```

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @nemo/routing test`
Expected: 8 pass, 0 fail.

- [ ] **Step 7: Commit**

```bash
git add packages/routing/src
git commit -m "feat(routing): isochrones main loop + end-to-end test"
```

---

## Phase 3 — Dev-simulator integration

### Task 8: Web Worker adapter `routing.worker.ts`

**Files:**
- Create: `apps/web/src/workers/routing.worker.ts`

- [ ] **Step 1: Write the worker**

```ts
// apps/web/src/workers/routing.worker.ts
/// <reference lib="webworker" />
import { computeRoute, type RouteInput, type RoutePlan } from '@nemo/routing';
import { GameBalance } from '@nemo/game-balance/browser';

export type RoutingInMessage =
  | { type: 'compute'; input: RouteInput; gameBalanceJson: unknown };

export type RoutingOutMessage =
  | { type: 'result'; plan: RoutePlan }
  | { type: 'error'; message: string };

self.onmessage = async (e: MessageEvent<RoutingInMessage>) => {
  const msg = e.data;
  if (msg.type !== 'compute') return;
  try {
    GameBalance.load(msg.gameBalanceJson);
    const plan = await computeRoute(msg.input);
    (self as unknown as Worker).postMessage({ type: 'result', plan } satisfies RoutingOutMessage);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    (self as unknown as Worker).postMessage({ type: 'error', message } satisfies RoutingOutMessage);
  }
};
```

- [ ] **Step 2: Add `@nemo/routing` to `apps/web/package.json`**

Open `apps/web/package.json`, add to `dependencies`:

```json
"@nemo/routing": "workspace:*"
```

Run: `pnpm install`

- [ ] **Step 3: Add it to `transpilePackages` in `next.config.ts`**

Edit `apps/web/next.config.ts`:

```ts
transpilePackages: ['@nemo/shared-types', '@nemo/game-balance', '@nemo/game-engine-core', '@nemo/routing'],
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @nemo/web typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/workers/routing.worker.ts apps/web/package.json apps/web/next.config.ts pnpm-lock.yaml
git commit -m "feat(web): routing.worker adapter + workspace wiring"
```

---

### Task 9: End-point marker (`EndPointLayer`)

**Files:**
- Create: `apps/web/src/app/dev/simulator/EndPointLayer.tsx`

- [ ] **Step 1: Copy the pattern of `StartPointLayer` but for the destination**

```tsx
// apps/web/src/app/dev/simulator/EndPointLayer.tsx
'use client';
import { useEffect, useRef } from 'react';
import type maplibregl from 'maplibre-gl';
import { mapInstance } from '@/components/play/MapCanvas';
import type { Position } from '@nemo/shared-types';
import type { SimStatus } from '@/hooks/useSimulatorWorker';

interface Props {
  endPos: Position | null;
  status: SimStatus;
  onChange(pos: Position): void;
}

const SOURCE_ID = 'sim-end-point';
const LAYER_ID = 'sim-end-point-layer';
const RING_ID = 'sim-end-point-ring';

export function EndPointLayer({ endPos, status, onChange }: Props) {
  const clickHandlerRef = useRef<((e: maplibregl.MapMouseEvent) => void) | null>(null);

  useEffect(() => {
    let cancelled = false;
    const install = () => {
      if (cancelled) return;
      const map = mapInstance;
      if (!map || !map.isStyleLoaded()) { setTimeout(install, 200); return; }
      if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
        map.addLayer({
          id: RING_ID, type: 'circle', source: SOURCE_ID,
          paint: { 'circle-radius': 18, 'circle-color': '#d97070', 'circle-opacity': 0.2 },
        });
        map.addLayer({
          id: LAYER_ID, type: 'circle', source: SOURCE_ID,
          paint: {
            'circle-radius': 7, 'circle-color': '#d97070',
            'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2,
          },
        });
      }
    };
    install();
    return () => {
      cancelled = true;
      const map = mapInstance;
      if (!map) return;
      try {
        if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
        if (map.getLayer(RING_ID)) map.removeLayer(RING_ID);
        if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
      } catch { /* teardown race */ }
    };
  }, []);

  useEffect(() => {
    const map = mapInstance;
    if (!map) return;
    const src = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    src.setData({
      type: 'FeatureCollection',
      features: endPos ? [{
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [endPos.lon, endPos.lat] },
        properties: {},
      }] : [],
    });
  }, [endPos]);

  // Shift+click places the end-point — plain click is already used by StartPointLayer.
  useEffect(() => {
    const map = mapInstance;
    if (!map) return;
    if (clickHandlerRef.current) {
      map.off('click', clickHandlerRef.current);
      clickHandlerRef.current = null;
    }
    if (status !== 'idle') return;
    const handler = (e: maplibregl.MapMouseEvent) => {
      if (!e.originalEvent.shiftKey) return;
      onChange({ lat: e.lngLat.lat, lon: e.lngLat.lng });
    };
    map.on('click', handler);
    clickHandlerRef.current = handler;
    return () => {
      map.off('click', handler);
      clickHandlerRef.current = null;
    };
  }, [status, onChange]);

  return null;
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @nemo/web typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/dev/simulator/EndPointLayer.tsx
git commit -m "feat(dev-simulator): end-point marker layer (shift+click to place)"
```

---

### Task 10: Route + Isochrone layers

**Files:**
- Create: `apps/web/src/app/dev/simulator/RouteLayer.tsx`
- Create: `apps/web/src/app/dev/simulator/IsochroneLayer.tsx`

- [ ] **Step 1: Implement `RouteLayer`**

```tsx
// apps/web/src/app/dev/simulator/RouteLayer.tsx
'use client';
import { useEffect } from 'react';
import type maplibregl from 'maplibre-gl';
import { mapInstance } from '@/components/play/MapCanvas';
import type { RoutePlan } from '@nemo/routing';

interface Props {
  routes: Map<string, RoutePlan>;      // boatId -> plan
  colorFor: (boatId: string) => string;
}

export function RouteLayer({ routes, colorFor }: Props) {
  useEffect(() => {
    const map = mapInstance;
    if (!map || !map.isStyleLoaded()) return;

    const seen = new Set<string>();
    for (const [id, plan] of routes) {
      seen.add(id);
      const sourceId = `sim-route-${id}`;
      const layerId  = `sim-route-line-${id}`;
      const color = colorFor(id);
      const feat: GeoJSON.Feature<GeoJSON.LineString> = {
        type: 'Feature', properties: {},
        geometry: { type: 'LineString', coordinates: plan.polyline.map((p) => [p.lon, p.lat]) },
      };
      if (!map.getSource(sourceId)) {
        map.addSource(sourceId, { type: 'geojson', data: feat });
        map.addLayer({
          id: layerId, type: 'line', source: sourceId,
          paint: { 'line-color': color, 'line-width': 2.5, 'line-opacity': 0.85, 'line-dasharray': [2, 2] },
        });
      } else {
        (map.getSource(sourceId) as maplibregl.GeoJSONSource).setData(feat);
      }
    }

    // Remove routes that disappeared
    for (const layerId of map.getStyle().layers?.map((l) => l.id) ?? []) {
      if (!layerId.startsWith('sim-route-line-')) continue;
      const id = layerId.replace('sim-route-line-', '');
      if (seen.has(id)) continue;
      if (map.getLayer(layerId)) map.removeLayer(layerId);
      const srcId = `sim-route-${id}`;
      if (map.getSource(srcId)) map.removeSource(srcId);
    }
  }, [routes, colorFor]);

  return null;
}
```

- [ ] **Step 2: Implement `IsochroneLayer`**

```tsx
// apps/web/src/app/dev/simulator/IsochroneLayer.tsx
'use client';
import { useEffect } from 'react';
import type maplibregl from 'maplibre-gl';
import { mapInstance } from '@/components/play/MapCanvas';
import type { RoutePlan } from '@nemo/routing';

interface Props {
  plan: RoutePlan | null;
  color: string;
}

const SOURCE_ID = 'sim-iso';
const LAYER_ID = 'sim-iso-line';

export function IsochroneLayer({ plan, color }: Props) {
  useEffect(() => {
    const map = mapInstance;
    if (!map) return;
    const install = () => {
      if (!map.isStyleLoaded()) { setTimeout(install, 200); return; }
      const features: GeoJSON.Feature<GeoJSON.LineString>[] = [];
      if (plan) {
        for (let i = 1; i < plan.isochrones.length; i++) {  // skip step 0 (single point)
          const iso = plan.isochrones[i]!;
          if (iso.length < 3) continue;
          const sorted = [...iso].sort((a, b) => {
            // sort by bearing from arrival point to make a closed ring-ish line
            const start = plan.polyline[0]!;
            const bearingA = Math.atan2(a.lon - start.lon, a.lat - start.lat);
            const bearingB = Math.atan2(b.lon - start.lon, b.lat - start.lat);
            return bearingA - bearingB;
          });
          const coords: [number, number][] = sorted.map((p) => [p.lon, p.lat]);
          coords.push(coords[0]!);  // close the loop
          features.push({
            type: 'Feature', properties: { step: i },
            geometry: { type: 'LineString', coordinates: coords },
          });
        }
      }
      const data: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features };
      if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, { type: 'geojson', data });
        map.addLayer({
          id: LAYER_ID, type: 'line', source: SOURCE_ID,
          paint: { 'line-color': color, 'line-width': 1, 'line-opacity': 0.25 },
        });
      } else {
        (map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource).setData(data);
        map.setPaintProperty(LAYER_ID, 'line-color', color);
      }
    };
    install();
  }, [plan, color]);

  return null;
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @nemo/web typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/dev/simulator/RouteLayer.tsx apps/web/src/app/dev/simulator/IsochroneLayer.tsx
git commit -m "feat(dev-simulator): route and isochrone map layers"
```

---

### Task 11: Routing controls and orchestration

**Files:**
- Create: `apps/web/src/app/dev/simulator/RoutingControls.tsx`
- Create: `apps/web/src/app/dev/simulator/RoutingControls.module.css`
- Modify: `apps/web/src/app/dev/simulator/DevSimulatorClient.tsx`

- [ ] **Step 1: Write `RoutingControls.tsx`**

```tsx
// apps/web/src/app/dev/simulator/RoutingControls.tsx
'use client';
import styles from './RoutingControls.module.css';
import type { Preset } from '@nemo/routing';

interface Props {
  preset: Preset;
  onSetPreset(p: Preset): void;
  canRoute: boolean;
  isComputing: boolean;
  onRoute(): void;
  boatIds: string[];
  isoVisibleBoatId: string | null;
  onSetIsoBoat(id: string | null): void;
  primaryColorFor(id: string): string;
}

const PRESETS_ORDER: Preset[] = ['FAST', 'BALANCED', 'HIGHRES'];

export function RoutingControls(p: Props) {
  return (
    <div className={styles.bar}>
      <span className={styles.label}>Preset :</span>
      <div className={styles.group}>
        {PRESETS_ORDER.map((name) => (
          <button
            key={name}
            className={name === p.preset ? styles.btnActive : styles.btn}
            onClick={() => p.onSetPreset(name)}
            disabled={p.isComputing}
          >{name}</button>
        ))}
      </div>

      <button
        className={styles.btnRoute}
        onClick={p.onRoute}
        disabled={!p.canRoute || p.isComputing}
      >
        {p.isComputing ? 'Calcul en cours…' : 'Router tous les bateaux'}
      </button>

      <span className={styles.spacer} />

      <span className={styles.label}>Isos :</span>
      <div className={styles.group}>
        <button
          className={p.isoVisibleBoatId === null ? styles.btnActive : styles.btn}
          onClick={() => p.onSetIsoBoat(null)}
        >Aucun</button>
        {p.boatIds.map((id, i) => (
          <button
            key={id}
            className={p.isoVisibleBoatId === id ? styles.btnActive : styles.btn}
            onClick={() => p.onSetIsoBoat(id)}
            style={{ borderLeft: `3px solid ${p.primaryColorFor(id)}` }}
          >B{i + 1}</button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write the CSS**

```css
/* apps/web/src/app/dev/simulator/RoutingControls.module.css */
.bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  background: #0f2a3d;
  border-top: 1px solid #1a3a52;
  font-family: var(--font-mono);
  font-size: 11px;
  color: #d9c896;
}
.label { opacity: 0.6; letter-spacing: 0.12em; text-transform: uppercase; }
.group { display: flex; gap: 4px; }
.btn, .btnActive, .btnRoute {
  background: transparent; border: 1px solid #2f5a7a; color: #b6c4d0;
  padding: 4px 10px; border-radius: 3px; cursor: pointer;
  font-family: var(--font-mono); font-size: 11px; font-weight: 600;
}
.btn:hover:not(:disabled) { border-color: #c9a557; color: #c9a557; }
.btnActive { background: rgba(201, 165, 87, 0.12); border-color: #c9a557; color: #c9a557; }
.btnRoute { background: #c9a557; color: #0a1f2e; border-color: #c9a557; letter-spacing: 0.08em; text-transform: uppercase; }
.btnRoute:disabled { opacity: 0.35; cursor: not-allowed; }
.spacer { flex: 1; }
```

- [ ] **Step 3: Add routing state and `routeAllBoats` to `DevSimulatorClient`**

In `apps/web/src/app/dev/simulator/DevSimulatorClient.tsx`, add new state near the other `useState` calls:

```tsx
import type { Preset, RoutePlan, RouteInput } from '@nemo/routing';
import { EndPointLayer } from './EndPointLayer';
import { RouteLayer } from './RouteLayer';
import { IsochroneLayer } from './IsochroneLayer';
import { RoutingControls } from './RoutingControls';

// ... inside the component:
const [endPos, setEndPos] = useState<Position | null>(null);
const [routes, setRoutes] = useState<Map<string, RoutePlan>>(new Map());
const [preset, setPreset] = useState<Preset>('BALANCED');
const [routing, setRouting] = useState<{ status: 'idle' | 'computing' | 'done'; error?: string }>({ status: 'idle' });
const [isoVisibleBoatId, setIsoVisibleBoatId] = useState<string | null>(null);
```

Add the `routeAllBoats` handler below `launch`:

```tsx
async function routeAllBoats() {
  if (!endPos || boats.length === 0 || !gameBalanceReady) return;
  setRouting({ status: 'computing' });
  setRoutes(new Map());

  try {
    const classes = Array.from(new Set(boats.map((b) => b.boatClass)));
    const { polars, gameBalanceJson, coastlineGeoJson } = await fetchSimAssets(classes);
    const { windGrid, windData } = await fetchLatestWindGrid();

    const startTimeMs = Date.now();
    const plans = await Promise.all(boats.map((boat) => routeOne({
      input: {
        from: startPos,
        to: endPos,
        startTimeMs,
        polar: polars[boat.boatClass],
        loadout: boat.loadout,
        condition: boat.initialCondition,
        windGrid,
        windData: new Float32Array(windData),  // each worker gets its own copy
        coastlineGeoJson,
        preset,
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

function routeOne(payload: { input: RouteInput; gameBalanceJson: unknown }): Promise<RoutePlan> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../../../workers/routing.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const msg = e.data as { type: 'result'; plan: RoutePlan } | { type: 'error'; message: string };
      if (msg.type === 'result') { resolve(msg.plan); worker.terminate(); }
      else { reject(new Error(msg.message)); worker.terminate(); }
    };
    worker.onerror = (err) => { reject(err); worker.terminate(); };
    worker.postMessage({ type: 'compute', input: payload.input, gameBalanceJson: payload.gameBalanceJson });
  });
}

const boatPalette = ['#c9a557', '#6ba3c9', '#a57cc9', '#7cc9a5', '#c98c6b'];
function colorFor(boatId: string): string {
  if (boatId === primaryId) return boatPalette[0]!;
  const idx = boats.findIndex((b) => b.id === boatId);
  return boatPalette[(idx % (boatPalette.length - 1)) + 1]!;
}
```

Mount the new layers inside `<div className={styles.map}>`, after `<FleetLayer ... />`:

```tsx
<EndPointLayer endPos={endPos} status={status} onChange={setEndPos} />
<RouteLayer routes={routes} colorFor={colorFor} />
<IsochroneLayer
  plan={isoVisibleBoatId ? routes.get(isoVisibleBoatId) ?? null : null}
  color={isoVisibleBoatId ? colorFor(isoVisibleBoatId) : '#c9a557'}
/>
```

Mount `<RoutingControls>` **above** the existing `<SimControlsBar>`:

```tsx
<RoutingControls
  preset={preset}
  onSetPreset={setPreset}
  canRoute={status === 'idle' && endPos !== null && boats.length > 0 && gameBalanceReady}
  isComputing={routing.status === 'computing'}
  onRoute={routeAllBoats}
  boatIds={boats.map((b) => b.id)}
  isoVisibleBoatId={isoVisibleBoatId}
  onSetIsoBoat={setIsoVisibleBoatId}
  primaryColorFor={colorFor}
/>
<SimControlsBar ... />
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @nemo/web typecheck`
Expected: no errors.

- [ ] **Step 5: Browser smoke test**

Run: `pnpm --filter @nemo/web dev`
Open `/dev/simulator`:
- Add 2 Class40 boats (use presets).
- Shift+click a point ~100 NM east of start to place the destination.
- Choose FAST preset, click "Router tous les bateaux".
- After a few seconds you should see 2 dashed polylines on the map and isochrones for the primary boat.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/dev/simulator
git commit -m "feat(dev-simulator): routing controls + orchestration + layers mounted"
```

---

### Task 12: Apply CAP schedule in the `SimulatorEngine`

**Files:**
- Modify: `apps/web/src/lib/simulator/types.ts` — add `schedule` message
- Modify: `apps/web/src/lib/simulator/engine.ts` — add `setSchedule` + apply on tick
- Modify: `apps/web/src/workers/simulator.worker.ts` — route the new message
- Modify: `apps/web/src/app/dev/simulator/DevSimulatorClient.tsx` — post schedule at launch

- [ ] **Step 1: Extend `SimInMessage`**

In `apps/web/src/lib/simulator/types.ts`, add to `SimInMessage`:

```ts
| { type: 'schedule'; boatId: string; entries: Array<{ triggerMs: number; cap: number; sail?: SailId }> }
```

- [ ] **Step 2: Add schedule storage + application in `SimulatorEngine`**

In `apps/web/src/lib/simulator/engine.ts`, add a field and method:

```ts
// Near other private fields:
private schedules: Map<string, Array<{ triggerMs: number; cap: number; sail?: SailId }>> = new Map();

// New method:
setSchedule(boatId: string, entries: Array<{ triggerMs: number; cap: number; sail?: SailId }>): void {
  this.schedules.set(boatId, [...entries].sort((a, b) => a.triggerMs - b.triggerMs));
}
```

In `stepOneTick`, before the per-boat loop that calls `runTick`, fire any pending entries whose `triggerMs <= tickStart`:

```ts
const tickStart = this.simTimeMs + this.startTimeMs;
const tickEnd = tickStart + TICK_MS;

// Apply any scheduled orders whose trigger lies in [tickStart, tickEnd)
for (const [id, entries] of this.schedules) {
  const pbr = this.runtimes.get(id);
  if (!pbr) continue;
  while (entries.length > 0 && entries[0]!.triggerMs <= tickEnd) {
    const entry = entries.shift()!;
    pbr.runtime.segmentState.heading = entry.cap;
    pbr.runtime.segmentState.twaLock = null;
    if (entry.sail) pbr.runtime.segmentState.sail = entry.sail;
  }
}
```

Also clear schedules in `reset()` (optional — keeps them if you want replay):

```ts
reset(): void {
  this.simTimeMs = 0;
  this.stopped = false;
  this.schedules.clear();     // <- new line
  this.buildRuntimes();
  this.emitTick();
}
```

- [ ] **Step 3: Route the `schedule` message in the worker adapter**

In `apps/web/src/workers/simulator.worker.ts`, inside the `switch`:

```ts
case 'schedule':
  engine.setSchedule(msg.boatId, msg.entries);
  break;
```

- [ ] **Step 4: Post schedules at launch in `DevSimulatorClient`**

Inside `launch()`, after `post({ type: 'init', ... })` and before `post({ type: 'start' })`:

```ts
for (const [id, plan] of routes) {
  post({ type: 'schedule', boatId: id, entries: plan.capSchedule });
}
```

- [ ] **Step 5: Typecheck + determinism test**

Run: `pnpm --filter @nemo/web typecheck`
Expected: no errors.
Run: `pnpm --filter @nemo/game-engine-core exec tsx --test ../../apps/web/src/workers/simulator.worker.test.ts`
Expected: pass — determinism preserved.

- [ ] **Step 6: Smoke test**

Launch dev. Same two boats + route from Task 11. Click Lancer. The boats should follow their dashed routes closely as sim time advances.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/simulator apps/web/src/workers/simulator.worker.ts apps/web/src/app/dev/simulator/DevSimulatorClient.tsx
git commit -m "feat(dev-simulator): apply routed CAP schedule in SimulatorEngine"
```

---

### Task 13: Re-router depuis la position courante

**Files:**
- Modify: `apps/web/src/app/dev/simulator/DevSimulatorClient.tsx`

- [ ] **Step 1: Add a `rerouteFromCurrent` handler**

Below `routeAllBoats`, add:

```tsx
async function rerouteFromCurrent() {
  if (!endPos || boats.length === 0 || Object.keys(fleet).length === 0) return;
  setRouting({ status: 'computing' });

  try {
    const classes = Array.from(new Set(boats.map((b) => b.boatClass)));
    const { polars, gameBalanceJson, coastlineGeoJson } = await fetchSimAssets(classes);
    const { windGrid, windData } = await fetchLatestWindGrid();
    const simAbsMs = (launchTimeMs ?? Date.now()) + simTimeMs;

    const plans = await Promise.all(boats.map((boat) => {
      const live = fleet[boat.id];
      const from = live ? live.position : startPos;
      const condition = live ? live.condition : boat.initialCondition;
      return routeOne({
        input: {
          from, to: endPos!, startTimeMs: simAbsMs,
          polar: polars[boat.boatClass], loadout: boat.loadout, condition,
          windGrid, windData: new Float32Array(windData),
          coastlineGeoJson, preset,
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
```

- [ ] **Step 2: Show a button while paused**

Inside the main layout, near the compass overlay, add:

```tsx
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
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @nemo/web typecheck`
Expected: no errors.

- [ ] **Step 4: Smoke test**

Launch the sim at 3600×, pause at ~t=24h, issue a manual CAP 180 via the order panel to force deviation, resume briefly, pause again, click "Re-router depuis ici". The route redraws from current position toward the end marker, and CAPs rebuild to hit the target again.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/dev/simulator/DevSimulatorClient.tsx
git commit -m "feat(dev-simulator): re-router depuis ici pendant pause"
```

---

## Phase 4 — Recette manuelle

### Task 14: Recette scenarios

This task is a walkthrough. Log findings in the PR description; do not edit code unless a defect surfaces.

- [ ] **Scenario A — Straight transfer**

Place start at 47°N/-3°W, end at 47°N/-20°W (west across Bay of Biscay). Add 1 Class40 Petit Temps. Preset BALANCED. Click "Router tous les bateaux". Expected:
- Route reaches the goal (no warning banner).
- Isochrones visible, fan-shaped toward the west.
- ETA coherent (~50-100 h at typical 8-12 kts).

- [ ] **Scenario B — Petit temps vs foiler divergence**

Same start/end as A but add Class40 Petit Temps + Class40 Foiler (both presets). Route them. Expected:
- Two distinct routes on the map.
- Foiler's route likely a curvier path looking for pressure.
- ETA differs by several hours.

- [ ] **Scenario C — Coastline avoidance**

Start in the Bay of Biscay (47°N/-3°W), end on the Spanish coast (43°N/-8°W). Expected:
- Route does not cross land; it curves along the coast.
- `reachedGoal` true.

- [ ] **Scenario D — Unreachable target**

Place end beyond GRIB coverage (e.g., 45°N/-60°W if GRIB stops at -50°W) OR within horizon but unreachable wind. Expected:
- A warning banner: "Cible non atteinte dans la fenêtre de 168h — meilleur effort affiché".
- Route polyline present but doesn't touch the end marker.

- [ ] **Scenario E — Isochrones toggle**

Route 3 different boats. Cycle `Isos: [B1][B2][B3]`. Expected:
- Only the selected boat's iso rings display.
- Toggling "Aucun" hides them.

- [ ] **Scenario F — Launch + follow route**

After Scenario B, click "Lancer la simulation" at 3600×. Expected:
- Both boats follow their dashed routes visibly — real trails track the route within a few NM.
- Compass overlay for primary shows HDG changing at each scheduled entry.
- ETA (if displayed) counts down as sim progresses.

- [ ] **Scenario G — Re-router from pause**

During Scenario F, at t=24h sim, pause. Issue a manual CAP 0° via the order panel to force deviation. Resume for 2h, pause. Click "Re-router depuis ici". Expected:
- New route draws from the now-off-track position to the end marker.
- After resume, boats converge back on the new plan.

- [ ] **Document findings in the PR**

Note any unexpected behavior (surprising ETA, jagged routes, crashes) — file a follow-up issue rather than hotfixing during recette.

---

## Done

Open a PR linked to the spec. Acceptance: all tasks ticked, 10 unit tests green, 7 recette scenarios produce expected output or documented anomalies.
