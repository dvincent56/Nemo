import type { WeatherGridUV } from './grid.js';

export const HEADER_SIZE = 48;

export const GRID_VERSION = 2; // bumped from implicit v1 (float32) to v2 (adds encoding byte)
export const SCALE_UV_SWH_MWP = 100;
export const SCALE_SIN_COS = 30000;
export const INT16_NAN = -32768;

export type GridEncoding = 'float32' | 'int16';

export interface EncodeOptions {
  bounds: { latMin: number; latMax: number; lonMin: number; lonMax: number };
  hours: number[];
  runTimestamp: number;
  nextRunExpectedUtc: number;
  weatherStatus: number;
  blendAlpha: number;
  /** Target grid step in degrees. If > source resolution, the encoder decimates. */
  resolution?: number;
  /** Wire body encoding. Defaults to 'float32' for backwards compatibility. */
  encoding?: GridEncoding;
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
  const colStart = Math.max(0, Math.floor((opts.bounds.lonMin - grid.bbox.lonMin) / res));
  const colEnd = Math.min(grid.shape.cols - 1, Math.ceil((opts.bounds.lonMax - grid.bbox.lonMin) / res));

  const numLat = rowEnd - rowStart + 1;
  const numLon = colEnd - colStart + 1;
  const numHours = opts.hours.length;
  const plane = grid.shape.rows * grid.shape.cols;

  // Actual geographic extent of the clipped subset — must match the body,
  // NOT the requested bounds (which may extend beyond the source grid).
  const actualLatMin = grid.bbox.latMin + rowStart * res;
  const actualLatMax = grid.bbox.latMin + rowEnd * res;
  const actualLonMin = grid.bbox.lonMin + colStart * res;
  const actualLonMax = grid.bbox.lonMin + colEnd * res;

  const encoding: GridEncoding = opts.encoding ?? 'float32';

  const bodyBytesPerFloat = encoding === 'int16' ? 2 : 4;
  const bodyFloats = numHours * numLat * numLon * 6;
  const totalBytes = HEADER_SIZE + bodyFloats * bodyBytesPerFloat;
  const buf = new ArrayBuffer(totalBytes);
  const dv = new DataView(buf);

  // Header (48 bytes)
  let off = 0;
  dv.setUint32(off, opts.runTimestamp, true); off += 4;
  dv.setUint32(off, opts.nextRunExpectedUtc, true); off += 4;
  dv.setUint8(off, opts.weatherStatus); off += 4; // +3 padding
  dv.setFloat32(off, opts.blendAlpha, true); off += 4;
  dv.setFloat32(off, actualLatMin, true); off += 4;
  dv.setFloat32(off, actualLatMax, true); off += 4;
  dv.setFloat32(off, actualLonMin, true); off += 4;
  dv.setFloat32(off, actualLonMax, true); off += 4;
  dv.setFloat32(off, res, true); off += 4;
  dv.setFloat32(off, res, true); off += 4;
  dv.setUint16(off, numLat, true); off += 2;
  dv.setUint16(off, numLon, true); off += 2;
  dv.setUint16(off, numHours, true); off += 2;
  dv.setUint8(off, GRID_VERSION); off += 1;
  dv.setUint8(off, encoding === 'int16' ? 1 : 0); off += 1;

  // Body
  const quant = (value: number, scale: number): number => {
    if (!Number.isFinite(value)) return INT16_NAN;
    const q = Math.round(value * scale);
    if (q >= 32767) return 32767;
    if (q <= -32767) return -32767; // reserve -32768 for NaN
    return q;
  };

  let bi = 0;
  for (const fh of opts.hours) {
    const slotIdx = grid.forecastHours.indexOf(fh);
    if (slotIdx === -1) continue;
    const slotOff = slotIdx * plane;
    for (let r = rowStart; r <= rowEnd; r++) {
      for (let c = colStart; c <= colEnd; c++) {
        const i = slotOff + r * grid.shape.cols + c;
        const u = grid.u[i]!, v = grid.v[i]!, swh = grid.swh[i]!;
        const ms = grid.mwdSin[i]!, mc = grid.mwdCos[i]!, mwp = grid.mwp[i]!;
        if (encoding === 'int16') {
          dv.setInt16(HEADER_SIZE + bi * 2, quant(u, SCALE_UV_SWH_MWP), true); bi++;
          dv.setInt16(HEADER_SIZE + bi * 2, quant(v, SCALE_UV_SWH_MWP), true); bi++;
          dv.setInt16(HEADER_SIZE + bi * 2, quant(swh, SCALE_UV_SWH_MWP), true); bi++;
          dv.setInt16(HEADER_SIZE + bi * 2, quant(ms, SCALE_SIN_COS), true); bi++;
          dv.setInt16(HEADER_SIZE + bi * 2, quant(mc, SCALE_SIN_COS), true); bi++;
          dv.setInt16(HEADER_SIZE + bi * 2, quant(mwp, SCALE_UV_SWH_MWP), true); bi++;
        } else {
          dv.setFloat32(HEADER_SIZE + bi * 4, u, true); bi++;
          dv.setFloat32(HEADER_SIZE + bi * 4, v, true); bi++;
          dv.setFloat32(HEADER_SIZE + bi * 4, swh, true); bi++;
          dv.setFloat32(HEADER_SIZE + bi * 4, ms, true); bi++;
          dv.setFloat32(HEADER_SIZE + bi * 4, mc, true); bi++;
          dv.setFloat32(HEADER_SIZE + bi * 4, mwp, true); bi++;
        }
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
