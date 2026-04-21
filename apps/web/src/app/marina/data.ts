/**
 * Marina — types partagés par les pages /marina et /marina/[boatId].
 * Toutes les données viennent de l'API (voir @/lib/marina-api).
 */
import type { BoatRecord, InstalledUpgrade, UpgradeSlot, UpgradeTier, BoatClass } from '@/lib/marina-api';
export type { BoatRecord, InstalledUpgrade, UpgradeSlot, UpgradeTier, BoatClass };

export { CLASS_LABEL } from '@/lib/boat-classes';

export const SLOT_LABEL: Record<UpgradeSlot, string> = {
  HULL: 'Coque',
  MAST: 'Mât',
  SAILS: 'Voiles',
  FOILS: 'Foils',
  KEEL: 'Quille',
  ELECTRONICS: 'Électronique',
  REINFORCEMENT: 'Renfort',
};

export const TIER_LABEL: Record<UpgradeTier, string> = {
  SERIE: 'Série',
  BRONZE: 'Bronze',
  SILVER: 'Silver',
  GOLD: 'Gold',
  PROTO: 'Proto',
};

export { MARINA_BOAT_CLASSES as ALL_CLASSES } from '@/lib/boat-classes';
export const MAX_BOATS_PER_CLASS = 5;

/** Sous-ensemble de BoatRecord utilisé par la page /customize. */
export interface BoatDetail {
  id: string;
  boatClass: BoatClass;
  name: string;
  hullNumber: string;
  hullColor: string;
  deckColor: string;
}

/** Entrée d'historique — en attente d'un endpoint dédié. */
export interface BoatRaceHistoryEntry {
  raceId: string;
  raceName: string;
  raceBoatClass: string;
  raceDate: string;
  finalRank: number;
  raceDistanceNm: number;
  durationLabel: string;
  creditsEarned: number;
}
