/**
 * Shared config interfaces for @nemo/game-balance.
 * Imported by both index.ts (Node) and browser.ts (browser-safe).
 */
import type { BoatClass, SailId } from '@nemo/shared-types';

export interface GameBalanceConfig {
  version: string;
  updatedAt: string;
  updatedBy: string;
  wear: WearConfig;
  swell: SwellConfig;
  sails: SailsConfig;
  rewards: RewardsConfig;
  maintenance: Record<'hull' | 'rig' | 'sails' | 'electronics', MaintenanceEntry>;
  upgrades: import('./upgrade-catalog.schema.js').UpgradesBlock;
  maneuvers: ManeuversConfig;
  grounding: GroundingConfig;
  zones: { warnDefaultMultiplier: number; penaltyDefaultMultiplier: number };
  economy: EconomyConfig;
  tick: { intervalSeconds: number };
}

export interface WearConfig {
  minCondition: number;
  maxSpeedPenalty: number;
  penaltyCurve: { thresholdNone: number; thresholdMax: number; slopePerPoint: number };
  baseRatesPerHour: Record<'hull' | 'rig' | 'sails' | 'electronics', number>;
  windMultipliers: { thresholdKnots: number; maxFactor: number; scaleKnots: number };
  swellMultipliers: {
    thresholdMeters: number;
    maxHeightMeters: number;
    dirFaceMax: number;
    dirBackMin: number;
    shortPeriodFactor: number;
    shortPeriodThreshold: number;
  };
  upgradeMultipliers: Record<string, number>;
}

export interface SwellConfig {
  thresholdMeters: number;
  maxSpeedBonus: number;
  maxSpeedMalus: number;
  sideMaxMalus: number;
  frontAngle: number;
  backAngle: number;
}

export interface SailsConfig {
  transitionPenalty: number;
  transitionTimes: Record<string, number>;
  overlapDegrees: Record<SailId, number>;
  definitions: Record<SailId, { twaMin: number; twaMax: number }>;
}

export interface RewardsConfig {
  distanceRates: Record<BoatClass, number>;
  rankMultipliers: { threshold: number; multiplier: number }[];
  sponsorVisibilityRatio: number;
  leaderBonusRatio: number;
  streakBonus: number;
  streakMax: number;
}

export interface MaintenanceEntry {
  costPer10pts: number;
  durationHours: number;
}

export interface ManeuversConfig {
  sailChange: {
    transitionSpeedFactor: number;
    transitionTimeSec: Record<BoatClass, number>;
  };
  tack: {
    speedFactor: number;
    durationSec: Record<BoatClass, number>;
  };
  gybe: {
    speedFactor: number;
    durationSec: Record<BoatClass, number>;
  };
}

export interface GroundingConfig {
  basePenaltySeconds: number;
  speedFactorMax: number;
  conditionLossMin: number;
  conditionLossMax: number;
  detectionIntermediatePoints: number;
  forcedTurnAroundBspKnots: number;
}

export interface EconomyConfig {
  startingCredits: number;
  buybackUpgradePct: number;
  palmaresBonus: { win: number; podium: number; top10: number };
  completionBonus: Record<BoatClass, number>;
}
