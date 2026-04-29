import { describe, it, expect } from 'vitest';
import { validateWpDistance, wpDistanceNm } from './safetyRadius';

const ORIGIN = { lat: 0, lon: 0 };

describe('validateWpDistance', () => {
  it('returns true when WP is exactly at the threshold', () => {
    // Approx 3 NM north: 3 / 60 = 0.05° latitude
    const wp = { lat: 0.05, lon: 0 };
    expect(validateWpDistance(ORIGIN, wp, 3)).toBe(true);
  });

  it('returns true when WP is well beyond the threshold', () => {
    const wp = { lat: 1, lon: 0 }; // ~60 NM
    expect(validateWpDistance(ORIGIN, wp, 3)).toBe(true);
  });

  it('returns false when WP is just under the threshold', () => {
    const wp = { lat: 0.04, lon: 0 }; // ~2.4 NM
    expect(validateWpDistance(ORIGIN, wp, 3)).toBe(false);
  });

  it('returns false when WP is at the boat position', () => {
    expect(validateWpDistance(ORIGIN, ORIGIN, 3)).toBe(false);
  });

  it('handles non-zero boat position', () => {
    const boat = { lat: 45, lon: -3 };
    const wpClose = { lat: 45.01, lon: -3 }; // ~0.6 NM
    const wpFar = { lat: 46, lon: -3 }; // ~60 NM
    expect(validateWpDistance(boat, wpClose, 3)).toBe(false);
    expect(validateWpDistance(boat, wpFar, 3)).toBe(true);
  });
});

describe('wpDistanceNm', () => {
  it('returns 0 when both positions are identical', () => {
    expect(wpDistanceNm(ORIGIN, ORIGIN)).toBe(0);
  });

  it('returns approximately the expected NM for a known degree offset', () => {
    // 1 degree latitude ≈ 60 NM
    const d = wpDistanceNm(ORIGIN, { lat: 1, lon: 0 });
    expect(d).toBeCloseTo(60, 0);
  });
});
