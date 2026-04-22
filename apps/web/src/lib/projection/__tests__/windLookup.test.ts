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
  // 2×2 grid, 1 layer, 5 fields each → 20 floats
  // All points: tws=10, twd=180, swh=1, swellDir=90, swellPeriod=8
  const data = new Float32Array([
    10, 180, 1, 90, 8, // (row0,col0) = south-west
    10, 180, 1, 90, 8, // (row0,col1) = south-east
    10, 180, 1, 90, 8, // (row1,col0) = north-west
    10, 180, 1, 90, 8, // (row1,col1) = north-east
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
});
