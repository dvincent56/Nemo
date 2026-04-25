// packages/routing/src/weatherSampler.ts
// Weather lookup. Math is intentionally byte-identical to
// apps/web/src/lib/projection/windLookup.ts so the routing engine and
// the simulator engine see the same TWS/TWD at the same (lat, lon, t).
// Per-cell layout matches packWindData (6 floats):
//   [u_kn, v_kn, swh, swellSin, swellCos, swellPeriod]
// Storing wind as (u, v) and swell direction as (sin, cos) lets every field
// interpolate linearly — no per-corner trig in the sample path. We pay
// one atan2 + one sqrt per output sample, never per corner.
import type { WindGridConfig } from '@nemo/game-engine-core/browser';

export interface WindSample {
  tws: number;
  twd: number;
  swh: number;
  swellDir: number;
}

const FIELDS = 6;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

function sampleLayer(
  grid: WindGridConfig,
  data: Float32Array,
  layerIdx: number,
  lat: number,
  lon: number,
): WindSample {
  const { bounds, resolution, cols, rows } = grid;
  const pointsPerLayer = rows * cols;
  const floatsPerLayer = pointsPerLayer * FIELDS;
  const offset = layerIdx * floatsPerLayer;

  const fx = (lon - bounds.west) / resolution;
  const fy = (lat - bounds.south) / resolution;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const dx = fx - ix;
  const dy = fy - iy;

  if (ix < 0 || ix >= cols - 1 || iy < 0 || iy >= rows - 1) {
    return { tws: 0, twd: 0, swh: 0, swellDir: 0 };
  }

  const idx = (r: number, c: number) => offset + (r * cols + c) * FIELDS;
  const i00 = idx(iy, ix);
  const i10 = idx(iy, ix + 1);
  const i01 = idx(iy + 1, ix);
  const i11 = idx(iy + 1, ix + 1);

  const w00 = (1 - dx) * (1 - dy);
  const w10 = dx * (1 - dy);
  const w01 = (1 - dx) * dy;
  const w11 = dx * dy;

  // Bilinear u/v in knots, then derive TWS/TWD once. TWD is the direction
  // wind comes FROM, so flip both sign before atan2.
  const u = data[i00]! * w00 + data[i10]! * w10 + data[i01]! * w01 + data[i11]! * w11;
  const v = data[i00 + 1]! * w00 + data[i10 + 1]! * w10 + data[i01 + 1]! * w01 + data[i11 + 1]! * w11;
  const tws = Math.sqrt(u * u + v * v);
  const twd = ((Math.atan2(-u, -v) * RAD_TO_DEG) + 360) % 360;

  const swh = data[i00 + 2]! * w00 + data[i10 + 2]! * w10 + data[i01 + 2]! * w01 + data[i11 + 2]! * w11;
  const sSin = data[i00 + 3]! * w00 + data[i10 + 3]! * w10 + data[i01 + 3]! * w01 + data[i11 + 3]! * w11;
  const sCos = data[i00 + 4]! * w00 + data[i10 + 4]! * w10 + data[i01 + 4]! * w01 + data[i11 + 4]! * w11;
  const swellDir = ((Math.atan2(sSin, sCos) * RAD_TO_DEG) + 360) % 360;

  return { tws: Math.max(0, tws), twd, swh: Math.max(0, swh), swellDir };
}

/**
 * Sample wind at (lat, lon, tMs), preferring `grid` when the time is inside
 * its temporal coverage. If `tMs` is outside `grid`'s first..last timestamps
 * AND a `prevGrid`/`prevData` is provided whose bounds cover `tMs`, the
 * previous GFS run is used instead of stale extrapolation. This is the
 * routing-side mirror of `createFallbackWindLookup` on the sim side.
 */
export function sampleWind(
  grid: WindGridConfig,
  data: Float32Array,
  lat: number,
  lon: number,
  tMs: number,
  prevGrid?: WindGridConfig | null,
  prevData?: Float32Array | null,
): WindSample | null {
  if (prevGrid && prevData && grid.timestamps.length > 0) {
    const first = grid.timestamps[0]!;
    const last = grid.timestamps[grid.timestamps.length - 1]!;
    if (tMs < first || tMs > last) {
      const pFirst = prevGrid.timestamps[0];
      const pLast = prevGrid.timestamps[prevGrid.timestamps.length - 1];
      if (pFirst !== undefined && pLast !== undefined && tMs >= pFirst && tMs <= pLast) {
        return sampleGrid(prevGrid, prevData, lat, lon, tMs);
      }
    }
  }
  return sampleGrid(grid, data, lat, lon, tMs);
}

function sampleGrid(
  grid: WindGridConfig,
  data: Float32Array,
  lat: number,
  lon: number,
  tMs: number,
): WindSample | null {
  const ts = grid.timestamps;
  if (ts.length === 0) return null;
  if (ts.length === 1) return sampleLayer(grid, data, 0, lat, lon);

  const lastTs = ts[ts.length - 1]!;
  if (tMs >= lastTs) return sampleLayer(grid, data, ts.length - 1, lat, lon);
  const firstTs = ts[0]!;
  if (tMs <= firstTs) return sampleLayer(grid, data, 0, lat, lon);

  // Find bracketing layers
  let t0 = 0;
  for (let i = 1; i < ts.length; i++) {
    if (ts[i]! >= tMs) { t0 = i - 1; break; }
    t0 = i;
  }
  const t1 = Math.min(t0 + 1, ts.length - 1);
  const tFrac = t1 === t0 ? 0 : (tMs - ts[t0]!) / (ts[t1]! - ts[t0]!);

  const a = sampleLayer(grid, data, t0, lat, lon);
  const b = sampleLayer(grid, data, t1, lat, lon);

  const tws = a.tws * (1 - tFrac) + b.tws * tFrac;
  const swh = a.swh * (1 - tFrac) + b.swh * tFrac;

  // Angle temporal interpolation via u/v weighted by TWS (again same as
  // createWindLookup — this is what keeps temporal interpolation coherent
  // when wind direction shifts hard between frames).
  const u = -(Math.sin(a.twd * DEG_TO_RAD) * a.tws * (1 - tFrac) + Math.sin(b.twd * DEG_TO_RAD) * b.tws * tFrac);
  const v = -(Math.cos(a.twd * DEG_TO_RAD) * a.tws * (1 - tFrac) + Math.cos(b.twd * DEG_TO_RAD) * b.tws * tFrac);
  const twd = ((Math.atan2(-u, -v) / DEG_TO_RAD) + 360) % 360;

  // Swell dir: sin/cos average (simpler, swell is low-magnitude effect).
  const sx = Math.sin(a.swellDir * DEG_TO_RAD) * (1 - tFrac) + Math.sin(b.swellDir * DEG_TO_RAD) * tFrac;
  const cx = Math.cos(a.swellDir * DEG_TO_RAD) * (1 - tFrac) + Math.cos(b.swellDir * DEG_TO_RAD) * tFrac;
  const swellDir = ((Math.atan2(sx, cx) / DEG_TO_RAD) + 360) % 360;

  return { tws, twd, swh, swellDir };
}
