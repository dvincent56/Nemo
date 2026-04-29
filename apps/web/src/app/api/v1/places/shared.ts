/**
 * Utilitaires partagés par les 3 route handlers /api/v1/places/*.
 *
 * Les données restent côté serveur (package `@etalab/decoupage-administratif`
 * ~12 MB, `country-state-city` ~3 MB) — le client reçoit uniquement les DTO
 * JSON légers via fetch.
 *
 * Stratégie France vs autres pays :
 *  - FR → source autorité INSEE via Etalab (département + communes avec pop.)
 *  - autres → subdivisions ISO 3166-2 via country-state-city
 */

import departementsRaw from '@etalab/decoupage-administratif/data/departements.json';
import communesRaw from '@etalab/decoupage-administratif/data/communes.json';

interface EtalabDepartement {
  code: string;
  region: string;
  nom: string;
  zone: string;
}

interface EtalabCommune {
  code: string;
  nom: string;
  departement?: string;
  population?: number;
  type: string;
}

export const FR_DEPARTEMENTS: ReadonlyArray<EtalabDepartement> = departementsRaw as EtalabDepartement[];
export const FR_COMMUNES: ReadonlyArray<EtalabCommune> = communesRaw as EtalabCommune[];

/** Normalise un code pays : codes historiques (UK) → ISO 3166-1 (GB). */
const ISO_ALIASES: Record<string, string> = { UK: 'GB' };
export function normalizeCountry(code: string): string {
  const upper = code.toUpperCase();
  return ISO_ALIASES[upper] ?? upper;
}

/** DTO d'un pays renvoyé par /api/v1/places/countries. */
export interface CountryDto {
  /** ISO 3166-1 alpha-2 upper-case. */
  code: string;
  /** Nom du pays (langue du navigateur côté front, ici simple anglais). */
  name: string;
  /** Émoji drapeau unicode — utile pour affichage dans les selects. */
  flag: string;
  /** `true` si le pays propose des subdivisions (départements/états/régions). */
  hasSubdivisions: boolean;
}

/** DTO d'une subdivision (département FR ou state ISO-3166-2 ailleurs). */
export interface SubdivisionDto {
  /** Code : INSEE 2-3 chars pour FR, ISO alpha pour les autres. */
  code: string;
  /** Nom de la subdivision. */
  name: string;
}

/** DTO d'une ville. */
export interface CityDto {
  /** Nom de la commune. */
  name: string;
  /** Code INSEE pour FR (unique), slug ailleurs. */
  code: string;
  /** Population — utile pour trier les résultats (absent hors FR). */
  population?: number;
}
