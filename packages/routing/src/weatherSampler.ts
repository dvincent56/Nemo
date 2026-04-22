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
  const toRad = Math.PI / 180;
  const sx = Math.sin(twd0 * toRad) * (1 - tFrac) + Math.sin(twd1 * toRad) * tFrac;
  const cx = Math.cos(twd0 * toRad) * (1 - tFrac) + Math.cos(twd1 * toRad) * tFrac;
  const twd = ((Math.atan2(sx, cx) / toRad) + 360) % 360;

  return { tws, twd };
}
