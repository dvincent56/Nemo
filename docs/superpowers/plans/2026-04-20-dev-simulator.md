# Dev Simulator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a browser-only dev tool at `/dev/simulator` that runs the authoritative game-engine tick in parallel for up to 4 configurable boats with accelerated time, real GFS weather, and a frozen projection overlay to visually validate projection fidelity and loadout impact.

**Architecture:** Extract `apps/game-engine/src/engine/` into a new browser-safe package `@nemo/game-engine-core`. Drive the core from a new `simulator.worker.ts` Web Worker with message-based control (start/pause/reset/setSpeed/order). Compose the screen from existing `play` components (`MapCanvas`, `WindOverlay`, `SwellOverlay`, `Compass`) plus three new panels (Setup left, Comparison right, Controls bottom) and pass `simTimeMs` down so weather overlays animate as sim time advances.

**Tech Stack:** TypeScript strict, Next.js 16 / React 19, Web Workers, Vitest + jsdom for browser tests, node:test for Node tests, pnpm + Turborepo workspace packages, MapLibre GL (existing).

**Reference spec:** [docs/superpowers/specs/2026-04-20-dev-simulator-design.md](../specs/2026-04-20-dev-simulator-design.md)

---

## Phase 1 — Extract `@nemo/game-engine-core`

Goal: move the pure tick logic out of `apps/game-engine` into a shared package so the browser worker can import the same code the server runs.

### Task 1: Create the package skeleton

**Files:**
- Create: `packages/game-engine-core/package.json`
- Create: `packages/game-engine-core/tsconfig.json`
- Create: `packages/game-engine-core/src/index.ts` (empty placeholder)

- [ ] **Step 1: Create `packages/game-engine-core/package.json`**

Mirror the pattern of `packages/polar-lib/package.json` exactly, adding a `./browser` export (like `packages/game-balance`) so the Next.js worker can import without hitting Node builtins:

```json
{
  "name": "@nemo/game-engine-core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "default": "./src/index.ts"
    },
    "./browser": {
      "types": "./src/browser.ts",
      "default": "./src/browser.ts"
    }
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "node --import tsx --test src/**/*.test.ts"
  },
  "dependencies": {
    "@nemo/shared-types": "workspace:*",
    "@nemo/game-balance": "workspace:*",
    "@nemo/polar-lib": "workspace:*",
    "@turf/helpers": "^7.0.0",
    "@turf/nearest-point-on-line": "^7.0.0",
    "@turf/distance": "^7.0.0",
    "@turf/line-intersect": "^7.0.0"
  },
  "devDependencies": {
    "typescript": "^5.7.2",
    "tsx": "^4.19.0"
  }
}
```

- [ ] **Step 2: Create `packages/game-engine-core/tsconfig.json`**

Copy from `packages/polar-lib/tsconfig.json` with identical settings. Confirm it extends the repo base tsconfig.

- [ ] **Step 3: Create placeholder `src/index.ts`**

```ts
// Populated in Task 2.
export {};
```

And `src/browser.ts`:

```ts
// Populated in Task 3.
export {};
```

- [ ] **Step 4: Run workspace install and typecheck**

Run: `pnpm install`
Run: `pnpm --filter @nemo/game-engine-core typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/game-engine-core
git commit -m "chore(game-engine-core): scaffold empty package"
```

---

### Task 2: Move engine files into the new package

**Files:**
- Move: `apps/game-engine/src/engine/{bands,loadout,sails,segments,tick,wear,zones}.ts` → `packages/game-engine-core/src/`
- Move: `apps/game-engine/src/engine/{bands,loadout}.test.ts` → `packages/game-engine-core/src/`
- Keep in place: `apps/game-engine/src/engine/coastline.ts` (handled in Task 3)
- Keep in place: `apps/game-engine/src/engine/manager.ts`, `orders-ingest.ts`, `orders.ts`, `worker.ts`, `worker-bootstrap.mjs` (app-specific, not moved)
- Modify: `apps/game-engine/src/engine/tick.ts` re-export stub if still needed elsewhere (check usages first)

- [ ] **Step 1: Move the 7 pure files and their tests**

```bash
git mv apps/game-engine/src/engine/bands.ts packages/game-engine-core/src/bands.ts
git mv apps/game-engine/src/engine/bands.test.ts packages/game-engine-core/src/bands.test.ts
git mv apps/game-engine/src/engine/loadout.ts packages/game-engine-core/src/loadout.ts
git mv apps/game-engine/src/engine/loadout.test.ts packages/game-engine-core/src/loadout.test.ts
git mv apps/game-engine/src/engine/sails.ts packages/game-engine-core/src/sails.ts
git mv apps/game-engine/src/engine/segments.ts packages/game-engine-core/src/segments.ts
git mv apps/game-engine/src/engine/tick.ts packages/game-engine-core/src/tick.ts
git mv apps/game-engine/src/engine/wear.ts packages/game-engine-core/src/wear.ts
git mv apps/game-engine/src/engine/zones.ts packages/game-engine-core/src/zones.ts
```

- [ ] **Step 2: Update imports inside the moved files**

In `packages/game-engine-core/src/tick.ts`, the original line:

```ts
import type { WeatherProvider } from '../weather/provider.js';
```

Must become (copy the interface into `packages/game-engine-core/src/weather.ts`):

```ts
// packages/game-engine-core/src/weather.ts
export interface WeatherSample {
  tws: number;
  twd: number;
  swh?: number;
  current?: { speed: number; dir: number };
}
export interface WeatherProvider {
  sampleAt(lat: number, lon: number, tMs: number): WeatherSample | null;
  readonly runTs: number;
}
```

Then in `tick.ts` replace the import with:

```ts
import type { WeatherProvider, WeatherSample } from './weather.js';
```

Keep relative imports between the moved files unchanged (they still resolve inside the new package).

- [ ] **Step 3: Update `tick.ts` to accept coastline via injection**

The original `tick.ts` imports coastline helpers directly:

```ts
import { segmentCrossesCoast, coastRiskLevel, isCoastlineLoaded } from './coastline.js';
```

Replace with an injected interface. Add to `packages/game-engine-core/src/tick.ts`:

```ts
export interface CoastlineProbe {
  isLoaded(): boolean;
  segmentCrossesCoast(from: Position, to: Position): Position | null;
  coastRiskLevel(lat: number, lon: number): 0 | 1 | 2 | 3;
}
```

Change the `runTick` signature to take a `coastline: CoastlineProbe` parameter inside its deps object:

```ts
export interface TickDeps {
  polar: Polar;
  weather: WeatherProvider;
  zones: IndexedZone[];
  coastline: CoastlineProbe;
}
export function runTick(runtime: BoatRuntime, deps: TickDeps, tickStartMs: number, tickEndMs: number): TickOutcome { ... }
```

Replace all calls to the imported helpers inside the function with `deps.coastline.segmentCrossesCoast(...)` etc. Remove the direct coastline import.

- [ ] **Step 4: Create `packages/game-engine-core/src/index.ts`**

Replace the placeholder with real exports:

```ts
export { runTick, type BoatRuntime, type TickDeps, type TickOutcome, type CoastlineProbe } from './tick.js';
export { resolveBoatLoadout, aggregateEffects, type BoatLoadout, type UpgradeEffects } from './loadout.js';
export { buildSegments, type SegmentState, type TickSegment } from './segments.js';
export { buildZoneIndex, applyZones, getZonesAtPosition, type IndexedZone } from './zones.js';
export { advanceSailState, detectManeuver, type ManeuverPenaltyState, type SailRuntimeState } from './sails.js';
export { applyWear, computeWearDelta, conditionSpeedPenalty, type ConditionState } from './wear.js';
export { bandFor } from './bands.js';
export type { WeatherProvider, WeatherSample } from './weather.js';
```

- [ ] **Step 5: Run the moved tests**

Run: `pnpm --filter @nemo/game-engine-core test`
Expected: `bands.test.ts` and `loadout.test.ts` pass.

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "refactor(game-engine-core): extract pure engine modules from apps/game-engine"
```

---

### Task 3: Expose coastline geometry in the core, keep Node I/O in the app

**Files:**
- Create: `packages/game-engine-core/src/coastline.ts` (pure geometry functions, no `fs`)
- Modify: `apps/game-engine/src/engine/coastline.ts` (keep I/O, delegate geometry to core)
- Create: `packages/game-engine-core/src/browser.ts` (browser-safe entry — re-exports everything except the Node loader helpers)

- [ ] **Step 1: Create the pure-geometry coastline module**

Copy the geometry portion of the original `apps/game-engine/src/engine/coastline.ts` (all the turf calculations, the spatial index class, `segmentCrossesCoast`, `coastRiskLevel`, `distanceToCoastNm`) into `packages/game-engine-core/src/coastline.ts`. **Remove** the `import { readFileSync } from 'node:fs'` and `import { resolve } from 'node:path'` lines, and remove any function that calls them.

Export a `CoastlineIndex` class instead of free functions keyed on module-level state:

```ts
export interface CoastGeometry {
  segments: CoastSegment[];
}
export class CoastlineIndex {
  private geometry: CoastGeometry | null = null;
  loadFromGeoJson(geojson: GeoJSON.FeatureCollection): void { /* build spatial index */ }
  isLoaded(): boolean { return this.geometry !== null; }
  segmentCrossesCoast(from: Position, to: Position): Position | null { /* existing logic */ }
  coastRiskLevel(lat: number, lon: number): 0 | 1 | 2 | 3 { /* existing logic */ }
  distanceToCoastNm(lat: number, lon: number): number { /* existing logic */ }
}
```

- [ ] **Step 2: Rewrite `apps/game-engine/src/engine/coastline.ts` as a Node wrapper**

Replace its content with:

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CoastlineIndex } from '@nemo/game-engine-core';
import type { Position } from '@nemo/shared-types';

const globalIndex = new CoastlineIndex();

export function loadCoastline(path?: string): void {
  const p = path ?? resolve(process.cwd(), 'apps/web/public/data/coastline.geojson');
  const raw = readFileSync(p, 'utf-8');
  globalIndex.loadFromGeoJson(JSON.parse(raw));
}

export const isCoastlineLoaded = () => globalIndex.isLoaded();
export const segmentCrossesCoast = (from: Position, to: Position) => globalIndex.segmentCrossesCoast(from, to);
export const coastRiskLevel = (lat: number, lon: number) => globalIndex.coastRiskLevel(lat, lon);
export const distanceToCoastNm = (lat: number, lon: number) => globalIndex.distanceToCoastNm(lat, lon);

export { globalIndex as coastlineIndex };
```

- [ ] **Step 3: Add `CoastlineIndex` to the core exports**

In `packages/game-engine-core/src/index.ts`, append:

```ts
export { CoastlineIndex } from './coastline.js';
```

- [ ] **Step 4: Populate `packages/game-engine-core/src/browser.ts`**

Re-export only browser-safe symbols — this is the entry the Next.js worker uses:

```ts
// Browser-safe entry: no fs, no path, no Node built-ins.
// Nothing currently lives only on the Node side — the core is already pure — but
// we keep this separate export path to make future bifurcation explicit.
export * from './index.js';
```

- [ ] **Step 5: Verify the server still boots**

Run: `pnpm --filter @nemo/game-engine tsc --noEmit`
Expected: no errors. Any remaining call sites of `runTick` in `apps/game-engine/src/engine/manager.ts` (or similar) will need to pass `{ coastline: coastlineIndex }` in `TickDeps`. Fix inline.

Run: `pnpm --filter @nemo/game-engine test 2>&1 | head -40` if a test runner is wired, otherwise `pnpm --filter @nemo/game-engine typecheck`.

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "refactor(game-engine-core): split coastline into pure geometry + node I/O wrapper"
```

---

### Task 4: Rewire existing e2e tests against the new package

**Files:**
- Modify: `apps/game-engine/src/test/e2e-tick.ts` (update imports)
- Modify: `apps/game-engine/src/test/e2e-segments.ts` (update imports)

- [ ] **Step 1: Update `e2e-tick.ts` imports**

Change:

```ts
import { runTick, type BoatRuntime } from '../engine/tick.js';
import { resolveBoatLoadout } from '../engine/loadout.js';
import { buildZoneIndex } from '../engine/zones.js';
```

To:

```ts
import { runTick, resolveBoatLoadout, buildZoneIndex, type BoatRuntime, CoastlineIndex } from '@nemo/game-engine-core';
```

Then update the `runTick` call site to pass a `coastline` in the deps bundle:

```ts
const coastline = new CoastlineIndex(); // empty = nothing to hit; acceptable for fixture scenarios
const res = runTick(runtime, { polar, weather, zones, coastline }, tickStart, tickEnd);
```

- [ ] **Step 2: Update `e2e-segments.ts` imports identically**

- [ ] **Step 3: Run both e2e tests**

Run: `pnpm --filter @nemo/game-engine tsx src/test/e2e-tick.ts`
Expected: `✓ Phase 1 e2e OK — <value> NM est.`

Run: `pnpm --filter @nemo/game-engine tsx src/test/e2e-segments.ts`
Expected: the existing pass line.

- [ ] **Step 4: Commit**

```bash
git add apps/game-engine/src/test
git commit -m "test(game-engine): rewire e2e tests against @nemo/game-engine-core"
```

---

### Task 5: Add browser-portability test for the core

**Files:**
- Create: `packages/game-engine-core/src/browser-portability.test.ts`

This is a node:test test that imports from `@nemo/game-engine-core/browser` (not from `./index.js`) and exercises `runTick` in isolation. If anyone later adds a `fs` or `node:*` import to a file that leaks into `browser.ts`, this test will fail at import time.

- [ ] **Step 1: Write the failing test**

```ts
// packages/game-engine-core/src/browser-portability.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('browser entry does not drag node:fs or node:path', async () => {
  // Force re-import with cleared cache is impractical here; instead we assert
  // that the source files of the browser graph contain no banned tokens.
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const files = [
    'src/browser.ts', 'src/index.ts', 'src/tick.ts', 'src/sails.ts',
    'src/segments.ts', 'src/wear.ts', 'src/bands.ts', 'src/zones.ts',
    'src/loadout.ts', 'src/coastline.ts', 'src/weather.ts',
  ];
  for (const rel of files) {
    const content = readFileSync(resolve(rel), 'utf-8');
    assert.ok(!/from ['"]node:/.test(content), `${rel} imports a node: module`);
    assert.ok(!/from ['"]fs['"]/.test(content), `${rel} imports fs`);
    assert.ok(!/from ['"]path['"]/.test(content), `${rel} imports path`);
  }
});

test('runTick runs end-to-end without any coastline I/O', async () => {
  const core = await import('./browser.js');
  assert.equal(typeof core.runTick, 'function');
  assert.equal(typeof core.CoastlineIndex, 'function');
  const coast = new core.CoastlineIndex();
  assert.equal(coast.isLoaded(), false);
});
```

- [ ] **Step 2: Run it and verify both tests pass**

Run: `pnpm --filter @nemo/game-engine-core test`
Expected: `# pass 4` (2 pre-existing + 2 new).

- [ ] **Step 3: Commit**

```bash
git add packages/game-engine-core/src/browser-portability.test.ts
git commit -m "test(game-engine-core): guard browser entry against node builtins"
```

---

## Phase 2 — `simulator.worker.ts`

Goal: a Web Worker that drives `runTick` for up to 4 boats and streams state to the main thread on pause/start/reset/setSpeed/order messages.

### Task 6: Define message protocol

**Files:**
- Create: `apps/web/src/lib/simulator/types.ts`

- [ ] **Step 1: Write the types file**

```ts
// apps/web/src/lib/simulator/types.ts
import type { BoatClass, SailId, Position, Polar } from '@nemo/shared-types';
import type { BoatLoadout, ConditionState } from '@nemo/game-engine-core';

export interface SimBoatSetup {
  id: string;
  name: string;
  boatClass: BoatClass;
  loadout: BoatLoadout;
  initialSail: SailId;
  initialCondition: ConditionState;
}

export interface SimFleetState {
  position: Position;
  heading: number;
  bsp: number;
  twa: number;
  sail: SailId;
  condition: ConditionState;
  distanceNm: number;
}

export type SimOrderKind = 'CAP' | 'TWA' | 'SAIL' | 'MODE';
export interface SimOrder {
  kind: SimOrderKind;
  value: number | SailId | boolean;
}

export type SimSpeedFactor = 600 | 1800 | 3600 | 7200;

export interface WindGrid { /* reuse the existing projection types — import from ../projection/types */ }

export type SimInMessage =
  | { type: 'init'; boats: SimBoatSetup[]; startPos: Position; startTimeMs: number;
      windGrid: unknown; windData: unknown; coastlineGeoJson: unknown;
      polars: Record<BoatClass, Polar>;
      gameBalanceJson: unknown }
  | { type: 'start' }
  | { type: 'pause' }
  | { type: 'reset' }
  | { type: 'setSpeed'; factor: SimSpeedFactor }
  | { type: 'order'; order: SimOrder; triggerSimMs: number };

export type SimOutMessage =
  | { type: 'tick'; simTimeMs: number; fleet: Record<string, SimFleetState> }
  | { type: 'done'; reason: 'grib_exhausted' | 'all_grounded' }
  | { type: 'error'; message: string };
```

Re-use `WindGrid` / `WindData` from `apps/web/src/lib/projection/types.ts` by importing those types rather than redefining them.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @nemo/web typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/simulator/types.ts
git commit -m "feat(simulator): define worker message protocol types"
```

---

### Task 7: Write the simulator worker — determinism test first

**Files:**
- Create: `apps/web/src/workers/simulator.worker.test.ts`

This test will fail until Task 8 lands. Test uses `node:test` + the worker module imported directly (not as a Web Worker — we test the pure loop logic).

- [ ] **Step 1: Refactor worker body into a pure class for testing**

Plan: implementation in Task 8 will live in `apps/web/src/lib/simulator/engine.ts` (pure class `SimulatorEngine`), and `simulator.worker.ts` is a thin adapter that wires `self.onmessage` to engine methods. The test targets the pure class.

- [ ] **Step 2: Add a tiny fixture helper for tests**

Create `apps/web/src/lib/simulator/test-fixtures.ts`:

```ts
// apps/web/src/lib/simulator/test-fixtures.ts
// Read polars and game-balance from disk (Node-only) so tests can build the
// payloads the worker would normally receive from the main thread.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BoatClass, Polar } from '@nemo/shared-types';
import { resolveBoatLoadout } from '@nemo/game-engine-core';
import type { SimBoatSetup } from './types';

export function loadFixturePolars(classes: BoatClass[]): Record<BoatClass, Polar> {
  const out: Record<string, Polar> = {};
  const map: Record<BoatClass, string> = {
    FIGARO: 'figaro.json', CLASS40: 'class40.json', OCEAN_FIFTY: 'ocean-fifty.json',
    IMOCA60: 'imoca60.json', ULTIM: 'ultim.json',
  };
  for (const c of classes) {
    const p = resolve('packages/polar-lib/polars', map[c]);
    out[c] = JSON.parse(readFileSync(p, 'utf-8')) as Polar;
  }
  return out as Record<BoatClass, Polar>;
}

export function loadFixtureGameBalance(): unknown {
  return JSON.parse(readFileSync(resolve('packages/game-balance/game-balance.json'), 'utf-8'));
}

// A minimal 2×2 grid of constant 12 kts from 180° (northerly), covering 48 h.
export function makeConstantWind(): { windGrid: unknown; windData: unknown } {
  const windGrid = {
    lat: [40, 50], lon: [-10, 0],
    timesSec: [0, 3600 * 48],
    runTs: 1_700_000_000,
  };
  const windData = {
    u: [ [0, 0, 0, 0], [0, 0, 0, 0] ],  // size: times × (lat*lon) flattened
    v: [ [-12, -12, -12, -12], [-12, -12, -12, -12] ],
  };
  return { windGrid, windData };
}

export function makeBoat(id: string, boatClass: BoatClass): SimBoatSetup {
  return {
    id, name: id, boatClass,
    loadout: resolveBoatLoadout(`fixture-${id}`, [], boatClass),
    initialSail: 'SPI',
    initialCondition: { hull: 100, rig: 100, sails: 100, electronics: 100 },
  };
}
```

Note: the `windGrid` / `windData` shape must match what `createWindLookup` (in `apps/web/src/lib/projection/windLookup.ts`) expects. Read that file first and adjust the fixture shape to match — the structure above is illustrative but the real field names/layouts are whatever `createWindLookup` consumes.

- [ ] **Step 3: Write the failing test**

```ts
// apps/web/src/workers/simulator.worker.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SimulatorEngine } from '../lib/simulator/engine';
import { loadFixturePolars, loadFixtureGameBalance, makeConstantWind, makeBoat } from '../lib/simulator/test-fixtures';

test('simulator engine is deterministic across reset', async () => {
  const polars = loadFixturePolars(['IMOCA60']);
  const gameBalanceJson = loadFixtureGameBalance();
  const { windGrid, windData } = makeConstantWind();
  const coastlineGeoJson = { type: 'FeatureCollection', features: [] };
  const boats = [makeBoat('a', 'IMOCA60'), makeBoat('b', 'IMOCA60')];
  const startTimeMs = 1_700_000_000_000;

  const events1: any[] = [];
  const sim = new SimulatorEngine((msg) => events1.push(msg));
  await sim.init({ type: 'init', boats, startPos: { lat: 47, lon: -3 }, startTimeMs, windGrid, windData, coastlineGeoJson, polars, gameBalanceJson });
  sim.setSpeed(3600);
  sim.advanceSync(60_000); // 60 s real × 3600 = 60 h sim
  const fleet1 = (events1.filter(e => e.type === 'tick').at(-1)!).fleet;

  sim.reset();
  const events2: any[] = [];
  sim.setListener((msg) => events2.push(msg));
  sim.advanceSync(60_000);
  const fleet2 = (events2.filter(e => e.type === 'tick').at(-1)!).fleet;

  for (const id of Object.keys(fleet1)) {
    assert.deepStrictEqual(fleet2[id].position, fleet1[id].position, `${id} position diverges`);
    assert.equal(fleet2[id].distanceNm, fleet1[id].distanceNm, `${id} distance diverges`);
  }
});
```

- [ ] **Step 4: Run and confirm it fails for the right reason**

Run: `pnpm --filter @nemo/web test apps/web/src/workers/simulator.worker.test.ts`
Expected: FAIL — "Cannot find module '../lib/simulator/engine'".

- [ ] **Step 5: Commit (failing test)**

```bash
git add apps/web/src/workers/simulator.worker.test.ts
git commit -m "test(simulator): add failing determinism test"
```

---

### Task 8: Implement `SimulatorEngine` and the worker adapter

**Files:**
- Create: `apps/web/src/lib/simulator/engine.ts` (pure class, testable in Node)
- Create: `apps/web/src/workers/simulator.worker.ts` (Web Worker adapter)

- [ ] **Step 1: Implement `SimulatorEngine`**

```ts
// apps/web/src/lib/simulator/engine.ts
import {
  runTick, resolveBoatLoadout, buildZoneIndex, CoastlineIndex,
  type BoatRuntime, type CoastlineProbe, type WeatherProvider,
} from '@nemo/game-engine-core/browser';
import { GameBalance } from '@nemo/game-balance/browser';
import { haversineNM } from '@nemo/polar-lib';
import { createWindLookup } from '../projection/windLookup';
import type { BoatClass, Polar, Position } from '@nemo/shared-types';
import type {
  SimInMessage, SimOutMessage, SimBoatSetup, SimFleetState, SimSpeedFactor, SimOrder,
} from './types';

const TICK_MS = 30_000;

type Listener = (msg: SimOutMessage) => void;

interface PerBoatRuntime {
  runtime: BoatRuntime;
  accumulatedNm: number;
  prevPos: Position;
  grounded: boolean;
}

export class SimulatorEngine {
  private listener: Listener;
  private runtimes: Map<string, PerBoatRuntime> = new Map();
  private polars: Map<BoatClass, Polar> = new Map();
  private simTimeMs = 0;
  private startTimeMs = 0;
  private speed: SimSpeedFactor = 1800;
  private coastline = new CoastlineIndex();
  private weatherLookup: ReturnType<typeof createWindLookup> | null = null;
  private initialSetups: SimBoatSetup[] = [];
  private startPos: Position = { lat: 0, lon: 0 };
  private initialized = false;
  private stopped = false;

  constructor(listener: Listener) { this.listener = listener; }
  setListener(l: Listener) { this.listener = l; }

  async init(payload: Extract<SimInMessage, { type: 'init' }>): Promise<void> {
    GameBalance.load(payload.gameBalanceJson);
    for (const [cls, polar] of Object.entries(payload.polars)) {
      this.polars.set(cls as BoatClass, polar);
    }
    this.coastline.loadFromGeoJson(payload.coastlineGeoJson as GeoJSON.FeatureCollection);
    this.weatherLookup = createWindLookup(payload.windGrid as never, payload.windData as never);
    this.startPos = { ...payload.startPos };
    this.startTimeMs = payload.startTimeMs;
    this.initialSetups = payload.boats;
    this.buildRuntimes();
    this.initialized = true;
    this.emitTick();
  }

  start(): void { /* stateless marker — the worker adapter drives advanceSync on an interval */ }
  pause(): void { /* ditto — adapter stops calling advanceSync */ }
  setSpeed(factor: SimSpeedFactor): void { this.speed = factor; }

  reset(): void {
    this.simTimeMs = 0;
    this.stopped = false;
    this.buildRuntimes();
    this.emitTick();
  }

  order(order: SimOrder, triggerSimMs: number): void {
    // Push the same order to every runtime's segmentState. The segment infra in
    // @nemo/game-engine-core handles the transition on the next tick whose window
    // contains triggerSimMs.
    for (const pbr of this.runtimes.values()) {
      applyOrderToSegmentState(pbr.runtime, order, triggerSimMs + this.startTimeMs);
    }
  }

  advanceSync(realMs: number): void {
    if (!this.initialized || this.stopped) return;
    const targetSimMs = this.simTimeMs + realMs * this.speed;
    while (this.simTimeMs + TICK_MS <= targetSimMs && !this.stopped) {
      this.stepOneTick();
    }
    this.emitTick();
  }

  private buildRuntimes(): void {
    this.runtimes.clear();
    for (const setup of this.initialSetups) {
      const boat = {
        id: setup.id, ownerId: 'dev', name: setup.name, boatClass: setup.boatClass,
        position: { ...this.startPos }, heading: 90, bsp: 0, sail: setup.initialSail,
        sailState: 'STABLE' as const,
        hullCondition: setup.initialCondition.hull, rigCondition: setup.initialCondition.rig,
        sailCondition: setup.initialCondition.sails, elecCondition: setup.initialCondition.electronics,
      };
      const rt: BoatRuntime = {
        boat, raceId: 'dev-sim',
        condition: { ...setup.initialCondition },
        sailState: { active: setup.initialSail, pending: null, transitionStartMs: 0, transitionEndMs: 0, autoMode: false, timeOutOfRangeSec: 0 },
        segmentState: { position: { ...this.startPos }, heading: 90, twaLock: null, sail: setup.initialSail, sailAuto: false },
        orderHistory: [],
        zonesAlerted: new Set(),
        loadout: setup.loadout,
        prevTwa: null,
        maneuver: null,
      };
      this.runtimes.set(setup.id, { runtime: rt, accumulatedNm: 0, prevPos: { ...this.startPos }, grounded: false });
    }
  }

  private stepOneTick(): void {
    const probe: CoastlineProbe = {
      isLoaded: () => this.coastline.isLoaded(),
      segmentCrossesCoast: (from, to) => this.coastline.segmentCrossesCoast(from, to),
      coastRiskLevel: (lat, lon) => this.coastline.coastRiskLevel(lat, lon),
    };
    const weather = this.makeWeatherProvider();
    const zones = buildZoneIndex([]);
    const tickStart = this.simTimeMs + this.startTimeMs;
    const tickEnd = tickStart + TICK_MS;

    // Early exit if weather is out of coverage (first runtime probes)
    const sample = this.weatherLookup!(this.startPos.lat, this.startPos.lon, tickStart);
    if (!sample) { this.stopped = true; this.listener({ type: 'done', reason: 'grib_exhausted' }); return; }

    for (const [id, pbr] of this.runtimes) {
      if (pbr.grounded) continue;
      const polar = this.polars.get(pbr.runtime.boat.boatClass);
      if (!polar) throw new Error(`missing polar for ${pbr.runtime.boat.boatClass}`);
      const out = runTick(pbr.runtime, { polar, weather, zones, coastline: probe }, tickStart, tickEnd);
      const newPos = out.runtime.boat.position;
      pbr.accumulatedNm += haversineNM(pbr.prevPos, newPos);
      pbr.prevPos = { ...newPos };
      pbr.runtime = out.runtime;
      if (out.grounded) pbr.grounded = true;
    }
    this.simTimeMs += TICK_MS;

    if ([...this.runtimes.values()].every(p => p.grounded)) {
      this.stopped = true;
      this.listener({ type: 'done', reason: 'all_grounded' });
    }
  }

  private makeWeatherProvider(): WeatherProvider {
    const lookup = this.weatherLookup!;
    return {
      sampleAt: (lat, lon, tMs) => {
        const s = lookup(lat, lon, tMs);
        if (!s) return null;
        return { tws: s.tws, twd: s.twd };
      },
      get runTs() { return 0; },
    };
  }

  private emitTick(): void {
    const fleet: Record<string, SimFleetState> = {};
    for (const [id, pbr] of this.runtimes) {
      fleet[id] = {
        position: { ...pbr.runtime.boat.position },
        heading: pbr.runtime.boat.heading,
        bsp: pbr.runtime.boat.bsp,
        twa: pbr.runtime.prevTwa ?? 0,
        sail: pbr.runtime.boat.sail,
        condition: { ...pbr.runtime.condition },
        distanceNm: Number(pbr.accumulatedNm.toFixed(4)),
      };
    }
    this.listener({ type: 'tick', simTimeMs: this.simTimeMs, fleet });
  }
}

// Helper: plug an incoming user order onto the runtime's segmentState.
// The precise mechanics mirror apps/game-engine/src/engine/orders.ts — read that
// file and replicate the translation from (order.kind, order.value) into updates
// of segmentState.heading / twaLock / sail / sailAuto. Do not re-export orders.ts
// from the core package; keep this helper local so app-side order persistence
// (queues, DB) does not leak into the dev tool.
function applyOrderToSegmentState(rt: BoatRuntime, order: SimOrder, triggerMs: number): void {
  switch (order.kind) {
    case 'CAP':   rt.segmentState.heading = order.value as number; rt.segmentState.twaLock = null; break;
    case 'TWA':   rt.segmentState.twaLock = order.value as number; break;
    case 'SAIL':  rt.segmentState.sail = order.value as BoatRuntime['boat']['sail']; break;
    case 'MODE':  rt.segmentState.sailAuto = order.value as boolean; break;
  }
}
```

**Important details the implementer must get right** (these shape the engine behavior; none are optional):

- `GameBalance.load(payload.gameBalanceJson)` is a side-effect singleton; if the worker is restarted it must re-load.
- The `createWindLookup` call signature depends on `apps/web/src/lib/projection/windLookup.ts` — open that file and type the payload shape in `SimInMessage.init` accordingly instead of `unknown`.
- `WeatherProvider.sampleAt` is called by the core per tick; return `null` to signal out-of-coverage (the caller handles the `grib_exhausted` signal).
- `out.grounded` above assumes `TickOutcome` carries a grounded flag. If the current `TickOutcome` shape does not — check the core `tick.ts` and either (a) add a boolean field to `TickOutcome` as part of Task 2, or (b) detect grounding by comparing `out.runtime.boat.position` against the previous position and re-probing `coastline.segmentCrossesCoast`. Pick the cleaner option and update the types in Phase 1 before finishing this task.
- Keep `applyOrderToSegmentState` minimal as shown; anything more elaborate (order persistence, history in DB) belongs in the server-side orders ingest, not here.

- [ ] **Step 2: Implement the worker adapter**

```ts
// apps/web/src/workers/simulator.worker.ts
/// <reference lib="webworker" />
import { SimulatorEngine } from '../lib/simulator/engine';
import type { SimInMessage, SimOutMessage } from '../lib/simulator/types';

const engine = new SimulatorEngine((msg: SimOutMessage) => self.postMessage(msg));
let loopTimer: ReturnType<typeof setInterval> | null = null;

self.onmessage = async (e: MessageEvent<SimInMessage>) => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case 'init':
        await engine.init(msg);
        break;
      case 'start':
        engine.start();
        if (loopTimer) clearInterval(loopTimer);
        loopTimer = setInterval(() => engine.advanceSync(100), 100);
        break;
      case 'pause':
        engine.pause();
        if (loopTimer) { clearInterval(loopTimer); loopTimer = null; }
        break;
      case 'setSpeed':
        engine.setSpeed(msg.factor);
        break;
      case 'reset':
        engine.reset();
        if (loopTimer) { clearInterval(loopTimer); loopTimer = null; }
        break;
      case 'order':
        engine.order(msg.order, msg.triggerSimMs);
        break;
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) } satisfies SimOutMessage);
  }
};
```

- [ ] **Step 3: Run the determinism test**

Run: `pnpm --filter @nemo/web test apps/web/src/workers/simulator.worker.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/simulator apps/web/src/workers/simulator.worker.ts
git commit -m "feat(simulator): implement pure engine class + worker adapter"
```

---

## Phase 3 — `simTimeMs` prop for live weather overlays

Goal: decouple overlay sampling time from wall clock so overlays animate with the sim.

### Task 9: Add `simTimeMs` prop to `MapCanvas` and wire to overlays

**Files:**
- Modify: `apps/web/src/components/play/MapCanvas.tsx`
- Modify: `apps/web/src/components/play/WindOverlay.tsx`
- Modify: `apps/web/src/components/play/SwellOverlay.tsx`
- Modify: `apps/web/src/components/play/Compass.tsx` (optional — for TWS/TWD readout)

- [ ] **Step 1: Read `MapCanvas` props today**

Run: `head -80 apps/web/src/components/play/MapCanvas.tsx` — note the current prop shape.

- [ ] **Step 2: Add optional `simTimeMs` prop**

In the `MapCanvas` props interface, add:

```ts
interface MapCanvasProps {
  /* ...existing... */
  /** Override the wall-clock time used to sample weather overlays. Defaults to Date.now(). */
  simTimeMs?: number;
}
```

Replace every `Date.now()` inside the MapCanvas that drives weather sampling with:

```ts
const nowMs = simTimeMs ?? Date.now();
```

Pass `nowMs` to `WindOverlay` and `SwellOverlay`.

- [ ] **Step 3: Accept `nowMs` in the overlays**

Each overlay currently resolves time internally. Change to accept `nowMs` from props. Fall back to `Date.now()` if undefined (preserves production behavior).

- [ ] **Step 4: Verify prod `/play` still renders**

Run: `pnpm --filter @nemo/web dev` (if not already), open `/play/<raceId>` — the wind arrows should still move on wall-clock time. Typecheck:

Run: `pnpm --filter @nemo/web typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/play
git commit -m "feat(play): accept simTimeMs prop on MapCanvas and overlays"
```

---

## Phase 4 — `DevSimulatorClient` UI

Goal: compose the screen at `/dev/simulator` with setup, map, comparison, and controls panels.

### Task 10: Create the dev-gated route

**Files:**
- Create: `apps/web/src/app/dev/simulator/page.tsx`
- Create: `apps/web/src/app/dev/simulator/DevSimulatorClient.tsx` (placeholder, populated in later tasks)

- [ ] **Step 1: Create the page with dev gate**

```tsx
// apps/web/src/app/dev/simulator/page.tsx
import { notFound } from 'next/navigation';
import { DevSimulatorClient } from './DevSimulatorClient';

export default function DevSimulatorPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <DevSimulatorClient />;
}
```

- [ ] **Step 2: Create the placeholder client**

```tsx
// apps/web/src/app/dev/simulator/DevSimulatorClient.tsx
'use client';
export function DevSimulatorClient() {
  return <div style={{ padding: 40, color: '#d9c896' }}>Dev Simulator — coming online.</div>;
}
```

- [ ] **Step 3: Verify the route serves in dev**

Run: `pnpm --filter @nemo/web dev`
Open: `http://localhost:3000/dev/simulator`
Expected: "Dev Simulator — coming online." visible.

Stop dev, temporarily set `NODE_ENV=production`, rebuild:

Run: `NODE_ENV=production pnpm --filter @nemo/web build && NODE_ENV=production pnpm --filter @nemo/web start` — open the same URL. Expected: 404.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/dev
git commit -m "feat(dev-simulator): scaffold route with production 404 gate"
```

---

### Task 11: Build the Setup panel

**Files:**
- Create: `apps/web/src/app/dev/simulator/SetupPanel.tsx`
- Create: `apps/web/src/app/dev/simulator/SetupPanel.module.css`
- Create: `apps/web/src/app/dev/simulator/BoatSetupModal.tsx` (add/edit boat form)
- Create: `apps/web/src/app/dev/simulator/BoatSetupModal.module.css`
- Modify: `apps/web/src/app/dev/simulator/DevSimulatorClient.tsx` (mount the panel)

- [ ] **Step 1: Write the SetupPanel component**

Reads `boats: SimBoatSetup[]` and `primaryId: string | null` from parent state. Renders:
- "Bateaux (N/4)" header
- One card per boat with: name, class, loadout summary (first 3 upgrades with level), condition summary, primary radio button, Edit button, Delete button
- "+ Ajouter un bateau" button (disabled when `boats.length >= 4`)
- Start section: "47.00°N · 3.00°W (Bay of Biscay)" and "GFS run: <formatted ts>" (both read-only)

Emits callbacks: `onAddBoat()`, `onEditBoat(id)`, `onDeleteBoat(id)`, `onSetPrimary(id)`.

When the simulation is running (passed down as `locked: boolean`), the panel switches to a compact read-only mode showing just `<N> bateaux en course`.

- [ ] **Step 2: Write the BoatSetupModal**

A dialog (can use native `<dialog>` or a simple absolute-positioned overlay — match any pre-existing modal pattern in the codebase; search `apps/web/src/components` for one before rolling your own).

Form fields:
- Nom (text, optional, default `Bateau N`)
- Classe (select: CLASS40, IMOCA60, OCEAN_FIFTY, ULTIM, FIGARO)
- Voile initiale (select, options filtered by class polars)
- Loadout — accordion per category (coque, gréement, foils, quille, électronique, voilerie), each with a level selector 0..max. Default all level 0. Use the same category list as the marina screen — import from wherever the marina screen declares it (likely `apps/web/src/lib/marina` or similar; grep to find it).
- Conditions — 4 number inputs hull/rig/sails/electronics 0-100, default 100

"Enregistrer" button emits the complete `SimBoatSetup` via `onSave(setup)`.

- [ ] **Step 3: Mount `SetupPanel` inside `DevSimulatorClient`**

Update `DevSimulatorClient.tsx`:

```tsx
'use client';
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
    <div className="sim-grid">
      <SetupPanel
        boats={boats}
        primaryId={primaryId}
        locked={false}
        onAddBoat={() => { setEditingId(null); setModalOpen(true); }}
        onEditBoat={(id) => { setEditingId(id); setModalOpen(true); }}
        onDeleteBoat={(id) => setBoats(prev => prev.filter(b => b.id !== id))}
        onSetPrimary={setPrimaryId}
      />
      {/* map and right panel to come */}
      {modalOpen && (
        <BoatSetupModal
          initial={editingId ? boats.find(b => b.id === editingId) ?? null : null}
          onClose={() => setModalOpen(false)}
          onSave={(setup) => {
            setBoats(prev => {
              const others = prev.filter(b => b.id !== setup.id);
              return [...others, setup].slice(0, 4);
            });
            if (!primaryId) setPrimaryId(setup.id);
            setModalOpen(false);
          }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Manual smoke test**

Run dev, open `/dev/simulator`. Add 2 boats of different classes. Verify primary radio moves. Verify delete works. Verify cap at 4 disables the add button.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/dev/simulator
git commit -m "feat(dev-simulator): setup panel with add/edit/delete boats"
```

---

### Task 12: Build the Controls bar and wire the worker

**Files:**
- Create: `apps/web/src/app/dev/simulator/SimControlsBar.tsx`
- Create: `apps/web/src/app/dev/simulator/SimControlsBar.module.css`
- Create: `apps/web/src/hooks/useSimulatorWorker.ts`
- Modify: `apps/web/src/app/dev/simulator/DevSimulatorClient.tsx`

- [ ] **Step 1: Create the worker hook**

```ts
// apps/web/src/hooks/useSimulatorWorker.ts
import { useEffect, useRef, useState } from 'react';
import type { SimInMessage, SimOutMessage, SimFleetState } from '@/lib/simulator/types';

export function useSimulatorWorker() {
  const workerRef = useRef<Worker | null>(null);
  const [simTimeMs, setSimTimeMs] = useState(0);
  const [fleet, setFleet] = useState<Record<string, SimFleetState>>({});
  const [status, setStatus] = useState<'idle'|'running'|'paused'|'done'>('idle');
  const [doneReason, setDoneReason] = useState<string | null>(null);

  useEffect(() => {
    const w = new Worker(new URL('../workers/simulator.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<SimOutMessage>) => {
      const msg = e.data;
      if (msg.type === 'tick') { setSimTimeMs(msg.simTimeMs); setFleet(msg.fleet); }
      else if (msg.type === 'done') { setStatus('done'); setDoneReason(msg.reason); }
      else if (msg.type === 'error') { console.error('[sim]', msg.message); }
    };
    workerRef.current = w;
    return () => w.terminate();
  }, []);

  const post = (m: SimInMessage) => workerRef.current?.postMessage(m);

  return { simTimeMs, fleet, status, doneReason, post, setStatus };
}
```

- [ ] **Step 2: Create the `SimControlsBar` component**

Props: `status`, `speed`, `onLaunch`, `onPause`, `onResume`, `onSetSpeed`, `onResetSoft`, `onResetHard`.

- When `status === 'idle'`: shows big "▶ Lancer la simulation" button.
- When `status === 'running'`: "❚❚ Pause" primary button.
- When `status === 'paused'`: "▶ Reprendre" primary button.
- Always: 4 speed buttons (600/1800/3600/7200) with the current one highlighted in gold.
- Always: "⟲ Relancer (t=0)" button (disabled when status === 'idle').
- Always: "Nouvelle simu" button.

- [ ] **Step 3: Wire into `DevSimulatorClient`**

On "Lancer":
1. Compute the set of distinct `boatClass` values across `boats[]`.
2. In parallel, fetch:
   - `/data/coastline.geojson` → `coastlineGeoJson`
   - `/data/game-balance.json` → `gameBalanceJson`
   - `/data/polars/<class>.json` for each distinct class → assemble into `polars: Record<BoatClass, Polar>`
   - The current wind grid + data: open `apps/web/src/hooks/useProjectionLine.ts` and reuse the exact code path that fetches `windGrid` + `windData` (they are already served from `/data/weather/*` by the GFS pipeline). Extract this into a shared helper `fetchLatestWindGrid()` in `apps/web/src/lib/projection/` if it is not already exported — the dev simulator hook will import it.
3. `post({ type: 'init', boats, startPos: { lat: 47, lon: -3 }, startTimeMs: Date.now(), windGrid, windData, coastlineGeoJson, polars, gameBalanceJson })`.
4. `post({ type: 'setSpeed', factor: speed })`.
5. `post({ type: 'start' })`.
6. Set `status = 'running'` and `locked = true`.

On "Pause": `post({ type: 'pause' })`, `status = 'paused'`.
On "Reprendre": `post({ type: 'start' })`, `status = 'running'`.
On "Relancer": `post({ type: 'reset' })`, `post({ type: 'start' })`, keep boats, clear orders.
On "Nouvelle simu": terminate the worker (let the hook re-create it on next mount via a remount key), clear all state.

- [ ] **Step 4: Manual smoke test**

Add 2 CLASS40 boats. Click Lancer. Verify the bottom bar switches to Pause, verify `simTimeMs` increments visibly (even without the map, wire a small `<div>{simTimeMs}</div>` to eyeball it).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/hooks/useSimulatorWorker.ts apps/web/src/app/dev/simulator
git commit -m "feat(dev-simulator): controls bar + worker hook integration"
```

---

### Task 13: Mount the map and stream fleet positions

**Files:**
- Modify: `apps/web/src/app/dev/simulator/DevSimulatorClient.tsx`
- Create: `apps/web/src/app/dev/simulator/FleetLayer.tsx`

- [ ] **Step 1: Embed `MapCanvas` with `simTimeMs`**

```tsx
<MapCanvas simTimeMs={simTimeMs > 0 ? simTimeMs + startTimeMsRef.current : undefined} />
```

(MapCanvas expects a real-world timestamp, but the worker streams sim-elapsed ms from 0. Convert by adding the `startTimeMs` recorded at launch.)

- [ ] **Step 2: Draw boats + trails on the map**

Create a `FleetLayer` component that subscribes to the map instance (via a ref exposed by MapCanvas — add one if missing) and maintains two GeoJSON sources per boat:
- `sim-boat-<id>` — current position, Point
- `sim-trail-<id>` — full trail so far, LineString

Update these sources inside a `useEffect` watching `fleet`. Colors:
- Primary: `#c9a557` (gold)
- Others: cycle through `#6ba3c9` (blue), `#a57cc9` (purple), `#7cc9a5` (green)

Keep the in-memory `trails: Map<id, Position[]>` in `DevSimulatorClient` state; each `tick` appends the latest position if it moved more than a tiny epsilon (avoid spam during pause).

- [ ] **Step 3: Verify visually**

Two CLASS40 boats, 3600×. The two dots should appear on the map, leave identical trails, diverge nowhere.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/dev/simulator
git commit -m "feat(dev-simulator): mount map and draw fleet positions + trails"
```

---

### Task 14: Build the Comparison panel

**Files:**
- Create: `apps/web/src/app/dev/simulator/ComparisonPanel.tsx`
- Create: `apps/web/src/app/dev/simulator/ComparisonPanel.module.css`
- Modify: `apps/web/src/app/dev/simulator/DevSimulatorClient.tsx`

- [ ] **Step 1: Implement the panel**

Props: `boats`, `fleet`, `primaryId`, `projectionDeviationNm: number | null`.

For each boat in `boats`, render a card (left border color matches the map dot color). Inside each card:
- Name + class + currently active sail
- Rows: BSP (kts), TWA (°), Distance (NM)
- Only for primary: highlighted row "Δ projection" with the current deviation in NM.

Empty state before launch: "— kts" placeholders.

- [ ] **Step 2: Compute projection deviation in `DevSimulatorClient`**

Add state `projectionLine: ProjectionResult | null` and `projectionDeviationNm: number | null`.
On each fleet tick where primary exists and `projectionLine !== null`:
- Linear-interpolate the projection polyline at `simTimeMs` to get `projectedPos`.
- `deviation = haversineNM(fleet[primaryId].position, projectedPos)`.
- Set `projectionDeviationNm`.

Helper:

```ts
function projectionAt(result: ProjectionResult, simElapsedMs: number): Position {
  const target = simElapsedMs; // projection timestamps are already relative to start
  const pts = result.points;
  // binary search is fine, but projection points are < 10k so linear is acceptable
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].timestamp >= target) {
      const a = pts[i - 1], b = pts[i];
      const t = (target - a.timestamp) / (b.timestamp - a.timestamp || 1);
      return { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t };
    }
  }
  return pts.at(-1)!;
}
```

- [ ] **Step 3: Freeze the projection at launch**

Before posting `init` to the sim worker, post a `compute` message to the existing `projection.worker.ts` with the primary boat's setup + wind grid + initial orders (none yet — empty `segments`). When the result comes back, store it in `projectionLine` and draw it as a dashed gold line on the map (add a `projection-line` GeoJSON source similar to Task 13).

- [ ] **Step 4: Manual test**

Two identical IMOCA60 boats. Launch. Verify Δ projection stays near 0 for the primary.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/dev/simulator
git commit -m "feat(dev-simulator): comparison panel + frozen projection + deviation metric"
```

---

### Task 15: Order input + history

**Files:**
- Create: `apps/web/src/app/dev/simulator/OrderInput.tsx`
- Create: `apps/web/src/app/dev/simulator/OrderHistory.tsx`
- Modify: `apps/web/src/app/dev/simulator/SetupPanel.tsx` (when locked, shows OrderHistory + OrderInput)

- [ ] **Step 1: `OrderInput`**

Form with radio CAP / TWA / SAIL / MODE. Depending on the choice:
- CAP: number input 0-359
- TWA: number input -180..180
- SAIL: dropdown of polars available for the primary boat's class
- MODE: toggle "auto-sail"

Two buttons: "OK" (emits order) and "Annuler" (clears form).

"OK" flows through `DevSimulatorClient.handleOrder(order)` which:
1. `post({ type: 'order', order, triggerSimMs: simTimeMs })`
2. Appends to `orderHistory: { simTimeMs, order }[]`

- [ ] **Step 2: `OrderHistory`**

Renders `orderHistory` as a list: `t=<Xh><Ym> · CAP 090°` etc. Most recent at the bottom.

- [ ] **Step 3: Wire into `SetupPanel` locked state**

When `locked=true`, replace the bateau cards with: small header "4 bateaux en course", then `<OrderHistory />`, then `<OrderInput />`.

- [ ] **Step 4: Manual test**

Launch, give a CAP 120° order at t=2h, verify:
- The history entry appears
- The next few `tick` messages show boats heading toward 120°
- The primary's Δ projection starts growing (the projection at t=0 didn't know about this order)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/dev/simulator
git commit -m "feat(dev-simulator): order input + history during running sim"
```

---

### Task 16: Layout polish and Compass overlay

**Files:**
- Create: `apps/web/src/app/dev/simulator/DevSimulator.module.css`
- Modify: `apps/web/src/app/dev/simulator/DevSimulatorClient.tsx`

- [ ] **Step 1: Apply the grid layout**

```css
.simGrid {
  display: grid;
  grid-template-columns: 280px 1fr 300px;
  grid-template-rows: 1fr 80px;
  height: 100vh;
  background: #0a1f2e;
  gap: 1px;
}
.setup { grid-column: 1; grid-row: 1; overflow-y: auto; }
.map { grid-column: 2; grid-row: 1; position: relative; }
.comparison { grid-column: 3; grid-row: 1; overflow-y: auto; }
.controls { grid-column: 1 / -1; grid-row: 2; }
```

- [ ] **Step 2: Overlay compass on the map**

Reuse the existing `<Compass />` component, pass it the primary boat's TWA/TWS/HDG from `fleet[primaryId]`. Position it absolutely top-right inside the map container (matches the mockup).

- [ ] **Step 3: Sim time readout overlay**

Bottom-left of the map, an absolute div:

```
Sim time : t=12h00 · <formatted real UTC time = startTimeMs + simTimeMs>
```

- [ ] **Step 4: Visual check vs. the mockup**

Open the brainstorm mockup at `.superpowers/brainstorm/*/content/layout.html` side by side with `/dev/simulator`. Fix any obvious layout drift inline.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/dev/simulator
git commit -m "feat(dev-simulator): apply grid layout and compass overlay"
```

---

## Phase 5 — Manual recette

### Task 17: Walk the five recette scenarios

This task is not code; it is a walkthrough. Log results in the PR description.

- [ ] **Scenario 1 — Determinism**

Add 2 identical IMOCA60 boats (same loadout, same conditions). Launch at 3600×. Let it run for at least 10 sim-hours. Expected: the two trails overlap visually. The two `distanceNm` values stay within 0.01 NM.

- [ ] **Scenario 2 — Loadout impact**

Add 2 IMOCA60, one with Foils level 0 / Coque level 0, the other with Foils level 2 / Coque level 3. Launch. Expected: monotonic divergence — the upgraded boat pulls ahead steadily.

- [ ] **Scenario 3 — Global order**

Launch with 4 boats of mixed classes on CAP 090. At t=6h sim, issue CAP 180. Expected: all 4 boats turn south on the same tick.

- [ ] **Scenario 4 — Pause and reset-soft**

Launch, let run to t=12h, Pause. Verify `simTimeMs` stops incrementing. Click "⟲ Relancer (t=0)". Expected: trails clear, boats return to start, `simTimeMs = 0`, orderHistory clears.

- [ ] **Scenario 5 — Projection fidelity**

One CLASS40 at full condition, no upgrades, default sail. Launch, no orders given. Run to t=72h. Expected: `Δ projection` stays within a few NM — if it exceeds ~10 NM, there is a genuine projection bug to investigate and flag in the PR.

- [ ] **Document results in the PR**

For each scenario, record the observed values and any surprises. Include a screenshot of the final state if a scenario revealed something noteworthy.

---

## Done

Open a PR linked to the spec. The acceptance bar is: all tasks ticked, all recette scenarios produce the expected result (or flag any unexpected projection drift for a follow-up investigation issue).
