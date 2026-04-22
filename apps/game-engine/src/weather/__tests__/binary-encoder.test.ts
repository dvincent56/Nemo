import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { encodeGridSubset, decodeHeader, HEADER_SIZE, GRID_VERSION, SCALE_UV_SWH_MWP, SCALE_SIN_COS, INT16_NAN } from '../binary-encoder.js';
import type { WeatherGridUV } from '../grid.js';

function makeGridWithRes(resolution: number, rows: number, cols: number): WeatherGridUV {
  const len = rows * cols;
  const u = new Float32Array(len), v = new Float32Array(len);
  const swh = new Float32Array(len), ms = new Float32Array(len);
  const mc = new Float32Array(len), mwp = new Float32Array(len);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c; u[i] = r; v[i] = c;
  }
  return {
    runTs: 1000,
    bbox: { latMin: 0, latMax: (rows - 1) * resolution, lonMin: 0, lonMax: (cols - 1) * resolution },
    resolution,
    shape: { rows, cols },
    forecastHours: [0],
    u, v, swh, mwdSin: ms, mwdCos: mc, mwp,
  };
}

function makeSimpleGrid(): WeatherGridUV {
  const points = 2 * 2;
  const total = points * 2;
  return {
    runTs: 1713340800,
    bbox: { latMin: 40, latMax: 40.25, lonMin: -10, lonMax: -9.75 },
    resolution: 0.25,
    shape: { rows: 2, cols: 2 },
    forecastHours: [0, 6],
    u: new Float32Array(total).fill(-5),
    v: new Float32Array(total).fill(-8.66),
    swh: new Float32Array(total).fill(2.5),
    mwdSin: new Float32Array(total).fill(0.5),
    mwdCos: new Float32Array(total).fill(0.866),
    mwp: new Float32Array(total).fill(9),
  };
}

describe('encodeGridSubset', () => {
  it('encodes header + body for a bounded subset', () => {
    const grid = makeSimpleGrid();
    const buf = encodeGridSubset(grid, {
      bounds: { latMin: 40, latMax: 40.25, lonMin: -10, lonMax: -9.75 },
      hours: [0, 6],
      runTimestamp: 1713340800,
      nextRunExpectedUtc: 1713376800,
      weatherStatus: 0,
      blendAlpha: 0,
    });
    assert.ok(buf.byteLength > HEADER_SIZE);
    const header = decodeHeader(buf);
    assert.equal(header.runTimestamp, 1713340800);
    assert.equal(header.numHours, 2);
    assert.equal(header.numLat, 2);
    assert.equal(header.numLon, 2);
  });

  it('body contains 6 floats per point per hour', () => {
    const grid = makeSimpleGrid();
    const buf = encodeGridSubset(grid, {
      bounds: { latMin: 40, latMax: 40.25, lonMin: -10, lonMax: -9.75 },
      hours: [0],
      runTimestamp: 1713340800,
      nextRunExpectedUtc: 1713376800,
      weatherStatus: 0,
      blendAlpha: 0,
    });
    const bodySize = buf.byteLength - HEADER_SIZE;
    assert.equal(bodySize, 2 * 2 * 6 * 4); // 2 rows × 2 cols × 6 floats × 4 bytes
  });
});

describe('encodeGridSubset — int16 encoding', () => {
  it('roundtrips U/V values within 0.01 m/s tolerance', () => {
    const grid = makeSimpleGrid();
    const buf = encodeGridSubset(grid, {
      bounds: { latMin: 40, latMax: 40.25, lonMin: -10, lonMax: -9.75 },
      hours: [0],
      runTimestamp: 1000,
      nextRunExpectedUtc: 1360,
      weatherStatus: 0,
      blendAlpha: 0,
      encoding: 'int16',
    });
    const header = decodeHeader(buf);
    assert.ok(header.numLat * header.numLon > 0);

    const dv = new DataView(buf);
    // Read first cell as int16 from body: u, v, swh, mwdSin, mwdCos, mwp
    const u0   = dv.getInt16(HEADER_SIZE,      true) / SCALE_UV_SWH_MWP;
    const v0   = dv.getInt16(HEADER_SIZE + 2,  true) / SCALE_UV_SWH_MWP;
    const swh0 = dv.getInt16(HEADER_SIZE + 4,  true) / SCALE_UV_SWH_MWP;
    const ms0  = dv.getInt16(HEADER_SIZE + 6,  true) / SCALE_SIN_COS;
    // grid.u[0] = -5, grid.v[0] = -8.66 — tolerance 0.01
    assert.ok(Math.abs(u0 - grid.u[0]!) < 0.01, `u0=${u0} expected ~${grid.u[0]}`);
    assert.ok(Math.abs(v0 - grid.v[0]!) < 0.01, `v0=${v0} expected ~${grid.v[0]}`);
    // grid.swh[0] = 2.5 — same scale 100, tolerance 0.01
    assert.ok(Math.abs(swh0 - grid.swh[0]!) < 0.01, `swh0=${swh0} expected ~${grid.swh[0]}`);
    // grid.mwdSin[0] = 0.5 — scale 30000, tolerance 1e-4
    assert.ok(Math.abs(ms0 - grid.mwdSin[0]!) < 1e-4, `ms0=${ms0} expected ~${grid.mwdSin[0]}`);
  });

  it('encodes NaN as INT16_NAN sentinel', () => {
    const grid = makeSimpleGrid();
    // Overwrite swh[0] with NaN
    grid.swh[0] = NaN;
    const buf = encodeGridSubset(grid, {
      bounds: { latMin: 40, latMax: 40.25, lonMin: -10, lonMax: -9.75 },
      hours: [0],
      runTimestamp: 1000,
      nextRunExpectedUtc: 1360,
      weatherStatus: 0,
      blendAlpha: 0,
      encoding: 'int16',
    });
    const dv = new DataView(buf);
    // SWH is the 3rd field per cell (after u, v), so offset = HEADER_SIZE + 4
    assert.equal(dv.getInt16(HEADER_SIZE + 4, true), INT16_NAN);
  });

  it('writes GRID_VERSION=2 in the header', () => {
    const grid = makeSimpleGrid();
    const buf = encodeGridSubset(grid, {
      bounds: { latMin: 40, latMax: 40.25, lonMin: -10, lonMax: -9.75 },
      hours: [0],
      runTimestamp: 1000,
      nextRunExpectedUtc: 1360,
      weatherStatus: 0,
      blendAlpha: 0,
      encoding: 'int16',
    });
    const dv = new DataView(buf);
    // version byte lives at offset 46
    assert.equal(dv.getUint8(46), GRID_VERSION);
  });

  it('body size is half that of float32 for the same grid', () => {
    const grid = makeSimpleGrid();
    const opts = {
      bounds: { latMin: 40, latMax: 40.25, lonMin: -10, lonMax: -9.75 },
      hours: [0],
      runTimestamp: 1000,
      nextRunExpectedUtc: 1360,
      weatherStatus: 0,
      blendAlpha: 0,
    };
    const f32 = encodeGridSubset(grid, { ...opts, encoding: 'float32' });
    const i16 = encodeGridSubset(grid, { ...opts, encoding: 'int16' });
    const f32Body = f32.byteLength - HEADER_SIZE;
    const i16Body = i16.byteLength - HEADER_SIZE;
    assert.equal(i16Body, f32Body / 2);
  });
});

describe('encodeGridSubset — resolution downsampling', () => {
  it('decimates a 0.25° grid to 1° via stride=4', () => {
    const grid = makeGridWithRes(0.25, 21, 21); // 5° × 5° at 0.25°
    const buf = encodeGridSubset(grid, {
      bounds: { latMin: grid.bbox.latMin, latMax: grid.bbox.latMax,
                lonMin: grid.bbox.lonMin, lonMax: grid.bbox.lonMax },
      hours: [0],
      runTimestamp: 1000, nextRunExpectedUtc: 1360, weatherStatus: 0, blendAlpha: 0,
      resolution: 1,
    });
    const header = decodeHeader(buf);
    // outRes = 0.25 * 4 = 1.0
    assert.ok(Math.abs(header.gridStepLat - 1) < 1e-4, `gridStepLat=${header.gridStepLat} expected ~1`);
    assert.ok(Math.abs(header.gridStepLon - 1) < 1e-4, `gridStepLon=${header.gridStepLon} expected ~1`);
    // 21 source rows at 0.25°, stride=4 → ceil(21/4)=6 output rows
    assert.equal(header.numLat, 6);
    assert.equal(header.numLon, 6);

    // Verify decimation picked the correct source cells (float32 body, numLon=6).
    // makeGridWithRes fills u[i]=r, v[i]=c for source cell (r,c).
    const dv = new DataView(buf);
    const pos = (cellIdx: number, field: number) => HEADER_SIZE + (cellIdx * 6 + field) * 4;
    // Cell (0,0): source (r=0, c=0) → u=0, v=0
    assert.strictEqual(dv.getFloat32(pos(0, 0), true), 0);
    assert.strictEqual(dv.getFloat32(pos(0, 1), true), 0);
    // Cell (1,0): row-major index 1*6+0, source (r=4, c=0) → u=4, v=0
    assert.strictEqual(dv.getFloat32(pos(1 * 6 + 0, 0), true), 4);
    assert.strictEqual(dv.getFloat32(pos(1 * 6 + 0, 1), true), 0);
    // Cell (0,1): row-major index 0*6+1, source (r=0, c=4) → u=0, v=4
    assert.strictEqual(dv.getFloat32(pos(0 * 6 + 1, 0), true), 0);
    assert.strictEqual(dv.getFloat32(pos(0 * 6 + 1, 1), true), 4);
    // Cell (5,5): row-major index 5*6+5, source (r=20, c=20) → u=20, v=20
    assert.strictEqual(dv.getFloat32(pos(5 * 6 + 5, 0), true), 20);
    assert.strictEqual(dv.getFloat32(pos(5 * 6 + 5, 1), true), 20);
  });

  it('returns source resolution when resolution omitted', () => {
    const grid = makeGridWithRes(0.25, 9, 9);
    const buf = encodeGridSubset(grid, {
      bounds: { latMin: grid.bbox.latMin, latMax: grid.bbox.latMax,
                lonMin: grid.bbox.lonMin, lonMax: grid.bbox.lonMax },
      hours: [0],
      runTimestamp: 1000, nextRunExpectedUtc: 1360, weatherStatus: 0, blendAlpha: 0,
    });
    const header = decodeHeader(buf);
    assert.ok(Math.abs(header.gridStepLat - 0.25) < 1e-4, `gridStepLat=${header.gridStepLat} expected ~0.25`);
    assert.equal(header.numLat, 9);
    assert.equal(header.numLon, 9);
  });
});
