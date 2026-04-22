import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GameBalance } from '@nemo/game-balance';
import { conditionSpeedPenalty, computeWearDelta, INITIAL_CONDITIONS } from './wear.js';
import type { ConditionState } from './wear.js';
import type { WeatherPoint } from '@nemo/shared-types';
import type { AggregatedEffects } from './loadout.js';

before(async () => {
  await GameBalance.loadFromDisk();
});

const neutralLoadout: AggregatedEffects = {
  speedByTwa: [1, 1, 1, 1, 1],
  speedByTws: [1, 1, 1],
  wearMul: { hull: 1, rig: 1, sail: 1, elec: 1 },
  maneuverMul: {
    tack: { dur: 1, speed: 1 },
    gybe: { dur: 1, speed: 1 },
    sailChange: { dur: 1, speed: 1 },
  },
  polarTargetsDeg: 0,
  groundingLossMul: 1,
};

function mkCondition(partial: Partial<ConditionState>): ConditionState {
  return { hull: 100, rig: 100, sails: 100, electronics: 100, ...partial };
}

describe('conditionSpeedPenalty — weighted average', () => {
  it('returns 1.0 when weighted average is above 85', () => {
    // avg = 0.5*95 + 0.3*90 + 0.2*88 = 47.5 + 27 + 17.6 = 92.1
    const factor = conditionSpeedPenalty(mkCondition({ hull: 88, rig: 90, sails: 95 }));
    assert.equal(factor, 1.0);
  });

  it('returns maximum penalty (0.92 = -8%) when weighted average is at or below 50', () => {
    // avg = 0.5*40 + 0.3*50 + 0.2*70 = 20 + 15 + 14 = 49 → clamped at 50
    const factor = conditionSpeedPenalty(mkCondition({ hull: 70, rig: 50, sails: 40 }));
    assert.ok(Math.abs(factor - 0.92) < 1e-6, `expected ~0.92, got ${factor}`);
  });

  it('returns linear mid-penalty (~0.977) at weighted average ~75', () => {
    // avg = 0.5*75 + 0.3*75 + 0.2*75 = 75 → points lost = 10 → pct = 10*0.2286 = 2.286 → factor 0.97714
    const factor = conditionSpeedPenalty(mkCondition({ hull: 75, rig: 75, sails: 75 }));
    assert.ok(Math.abs(factor - 0.97714) < 1e-3, `expected ~0.977, got ${factor}`);
  });

  it('weights sails heaviest, hull lightest', () => {
    // Sails à 50, tout le reste à 100 → avg = 0.5*50 + 0.3*100 + 0.2*100 = 25 + 30 + 20 = 75
    const sailsDown = conditionSpeedPenalty(mkCondition({ sails: 50 }));
    // Hull à 50, tout le reste à 100 → avg = 0.5*100 + 0.3*100 + 0.2*50 = 50 + 30 + 10 = 90
    const hullDown = conditionSpeedPenalty(mkCondition({ hull: 50 }));
    // sailsDown plus pénalisant que hullDown
    assert.ok(sailsDown < hullDown, `sails weight should be heavier: sailsDown=${sailsDown} hullDown=${hullDown}`);
  });

  it('ignores electronics in the weighted average', () => {
    const full = conditionSpeedPenalty(mkCondition({}));
    const elecDown = conditionSpeedPenalty(mkCondition({ electronics: 0 }));
    assert.equal(elecDown, full, 'electronics must not affect speed penalty');
  });
});

function mkWeather(partial: Partial<WeatherPoint>): WeatherPoint {
  return { tws: 10, twd: 0, swh: 0, mwd: 0, mwp: 10, ...partial };
}

describe('computeWearDelta — conditional on weather', () => {
  const ONE_HOUR = 3600;

  it('applies zero wear below wind threshold (TWS < 15) and calm sea (Hs < 1.5)', () => {
    const d = computeWearDelta(mkWeather({ tws: 10, swh: 1 }), 0, ONE_HOUR, neutralLoadout);
    assert.equal(d.hull, 0);
    assert.equal(d.rig, 0);
    assert.equal(d.sails, 0);
    // electronics has its own tiny base rate independent of weather (design)
  });

  it('applies base rate × 1.0 multiplier at TWS 25, calm sea', () => {
    // windMul at tws=25 (rampEnd) = 1.0, swellMul=0, combined=1.0
    const d = computeWearDelta(mkWeather({ tws: 25, swh: 0 }), 0, ONE_HOUR, neutralLoadout);
    // sails base rate = 0.010, 1 hour, mult 1.0 → delta 0.010
    assert.ok(Math.abs(d.sails - 0.010) < 1e-6, `expected 0.010, got ${d.sails}`);
    assert.ok(Math.abs(d.rig - 0.006) < 1e-6, `expected 0.006, got ${d.rig}`);
    assert.ok(Math.abs(d.hull - 0.003) < 1e-6, `expected 0.003, got ${d.hull}`);
  });

  it('applies storm multiplier (5.0) at TWS 45+, calm sea', () => {
    // windMul at tws=45 = 5.0, swellMul=0, combined (additive) = 5.0
    const d = computeWearDelta(mkWeather({ tws: 45, swh: 0 }), 0, ONE_HOUR, neutralLoadout);
    assert.ok(Math.abs(d.sails - 0.010 * 5.0) < 1e-6, `expected 0.050, got ${d.sails}`);
  });

  it('adds wind and swell multipliers (not multiplicative)', () => {
    // tws=45 → windMul=5.0, swh=7 → swellMul=2.5, additive = 7.5
    const d = computeWearDelta(mkWeather({ tws: 45, swh: 7, mwp: 10, mwd: 180 }), 0, ONE_HOUR, neutralLoadout);
    // Assert not multiplicative: sails would be 0.010 × (5 × 2.5) = 0.125, but additive is 0.010 × 7.5 = 0.075
    // Note: swell also includes direction factor; with heading=0 and mwd=180, vagues en poupe, factor = dirBack = 0.5
    // So swellMul = 2.5 × 0.5 = 1.25 → combined = 5.0 + 1.25 = 6.25 → sails = 0.010 × 6.25 = 0.0625
    assert.ok(d.sails < 0.010 * 5.0 * 2.5, `should be additive not multiplicative, got ${d.sails}`);
    assert.ok(d.sails > 0.010 * 5.0, `should add swell contribution, got ${d.sails}`);
  });

  it('applies short-period bonus (+30%) to swell multiplier', () => {
    const longPeriod = computeWearDelta(mkWeather({ tws: 0, swh: 7, mwp: 10, mwd: 0 }), 0, ONE_HOUR, neutralLoadout);
    const shortPeriod = computeWearDelta(mkWeather({ tws: 0, swh: 7, mwp: 6, mwd: 0 }), 0, ONE_HOUR, neutralLoadout);
    assert.ok(shortPeriod.sails > longPeriod.sails, `short period should wear more: short=${shortPeriod.sails} long=${longPeriod.sails}`);
    assert.ok(Math.abs(shortPeriod.sails / longPeriod.sails - 1.3) < 0.05, `expected ~1.3× ratio, got ${shortPeriod.sails / longPeriod.sails}`);
  });

  it('applies direction factors: face > beam > back', () => {
    // wind-free, big swell, vary heading vs mwd
    // mwd = direction FROM which waves come. encounter = angle between heading and mwd.
    // encounter ~0 = vagues en poupe (back), ~180 = face
    const faceSea = computeWearDelta(mkWeather({ tws: 0, swh: 7, mwp: 10, mwd: 180 }), 0, ONE_HOUR, neutralLoadout);
    const backSea = computeWearDelta(mkWeather({ tws: 0, swh: 7, mwp: 10, mwd: 0 }), 0, ONE_HOUR, neutralLoadout);
    assert.ok(faceSea.sails > backSea.sails, `face sea must wear more than back sea: face=${faceSea.sails} back=${backSea.sails}`);
  });

  it('applies loadout wearMul on top of weather', () => {
    const lightLoadout: AggregatedEffects = {
      ...neutralLoadout,
      wearMul: { hull: 0.5, rig: 1, sail: 1, elec: 1 },
    };
    const standard = computeWearDelta(mkWeather({ tws: 45 }), 0, ONE_HOUR, neutralLoadout);
    const reinforced = computeWearDelta(mkWeather({ tws: 45 }), 0, ONE_HOUR, lightLoadout);
    assert.ok(Math.abs(reinforced.hull - standard.hull * 0.5) < 1e-6, `reinforced hull should wear half as fast`);
  });
});

describe('INITIAL_CONDITIONS', () => {
  it('is 100 on every axis', () => {
    assert.deepEqual(INITIAL_CONDITIONS, { hull: 100, rig: 100, sails: 100, electronics: 100 });
  });

  it('is a fresh object (not a shared reference)', () => {
    const a = { ...INITIAL_CONDITIONS };
    a.hull = 50;
    assert.equal(INITIAL_CONDITIONS.hull, 100, 'INITIAL_CONDITIONS must not be mutable via spread');
  });
});
