export interface PlayerTierState {
  tier: 'FREE' | 'CAREER';
  trialUntil: Date | null;
}

/**
 * Single source of truth for "is this player effectively Carrière right now?".
 * Reads tier and trialUntil from a *DB-loaded* player snapshot (never from JWT).
 *
 * The optional `now` parameter exists for deterministic testing only.
 */
export function isCareer(p: PlayerTierState, now: Date = new Date()): boolean {
  if (p.tier === 'CAREER') return true;
  if (p.trialUntil && p.trialUntil.getTime() > now.getTime()) return true;
  return false;
}
