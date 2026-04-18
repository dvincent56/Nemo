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
 * Bilinear spatial interpolation + linear temporal interpolation on the weather grid.
 * Samples U/V components and converts back to TWS/TWD at read time.
 */
export function getForecastAt(grid: WeatherGridUV, lat: number, lon: number, timeUnix: number): WeatherPoint {
  const { latMin, lonMin } = grid.bbox;
  const res = grid.resolution;
  const rowF = (lat - latMin) / res;
  // Normalize lon to grid range (handles both -180..180 and 0..360 grids)
  let normLon = lon;
  if (normLon < lonMin) normLon += 360;
  if (normLon > lonMin + grid.shape.cols * res) normLon -= 360;
  const colF = (normLon - lonMin) / res;

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
