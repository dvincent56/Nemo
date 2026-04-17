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
  boatClass: 'FIGARO' | 'CLASS40' | 'OCEAN_FIFTY' | 'IMOCA60' | 'ULTIM';
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
