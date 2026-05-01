import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Polar, SailId } from '@nemo/shared-types';
import { GameBalance } from '@nemo/game-balance';
import { advanceSailState, getMaxTransitionSec, type SailRuntimeState } from './sails.js';

// Auto-switch must be gated when a programmed manual SAIL order sits inside
// the lockout window. tick.ts computes the gate from `orderHistory`; this
// suite locks down the underlying advanceSailState contract: when
// `suppressAutoSwitch=true`, the auto-mode block is a no-op even if the
// optimal sail differs from the active one.

before(async () => {
  await GameBalance.loadFromDisk();
});

// Minimal stub polar: JIB returns 5 kn flat, LJ returns 8 kn flat. The
// shape mirrors the real `Polar`: speeds[sailId] is a `twa.length × tws.length`
// 2D grid of knots. Two grid points on each axis are required so the
// findBracket bilerp in `getPolarSpeed` always has both endpoints; we put the
// query (twa=60, tws=12) at the lower corner and pad with another point.
function stubPolar(): Polar {
  const SPEEDS: Record<SailId, number> = {
    JIB: 5, LJ: 8, SS: 0, C0: 0, SPI: 0, HG: 0, LG: 0,
  };
  const twa = [60, 90];
  const tws = [12, 14];
  const speeds = Object.fromEntries(
    (Object.keys(SPEEDS) as SailId[]).map((s) => {
      const v = SPEEDS[s];
      // 2x2 grid, all cells = v so any (twa, tws) bilerp returns v exactly.
      return [s, [[v, v], [v, v]]];
    }),
  ) as Record<SailId, number[][]>;
  return { boatClass: 'CLASS40', tws, twa, speeds };
}

function makeState(overrides: Partial<SailRuntimeState> = {}): SailRuntimeState {
  return {
    active: 'JIB',
    pending: null,
    transitionStartMs: 0,
    transitionEndMs: 0,
    autoMode: true,
    timeOutOfRangeSec: 0,
    ...overrides,
  };
}

describe('advanceSailState — auto-switch suppression', () => {
  test('without suppression, auto-mode switches JIB → LJ when LJ is optimal', () => {
    const polar = stubPolar();
    const start = makeState();
    const next = advanceSailState(start, polar, 60, 12, 1, 1_000_000);
    assert.equal(next.active, 'LJ', 'auto-mode should switch to optimal sail');
    assert.ok(next.transitionEndMs > next.transitionStartMs, 'transition must be in flight');
  });

  test('with suppressAutoSwitch=true, auto-mode keeps the active sail', () => {
    const polar = stubPolar();
    const start = makeState();
    const next = advanceSailState(
      start, polar, 60, 12, 1, 1_000_000,
      undefined, undefined, true,
    );
    assert.equal(next.active, 'JIB', 'sail must stay on JIB');
    assert.equal(next.transitionEndMs, 0, 'no transition must be started');
  });

  test('suppression does not abort an in-flight transition', () => {
    const polar = stubPolar();
    const inFlight = makeState({
      active: 'LJ',
      transitionStartMs: 1_000_000 - 50_000,
      transitionEndMs: 1_000_000 + 30_000,
    });
    const next = advanceSailState(
      inFlight, polar, 60, 12, 1, 1_000_000,
      undefined, undefined, true,
    );
    assert.equal(next.active, 'LJ', 'active sail should not change');
    assert.equal(
      next.transitionEndMs, inFlight.transitionEndMs,
      'transitionEndMs must remain — transitions in flight finish normally',
    );
  });
});

describe('getMaxTransitionSec', () => {
  test('returns the max value across all configured pairs', () => {
    const max = getMaxTransitionSec();
    const fromJson = Math.max(
      ...Object.values(GameBalance.sails.transitionTimes).filter(
        (v): v is number => typeof v === 'number',
      ),
    );
    assert.equal(max, fromJson);
    assert.ok(max > 0, 'max must be positive');
  });
});
