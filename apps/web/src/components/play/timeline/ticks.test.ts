import { describe, it, expect } from 'vitest';
import { buildTicks } from './ticks';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe('buildTicks — futur', () => {
  it('emits relative offsets J+1 … J+5 inside maxMs', () => {
    const ticks = buildTicks({ minMs: 0, maxMs: 7 * DAY, nowMs: 0 });
    const fut = ticks.filter((t) => t.kind === 'future');
    expect(fut.map((t) => t.label)).toEqual(['J+1', 'J+2', 'J+3', 'J+5']);
  });

  it('clips future offsets that exceed maxMs', () => {
    const ticks = buildTicks({ minMs: 0, maxMs: 36 * HOUR, nowMs: 0 });
    const fut = ticks.filter((t) => t.kind === 'future');
    expect(fut.map((t) => t.label)).toEqual(['J+1']);
  });
});

describe('buildTicks — passé', () => {
  it('uses dense step (3h) when past span <= 12h', () => {
    const now = 12 * HOUR;
    const ticks = buildTicks({ minMs: 0, maxMs: 24 * HOUR, nowMs: now });
    const past = ticks.filter((t) => t.kind === 'past');
    expect(past.length).toBeGreaterThan(0);
  });

  it('uses 7d step for ~3-week past span', () => {
    const now = 21 * DAY;
    const ticks = buildTicks({ minMs: 0, maxMs: 21 * DAY + 7 * DAY, nowMs: now });
    const past = ticks.filter((t) => t.kind === 'past');
    // 3 weeks step 7d → 2-3 ticks
    expect(past.length).toBeGreaterThanOrEqual(2);
    expect(past.length).toBeLessThanOrEqual(3);
  });

  it('emits no past ticks when nowMs == minMs (race start)', () => {
    const ticks = buildTicks({ minMs: 0, maxMs: 7 * DAY, nowMs: 0 });
    expect(ticks.filter((t) => t.kind === 'past')).toHaveLength(0);
  });
});

describe('buildTicks — NOW marker', () => {
  it('includes a NOW marker when nowMs is in range', () => {
    const ticks = buildTicks({ minMs: 0, maxMs: 7 * DAY, nowMs: 3 * DAY });
    const nowTick = ticks.find((t) => t.kind === 'now');
    expect(nowTick).toBeDefined();
    expect(nowTick!.label).toBe('NOW');
    expect(nowTick!.pctX).toBeCloseTo((3 / 7) * 100, 5);
  });

  it('skips NOW marker when nowMs is outside range', () => {
    const ticks = buildTicks({ minMs: 1000, maxMs: 2000, nowMs: 500 });
    expect(ticks.find((t) => t.kind === 'now')).toBeUndefined();
  });
});

describe('buildTicks — positioning', () => {
  it('all pctX values lie in [0, 100]', () => {
    const ticks = buildTicks({ minMs: 0, maxMs: 7 * DAY, nowMs: 2 * DAY });
    for (const t of ticks) {
      expect(t.pctX).toBeGreaterThanOrEqual(0);
      expect(t.pctX).toBeLessThanOrEqual(100);
    }
  });

  it('emits ticks sorted chronologically', () => {
    const ticks = buildTicks({ minMs: 0, maxMs: 7 * DAY, nowMs: 3 * DAY });
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i]!.ts).toBeGreaterThanOrEqual(ticks[i - 1]!.ts);
    }
  });
});

describe('buildTicks — edge cases', () => {
  it('returns empty array on zero-span window', () => {
    expect(buildTicks({ minMs: 100, maxMs: 100, nowMs: 100 })).toEqual([]);
  });
});
