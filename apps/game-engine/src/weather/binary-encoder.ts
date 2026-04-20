import type { WeatherGridUV } from './grid.js';

export const HEADER_SIZE = 48;

export interface EncodeOptions {
  bounds: { latMin: number; latMax: number; lonMin: number; lonMax: number };
  hours: number[];
  runTimestamp: number;
  nextRunExpectedUtc: number;
  weatherStatus: number;
  blendAlpha: number;
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

  const bodyFloats = numHours * numLat * numLon * 6;
  const totalBytes = HEADER_SIZE + bodyFloats * 4;
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
  off += 2; // padding to 48

  // Body
  const body = new Float32Array(buf, HEADER_SIZE);
  let fi = 0;
  for (const fh of opts.hours) {
    const slotIdx = grid.forecastHours.indexOf(fh);
    if (slotIdx === -1) continue;
    const slotOff = slotIdx * plane;
    for (let r = rowStart; r <= rowEnd; r++) {
      for (let c = colStart; c <= colEnd; c++) {
        const i = slotOff + r * grid.shape.cols + c;
        body[fi++] = grid.u[i]!;
        body[fi++] = grid.v[i]!;
        body[fi++] = grid.swh[i]!;
        body[fi++] = grid.mwdSin[i]!;
        body[fi++] = grid.mwdCos[i]!;
        body[fi++] = grid.mwp[i]!;
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
