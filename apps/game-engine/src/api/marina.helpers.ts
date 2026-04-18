import type { UpgradeTier } from '@nemo/game-balance';

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
// Repair cost — per axis: (100 - condition) / 10 × costPer10pts × tierMul
// ---------------------------------------------------------------------------

export interface RepairBreakdown {
  hull: number;
  rig: number;
  sail: number;
  elec: number;
  total: number;
}

type ConditionAxis = 'hull' | 'rig' | 'sail' | 'elec';

interface MaintenanceEntry { costPer10pts: number; durationHours: number }
type MaintenanceConfig = Record<'hull' | 'rig' | 'sails' | 'electronics', MaintenanceEntry>;
type TierConfig = Record<UpgradeTier, { maintenanceMul: number }>;

/** Maps condition axis to the upgrade slot whose tier drives the maintenance multiplier. */
const AXIS_TO_SLOT = {
  hull: 'HULL',
  rig:  'MAST',
  sail: 'SAILS',
  elec: 'ELECTRONICS',
} as const;


export function conditionAxisToSlot(axis: ConditionAxis): string {
  return AXIS_TO_SLOT[axis];
}

function repairAxisCost(
  condition: number,
  maintEntry: MaintenanceEntry,
  tierMul: number,
): number {
  if (condition >= 100) return 0;
  return (100 - condition) / 10 * maintEntry.costPer10pts * tierMul;
}

export function computeRepairCost(
  conditions: Record<ConditionAxis, number>,
  slotTiers: { hull: UpgradeTier; mast: UpgradeTier; sails: UpgradeTier; electronics: UpgradeTier },
  maintenance: MaintenanceConfig,
  tiers: TierConfig,
): RepairBreakdown {
  const hull = repairAxisCost(conditions.hull, maintenance.hull, tiers[slotTiers.hull].maintenanceMul);
  const rig  = repairAxisCost(conditions.rig,  maintenance.rig,  tiers[slotTiers.mast].maintenanceMul);
  const sail = repairAxisCost(conditions.sail, maintenance.sails, tiers[slotTiers.sails].maintenanceMul);
  const elec = repairAxisCost(conditions.elec, maintenance.electronics, tiers[slotTiers.electronics].maintenanceMul);
  return { hull, rig, sail, elec, total: hull + rig + sail + elec };
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
