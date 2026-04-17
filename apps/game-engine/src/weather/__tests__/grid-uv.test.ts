import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { uvToTwsTwd, twsTwdToUv, decomposeAngle, recomposeAngle } from '../grid-uv.js';

describe('uvToTwsTwd', () => {
  it('converts north wind (v=-10, u=0) to TWS=10, TWD=0°', () => {
    const { tws, twd } = uvToTwsTwd(0, -10);
    assert.ok(Math.abs(tws - 10) < 1e-4, `tws=${tws} expected ~10`);
    assert.ok(Math.abs(twd - 0) < 0.1 || Math.abs(twd - 360) < 0.1, `twd=${twd} expected ~0`);
  });

  it('converts west wind (u=5, v=0) to TWS=5, TWD=270°', () => {
    const { tws, twd } = uvToTwsTwd(5, 0);
    assert.ok(Math.abs(tws - 5) < 1e-4, `tws=${tws} expected ~5`);
    assert.ok(Math.abs(twd - 270) < 0.1, `twd=${twd} expected ~270`);
  });

  it('converts SW wind (u=7.07, v=7.07) to TWS≈10, TWD≈225°', () => {
    const { tws, twd } = uvToTwsTwd(7.07107, 7.07107);
    assert.ok(Math.abs(tws - 10) < 0.01, `tws=${tws} expected ~10`);
    assert.ok(Math.abs(twd - 225) < 0.1, `twd=${twd} expected ~225`);
  });
});

describe('twsTwdToUv', () => {
  it('roundtrips through uvToTwsTwd', () => {
    const { u, v } = twsTwdToUv(15, 135);
    const { tws, twd } = uvToTwsTwd(u, v);
    assert.ok(Math.abs(tws - 15) < 1e-4, `tws=${tws} expected ~15`);
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
