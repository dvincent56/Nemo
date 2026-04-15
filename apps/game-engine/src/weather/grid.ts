import type { WeatherPoint } from '@nemo/shared-types';

export interface WeatherGridMeta {
  runTs: number;
  bbox: { latMin: number; latMax: number; lonMin: number; lonMax: number };
  resolution: number;
  shape: { rows: number; cols: number };
  forecastHours: number[];
}

export interface WeatherGrid extends WeatherGridMeta {
  tws: Float32Array;
  twd: Float32Array;
  swh: Float32Array;
  mwd: Float32Array;
  mwp: Float32Array;
}

function idx(grid: WeatherGridMeta, forecastSlot: number, row: number, col: number): number {
  const plane = grid.shape.rows * grid.shape.cols;
  return forecastSlot * plane + row * grid.shape.cols + col;
}

function pickForecastSlot(grid: WeatherGridMeta, timeUnix: number): {
  slot: number; nextSlot: number; t: number;
} {
  const elapsedHours = Math.max(0, (timeUnix - grid.runTs) / 3600);
  const hours = grid.forecastHours;
  for (let i = 0; i < hours.length - 1; i++) {
    const a = hours[i] as number;
    const b = hours[i + 1] as number;
    if (elapsedHours >= a && elapsedHours <= b) {
      const mid = (a + b) / 2;
      return { slot: elapsedHours < mid ? i : i + 1, nextSlot: i + 1, t: 0 };
    }
  }
  const last = hours.length - 1;
  return { slot: last, nextSlot: last, t: 0 };
}

/**
 * Bilinear spatial interpolation on the NOAA lat/lon grid.
 * Temporal switch is nearest-slot at half-interval (deterministic, per spec 4.2).
 */
export function getForecastAt(grid: WeatherGrid, lat: number, lon: number, timeUnix: number): WeatherPoint {
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

  const { slot } = pickForecastSlot(grid, timeUnix);

  const sample = (field: Float32Array): number => {
    const v00 = field[idx(grid, slot, row0, col0)] ?? 0;
    const v01 = field[idx(grid, slot, row0, col1)] ?? 0;
    const v10 = field[idx(grid, slot, row1, col0)] ?? 0;
    const v11 = field[idx(grid, slot, row1, col1)] ?? 0;
    const top = v00 * (1 - ct) + v01 * ct;
    const bot = v10 * (1 - ct) + v11 * ct;
    return top * (1 - rt) + bot * rt;
  };

  return {
    tws: sample(grid.tws),
    twd: ((sample(grid.twd) % 360) + 360) % 360,
    swh: sample(grid.swh),
    mwd: ((sample(grid.mwd) % 360) + 360) % 360,
    mwp: sample(grid.mwp),
  };
}

export function decodeGridFromBase64(
  meta: WeatherGridMeta,
  fields: { tws: string; twd: string; swh: string; mwd: string; mwp: string },
): WeatherGrid {
  const toArr = (b64: string): Float32Array => {
    const buf = Buffer.from(b64, 'base64');
    return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  };
  return {
    ...meta,
    tws: toArr(fields.tws),
    twd: toArr(fields.twd),
    swh: toArr(fields.swh),
    mwd: toArr(fields.mwd),
    mwp: toArr(fields.mwp),
  };
}
