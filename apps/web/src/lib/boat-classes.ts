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
 */
export const BOAT_CLASS_ORDER: readonly BoatClass[] = BOAT_CLASSES;

/**
 * Boat classes that have at least one upgradable slot in the marina.
 * Derived (not hardcoded) so a future boat class with all slots = "absent"
 * is automatically excluded.
 *
 * NOTE: Called from server code or tests that have GameBalance loaded.
 * Cannot be called at module-init on the web side because game-balance is
 * fetched asynchronously at runtime (see projection.worker.ts).
 * Use MARINA_BOAT_CLASSES for module-init filter UIs instead.
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
 * Marina-eligible boat classes.
 *
 * Static constant rather than `getMarinaBoatClasses(...)` because game-balance
 * is loaded async on the web side and we need this at module-init for filter UIs.
 *
 * INVARIANT (manually maintained): a boat class belongs here iff its
 * upgrades.slotsByClass.<class> entry has at least one slot != "absent".
 *
 * When adding a new boat class:
 *   - If all its slots are "absent" in game-balance.json, do NOT add here.
 *   - Otherwise, add it AND update upgrades.slotsByClass in game-balance.json.
 *
 * The `getMarinaBoatClasses` helper above performs the same derivation at
 * runtime — call it from server code or tests that have GameBalance loaded.
 */
export const MARINA_BOAT_CLASSES: readonly BoatClass[] = [
  'MINI650',
  'FIGARO',
  'CLASS40',
  'OCEAN_FIFTY',
  'IMOCA60',
  'ULTIM',
];
