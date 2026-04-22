// packages/routing/src/weatherSampler.ts
// Bilinear lookup in the packed Float32Array. Returns null if the time is
// outside the grid timestamps range. Fields are 5 per cell: tws, twd, swh,
// swellDir, swellPeriod (matches apps/web/src/lib/projection/windLookup.ts).
//
// Now also returns swh + swellDir so the router can apply swellSpeedFactor
// the same way runTick does — without that, router speed is ~10-20 %
// higher than sim speed in swelly conditions (head sea penalty ignored).
import type { WindGridConfig } from '@nemo/game-engine-core/browser';

export interface WindSample {
  tws: number;
  twd: number;
  swh: number;      // significant wave height, m
  swellDir: number; // degrees, 0 = north, coming FROM
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

  let t0 = 0;
  for (let i = 1; i < ts.length; i++) {
    if (ts[i]! >= tMs) { t0 = i - 1; break; }
    t0 = i;
  }
  const t1 = Math.min(t0 + 1, ts.length - 1);
  const tFrac = t1 === t0 ? 0 : (tMs - ts[t0]!) / (ts[t1]! - ts[t0]!);

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
  // at() returns [tws, twd, swh, swellDir] for one cell
  const at = (tIdx: number, iy: number, ix: number): [number, number, number, number] => {
    const base = (tIdx * pointsPerLayer + iy * cols + ix) * FIELDS;
    return [data[base]!, data[base + 1]!, data[base + 2]!, data[base + 3]!];
  };

  const toRad = Math.PI / 180;

  const interp = (tIdx: number): [number, number, number, number] => {
    const [t00, d00, h00, s00] = at(tIdx, iy0, ix0);
    const [t10, d10, h10, s10] = at(tIdx, iy0, ix0 + 1);
    const [t01, d01, h01, s01] = at(tIdx, iy0 + 1, ix0);
    const [t11, d11, h11, s11] = at(tIdx, iy0 + 1, ix0 + 1);
    const tws = (t00 * (1 - dx) + t10 * dx) * (1 - dy) + (t01 * (1 - dx) + t11 * dx) * dy;
    const swh = (h00 * (1 - dx) + h10 * dx) * (1 - dy) + (h01 * (1 - dx) + h11 * dx) * dy;
    // Angle interpolation via sin/cos for both twd and swellDir
    const interpAngle = (a: number, b: number, c: number, d: number): number => {
      const sx = (Math.sin(a * toRad) * (1 - dx) + Math.sin(b * toRad) * dx) * (1 - dy) +
                 (Math.sin(c * toRad) * (1 - dx) + Math.sin(d * toRad) * dx) * dy;
      const cx = (Math.cos(a * toRad) * (1 - dx) + Math.cos(b * toRad) * dx) * (1 - dy) +
                 (Math.cos(c * toRad) * (1 - dx) + Math.cos(d * toRad) * dx) * dy;
      return ((Math.atan2(sx, cx) / toRad) + 360) % 360;
    };
    const twd = interpAngle(d00, d10, d01, d11);
    const swellDir = interpAngle(s00, s10, s01, s11);
    return [tws, twd, swh, swellDir];
  };

  const [tws0, twd0, swh0, sd0] = interp(t0);
  const [tws1, twd1, swh1, sd1] = interp(t1);
  const tws = tws0 * (1 - tFrac) + tws1 * tFrac;
  const swh = swh0 * (1 - tFrac) + swh1 * tFrac;
  const sxT = Math.sin(twd0 * toRad) * (1 - tFrac) + Math.sin(twd1 * toRad) * tFrac;
  const cxT = Math.cos(twd0 * toRad) * (1 - tFrac) + Math.cos(twd1 * toRad) * tFrac;
  const twd = ((Math.atan2(sxT, cxT) / toRad) + 360) % 360;
  const sxS = Math.sin(sd0 * toRad) * (1 - tFrac) + Math.sin(sd1 * toRad) * tFrac;
  const cxS = Math.cos(sd0 * toRad) * (1 - tFrac) + Math.cos(sd1 * toRad) * tFrac;
  const swellDir = ((Math.atan2(sxS, cxS) / toRad) + 360) % 360;

  return { tws, twd, swh, swellDir };
}
