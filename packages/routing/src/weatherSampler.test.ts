// packages/routing/src/weatherSampler.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { WindGridConfig } from '@nemo/game-engine-core/browser';
import { sampleWind } from './weatherSampler';

const FIELDS = 6;

/**
 * Build a 2-layer single-direction wind grid covering 46..48 N, -4..-2 W
 * (2x2 cells). Each layer is uniform — every cell has the same (u, v) — so
 * spatial bilinear collapses to the layer's value and any sample at any
 * (lat, lon) returns the layer's wind exactly.
 */
function makeRotatingGrid(opts: {
  t0: number;
  t1: number;
  layer0: { u: number; v: number };
  layer1: { u: number; v: number };
}): { grid: WindGridConfig; data: Float32Array } {
  const cols = 2, rows = 2;
  const grid: WindGridConfig = {
    bounds: { north: 48, south: 46, east: -2, west: -4 },
    resolution: 2, cols, rows,
    timestamps: [opts.t0, opts.t1],
  };
  const cells = cols * rows;
  const data = new Float32Array(2 * cells * FIELDS);
  for (let i = 0; i < cells; i++) {
    const o0 = i * FIELDS;
    const o1 = (cells + i) * FIELDS;
    data[o0] = opts.layer0.u;     data[o0 + 1] = opts.layer0.v;
    data[o1] = opts.layer1.u;     data[o1 + 1] = opts.layer1.v;
    // swh, sSin, sCos, swPer left at 0 — not under test here.
  }
  return { grid, data };
}

test('sampleWind: temporal TWS uses vector magnitude across rotating wind', () => {
  // Regression guard for the bug fixed in commit 11a5b1c (pair with the
  // same math in apps/web/src/lib/projection/windLookup.ts createWindLookup).
  // Layer 0: wind FROM south (TWD 180°), 10 kt → raw (u=0, v=10)
  // Layer 1: wind FROM west  (TWD 270°), 10 kt → raw (u=10, v=0)
  // At the temporal midpoint, the *vector* magnitude of the interpolated
  // u/v is sqrt(5² + 5²) ≈ 7.07 — strictly less than the scalar average
  // of the layer TWS (10). The router used to return the scalar avg, the
  // sim returned the vector magnitude, and the BSP gap drifted the
  // simulated trail behind the routed line on every wind shift. If this
  // assertion ever flips back to ~10, the temporal interp has reverted.
  const t0 = 1_700_000_000_000;
  const t1 = t0 + 3_600_000;
  const { grid, data } = makeRotatingGrid({
    t0, t1,
    layer0: { u: 0, v: 10 },
    layer1: { u: 10, v: 0 },
  });
  const sample = sampleWind(grid, data, 47, -3, (t0 + t1) / 2);
  assert.ok(sample, 'sample returned');
  const expectedTws = Math.sqrt(50);
  assert.ok(
    Math.abs(sample!.tws - expectedTws) < 0.01,
    `TWS should be vector magnitude ~${expectedTws.toFixed(2)} (NOT scalar avg 10), got ${sample!.tws.toFixed(3)}`,
  );
  // TWD via vector interp: atan2(-5, -5) → 225° (midpoint between 180 and 270).
  assert.ok(
    Math.abs(sample!.twd - 225) < 1,
    `TWD should be midpoint 225°, got ${sample!.twd.toFixed(2)}`,
  );
});

test('sampleWind: temporal TWS preserved when TWD constant across frames', () => {
  // Sanity check: when wind direction is identical between layers, the
  // vector magnitude and the (now-removed) scalar average coincide. Both
  // implementations must agree, and TWS at the midpoint must equal the
  // common layer TWS.
  const t0 = 1_700_000_000_000;
  const t1 = t0 + 3_600_000;
  const { grid, data } = makeRotatingGrid({
    t0, t1,
    layer0: { u: 0, v: 10 },
    layer1: { u: 0, v: 10 },
  });
  const sample = sampleWind(grid, data, 47, -3, (t0 + t1) / 2);
  assert.ok(sample, 'sample returned');
  assert.ok(Math.abs(sample!.tws - 10) < 0.01, `TWS should stay at 10, got ${sample!.tws.toFixed(3)}`);
  assert.ok(Math.abs(sample!.twd - 180) < 1, `TWD should stay at 180°, got ${sample!.twd.toFixed(2)}`);
});

test('sampleWind: temporal interpolation tracks tFrac', () => {
  // Same rotating fixture; assert that quarter-point and three-quarter
  // samples land on the right place along the u/v line. At t=0.25 we
  // expect u = 2.5, v = 7.5 → tws = sqrt(6.25 + 56.25) = sqrt(62.5),
  // twd = atan2(-2.5, -7.5) ≈ 198.43°. Mirror at t=0.75.
  const t0 = 1_700_000_000_000;
  const t1 = t0 + 4_000_000;
  const { grid, data } = makeRotatingGrid({
    t0, t1,
    layer0: { u: 0, v: 10 },
    layer1: { u: 10, v: 0 },
  });
  const q = sampleWind(grid, data, 47, -3, t0 + (t1 - t0) * 0.25);
  assert.ok(q && Math.abs(q.tws - Math.sqrt(62.5)) < 0.01, `q TWS, got ${q?.tws}`);
  const tq = sampleWind(grid, data, 47, -3, t0 + (t1 - t0) * 0.75);
  assert.ok(tq && Math.abs(tq.tws - Math.sqrt(62.5)) < 0.01, `tq TWS (mirrored), got ${tq?.tws}`);
});
