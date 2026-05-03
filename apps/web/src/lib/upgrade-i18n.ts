'use client';
/**
 * Helpers d'internationalisation pour les noms d'upgrades.
 *
 * Les upgrades viennent de game-balance.json côté backend et portent leur
 * nom FR dans le champ `name`. Pour basculer dynamiquement, on indexe les
 * traductions par l'`id` (qui est un code stable, ex. "hull-class40-scow")
 * sous le namespace `marina.upgradeNames.*`.
 *
 * Le hook fait du fallback gracieux : si la clé n'existe pas (nouvel upgrade
 * ajouté à game-balance.json sans traduction), on retombe sur `item.name`
 * comme avant. Ça évite de casser l'UI si la sync messages prend du retard
 * sur les évolutions du game-balance.
 */

import { useTranslations } from 'next-intl';

export interface NamedUpgrade {
  id: string;
  name: string;
}

/** Hook React : renvoie une fonction `(item) => string traduit`. */
export function useUpgradeLabel(): (item: NamedUpgrade) => string {
  const t = useTranslations('marina.upgradeNames');
  return (item) => {
    try {
      return t(item.id);
    } catch {
      // clé manquante → fallback sur le nom FR du game-balance
      return item.name;
    }
  };
}

/**
 * Hook React : renvoie une fonction `(profile) => string traduit`.
 * Le `profile` est une phrase courte FR du game-balance ("rendement gros
 * temps", "régate ultime", etc.) qui sert de tagline d'upgrade. Indexé
 * par la string FR brute pour conserver le lien direct entre game-balance
 * et messages — si la string change côté JSON, on voit immédiatement la
 * désync via le fallback.
 */
export function useUpgradeProfile(): (profile: string) => string {
  const t = useTranslations('marina.upgradeProfiles');
  return (profile) => {
    if (!profile) return profile;
    try {
      return t(profile);
    } catch {
      return profile;
    }
  };
}
