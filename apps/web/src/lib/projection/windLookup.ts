// apps/web/src/lib/projection/windLookup.ts

import type { WindGridConfig } from '@nemo/game-engine-core/browser';
export type { WindGridConfig };

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

    // Grid is packed south-to-north, west-to-east (matches server encoder).
    const fx = (lon - bounds.west) / resolution;
    const fy = (lat - bounds.south) / resolution;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const dx = fx - ix;
    const dy = fy - iy;

    if (ix < 0 || ix >= cols - 1 || iy < 0 || iy >= rows - 1) {
      return { tws: 0, twd: 0, swh: 0, swellDir: 0, swellPeriod: 0 };
    }
    const x0 = ix, x1 = ix + 1, y0 = iy, y1 = iy + 1;

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

    // Single snapshot: use it for the whole projection horizon.
    if (timestamps.length === 1) {
      return sampleLayer(0, lat, lon);
    }

    // Beyond the last timestamp: extrapolate with the last layer (keeps
    // projection alive past GRIB coverage, at the cost of accuracy).
    const lastTs = timestamps[timestamps.length - 1]!;
    if (timeMs >= lastTs) {
      return sampleLayer(timestamps.length - 1, lat, lon);
    }

    // Before the first timestamp: use the first layer.
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

/**
 * Compose a "current + previous GRIB" lookup with fallback semantics.
 *
 * Intent: during a GFS refresh, the current grid only has the forecast hours
 * that the progressive cumulative fetch has pulled so far (TTFW, then phase 1,
 * then phase 2). Sampling at a time *beyond* the current coverage would fall
 * back to the last-layer extrapolation inside `createWindLookup`, which is
 * stale. If the previous run's grid is available and covers that time, using
 * it is strictly better than extrapolation.
 *
 * Returns a function with the same signature as `createWindLookup`'s return.
 * Policy per (lat, lon, timeMs):
 *   1. If timeMs is within the *current* grid's temporal bounds, use current.
 *   2. Else if a previous lookup exists and its bounds cover timeMs, use prev.
 *   3. Else fall back to current (so extrapolation still happens — never null).
 */
export function createFallbackWindLookup(
  currentConfig: WindGridConfig,
  currentData: Float32Array,
  prevConfig?: WindGridConfig | null,
  prevData?: Float32Array | null,
) {
  const currentLookup = createWindLookup(currentConfig, currentData);
  const prevLookup =
    prevConfig && prevData ? createWindLookup(prevConfig, prevData) : null;
  const currentFirstTs = currentConfig.timestamps[0] ?? 0;
  const currentLastTs =
    currentConfig.timestamps[currentConfig.timestamps.length - 1] ?? 0;
  const prevFirstTs = prevConfig?.timestamps[0] ?? 0;
  const prevLastTs =
    prevConfig?.timestamps[prevConfig.timestamps.length - 1] ?? 0;

  return function getWeatherAtWithFallback(
    lat: number,
    lon: number,
    timeMs: number,
  ): WeatherAtPoint | null {
    const inCurrent =
      currentConfig.timestamps.length > 0 &&
      timeMs >= currentFirstTs &&
      timeMs <= currentLastTs;
    if (inCurrent) return currentLookup(lat, lon, timeMs);
    if (prevLookup && timeMs >= prevFirstTs && timeMs <= prevLastTs) {
      return prevLookup(lat, lon, timeMs);
    }
    return currentLookup(lat, lon, timeMs);
  };
}
