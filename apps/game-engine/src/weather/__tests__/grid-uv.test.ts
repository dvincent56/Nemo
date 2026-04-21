import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { uvToTwsTwd, twsTwdToUv, decomposeAngle, recomposeAngle } from '../grid-uv.js';
import { getForecastAt, type WeatherGridUV, type WeatherGridUVMeta } from '../grid.js';

const MS_TO_KN = 1.94384;

describe('uvToTwsTwd', () => {
  it('converts north wind (v=-10 m/s, u=0) to TWS=10·kn, TWD=0°', () => {
    const { tws, twd } = uvToTwsTwd(0, -10);
    assert.ok(Math.abs(tws - 10 * MS_TO_KN) < 1e-3, `tws=${tws} expected ~${10 * MS_TO_KN}`);
    assert.ok(Math.abs(twd - 0) < 0.1 || Math.abs(twd - 360) < 0.1, `twd=${twd} expected ~0`);
  });

  it('converts west wind (u=5 m/s, v=0) to TWS=5·kn, TWD=270°', () => {
    const { tws, twd } = uvToTwsTwd(5, 0);
    assert.ok(Math.abs(tws - 5 * MS_TO_KN) < 1e-3, `tws=${tws} expected ~${5 * MS_TO_KN}`);
    assert.ok(Math.abs(twd - 270) < 0.1, `twd=${twd} expected ~270`);
  });

  it('converts SW wind (u=7.07, v=7.07) to TWS≈10·kn, TWD≈225°', () => {
    const { tws, twd } = uvToTwsTwd(7.07107, 7.07107);
    assert.ok(Math.abs(tws - 10 * MS_TO_KN) < 0.02, `tws=${tws} expected ~${10 * MS_TO_KN}`);
    assert.ok(Math.abs(twd - 225) < 0.1, `twd=${twd} expected ~225`);
  });
});

describe('twsTwdToUv', () => {
  it('roundtrips through uvToTwsTwd with knots scaling', () => {
    // twsTwdToUv treats its tws input as the same unit as u/v, so passing
    // m/s and converting back via uvToTwsTwd yields knots.
    const { u, v } = twsTwdToUv(15, 135);
    const { tws, twd } = uvToTwsTwd(u, v);
    assert.ok(Math.abs(tws - 15 * MS_TO_KN) < 1e-3, `tws=${tws} expected ~${15 * MS_TO_KN}`);
    assert.ok(Math.abs(twd - 135) < 0.1, `twd=${twd} expected ~135`);
  });
});

describe('decomposeAngle / recomposeAngle', () => {
  it('roundtrips 45°', () => {
    const { sinC, cosC } = decomposeAngle(45);
    const result = recomposeAngle(sinC, cosC);
    assert.ok(Math.abs(result - 45) < 0.001, `expected ~45, got ${result}`);
  });

  it('roundtrips wrap-around angle 315°', () => {
    const { sinC, cosC } = decomposeAngle(315);
    const result = recomposeAngle(sinC, cosC);
    assert.ok(Math.abs(result - 315) < 0.001, `expected ~315, got ${result}`);
  });
});

describe('getForecastAt (U/V grid)', () => {
  it('returns correct TWS/TWD from U/V storage', () => {
    // 2x2 grid, 1 forecast hour, north wind (u=0, v=-10)
    const meta: WeatherGridUVMeta = {
      runTs: 0,
      bbox: { latMin: 0, latMax: 1, lonMin: -180, lonMax: 180 },
      resolution: 1,
      shape: { rows: 2, cols: 2 },
      forecastHours: [0],
    };
    const n = 2 * 2; // 1 slot * 2 rows * 2 cols
    const grid: WeatherGridUV = {
      ...meta,
      u: new Float32Array(n).fill(0),
      v: new Float32Array(n).fill(-10),
      swh: new Float32Array(n).fill(2),
      mwdSin: new Float32Array(n).fill(0),
      mwdCos: new Float32Array(n).fill(1),
      mwp: new Float32Array(n).fill(8),
    };

    const wp = getForecastAt(grid, 0.5, -179.5, 0);
    assert.ok(Math.abs(wp.tws - 10 * MS_TO_KN) < 0.1, `tws=${wp.tws} expected ~${10 * MS_TO_KN}`);
    assert.ok(Math.abs(wp.twd - 0) < 1 || Math.abs(wp.twd - 360) < 1, `twd=${wp.twd} expected ~0`);
  });

  it('interpolates temporally between two forecast hours', () => {
    // 1x1 grid, 2 forecast hours:
    //   f000 (hour 0): north wind u=0, v=-10, swh=1, mwp=6
    //   f006 (hour 6): east wind  u=-10, v=0,  swh=3, mwp=10
    const meta: WeatherGridUVMeta = {
      runTs: 0,
      bbox: { latMin: 0, latMax: 0, lonMin: -180, lonMax: 180 },
      resolution: 1,
      shape: { rows: 1, cols: 1 },
      forecastHours: [0, 6],
    };
    const grid: WeatherGridUV = {
      ...meta,
      u: Float32Array.from([0, -10]),
      v: Float32Array.from([-10, 0]),
      swh: Float32Array.from([1, 3]),
      mwdSin: Float32Array.from([0, 1]),  // 0° and 90° wave direction
      mwdCos: Float32Array.from([1, 0]),
      mwp: Float32Array.from([6, 10]),
    };

    // Query at t=3h (midpoint), so t_frac = 0.5
    const timeAt3h = 3 * 3600; // 3 hours in seconds
    const wp = getForecastAt(grid, 0, -180, timeAt3h);

    // u_lerp = lerp(0, -10, 0.5) = -5, v_lerp = lerp(-10, 0, 0.5) = -5
    // |uv| = sqrt(50) m/s ≈ 7.071, converted to knots ≈ 13.745
    const expectedTws = Math.sqrt(50) * MS_TO_KN;
    assert.ok(Math.abs(wp.tws - expectedTws) < 0.1, `tws=${wp.tws} expected ~${expectedTws}`);
    // swh = lerp(1, 3, 0.5) = 2
    assert.ok(Math.abs(wp.swh - 2) < 0.01, `swh=${wp.swh} expected ~2`);
    // mwp = lerp(6, 10, 0.5) = 8
    assert.ok(Math.abs(wp.mwp - 8) < 0.01, `mwp=${wp.mwp} expected ~8`);
  });
});
