// Node entry for @nemo/game-balance. Re-exports the browser-safe singleton
// and adds a disk loader for server-side consumers. Both entries share the
// SAME GameBalance instance — calling loadFromDisk() in the server also
// satisfies any import of '@nemo/game-balance/browser' elsewhere in the
// process (e.g. in @nemo/game-engine-core).

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GameBalance as BrowserGameBalance } from './browser';

export * from './browser';

const __dirname = dirname(fileURLToPath(import.meta.url));

class GameBalanceNode {
  async loadFromDisk(): Promise<void> {
    const path = join(__dirname, '..', 'game-balance.json');
    const raw = await readFile(path, 'utf8');
    BrowserGameBalance.load(JSON.parse(raw));
  }
  load(raw: unknown): void { BrowserGameBalance.load(raw); }
  get isLoaded(): boolean { return BrowserGameBalance.isLoaded; }
  get version() { return BrowserGameBalance.version; }
  get wear() { return BrowserGameBalance.wear; }
  get swell() { return BrowserGameBalance.swell; }
  get sails() { return BrowserGameBalance.sails; }
  get rewards() { return BrowserGameBalance.rewards; }
  get maintenance() { return BrowserGameBalance.maintenance; }
  get upgrades() { return BrowserGameBalance.upgrades; }
  get maneuvers() { return BrowserGameBalance.maneuvers; }
  get grounding() { return BrowserGameBalance.grounding; }
  get zones() { return BrowserGameBalance.zones; }
  get economy() { return BrowserGameBalance.economy; }
  get tickIntervalSeconds() { return BrowserGameBalance.tickIntervalSeconds; }
}

export const GameBalance = new GameBalanceNode();
