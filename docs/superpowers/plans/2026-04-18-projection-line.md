# Projection Line Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display a 7-day projected trajectory line on the map, reflecting the player's programmed route, real weather data, upgrades, progressive wear, and maneuver penalties.

**Architecture:** A Web Worker (`projection.worker.ts`) calculates ~1 188 points using adaptive time steps (30s→5min→15min). A React hook (`useProjectionLine.ts`) manages Worker lifecycle and feeds results into 3 MapLibre layers (dashed speed-gradient line, time markers, maneuver markers). Simulation logic (wear, maneuver detection, polar lookup) is duplicated from game-engine into a browser-compatible module since game-engine is server-only.

**Tech Stack:** TypeScript, Web Worker (native `new Worker()`), MapLibre GL JS, Zustand, `@nemo/polar-lib`, `@nemo/game-balance`, `@nemo/shared-types`

---

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `apps/web/src/workers/projection.worker.ts` | Web Worker: receives inputs via postMessage, runs adaptive-step simulation loop, returns ProjectionResult |
| `apps/web/src/lib/projection/types.ts` | Shared types: ProjectionInput, ProjectionResult, ProjectionPoint, TimeMarker, ManeuverMarker |
| `apps/web/src/lib/projection/simulate.ts` | Pure simulation core: single-step advance, wear delta, maneuver detection, speed chain — browser-compatible port of game-engine logic |
| `apps/web/src/lib/projection/windLookup.ts` | Wind interpolation for the Worker: wraps grid data with spatial+temporal bilinear interpolation |
| `apps/web/src/hooks/useProjectionLine.ts` | React hook: instantiates Worker, subscribes to store changes, debounces, posts inputs, receives results, updates MapLibre sources |

### Modified files

| File | Changes |
|------|---------|
| `apps/web/src/components/play/MapCanvas.tsx` | Add 3 projection sources + layers at map init, call useProjectionLine hook |
| `apps/web/next.config.ts` | Add webpack config for `.worker.ts` files |

---

### Task 1: Next.js Web Worker support

**Files:**
- Modify: `apps/web/next.config.ts`

- [ ] **Step 1: Add webpack worker config**

Next.js uses webpack under the hood. We need to tell it how to handle `.worker.ts` imports. Edit `apps/web/next.config.ts`:

```typescript
import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  reactCompiler: true,
  compress: true,
  transpilePackages: ['@nemo/shared-types'],
  typedRoutes: true,
  webpack(cfg) {
    cfg.module?.rules?.push({
      test: /\.worker\.ts$/,
      loader: 'worker-loader',
      options: { inline: 'fallback' },
    });
    return cfg;
  },
  async headers() {
    return [
      {
        source: '/data/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=604800, stale-while-revalidate=86400' },
        ],
      },
    ];
  },
};

export default config;
```

**Note:** If `worker-loader` is not already installed, we'll use the native `new Worker(new URL(...), { type: 'module' })` pattern instead, which Next.js 14+ supports via webpack 5 asset modules with no config change. Try native first — if it fails, fall back to the config above.

- [ ] **Step 2: Verify native Worker support**

Create a minimal test. In the browser console or a temp file, check that `new Worker(new URL('./test.worker.ts', import.meta.url))` compiles. If it does, skip the webpack config change entirely — Next.js 14+ handles this natively.

Run: `cd apps/web && pnpm dev`

Open browser devtools, check for Worker registration errors. If none, native support works.

- [ ] **Step 3: Commit**

```bash
git add apps/web/next.config.ts
git commit -m "chore: verify/add web worker support for projection"
```

---

### Task 2: Projection types

**Files:**
- Create: `apps/web/src/lib/projection/types.ts`

- [ ] **Step 1: Create the types file**

```typescript
// apps/web/src/lib/projection/types.ts
import type { SailId, BoatClass } from '@nemo/shared-types';
import type { WeatherGridPoint } from '@/lib/store/types';

// ── Worker Input ──

export interface ProjectionInput {
  /** Current boat position */
  lat: number;
  lon: number;
  hdg: number;
  /** Current timestamp (ms) */
  nowMs: number;
  /** Boat class for maneuver config lookup */
  boatClass: BoatClass;
  /** Active sail */
  activeSail: SailId;
  /** Whether sail auto-mode is on */
  sailAuto: boolean;
  /** TWA lock value (null = heading mode, number = locked TWA) */
  twaLock: number | null;
  /** Programmed segments — ordered list of future orders */
  segments: ProjectionSegment[];
  /** Polar table: { twa: number[], tws: number[], speeds: number[][] } */
  polar: { twa: number[]; tws: number[]; speeds: number[][] };
  /** Aggregated upgrade effects */
  effects: ProjectionEffects;
  /** Current wear condition (0-100 per component) */
  condition: { hull: number; rig: number; sails: number; electronics: number };
  /** Current maneuver in progress (null if none) */
  activeManeuver: { endMs: number; speedFactor: number } | null;
  /** Current sail transition in progress (null if none) */
  activeTransition: { endMs: number; speedFactor: number } | null;
  /** Previous TWA for maneuver detection on first step */
  prevTwa: number | null;
  /** Weather grid config */
  windGrid: {
    bounds: { north: number; south: number; east: number; west: number };
    resolution: number;
    cols: number;
    rows: number;
    /** Timestamps (ms) for each time layer */
    timestamps: number[];
  };
  /** Flattened weather data: for each timestamp, an array of grid points
   *  ordered row-major (lat descending, lon ascending).
   *  Length = timestamps.length × rows × cols × 6 (tws, twd, swellHeight, swellDir, swellPeriod, _pad) */
  windData: Float32Array;
}

export interface ProjectionSegment {
  /** When this order triggers (ms timestamp), or 'immediate' */
  triggerMs: number;
  /** Order type */
  type: 'CAP' | 'TWA' | 'SAIL' | 'MODE';
  /** New heading for CAP, new TWA for TWA, sail ID for SAIL, auto boolean for MODE */
  value: number | string | boolean;
}

export interface ProjectionEffects {
  speedByTwa: [number, number, number, number, number];
  speedByTws: [number, number, number];
  wearMul: { hull: number; rig: number; sail: number; elec: number };
  maneuverMul: {
    tack: { dur: number; speed: number };
    gybe: { dur: number; speed: number };
    sailChange: { dur: number; speed: number };
  };
}

// ── Worker Output ──

export interface ProjectionPoint {
  lat: number;
  lon: number;
  timestamp: number;
  bsp: number;
  tws: number;
  twd: number;
}

export interface TimeMarker {
  index: number;
  label: string;
}

export interface ManeuverMarker {
  index: number;
  type: 'tack' | 'gybe' | 'sail_change' | 'cap_change' | 'twa_change';
  detail: string;
}

export interface ProjectionResult {
  points: ProjectionPoint[];
  timeMarkers: TimeMarker[];
  maneuverMarkers: ManeuverMarker[];
  bspMax: number;
}

// ── Worker Messages ──

export type WorkerInMessage =
  | { type: 'compute'; input: ProjectionInput }
  | { type: 'updateWind'; windData: Float32Array; timestamps: number[] };

export type WorkerOutMessage =
  | { type: 'result'; result: ProjectionResult }
  | { type: 'error'; message: string };
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/lib/projection/types.ts
git commit -m "feat(projection): add shared types for worker communication"
```

---

### Task 3: Wind lookup module

**Files:**
- Create: `apps/web/src/lib/projection/windLookup.ts`

- [ ] **Step 1: Create the wind lookup with spatial + temporal interpolation**

This module provides wind and swell at any (lat, lon, timestamp) from the GRIB grid. It does bilinear spatial interpolation (same as `interpolate.ts`) plus linear temporal interpolation between GRIB timesteps.

```typescript
// apps/web/src/lib/projection/windLookup.ts

export interface WindGridConfig {
  bounds: { north: number; south: number; east: number; west: number };
  resolution: number;
  cols: number;
  rows: number;
  timestamps: number[];
}

export interface WeatherAtPoint {
  tws: number;
  twd: number;
  swh: number;       // significant wave height (meters)
  swellDir: number;
  swellPeriod: number;
}

const DEG_TO_RAD = Math.PI / 180;
const FIELDS_PER_POINT = 5; // tws, twd, swh, swellDir, swellPeriod

/**
 * Create a lookup function from a flat Float32Array of weather data.
 * Data layout per time layer: rows × cols points, each with FIELDS_PER_POINT floats.
 * Points ordered: lat descending (north→south), lon ascending (west→east).
 */
export function createWindLookup(
  config: WindGridConfig,
  data: Float32Array,
) {
  const { bounds, resolution, cols, rows, timestamps } = config;
  const pointsPerLayer = rows * cols;
  const floatsPerLayer = pointsPerLayer * FIELDS_PER_POINT;

  function sampleLayer(layerIdx: number, lat: number, lon: number): WeatherAtPoint {
    const offset = layerIdx * floatsPerLayer;

    const fx = (lon - bounds.west) / resolution;
    const fy = (bounds.north - lat) / resolution;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const dx = fx - ix;
    const dy = fy - iy;

    const maxX = cols - 1;
    const maxY = rows - 1;
    const x0 = Math.max(0, Math.min(ix, maxX));
    const x1 = Math.min(x0 + 1, maxX);
    const y0 = Math.max(0, Math.min(iy, maxY));
    const y1 = Math.min(y0 + 1, maxY);

    const idx = (r: number, c: number) => offset + (r * cols + c) * FIELDS_PER_POINT;
    const i00 = idx(y0, x0);
    const i10 = idx(y0, x1);
    const i01 = idx(y1, x0);
    const i11 = idx(y1, x1);

    // Bilinear weight factors
    const w00 = (1 - dx) * (1 - dy);
    const w10 = dx * (1 - dy);
    const w01 = (1 - dx) * dy;
    const w11 = dx * dy;

    // TWS: direct interpolation
    const tws = data[i00]! * w00 + data[i10]! * w10 + data[i01]! * w01 + data[i11]! * w11;

    // TWD: interpolate via u/v components to handle wrap-around
    const toRad = DEG_TO_RAD;
    const u = -(Math.sin(data[i00 + 1]! * toRad) * data[i00]! * w00
              + Math.sin(data[i10 + 1]! * toRad) * data[i10]! * w10
              + Math.sin(data[i01 + 1]! * toRad) * data[i01]! * w01
              + Math.sin(data[i11 + 1]! * toRad) * data[i11]! * w11);
    const v = -(Math.cos(data[i00 + 1]! * toRad) * data[i00]! * w00
              + Math.cos(data[i10 + 1]! * toRad) * data[i10]! * w10
              + Math.cos(data[i01 + 1]! * toRad) * data[i01]! * w01
              + Math.cos(data[i11 + 1]! * toRad) * data[i11]! * w11);
    const twd = ((Math.atan2(-u, -v) / toRad) + 360) % 360;

    // SWH, swellDir, swellPeriod: direct bilinear
    const swh = data[i00 + 2]! * w00 + data[i10 + 2]! * w10 + data[i01 + 2]! * w01 + data[i11 + 2]! * w11;
    const swellDir = data[i00 + 3]! * w00 + data[i10 + 3]! * w10 + data[i01 + 3]! * w01 + data[i11 + 3]! * w11;
    const swellPeriod = data[i00 + 4]! * w00 + data[i10 + 4]! * w10 + data[i01 + 4]! * w01 + data[i11 + 4]! * w11;

    return { tws: Math.max(0, tws), twd, swh: Math.max(0, swh), swellDir, swellPeriod };
  }

  /**
   * Get weather at (lat, lon, timeMs) with temporal interpolation between GRIB layers.
   * Returns null if timeMs is beyond the last GRIB timestamp.
   */
  return function getWeatherAt(lat: number, lon: number, timeMs: number): WeatherAtPoint | null {
    if (timestamps.length === 0) return null;
    if (timeMs >= timestamps[timestamps.length - 1]!) return null;

    // Find bracketing timestamps
    if (timeMs <= timestamps[0]!) {
      return sampleLayer(0, lat, lon);
    }

    let t0Idx = 0;
    for (let i = 0; i < timestamps.length - 1; i++) {
      if (timeMs >= timestamps[i]! && timeMs < timestamps[i + 1]!) {
        t0Idx = i;
        break;
      }
    }
    const t1Idx = t0Idx + 1;
    const t0 = timestamps[t0Idx]!;
    const t1 = timestamps[t1Idx]!;
    const tFrac = (timeMs - t0) / (t1 - t0);

    if (tFrac <= 0.01) return sampleLayer(t0Idx, lat, lon);
    if (tFrac >= 0.99) return sampleLayer(t1Idx, lat, lon);

    // Temporal interpolation between two spatial samples
    const w0 = sampleLayer(t0Idx, lat, lon);
    const w1 = sampleLayer(t1Idx, lat, lon);

    return {
      tws: w0.tws * (1 - tFrac) + w1.tws * tFrac,
      twd: temporalInterpAngle(w0.twd, w1.twd, tFrac),
      swh: w0.swh * (1 - tFrac) + w1.swh * tFrac,
      swellDir: temporalInterpAngle(w0.swellDir, w1.swellDir, tFrac),
      swellPeriod: w0.swellPeriod * (1 - tFrac) + w1.swellPeriod * tFrac,
    };
  };
}

/** Linear interpolation of angles (0-360) handling wrap-around. */
function temporalInterpAngle(a: number, b: number, t: number): number {
  let diff = b - a;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  return ((a + diff * t) + 360) % 360;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/lib/projection/windLookup.ts
git commit -m "feat(projection): wind lookup with spatial+temporal interpolation"
```

---

### Task 4: Simulation core (browser-compatible)

**Files:**
- Create: `apps/web/src/lib/projection/simulate.ts`

This is a browser-compatible port of the relevant game-engine logic: polar lookup, TWA computation, position advance, wear calculation, maneuver detection. We duplicate these small functions rather than importing from `apps/game-engine` (which is server-only with Node dependencies).

- [ ] **Step 1: Create the simulation module**

```typescript
// apps/web/src/lib/projection/simulate.ts
import { GameBalance } from '@nemo/game-balance';
import type { ProjectionEffects } from './types';
import type { WeatherAtPoint } from './windLookup';

// ── Constants ──

const EARTH_RADIUS_NM = 3440.065;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

// ── Position advance (rhumb-line) ──

export interface Position {
  lat: number;
  lon: number;
}

export function advancePosition(pos: Position, heading: number, bsp: number, dtSeconds: number): Position {
  const distNm = (bsp * dtSeconds) / 3600;
  const distRad = distNm / EARTH_RADIUS_NM;
  const lat1 = pos.lat * DEG_TO_RAD;
  const lon1 = pos.lon * DEG_TO_RAD;
  const brg = heading * DEG_TO_RAD;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(distRad) + Math.cos(lat1) * Math.sin(distRad) * Math.cos(brg),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(brg) * Math.sin(distRad) * Math.cos(lat1),
      Math.cos(distRad) - Math.sin(lat1) * Math.sin(lat2),
    );

  return {
    lat: lat2 * RAD_TO_DEG,
    lon: ((lon2 * RAD_TO_DEG + 540) % 360) - 180,
  };
}

// ── TWA ──

export function computeTWA(heading: number, twd: number): number {
  let twa = ((heading - twd + 540) % 360) - 180;
  if (twa === -180) twa = 180;
  return twa;
}

// ── Polar lookup (bilinear interpolation) ──

export interface PolarData {
  twa: number[];
  tws: number[];
  speeds: number[][];
}

function findBracket(arr: number[], value: number): { i0: number; i1: number; t: number } {
  if (value <= arr[0]!) return { i0: 0, i1: 0, t: 0 };
  if (value >= arr[arr.length - 1]!) {
    const last = arr.length - 1;
    return { i0: last, i1: last, t: 0 };
  }
  for (let i = 0; i < arr.length - 1; i++) {
    if (value >= arr[i]! && value <= arr[i + 1]!) {
      const span = arr[i + 1]! - arr[i]!;
      return { i0: i, i1: i + 1, t: span === 0 ? 0 : (value - arr[i]!) / span };
    }
  }
  return { i0: 0, i1: 0, t: 0 };
}

export function getPolarSpeed(polar: PolarData, twa: number, tws: number): number {
  const absTwa = Math.min(Math.abs(twa), 180);
  const a = findBracket(polar.twa, absTwa);
  const s = findBracket(polar.tws, tws);

  const r0 = polar.speeds[a.i0]!;
  const r1 = polar.speeds[a.i1]!;
  const v00 = r0[s.i0]!;
  const v01 = r0[s.i1]!;
  const v10 = r1[s.i0]!;
  const v11 = r1[s.i1]!;

  const top = v00 * (1 - s.t) + v01 * s.t;
  const bot = v10 * (1 - s.t) + v11 * s.t;
  return top * (1 - a.t) + bot * a.t;
}

/** Compute BSP max across all TWA/TWS combinations for gradient normalization. */
export function computeBspMax(polar: PolarData): number {
  let max = 0;
  for (const row of polar.speeds) {
    for (const v of row) {
      if (v > max) max = v;
    }
  }
  return max;
}

// ── TWA/TWS band selection (matches game-engine bands.ts) ──

function bandFor(value: number, thresholds: readonly number[]): number {
  let band = 0;
  for (const t of thresholds) {
    if (value >= t) band++;
    else break;
  }
  return band;
}

// ── Wear calculation (port of wear.ts, minus driveMode) ──

export interface ConditionState {
  hull: number;
  rig: number;
  sails: number;
  electronics: number;
}

function windWearMultiplier(tws: number): number {
  const { thresholdKnots, maxFactor, scaleKnots } = GameBalance.wear.windMultipliers;
  if (tws <= thresholdKnots) return 1.0;
  const excess = (tws - thresholdKnots) / scaleKnots;
  return Math.min(maxFactor, 1 + excess * (maxFactor - 1));
}

function swellWearMultiplier(swh: number, swellDir: number, heading: number, swellPeriod: number): number {
  const cfg = GameBalance.wear.swellMultipliers;
  if (swh <= cfg.thresholdMeters) return 1.0;
  const encounterAngle = Math.abs(((heading - swellDir + 540) % 360) - 180);
  const faceBlend = encounterAngle / 180;
  const dirFactor = cfg.dirBackMin + (cfg.dirFaceMax - cfg.dirBackMin) * faceBlend;
  const heightFactor = Math.min(swh / cfg.maxHeightMeters, 1);
  const periodFactor = swellPeriod > 0 && swellPeriod < cfg.shortPeriodThreshold ? cfg.shortPeriodFactor : 1.0;
  return 1 + dirFactor * heightFactor * periodFactor;
}

export function computeWearDelta(
  weather: WeatherAtPoint,
  heading: number,
  dtSec: number,
  effects: ProjectionEffects,
): ConditionState {
  const wear = GameBalance.wear;
  const hoursFraction = dtSec / 3600;
  const windMul = windWearMultiplier(weather.tws);
  const swellMul = swellWearMultiplier(weather.swh, weather.swellDir, heading, weather.swellPeriod);

  return {
    hull: wear.baseRatesPerHour.hull * hoursFraction * windMul * swellMul * effects.wearMul.hull,
    rig: wear.baseRatesPerHour.rig * hoursFraction * windMul * effects.wearMul.rig,
    sails: wear.baseRatesPerHour.sails * hoursFraction * windMul * effects.wearMul.sail,
    electronics: wear.baseRatesPerHour.electronics * hoursFraction * effects.wearMul.elec,
  };
}

export function applyWear(current: ConditionState, delta: ConditionState): ConditionState {
  const floor = GameBalance.wear.minCondition;
  return {
    hull: Math.max(floor, current.hull - delta.hull),
    rig: Math.max(floor, current.rig - delta.rig),
    sails: Math.max(floor, current.sails - delta.sails),
    electronics: Math.max(floor, current.electronics - delta.electronics),
  };
}

export function conditionSpeedPenalty(c: ConditionState): number {
  const { thresholdNone, thresholdMax, slopePerPoint } = GameBalance.wear.penaltyCurve;
  const worst = Math.min(c.hull, c.rig, c.sails);
  if (worst >= thresholdNone) return 1.0;
  const pointsLost = thresholdNone - worst;
  const pct = Math.min(GameBalance.wear.maxSpeedPenalty, pointsLost * slopePerPoint);
  const clampedPct = worst <= thresholdMax ? GameBalance.wear.maxSpeedPenalty : pct;
  return 1 - clampedPct / 100;
}

// ── Maneuver detection (port of sails.ts) ──

export interface ManeuverState {
  endMs: number;
  speedFactor: number;
}

export function detectManeuver(
  prevTwa: number,
  newTwa: number,
  boatClass: string,
  nowMs: number,
  effects: ProjectionEffects,
): ManeuverState | null {
  const prevSign = Math.sign(prevTwa);
  const newSign = Math.sign(newTwa);
  if (prevSign === 0 || newSign === 0 || prevSign === newSign) return null;

  const isTack = Math.abs(newTwa) < 90;
  const cfg = isTack ? GameBalance.maneuvers.tack : GameBalance.maneuvers.gybe;
  const manKey = isTack ? 'tack' : 'gybe' as const;
  const baseDuration = (cfg.durationSec as Record<string, number>)[boatClass] ?? 30;
  const baseSpeed = cfg.speedFactor;
  const durationMs = baseDuration * effects.maneuverMul[manKey].dur * 1000;
  return {
    endMs: nowMs + durationMs,
    speedFactor: baseSpeed * effects.maneuverMul[manKey].speed,
  };
}

export function maneuverSpeedFactor(maneuver: ManeuverState | null, nowMs: number): number {
  if (!maneuver || nowMs >= maneuver.endMs) return 1.0;
  return maneuver.speedFactor;
}

// ── Sail transition penalty ──

export function transitionSpeedFactor(transition: { endMs: number; speedFactor: number } | null, nowMs: number, effects: ProjectionEffects): number {
  if (!transition || nowMs >= transition.endMs) return 1.0;
  return GameBalance.sails.transitionPenalty * effects.maneuverMul.sailChange.speed;
}

// ── Full speed chain (matches tick.ts bspMultiplier) ──

export function computeBsp(
  polar: PolarData,
  twa: number,
  tws: number,
  condition: ConditionState,
  effects: ProjectionEffects,
  maneuver: ManeuverState | null,
  transition: { endMs: number; speedFactor: number } | null,
  nowMs: number,
): number {
  const baseBsp = getPolarSpeed(polar, twa, tws);
  const twaBand = bandFor(Math.abs(twa), [60, 90, 120, 150]);
  const twsBand = bandFor(tws, [10, 20]);

  const multiplier =
    effects.speedByTwa[twaBand]! *
    effects.speedByTws[twsBand]! *
    conditionSpeedPenalty(condition) *
    maneuverSpeedFactor(maneuver, nowMs) *
    transitionSpeedFactor(transition, nowMs, effects);

  return baseBsp * multiplier;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/lib/projection/simulate.ts
git commit -m "feat(projection): browser-compatible simulation core"
```

---

### Task 5: Projection Worker

**Files:**
- Create: `apps/web/src/workers/projection.worker.ts`

- [ ] **Step 1: Create the Worker with adaptive-step simulation loop**

```typescript
// apps/web/src/workers/projection.worker.ts
/// <reference lib="webworker" />

import type {
  ProjectionInput,
  ProjectionResult,
  ProjectionPoint,
  TimeMarker,
  ManeuverMarker,
  ProjectionSegment,
  WorkerInMessage,
  WorkerOutMessage,
} from '@/lib/projection/types';
import {
  advancePosition,
  computeTWA,
  computeBsp,
  computeBspMax,
  computeWearDelta,
  applyWear,
  detectManeuver,
  type PolarData,
  type ConditionState,
  type ManeuverState,
} from '@/lib/projection/simulate';
import { createWindLookup } from '@/lib/projection/windLookup';

// ── Adaptive step config ──

const STEP_30S = 30;          // 0 → 3h
const STEP_5M = 5 * 60;       // 3h → 24h
const STEP_15M = 15 * 60;     // 24h → 7j

const HOURS_3 = 3 * 3600;
const HOURS_24 = 24 * 3600;
const DAYS_7 = 7 * 24 * 3600;

function getStepSize(elapsedSec: number): number {
  if (elapsedSec < HOURS_3) return STEP_30S;
  if (elapsedSec < HOURS_24) return STEP_5M;
  return STEP_15M;
}

// ── Time marker labels ──

const TIME_MARKER_HOURS = [1, 2, 3, 6, 12, 24, 48, 72, 96, 120, 144, 168];

function hourLabel(h: number): string {
  return `${h}h`;
}

// ── Main simulation ──

function simulate(input: ProjectionInput): ProjectionResult {
  const getWeatherAt = createWindLookup(input.windGrid, input.windData);

  const polar: PolarData = input.polar;
  const bspMax = computeBspMax(polar);
  const effects = input.effects;

  const points: ProjectionPoint[] = [];
  const timeMarkers: TimeMarker[] = [];
  const maneuverMarkers: ManeuverMarker[] = [];

  // State
  let lat = input.lat;
  let lon = input.lon;
  let hdg = input.hdg;
  let twaLock = input.twaLock;
  let activeSail = input.activeSail;
  let sailAuto = input.sailAuto;
  let condition: ConditionState = { ...input.condition };
  let maneuver: ManeuverState | null = input.activeManeuver ? { ...input.activeManeuver } : null;
  let transition: { endMs: number; speedFactor: number } | null =
    input.activeTransition ? { ...input.activeTransition } : null;
  let prevTwa = input.prevTwa;

  const startMs = input.nowMs;
  let currentMs = startMs;
  const endMs = startMs + DAYS_7 * 1000;

  // Sort segments by trigger time
  const segments = [...input.segments].sort((a, b) => a.triggerMs - b.triggerMs);
  let segIdx = 0;

  // Track which time marker hours we've passed
  let nextTimeMarkerIdx = 0;

  // Initial point
  const initWeather = getWeatherAt(lat, lon, currentMs);
  if (!initWeather) {
    return { points: [], timeMarkers: [], maneuverMarkers: [], bspMax };
  }
  const initTwa = twaLock ?? computeTWA(hdg, initWeather.twd);
  points.push({
    lat, lon,
    timestamp: currentMs,
    bsp: computeBsp(polar, initTwa, initWeather.tws, condition, effects, maneuver, transition, currentMs),
    tws: initWeather.tws,
    twd: initWeather.twd,
  });

  while (currentMs < endMs) {
    const elapsedSec = (currentMs - startMs) / 1000;
    let dt = getStepSize(elapsedSec);

    // Check if a segment triggers within this step — force exact computation at trigger
    let segmentTriggered = false;
    while (segIdx < segments.length && segments[segIdx]!.triggerMs <= currentMs + dt * 1000) {
      const seg = segments[segIdx]!;

      // Advance to segment trigger time first (if in the future)
      if (seg.triggerMs > currentMs) {
        const partialDt = (seg.triggerMs - currentMs) / 1000;
        const weather = getWeatherAt(lat, lon, currentMs);
        if (!weather) break;
        const twa = twaLock !== null ? twaLock : computeTWA(hdg, weather.twd);
        const bsp = computeBsp(polar, twa, weather.tws, condition, effects, maneuver, transition, currentMs);
        const newPos = advancePosition({ lat, lon }, hdg, bsp, partialDt);
        lat = newPos.lat;
        lon = newPos.lon;

        // Wear
        const wearDelta = computeWearDelta(weather, hdg, partialDt, effects);
        condition = applyWear(condition, wearDelta);

        currentMs = seg.triggerMs;
      }

      // Apply segment order
      const prevHdg = hdg;
      const prevTwaLock = twaLock;
      const prevSail = activeSail;

      let markerType: ManeuverMarker['type'] = 'cap_change';
      let markerDetail = '';

      switch (seg.type) {
        case 'CAP':
          hdg = seg.value as number;
          twaLock = null;
          markerType = 'cap_change';
          markerDetail = `CAP ${Math.round(prevHdg)}° → ${Math.round(hdg)}°`;
          break;
        case 'TWA':
          twaLock = seg.value as number;
          markerType = 'twa_change';
          markerDetail = `TWA ${prevTwaLock !== null ? Math.round(prevTwaLock) + '°' : 'off'} → ${Math.round(twaLock)}° lock`;
          break;
        case 'SAIL':
          activeSail = seg.value as typeof activeSail;
          markerType = 'sail_change';
          markerDetail = `Voile: ${prevSail} → ${activeSail}`;
          // Sail change penalty
          const sailTransDur = GameBalance.sails.transitionTimes[`${prevSail}_${activeSail}`] ?? 180;
          const sailTransDurAdj = sailTransDur * effects.maneuverMul.sailChange.dur;
          transition = {
            endMs: currentMs + sailTransDurAdj * 1000,
            speedFactor: GameBalance.sails.transitionPenalty * effects.maneuverMul.sailChange.speed,
          };
          break;
        case 'MODE':
          sailAuto = seg.value as boolean;
          break;
      }

      // Detect tack/gybe from heading/TWA change
      if (seg.type === 'CAP' || seg.type === 'TWA') {
        const weather = getWeatherAt(lat, lon, currentMs);
        if (weather && prevTwa !== null) {
          const newTwa = twaLock !== null ? twaLock : computeTWA(hdg, weather.twd);
          const man = detectManeuver(prevTwa, newTwa, input.boatClass, currentMs, effects);
          if (man) {
            maneuver = man;
            markerType = Math.abs(newTwa) < 90 ? 'tack' : 'gybe';
            markerDetail += ` (${markerType})`;
          }
        }
      }

      // Add maneuver marker (skip MODE changes which are invisible)
      if (seg.type !== 'MODE') {
        maneuverMarkers.push({
          index: points.length, // will be the next point added
          type: markerType,
          detail: markerDetail,
        });
      }

      // Record point at segment transition
      const weather = getWeatherAt(lat, lon, currentMs);
      if (weather) {
        const twa = twaLock !== null ? twaLock : computeTWA(hdg, weather.twd);
        prevTwa = twa;
        points.push({
          lat, lon,
          timestamp: currentMs,
          bsp: computeBsp(polar, twa, weather.tws, condition, effects, maneuver, transition, currentMs),
          tws: weather.tws,
          twd: weather.twd,
        });
      }

      segIdx++;
      segmentTriggered = true;
    }

    // If we processed segments, recalculate remaining dt for this step
    if (segmentTriggered) {
      const newElapsed = (currentMs - startMs) / 1000;
      dt = getStepSize(newElapsed);
    }

    // Get weather at current position/time
    const weather = getWeatherAt(lat, lon, currentMs);
    if (!weather) break; // Beyond GRIB coverage

    // If in TWA lock mode, update heading from wind direction
    const twa = twaLock !== null ? twaLock : computeTWA(hdg, weather.twd);
    if (twaLock !== null) {
      // Heading = TWD + TWA (reverse of computeTWA)
      hdg = ((weather.twd + twaLock) % 360 + 360) % 360;
    }

    // Compute BSP
    const bsp = computeBsp(polar, twa, weather.tws, condition, effects, maneuver, transition, currentMs);

    // Advance position
    const newPos = advancePosition({ lat, lon }, hdg, bsp, dt);
    lat = newPos.lat;
    lon = newPos.lon;

    // Advance time
    currentMs += dt * 1000;

    // Wear progression
    const wearDelta = computeWearDelta(weather, hdg, dt, effects);
    condition = applyWear(condition, wearDelta);

    // Clear expired maneuver/transition
    if (maneuver && currentMs >= maneuver.endMs) maneuver = null;
    if (transition && currentMs >= transition.endMs) transition = null;

    // Detect maneuver from TWA change (in TWA lock mode, wind shift can cause tack/gybe)
    if (prevTwa !== null) {
      const newTwa = twaLock !== null ? twaLock : computeTWA(hdg, weather.twd);
      const man = detectManeuver(prevTwa, newTwa, input.boatClass, currentMs, effects);
      if (man) maneuver = man;
      prevTwa = newTwa;
    } else {
      prevTwa = twa;
    }

    // New weather at new position for the recorded point
    const weatherAtNew = getWeatherAt(lat, lon, currentMs);
    if (!weatherAtNew) break;
    const twaAtNew = twaLock !== null ? twaLock : computeTWA(hdg, weatherAtNew.twd);
    const bspAtNew = computeBsp(polar, twaAtNew, weatherAtNew.tws, condition, effects, maneuver, transition, currentMs);

    points.push({
      lat, lon,
      timestamp: currentMs,
      bsp: bspAtNew,
      tws: weatherAtNew.tws,
      twd: weatherAtNew.twd,
    });

    // Check time markers
    const elapsedHours = (currentMs - startMs) / (3600 * 1000);
    while (
      nextTimeMarkerIdx < TIME_MARKER_HOURS.length &&
      elapsedHours >= TIME_MARKER_HOURS[nextTimeMarkerIdx]!
    ) {
      timeMarkers.push({
        index: points.length - 1,
        label: hourLabel(TIME_MARKER_HOURS[nextTimeMarkerIdx]!),
      });
      nextTimeMarkerIdx++;
    }
  }

  return { points, timeMarkers, maneuverMarkers, bspMax };
}

// ── Worker message handler ──

self.onmessage = (e: MessageEvent<WorkerInMessage>) => {
  const msg = e.data;

  if (msg.type === 'compute') {
    try {
      const result = simulate(msg.input);
      const out: WorkerOutMessage = { type: 'result', result };
      self.postMessage(out);
    } catch (err) {
      const out: WorkerOutMessage = { type: 'error', message: String(err) };
      self.postMessage(out);
    }
  }
};
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/workers/projection.worker.ts
git commit -m "feat(projection): web worker with adaptive-step simulation loop"
```

---

### Task 6: useProjectionLine hook

**Files:**
- Create: `apps/web/src/hooks/useProjectionLine.ts`

- [ ] **Step 1: Create the hook**

```typescript
// apps/web/src/hooks/useProjectionLine.ts
import { useEffect, useRef, useCallback } from 'react';
import type maplibregl from 'maplibre-gl';
import { useGameStore } from '@/lib/store';
import type {
  ProjectionInput,
  ProjectionSegment,
  WorkerInMessage,
  WorkerOutMessage,
  ProjectionResult,
} from '@/lib/projection/types';

const DEBOUNCE_HDG_MS = 100;
const FIELDS_PER_POINT = 5; // tws, twd, swh, swellDir, swellPeriod

/**
 * Packs the WeatherGrid into a flat Float32Array for transfer to the Worker.
 * Layout: for each timestamp, rows × cols × FIELDS_PER_POINT floats.
 * Current implementation: single-timestamp grid (mockGrid). When multi-timestamp
 * GRIB is available, this packs all time layers.
 */
function packWindData(grid: NonNullable<ReturnType<typeof useGameStore.getState>['weather']['gridData']>): Float32Array {
  const numPoints = grid.points.length;
  const numTimestamps = grid.timestamps.length;
  const data = new Float32Array(numTimestamps * numPoints * FIELDS_PER_POINT);

  // For now, all timestamps share the same spatial data (mockGrid returns one snapshot)
  for (let t = 0; t < numTimestamps; t++) {
    const offset = t * numPoints * FIELDS_PER_POINT;
    for (let i = 0; i < numPoints; i++) {
      const p = grid.points[i]!;
      const base = offset + i * FIELDS_PER_POINT;
      data[base] = p.tws;
      data[base + 1] = p.twd;
      data[base + 2] = p.swellHeight;
      data[base + 3] = p.swellDir;
      data[base + 4] = p.swellPeriod;
    }
  }

  return data;
}

/**
 * Convert store's orderQueue to ProjectionSegments.
 */
function orderQueueToSegments(queue: ReturnType<typeof useGameStore.getState>['prog']['orderQueue']): ProjectionSegment[] {
  return queue
    .filter((o) => o.type === 'CAP' || o.type === 'TWA' || o.type === 'SAIL' || o.type === 'MODE')
    .map((o) => {
      let value: number | string | boolean;
      if (o.type === 'CAP') value = Number(o.value['heading'] ?? o.value['cap'] ?? 0);
      else if (o.type === 'TWA') value = Number(o.value['twa'] ?? 0);
      else if (o.type === 'SAIL') value = String(o.value['sail'] ?? 'GEN');
      else value = Boolean(o.value['auto'] ?? false);

      let triggerMs = Date.now();
      if (o.trigger.type === 'AT_TIME') {
        triggerMs = (o.trigger as { type: 'AT_TIME'; time: number }).time;
      }

      return { triggerMs, type: o.type, value };
    });
}

export function useProjectionLine(map: maplibregl.Map | null): void {
  const workerRef = useRef<Worker | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastResultRef = useRef<ProjectionResult | null>(null);

  // Initialize Worker
  useEffect(() => {
    const worker = new Worker(
      new URL('../workers/projection.worker.ts', import.meta.url),
      { type: 'module' },
    );

    worker.onmessage = (e: MessageEvent<WorkerOutMessage>) => {
      if (e.data.type === 'result') {
        lastResultRef.current = e.data.result;
        updateMapSources(e.data.result);
      }
    };

    workerRef.current = worker;
    return () => { worker.terminate(); workerRef.current = null; };
  }, []);

  const updateMapSources = useCallback((result: ProjectionResult) => {
    if (!map || !map.isStyleLoaded()) return;

    // Line source: GeoJSON LineString with bsp property per segment
    const lineFeatures: GeoJSON.Feature[] = [];
    for (let i = 0; i < result.points.length - 1; i++) {
      const p0 = result.points[i]!;
      const p1 = result.points[i + 1]!;
      lineFeatures.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [[p0.lon, p0.lat], [p1.lon, p1.lat]],
        },
        properties: {
          bsp: p0.bsp,
          bspRatio: result.bspMax > 0 ? p0.bsp / result.bspMax : 0,
        },
      });
    }

    const lineSrc = map.getSource('projection-line') as maplibregl.GeoJSONSource | undefined;
    lineSrc?.setData({ type: 'FeatureCollection', features: lineFeatures });

    // Time markers source
    const timeFeatures: GeoJSON.Feature[] = result.timeMarkers.map((m) => {
      const p = result.points[m.index]!;
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
        properties: { label: m.label },
      };
    });

    const timeSrc = map.getSource('projection-markers-time') as maplibregl.GeoJSONSource | undefined;
    timeSrc?.setData({ type: 'FeatureCollection', features: timeFeatures });

    // Maneuver markers source
    const manFeatures: GeoJSON.Feature[] = result.maneuverMarkers.map((m) => {
      const p = result.points[m.index];
      if (!p) return null;
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
        properties: { type: m.type, detail: m.detail },
      };
    }).filter(Boolean) as GeoJSON.Feature[];

    const manSrc = map.getSource('projection-markers-maneuver') as maplibregl.GeoJSONSource | undefined;
    manSrc?.setData({ type: 'FeatureCollection', features: manFeatures });
  }, [map]);

  // Trigger recalculation
  const requestCompute = useCallback((immediate = false) => {
    if (!workerRef.current) return;

    const doCompute = () => {
      const state = useGameStore.getState();
      const { hud, sail, weather, prog } = state;
      const grid = weather.gridData;
      if (!grid || !hud.lat && !hud.lon) return;

      // Pack polar data — loaded from public/data/polars/ at runtime
      // For now, we get it from a preloaded source. This will be passed once.
      // TODO: load polar JSON once and cache in the hook
      const polarData = (window as any).__nemo_polar as { twa: number[]; tws: number[]; speeds: number[][] } | undefined;
      if (!polarData) return;

      const windData = packWindData(grid);

      const input: ProjectionInput = {
        lat: hud.lat,
        lon: hud.lon,
        hdg: hud.hdg,
        nowMs: Date.now(),
        boatClass: hud.boatClass,
        activeSail: sail.currentSail,
        sailAuto: sail.sailAuto,
        twaLock: null, // TODO: read from segment state when available
        segments: orderQueueToSegments(prog.orderQueue),
        polar: polarData,
        effects: {
          speedByTwa: [1, 1, 1, 1, 1],
          speedByTws: [1, 1, 1],
          wearMul: { hull: 1, rig: 1, sail: 1, elec: 1 },
          maneuverMul: {
            tack: { dur: 1, speed: 1 },
            gybe: { dur: 1, speed: 1 },
            sailChange: { dur: 1, speed: 1 },
          },
        },
        condition: {
          hull: hud.wearDetail.hull,
          rig: hud.wearDetail.rig,
          sails: hud.wearDetail.sails,
          electronics: hud.wearDetail.electronics,
        },
        activeManeuver: sail.maneuverEndMs > Date.now()
          ? { endMs: sail.maneuverEndMs, speedFactor: 0.7 }
          : null,
        activeTransition: sail.transitionEndMs > Date.now()
          ? { endMs: sail.transitionEndMs, speedFactor: 0.7 }
          : null,
        prevTwa: hud.twa || null,
        windGrid: {
          bounds: grid.bounds,
          resolution: grid.resolution,
          cols: grid.cols,
          rows: grid.rows,
          timestamps: grid.timestamps,
        },
        windData,
      };

      const msg: WorkerInMessage = { type: 'compute', input };
      workerRef.current!.postMessage(msg, [windData.buffer]);
    };

    if (immediate) {
      doCompute();
    } else {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(doCompute, DEBOUNCE_HDG_MS);
    }
  }, []);

  // Subscribe to store changes that trigger recalculation
  useEffect(() => {
    let prevHdg = useGameStore.getState().hud.hdg;
    let prevSail = useGameStore.getState().sail.currentSail;
    let prevSailAuto = useGameStore.getState().sail.sailAuto;
    let prevQueue = useGameStore.getState().prog.orderQueue;
    let prevTick = useGameStore.getState().lastTickUnix;
    let prevGrid = useGameStore.getState().weather.gridData;

    const unsub = useGameStore.subscribe((s) => {
      const hdgChanged = s.hud.hdg !== prevHdg;
      const sailChanged = s.sail.currentSail !== prevSail;
      const autoChanged = s.sail.sailAuto !== prevSailAuto;
      const queueChanged = s.prog.orderQueue !== prevQueue;
      const tickChanged = s.lastTickUnix !== prevTick;
      const gridChanged = s.weather.gridData !== prevGrid;

      prevHdg = s.hud.hdg;
      prevSail = s.sail.currentSail;
      prevSailAuto = s.sail.sailAuto;
      prevQueue = s.prog.orderQueue;
      prevTick = s.lastTickUnix;
      prevGrid = s.weather.gridData;

      if (hdgChanged) {
        // Debounced for heading drag
        requestCompute(false);
      } else if (sailChanged || autoChanged || queueChanged || tickChanged || gridChanged) {
        // Immediate for discrete changes
        requestCompute(true);
      }
    });

    // Initial computation
    requestCompute(true);

    return unsub;
  }, [requestCompute]);
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/hooks/useProjectionLine.ts
git commit -m "feat(projection): useProjectionLine hook with store subscriptions"
```

---

### Task 7: MapCanvas integration — sources and layers

**Files:**
- Modify: `apps/web/src/components/play/MapCanvas.tsx`

- [ ] **Step 1: Import useProjectionLine**

Add import at the top of MapCanvas.tsx, after existing imports:

```typescript
import { useProjectionLine } from '@/hooks/useProjectionLine';
```

- [ ] **Step 2: Call the hook in the component**

Add after `const mapRef = useRef<maplibregl.Map | null>(null);`:

```typescript
useProjectionLine(mapRef.current);
```

**Note:** Since `mapRef.current` is null on first render, the hook handles null gracefully. The map is available after the first `useEffect` runs.

- [ ] **Step 3: Add projection sources and layers in map.once('load')**

Inside the `map.once('load', () => { ... })` callback, **after** the trail source/layer and **before** the boat source, add:

```typescript
      // ── Projection line ──
      map.addSource('projection-line', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'projection-line-layer',
        type: 'line',
        source: 'projection-line',
        paint: {
          'line-color': [
            'interpolate', ['linear'], ['get', 'bspRatio'],
            0.0, '#c0392b',
            0.2, '#c0392b',
            0.35, '#e67e22',
            0.5, '#f1c40f',
            0.75, '#27ae60',
            1.0, '#27ae60',
          ],
          'line-width': 2.5,
          'line-opacity': 0.8,
          'line-dasharray': [4, 3],
        },
      });

      // ── Projection time markers ──
      map.addSource('projection-markers-time', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'projection-markers-time-circle',
        type: 'circle',
        source: 'projection-markers-time',
        paint: {
          'circle-radius': 4,
          'circle-color': '#f5f0e8',
          'circle-stroke-color': '#1a2744',
          'circle-stroke-width': 1.5,
        },
      });
      map.addLayer({
        id: 'projection-markers-time-label',
        type: 'symbol',
        source: 'projection-markers-time',
        layout: {
          'text-field': ['get', 'label'],
          'text-size': 11,
          'text-offset': [0, -1.2],
          'text-allow-overlap': true,
        },
        paint: {
          'text-color': '#f5f0e8',
          'text-halo-color': 'rgba(10, 22, 40, 0.8)',
          'text-halo-width': 1,
        },
      });

      // ── Projection maneuver markers ──
      map.addSource('projection-markers-maneuver', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'projection-markers-maneuver-icon',
        type: 'circle',
        source: 'projection-markers-maneuver',
        paint: {
          'circle-radius': 5,
          'circle-color': '#c9a84c',
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1.5,
        },
      });
```

**Note on losange shape:** MapLibre's `circle` layer renders circles. For a true diamond/losange shape, we'd need a custom icon. Start with circles (gold color distinguishes them from time markers), and iterate to diamond shape later if needed via `icon-image` with an SVG.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/play/MapCanvas.tsx
git commit -m "feat(projection): add MapLibre sources and layers for projection line"
```

---

### Task 8: Maneuver marker tooltip (MapLibre Popup)

**Files:**
- Modify: `apps/web/src/components/play/MapCanvas.tsx`

- [ ] **Step 1: Add popup interaction for maneuver markers**

Inside the `map.once('load', () => { ... })` callback, after the maneuver marker layer, add:

```typescript
      // ── Maneuver marker tooltip ──
      const maneuverPopup = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: true,
        offset: 10,
        className: 'projection-maneuver-popup',
      });

      // Desktop: hover
      map.on('mouseenter', 'projection-markers-maneuver-icon', (e) => {
        map.getCanvas().style.cursor = 'pointer';
        const feature = e.features?.[0];
        if (!feature || feature.geometry.type !== 'Point') return;
        const coords = feature.geometry.coordinates as [number, number];
        const detail = feature.properties?.detail ?? '';
        const type = feature.properties?.type ?? '';
        maneuverPopup
          .setLngLat(coords)
          .setHTML(`<div style="font-size:12px;color:#f5f0e8;"><strong style="color:#c9a84c;">${type.toUpperCase()}</strong><br/>${detail}</div>`)
          .addTo(map);
      });

      map.on('mouseleave', 'projection-markers-maneuver-icon', () => {
        map.getCanvas().style.cursor = '';
        maneuverPopup.remove();
      });

      // Mobile: click toggle
      map.on('click', 'projection-markers-maneuver-icon', (e) => {
        const feature = e.features?.[0];
        if (!feature || feature.geometry.type !== 'Point') return;
        const coords = feature.geometry.coordinates as [number, number];
        const detail = feature.properties?.detail ?? '';
        const type = feature.properties?.type ?? '';

        if (maneuverPopup.isOpen()) {
          maneuverPopup.remove();
        } else {
          maneuverPopup
            .setLngLat(coords)
            .setHTML(`<div style="font-size:12px;color:#f5f0e8;"><strong style="color:#c9a84c;">${type.toUpperCase()}</strong><br/>${detail}</div>`)
            .addTo(map);
        }
      });
```

- [ ] **Step 2: Add popup styling**

Add to `MapCanvas.module.css` or as a global style (MapLibre popups are injected outside the component):

```css
.projection-maneuver-popup .maplibregl-popup-content {
  background: rgba(26, 39, 68, 0.95);
  border: 1px solid #c9a84c;
  border-radius: 6px;
  padding: 8px 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
}
.projection-maneuver-popup .maplibregl-popup-tip {
  border-top-color: rgba(26, 39, 68, 0.95);
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/play/MapCanvas.tsx apps/web/src/components/play/MapCanvas.module.css
git commit -m "feat(projection): maneuver marker tooltips (hover desktop, click mobile)"
```

---

### Task 9: Polar data loading

**Files:**
- Modify: `apps/web/src/hooks/useProjectionLine.ts`
- Modify: `apps/web/src/components/play/MapCanvas.tsx` (or PlayClient.tsx)

The Worker needs the polar table. Currently `loadPolar()` uses Node `readFile` and can't run in the browser. We need to fetch the polar JSON from `public/data/polars/`.

- [ ] **Step 1: Add polar fetch to the hook**

Replace the `window.__nemo_polar` placeholder in `useProjectionLine.ts` with a proper fetch:

```typescript
// Add to useProjectionLine.ts, inside the hook:
const polarRef = useRef<{ twa: number[]; tws: number[]; speeds: number[][] } | null>(null);

useEffect(() => {
  const boatClass = useGameStore.getState().hud.boatClass;
  if (!boatClass) return;

  const classToFile: Record<string, string> = {
    FIGARO: 'figaro.json',
    CLASS40: 'class40.json',
    OCEAN_FIFTY: 'ocean-fifty.json',
    IMOCA60: 'imoca60.json',
    ULTIM: 'ultim.json',
  };
  const file = classToFile[boatClass];
  if (!file) return;

  fetch(`/data/polars/${file}`)
    .then((r) => r.json())
    .then((polar) => {
      polarRef.current = polar;
      requestCompute(true);
    })
    .catch(() => {});
}, []);
```

Then in `doCompute`, replace the `window.__nemo_polar` line with:

```typescript
const polarData = polarRef.current;
if (!polarData) return;
```

- [ ] **Step 2: Copy polar JSON files to public**

Check if `apps/web/public/data/polars/` already exists with the JSON files. If not:

```bash
cp packages/polar-lib/polars/*.json apps/web/public/data/polars/
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/hooks/useProjectionLine.ts apps/web/public/data/polars/
git commit -m "feat(projection): fetch polar data from public for browser-side simulation"
```

---

### Task 10: Visual testing and integration verification

- [ ] **Step 1: Start the dev server**

```bash
cd apps/web && pnpm dev
```

- [ ] **Step 2: Verify in browser**

Open the game at `http://localhost:3000/play/<raceId>`. Check:

1. A dashed projection line extends from the boat position
2. The line has color gradient (red→green based on speed)
3. Time markers (1h, 2h, 3h, 6h, 12h, 24h, 48h...) appear as ivory circles with labels
4. If any orders are in the programming queue, maneuver markers appear as gold circles
5. Hovering a maneuver marker shows the tooltip with order details
6. Changing heading (via compass/slider) updates the line with ~100ms debounce
7. No console errors or Worker failures

- [ ] **Step 3: Fix any issues found**

Address TypeScript errors, import path issues, or runtime errors discovered during testing.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat(projection): projection line integration complete"
```
