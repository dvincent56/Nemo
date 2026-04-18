/**
 * Browser-safe entry point for @nemo/game-balance.
 * Same API as index.ts but without node:fs/node:path imports.
 * Use GameBalance.load(json) to initialize from fetched JSON.
 */
import type { BoatClass, SailId } from '@nemo/shared-types';
import {
  UpgradesBlockZ, CompletionBonusZ, type UpgradesBlock, type UpgradeItem,
  type UpgradeSlot, type UpgradeTier, type SlotAvailability,
} from './upgrade-catalog.schema.js';
export type { UpgradesBlock, UpgradeItem, UpgradeSlot, UpgradeTier, SlotAvailability };

// Re-export all config interfaces from the main module
export type {
  GameBalanceConfig,
  WearConfig,
  SwellConfig,
  SailsConfig,
  RewardsConfig,
  MaintenanceEntry,
  ManeuversConfig,
  GroundingConfig,
  EconomyConfig,
} from './index.js';

import type { GameBalanceConfig, WearConfig, SwellConfig, SailsConfig, RewardsConfig, ManeuversConfig, GroundingConfig, EconomyConfig } from './index.js';

class GameBalanceClass {
  private data: GameBalanceConfig | null = null;

  load(raw: unknown): void {
    const parsed = raw as Record<string, unknown>;
    UpgradesBlockZ.parse(parsed.upgrades);
    if (!parsed.economy || typeof parsed.economy !== 'object') {
      throw new Error('game-balance: missing or invalid economy block');
    }
    CompletionBonusZ.parse((parsed.economy as Record<string, unknown>).completionBonus);
    this.data = raw as GameBalanceConfig;
  }

  get isLoaded(): boolean { return this.data !== null; }

  private ensure(): GameBalanceConfig {
    if (!this.data) {
      throw new Error('GameBalance not loaded. Call load() before use.');
    }
    return this.data;
  }

  get version(): string { return this.ensure().version; }
  get wear(): WearConfig { return this.ensure().wear; }
  get swell(): SwellConfig { return this.ensure().swell; }
  get sails(): SailsConfig { return this.ensure().sails; }
  get rewards(): RewardsConfig { return this.ensure().rewards; }
  get maintenance() { return this.ensure().maintenance; }
  get upgrades(): UpgradesBlock { return this.ensure().upgrades; }
  get maneuvers(): ManeuversConfig { return this.ensure().maneuvers; }
  get grounding(): GroundingConfig { return this.ensure().grounding; }
  get zones() { return this.ensure().zones; }
  get economy(): EconomyConfig { return this.ensure().economy; }
  get tickIntervalSeconds(): number { return this.ensure().tick.intervalSeconds; }
}

export const GameBalance = new GameBalanceClass();
