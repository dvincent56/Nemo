import type { Position } from '@nemo/shared-types';
import { haversineNM } from '@nemo/polar-lib';

export interface BoatSnapshot {
  id: string;
  playerId: string;
  position: Position;
  dtf: number;
}

export interface VisibilityRequest {
  viewer: BoatSnapshot;
  friends: ReadonlySet<string>;
  tier: 'FREE' | 'CAREER';
}

const TOP_N = 50;
const CLOSEST_N = 5;

/**
 * Sélectionne les bateaux visibles par un viewer (§5.3) :
 *   - soi-même (toujours)
 *   - top 50 du leaderboard (tri DTF)
 *   - amis inscrits dans la même course (CAREER uniquement)
 *   - 5 bateaux les plus proches géographiquement
 */
export function computeVisibleBoats(
  all: readonly BoatSnapshot[],
  req: VisibilityRequest,
): BoatSnapshot[] {
  const byId = new Map<string, BoatSnapshot>();
  byId.set(req.viewer.id, req.viewer);

  const sortedByDtf = [...all].sort((a, b) => a.dtf - b.dtf);
  for (const b of sortedByDtf.slice(0, TOP_N)) byId.set(b.id, b);

  if (req.tier === 'CAREER') {
    for (const b of all) if (req.friends.has(b.playerId)) byId.set(b.id, b);
  }

  const byDistance = [...all]
    .map((b) => ({ b, d: haversineNM(req.viewer.position, b.position) }))
    .sort((x, y) => x.d - y.d)
    .slice(0, CLOSEST_N + 1);
  for (const { b } of byDistance) byId.set(b.id, b);

  return [...byId.values()];
}

/**
 * Fréquence broadcast selon le tier (§5.2).
 * FREE : 1 tick / 4 (120s). CAREER : tous les ticks (30s).
 */
export function shouldBroadcastForTier(tier: 'FREE' | 'CAREER', tickSeq: number): boolean {
  if (tier === 'CAREER') return true;
  return tickSeq % 4 === 0;
}
