export const API_BASE =
  process.env['NEXT_PUBLIC_API_BASE'] ?? process.env['API_BASE'] ?? 'http://localhost:3001';

/**
 * URL de base de l'app web elle-même — utilisée pour les fetch serveur
 * vers nos propres route handlers Next (`/api/public/*`). En prod, set
 * `NEXT_PUBLIC_WEB_BASE` au domaine public. En dev, fallback localhost:3000.
 */
export const WEB_BASE = process.env['NEXT_PUBLIC_WEB_BASE'] ?? 'http://localhost:3000';

export interface RaceSummary {
  id: string;
  name: string;
  boatClass: 'CRUISER_RACER' | 'FIGARO' | 'CLASS40' | 'OCEAN_FIFTY' | 'IMOCA60' | 'ULTIM';
  status: 'DRAFT' | 'PUBLISHED' | 'BRIEFING' | 'LIVE' | 'FINISHED' | 'ARCHIVED';
  tierRequired: 'FREE' | 'CAREER';
  startsAt: string;
  estimatedDurationHours: number;
  participants: number;
  maxParticipants: number;
  rewardMaxCredits: number;
  course: { start: [number, number]; finish: [number, number]; waypoints: [number, number][] };
}

export async function fetchRaces(filters: { class?: string; status?: string } = {}): Promise<RaceSummary[]> {
  const url = new URL('/api/v1/races', API_BASE);
  if (filters.class) url.searchParams.set('class', filters.class);
  if (filters.status) url.searchParams.set('status', filters.status);
  const res = await fetch(url, { next: { revalidate: 30 } });
  if (!res.ok) throw new Error(`races fetch ${res.status}`);
  const json = (await res.json()) as { races: RaceSummary[] };
  return json.races;
}

// ---------------------------------------------------------------------------
// Boat state — état initial du bateau au chargement de la page play
// En prod : Fastify GET /api/v1/races/:id/my-boat
// En dev  : Next route handler mock
// ---------------------------------------------------------------------------

export interface BoatState {
  boatClass: 'CRUISER_RACER' | 'FIGARO' | 'CLASS40' | 'OCEAN_FIFTY' | 'IMOCA60' | 'ULTIM';
  lat: number;
  lon: number;
  hdg: number;
  bsp: number;
  twd: number;
  tws: number;
  twa: number;
  vmg: number;
  dtf: number;
  overlapFactor: number;
  rank: number;
  totalParticipants: number;
  rankTrend: number;
  wearGlobal: number;
  wearDetail: { hull: number; rig: number; sails: number; electronics: number };
  currentSail: 'JIB' | 'LJ' | 'SS' | 'C0' | 'SPI' | 'HG' | 'LG';
  sailAuto: boolean;
  transitionStartMs: number;
  transitionEndMs: number;
  maneuverKind: 0 | 1 | 2;
  maneuverStartMs: number;
  maneuverEndMs: number;
  twaLock?: number | null;
  effects?: BoatEffects;
}

export interface BoatEffects {
  speedByTwa: [number, number, number, number, number];
  speedByTws: [number, number, number];
  wearMul: { hull: number; rig: number; sail: number; elec: number };
  maneuverMul: {
    tack: { dur: number; speed: number };
    gybe: { dur: number; speed: number };
    sailChange: { dur: number; speed: number };
  };
  polarTargetsDeg?: number;
  groundingLossMul?: number;
}

export const NEUTRAL_BOAT_EFFECTS: BoatEffects = {
  speedByTwa: [1, 1, 1, 1, 1],
  speedByTws: [1, 1, 1],
  wearMul: { hull: 1, rig: 1, sail: 1, elec: 1 },
  maneuverMul: {
    tack: { dur: 1, speed: 1 },
    gybe: { dur: 1, speed: 1 },
    sailChange: { dur: 1, speed: 1 },
  },
};

const DEMO_BOAT_ID = process.env['NEXT_PUBLIC_DEMO_BOAT_ID'] ?? 'demo-boat-1';

export async function fetchMyBoat(raceId: string): Promise<BoatState | null> {
  // Read the authoritative runtime snapshot from the game engine so the HUD
  // doesn't flash mocked values before the first WS tick arrives. The Next
  // proxy route at /api/v1/races/:raceId/my-boat is kept as a fallback for
  // local dev when the engine isn't reachable.
  const engineUrl = new URL(
    `/api/v1/races/${raceId}/runtime/${DEMO_BOAT_ID}`,
    API_BASE,
  );
  try {
    const res = await fetch(engineUrl);
    if (res.ok) return (await res.json()) as BoatState;
    if (res.status === 404) return null;
  } catch {
    // network/engine down — fall through to the Next mock
  }
  const fallback = await fetch(new URL(`/api/v1/races/${raceId}/my-boat`, WEB_BASE));
  if (fallback.status === 404) return null;
  if (!fallback.ok) return null;
  return (await fallback.json()) as BoatState;
}

import type { ExclusionZone } from '@nemo/shared-types';

export async function fetchRaceZones(raceId: string): Promise<ExclusionZone[]> {
  const res = await fetch(new URL(`/api/v1/races/${raceId}/zones`, WEB_BASE));
  if (!res.ok) return [];
  const json = (await res.json()) as { zones: ExclusionZone[] };
  return json.zones ?? [];
}

export async function fetchRace(id: string): Promise<RaceSummary | null> {
  const res = await fetch(new URL(`/api/v1/races/${id}`, API_BASE), { next: { revalidate: 30 } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`race fetch ${res.status}`);
  return (await res.json()) as RaceSummary;
}

// ---------------------------------------------------------------------------
// News — mock temporaire (Next route handler `/api/public/news`).
// En Phase 5, pointera vers Fastify.
// ---------------------------------------------------------------------------

import type { NewsItem } from '@/app/home-data';

export async function fetchNews(): Promise<NewsItem[]> {
  const res = await fetch(new URL('/api/public/news', WEB_BASE), {
    next: { revalidate: 60 },
  });
  if (!res.ok) throw new Error(`news fetch ${res.status}`);
  const json = (await res.json()) as { news: NewsItem[] };
  return json.news;
}

export async function fetchNewsBySlug(slug: string): Promise<NewsItem | null> {
  const res = await fetch(
    new URL(`/api/public/news/${encodeURIComponent(slug)}`, WEB_BASE),
    { next: { revalidate: 60 } },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`news fetch ${res.status}`);
  const json = (await res.json()) as { news: NewsItem };
  return json.news;
}
