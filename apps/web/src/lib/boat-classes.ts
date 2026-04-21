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
 * Use this for any UI list/filter that wants the standard progression.
 */
export const BOAT_CLASS_ORDER: readonly BoatClass[] = [
  'CRUISER_RACER',
  'MINI650',
  'FIGARO',
  'CLASS40',
  'OCEAN_FIFTY',
  'IMOCA60',
  'ULTIM',
];

/**
 * Boat classes that have at least one upgradable slot in the marina.
 * Derived (not hardcoded) so a future boat class with all slots = "absent"
 * is automatically excluded.
 */
export function getMarinaBoatClasses(
  slotsByClass: Record<BoatClass, Record<string, string>>,
): BoatClass[] {
  return BOAT_CLASS_ORDER.filter((cls) => {
    const slots = slotsByClass[cls];
    if (!slots) return false;
    return Object.values(slots).some((availability) => availability !== 'absent');
  });
}

/**
 * Boat classes available in the marina (have at least one non-absent upgrade slot).
 * Derived from the current game-balance.json slotsByClass:
 *   CRUISER_RACER is excluded because all its slots are "absent".
 * Review this constant when adding a new boat class to the game.
 */
export const MARINA_BOAT_CLASSES: readonly BoatClass[] = [
  'MINI650',
  'FIGARO',
  'CLASS40',
  'OCEAN_FIFTY',
  'IMOCA60',
  'ULTIM',
];
