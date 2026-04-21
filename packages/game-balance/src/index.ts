import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  UpgradesBlockZ, CompletionBonusZ, BoatClassZ, type UpgradesBlock, type UpgradeItem,
  type UpgradeSlot, type UpgradeTier, type SlotAvailability,
} from './upgrade-catalog.schema.js';
export type { UpgradesBlock, UpgradeItem, UpgradeSlot, UpgradeTier, SlotAvailability };
export { BoatClassZ };
export type {
  GameBalanceConfig, WearConfig, SwellConfig, SailsConfig,
  RewardsConfig, MaintenanceEntry, ManeuversConfig,
  GroundingConfig, EconomyConfig,
} from './types.js';

import type {
  GameBalanceConfig, WearConfig, SwellConfig, SailsConfig,
  RewardsConfig, ManeuversConfig, GroundingConfig, EconomyConfig,
} from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

class GameBalanceClass {
  private data: GameBalanceConfig | null = null;

  async loadFromDisk(): Promise<void> {
    const path = join(__dirname, '..', 'game-balance.json');
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw);
    UpgradesBlockZ.parse(parsed.upgrades);
    if (!parsed.economy || typeof parsed.economy !== 'object') {
      throw new Error('game-balance.json: missing or invalid economy block');
    }
    CompletionBonusZ.parse(parsed.economy.completionBonus);
    this.data = parsed as GameBalanceConfig;
  }

  load(raw: unknown): void {
    const parsed = raw as Record<string, unknown>;
    UpgradesBlockZ.parse(parsed.upgrades);
    if (!parsed.economy || typeof parsed.economy !== 'object') {
      throw new Error('game-balance: missing or invalid economy block');
    }
    CompletionBonusZ.parse((parsed.economy as Record<string, unknown>).completionBonus);
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
  get upgrades(): UpgradesBlock { return this.ensure().upgrades; }
  get maneuvers(): ManeuversConfig { return this.ensure().maneuvers; }
  get grounding(): GroundingConfig { return this.ensure().grounding; }
  get zones() { return this.ensure().zones; }
  get economy(): EconomyConfig { return this.ensure().economy; }
  get tickIntervalSeconds(): number { return this.ensure().tick.intervalSeconds; }
}

export const GameBalance = new GameBalanceClass();
