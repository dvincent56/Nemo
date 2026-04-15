/**
 * Profile seed — données statiques Phase 3.
 * TODO Phase 4 : brancher sur `/api/v1/players/me` qui agrège palmarès,
 * flotte, activité et stats depuis PostgreSQL.
 */

export interface ProfileStats {
  races: { total: number; finishes: number; retired: number };
  podiums: { total: number; wins: number; second: number; third: number };
  distanceNm: number;
  seaHours: number;
  daysAtSea: number;
  bestRank: { position: number; raceName: string; season: number };
}

export interface PalmaresEntry {
  position: number;
  raceName: string;
  boatClass: 'FIGARO' | 'CLASS40' | 'OCEAN_FIFTY' | 'IMOCA60' | 'ULTIM';
  dateLabel: string;
  distanceNm: number;
  boat: string;
  time: string;
}

export interface FleetBoat {
  id: string;
  class: 'FIGARO' | 'CLASS40' | 'OCEAN_FIFTY' | 'IMOCA60' | 'ULTIM';
  name: string;
  races: number;
  bestRank: number | null;
  /** Couleur principale de la coque (hex), rendue dans le mini SVG. */
  hullColor: string;
}

export interface ActivityEntry {
  position: number;
  raceName: string;
  boatClass: string;
  status: string;
  boat: string;
  dateLabel: string;
  isLive?: boolean;
}

export const PROFILE_SEED = {
  tagline: "« Je n'ai jamais autant appris à perdre que depuis ce circuit. »",
  country: 'fr' as const,
  countryLabel: 'France',
  city: 'La Rochelle',
  memberSince: 'mars 2024',
  team: 'La Rochelle Racing',
  favoriteBoat: 'Mistral',
  stats: {
    races: { total: 42, finishes: 38, retired: 4 },
    podiums: { total: 7, wins: 2, second: 5, third: 0 },
    distanceNm: 18240,
    seaHours: 1824,
    daysAtSea: 76,
    bestRank: { position: 1, raceName: 'Cap Lizard Trophy', season: 2025 },
  } satisfies ProfileStats,

  palmares: [
    { position: 1, raceName: 'Cap Lizard Trophy', boatClass: 'CLASS40',    dateLabel: '18 jan. 2025', distanceNm: 412,   boat: 'Mistral',  time: '1 j 22 h 08 min' },
    { position: 1, raceName: 'Coupe de la Saint-Brieuc', boatClass: 'FIGARO', dateLabel: '03 sep. 2024', distanceNm: 188, boat: 'Albatros', time: '14 h 37 min' },
    { position: 2, raceName: 'Drheam Cup',         boatClass: 'CLASS40',    dateLabel: '12 juin 2025', distanceNm: 1062,  boat: 'Mistral',  time: '4 j 12 h 50 min' },
    { position: 3, raceName: 'Tour de Bretagne',   boatClass: 'FIGARO',     dateLabel: '04 août 2024', distanceNm: 564,   boat: 'Albatros', time: '2 j 16 h 04 min' },
    { position: 4, raceName: 'Fastnet Sprint',     boatClass: 'CLASS40',    dateLabel: '06 août 2025', distanceNm: 608,   boat: 'Mistral',  time: '2 j 18 h 42 min' },
  ] satisfies PalmaresEntry[],

  fleet: [
    { id: 'b-albatros',  class: 'FIGARO',      name: 'Albatros', races: 24, bestRank: 12, hullColor: '#1a2840' },
    { id: 'b-mistral',   class: 'CLASS40',     name: 'Mistral',  races: 12, bestRank: 4,  hullColor: '#1a4d7a' },
    { id: 'b-sirocco',   class: 'OCEAN_FIFTY', name: 'Sirocco',  races: 0,  bestRank: null, hullColor: '#7b6f5c' },
  ] satisfies FleetBoat[],

  activity: [
    { position: 12, raceName: 'Vendée Express',   boatClass: 'IMOCA 60',    status: 'En cours · J3',           boat: 'Albatros', dateLabel: '9 avr. 2026',  isLive: true },
    { position: 4,  raceName: 'Fastnet Sprint',   boatClass: 'Class40',     status: '608 NM',                  boat: 'Mistral',  dateLabel: '06 août 2025' },
    { position: 7,  raceName: 'Route du Café',    boatClass: 'Class40',     status: '2 850 NM',                boat: 'Mistral',  dateLabel: '24 mars 2026' },
    { position: 15, raceName: 'Baie de Seine Cup', boatClass: 'Figaro III', status: '180 NM',                  boat: 'Albatros', dateLabel: '22 fév. 2026' },
    { position: 18, raceName: 'Drheam Cup',       boatClass: 'Class40',     status: '1 062 NM',                boat: 'Mistral',  dateLabel: '02 fév. 2026' },
  ] satisfies ActivityEntry[],
};
