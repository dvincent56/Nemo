// ---------------------------------------------------------------------------
// Sell price — spec formula: totalNm × 1 + wins × 500 + podiums × 150 + top10 × 30
// ---------------------------------------------------------------------------

export function computeSellPrice(
  boatStats: { wins: number; podiums: number; top10Finishes: number },
  totalNm: number,
): number {
  return Math.floor(
    totalNm * 1 + boatStats.wins * 500 + boatStats.podiums * 150 + boatStats.top10Finishes * 30,
  );
}

// ---------------------------------------------------------------------------
// Unlock criteria — Proto items
// ---------------------------------------------------------------------------

export interface UnlockCriteria {
  racesFinished?: number;
  avgRankPctMax?: number;
  or?: boolean;
}

export function meetsUnlockCriteria(
  criteria: UnlockCriteria,
  player: { racesFinished: number; avgRankPct: number },
): boolean {
  const checks: boolean[] = [];
  if (criteria.racesFinished !== undefined) {
    checks.push(player.racesFinished >= criteria.racesFinished);
  }
  if (criteria.avgRankPctMax !== undefined) {
    checks.push(player.avgRankPct <= criteria.avgRankPctMax);
  }
  if (checks.length === 0) return true;
  return criteria.or ? checks.some(Boolean) : checks.every(Boolean);
}

// ---------------------------------------------------------------------------
// UUID format check (basic validation for route params)
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(s: string): boolean {
  return UUID_RE.test(s);
}
