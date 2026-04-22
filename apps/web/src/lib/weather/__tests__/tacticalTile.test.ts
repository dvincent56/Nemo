import { describe, it, expect } from 'vitest';
import { computeTileBounds, isBoatInsideMargin } from '../tacticalTile';

describe('computeTileBounds', () => {
  it('centers a 40x40 box around the boat', () => {
    const b = computeTileBounds({ lat: 45, lon: -10 });
    expect(b.latMin).toBe(25); expect(b.latMax).toBe(65);
    expect(b.lonMin).toBe(-30); expect(b.lonMax).toBe(10);
  });

  it('clamps to -90/+90 at the poles', () => {
    const b = computeTileBounds({ lat: 85, lon: 0 });
    expect(b.latMax).toBe(90);
    expect(b.latMin).toBeGreaterThanOrEqual(50); // still 40° wide when possible
  });
});

describe('isBoatInsideMargin', () => {
  it('returns true when boat is well inside the tile', () => {
    const b = { latMin: 25, latMax: 65, lonMin: -30, lonMax: 10 };
    expect(isBoatInsideMargin({ lat: 45, lon: -10 }, b, 10)).toBe(true);
  });

  it('returns false when boat is within margin of a tile edge', () => {
    const b = { latMin: 25, latMax: 65, lonMin: -30, lonMax: 10 };
    expect(isBoatInsideMargin({ lat: 58, lon: -10 }, b, 10)).toBe(false); // lat within 7° of top
    expect(isBoatInsideMargin({ lat: 45, lon: 5 }, b, 10)).toBe(false);   // lon within 5° of east
  });
});
