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

const RAD_TO_DEG = 180 / Math.PI;
// Per-point layout: [u_kn, v_kn, swh, swellSin, swellCos, swellPeriod]
// Storing wind as (u, v) in knots and swell direction as (sin, cos) lets us
// interpolate every field linearly — no trig in the bilinear/trilinear loop.
// We pay one sqrt + two atan2 per *output* sample instead of per corner.
const FIELDS_PER_POINT = 6;

const ZERO: WeatherAtPoint = { tws: 0, twd: 0, swh: 0, swellDir: 0, swellPeriod: 0 };

/** Convert a raw 6-tuple (u, v, swh, swSin, swCos, swPer) to user-facing fields. */
function rawToWeather(
  u: number,
  v: number,
  swh: number,
  swSin: number,
  swCos: number,
  swPer: number,
): WeatherAtPoint {
  const tws = Math.sqrt(u * u + v * v);
  // u/v are wind components blowing TO; meteorological TWD is the direction
  // wind comes FROM, so flip both sign before atan2 (matches old encoder).
  const twd = ((Math.atan2(-u, -v) * RAD_TO_DEG) + 360) % 360;
  const swellDir = ((Math.atan2(swSin, swCos) * RAD_TO_DEG) + 360) % 360;
  return {
    tws,
    twd,
    swh: swh > 0 ? swh : 0,
    swellDir,
    swellPeriod: swPer,
  };
}

/**
 * Create a lookup function from a flat Float32Array of weather data.
 * Data layout per time layer: rows × cols points, each with FIELDS_PER_POINT floats.
 * Points ordered: lat ascending (south→north), lon ascending (west→east).
 */
export function createWindLookup(
  config: WindGridConfig,
  data: Float32Array,
) {
  const { bounds, resolution, cols, rows, timestamps } = config;
  const pointsPerLayer = rows * cols;
  const floatsPerLayer = pointsPerLayer * FIELDS_PER_POINT;

  /**
   * Bilinear interpolation of the 6 raw fields at (lat, lon) on the given layer.
   * Writes results into `out` to avoid allocation on the hot path.
   * Returns true on success, false if (lat, lon) is outside the grid.
   */
  function sampleRaw(layerIdx: number, lat: number, lon: number, out: Float64Array): boolean {
    const offset = layerIdx * floatsPerLayer;

    const fx = (lon - bounds.west) / resolution;
    const fy = (lat - bounds.south) / resolution;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const dx = fx - ix;
    const dy = fy - iy;

    if (ix < 0 || ix >= cols - 1 || iy < 0 || iy >= rows - 1) {
      return false;
    }

    const i00 = offset + (iy * cols + ix) * FIELDS_PER_POINT;
    const i10 = offset + (iy * cols + (ix + 1)) * FIELDS_PER_POINT;
    const i01 = offset + ((iy + 1) * cols + ix) * FIELDS_PER_POINT;
    const i11 = offset + ((iy + 1) * cols + (ix + 1)) * FIELDS_PER_POINT;

    const w00 = (1 - dx) * (1 - dy);
    const w10 = dx * (1 - dy);
    const w01 = (1 - dx) * dy;
    const w11 = dx * dy;

    // Each field interpolated independently — pure FMAs, no trig.
    for (let f = 0; f < FIELDS_PER_POINT; f++) {
      out[f] = data[i00 + f]! * w00
             + data[i10 + f]! * w10
             + data[i01 + f]! * w01
             + data[i11 + f]! * w11;
    }
    return true;
  }

  // Reusable scratch buffers — keeps the hot path allocation-free.
  const scratch0 = new Float64Array(FIELDS_PER_POINT);
  const scratch1 = new Float64Array(FIELDS_PER_POINT);

  /**
   * Get weather at (lat, lon, timeMs) with temporal interpolation between GRIB layers.
   * Returns null only if no timestamps are configured; out-of-bounds returns ZERO.
   */
  return function getWeatherAt(lat: number, lon: number, timeMs: number): WeatherAtPoint | null {
    const nLayers = timestamps.length;
    if (nLayers === 0) return null;

    // Single snapshot, before-first, or after-last → sample one layer.
    let singleLayer = -1;
    if (nLayers === 1) {
      singleLayer = 0;
    } else if (timeMs >= timestamps[nLayers - 1]!) {
      singleLayer = nLayers - 1;
    } else if (timeMs <= timestamps[0]!) {
      singleLayer = 0;
    }

    if (singleLayer >= 0) {
      if (!sampleRaw(singleLayer, lat, lon, scratch0)) return ZERO;
      return rawToWeather(scratch0[0]!, scratch0[1]!, scratch0[2]!, scratch0[3]!, scratch0[4]!, scratch0[5]!);
    }

    // Locate bracketing layers. Timestamps are typically sparse but ordered;
    // a linear scan is still cheap (≤ ~40 layers in practice). We could binary
    // search but the win is negligible vs. the bilinear work above.
    let t0Idx = 0;
    for (let i = 0; i < nLayers - 1; i++) {
      if (timeMs >= timestamps[i]! && timeMs < timestamps[i + 1]!) {
        t0Idx = i;
        break;
      }
    }
    const t1Idx = t0Idx + 1;
    const t0 = timestamps[t0Idx]!;
    const t1 = timestamps[t1Idx]!;
    const tFrac = (timeMs - t0) / (t1 - t0);

    // Snap to layer endpoints when extremely close to avoid an extra sample.
    if (tFrac <= 0.01) {
      if (!sampleRaw(t0Idx, lat, lon, scratch0)) return ZERO;
      return rawToWeather(scratch0[0]!, scratch0[1]!, scratch0[2]!, scratch0[3]!, scratch0[4]!, scratch0[5]!);
    }
    if (tFrac >= 0.99) {
      if (!sampleRaw(t1Idx, lat, lon, scratch0)) return ZERO;
      return rawToWeather(scratch0[0]!, scratch0[1]!, scratch0[2]!, scratch0[3]!, scratch0[4]!, scratch0[5]!);
    }

    // Trilinear in u/v + sin/cos space — interpolate raw fields, convert once.
    if (!sampleRaw(t0Idx, lat, lon, scratch0)) return ZERO;
    if (!sampleRaw(t1Idx, lat, lon, scratch1)) return ZERO;

    const oneMinusT = 1 - tFrac;
    const u   = scratch0[0]! * oneMinusT + scratch1[0]! * tFrac;
    const v   = scratch0[1]! * oneMinusT + scratch1[1]! * tFrac;
    const swh = scratch0[2]! * oneMinusT + scratch1[2]! * tFrac;
    const sSin = scratch0[3]! * oneMinusT + scratch1[3]! * tFrac;
    const sCos = scratch0[4]! * oneMinusT + scratch1[4]! * tFrac;
    const sPer = scratch0[5]! * oneMinusT + scratch1[5]! * tFrac;

    return rawToWeather(u, v, swh, sSin, sCos, sPer);
  };
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
