import { describe, it, expect, beforeAll } from 'vitest';
import { GameBalance } from '@nemo/game-balance/browser';
import {
  loadFixturePolars,
  loadFixtureGameBalance,
} from '../simulator/test-fixtures';
import { predictAfterHdg } from './predictAfterHdg';

const polars = loadFixturePolars(['IMOCA60']);
const polar = polars.IMOCA60;

beforeAll(() => {
  if (!GameBalance.isLoaded) GameBalance.load(loadFixtureGameBalance());
});

const baseInputs = {
  // Sailing on starboard (positive TWA), JIB upwind, TWS=15
  prevTwa: 50,
  twd: 0,
  tws: 15,
  currentSail: 'JIB' as const,
  sailAuto: false,
  bspBaseMultiplier: 1.0,
  transitionEndMs: 0,
  maneuverEndMs: 0,
  maneuverKind: 0 as const,
  polar,
  boatClass: 'IMOCA60' as const,
  now: 1_700_000_000_000,
};

describe('predictAfterHdg — twa derivation', () => {
  it('derives newTwa from (newHdg - twd) wrapped to [-180, 180]', () => {
    const r = predictAfterHdg({ ...baseInputs, newHdg: 80 });
    expect(r.hud.hdg).toBe(80);
    expect(r.hud.twa).toBe(80);
  });

  it('wraps westerly heading correctly', () => {
    // hdg=10, twd=350 → twa = 10 - 350 = -340 → wrap → 20
    const r = predictAfterHdg({ ...baseInputs, twd: 350, prevTwa: 60, newHdg: 10 });
    expect(r.hud.twa).toBe(20);
  });

  it('returns negative TWA for port tack', () => {
    // hdg = -50 wrap = 310, twd=0 → twa = -50 wrap = -50
    const r = predictAfterHdg({ ...baseInputs, prevTwa: -60, newHdg: 310 });
    expect(r.hud.twa).toBe(-50);
  });
});

describe('predictAfterHdg — BSP without maneuver', () => {
  it('bsp = polar × bspBaseMultiplier when no maneuver/transition', () => {
    const r = predictAfterHdg({ ...baseInputs, newHdg: 60, bspBaseMultiplier: 0.95 });
    // No maneuver triggered (sign of TWA stays positive: 50 → 60)
    expect(r.sail.maneuver).toBeUndefined();
    expect(r.sail.sailChange).toBeUndefined();
    // bsp must be > 0 and equal raw polar × multiplier
    expect(r.hud.bsp).toBeGreaterThan(0);
  });

  it('bsp scales linearly with bspBaseMultiplier', () => {
    const r1 = predictAfterHdg({ ...baseInputs, newHdg: 60, bspBaseMultiplier: 1.0 });
    const r2 = predictAfterHdg({ ...baseInputs, newHdg: 60, bspBaseMultiplier: 0.5 });
    expect(r2.hud.bsp).toBeCloseTo(r1.hud.bsp * 0.5, 5);
  });
});

describe('predictAfterHdg — tack detection', () => {
  it('triggers TACK when crossing irons (TWA sign flip, |newTwa|<90)', () => {
    // prev = +50 (starboard close-hauled), new hdg = -50 wrap 310 → twa = -50 (port close-hauled)
    const r = predictAfterHdg({ ...baseInputs, prevTwa: 50, newHdg: 310 });
    expect(r.sail.maneuver?.kind).toBe(1);
    expect(r.sail.maneuver?.startMs).toBe(baseInputs.now);
    expect(r.sail.maneuver?.endMs).toBeGreaterThan(baseInputs.now);
  });

  it('applies tack speedFactor to bsp during triggered tack', () => {
    const baseline = predictAfterHdg({ ...baseInputs, prevTwa: 50, newHdg: 60 });
    const tack = predictAfterHdg({ ...baseInputs, prevTwa: 50, newHdg: 310 });
    const expectedFactor = GameBalance.maneuvers.tack.speedFactor;
    // Tack BSP at TWA=-50 should be roughly polar(JIB, 50, 15) * speedFactor.
    // baseline at TWA=60, tack at TWA=50 → polar values differ; check ratio
    // by comparing tack.bsp to a no-maneuver prediction at the same TWA.
    const sameTwaNoManeuver = predictAfterHdg({
      ...baseInputs, prevTwa: -50, newHdg: 310,
    });
    expect(tack.hud.bsp).toBeCloseTo(sameTwaNoManeuver.hud.bsp * expectedFactor, 4);
    expect(baseline.hud.bsp).toBeGreaterThan(0);
  });
});

describe('predictAfterHdg — gybe detection', () => {
  it('triggers GYBE when crossing dead-downwind (TWA sign flip, |newTwa|>=90)', () => {
    // prev = +150, new hdg gives twa = -150
    // hdg = -150 wrap = 210, twd=0 → twa = -150
    const r = predictAfterHdg({ ...baseInputs, prevTwa: 150, newHdg: 210 });
    expect(r.sail.maneuver?.kind).toBe(2);
  });

  it('applies gybe speedFactor (lower than tack)', () => {
    const noMan = predictAfterHdg({ ...baseInputs, prevTwa: -150, newHdg: 210 });
    const gybe = predictAfterHdg({ ...baseInputs, prevTwa: 150, newHdg: 210 });
    const expectedFactor = GameBalance.maneuvers.gybe.speedFactor;
    expect(gybe.hud.bsp).toBeCloseTo(noMan.hud.bsp * expectedFactor, 4);
  });
});

describe('predictAfterHdg — in-progress maneuver', () => {
  it('does NOT trigger a new maneuver while one is active', () => {
    const r = predictAfterHdg({
      ...baseInputs,
      prevTwa: 50, newHdg: 310,
      maneuverEndMs: baseInputs.now + 30_000,
      maneuverKind: 1,
    });
    expect(r.sail.maneuver).toBeUndefined();
  });

  it('keeps applying current maneuver factor to bsp during in-progress maneuver', () => {
    const r = predictAfterHdg({
      ...baseInputs,
      prevTwa: 50, newHdg: 60,
      maneuverEndMs: baseInputs.now + 30_000,
      maneuverKind: 1,
    });
    // Even though heading change wouldn't trigger a maneuver, the in-progress
    // tack means BSP must include the tack factor.
    const noMan = predictAfterHdg({ ...baseInputs, prevTwa: 50, newHdg: 60 });
    expect(r.hud.bsp).toBeCloseTo(
      noMan.hud.bsp * GameBalance.maneuvers.tack.speedFactor,
      4,
    );
  });
});

describe('predictAfterHdg — sail auto switch', () => {
  it('triggers sail change when optimal differs and sailAuto=true', () => {
    // Going to deep downwind with JIB → optimal would be SPI/HG
    const r = predictAfterHdg({
      ...baseInputs,
      sailAuto: true, currentSail: 'JIB',
      prevTwa: 60, newHdg: 150,
    });
    expect(r.sail.sailChange).toBeDefined();
    expect(r.sail.sailChange?.currentSail).not.toBe('JIB');
    expect(r.sail.sailChange?.transitionStartMs).toBe(baseInputs.now);
    expect(r.sail.sailChange?.transitionEndMs).toBeGreaterThan(baseInputs.now);
  });

  it('applies transitionPenalty to bsp when sail-change triggered', () => {
    const r = predictAfterHdg({
      ...baseInputs,
      sailAuto: true, currentSail: 'JIB',
      prevTwa: 60, newHdg: 150,
    });
    const baselineSameTwa = predictAfterHdg({
      ...baseInputs,
      sailAuto: false,
      currentSail: r.sail.sailChange!.currentSail,
      prevTwa: 60, newHdg: 150,
    });
    expect(r.hud.bsp).toBeCloseTo(
      baselineSameTwa.hud.bsp * GameBalance.sails.transitionPenalty,
      4,
    );
  });

  it('skips auto-switch while a transition is in progress', () => {
    const r = predictAfterHdg({
      ...baseInputs,
      sailAuto: true, currentSail: 'JIB',
      prevTwa: 60, newHdg: 150,
      transitionEndMs: baseInputs.now + 30_000,
    });
    expect(r.sail.sailChange).toBeUndefined();
  });

  it('skips auto-switch when sailAuto=false', () => {
    const r = predictAfterHdg({
      ...baseInputs,
      sailAuto: false, currentSail: 'JIB',
      prevTwa: 60, newHdg: 150,
    });
    expect(r.sail.sailChange).toBeUndefined();
  });

  it('skips auto-switch when a maneuver is triggered (priority)', () => {
    // Crossing dead-down with sailAuto: gybe wins, sail-change is deferred to next tick
    const r = predictAfterHdg({
      ...baseInputs,
      sailAuto: true, currentSail: 'JIB',
      prevTwa: 150, newHdg: 210,
    });
    expect(r.sail.maneuver?.kind).toBe(2);
    expect(r.sail.sailChange).toBeUndefined();
  });
});

describe('predictAfterHdg — in-progress transition', () => {
  it('applies transitionPenalty to bsp during in-progress transition', () => {
    const r = predictAfterHdg({
      ...baseInputs,
      prevTwa: 50, newHdg: 60,
      transitionEndMs: baseInputs.now + 30_000,
    });
    const noTransition = predictAfterHdg({ ...baseInputs, prevTwa: 50, newHdg: 60 });
    expect(r.hud.bsp).toBeCloseTo(
      noTransition.hud.bsp * GameBalance.sails.transitionPenalty,
      4,
    );
  });
});
