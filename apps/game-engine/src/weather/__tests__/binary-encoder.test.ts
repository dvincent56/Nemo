import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { encodeGridSubset, decodeHeader, HEADER_SIZE, GRID_VERSION, SCALE_UV_SWH_MWP, SCALE_SIN_COS, INT16_NAN } from '../binary-encoder.js';
import type { WeatherGridUV } from '../grid.js';

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
    // Read first U/V pair as int16 from body
    const u0 = dv.getInt16(HEADER_SIZE, true) / SCALE_UV_SWH_MWP;
    const v0 = dv.getInt16(HEADER_SIZE + 2, true) / SCALE_UV_SWH_MWP;
    // grid.u[0] = -5, grid.v[0] = -8.66 — tolerance 0.01
    assert.ok(Math.abs(u0 - grid.u[0]!) < 0.01, `u0=${u0} expected ~${grid.u[0]}`);
    assert.ok(Math.abs(v0 - grid.v[0]!) < 0.01, `v0=${v0} expected ~${grid.v[0]}`);
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
