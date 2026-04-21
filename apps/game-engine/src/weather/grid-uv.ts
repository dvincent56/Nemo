/**
 * U/V wind components (meteorological convention):
 *   u = east-west component (positive = from west = blowing east)
 *   v = north-south component (positive = from south = blowing north)
 * TWD = direction wind is coming FROM (compass degrees, 0° = N, 90° = E, ...)
 */

export interface UvPoint {
  u: number;
  v: number;
}

export interface TwsTwdPoint {
  tws: number;
  twd: number;
}

/** m/s → knots (used to convert GFS U/V magnitudes to the unit expected by
 *  polars, wear thresholds, and loadout activation bands). */
export const MS_TO_KNOTS = 1.94384;

/** Convert U/V components (m/s) to TWS (**knots**) and TWD (degrees compass).
 *  The whole engine treats TWS as knots downstream (polar lookup, wear, bands),
 *  so we convert once at the U/V boundary rather than spraying factors later. */
export function uvToTwsTwd(u: number, v: number): TwsTwdPoint {
  const tws = Math.sqrt(u * u + v * v) * MS_TO_KNOTS;
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
