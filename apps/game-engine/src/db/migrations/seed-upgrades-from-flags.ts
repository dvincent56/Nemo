/**
 * Migration one-shot — convertit les anciens flags d'upgrade des bateaux
 * existants en rows player_upgrades + boat_installed_upgrades.
 *
 * En Phase 3 (état actuel), il n'y a pas de flags persistés en DB :
 * l'ancien Set<string> d'upgrades vivait uniquement en runtime.
 * Ce script existe pour documenter le mapping et servir de base
 * si une future migration depuis un dump legacy est nécessaire.
 *
 * Usage : tsx src/db/migrations/seed-upgrades-from-flags.ts
 */

import type { UpgradeSlot } from '@nemo/game-balance';

const FLAG_TO_ITEM: Record<string, { slot: UpgradeSlot; itemByClass: Record<string, string> }> = {
  FOILS:             { slot: 'FOILS',         itemByClass: { CLASS40: 'foils-class40-c', IMOCA60: 'foils-imoca60-standard', OCEAN_FIFTY: 'foils-ocean-fifty-inbuilt', ULTIM: 'foils-ultim-standard' } },
  CARBON_RIG:        { slot: 'MAST',          itemByClass: { CLASS40: 'mast-class40-carbon', IMOCA60: 'mast-imoca60-standard' } },
  KEVLAR_SAILS:      { slot: 'SAILS',         itemByClass: { CLASS40: 'sails-class40-mylar', IMOCA60: 'sails-imoca60-standard' } },
  REINFORCED_HULL:   { slot: 'REINFORCEMENT', itemByClass: { FIGARO: 'reinforcement-pro', CLASS40: 'reinforcement-pro', OCEAN_FIFTY: 'reinforcement-pro', IMOCA60: 'reinforcement-pro', ULTIM: 'reinforcement-pro' } },
  HEAVY_WEATHER_KIT: { slot: 'REINFORCEMENT', itemByClass: { FIGARO: 'reinforcement-heavy-weather', CLASS40: 'reinforcement-heavy-weather', OCEAN_FIFTY: 'reinforcement-heavy-weather', IMOCA60: 'reinforcement-heavy-weather', ULTIM: 'reinforcement-heavy-weather' } },
  AUTO_SAIL:         { slot: 'ELECTRONICS',   itemByClass: { FIGARO: 'electronics-pack-race', CLASS40: 'electronics-pack-race', OCEAN_FIFTY: 'electronics-pack-race', IMOCA60: 'electronics-pack-race', ULTIM: 'electronics-pack-race' } },
};

async function main(): Promise<void> {
  console.log('Flag-to-item mapping (for reference):');
  for (const [flag, mapping] of Object.entries(FLAG_TO_ITEM)) {
    console.log(`  ${flag} → slot ${mapping.slot}, items: ${JSON.stringify(mapping.itemByClass)}`);
  }
  console.log('\nNo legacy flags stored in DB (Phase 3 — runtime-only flags).');
  console.log('Migration script exists for documentation and future use.');
  console.log('Done.');
}

main().catch((e) => { console.error(e); process.exit(1); });
