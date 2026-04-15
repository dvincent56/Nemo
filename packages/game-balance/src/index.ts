import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BoatClass, DriveMode, SailId } from '@nemo/shared-types';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface GameBalanceConfig {
  version: string;
  updatedAt: string;
  updatedBy: string;
  wear: WearConfig;
  swell: SwellConfig;
  sails: SailsConfig;
  rewards: RewardsConfig;
  maintenance: Record<'hull' | 'rig' | 'sails' | 'electronics', MaintenanceEntry>;
  upgrades: UpgradesConfig;
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
  driveModeMultipliers: Record<DriveMode, number>;
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

export interface UpgradesConfig {
  AUTO_SAIL: { cost: number; description: string };
  FOILS: {
    cost: number;
    description: string;
    speedByTWA: Record<string, number>;
    activeMinTWS: number;
    wearRigMultiplier: number;
    wearHullMultiplier: number;
  };
  CARBON_RIG: {
    cost: number;
    speedAllPct: number;
    speedLightAirBonus: number;
    wearRigHeavyMultiplier: number;
    heavyTwsThresholdKts: number;
  };
  KEVLAR_SAILS: { cost: number; speedAllPct: number; wearSailMultiplier: number };
  REINFORCED_HULL: { cost: number; speedAllPct: number; wearHullMultiplier: number };
  HEAVY_WEATHER_KIT: {
    cost: number;
    speedLightAirPct: number;
    speedHeavyAirBonus: number;
    activeThresholdTWS: number;
    wearRigSailMultiplier: number;
  };
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
}

class GameBalanceClass {
  private data: GameBalanceConfig | null = null;

  async loadFromDisk(): Promise<void> {
    const path = join(__dirname, '..', 'game-balance.json');
    const raw = await readFile(path, 'utf8');
    this.data = JSON.parse(raw) as GameBalanceConfig;
  }

  load(raw: unknown): void {
    this.data = raw as GameBalanceConfig;
  }

  private ensure(): GameBalanceConfig {
    if (!this.data) {
      throw new Error('GameBalance not loaded. Call loadFromDisk() or load() before use.');
    }
    return this.data;
  }

  get version(): string { return this.ensure().version; }
  get wear(): WearConfig { return this.ensure().wear; }
  get swell(): SwellConfig { return this.ensure().swell; }
  get sails(): SailsConfig { return this.ensure().sails; }
  get rewards(): RewardsConfig { return this.ensure().rewards; }
  get maintenance() { return this.ensure().maintenance; }
  get upgrades(): UpgradesConfig { return this.ensure().upgrades; }
  get maneuvers(): ManeuversConfig { return this.ensure().maneuvers; }
  get grounding(): GroundingConfig { return this.ensure().grounding; }
  get zones() { return this.ensure().zones; }
  get economy(): EconomyConfig { return this.ensure().economy; }
  get tickIntervalSeconds(): number { return this.ensure().tick.intervalSeconds; }
}

export const GameBalance = new GameBalanceClass();
