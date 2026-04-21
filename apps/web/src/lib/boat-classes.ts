import { BOAT_CLASSES } from '@nemo/shared-types';
import type { BoatClass } from '@nemo/shared-types';

/**
 * Display labels for every boat class. Adding a new class to BoatClass
 * forces a typecheck error here until the label is provided.
 */
export const CLASS_LABEL: Record<BoatClass, string> = {
  CRUISER_RACER: 'Cruiser Racer',
  MINI650: 'Mini 6.50',
  FIGARO: 'Figaro III',
  CLASS40: 'Class40',
  OCEAN_FIFTY: 'Ocean Fifty',
  IMOCA60: 'IMOCA 60',
  ULTIM: 'Ultim',
};

/**
 * Canonical iteration order of boat classes (entry-level → maxi).
 * Derived from the BOAT_CLASSES tuple in shared-types so both stay in sync.
 *
 * Use this as the canonical list of available classes everywhere — marina,
 * race filters, public profiles. Whether a given class has upgradable slots
 * is a game-balance concern; the UI shows every class regardless.
 */
export const BOAT_CLASS_ORDER: readonly BoatClass[] = BOAT_CLASSES;
