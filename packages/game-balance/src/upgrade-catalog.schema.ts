import { z } from 'zod';
import { BOAT_CLASSES } from '@nemo/shared-types';

export const UpgradeSlotZ = z.enum([
  'HULL', 'MAST', 'SAILS', 'FOILS', 'KEEL', 'ELECTRONICS', 'REINFORCEMENT',
]);

export const UpgradeTierZ = z.enum(['SERIE', 'BRONZE', 'SILVER', 'GOLD', 'PROTO']);

export const BoatClassZ = z.enum(BOAT_CLASSES);

export const SlotAvailabilityZ = z.enum(['open', 'monotype', 'absent']);

// Passive effects are always applied regardless of activation window.
// Use this to model constraints like foil drag that exists whether the
// foil is lifting or not (applies even below minTws).
export const PassiveEffectsZ = z.object({
  speedByTwa: z.tuple([z.number(), z.number(), z.number(), z.number(), z.number()]).optional(),
  speedByTws: z.tuple([z.number(), z.number(), z.number()]).optional(),
  wearMul: z.object({
    hull: z.number().optional(),
    rig: z.number().optional(),
    sail: z.number().optional(),
    elec: z.number().optional(),
  }).optional(),
});

// speedByTwa and speedByTws are required in JSON (core mechanics).
// wearMul, maneuverMul, activation default to {} if omitted (= no effect for that dimension).
// `passiveEffects` is an optional companion block applied regardless of activation.
export const UpgradeEffectsZ = z.object({
  speedByTwa: z.tuple([z.number(), z.number(), z.number(), z.number(), z.number()]),
  speedByTws: z.tuple([z.number(), z.number(), z.number()]),
  wearMul: z.object({
    hull: z.number().optional(),
    rig: z.number().optional(),
    sail: z.number().optional(),
    elec: z.number().optional(),
  }).optional().default({}),
  maneuverMul: z.object({
    tack: z.object({ dur: z.number(), speed: z.number() }).optional(),
    gybe: z.object({ dur: z.number(), speed: z.number() }).optional(),
    sailChange: z.object({ dur: z.number(), speed: z.number() }).optional(),
  }).optional().default({}),
  polarTargetsDeg: z.number().nullable().default(null),
  activation: z.object({
    minTws: z.number().optional(),
    maxTws: z.number().optional(),
  }).optional().default({}),
  groundingLossMul: z.number().nullable().default(null),
  passiveEffects: PassiveEffectsZ.optional(),
});

export const UnlockCriteriaZ = z.object({
  racesFinished: z.number().optional(),
  avgRankPctMax: z.number().optional(),
  top10Finishes: z.number().optional(),
  currentStreak: z.number().optional(),
  or: z.boolean().default(false),
});

export const UpgradeItemZ = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  slot: UpgradeSlotZ,
  tier: UpgradeTierZ,
  name: z.string(),
  profile: z.string(),
  description: z.string(),
  compat: z.array(BoatClassZ).min(1),
  cost: z.number().nullable(),
  effects: UpgradeEffectsZ,
  unlockCriteria: UnlockCriteriaZ.optional(),
});

export const TierConfigZ = z.object({
  priceRange: z.tuple([z.number(), z.number()]).nullable(),
  maintenanceMul: z.number(),
});

export const UpgradesBlockZ = z.object({
  slots: z.array(UpgradeSlotZ),
  tiers: z.record(UpgradeTierZ, TierConfigZ),
  slotsByClass: z.record(BoatClassZ, z.record(UpgradeSlotZ, SlotAvailabilityZ)),
  items: z.array(UpgradeItemZ),
});

export const CompletionBonusZ = z.record(BoatClassZ, z.number());

export type UpgradeSlot = z.infer<typeof UpgradeSlotZ>;
export type UpgradeTier = z.infer<typeof UpgradeTierZ>;
export type SlotAvailability = z.infer<typeof SlotAvailabilityZ>;
export type UpgradeEffects = z.infer<typeof UpgradeEffectsZ>;
export type PassiveEffects = z.infer<typeof PassiveEffectsZ>;
export type UpgradeItem = z.infer<typeof UpgradeItemZ>;
export type UpgradesBlock = z.infer<typeof UpgradesBlockZ>;
