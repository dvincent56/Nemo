import { describe, it, expect } from 'vitest';
import { createWindLookup, type WindGridConfig } from '../windLookup';

/** Build a minimal 2×2 grid with constant non-zero wind for testing. */
function makeLookup() {
  const config: WindGridConfig = {
    bounds: { north: 50, south: 40, east: 10, west: 0 },
    resolution: 10, // 2 cols (0,10), 2 rows (40,50)
    cols: 2,
    rows: 2,
    timestamps: [0],
  };
  // 2×2 grid, 1 layer, 6 fields each → 24 floats.
  // Encoding: [u_kn, v_kn, swh, swellSin, swellCos, swellPeriod]. All points
  // hold the same value: 10 kn from the north (twd=0° → u=0, v=-10), swell
  // from the east (swellDir=90° → sin=1, cos=0).
  const point = [0, -10, 1, 1, 0, 8];
  const data = new Float32Array([
    ...point, // (row0,col0) = south-west
    ...point, // (row0,col1) = south-east
    ...point, // (row1,col0) = north-west
    ...point, // (row1,col1) = north-east
  ]);
  return createWindLookup(config, data);
}

describe('windLookup — out-of-range guard', () => {
  it('returns tws=0 for a lat/lon outside grid bounds (north)', () => {
    const lookup = makeLookup();
    const w = lookup(60, 5, 0); // lat 60 is north of bounds (50)
    expect(w).not.toBeNull();
    expect(w!.tws).toBe(0);
  });

  it('returns tws=0 for a lat/lon outside grid bounds (east)', () => {
    const lookup = makeLookup();
    const w = lookup(45, 20, 0); // lon 20 is east of bounds (10)
    expect(w).not.toBeNull();
    expect(w!.tws).toBe(0);
  });

  it('returns tws=0 for a lat/lon outside grid bounds (south)', () => {
    const lookup = makeLookup();
    const w = lookup(30, 5, 0); // lat 30 is south of bounds (40)
    expect(w).not.toBeNull();
    expect(w!.tws).toBe(0);
  });

  it('returns non-zero tws for a lat/lon inside grid bounds', () => {
    const lookup = makeLookup();
    const w = lookup(45, 5, 0); // centre of the grid
    expect(w).not.toBeNull();
    expect(w!.tws).toBeGreaterThan(0);
  });

  it('decodes (u, v) back to the encoded tws and twd', () => {
    // Fixture stores u=0, v=-10 → wind blows TO the south → comes FROM the
    // north → tws=10, twd=0. Catches any sign flip in the atan2 conversion.
    const lookup = makeLookup();
    const w = lookup(45, 5, 0)!;
    expect(w.tws).toBeCloseTo(10, 5);
    expect(w.twd).toBeCloseTo(0, 5);
    expect(w.swellDir).toBeCloseTo(90, 5); // sin=1, cos=0 → 90°
    expect(w.swellPeriod).toBeCloseTo(8, 5);
    expect(w.swh).toBeCloseTo(1, 5);
  });
});
