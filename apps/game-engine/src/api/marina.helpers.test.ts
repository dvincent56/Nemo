import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeSellPrice,
  computeRepairCost,
  meetsUnlockCriteria,
  conditionAxisToSlot,
} from './marina.helpers.js';
import type { UpgradeTier } from '@nemo/game-balance';

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

describe('computeRepairCost', () => {
  const maintenance = {
    hull: { costPer10pts: 80, durationHours: 8 },
    rig: { costPer10pts: 50, durationHours: 4 },
    sails: { costPer10pts: 120, durationHours: 12 },
    electronics: { costPer10pts: 30, durationHours: 3 },
  };
  const tiers: Record<UpgradeTier, { maintenanceMul: number }> = {
    SERIE: { maintenanceMul: 1.0 },
    BRONZE: { maintenanceMul: 1.5 },
    SILVER: { maintenanceMul: 2.0 },
    GOLD: { maintenanceMul: 3.0 },
    PROTO: { maintenanceMul: 4.5 },
  };

  it('returns 0 for a boat at 100% everywhere', () => {
    const cost = computeRepairCost(
      { hull: 100, rig: 100, sail: 100, elec: 100 },
      { hull: 'SERIE', mast: 'SERIE', sails: 'SERIE', electronics: 'SERIE' },
      maintenance,
      tiers,
    );
    assert.equal(cost.total, 0);
  });

  it('matches the spec example (78/62/45/90 with mixed tiers)', () => {
    const cost = computeRepairCost(
      { hull: 78, rig: 62, sail: 45, elec: 90 },
      { hull: 'SERIE', mast: 'BRONZE', sails: 'SILVER', electronics: 'BRONZE' },
      maintenance,
      tiers,
    );
    // hull: (100-78)/10 * 80 * 1.0 = 2.2 * 80 = 176
    assert.equal(cost.hull, 176);
    // rig: (100-62)/10 * 50 * 1.5 = 3.8 * 50 * 1.5 = 285
    assert.equal(cost.rig, 285);
    // sail: (100-45)/10 * 120 * 2.0 = 5.5 * 120 * 2.0 = 1320
    assert.equal(cost.sail, 1320);
    // elec: (100-90)/10 * 30 * 1.5 = 1.0 * 30 * 1.5 = 45
    assert.equal(cost.elec, 45);
    assert.equal(cost.total, 176 + 285 + 1320 + 45);
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

describe('conditionAxisToSlot', () => {
  it('maps each condition axis to its upgrade slot', () => {
    assert.equal(conditionAxisToSlot('hull'), 'HULL');
    assert.equal(conditionAxisToSlot('rig'), 'MAST');
    assert.equal(conditionAxisToSlot('sail'), 'SAILS');
    assert.equal(conditionAxisToSlot('elec'), 'ELECTRONICS');
  });
});
