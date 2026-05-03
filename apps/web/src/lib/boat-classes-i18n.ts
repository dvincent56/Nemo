import { useTranslations } from 'next-intl';
import type { BoatClass } from '@nemo/shared-types';

/**
 * Mapping BoatClass enum → clé de traduction sous `common.boats.*`.
 *
 * Ajouter une classe à BoatClass force un typecheck error ici tant que
 * la clé n'est pas fournie (Record<BoatClass, ...>).
 */
const BOAT_CLASS_KEY: Record<BoatClass, string> = {
  CRUISER_RACER: 'cruiserRacer',
  MINI650: 'miniSix50',
  FIGARO: 'figaro3',
  CLASS40: 'class40',
  OCEAN_FIFTY: 'oceanFifty',
  IMOCA60: 'imoca60',
  ULTIM: 'ultim',
};

/**
 * Hook React qui retourne un getter `(cls: BoatClass) => string` traduisant
 * vers le label affichable de la classe sous la locale active.
 *
 * Usage côté composant :
 *   const boatLabel = useBoatLabel();
 *   <h1>{boatLabel('FIGARO')}</h1>     // → "Figaro III" en fr
 *
 * Pour les server components qui n'ont pas accès à useTranslations, importer
 * `getBoatLabel` (variante async basée sur getTranslations).
 */
export function useBoatLabel(): (cls: BoatClass) => string {
  const t = useTranslations('common.boats');
  return (cls) => t(BOAT_CLASS_KEY[cls]);
}

/** Variante server-component (async). */
export async function getBoatLabel(): Promise<(cls: BoatClass) => string> {
  const { getTranslations } = await import('next-intl/server');
  const t = await getTranslations('common.boats');
  return (cls) => t(BOAT_CLASS_KEY[cls]);
}
