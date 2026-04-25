import { API_BASE } from '../api';
import type { TrackPoint } from '../store/types';

export interface FetchTrackResponse {
  boatId: string;
  points: TrackPoint[];
}

/**
 * Récupère l'historique de track points pour un bateau dans une course.
 * Phase 1 : route /boats/:boatId/track sur le game-engine. Phase 4 :
 * /participants/:pid/track.
 */
export async function fetchBoatTrack(raceId: string, boatId: string): Promise<FetchTrackResponse> {
  const url = new URL(`/api/v1/races/${raceId}/boats/${boatId}/track`, API_BASE);
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`track fetch failed: ${res.status}`);
  const json = (await res.json()) as {
    boatId: string;
    points: Array<{ ts: string; lat: number; lon: number; rank: number }>;
  };
  return {
    boatId: json.boatId,
    points: json.points.map((p) => ({
      ts: Date.parse(p.ts),
      lat: p.lat,
      lon: p.lon,
      rank: p.rank,
    })),
  };
}
