import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { pointToSegmentClosestNM } from './geo.js';

describe('pointToSegmentClosestNM', () => {
  test('returns ~0 for a point exactly on the segment (midpoint)', () => {
    const a = { lat: 46, lon: -4 };
    const b = { lat: 46, lon: -3 };
    const p = { lat: 46, lon: -3.5 }; // midpoint
    const d = pointToSegmentClosestNM(p, a, b);
    assert.ok(d < 1e-6, `expected ~0, got ${d}`);
  });

  test('returns Infinity when perpendicular falls before segment', () => {
    const a = { lat: 46, lon: -4 };
    const b = { lat: 46, lon: -3 };
    const p = { lat: 46, lon: -5 }; // 1° west of A — projection t < 0
    assert.equal(pointToSegmentClosestNM(p, a, b), Infinity);
  });

  test('returns Infinity when perpendicular falls after segment', () => {
    const a = { lat: 46, lon: -4 };
    const b = { lat: 46, lon: -3 };
    const p = { lat: 46, lon: -2 }; // 1° east of B
    assert.equal(pointToSegmentClosestNM(p, a, b), Infinity);
  });

  test('returns the perpendicular distance when projection falls inside segment', () => {
    const a = { lat: 46, lon: -4 };
    const b = { lat: 46, lon: -3 };
    // P at lat 46.001, lon -3.5: 0.001° latitude north of midpoint = 0.06 NM
    const p = { lat: 46.001, lon: -3.5 };
    const d = pointToSegmentClosestNM(p, a, b);
    assert.ok(Math.abs(d - 0.06) < 0.005, `expected ~0.06 NM, got ${d}`);
  });

  test('handles degenerate segment (A === B) by returning Euclidean distance', () => {
    const a = { lat: 46, lon: -4 };
    const b = { lat: 46, lon: -4 };
    const p = { lat: 46.001, lon: -4 };
    const d = pointToSegmentClosestNM(p, a, b);
    assert.ok(Math.abs(d - 0.06) < 0.005, `expected ~0.06 NM for degenerate segment, got ${d}`);
  });

  test('meter-level precision: 1m offset from segment line is detected', () => {
    // 1 meter ≈ 0.00054 NM. A point 1m perpendicular from the segment line
    // should produce a distance close to that.
    const a = { lat: 46, lon: -4 };
    const b = { lat: 46, lon: -3.99 }; // ~0.4 NM east
    // 1m north ≈ 9.0e-6 degrees of latitude → 5.4e-4 NM.
    const oneMeterDeg = 1 / 111_000; // ≈ 9.0e-6
    const p = { lat: 46 + oneMeterDeg, lon: -3.995 };
    const d = pointToSegmentClosestNM(p, a, b);
    // Expect ~0.00054 NM (1 meter), within a tolerance generous for the
    // local-tangent approximation at this latitude.
    assert.ok(d > 0.0004 && d < 0.0007, `expected ~5.4e-4 NM (1m), got ${d}`);
  });
});
