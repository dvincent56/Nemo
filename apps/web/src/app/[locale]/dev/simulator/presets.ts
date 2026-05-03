// Ready-made boat setups for quick comparisons in the dev simulator.
// Each preset picks a small subset of upgrades from the catalog to surface
// a clear performance profile (e.g. light-air specialist vs heavy-wind
// foiler). The helper expects GameBalance to be loaded.

import { resolveBoatLoadout } from '@nemo/game-engine-core/browser';
import { GameBalance } from '@nemo/game-balance/browser';
import type { UpgradeItem } from '@nemo/game-balance/browser';
import type { BoatClass, SailId } from '@nemo/shared-types';
import type { SimBoatSetup } from '@/lib/simulator/types';

export interface Preset {
  id: string;
  name: string;
  boatClass: BoatClass;
  description: string;
  initialSail: SailId;
  upgradeIds: string[];   // items selected from GameBalance.upgrades.items
}

export const PRESETS: Preset[] = [
  {
    id: 'class40-light-air',
    name: 'Class40 Petit Temps',
    boatClass: 'CLASS40',
    description: 'Coque déplacement + voiles petit temps — rapide au près sous 10 kts.',
    initialSail: 'JIB',
    upgradeIds: ['hull-class40-displacement', 'sails-class40-light-air'],
  },
  {
    id: 'class40-foiler',
    name: 'Class40 Foiler Fort Temps',
    boatClass: 'CLASS40',
    description: 'Foils proto + scow + mylar — fusée au-delà de 14 kts, largement battu sous 10 kts.',
    initialSail: 'JIB',
    upgradeIds: ['hull-class40-scow', 'sails-class40-mylar', 'foils-class40-proto', 'keel-class40-canting'],
  },
  {
    id: 'imoca60-light-air',
    name: 'IMOCA60 Non-foiler Petit Temps',
    boatClass: 'IMOCA60',
    description: 'Carène archimédienne + voilerie petit temps — performe quand les foilers décrochent.',
    initialSail: 'JIB',
    upgradeIds: ['hull-imoca60-light-air', 'sails-imoca60-light-air'],
  },
  {
    id: 'imoca60-foiler',
    name: 'IMOCA60 Foiler Proto',
    boatClass: 'IMOCA60',
    description: 'Foils proto grande envergure + voiles polyvalentes light-air — fusée au reaching et au portant dès 10 kts.',
    initialSail: 'JIB',
    upgradeIds: ['foils-imoca60-proto', 'sails-imoca60-light-air'],
  },
];

export function buildPresetBoat(preset: Preset, boatId: string): SimBoatSetup {
  const allItems = GameBalance.upgrades.items as UpgradeItem[];
  const byId = new Map(allItems.map((it) => [it.id, it]));

  const installed = preset.upgradeIds
    .map((id) => byId.get(id))
    .filter((it): it is UpgradeItem => Boolean(it));

  return {
    id: boatId,
    name: preset.name,
    boatClass: preset.boatClass,
    loadout: resolveBoatLoadout(boatId, installed, preset.boatClass),
    initialSail: preset.initialSail,
    initialCondition: { hull: 100, rig: 100, sails: 100, electronics: 100 },
  };
}
