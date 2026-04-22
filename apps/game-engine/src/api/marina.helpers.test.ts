import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeSellPrice,
  meetsUnlockCriteria,
} from './marina.helpers.js';

describe('computeSellPrice', () => {
  it('returns 0 for a fresh boat with no stats', () => {
    const price = computeSellPrice({ wins: 0, podiums: 0, top10Finishes: 0 }, 0);
    assert.equal(price, 0);
  });

  it('applies the spec formula: totalNm*1 + wins*500 + podiums*150 + top10*30', () => {
    const price = computeSellPrice({ wins: 0, podiums: 2, top10Finishes: 5 }, 3482);
    // 3482*1 + 0*500 + 2*150 + 5*30 = 3482 + 0 + 300 + 150 = 3932
    assert.equal(price, 3932);
  });

  it('floors fractional NM', () => {
    const price = computeSellPrice({ wins: 1, podiums: 0, top10Finishes: 0 }, 10.7);
    // floor(10.7*1 + 500) = floor(510.7) = 510
    assert.equal(price, 510);
  });
});

describe('meetsUnlockCriteria', () => {
  it('returns true when no criteria specified', () => {
    assert.equal(meetsUnlockCriteria({}, { racesFinished: 0, avgRankPct: 1.0 }), true);
  });

  it('AND mode: requires all criteria met', () => {
    const criteria = { racesFinished: 20, avgRankPctMax: 0.20, or: false };
    assert.equal(meetsUnlockCriteria(criteria, { racesFinished: 25, avgRankPct: 0.15 }), true);
    assert.equal(meetsUnlockCriteria(criteria, { racesFinished: 10, avgRankPct: 0.15 }), false);
    assert.equal(meetsUnlockCriteria(criteria, { racesFinished: 25, avgRankPct: 0.50 }), false);
  });

  it('OR mode: requires at least one criterion met', () => {
    const criteria = { racesFinished: 20, avgRankPctMax: 0.20, or: true };
    assert.equal(meetsUnlockCriteria(criteria, { racesFinished: 25, avgRankPct: 0.50 }), true);
    assert.equal(meetsUnlockCriteria(criteria, { racesFinished: 5, avgRankPct: 0.50 }), false);
  });
});
