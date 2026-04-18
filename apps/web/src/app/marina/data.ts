/**
 * Marina — types et mock data.
 * Les types correspondent aux réponses API (Plan 2).
 * Le mock sert de fallback quand DATABASE_URL n'est pas configuré.
 */
import type { BoatRecord, InstalledUpgrade, UpgradeSlot, UpgradeTier, BoatClass } from '@/lib/marina-api';
export type { BoatRecord, InstalledUpgrade, UpgradeSlot, UpgradeTier, BoatClass };

export const CLASS_LABEL: Record<string, string> = {
  FIGARO: 'Figaro III',
  CLASS40: 'Class40',
  OCEAN_FIFTY: 'Ocean Fifty',
  IMOCA60: 'IMOCA 60',
  ULTIM: 'Ultim',
};

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

export const ALL_CLASSES: BoatClass[] = ['FIGARO', 'CLASS40', 'OCEAN_FIFTY', 'IMOCA60', 'ULTIM'];
export const MAX_BOATS_PER_CLASS = 5;

// ---------------------------------------------------------------------------
// Compat types for /customize (uses a subset of BoatRecord fields)
// ---------------------------------------------------------------------------

export interface BoatDetail {
  id: string;
  boatClass: string;
  name: string;
  hullNumber: string;
  hullColor: string;
  deckColor: string;
}

/** Mock lookup for /customize page — uses MOCK_BOATS as source. */
export function getBoatDetail(boatId: string): BoatDetail | null {
  const b = MOCK_BOATS.find((m) => m.id === boatId);
  if (!b) return null;
  return {
    id: b.id,
    boatClass: b.boatClass,
    name: b.name,
    hullNumber: '001',
    hullColor: b.hullColor ?? '#1a2840',
    deckColor: b.deckColor ?? '#e4ddd0',
  };
}

// ---------------------------------------------------------------------------
// Race history
// ---------------------------------------------------------------------------

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

export const MOCK_BOATS: BoatRecord[] = [
  {
    id: 'b-albatros', name: 'Albatros', boatClass: 'CLASS40',
    hullColor: '#1a2840', deckColor: '#c9a227', generation: 1,
    status: 'ACTIVE', activeRaceId: 'r-fastnet-sprint',
    racesCount: 12, wins: 0, podiums: 2, top10Finishes: 5,
    hullCondition: 78, rigCondition: 92, sailCondition: 85, elecCondition: 100,
    createdAt: '2026-01-15T10:00:00Z',
  },
  {
    id: 'b-mistral', name: 'Mistral', boatClass: 'CLASS40',
    hullColor: '#2d4a6f', deckColor: '#e4ddd0', generation: 1,
    status: 'ACTIVE', activeRaceId: null,
    racesCount: 8, wins: 1, podiums: 1, top10Finishes: 3,
    hullCondition: 100, rigCondition: 100, sailCondition: 100, elecCondition: 100,
    createdAt: '2026-02-10T14:00:00Z',
  },
  {
    id: 'b-sirocco', name: 'Sirocco', boatClass: 'FIGARO',
    hullColor: '#8b0000', deckColor: null, generation: 1,
    status: 'ACTIVE', activeRaceId: null,
    racesCount: 22, wins: 3, podiums: 5, top10Finishes: 12,
    hullCondition: 65, rigCondition: 70, sailCondition: 50, elecCondition: 90,
    createdAt: '2026-01-05T08:00:00Z',
  },
];

export const MOCK_CREDITS = 12480;

export const MOCK_INSTALLED: Record<string, InstalledUpgrade[]> = {
  'b-albatros': [
    { slot: 'FOILS', playerUpgradeId: 'pu-1', catalogId: 'foils-class40-c', name: 'Foils en C', tier: 'BRONZE', profile: 'reaching nerveux', effects: null },
    { slot: 'ELECTRONICS', playerUpgradeId: 'pu-2', catalogId: 'electronics-pack-race', name: 'Pack régate', tier: 'BRONZE', profile: 'cibles polaires', effects: null },
  ],
  'b-mistral': [
    { slot: 'SAILS', playerUpgradeId: 'pu-3', catalogId: 'sails-class40-mylar', name: 'Voiles Mylar', tier: 'SILVER', profile: 'polyvalent stable', effects: null },
  ],
  'b-sirocco': [],
};

export const MOCK_HISTORY: Record<string, BoatRaceHistoryEntry[]> = {
  'b-albatros': [
    { raceId: 'r-fastnet-sprint', raceName: 'Fastnet Sprint', raceBoatClass: 'CLASS40', raceDate: '2026-04-10', finalRank: 3, raceDistanceNm: 615, durationLabel: '2j 18h', creditsEarned: 1850 },
    { raceId: 'r-tjv-1', raceName: 'Transat Jacques Vabre', raceBoatClass: 'CLASS40', raceDate: '2026-03-15', finalRank: 7, raceDistanceNm: 4350, durationLabel: '12j 06h', creditsEarned: 3200 },
  ],
  'b-mistral': [
    { raceId: 'r-channel-cup', raceName: 'Channel Cup', raceBoatClass: 'CLASS40', raceDate: '2026-04-05', finalRank: 1, raceDistanceNm: 280, durationLabel: '1j 04h', creditsEarned: 2400 },
  ],
  'b-sirocco': [],
};
