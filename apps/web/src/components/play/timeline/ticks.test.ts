import { describe, it, expect } from 'vitest';
import { computeTicks, buildTickPositions } from './ticks';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe('computeTicks', () => {
  it('uses 1h step when span <= 12h', () => {
    const t = computeTicks({ minMs: 0, maxMs: 12 * HOUR, nowMs: 0 });
    expect(t.stepMs).toBe(HOUR);
    expect(t.format).toBe('HH:00');
  });

  it('uses 6h step when span 12-72h', () => {
    const t = computeTicks({ minMs: 0, maxMs: 48 * HOUR, nowMs: 0 });
    expect(t.stepMs).toBe(6 * HOUR);
    expect(t.format).toBe('HH:00 · J+N');
  });

  it('uses 1d step when span 3-14d', () => {
    const t = computeTicks({ minMs: 0, maxMs: 7 * DAY, nowMs: 0 });
    expect(t.stepMs).toBe(DAY);
    expect(t.format).toBe('DD MMM');
  });

  it('uses 7d step when span > 14d', () => {
    const t = computeTicks({ minMs: 0, maxMs: 30 * DAY, nowMs: 0 });
    expect(t.stepMs).toBe(7 * DAY);
    expect(t.format).toBe('DD MMM');
  });
});

describe('buildTickPositions', () => {
  it('positions ticks proportionally on 0-100% scale', () => {
    const scale = { stepMs: HOUR, format: 'HH:00' as const };
    const positions = buildTickPositions(
      scale,
      { minMs: 0, maxMs: 4 * HOUR, nowMs: 0 },
      (ts) => `t=${ts}`,
    );
    // ticks at 0, 1h, 2h, 3h, 4h
    expect(positions).toHaveLength(5);
    expect(positions[0]!.pctX).toBe(0);
    expect(positions[2]!.pctX).toBe(50);
    expect(positions[4]!.pctX).toBe(100);
  });

  it('aligns first tick to step boundary', () => {
    const scale = { stepMs: HOUR, format: 'HH:00' as const };
    const positions = buildTickPositions(
      scale,
      { minMs: 1500, maxMs: 4 * HOUR, nowMs: 0 },
      (ts) => `${ts}`,
    );
    // first tick should be at HOUR (the next multiple of HOUR after 1500)
    expect(positions[0]!.ts).toBe(HOUR);
  });

  it('passes scale + nowMs to formatLabel', () => {
    const scale = { stepMs: HOUR, format: 'HH:00 · J+N' as const };
    const labels: Array<{ ts: number; format: string; nowMs: number }> = [];
    buildTickPositions(
      scale,
      { minMs: 0, maxMs: 2 * HOUR, nowMs: 12345 },
      (ts, sc, now) => {
        labels.push({ ts, format: sc.format, nowMs: now });
        return '';
      },
    );
    expect(labels.length).toBeGreaterThan(0);
    expect(labels[0]!.format).toBe('HH:00 · J+N');
    expect(labels[0]!.nowMs).toBe(12345);
  });
});
