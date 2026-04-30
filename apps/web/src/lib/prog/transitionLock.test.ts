import { describe, it, expect, beforeAll } from 'vitest';
import { GameBalance } from '@nemo/game-balance/browser';
import { loadFixtureGameBalance } from '../simulator/test-fixtures';
import { earliestSailSlot, getTransitionDurationSec } from './transitionLock';
import type { ProgDraft, SailOrder } from './types';

beforeAll(() => {
  if (!GameBalance.isLoaded) GameBalance.load(loadFixtureGameBalance());
});

const NOW = 1_700_000_000;

const empty = (): ProgDraft => ({
  mode: 'wp',
  capOrders: [],
  wpOrders: [],
  finalCap: null,
  sailOrders: [],
});

const atTime = (id: string, time: number, sail: SailOrder['action']): SailOrder => ({
  id,
  trigger: { type: 'AT_TIME', time },
  action: sail,
});

describe('getTransitionDurationSec', () => {
  it('returns 0 for same sail', () => {
    expect(getTransitionDurationSec('JIB', 'JIB')).toBe(0);
  });

  it('returns the configured pair duration from game-balance', () => {
    // JIB_LJ = 120 in fixture
    expect(getTransitionDurationSec('JIB', 'LJ')).toBe(120);
    expect(getTransitionDurationSec('LG', 'JIB')).toBe(180); // default fallback
  });
});

describe('earliestSailSlot', () => {
  it('returns nowSec for an empty draft', () => {
    expect(earliestSailSlot(empty(), 'JIB', null, NOW)).toBe(NOW);
  });

  it('returns nowSec when only AT_WAYPOINT sail orders exist', () => {
    const draft: ProgDraft = {
      ...empty(),
      sailOrders: [
        {
          id: 's1',
          trigger: { type: 'AT_WAYPOINT', waypointOrderId: 'w1' },
          action: { auto: false, sail: 'LG' },
        },
      ],
    };
    expect(earliestSailSlot(draft, 'JIB', null, NOW)).toBe(NOW);
  });

  it('locks out the slot through T1 + duration of a single AT_TIME order', () => {
    // Boat is on LG, programmed change to JIB at NOW+3600.
    // LG_JIB transition = 180 s (default fallback — no LG_JIB pair in fixture).
    const t1 = NOW + 3600;
    const draft: ProgDraft = {
      ...empty(),
      sailOrders: [atTime('s1', t1, { auto: false, sail: 'JIB' })],
    };
    const expected = t1 + 180;
    expect(earliestSailSlot(draft, 'LG', null, NOW)).toBe(expected);
  });

  it('chains transitions when two AT_TIME orders are spaced apart', () => {
    // JIB → LJ at NOW+3600 (120 s), then LJ → SS at NOW+5000 (150 s).
    const t1 = NOW + 3600;
    const t2 = NOW + 5000;
    const draft: ProgDraft = {
      ...empty(),
      sailOrders: [
        atTime('s1', t1, { auto: false, sail: 'LJ' }),
        atTime('s2', t2, { auto: false, sail: 'SS' }),
      ],
    };
    expect(earliestSailSlot(draft, 'JIB', null, NOW)).toBe(t2 + 150);
  });

  it('skips an overlapping order and uses the prior floor', () => {
    // s1 at t1 → LJ (120s). s2 attempts to fire at t1+30 (during transition).
    // s2 is skipped; the floor stays at t1 + 120.
    const t1 = NOW + 3600;
    const draft: ProgDraft = {
      ...empty(),
      sailOrders: [
        atTime('s1', t1, { auto: false, sail: 'LJ' }),
        atTime('s2', t1 + 30, { auto: false, sail: 'SS' }),
      ],
    };
    expect(earliestSailSlot(draft, 'JIB', null, NOW)).toBe(t1 + 120);
  });

  it('excludes the edited order when computing the floor', () => {
    // Editing s1 — its own time should not constrain itself.
    const t1 = NOW + 3600;
    const draft: ProgDraft = {
      ...empty(),
      sailOrders: [atTime('s1', t1, { auto: false, sail: 'LJ' })],
    };
    expect(earliestSailSlot(draft, 'JIB', 's1', NOW)).toBe(NOW);
  });

  it('treats auto orders as keeping the active sail (no extra transition)', () => {
    // Auto order doesn't change activeSail; subsequent manual order's
    // transition is computed from the still-active sail.
    const t1 = NOW + 3600;
    const t2 = NOW + 5000;
    const draft: ProgDraft = {
      ...empty(),
      sailOrders: [
        atTime('s1', t1, { auto: true }),
        atTime('s2', t2, { auto: false, sail: 'LJ' }),
      ],
    };
    // Auto: JIB → JIB (0s), then JIB → LJ (120s).
    expect(earliestSailSlot(draft, 'JIB', null, NOW)).toBe(t2 + 120);
  });
});
