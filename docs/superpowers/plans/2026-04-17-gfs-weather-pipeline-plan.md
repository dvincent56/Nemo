# GFS Weather Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete NOAA GFS 0.25° weather pipeline — from GRIB2 ingestion through Redis, 1h blending in the game engine, binary REST endpoint, and frontend prefetch with GFS status indicator.

**Architecture:** Python weather-engine container polls NOAA every 5min, downloads GRIB2 files, parses U/V + wave data, stores as Float32Array in Redis keyed by run timestamp. Game engine subscribes to Redis pub/sub, maintains 2 grids in memory for 1h linear blending. Fastify serves a binary REST endpoint for frontend visualization. Frontend prefetches f000–f048 at auth time, f048–f240 on /play mount.

**Tech Stack:** Python 3.11 (cfgrib, xarray, numpy, redis), TypeScript (Fastify, ioredis), React (Zustand), Docker, Redis 7

**Spec:** `docs/superpowers/specs/2026-04-17-gfs-weather-pipeline-design.md`

---

## File Structure

### Modified files
- `apps/game-engine/src/weather/grid.ts` — switch from TWS/TWD to U/V storage, add linear temporal interpolation
- `apps/game-engine/src/weather/provider.ts` — add blending support (3 modes: fixture, noaa-single, noaa-blending)
- `apps/game-engine/src/weather/build-fixture.ts` — update fixture to use U/V format
- `apps/game-engine/fixtures/weather-grid.json` — regenerated from updated build-fixture
- `apps/game-engine/src/engine/worker.ts` — switch to NOAA provider when configured
- `apps/game-engine/src/index.ts` — add weather REST endpoint + status endpoint
- `apps/weather-engine/src/nemo_weather/ingest.py` — complete implementation
- `apps/weather-engine/pyproject.toml` — add schedule dependency
- `apps/weather-engine/README.md` — update with final architecture
- `apps/web/src/components/play/LayersWidget.tsx` — add GFS status text
- `apps/web/src/lib/store/weatherSlice.ts` — add prefetch state and actions
- `apps/web/src/lib/store/types.ts` — add weather status types
- `docker-compose.dev.yml` — add weather-engine service
- `.env.example` — add weather-engine env vars

### New files
- `apps/game-engine/src/weather/blend.ts` — blending logic (lerp between two grids)
- `apps/game-engine/src/weather/grid-uv.ts` — U/V grid type and conversion helpers
- `apps/game-engine/src/weather/binary-encoder.ts` — encode grid subset to ArrayBuffer
- `apps/game-engine/src/weather/__tests__/blend.test.ts` — blend unit tests
- `apps/game-engine/src/weather/__tests__/grid-uv.test.ts` — U/V grid tests
- `apps/game-engine/src/weather/__tests__/binary-encoder.test.ts` — encoder tests
- `apps/game-engine/src/weather/__tests__/provider-blend.test.ts` — provider integration tests
- `apps/game-engine/src/routes/weather.ts` — Fastify route for weather grid + status
- `apps/weather-engine/src/nemo_weather/poller.py` — NOAA availability polling loop
- `apps/weather-engine/src/nemo_weather/grid_builder.py` — grid building + wave re-interpolation
- `apps/weather-engine/src/nemo_weather/persistence.py` — Redis push + disk fallback
- `apps/weather-engine/tests/test_poller.py` — poller unit tests
- `apps/weather-engine/tests/test_grid_builder.py` — grid builder tests
- `apps/weather-engine/tests/test_persistence.py` — persistence tests
- `apps/weather-engine/Dockerfile` — Docker image with libeccodes
- `apps/web/src/lib/weather/prefetch.ts` — background prefetch logic
- `apps/web/src/lib/weather/binaryDecoder.ts` — decode ArrayBuffer to typed grid
- `apps/web/src/hooks/useWeatherPrefetch.ts` — hook for global prefetch
- `apps/web/src/hooks/useGfsStatus.ts` — hook for GFS status polling

---

## Task 1: U/V Grid Type and Conversion Helpers

**Files:**
- Create: `apps/game-engine/src/weather/grid-uv.ts`
- Create: `apps/game-engine/src/weather/__tests__/grid-uv.test.ts`

The current grid stores TWS/TWD. The spec requires U/V storage for correct blending. This task creates the new type and conversion helpers.

- [ ] **Step 1: Write failing tests for U/V ↔ TWS/TWD conversion**

```typescript
// apps/game-engine/src/weather/__tests__/grid-uv.test.ts
import { describe, it, expect } from 'vitest';
import { uvToTwsTwd, twsTwdToUv } from '../grid-uv.js';

describe('uvToTwsTwd', () => {
  it('converts north wind (v=-10, u=0) to TWS=10, TWD=0°', () => {
    const { tws, twd } = uvToTwsTwd(0, -10);
    expect(tws).toBeCloseTo(10, 4);
    expect(twd).toBeCloseTo(0, 1);
  });

  it('converts west wind (u=5, v=0) to TWS=5, TWD=270°', () => {
    const { tws, twd } = uvToTwsTwd(5, 0);
    expect(tws).toBeCloseTo(5, 4);
    expect(twd).toBeCloseTo(270, 1);
  });

  it('converts SW wind (u=7.07, v=7.07) to TWS≈10, TWD≈225°', () => {
    const { tws, twd } = uvToTwsTwd(7.07107, 7.07107);
    expect(tws).toBeCloseTo(10, 2);
    expect(twd).toBeCloseTo(225, 1);
  });
});

describe('twsTwdToUv', () => {
  it('roundtrips through uvToTwsTwd', () => {
    const { u, v } = twsTwdToUv(15, 135);
    const { tws, twd } = uvToTwsTwd(u, v);
    expect(tws).toBeCloseTo(15, 4);
    expect(twd).toBeCloseTo(135, 1);
  });
});

describe('mwd decomposition', () => {
  it('decomposes 45° into sin/cos components', () => {
    const rad = (45 * Math.PI) / 180;
    expect(Math.sin(rad)).toBeCloseTo(0.7071, 3);
    expect(Math.cos(rad)).toBeCloseTo(0.7071, 3);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/game-engine && npx vitest run src/weather/__tests__/grid-uv.test.ts`
Expected: FAIL — module `../grid-uv.js` not found

- [ ] **Step 3: Implement U/V conversion helpers**

```typescript
// apps/game-engine/src/weather/grid-uv.ts

/**
 * U/V wind components (meteorological convention):
 *   u = east-west component (positive = from west = blowing east)
 *   v = north-south component (positive = from south = blowing north)
 * TWD = direction wind is coming FROM (compass degrees)
 */

export interface UvPoint {
  u: number;
  v: number;
}

export interface TwsTwdPoint {
  tws: number;
  twd: number;
}

/** Convert U/V components to TWS (knots or m/s — same unit) and TWD (degrees compass). */
export function uvToTwsTwd(u: number, v: number): TwsTwdPoint {
  const tws = Math.sqrt(u * u + v * v);
  // Wind comes FROM: add 180° to the direction it blows towards
  const twd = ((Math.atan2(-u, -v) * 180) / Math.PI + 360) % 360;
  return { tws, twd };
}

/** Convert TWS/TWD to U/V components. */
export function twsTwdToUv(tws: number, twd: number): UvPoint {
  const rad = (twd * Math.PI) / 180;
  return {
    u: -tws * Math.sin(rad),
    v: -tws * Math.cos(rad),
  };
}

/** Decompose an angle (degrees) into sin/cos components for wraparound-safe interpolation. */
export function decomposeAngle(deg: number): { sinC: number; cosC: number } {
  const rad = (deg * Math.PI) / 180;
  return { sinC: Math.sin(rad), cosC: Math.cos(rad) };
}

/** Recompose sin/cos components back to degrees [0, 360). */
export function recomposeAngle(sinC: number, cosC: number): number {
  return ((Math.atan2(sinC, cosC) * 180) / Math.PI + 360) % 360;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/game-engine && npx vitest run src/weather/__tests__/grid-uv.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/game-engine/src/weather/grid-uv.ts apps/game-engine/src/weather/__tests__/grid-uv.test.ts
git commit -m "feat(weather): add U/V ↔ TWS/TWD conversion helpers"
```

---

## Task 2: Refactor Grid to Store U/V Instead of TWS/TWD

**Files:**
- Modify: `apps/game-engine/src/weather/grid.ts`
- Modify: `apps/game-engine/src/weather/build-fixture.ts`

The grid currently stores 5 Float32Arrays: tws, twd, swh, mwd, mwp. We switch to 6 arrays: u, v, swh, mwdSin, mwdCos, mwp. The `getForecastAt()` function converts back to WeatherPoint at read time.

- [ ] **Step 1: Write failing test for new grid format**

```typescript
// Add to apps/game-engine/src/weather/__tests__/grid-uv.test.ts
import { getForecastAt, type WeatherGridUV, type WeatherGridUVMeta } from '../grid.js';

describe('getForecastAt with U/V grid', () => {
  it('returns correct TWS/TWD from U/V storage', () => {
    // Minimal 2x2 grid, 1 forecast hour, north wind 10 kts everywhere
    const meta: WeatherGridUVMeta = {
      runTs: 1000000,
      bbox: { latMin: 0, latMax: 0.25, lonMin: 0, lonMax: 0.25 },
      resolution: 0.25,
      shape: { rows: 2, cols: 2 },
      forecastHours: [0],
    };
    const grid: WeatherGridUV = {
      ...meta,
      u: new Float32Array([0, 0, 0, 0]),       // no east-west component
      v: new Float32Array([-10, -10, -10, -10]), // from north
      swh: new Float32Array([2, 2, 2, 2]),
      mwdSin: new Float32Array([0, 0, 0, 0]),   // sin(0°) = 0
      mwdCos: new Float32Array([1, 1, 1, 1]),   // cos(0°) = 1
      mwp: new Float32Array([8, 8, 8, 8]),
    };
    const wp = getForecastAt(grid, 0.1, 0.1, 1000000);
    expect(wp.tws).toBeCloseTo(10, 1);
    expect(wp.twd).toBeCloseTo(0, 1); // north wind
    expect(wp.swh).toBeCloseTo(2, 1);
    expect(wp.mwd).toBeCloseTo(0, 1);
    expect(wp.mwp).toBeCloseTo(8, 1);
  });

  it('interpolates temporally between two forecast hours', () => {
    const meta: WeatherGridUVMeta = {
      runTs: 0,
      bbox: { latMin: 0, latMax: 0, lonMin: 0, lonMax: 0 },
      resolution: 0.25,
      shape: { rows: 1, cols: 1 },
      forecastHours: [0, 6],
    };
    // f000: 10kts from north (u=0, v=-10)
    // f006: 10kts from east (u=-10, v=0)
    const grid: WeatherGridUV = {
      ...meta,
      u: new Float32Array([0, -10]),
      v: new Float32Array([-10, 0]),
      swh: new Float32Array([1, 3]),
      mwdSin: new Float32Array([0, 0]),
      mwdCos: new Float32Array([1, 1]),
      mwp: new Float32Array([6, 10]),
    };
    // At t = 3h (midpoint), should interpolate linearly
    const wp = getForecastAt(grid, 0, 0, 3 * 3600);
    // u lerp: 0 + (-10 - 0)*0.5 = -5, v lerp: -10 + (0 - -10)*0.5 = -5
    // tws = sqrt(25+25) ≈ 7.07
    expect(wp.tws).toBeCloseTo(7.071, 1);
    expect(wp.swh).toBeCloseTo(2, 1); // lerp(1, 3, 0.5)
    expect(wp.mwp).toBeCloseTo(8, 1); // lerp(6, 10, 0.5)
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/game-engine && npx vitest run src/weather/__tests__/grid-uv.test.ts`
Expected: FAIL — `WeatherGridUV` type not found, `getForecastAt` expects old grid type

- [ ] **Step 3: Rewrite grid.ts with U/V storage and linear temporal interpolation**

```typescript
// apps/game-engine/src/weather/grid.ts
import type { WeatherPoint } from '@nemo/shared-types';
import { uvToTwsTwd, recomposeAngle, lerp } from './grid-uv.js';

export interface WeatherGridUVMeta {
  runTs: number;
  bbox: { latMin: number; latMax: number; lonMin: number; lonMax: number };
  resolution: number;
  shape: { rows: number; cols: number };
  forecastHours: number[];
}

export interface WeatherGridUV extends WeatherGridUVMeta {
  u: Float32Array;
  v: Float32Array;
  swh: Float32Array;
  mwdSin: Float32Array;
  mwdCos: Float32Array;
  mwp: Float32Array;
}

// Keep old types as aliases for backward compat during migration
export type WeatherGridMeta = WeatherGridUVMeta;
export type WeatherGrid = WeatherGridUV;

function idx(grid: WeatherGridUVMeta, forecastSlot: number, row: number, col: number): number {
  const plane = grid.shape.rows * grid.shape.cols;
  return forecastSlot * plane + row * grid.shape.cols + col;
}

function pickForecastSlots(grid: WeatherGridUVMeta, timeUnix: number): {
  slotA: number; slotB: number; t: number;
} {
  const elapsedHours = Math.max(0, (timeUnix - grid.runTs) / 3600);
  const hours = grid.forecastHours;
  for (let i = 0; i < hours.length - 1; i++) {
    const a = hours[i]!;
    const b = hours[i + 1]!;
    if (elapsedHours >= a && elapsedHours <= b) {
      const t = b === a ? 0 : (elapsedHours - a) / (b - a);
      return { slotA: i, slotB: i + 1, t };
    }
  }
  const last = hours.length - 1;
  return { slotA: last, slotB: last, t: 0 };
}

/**
 * Trilinear interpolation: bilinear spatial + linear temporal.
 * Stores U/V (not TWS/TWD) for correct blending across runs.
 * Converts to TWS/TWD at read time.
 */
export function getForecastAt(grid: WeatherGridUV, lat: number, lon: number, timeUnix: number): WeatherPoint {
  const { latMin } = grid.bbox;
  const res = grid.resolution;
  const rowF = (lat - latMin) / res;
  const colF = ((lon + 180) % 360) / res;

  const row0 = Math.max(0, Math.min(grid.shape.rows - 1, Math.floor(rowF)));
  const row1 = Math.max(0, Math.min(grid.shape.rows - 1, row0 + 1));
  const col0 = Math.max(0, Math.min(grid.shape.cols - 1, Math.floor(colF)));
  const col1 = Math.max(0, Math.min(grid.shape.cols - 1, col0 + 1));
  const rt = rowF - row0;
  const ct = colF - col0;

  const { slotA, slotB, t: tFrac } = pickForecastSlots(grid, timeUnix);

  const sampleSlot = (field: Float32Array, slot: number): number => {
    const v00 = field[idx(grid, slot, row0, col0)] ?? 0;
    const v01 = field[idx(grid, slot, row0, col1)] ?? 0;
    const v10 = field[idx(grid, slot, row1, col0)] ?? 0;
    const v11 = field[idx(grid, slot, row1, col1)] ?? 0;
    const top = v00 * (1 - ct) + v01 * ct;
    const bot = v10 * (1 - ct) + v11 * ct;
    return top * (1 - rt) + bot * rt;
  };

  const sample = (field: Float32Array): number => {
    const a = sampleSlot(field, slotA);
    const b = sampleSlot(field, slotB);
    return lerp(a, b, tFrac);
  };

  const u = sample(grid.u);
  const v = sample(grid.v);
  const { tws, twd } = uvToTwsTwd(u, v);

  const mwdSinVal = sample(grid.mwdSin);
  const mwdCosVal = sample(grid.mwdCos);

  return {
    tws,
    twd,
    swh: sample(grid.swh),
    mwd: recomposeAngle(mwdSinVal, mwdCosVal),
    mwp: sample(grid.mwp),
  };
}

/** Decode a grid from the legacy base64 JSON format (TWS/TWD) — used by fixtures. */
export function decodeGridFromBase64Legacy(
  meta: WeatherGridUVMeta,
  fields: { tws: string; twd: string; swh: string; mwd: string; mwp: string },
): WeatherGridUV {
  const toArr = (b64: string): Float32Array => {
    const buf = Buffer.from(b64, 'base64');
    return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  };
  const twsArr = toArr(fields.tws);
  const twdArr = toArr(fields.twd);
  const swhArr = toArr(fields.swh);
  const mwdArr = toArr(fields.mwd);
  const mwpArr = toArr(fields.mwp);

  // Convert TWS/TWD → U/V
  const u = new Float32Array(twsArr.length);
  const v = new Float32Array(twsArr.length);
  const mwdSin = new Float32Array(mwdArr.length);
  const mwdCos = new Float32Array(mwdArr.length);
  for (let i = 0; i < twsArr.length; i++) {
    const rad = (twdArr[i]! * Math.PI) / 180;
    u[i] = -twsArr[i]! * Math.sin(rad);
    v[i] = -twsArr[i]! * Math.cos(rad);
    const mRad = (mwdArr[i]! * Math.PI) / 180;
    mwdSin[i] = Math.sin(mRad);
    mwdCos[i] = Math.cos(mRad);
  }

  return { ...meta, u, v, swh: swhArr, mwdSin, mwdCos, mwp: mwpArr };
}

/** Decode a grid from the new U/V base64 format (used by Redis/NOAA pipeline). */
export function decodeGridFromBase64(
  meta: WeatherGridUVMeta,
  fields: { u: string; v: string; swh: string; mwdSin: string; mwdCos: string; mwp: string },
): WeatherGridUV {
  const toArr = (b64: string): Float32Array => {
    const buf = Buffer.from(b64, 'base64');
    return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  };
  return {
    ...meta,
    u: toArr(fields.u),
    v: toArr(fields.v),
    swh: toArr(fields.swh),
    mwdSin: toArr(fields.mwdSin),
    mwdCos: toArr(fields.mwdCos),
    mwp: toArr(fields.mwp),
  };
}
```

- [ ] **Step 4: Update build-fixture.ts to generate U/V format**

Update `apps/game-engine/src/weather/build-fixture.ts` to produce U/V + mwdSin/mwdCos fields instead of TWS/TWD/MWD. Use the same wind patterns but store as U/V components. Output the legacy format (TWS/TWD) for the JSON file since `createFixtureProvider` will convert via `decodeGridFromBase64Legacy`.

- [ ] **Step 5: Update provider.ts to use new types**

Update `createFixtureProvider` to use `decodeGridFromBase64Legacy` (which converts the existing TWS/TWD fixture JSON into U/V grid at load time). Update `createNoaaProvider` to use `decodeGridFromBase64` (new U/V format from Redis).

- [ ] **Step 6: Regenerate the fixture JSON**

Run: `cd apps/game-engine && npx tsx src/weather/build-fixture.ts`
Verify: `fixtures/weather-grid.json` is updated.

- [ ] **Step 7: Run all existing game-engine tests**

Run: `cd apps/game-engine && npx vitest run`
Expected: ALL PASS — the refactored grid produces the same WeatherPoint results (U/V→TWS/TWD roundtrip is lossless).

- [ ] **Step 8: Commit**

```bash
git add apps/game-engine/src/weather/grid.ts apps/game-engine/src/weather/build-fixture.ts apps/game-engine/src/weather/provider.ts apps/game-engine/fixtures/weather-grid.json apps/game-engine/src/weather/__tests__/grid-uv.test.ts
git commit -m "refactor(weather): switch grid storage from TWS/TWD to U/V components

Enables correct blending between GFS runs without direction wraparound.
Linear temporal interpolation replaces nearest-neighbor."
```

---

## Task 3: Blending Logic

**Files:**
- Create: `apps/game-engine/src/weather/blend.ts`
- Create: `apps/game-engine/src/weather/__tests__/blend.test.ts`

Pure functions for blending two WeatherGridUV grids. No Redis dependency — just math.

- [ ] **Step 1: Write failing tests for blend**

```typescript
// apps/game-engine/src/weather/__tests__/blend.test.ts
import { describe, it, expect } from 'vitest';
import { blendGridForecast, type BlendState } from '../blend.js';
import type { WeatherGridUV } from '../grid.js';

function makeGrid(runTs: number, u: number, v: number, swh: number): WeatherGridUV {
  return {
    runTs,
    bbox: { latMin: 0, latMax: 0, lonMin: 0, lonMax: 0 },
    resolution: 0.25,
    shape: { rows: 1, cols: 1 },
    forecastHours: [0],
    u: new Float32Array([u]),
    v: new Float32Array([v]),
    swh: new Float32Array([swh]),
    mwdSin: new Float32Array([0]),
    mwdCos: new Float32Array([1]),
    mwp: new Float32Array([8]),
  };
}

describe('blendGridForecast', () => {
  it('returns currentRun point when no blend is active', () => {
    const state: BlendState = {
      currentRun: makeGrid(0, 0, -10, 2),  // 10kts north
      nextRun: null,
      blendStartMs: 0,
    };
    const wp = blendGridForecast(state, 0, 0, 0, Date.now());
    expect(wp.tws).toBeCloseTo(10, 1);
    expect(wp.twd).toBeCloseTo(0, 1);
  });

  it('blends 50/50 at halfway through BLEND_DURATION', () => {
    const now = 1000000;
    const BLEND_DURATION_MS = 3600_000; // 1h
    const state: BlendState = {
      currentRun: makeGrid(0, 0, -10, 2),     // 10kts north
      nextRun: makeGrid(21600, -10, 0, 4),     // 10kts east
      blendStartMs: now - BLEND_DURATION_MS / 2, // started 30min ago
    };
    const wp = blendGridForecast(state, 0, 0, 0, now);
    // u: lerp(0, -10, 0.5) = -5, v: lerp(-10, 0, 0.5) = -5
    // tws = sqrt(50) ≈ 7.07
    expect(wp.tws).toBeCloseTo(7.071, 1);
    expect(wp.swh).toBeCloseTo(3, 1); // lerp(2, 4, 0.5)
  });

  it('returns nextRun point when blend is complete (alpha >= 1)', () => {
    const now = 1000000;
    const BLEND_DURATION_MS = 3600_000;
    const state: BlendState = {
      currentRun: makeGrid(0, 0, -10, 2),
      nextRun: makeGrid(21600, -10, 0, 4),
      blendStartMs: now - BLEND_DURATION_MS - 1000, // blend finished
    };
    const wp = blendGridForecast(state, 0, 0, 0, now);
    expect(wp.tws).toBeCloseTo(10, 1);
    expect(wp.twd).toBeCloseTo(90, 1); // east wind
    expect(wp.swh).toBeCloseTo(4, 1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/game-engine && npx vitest run src/weather/__tests__/blend.test.ts`
Expected: FAIL — module `../blend.js` not found

- [ ] **Step 3: Implement blend.ts**

```typescript
// apps/game-engine/src/weather/blend.ts
import type { WeatherPoint } from '@nemo/shared-types';
import { getForecastAt, type WeatherGridUV } from './grid.js';
import { lerp, uvToTwsTwd, recomposeAngle } from './grid-uv.js';

/** Duration of the cross-fade between two GFS runs, in milliseconds. */
export const BLEND_DURATION_MS = 3_600_000; // 1 hour

export interface BlendState {
  currentRun: WeatherGridUV;
  nextRun: WeatherGridUV | null;
  blendStartMs: number;
}

/**
 * Returns a WeatherPoint that blends between two GFS runs when a transition
 * is active. When no blend is active (nextRun === null), returns from currentRun.
 *
 * The blend operates on raw U/V + wave components to avoid direction wraparound.
 */
export function blendGridForecast(
  state: BlendState,
  lat: number,
  lon: number,
  timeUnix: number,
  nowMs: number,
): WeatherPoint {
  const pointA = getForecastAt(state.currentRun, lat, lon, timeUnix);

  if (!state.nextRun) return pointA;

  const alpha = Math.min(1, Math.max(0, (nowMs - state.blendStartMs) / BLEND_DURATION_MS));
  const pointB = getForecastAt(state.nextRun, lat, lon, timeUnix);

  // Blend wind in U/V space
  const radA = (pointA.twd * Math.PI) / 180;
  const uA = -pointA.tws * Math.sin(radA);
  const vA = -pointA.tws * Math.cos(radA);
  const radB = (pointB.twd * Math.PI) / 180;
  const uB = -pointB.tws * Math.sin(radB);
  const vB = -pointB.tws * Math.cos(radB);

  const u = lerp(uA, uB, alpha);
  const v = lerp(vA, vB, alpha);
  const { tws, twd } = uvToTwsTwd(u, v);

  // Blend MWD in sin/cos space
  const mwdRadA = (pointA.mwd * Math.PI) / 180;
  const mwdRadB = (pointB.mwd * Math.PI) / 180;
  const mwdSin = lerp(Math.sin(mwdRadA), Math.sin(mwdRadB), alpha);
  const mwdCos = lerp(Math.cos(mwdRadA), Math.cos(mwdRadB), alpha);

  return {
    tws,
    twd,
    swh: lerp(pointA.swh, pointB.swh, alpha),
    mwd: recomposeAngle(mwdSin, mwdCos),
    mwp: lerp(pointA.mwp, pointB.mwp, alpha),
  };
}

/**
 * Check if blend is complete and should be promoted.
 * Returns true if nextRun should become currentRun.
 */
export function isBlendComplete(state: BlendState, nowMs: number): boolean {
  if (!state.nextRun) return false;
  return (nowMs - state.blendStartMs) >= BLEND_DURATION_MS;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/game-engine && npx vitest run src/weather/__tests__/blend.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/game-engine/src/weather/blend.ts apps/game-engine/src/weather/__tests__/blend.test.ts
git commit -m "feat(weather): add inter-run blending logic with 1h crossfade"
```

---

## Task 4: Blending Weather Provider

**Files:**
- Modify: `apps/game-engine/src/weather/provider.ts`
- Create: `apps/game-engine/src/weather/__tests__/provider-blend.test.ts`

Rewrite `createNoaaProvider` to support blend state with 3 modes.

- [ ] **Step 1: Write failing tests for blending provider**

```typescript
// apps/game-engine/src/weather/__tests__/provider-blend.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createNoaaProvider, type RedisLike } from '../provider.js';
import type { WeatherGridUV } from '../grid.js';

function makeGridJson(runTs: number, u: number, v: number): string {
  return JSON.stringify({
    runTs,
    bbox: { latMin: 0, latMax: 0, lonMin: 0, lonMax: 0 },
    resolution: 0.25,
    shape: { rows: 1, cols: 1 },
    forecastHours: [0],
    variables: {
      u: Buffer.from(new Float32Array([u]).buffer).toString('base64'),
      v: Buffer.from(new Float32Array([v]).buffer).toString('base64'),
      swh: Buffer.from(new Float32Array([2]).buffer).toString('base64'),
      mwdSin: Buffer.from(new Float32Array([0]).buffer).toString('base64'),
      mwdCos: Buffer.from(new Float32Array([1]).buffer).toString('base64'),
      mwp: Buffer.from(new Float32Array([8]).buffer).toString('base64'),
    },
  });
}

function createMockRedis(grids: Map<string, string>): RedisLike & { triggerMessage: (ch: string, msg: string) => void } {
  const listeners: ((ch: string, msg: string) => void)[] = [];
  return {
    async get(key: string) { return grids.get(key) ?? null; },
    async keys(pattern: string) {
      const prefix = pattern.replace('*', '');
      return [...grids.keys()].filter(k => k.startsWith(prefix));
    },
    async subscribe() {},
    on(_event: string, listener: (ch: string, msg: string) => void) { listeners.push(listener); },
    triggerMessage(ch: string, msg: string) { for (const l of listeners) l(ch, msg); },
  };
}

describe('createNoaaProvider with blending', () => {
  it('starts in noaa-single mode with latest run', async () => {
    const grids = new Map([['weather:grid:1000', makeGridJson(1000, 0, -10)]]);
    const redis = createMockRedis(grids);
    const provider = await createNoaaProvider(redis);
    expect(provider.mode).toBe('noaa');
    expect(provider.runTs).toBe(1000);
    const wp = provider.getForecastAt(0, 0, 1000);
    expect(wp.tws).toBeCloseTo(10, 1);
  });

  it('transitions to blending when a new run arrives via pub/sub', async () => {
    const grids = new Map([['weather:grid:1000', makeGridJson(1000, 0, -10)]]);
    const redis = createMockRedis(grids);
    const provider = await createNoaaProvider(redis);

    // New run arrives
    grids.set('weather:grid:22600', makeGridJson(22600, -10, 0));
    redis.triggerMessage('weather:grid:updated', '22600');

    // Give async handler time to resolve
    await new Promise(r => setTimeout(r, 50));

    expect(provider.blendStatus).toBe('blending');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/game-engine && npx vitest run src/weather/__tests__/provider-blend.test.ts`
Expected: FAIL — `blendStatus` property doesn't exist

- [ ] **Step 3: Rewrite provider.ts with blend support**

```typescript
// apps/game-engine/src/weather/provider.ts
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WeatherPoint } from '@nemo/shared-types';
import {
  decodeGridFromBase64,
  decodeGridFromBase64Legacy,
  getForecastAt,
  type WeatherGridUV,
  type WeatherGridUVMeta,
} from './grid.js';
import { blendGridForecast, isBlendComplete, BLEND_DURATION_MS, type BlendState } from './blend.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export type WeatherStatus = 'stable' | 'blending' | 'delayed';

export interface WeatherProvider {
  readonly mode: 'fixture' | 'noaa';
  readonly runTs: number;
  readonly blendStatus: WeatherStatus;
  readonly blendAlpha: number;
  readonly nextRunExpectedUtc: number;
  getForecastAt(lat: number, lon: number, timeUnix: number): WeatherPoint;
  /** Access current blended grid for REST endpoint (returns currentRun or blended view). */
  getGrid(): WeatherGridUV;
}

// --- Legacy fixture JSON format ---
type LegacyGridJson = WeatherGridUVMeta & {
  variables: { tws: string; twd: string; swh: string; mwd: string; mwp: string };
};

export async function createFixtureProvider(
  fixturePath = join(__dirname, '..', '..', 'fixtures', 'weather-grid.json'),
): Promise<WeatherProvider> {
  const raw = await readFile(fixturePath, 'utf8');
  const parsed = JSON.parse(raw) as LegacyGridJson;
  const grid = decodeGridFromBase64Legacy(parsed, parsed.variables);
  return {
    mode: 'fixture',
    runTs: grid.runTs,
    blendStatus: 'stable',
    blendAlpha: 0,
    nextRunExpectedUtc: 0,
    getForecastAt: (lat, lon, t) => getForecastAt(grid, lat, lon, t),
    getGrid: () => grid,
  };
}

// --- Redis-backed NOAA provider with blending ---

type UVGridJson = WeatherGridUVMeta & {
  variables: { u: string; v: string; swh: string; mwdSin: string; mwdCos: string; mwp: string };
};

export interface RedisLike {
  get(key: string): Promise<string | null>;
  keys(pattern: string): Promise<string[]>;
  subscribe(channel: string): Promise<unknown>;
  on(event: 'message', listener: (channel: string, message: string) => void): unknown;
}

/** Estimate next NOAA run timestamp: current run + 6h + ~4h publication delay. */
function estimateNextRun(currentRunTs: number): number {
  return currentRunTs + 6 * 3600 + 4 * 3600; // run + 6h cycle + 4h delay
}

export async function createNoaaProvider(redis: RedisLike): Promise<WeatherProvider> {
  async function loadGrid(runTs: number): Promise<WeatherGridUV> {
    const raw = await redis.get(`weather:grid:${runTs}`);
    if (!raw) throw new Error(`grid weather:grid:${runTs} not found`);
    const parsed = JSON.parse(raw) as UVGridJson;
    return decodeGridFromBase64(parsed, parsed.variables);
  }

  async function loadLatest(): Promise<WeatherGridUV> {
    const keys = await redis.keys('weather:grid:*');
    if (keys.length === 0) throw new Error('no weather grid in redis');
    keys.sort();
    const latestKey = keys[keys.length - 1]!;
    const runTs = Number(latestKey.split(':').pop());
    return loadGrid(runTs);
  }

  let blend: BlendState = {
    currentRun: await loadLatest(),
    nextRun: null,
    blendStartMs: 0,
  };

  await redis.subscribe('weather:grid:updated');
  redis.on('message', (channel, msg) => {
    if (channel !== 'weather:grid:updated') return;
    const newRunTs = Number(msg);
    if (newRunTs <= blend.currentRun.runTs) return; // stale

    loadGrid(newRunTs).then((newGrid) => {
      // If already blending, snap current blend to completion
      if (blend.nextRun) {
        blend = {
          currentRun: blend.nextRun,
          nextRun: newGrid,
          blendStartMs: Date.now(),
        };
      } else {
        blend = {
          ...blend,
          nextRun: newGrid,
          blendStartMs: Date.now(),
        };
      }
    }).catch(() => { /* keep previous grid */ });
  });

  return {
    mode: 'noaa',

    get runTs() { return blend.currentRun.runTs; },

    get blendStatus(): WeatherStatus {
      if (blend.nextRun) return 'blending';
      // Check if next run is overdue (>5h after expected)
      const expected = estimateNextRun(blend.currentRun.runTs);
      if (Date.now() / 1000 > expected + 3600) return 'delayed';
      return 'stable';
    },

    get blendAlpha(): number {
      if (!blend.nextRun) return 0;
      return Math.min(1, Math.max(0, (Date.now() - blend.blendStartMs) / BLEND_DURATION_MS));
    },

    get nextRunExpectedUtc(): number {
      return estimateNextRun(blend.currentRun.runTs);
    },

    getForecastAt(lat: number, lon: number, timeUnix: number): WeatherPoint {
      const nowMs = Date.now();
      // Check if blend is complete → promote
      if (isBlendComplete(blend, nowMs)) {
        blend = {
          currentRun: blend.nextRun!,
          nextRun: null,
          blendStartMs: 0,
        };
      }
      return blendGridForecast(blend, lat, lon, timeUnix, nowMs);
    },

    getGrid(): WeatherGridUV {
      return blend.currentRun;
    },
  };
}
```

- [ ] **Step 4: Run all tests**

Run: `cd apps/game-engine && npx vitest run`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add apps/game-engine/src/weather/provider.ts apps/game-engine/src/weather/__tests__/provider-blend.test.ts
git commit -m "feat(weather): add blending NOAA provider with pub/sub hot-reload"
```

---

## Task 5: Binary Encoder for REST Endpoint

**Files:**
- Create: `apps/game-engine/src/weather/binary-encoder.ts`
- Create: `apps/game-engine/src/weather/__tests__/binary-encoder.test.ts`

Encodes a grid subset (bounded, selected forecast hours) as an ArrayBuffer.

- [ ] **Step 1: Write failing tests**

```typescript
// apps/game-engine/src/weather/__tests__/binary-encoder.test.ts
import { describe, it, expect } from 'vitest';
import { encodeGridSubset, decodeHeader, HEADER_SIZE } from '../binary-encoder.js';
import type { WeatherGridUV } from '../grid.js';

function makeSimpleGrid(): WeatherGridUV {
  // 2x2 grid, 2 forecast hours
  const points = 2 * 2;
  const total = points * 2; // 2 forecast hours
  return {
    runTs: 1713340800,
    bbox: { latMin: 40, latMax: 40.25, lonMin: -10, lonMax: -9.75 },
    resolution: 0.25,
    shape: { rows: 2, cols: 2 },
    forecastHours: [0, 6],
    u: new Float32Array(total).fill(-5),
    v: new Float32Array(total).fill(-8.66),
    swh: new Float32Array(total).fill(2.5),
    mwdSin: new Float32Array(total).fill(0.5),
    mwdCos: new Float32Array(total).fill(0.866),
    mwp: new Float32Array(total).fill(9),
  };
}

describe('encodeGridSubset', () => {
  it('encodes header + body for a bounded subset', () => {
    const grid = makeSimpleGrid();
    const buf = encodeGridSubset(grid, {
      bounds: { latMin: 40, latMax: 40.25, lonMin: -10, lonMax: -9.75 },
      hours: [0, 6],
      runTimestamp: 1713340800,
      nextRunExpectedUtc: 1713376800,
      weatherStatus: 0,
      blendAlpha: 0,
    });
    expect(buf.byteLength).toBeGreaterThan(HEADER_SIZE);

    const header = decodeHeader(buf);
    expect(header.runTimestamp).toBe(1713340800);
    expect(header.numHours).toBe(2);
    expect(header.numLat).toBe(2);
    expect(header.numLon).toBe(2);
  });

  it('body contains 6 floats per point per hour', () => {
    const grid = makeSimpleGrid();
    const buf = encodeGridSubset(grid, {
      bounds: { latMin: 40, latMax: 40.25, lonMin: -10, lonMax: -9.75 },
      hours: [0],
      runTimestamp: 1713340800,
      nextRunExpectedUtc: 1713376800,
      weatherStatus: 0,
      blendAlpha: 0,
    });
    const bodySize = buf.byteLength - HEADER_SIZE;
    const expectedPoints = 2 * 2; // 2 rows × 2 cols
    const expectedFloats = expectedPoints * 6; // 6 floats per point
    expect(bodySize).toBe(expectedFloats * 4); // 1 hour
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/game-engine && npx vitest run src/weather/__tests__/binary-encoder.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement binary encoder**

```typescript
// apps/game-engine/src/weather/binary-encoder.ts
import type { WeatherGridUV } from './grid.js';

export const HEADER_SIZE = 40;

export interface EncodeOptions {
  bounds: { latMin: number; latMax: number; lonMin: number; lonMax: number };
  hours: number[];
  runTimestamp: number;
  nextRunExpectedUtc: number;
  weatherStatus: number; // 0=stable, 1=blending, 2=delayed
  blendAlpha: number;
}

export interface GridHeader {
  runTimestamp: number;
  nextRunExpectedUtc: number;
  weatherStatus: number;
  blendAlpha: number;
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
  gridStepLat: number;
  gridStepLon: number;
  numLat: number;
  numLon: number;
  numHours: number;
}

/**
 * Encode a geographic + temporal subset of the grid as a compact ArrayBuffer.
 * Layout: [Header 40 bytes] [Body: numHours × numLat × numLon × 6 × float32]
 */
export function encodeGridSubset(grid: WeatherGridUV, opts: EncodeOptions): ArrayBuffer {
  const res = grid.resolution;
  const rowStart = Math.max(0, Math.floor((opts.bounds.latMin - grid.bbox.latMin) / res));
  const rowEnd = Math.min(grid.shape.rows - 1, Math.ceil((opts.bounds.latMax - grid.bbox.latMin) / res));
  const colStart = Math.max(0, Math.floor(((opts.bounds.lonMin + 180) % 360) / res));
  const colEnd = Math.min(grid.shape.cols - 1, Math.ceil(((opts.bounds.lonMax + 180) % 360) / res));

  const numLat = rowEnd - rowStart + 1;
  const numLon = colEnd - colStart + 1;
  const numHours = opts.hours.length;

  const bodyFloats = numHours * numLat * numLon * 6;
  const totalBytes = HEADER_SIZE + bodyFloats * 4;
  const buf = new ArrayBuffer(totalBytes);
  const dv = new DataView(buf);

  // Header
  let off = 0;
  dv.setUint32(off, opts.runTimestamp, true); off += 4;
  dv.setUint32(off, opts.nextRunExpectedUtc, true); off += 4;
  dv.setUint8(off, opts.weatherStatus); off += 1;
  off += 3; // padding
  dv.setFloat32(off, opts.blendAlpha, true); off += 4;
  dv.setFloat32(off, opts.bounds.latMin, true); off += 4;
  dv.setFloat32(off, opts.bounds.latMax, true); off += 4;
  dv.setFloat32(off, opts.bounds.lonMin, true); off += 4;
  dv.setFloat32(off, opts.bounds.lonMax, true); off += 4;
  dv.setFloat32(off, res, true); off += 4; // gridStepLat
  dv.setFloat32(off, res, true); off += 4; // gridStepLon — currently always same as lat
  // Remaining: numLat(u16) + numLon(u16) + numHours(u16) + padding(u16) = 8 bytes... 
  // But we're at offset 36, need 4 more bytes for HEADER_SIZE=40
  // Pack as: numLat(u16) numLon(u16) = 4 bytes at off=36, numHours(u16) padding(u16) = 4 bytes at off=40... 
  // Wait, that's 44. Let me recount.
  // 4+4+1+3+4+4+4+4+4+4+4 = 40. We're at off=40 already. Need to fit numLat/numLon/numHours.
  // Adjust: reduce two float32 fields or pack differently.
  // Actually let's just use a 48-byte header.

  // Let me redo: use a simpler layout
  // Nah, let's just write after the 40-byte mark.
  // Actually re-counting: 4+4+1+3+4+4+4+4+4+4+4 = 4*9 + 1 + 3 = 40. Yes, at offset 40.
  // But we still need numLat, numLon, numHours. So HEADER_SIZE should be 48.
  // I'll fix the constant.

  // ... Actually, let me just correct the implementation to use 48 bytes.
  // But the test checks HEADER_SIZE. Let me be consistent.

  // Scratch that — I'll rewrite cleanly below.
  return buf; // placeholder
}

// NOTE: This placeholder will be replaced in the actual implementation step.
export function decodeHeader(_buf: ArrayBuffer): GridHeader {
  return {} as GridHeader;
}
```

Wait — let me write the clean version directly:

```typescript
// apps/game-engine/src/weather/binary-encoder.ts
import type { WeatherGridUV } from './grid.js';

export const HEADER_SIZE = 48; // bytes

export interface EncodeOptions {
  bounds: { latMin: number; latMax: number; lonMin: number; lonMax: number };
  hours: number[];
  runTimestamp: number;
  nextRunExpectedUtc: number;
  weatherStatus: number; // 0=stable, 1=blending, 2=delayed
  blendAlpha: number;
}

export interface GridHeader {
  runTimestamp: number;
  nextRunExpectedUtc: number;
  weatherStatus: number;
  blendAlpha: number;
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
  gridStepLat: number;
  gridStepLon: number;
  numLat: number;
  numLon: number;
  numHours: number;
}

export function encodeGridSubset(grid: WeatherGridUV, opts: EncodeOptions): ArrayBuffer {
  const res = grid.resolution;
  const rowStart = Math.max(0, Math.floor((opts.bounds.latMin - grid.bbox.latMin) / res));
  const rowEnd = Math.min(grid.shape.rows - 1, Math.ceil((opts.bounds.latMax - grid.bbox.latMin) / res));
  const colStart = Math.max(0, Math.floor(((opts.bounds.lonMin + 180) % 360) / res));
  const colEnd = Math.min(grid.shape.cols - 1, Math.ceil(((opts.bounds.lonMax + 180) % 360) / res));

  const numLat = rowEnd - rowStart + 1;
  const numLon = colEnd - colStart + 1;
  const numHours = opts.hours.length;
  const plane = grid.shape.rows * grid.shape.cols;

  const bodyFloats = numHours * numLat * numLon * 6;
  const totalBytes = HEADER_SIZE + bodyFloats * 4;
  const buf = new ArrayBuffer(totalBytes);
  const dv = new DataView(buf);

  // Header (48 bytes)
  let off = 0;
  dv.setUint32(off, opts.runTimestamp, true); off += 4;         // 0
  dv.setUint32(off, opts.nextRunExpectedUtc, true); off += 4;   // 4
  dv.setUint8(off, opts.weatherStatus); off += 4;               // 8 (+3 padding)
  dv.setFloat32(off, opts.blendAlpha, true); off += 4;          // 12
  dv.setFloat32(off, opts.bounds.latMin, true); off += 4;       // 16
  dv.setFloat32(off, opts.bounds.latMax, true); off += 4;       // 20
  dv.setFloat32(off, opts.bounds.lonMin, true); off += 4;       // 24
  dv.setFloat32(off, opts.bounds.lonMax, true); off += 4;       // 28
  dv.setFloat32(off, res, true); off += 4;                      // 32 gridStepLat
  dv.setFloat32(off, res, true); off += 4;                      // 36 gridStepLon
  dv.setUint16(off, numLat, true); off += 2;                    // 40
  dv.setUint16(off, numLon, true); off += 2;                    // 42
  dv.setUint16(off, numHours, true); off += 2;                  // 44
  off += 2; // padding to 48

  // Body: for each requested forecast hour, extract the bounded subset
  const body = new Float32Array(buf, HEADER_SIZE);
  let fi = 0;
  for (const fh of opts.hours) {
    const slotIdx = grid.forecastHours.indexOf(fh);
    if (slotIdx === -1) continue;
    const slotOff = slotIdx * plane;
    for (let r = rowStart; r <= rowEnd; r++) {
      for (let c = colStart; c <= colEnd; c++) {
        const i = slotOff + r * grid.shape.cols + c;
        body[fi++] = grid.u[i]!;
        body[fi++] = grid.v[i]!;
        body[fi++] = grid.swh[i]!;
        body[fi++] = grid.mwdSin[i]!;
        body[fi++] = grid.mwdCos[i]!;
        body[fi++] = grid.mwp[i]!;
      }
    }
  }

  return buf;
}

export function decodeHeader(buf: ArrayBuffer): GridHeader {
  const dv = new DataView(buf);
  return {
    runTimestamp: dv.getUint32(0, true),
    nextRunExpectedUtc: dv.getUint32(4, true),
    weatherStatus: dv.getUint8(8),
    blendAlpha: dv.getFloat32(12, true),
    latMin: dv.getFloat32(16, true),
    latMax: dv.getFloat32(20, true),
    lonMin: dv.getFloat32(24, true),
    lonMax: dv.getFloat32(28, true),
    gridStepLat: dv.getFloat32(32, true),
    gridStepLon: dv.getFloat32(36, true),
    numLat: dv.getUint16(40, true),
    numLon: dv.getUint16(42, true),
    numHours: dv.getUint16(44, true),
  };
}
```

Update the test to use `HEADER_SIZE = 48`:

```typescript
// The test already uses HEADER_SIZE from the import, so it adapts automatically.
```

- [ ] **Step 4: Run tests**

Run: `cd apps/game-engine && npx vitest run src/weather/__tests__/binary-encoder.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/game-engine/src/weather/binary-encoder.ts apps/game-engine/src/weather/__tests__/binary-encoder.test.ts
git commit -m "feat(weather): add binary grid encoder for REST endpoint"
```

---

## Task 6: Weather REST Routes (Fastify)

**Files:**
- Create: `apps/game-engine/src/routes/weather.ts`
- Modify: `apps/game-engine/src/index.ts`

Two endpoints: `/api/v1/weather/grid` (binary) and `/api/v1/weather/status` (JSON).

- [ ] **Step 1: Create the weather route module**

```typescript
// apps/game-engine/src/routes/weather.ts
import type { FastifyInstance } from 'fastify';
import type { WeatherProvider } from '../weather/provider.js';
import { encodeGridSubset } from '../weather/binary-encoder.js';

export function registerWeatherRoutes(app: FastifyInstance, getProvider: () => WeatherProvider) {
  app.get('/api/v1/weather/status', async (_req, reply) => {
    const provider = getProvider();
    return reply.send({
      run: provider.runTs,
      next: provider.nextRunExpectedUtc,
      status: provider.blendStatus === 'stable' ? 0 : provider.blendStatus === 'blending' ? 1 : 2,
      alpha: provider.blendAlpha,
    });
  });

  app.get<{
    Querystring: { bounds?: string; hours?: string };
  }>('/api/v1/weather/grid', async (req, reply) => {
    const provider = getProvider();
    const grid = provider.getGrid();

    // Parse bounds: "latMin,lonMin,latMax,lonMax"
    const boundsStr = req.query.bounds ?? `${grid.bbox.latMin},${grid.bbox.lonMin},${grid.bbox.latMax},${grid.bbox.lonMax}`;
    const [latMin, lonMin, latMax, lonMax] = boundsStr.split(',').map(Number);
    if ([latMin, lonMin, latMax, lonMax].some(n => n == null || Number.isNaN(n))) {
      return reply.status(400).send({ error: 'invalid bounds' });
    }

    // Parse hours: "0,3,6,12"
    const hoursStr = req.query.hours ?? '0';
    const hours = hoursStr.split(',').map(Number).filter(h => grid.forecastHours.includes(h));
    if (hours.length === 0) {
      return reply.status(400).send({ error: 'no valid forecast hours' });
    }

    const statusCode = provider.blendStatus === 'stable' ? 0 : provider.blendStatus === 'blending' ? 1 : 2;
    const maxAge = provider.blendStatus === 'blending' ? 60 : 300;

    const buf = encodeGridSubset(grid, {
      bounds: { latMin: latMin!, latMax: latMax!, lonMin: lonMin!, lonMax: lonMax! },
      hours,
      runTimestamp: provider.runTs,
      nextRunExpectedUtc: provider.nextRunExpectedUtc,
      weatherStatus: statusCode,
      blendAlpha: provider.blendAlpha,
    });

    return reply
      .header('Content-Type', 'application/octet-stream')
      .header('Cache-Control', `public, max-age=${maxAge}`)
      .send(Buffer.from(buf));
  });
}
```

- [ ] **Step 2: Register routes in index.ts**

Add to `apps/game-engine/src/index.ts`, after the existing route registration:

```typescript
import { registerWeatherRoutes } from './routes/weather.js';

// After weather provider is created:
registerWeatherRoutes(app, () => weather);
```

Where `weather` is the `WeatherProvider` instance already created in the server setup.

- [ ] **Step 3: Run game-engine tests**

Run: `cd apps/game-engine && npx vitest run`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add apps/game-engine/src/routes/weather.ts apps/game-engine/src/index.ts
git commit -m "feat(weather): add /api/v1/weather/grid and /status REST endpoints"
```

---

## Task 7: Worker NOAA Provider Switch

**Files:**
- Modify: `apps/game-engine/src/engine/worker.ts`

The worker currently hardcodes `createFixtureProvider()`. Switch based on `NEMO_WEATHER_MODE` env var.

- [ ] **Step 1: Update worker.ts**

```typescript
// In apps/game-engine/src/engine/worker.ts, replace:
//   const weather: WeatherProvider = await createFixtureProvider();
// with:
import { createFixtureProvider, createNoaaProvider, type WeatherProvider } from '../weather/provider.js';
import Redis from 'ioredis';

async function createWeather(): Promise<WeatherProvider> {
  if (process.env.NEMO_WEATHER_MODE === 'noaa') {
    const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
    const sub = new Redis(redisUrl); // dedicated subscriber connection
    const client = new Redis(redisUrl); // for get/keys
    const redis = {
      get: (k: string) => client.get(k),
      keys: (p: string) => client.keys(p),
      subscribe: (ch: string) => sub.subscribe(ch),
      on: (ev: string, cb: (ch: string, msg: string) => void) => sub.on(ev as 'message', cb),
    };
    return createNoaaProvider(redis);
  }
  return createFixtureProvider();
}

// Then in main():
const weather = await createWeather();
```

- [ ] **Step 2: Run existing tests**

Run: `cd apps/game-engine && npx vitest run`
Expected: ALL PASS (fixture mode still default, no Redis needed)

- [ ] **Step 3: Commit**

```bash
git add apps/game-engine/src/engine/worker.ts
git commit -m "feat(weather): switch worker to NOAA provider when configured"
```

---

## Task 8: Python Ingestion — Poller Module

**Files:**
- Create: `apps/weather-engine/src/nemo_weather/poller.py`
- Create: `apps/weather-engine/tests/test_poller.py`

Polling logic to detect NOAA run availability.

- [ ] **Step 1: Write failing tests**

```python
# apps/weather-engine/tests/test_poller.py
import datetime as dt
from unittest.mock import patch, MagicMock
from nemo_weather.poller import pick_target_run, check_run_available, NOAA_CHECK_URL

def test_pick_target_run_at_14utc():
    """At 14:00 UTC, the latest available run should be 06z (14 - 4h delay = 10, floor to 06)."""
    now = dt.datetime(2026, 4, 17, 14, 0, 0)
    run = pick_target_run(now)
    assert run == dt.datetime(2026, 4, 17, 6, 0, 0)

def test_pick_target_run_at_03utc():
    """At 03:00 UTC, 03 - 4 = -1 → previous day 18z."""
    now = dt.datetime(2026, 4, 17, 3, 0, 0)
    run = pick_target_run(now)
    assert run == dt.datetime(2026, 4, 16, 18, 0, 0)

@patch("nemo_weather.poller.requests.head")
def test_check_run_available_returns_true_on_200(mock_head):
    mock_head.return_value = MagicMock(status_code=200)
    run = dt.datetime(2026, 4, 17, 12, 0, 0)
    assert check_run_available(run) is True

@patch("nemo_weather.poller.requests.head")
def test_check_run_available_returns_false_on_404(mock_head):
    mock_head.return_value = MagicMock(status_code=404)
    run = dt.datetime(2026, 4, 17, 12, 0, 0)
    assert check_run_available(run) is False
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/weather-engine && python -m pytest tests/test_poller.py -v`
Expected: FAIL — module not found

- [ ] **Step 3: Implement poller.py**

```python
# apps/weather-engine/src/nemo_weather/poller.py
"""NOAA GFS run availability polling."""

from __future__ import annotations

import datetime as dt
import logging
import time

import requests

LOG = logging.getLogger("nemo.weather.poller")

NOAA_CHECK_URL = (
    "https://nomads.ncep.noaa.gov/pub/data/nccf/com/gfs/prod/"
    "gfs.{ymd}/{hh}/atmos/gfs.t{hh}z.pgrb2.0p25.f000"
)

POLL_INTERVAL_SEC = 300  # 5 minutes
MAX_WAIT_SEC = 6 * 3600  # 6 hours


def pick_target_run(now: dt.datetime | None = None) -> dt.datetime:
    """Determine which GFS run should be the latest available, accounting for ~4h publication delay."""
    now = now or dt.datetime.utcnow()
    anchor = now - dt.timedelta(hours=4)
    hh = (anchor.hour // 6) * 6
    return anchor.replace(hour=hh, minute=0, second=0, microsecond=0)


def check_run_available(run: dt.datetime) -> bool:
    """HEAD request on f000 to check if a run's files have started publishing."""
    url = NOAA_CHECK_URL.format(ymd=run.strftime("%Y%m%d"), hh=f"{run.hour:02d}")
    try:
        resp = requests.head(url, timeout=30)
        return resp.status_code == 200
    except requests.RequestException:
        return False


def wait_for_run(run: dt.datetime) -> bool:
    """Poll until the run is available, or timeout after MAX_WAIT_SEC."""
    start = time.monotonic()
    while time.monotonic() - start < MAX_WAIT_SEC:
        if check_run_available(run):
            LOG.info("run %s is available", run.isoformat())
            return True
        LOG.info("run %s not yet available, retrying in %ds", run.isoformat(), POLL_INTERVAL_SEC)
        time.sleep(POLL_INTERVAL_SEC)
    LOG.warning("run %s not available after %ds, skipping", run.isoformat(), MAX_WAIT_SEC)
    return False
```

- [ ] **Step 4: Run tests**

Run: `cd apps/weather-engine && python -m pytest tests/test_poller.py -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/weather-engine/src/nemo_weather/poller.py apps/weather-engine/tests/test_poller.py
git commit -m "feat(weather): add NOAA run availability poller"
```

---

## Task 9: Python Ingestion — Grid Builder

**Files:**
- Create: `apps/weather-engine/src/nemo_weather/grid_builder.py`
- Create: `apps/weather-engine/tests/test_grid_builder.py`

Downloads GRIB2 files, parses with cfgrib, re-interpolates waves, builds the Redis-ready JSON grid.

- [ ] **Step 1: Write failing tests**

```python
# apps/weather-engine/tests/test_grid_builder.py
import numpy as np
from nemo_weather.grid_builder import uv_to_components, reinterpolate_wave, build_grid_payload

def test_uv_to_components_north_wind():
    """U=0, V=-10 m/s → u=0, v=-10 (stored as-is, no TWS/TWD conversion at storage)."""
    u = np.array([0.0], dtype=np.float32)
    v = np.array([-10.0], dtype=np.float32)
    result_u, result_v = uv_to_components(u, v)
    np.testing.assert_allclose(result_u, [0.0], atol=1e-4)
    np.testing.assert_allclose(result_v, [-10.0], atol=1e-4)

def test_mwd_decomposition():
    """MWD=45° → sin=0.7071, cos=0.7071."""
    mwd = np.array([45.0], dtype=np.float32)
    sin_c, cos_c = np.sin(np.radians(mwd)), np.cos(np.radians(mwd))
    np.testing.assert_allclose(sin_c, [0.7071], atol=1e-3)
    np.testing.assert_allclose(cos_c, [0.7071], atol=1e-3)

def test_reinterpolate_wave_to_025():
    """Wave data at 0.16° should be re-interpolated to 0.25° grid."""
    # 3x3 wave grid at 0.16° resolution
    wave_lats = np.array([40.0, 40.16, 40.32])
    wave_lons = np.array([-10.0, -9.84, -9.68])
    values = np.array([[1.0, 1.5, 2.0],
                       [1.5, 2.0, 2.5],
                       [2.0, 2.5, 3.0]], dtype=np.float32)
    # Target: 2x2 grid at 0.25°
    target_lats = np.array([40.0, 40.25])
    target_lons = np.array([-10.0, -9.75])
    result = reinterpolate_wave(values, wave_lats, wave_lons, target_lats, target_lons)
    assert result.shape == (2, 2)
    # Corner value should be close to original
    np.testing.assert_allclose(result[0, 0], 1.0, atol=0.1)

def test_build_grid_payload_structure():
    """Payload must have all required keys for Redis storage."""
    import base64
    payload = build_grid_payload(
        run_ts=1713340800,
        forecast_hours=[0, 3],
        u_planes=[np.zeros((2, 2), dtype=np.float32)] * 2,
        v_planes=[np.zeros((2, 2), dtype=np.float32)] * 2,
        swh_planes=[np.zeros((2, 2), dtype=np.float32)] * 2,
        mwd_sin_planes=[np.zeros((2, 2), dtype=np.float32)] * 2,
        mwd_cos_planes=[np.zeros((2, 2), dtype=np.float32)] * 2,
        mwp_planes=[np.zeros((2, 2), dtype=np.float32)] * 2,
        bbox={"latMin": -90, "latMax": 90, "lonMin": -180, "lonMax": 180},
        resolution=0.25,
        shape={"rows": 2, "cols": 2},
    )
    assert payload["runTs"] == 1713340800
    assert payload["forecastHours"] == [0, 3]
    assert set(payload["variables"].keys()) == {"u", "v", "swh", "mwdSin", "mwdCos", "mwp"}
    # Each variable should be a base64 string decodable to float32
    raw = base64.b64decode(payload["variables"]["u"])
    arr = np.frombuffer(raw, dtype=np.float32)
    assert arr.shape == (2 * 2 * 2,)  # 2 forecast hours × 2 rows × 2 cols
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/weather-engine && python -m pytest tests/test_grid_builder.py -v`
Expected: FAIL — module not found

- [ ] **Step 3: Implement grid_builder.py**

```python
# apps/weather-engine/src/nemo_weather/grid_builder.py
"""Build weather grid from GRIB2 data for Redis storage."""

from __future__ import annotations

import base64
import logging
from pathlib import Path
from typing import Any

import numpy as np
import xarray as xr
from scipy.interpolate import RegularGridInterpolator

LOG = logging.getLogger("nemo.weather.grid_builder")


def uv_to_components(u: np.ndarray, v: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Store U/V as-is (m/s). Conversion to TWS/TWD happens in game-engine at read time."""
    return u.astype(np.float32), v.astype(np.float32)


def decompose_mwd(mwd_deg: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Decompose MWD (degrees) into sin/cos components for wraparound-safe blending."""
    rad = np.radians(mwd_deg)
    return np.sin(rad).astype(np.float32), np.cos(rad).astype(np.float32)


def reinterpolate_wave(
    values: np.ndarray,
    src_lats: np.ndarray,
    src_lons: np.ndarray,
    target_lats: np.ndarray,
    target_lons: np.ndarray,
) -> np.ndarray:
    """Bilinear re-interpolation from wave grid (0.16°) to atmos grid (0.25°)."""
    interp = RegularGridInterpolator(
        (src_lats, src_lons), values, method="linear", bounds_error=False, fill_value=None
    )
    grid_lat, grid_lon = np.meshgrid(target_lats, target_lons, indexing="ij")
    pts = np.column_stack([grid_lat.ravel(), grid_lon.ravel()])
    return interp(pts).reshape(len(target_lats), len(target_lons)).astype(np.float32)


def serialize(arr: np.ndarray) -> str:
    """Flatten and encode as base64 Float32Array."""
    return base64.b64encode(arr.astype(np.float32).tobytes()).decode("ascii")


def build_grid_payload(
    *,
    run_ts: int,
    forecast_hours: list[int],
    u_planes: list[np.ndarray],
    v_planes: list[np.ndarray],
    swh_planes: list[np.ndarray],
    mwd_sin_planes: list[np.ndarray],
    mwd_cos_planes: list[np.ndarray],
    mwp_planes: list[np.ndarray],
    bbox: dict[str, float],
    resolution: float,
    shape: dict[str, int],
) -> dict[str, Any]:
    """Assemble all forecast hours into a single Redis-ready JSON payload."""
    u_all = np.concatenate([p.ravel() for p in u_planes])
    v_all = np.concatenate([p.ravel() for p in v_planes])
    swh_all = np.concatenate([p.ravel() for p in swh_planes])
    mwd_sin_all = np.concatenate([p.ravel() for p in mwd_sin_planes])
    mwd_cos_all = np.concatenate([p.ravel() for p in mwd_cos_planes])
    mwp_all = np.concatenate([p.ravel() for p in mwp_planes])

    return {
        "runTs": run_ts,
        "bbox": bbox,
        "resolution": resolution,
        "shape": shape,
        "forecastHours": forecast_hours,
        "variables": {
            "u": serialize(u_all),
            "v": serialize(v_all),
            "swh": serialize(swh_all),
            "mwdSin": serialize(mwd_sin_all),
            "mwdCos": serialize(mwd_cos_all),
            "mwp": serialize(mwp_all),
        },
    }


def parse_atmos_grib(path: Path) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Parse atmospheric GRIB2: returns (u10, v10, lats, lons)."""
    ds = xr.open_dataset(path, engine="cfgrib", backend_kwargs={
        "filter_by_keys": {"typeOfLevel": "heightAboveGround", "level": 10},
    })
    u10 = ds["u10"].values.astype(np.float32)
    v10 = ds["v10"].values.astype(np.float32)
    lats = ds["latitude"].values
    lons = ds["longitude"].values
    ds.close()
    return u10, v10, lats, lons


def parse_wave_grib(
    path: Path, target_lats: np.ndarray, target_lons: np.ndarray
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Parse wave GRIB2: returns (swh, mwd, mwp) re-interpolated to target grid."""
    ds = xr.open_dataset(path, engine="cfgrib")
    wave_lats = ds["latitude"].values
    wave_lons = ds["longitude"].values
    swh = reinterpolate_wave(ds["swh"].values, wave_lats, wave_lons, target_lats, target_lons)
    mwd = reinterpolate_wave(ds["mwd"].values, wave_lats, wave_lons, target_lats, target_lons)
    mwp = reinterpolate_wave(ds["perpw"].values, wave_lats, wave_lons, target_lats, target_lons)
    ds.close()
    return swh, mwd, mwp
```

- [ ] **Step 4: Add scipy to pyproject.toml**

```toml
# Add to dependencies list:
"scipy>=1.12",
```

- [ ] **Step 5: Run tests**

Run: `cd apps/weather-engine && python -m pytest tests/test_grid_builder.py -v`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add apps/weather-engine/src/nemo_weather/grid_builder.py apps/weather-engine/tests/test_grid_builder.py apps/weather-engine/pyproject.toml
git commit -m "feat(weather): add grid builder with wave re-interpolation"
```

---

## Task 10: Python Ingestion — Persistence Module

**Files:**
- Create: `apps/weather-engine/src/nemo_weather/persistence.py`
- Create: `apps/weather-engine/tests/test_persistence.py`

Push grid to Redis + write disk fallback.

- [ ] **Step 1: Write failing tests**

```python
# apps/weather-engine/tests/test_persistence.py
import json
import tempfile
from pathlib import Path
from unittest.mock import MagicMock

from nemo_weather.persistence import push_to_redis, save_to_disk, load_from_disk

SAMPLE_GRID = {
    "runTs": 1713340800,
    "bbox": {"latMin": -90, "latMax": 90, "lonMin": -180, "lonMax": 180},
    "resolution": 0.25,
    "shape": {"rows": 1, "cols": 1},
    "forecastHours": [0],
    "variables": {"u": "AAAA", "v": "AAAA", "swh": "AAAA", "mwdSin": "AAAA", "mwdCos": "AAAA", "mwp": "AAAA"},
}

def test_push_to_redis():
    mock_redis = MagicMock()
    push_to_redis(SAMPLE_GRID, mock_redis)
    mock_redis.set.assert_called_once()
    key = mock_redis.set.call_args[0][0]
    assert key == "weather:grid:1713340800"
    mock_redis.publish.assert_called_once_with("weather:grid:updated", "1713340800")

def test_save_and_load_disk():
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp)
        save_to_disk(SAMPLE_GRID, path)
        loaded = load_from_disk(path)
        assert loaded is not None
        assert loaded["runTs"] == 1713340800

def test_load_from_disk_empty_dir():
    with tempfile.TemporaryDirectory() as tmp:
        loaded = load_from_disk(Path(tmp))
        assert loaded is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/weather-engine && python -m pytest tests/test_persistence.py -v`
Expected: FAIL — module not found

- [ ] **Step 3: Implement persistence.py**

```python
# apps/weather-engine/src/nemo_weather/persistence.py
"""Redis push + disk fallback for weather grids."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

LOG = logging.getLogger("nemo.weather.persistence")

REDIS_TTL_SEC = 24 * 3600  # 24 hours


def push_to_redis(grid: dict[str, Any], redis_client: Any) -> None:
    """Push grid to Redis with TTL and notify via pub/sub."""
    run_ts = grid["runTs"]
    key = f"weather:grid:{run_ts}"
    redis_client.set(key, json.dumps(grid), ex=REDIS_TTL_SEC)
    redis_client.publish("weather:grid:updated", str(run_ts))
    LOG.info("pushed to redis key=%s (TTL=%ds)", key, REDIS_TTL_SEC)


def save_to_disk(grid: dict[str, Any], directory: Path) -> Path:
    """Write grid JSON to disk as fallback. Keeps only the latest file."""
    directory.mkdir(parents=True, exist_ok=True)
    # Remove old files
    for old in directory.glob("weather-grid-*.json"):
        old.unlink()
    path = directory / f"weather-grid-{grid['runTs']}.json"
    path.write_text(json.dumps(grid))
    LOG.info("saved to disk %s", path)
    return path


def load_from_disk(directory: Path) -> dict[str, Any] | None:
    """Load the most recent grid from disk fallback."""
    files = sorted(directory.glob("weather-grid-*.json"))
    if not files:
        return None
    latest = files[-1]
    LOG.info("loading from disk %s", latest)
    return json.loads(latest.read_text())
```

- [ ] **Step 4: Run tests**

Run: `cd apps/weather-engine && python -m pytest tests/test_persistence.py -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/weather-engine/src/nemo_weather/persistence.py apps/weather-engine/tests/test_persistence.py
git commit -m "feat(weather): add Redis push + disk fallback persistence"
```

---

## Task 11: Python Ingestion — Complete Main Loop

**Files:**
- Modify: `apps/weather-engine/src/nemo_weather/ingest.py`

Wire together poller, grid_builder, and persistence into the main ingest loop.

- [ ] **Step 1: Rewrite ingest.py main loop**

```python
# apps/weather-engine/src/nemo_weather/ingest.py
"""NOAA GFS ingest — continuous polling and ingestion."""

from __future__ import annotations

import calendar
import datetime as dt
import logging
import os
import sys
import time
from pathlib import Path
from typing import Iterable

import numpy as np
import redis as redis_lib
import requests

from .grid_builder import (
    build_grid_payload,
    decompose_mwd,
    parse_atmos_grib,
    parse_wave_grib,
    uv_to_components,
)
from .persistence import load_from_disk, push_to_redis, save_to_disk
from .poller import check_run_available, pick_target_run, wait_for_run

LOG = logging.getLogger("nemo.weather")

NOAA_ATMOS = (
    "https://nomads.ncep.noaa.gov/pub/data/nccf/com/gfs/prod/"
    "gfs.{ymd}/{hh}/atmos/gfs.t{hh}z.pgrb2.0p25.f{fff}"
)
NOAA_WAVE = (
    "https://nomads.ncep.noaa.gov/pub/data/nccf/com/gfs/prod/"
    "gfs.{ymd}/{hh}/wave/gridded/gfswave.t{hh}z.global.0p16.f{fff}.grib2"
)

# f000–f072 every 3h, f078–f240 every 6h (53 forecast hours)
FORECAST_HOURS: list[int] = list(range(0, 73, 3)) + list(range(78, 241, 6))

TMP_DIR = Path("/tmp/nemo-weather")
FALLBACK_DIR = Path(os.environ.get("WEATHER_FALLBACK_DIR", "/data/weather-fallback"))
MAX_RETRIES = 3
RETRY_BACKOFF = [5, 15, 45]
POLL_CYCLE_SEC = 300  # 5 minutes between run checks


def fetch_grib(url: str, dest: Path) -> Path:
    """Download a GRIB2 file with retries."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    for attempt in range(MAX_RETRIES):
        try:
            LOG.info("downloading %s (attempt %d)", url, attempt + 1)
            with requests.get(url, stream=True, timeout=120) as r:
                r.raise_for_status()
                with open(dest, "wb") as f:
                    for chunk in r.iter_content(chunk_size=1 << 20):
                        f.write(chunk)
            return dest
        except requests.RequestException as e:
            if attempt < MAX_RETRIES - 1:
                wait = RETRY_BACKOFF[attempt]
                LOG.warning("download failed: %s, retrying in %ds", e, wait)
                time.sleep(wait)
            else:
                raise
    return dest  # unreachable, but keeps mypy happy


def ingest_run(run: dt.datetime, redis_client: redis_lib.Redis) -> None:
    """Download and process all forecast hours for a single GFS run."""
    ymd = run.strftime("%Y%m%d")
    hh = f"{run.hour:02d}"
    run_ts = int(calendar.timegm(run.timetuple()))

    u_planes: list[np.ndarray] = []
    v_planes: list[np.ndarray] = []
    swh_planes: list[np.ndarray] = []
    mwd_sin_planes: list[np.ndarray] = []
    mwd_cos_planes: list[np.ndarray] = []
    mwp_planes: list[np.ndarray] = []
    ingested_hours: list[int] = []

    target_lats: np.ndarray | None = None
    target_lons: np.ndarray | None = None

    for fh in FORECAST_HOURS:
        fff = f"{fh:03d}"
        try:
            # Download atmospheric GRIB
            atmos_url = NOAA_ATMOS.format(ymd=ymd, hh=hh, fff=fff)
            atmos_path = TMP_DIR / f"atmos_{ymd}_{hh}_f{fff}.grib2"
            fetch_grib(atmos_url, atmos_path)
            u10, v10, lats, lons = parse_atmos_grib(atmos_path)

            if target_lats is None:
                target_lats = lats
                target_lons = lons

            u, v = uv_to_components(u10, v10)

            # Download wave GRIB
            wave_url = NOAA_WAVE.format(ymd=ymd, hh=hh, fff=fff)
            wave_path = TMP_DIR / f"wave_{ymd}_{hh}_f{fff}.grib2"
            fetch_grib(wave_url, wave_path)
            swh, mwd_raw, mwp = parse_wave_grib(wave_path, target_lats, target_lons)
            mwd_sin, mwd_cos = decompose_mwd(mwd_raw)

            u_planes.append(u)
            v_planes.append(v)
            swh_planes.append(swh)
            mwd_sin_planes.append(mwd_sin)
            mwd_cos_planes.append(mwd_cos)
            mwp_planes.append(mwp)
            ingested_hours.append(fh)

            # Clean up temp files
            atmos_path.unlink(missing_ok=True)
            wave_path.unlink(missing_ok=True)

            LOG.info("ingested f%s (%d/%d)", fff, len(ingested_hours), len(FORECAST_HOURS))

        except Exception:
            LOG.exception("failed to ingest f%s, skipping", fff)
            continue

    if not ingested_hours:
        LOG.error("no forecast hours ingested for run %s, aborting", run.isoformat())
        return

    rows = target_lats.shape[0] if target_lats is not None else 721
    cols = target_lons.shape[0] if target_lons is not None else 1440
    lat_min = float(target_lats[0]) if target_lats is not None else -90.0
    lat_max = float(target_lats[-1]) if target_lats is not None else 90.0
    lon_min = float(target_lons[0]) if target_lons is not None else -180.0
    lon_max = float(target_lons[-1]) if target_lons is not None else 180.0

    grid = build_grid_payload(
        run_ts=run_ts,
        forecast_hours=ingested_hours,
        u_planes=u_planes,
        v_planes=v_planes,
        swh_planes=swh_planes,
        mwd_sin_planes=mwd_sin_planes,
        mwd_cos_planes=mwd_cos_planes,
        mwp_planes=mwp_planes,
        bbox={"latMin": lat_min, "latMax": lat_max, "lonMin": lon_min, "lonMax": lon_max},
        resolution=0.25,
        shape={"rows": rows, "cols": cols},
    )

    # Push to Redis
    push_to_redis(grid, redis_client)

    # Save disk fallback
    save_to_disk(grid, FALLBACK_DIR)

    LOG.info("run %s complete: %d/%d forecast hours", run.isoformat(), len(ingested_hours), len(FORECAST_HOURS))


def main(argv: Iterable[str] | None = None) -> int:
    """Main loop: continuously poll for new GFS runs and ingest them."""
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    redis_url = os.environ.get("REDIS_URL", "redis://localhost:6379")
    redis_client = redis_lib.from_url(redis_url)
    LOG.info("connected to redis at %s", redis_url)

    last_ingested_ts = 0

    while True:
        target = pick_target_run()
        target_ts = int(calendar.timegm(target.timetuple()))

        if target_ts <= last_ingested_ts:
            LOG.debug("run %s already ingested, sleeping %ds", target.isoformat(), POLL_CYCLE_SEC)
            time.sleep(POLL_CYCLE_SEC)
            continue

        if not check_run_available(target):
            LOG.info("run %s not yet available, waiting...", target.isoformat())
            if not wait_for_run(target):
                time.sleep(POLL_CYCLE_SEC)
                continue

        try:
            ingest_run(target, redis_client)
            last_ingested_ts = target_ts
        except Exception:
            LOG.exception("failed to ingest run %s", target.isoformat())

        time.sleep(POLL_CYCLE_SEC)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
```

- [ ] **Step 2: Run all Python tests**

Run: `cd apps/weather-engine && python -m pytest tests/ -v`
Expected: ALL PASS

- [ ] **Step 3: Commit**

```bash
git add apps/weather-engine/src/nemo_weather/ingest.py
git commit -m "feat(weather): complete NOAA GFS ingest main loop with polling and retry"
```

---

## Task 12: Docker Setup for Weather Engine

**Files:**
- Create: `apps/weather-engine/Dockerfile`
- Modify: `docker-compose.dev.yml`
- Modify: `.env.example`

- [ ] **Step 1: Create Dockerfile**

```dockerfile
# apps/weather-engine/Dockerfile
FROM python:3.11-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends libeccodes-dev && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY pyproject.toml .
RUN pip install --no-cache-dir .

COPY src/ src/

# Disk fallback directory
RUN mkdir -p /data/weather-fallback

CMD ["python", "-m", "nemo_weather.ingest"]
```

- [ ] **Step 2: Add service to docker-compose.dev.yml**

Add after the redis service:

```yaml
  weather-engine:
    build:
      context: ./apps/weather-engine
      dockerfile: Dockerfile
    environment:
      - REDIS_URL=redis://redis:6379
      - WEATHER_FALLBACK_DIR=/data/weather-fallback
    volumes:
      - weather-fallback:/data/weather-fallback
    depends_on:
      redis:
        condition: service_healthy
    restart: unless-stopped
```

Add to the volumes section:

```yaml
  weather-fallback:
```

- [ ] **Step 3: Update .env.example**

Add:
```
# Weather Engine
WEATHER_FALLBACK_DIR=/data/weather-fallback
```

- [ ] **Step 4: Build and verify Docker image**

Run: `cd apps/weather-engine && docker build -t nemo-weather-engine .`
Expected: Build succeeds (image with libeccodes + Python deps)

- [ ] **Step 5: Commit**

```bash
git add apps/weather-engine/Dockerfile docker-compose.dev.yml .env.example
git commit -m "infra(weather): add Docker container for weather-engine"
```

---

## Task 13: Frontend — Binary Decoder

**Files:**
- Create: `apps/web/src/lib/weather/binaryDecoder.ts`

Decodes the ArrayBuffer from the REST endpoint into a typed grid usable by overlays.

- [ ] **Step 1: Implement binary decoder**

```typescript
// apps/web/src/lib/weather/binaryDecoder.ts

export const HEADER_SIZE = 48;

export interface WeatherGridHeader {
  runTimestamp: number;
  nextRunExpectedUtc: number;
  weatherStatus: 0 | 1 | 2; // stable, blending, delayed
  blendAlpha: number;
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
  gridStepLat: number;
  gridStepLon: number;
  numLat: number;
  numLon: number;
  numHours: number;
}

export interface DecodedWeatherGrid {
  header: WeatherGridHeader;
  /** Flat array: [hour0: [point0: u,v,swh,mwdSin,mwdCos,mwp, point1: ...], hour1: ...] */
  data: Float32Array;
}

export function decodeWeatherGrid(buf: ArrayBuffer): DecodedWeatherGrid {
  const dv = new DataView(buf);
  const header: WeatherGridHeader = {
    runTimestamp: dv.getUint32(0, true),
    nextRunExpectedUtc: dv.getUint32(4, true),
    weatherStatus: dv.getUint8(8) as 0 | 1 | 2,
    blendAlpha: dv.getFloat32(12, true),
    latMin: dv.getFloat32(16, true),
    latMax: dv.getFloat32(20, true),
    lonMin: dv.getFloat32(24, true),
    lonMax: dv.getFloat32(28, true),
    gridStepLat: dv.getFloat32(32, true),
    gridStepLon: dv.getFloat32(36, true),
    numLat: dv.getUint16(40, true),
    numLon: dv.getUint16(42, true),
    numHours: dv.getUint16(44, true),
  };
  const data = new Float32Array(buf, HEADER_SIZE);
  return { header, data };
}

/** Get wind U/V at a grid point for a specific forecast hour index. */
export function getPointAt(
  grid: DecodedWeatherGrid,
  hourIdx: number,
  latIdx: number,
  lonIdx: number,
): { u: number; v: number; swh: number; mwdSin: number; mwdCos: number; mwp: number } {
  const { numLat, numLon } = grid.header;
  const pointsPerHour = numLat * numLon;
  const base = (hourIdx * pointsPerHour + latIdx * numLon + lonIdx) * 6;
  return {
    u: grid.data[base]!,
    v: grid.data[base + 1]!,
    swh: grid.data[base + 2]!,
    mwdSin: grid.data[base + 3]!,
    mwdCos: grid.data[base + 4]!,
    mwp: grid.data[base + 5]!,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/lib/weather/binaryDecoder.ts
git commit -m "feat(weather): add binary ArrayBuffer decoder for frontend"
```

---

## Task 14: Frontend — GFS Status Hook and Weather Prefetch

**Files:**
- Create: `apps/web/src/hooks/useGfsStatus.ts`
- Create: `apps/web/src/lib/weather/prefetch.ts`
- Create: `apps/web/src/hooks/useWeatherPrefetch.ts`
- Modify: `apps/web/src/lib/store/types.ts`
- Modify: `apps/web/src/lib/store/weatherSlice.ts`

- [ ] **Step 1: Add GFS status types to store**

Add to `apps/web/src/lib/store/types.ts`:

```typescript
export interface GfsStatus {
  run: number;   // runTimestamp (unix seconds)
  next: number;  // nextRunExpectedUtc (unix seconds)
  status: 0 | 1 | 2; // stable, blending, delayed
  alpha: number;
}

export interface WeatherState {
  gridData: WeatherGrid | null;
  gridExpiresAt: Date | null;
  isLoading: boolean;
  gfsStatus: GfsStatus | null;
}
```

- [ ] **Step 2: Update weatherSlice.ts**

Add `gfsStatus` to initial state and add a `setGfsStatus` action:

```typescript
// Add to INITIAL_WEATHER:
gfsStatus: null as GfsStatus | null,

// Add action:
setGfsStatus: (status: GfsStatus) => set((s) => {
  s.weather.gfsStatus = status;
}),
```

- [ ] **Step 3: Create GFS status polling hook**

```typescript
// apps/web/src/hooks/useGfsStatus.ts
import { useEffect } from 'react';
import { useGameStore } from '@/lib/store';
import type { GfsStatus } from '@/lib/store/types';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3001';
const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export function useGfsStatus() {
  const setGfsStatus = useGameStore((s) => s.setGfsStatus);
  const gfsStatus = useGameStore((s) => s.weather.gfsStatus);

  useEffect(() => {
    let active = true;

    async function poll() {
      try {
        const res = await fetch(`${API_BASE}/api/v1/weather/status`);
        if (!res.ok) return;
        const data = (await res.json()) as GfsStatus;
        if (active) setGfsStatus(data);
      } catch {
        // silently ignore — will retry
      }
    }

    poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => { active = false; clearInterval(id); };
  }, [setGfsStatus]);

  return gfsStatus;
}
```

- [ ] **Step 4: Create prefetch logic**

```typescript
// apps/web/src/lib/weather/prefetch.ts
import { decodeWeatherGrid, type DecodedWeatherGrid } from './binaryDecoder';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3001';

export interface PrefetchOptions {
  bounds: { latMin: number; lonMin: number; latMax: number; lonMax: number };
  hours: number[];
}

export async function fetchWeatherGrid(opts: PrefetchOptions): Promise<DecodedWeatherGrid> {
  const boundsStr = `${opts.bounds.latMin},${opts.bounds.lonMin},${opts.bounds.latMax},${opts.bounds.lonMax}`;
  const hoursStr = opts.hours.join(',');
  const url = `${API_BASE}/api/v1/weather/grid?bounds=${boundsStr}&hours=${hoursStr}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`weather grid fetch failed: ${res.status}`);
  const buf = await res.arrayBuffer();
  return decodeWeatherGrid(buf);
}

/** Default forecast hours for Phase 1 prefetch (0–48h). */
export const PREFETCH_HOURS_PHASE1 = [0, 3, 6, 9, 12, 15, 18, 21, 24, 30, 36, 42, 48];

/** Extended forecast hours for Phase 2 prefetch (48h���240h). */
export const PREFETCH_HOURS_PHASE2 = [54, 60, 66, 72, 78, 84, 90, 96, 102, 108, 114, 120, 132, 144, 156, 168, 180, 192, 204, 216, 228, 240];

/** Default Atlantic bounds for prefetch before race bounds are known. */
export const DEFAULT_BOUNDS = { latMin: -60, lonMin: -80, latMax: 60, lonMax: 30 };
```

- [ ] **Step 5: Create prefetch hook**

```typescript
// apps/web/src/hooks/useWeatherPrefetch.ts
import { useEffect, useRef } from 'react';
import { useGameStore } from '@/lib/store';
import {
  fetchWeatherGrid,
  PREFETCH_HOURS_PHASE1,
  PREFETCH_HOURS_PHASE2,
  DEFAULT_BOUNDS,
} from '@/lib/weather/prefetch';

/**
 * Background prefetch hook — mount globally (in layout) after auth.
 * Phase 1: loads f000–f048 immediately.
 * Phase 2: loads f048–f240 when user enters /play.
 */
export function useWeatherPrefetch(options?: { phase2?: boolean }) {
  const setWeatherGrid = useGameStore((s) => s.setWeatherGrid);
  const gfsStatus = useGameStore((s) => s.weather.gfsStatus);
  const lastRunRef = useRef<number>(0);

  useEffect(() => {
    const currentRun = gfsStatus?.run ?? 0;
    if (currentRun === lastRunRef.current && lastRunRef.current !== 0) return;
    lastRunRef.current = currentRun;

    let cancelled = false;

    async function prefetch() {
      try {
        // Phase 1: 0–48h
        const grid1 = await fetchWeatherGrid({
          bounds: DEFAULT_BOUNDS,
          hours: PREFETCH_HOURS_PHASE1,
        });
        if (cancelled) return;
        setWeatherGrid(grid1);

        // Phase 2: 48h–240h (only on /play)
        if (options?.phase2) {
          const grid2 = await fetchWeatherGrid({
            bounds: DEFAULT_BOUNDS,
            hours: PREFETCH_HOURS_PHASE2,
          });
          if (cancelled) return;
          // Merge with existing grid — implementation depends on store structure
          setWeatherGrid(grid2);
        }
      } catch {
        // silently ignore — will retry on next status poll
      }
    }

    prefetch();
    return () => { cancelled = true; };
  }, [gfsStatus?.run, options?.phase2, setWeatherGrid]);
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/hooks/useGfsStatus.ts apps/web/src/hooks/useWeatherPrefetch.ts apps/web/src/lib/weather/prefetch.ts apps/web/src/lib/store/types.ts apps/web/src/lib/store/weatherSlice.ts
git commit -m "feat(weather): add GFS status polling and background prefetch hooks"
```

---

## Task 15: Frontend — GFS Status in LayersWidget

**Files:**
- Modify: `apps/web/src/components/play/LayersWidget.tsx`

- [ ] **Step 1: Add GFS status text to LayersWidget**

Add at the top of the widget, before the layer toggles. Import `useGfsStatus` and `useTranslations` from next-intl.

```tsx
// Inside LayersWidget component, before the layer toggles:
import { useGfsStatus } from '@/hooks/useGfsStatus';

// In the component body:
const gfsStatus = useGfsStatus();

// Helper to format relative time
function formatRelativeTime(timestampSec: number): string {
  const diffSec = Math.floor(Date.now() / 1000) - timestampSec;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} min`;
  return `${Math.floor(diffSec / 3600)}h`;
}

function formatCountdown(timestampSec: number): string {
  const diffSec = timestampSec - Math.floor(Date.now() / 1000);
  if (diffSec <= 0) return t('weather.pending');
  if (diffSec < 3600) return `~${Math.floor(diffSec / 60)} min`;
  return `~${Math.floor(diffSec / 3600)}h`;
}

// JSX — add before the layer toggles <div>:
{gfsStatus && (
  <div className="mb-3 text-xs text-stone-400 leading-relaxed">
    {gfsStatus.status === 1 ? (
      <p>{t('weather.updating')}</p>
    ) : (
      <>
        <p>{t('weather.lastUpdate', { run: new Date(gfsStatus.run * 1000).toISOString().slice(11, 16), ago: formatRelativeTime(gfsStatus.run) })}</p>
        <p>{t('weather.nextUpdate', { countdown: formatCountdown(gfsStatus.next) })}</p>
      </>
    )}
  </div>
)}
```

- [ ] **Step 2: Add i18n keys for all 4 locales**

Add to each locale's messages file (fr, en, es, de) under a `weather` namespace:

```json
{
  "weather": {
    "lastUpdate": "Météo GFS : maj {run} (il y a {ago})",
    "nextUpdate": "Prochaine mise à jour dans {countdown}",
    "updating": "Météo GFS : mise à jour en cours...",
    "pending": "en attente"
  }
}
```

Translate appropriately for en, es, de.

- [ ] **Step 3: Start dev server and verify visually**

Run: `cd apps/web && pnpm dev`
Open the play screen, open the LayersWidget. Verify the GFS status text appears at the top.
In fixture mode it will show timestamp 0 — that's expected. With NOAA mode it would show real run info.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/play/LayersWidget.tsx
git commit -m "feat(weather): show GFS run status in LayersWidget"
```

---

## Task 16: Update weather-engine README

**Files:**
- Modify: `apps/weather-engine/README.md`

- [ ] **Step 1: Rewrite README to reflect final architecture**

Update the README with:
- New U/V storage format (not TWS/TWD)
- 53 forecast hours (not 10)
- MWD stored as sin/cos components
- Continuous polling (not cron)
- Disk fallback mechanism
- Docker deployment instructions

```markdown
# Nemo — Weather Engine

Continuous NOAA GFS ingestion pipeline. Polls every 5 min, downloads GRIB2,
pushes U/V + wave grids to Redis.

## Architecture

1. Poll NOAA NOMADS for latest GFS run availability (HEAD on f000)
2. Download **53 forecast hours** per run:
   - f000–f072: every 3h (atmospheric 0.25° + wave 0.16°)
   - f078–f240: every 6h
3. Parse GRIB2 via `cfgrib` + `xarray`
4. Re-interpolate wave data (0.16°) to atmospheric grid (0.25°)
5. Store as 6 Float32Array planes: **U, V, SWH, MWD_sin, MWD_cos, MWP**
6. Push to Redis key `weather:grid:{runTs}` (TTL 24h) + pub/sub notification
7. Write latest run to disk as fallback

## Redis Key Format

```json
{
  "runTs": 1713340800,
  "bbox": { "latMin": -90, "latMax": 90, "lonMin": -180, "lonMax": 180 },
  "resolution": 0.25,
  "shape": { "rows": 721, "cols": 1440 },
  "forecastHours": [0, 3, 6, ..., 240],
  "variables": {
    "u": "<base64 Float32Array>",
    "v": "<base64>",
    "swh": "<base64>",
    "mwdSin": "<base64>",
    "mwdCos": "<base64>",
    "mwp": "<base64>"
  }
}
```

## Running

```bash
# Docker (recommended)
docker compose -f docker-compose.dev.yml up weather-engine

# Local
pip install -e .
REDIS_URL=redis://localhost:6379 python -m nemo_weather.ingest
```

## System Dependencies

- `libeccodes-dev` (GRIB2 parsing)
- Python 3.11+
- Redis 7+
```

- [ ] **Step 2: Commit**

```bash
git add apps/weather-engine/README.md
git commit -m "docs(weather): update README with final pipeline architecture"
```

---

## Summary

| Task | Component | Est. |
|------|-----------|------|
| 1 | U/V conversion helpers | 5 min |
| 2 | Grid refactor to U/V | 15 min |
| 3 | Blending logic | 10 min |
| 4 | Blending provider | 15 min |
| 5 | Binary encoder | 10 min |
| 6 | REST endpoints | 10 min |
| 7 | Worker NOAA switch | 5 min |
| 8 | Python poller | 10 min |
| 9 | Python grid builder | 15 min |
| 10 | Python persistence | 10 min |
| 11 | Python main loop | 15 min |
| 12 | Docker setup | 10 min |
| 13 | Frontend binary decoder | 5 min |
| 14 | Frontend prefetch + hooks | 15 min |
| 15 | LayersWidget GFS status | 10 min |
| 16 | Update README | 5 min |
