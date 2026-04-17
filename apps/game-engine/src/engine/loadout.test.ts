import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { GameBalance, type UpgradeItem } from '@nemo/game-balance';
import { aggregateEffects, resolveBoatLoadout } from './loadout.js';

// ---------------------------------------------------------------------------
// Helpers: build minimal UpgradeItem fixtures without hitting game-balance.json
// ---------------------------------------------------------------------------

function neutralItem(id: string): UpgradeItem {
  return {
    id,
    slot: 'HULL',
    tier: 'SERIE',
    name: id,
    profile: 'test',
    description: '',
    compat: ['CLASS40'],
    cost: null,
    effects: {
      speedByTwa: [0, 0, 0, 0, 0],
      speedByTws: [0, 0, 0],
      wearMul: {},
      maneuverMul: {},
      polarTargetsDeg: null,
      activation: {},
      groundingLossMul: null,
    },
  };
}

// ---------------------------------------------------------------------------
// Group 1: aggregateEffects (no GameBalance needed)
// ---------------------------------------------------------------------------

describe('aggregateEffects', () => {

  test('1 — neutral items → all multipliers at 1.0, polar=0, grounding=1', () => {
    const items = [neutralItem('a'), neutralItem('b')];
    const agg = aggregateEffects(items);

    assert.deepStrictEqual(agg.speedByTwa, [1, 1, 1, 1, 1]);
    assert.deepStrictEqual(agg.speedByTws, [1, 1, 1]);
    assert.strictEqual(agg.wearMul.hull, 1);
    assert.strictEqual(agg.wearMul.rig, 1);
    assert.strictEqual(agg.wearMul.sail, 1);
    assert.strictEqual(agg.wearMul.elec, 1);
    assert.strictEqual(agg.polarTargetsDeg, 0);
    assert.strictEqual(agg.groundingLossMul, 1);
    assert.strictEqual(agg.maneuverMul.tack.dur, 1);
    assert.strictEqual(agg.maneuverMul.tack.speed, 1);
    assert.strictEqual(agg.maneuverMul.gybe.dur, 1);
    assert.strictEqual(agg.maneuverMul.gybe.speed, 1);
    assert.strictEqual(agg.maneuverMul.sailChange.dur, 1);
    assert.strictEqual(agg.maneuverMul.sailChange.speed, 1);
  });

  test('2 — speedByTwa multiplication compounds correctly', () => {
    // Item A: speedByTwa [-0.02, 0, 0.06, 0.04, 0]
    const itemA: UpgradeItem = {
      ...neutralItem('a'),
      effects: {
        ...neutralItem('a').effects,
        speedByTwa: [-0.02, 0, 0.06, 0.04, 0],
        speedByTws: [0, 0, 0],
      },
    };
    // Item B: speedByTwa [0, 0.02, 0.03, 0.02, 0]
    const itemB: UpgradeItem = {
      ...neutralItem('b'),
      effects: {
        ...neutralItem('b').effects,
        speedByTwa: [0, 0.02, 0.03, 0.02, 0],
        speedByTws: [0, 0, 0],
      },
    };

    const agg = aggregateEffects([itemA, itemB]);

    // band 0: (1 + -0.02) * (1 + 0) = 0.98
    assert.strictEqual(agg.speedByTwa[0], 0.98);
    // band 2: (1 + 0.06) * (1 + 0.03) = 1.0918
    assert.strictEqual(
      Math.round(agg.speedByTwa[2] * 1e6) / 1e6,
      Math.round(1.0918 * 1e6) / 1e6,
    );
  });

  test('3 — wearMul stacks multiplicatively across items', () => {
    // foils-like: rig 1.8, hull 1.3
    const foilsItem: UpgradeItem = {
      ...neutralItem('foils'),
      slot: 'FOILS',
      effects: {
        ...neutralItem('foils').effects,
        wearMul: { rig: 1.8, hull: 1.3 },
      },
    };
    // reinforcement-like: hull 0.45
    const reinItem: UpgradeItem = {
      ...neutralItem('rein'),
      slot: 'REINFORCEMENT',
      effects: {
        ...neutralItem('rein').effects,
        wearMul: { hull: 0.45 },
      },
    };

    const agg = aggregateEffects([foilsItem, reinItem]);

    assert.strictEqual(agg.wearMul.rig, 1.8);
    assert.strictEqual(Math.round(agg.wearMul.hull * 1e10) / 1e10, 0.585);
    assert.strictEqual(agg.wearMul.sail, 1);
    assert.strictEqual(agg.wearMul.elec, 1);
  });

  test('4 — polarTargetsDeg = min of non-null values (ignores nulls)', () => {
    const mkItem = (polar: number | null): UpgradeItem => ({
      ...neutralItem('x'),
      effects: { ...neutralItem('x').effects, polarTargetsDeg: polar },
    });

    const agg = aggregateEffects([mkItem(null), mkItem(2), mkItem(1)]);
    assert.strictEqual(agg.polarTargetsDeg, 1);
  });

  test('5 — groundingLossMul = product of non-null values', () => {
    const mkItem = (g: number | null): UpgradeItem => ({
      ...neutralItem('x'),
      effects: { ...neutralItem('x').effects, groundingLossMul: g },
    });

    const agg = aggregateEffects([mkItem(0.5), mkItem(0.8)]);
    assert.strictEqual(Math.round(agg.groundingLossMul * 1e10) / 1e10, 0.4);
  });

  test('6 — activation filter: inactive item does not contribute', () => {
    // foils-class40-s: activation.minTws=14, speedByTwa[3]=0.14
    const foilsItem: UpgradeItem = {
      ...neutralItem('foils-s'),
      slot: 'FOILS',
      effects: {
        ...neutralItem('foils-s').effects,
        speedByTwa: [-0.04, -0.02, 0.08, 0.14, 0.05],
        activation: { minTws: 14 },
      },
    };

    // At tws=10 → item inactive → band 3 = 1.0
    const aggLow = aggregateEffects([foilsItem], { tws: 10 });
    assert.strictEqual(aggLow.speedByTwa[3], 1.0);

    // At tws=16 → item active → band 3 = 1.14
    const aggHigh = aggregateEffects([foilsItem], { tws: 16 });
    assert.strictEqual(Math.round(aggHigh.speedByTwa[3] * 1e10) / 1e10, 1.14);
  });

  test('7 — maneuverMul multiplication (tack.dur + sailChange.dur)', () => {
    // carbon-hm-like: tack.dur=0.85
    const mastItem: UpgradeItem = {
      ...neutralItem('mast'),
      slot: 'MAST',
      effects: {
        ...neutralItem('mast').effects,
        maneuverMul: { tack: { dur: 0.85, speed: 1.1 } },
      },
    };
    // electronics-offshore-like: sailChange.dur=0.75
    const elecItem: UpgradeItem = {
      ...neutralItem('elec'),
      slot: 'ELECTRONICS',
      effects: {
        ...neutralItem('elec').effects,
        maneuverMul: { sailChange: { dur: 0.75, speed: 1.1 } },
      },
    };

    const agg = aggregateEffects([mastItem, elecItem]);

    assert.strictEqual(agg.maneuverMul.tack.dur, 0.85);
    assert.strictEqual(agg.maneuverMul.sailChange.dur, 0.75);
    assert.strictEqual(agg.maneuverMul.gybe.dur, 1.0); // untouched
  });

  test('aggregateEffects — empty items returns all-neutral', () => {
    const agg = aggregateEffects([]);
    assert.deepStrictEqual(agg.speedByTwa, [1, 1, 1, 1, 1]);
    assert.deepStrictEqual(agg.speedByTws, [1, 1, 1]);
    assert.equal(agg.polarTargetsDeg, 0);
    assert.equal(agg.groundingLossMul, 1);
  });
});

// ---------------------------------------------------------------------------
// Group 2: resolveBoatLoadout (needs GameBalance loaded from disk)
// ---------------------------------------------------------------------------

describe('resolveBoatLoadout', () => {

  before(async () => {
    await GameBalance.loadFromDisk();
  });

  test('8 — empty installed → all slots filled with SERIE items (CLASS40)', () => {
    const loadout = resolveBoatLoadout('p1', [], 'CLASS40');

    // CLASS40 has all 7 slots open
    assert.strictEqual(loadout.bySlot.size, 7);
    assert.strictEqual(loadout.items.length, 7);
    assert.strictEqual(loadout.participantId, 'p1');

    for (const item of loadout.items) {
      assert.strictEqual(item.tier, 'SERIE', `Expected SERIE for ${item.id} but got ${item.tier}`);
    }
  });

  test('9 — absent slot skipped (OCEAN_FIFTY: KEEL absent)', () => {
    const loadout = resolveBoatLoadout('p2', [], 'OCEAN_FIFTY');

    // OCEAN_FIFTY: KEEL=absent → 6 slots
    assert.strictEqual(loadout.bySlot.has('KEEL'), false);
    assert.strictEqual(loadout.bySlot.size, 6);
  });

  test('10 — installed item overrides Série for its slot (FOILS for CLASS40)', () => {
    // Get the foils-class40-c item from the catalog
    const foilsC = GameBalance.upgrades.items.find(i => i.id === 'foils-class40-c');
    if (!foilsC) throw new Error('foils-class40-c not found in catalog');

    const loadout = resolveBoatLoadout('p3', [foilsC], 'CLASS40');

    // FOILS slot should have the installed item
    assert.strictEqual(loadout.bySlot.get('FOILS')?.id, 'foils-class40-c');

    // All other slots should be SERIE
    for (const [slot, item] of loadout.bySlot) {
      if (slot !== 'FOILS') {
        assert.strictEqual(
          item.tier,
          'SERIE',
          `Expected SERIE for slot ${slot} but got ${item.tier} (${item.id})`,
        );
      }
    }

    // Total slots: 7 (CLASS40 has all 7)
    assert.strictEqual(loadout.bySlot.size, 7);
  });
});
