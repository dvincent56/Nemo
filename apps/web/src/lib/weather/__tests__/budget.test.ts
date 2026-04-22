import { describe, it, expect } from 'vitest';
import {
  PREFETCH_HOURS_TTFW,
  PREFETCH_HOURS_PHASE1,
  PREFETCH_HOURS_PHASE2,
  DEFAULT_BOUNDS,
  DEFAULT_RESOLUTION,
} from '../prefetch';

// Global 1° int16: 181 rows × 361 cols × 6 fields × 2 bytes = 784,092 bytes/hour
const BYTES_PER_HOUR_INT16_1DEG = 181 * 361 * 6 * 2;

describe('prefetch payload budget', () => {
  it('TTFW fits under 1 MB raw (pre-gzip) at 1° int16 global', () => {
    const raw = PREFETCH_HOURS_TTFW.length * BYTES_PER_HOUR_INT16_1DEG;
    expect(raw).toBeLessThan(1 * 1024 * 1024);
  });

  it('cumulative phase1 fits under 11 MB raw', () => {
    const hours = PREFETCH_HOURS_TTFW.length + PREFETCH_HOURS_PHASE1.length;
    const raw = hours * BYTES_PER_HOUR_INT16_1DEG;
    expect(raw).toBeLessThan(11 * 1024 * 1024);
  });

  it('cumulative phase2 fits under 27 MB raw (J+7 cap)', () => {
    const hours = PREFETCH_HOURS_TTFW.length + PREFETCH_HOURS_PHASE1.length + PREFETCH_HOURS_PHASE2.length;
    const raw = hours * BYTES_PER_HOUR_INT16_1DEG;
    expect(raw).toBeLessThan(27 * 1024 * 1024);
  });

  it('never exceeds 168h (J+7) on any prefetch phase', () => {
    const maxHour = Math.max(
      ...PREFETCH_HOURS_TTFW,
      ...PREFETCH_HOURS_PHASE1,
      ...PREFETCH_HOURS_PHASE2,
    );
    expect(maxHour).toBeLessThanOrEqual(168);
  });

  it('DEFAULT_RESOLUTION is 1° (not accidentally 0.25°)', () => {
    expect(DEFAULT_RESOLUTION).toBe(1);
  });

  it('DEFAULT_BOUNDS is global (not Atlantic-only)', () => {
    const width = DEFAULT_BOUNDS.lonMax - DEFAULT_BOUNDS.lonMin;
    const height = DEFAULT_BOUNDS.latMax - DEFAULT_BOUNDS.latMin;
    expect(width).toBeGreaterThanOrEqual(360);
    expect(height).toBeGreaterThanOrEqual(160);
  });
});
