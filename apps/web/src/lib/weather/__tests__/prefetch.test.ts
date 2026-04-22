import { describe, it, expect } from 'vitest';
import {
  DEFAULT_BOUNDS,
  PREFETCH_HOURS_TTFW,
  PREFETCH_HOURS_PHASE1,
  PREFETCH_HOURS_PHASE2,
} from '../prefetch';

describe('prefetch constants', () => {
  it('DEFAULT_BOUNDS covers the full globe', () => {
    expect(DEFAULT_BOUNDS.latMin).toBeLessThanOrEqual(-80);
    expect(DEFAULT_BOUNDS.latMax).toBeGreaterThanOrEqual(80);
    expect(DEFAULT_BOUNDS.lonMin).toBeLessThanOrEqual(-180);
    expect(DEFAULT_BOUNDS.lonMax).toBeGreaterThanOrEqual(180);
  });

  it('TTFW contains only t=0', () => {
    expect(PREFETCH_HOURS_TTFW).toEqual([0]);
  });

  it('PHASE1 covers 3..48h and starts after TTFW', () => {
    expect(PREFETCH_HOURS_PHASE1[0]).toBe(3);
    expect(PREFETCH_HOURS_PHASE1[PREFETCH_HOURS_PHASE1.length - 1]).toBe(48);
  });

  it('PHASE2 covers 54..120h and never exceeds 120h', () => {
    expect(PREFETCH_HOURS_PHASE2[0]).toBe(54);
    expect(Math.max(...PREFETCH_HOURS_PHASE2)).toBe(120);
  });
});
