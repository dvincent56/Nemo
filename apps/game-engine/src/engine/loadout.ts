import { GameBalance, type UpgradeItem, type UpgradeSlot } from '@nemo/game-balance';
import type { BoatClass } from '@nemo/shared-types';

// ---------------------------------------------------------------------------
// Re-exports for consumers
// ---------------------------------------------------------------------------
export type ResolvedItem = UpgradeItem;

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export interface AggregatedEffects {
  speedByTwa: [number, number, number, number, number];
  speedByTws: [number, number, number];
  wearMul: { hull: number; rig: number; sail: number; elec: number };
  maneuverMul: {
    tack: { dur: number; speed: number };
    gybe: { dur: number; speed: number };
    sailChange: { dur: number; speed: number };
  };
  /** Minimum of the non-null values; 0 = no polar assistance */
  polarTargetsDeg: number;
  /** 1.0 = neutral */
  groundingLossMul: number;
}

export interface BoatLoadout {
  participantId: string;
  bySlot: Map<UpgradeSlot, ResolvedItem>;
  items: ResolvedItem[];
}

export interface AggregateContext {
  /** Current true wind speed in knots — used to evaluate activation gates */
  tws?: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// Design decision: activation filtering applies to ALL dimensions including wearMul.
// At low TWS (below foil activation threshold), foils are retracted/feathered
// and cause no structural stress → no extra wear. This matches real foiling behavior.
function isActive(item: ResolvedItem, tws: number | undefined): boolean {
  if (tws === undefined) return true;
  const { minTws, maxTws } = item.effects.activation ?? {};
  if (minTws !== undefined && tws < minTws) return false;
  if (maxTws !== undefined && tws > maxTws) return false;
  return true;
}

// ---------------------------------------------------------------------------
// aggregateEffects
// ---------------------------------------------------------------------------

export function aggregateEffects(
  items: ResolvedItem[],
  ctx?: AggregateContext,
): AggregatedEffects {
  const tws = ctx?.tws;

  // Neutral base state
  const speedByTwa: [number, number, number, number, number] = [1, 1, 1, 1, 1];
  const speedByTws: [number, number, number] = [1, 1, 1];
  const wearMul = { hull: 1, rig: 1, sail: 1, elec: 1 };
  const maneuverMul = {
    tack:       { dur: 1, speed: 1 },
    gybe:       { dur: 1, speed: 1 },
    sailChange: { dur: 1, speed: 1 },
  };
  const polarValues: number[] = [];
  let groundingMul = 1;
  let hasGrounding = false;

  for (const item of items) {
    const fx = item.effects;
    const active = isActive(item, tws);

    // Passive effects are always applied (foil drag, reinforcement weight,
    // etc.) — even when the item's activation window is not met.
    const p = fx.passiveEffects;
    if (p) {
      if (p.speedByTwa) {
        speedByTwa[0] *= 1 + p.speedByTwa[0];
        speedByTwa[1] *= 1 + p.speedByTwa[1];
        speedByTwa[2] *= 1 + p.speedByTwa[2];
        speedByTwa[3] *= 1 + p.speedByTwa[3];
        speedByTwa[4] *= 1 + p.speedByTwa[4];
      }
      if (p.speedByTws) {
        speedByTws[0] *= 1 + p.speedByTws[0];
        speedByTws[1] *= 1 + p.speedByTws[1];
        speedByTws[2] *= 1 + p.speedByTws[2];
      }
      if (p.wearMul?.hull !== undefined) wearMul.hull *= p.wearMul.hull;
      if (p.wearMul?.rig  !== undefined) wearMul.rig  *= p.wearMul.rig;
      if (p.wearMul?.sail !== undefined) wearMul.sail *= p.wearMul.sail;
      if (p.wearMul?.elec !== undefined) wearMul.elec *= p.wearMul.elec;
    }

    if (!active) continue;

    // speedByTwa — multiplicative: base * (1 + delta). Unrolled for noUncheckedIndexedAccess.
    speedByTwa[0] *= 1 + fx.speedByTwa[0];
    speedByTwa[1] *= 1 + fx.speedByTwa[1];
    speedByTwa[2] *= 1 + fx.speedByTwa[2];
    speedByTwa[3] *= 1 + fx.speedByTwa[3];
    speedByTwa[4] *= 1 + fx.speedByTwa[4];

    // speedByTws — same pattern
    speedByTws[0] *= 1 + fx.speedByTws[0];
    speedByTws[1] *= 1 + fx.speedByTws[1];
    speedByTws[2] *= 1 + fx.speedByTws[2];

    // wearMul — multiply by item value when defined
    if (fx.wearMul?.hull !== undefined) wearMul.hull *= fx.wearMul.hull;
    if (fx.wearMul?.rig  !== undefined) wearMul.rig  *= fx.wearMul.rig;
    if (fx.wearMul?.sail !== undefined) wearMul.sail *= fx.wearMul.sail;
    if (fx.wearMul?.elec !== undefined) wearMul.elec *= fx.wearMul.elec;

    // maneuverMul — multiply by item value when defined
    if (fx.maneuverMul?.tack) {
      maneuverMul.tack.dur   *= fx.maneuverMul.tack.dur;
      maneuverMul.tack.speed *= fx.maneuverMul.tack.speed;
    }
    if (fx.maneuverMul?.gybe) {
      maneuverMul.gybe.dur   *= fx.maneuverMul.gybe.dur;
      maneuverMul.gybe.speed *= fx.maneuverMul.gybe.speed;
    }
    if (fx.maneuverMul?.sailChange) {
      maneuverMul.sailChange.dur   *= fx.maneuverMul.sailChange.dur;
      maneuverMul.sailChange.speed *= fx.maneuverMul.sailChange.speed;
    }

    // polarTargetsDeg — collect non-null values, will take min
    if (fx.polarTargetsDeg !== null) {
      polarValues.push(fx.polarTargetsDeg);
    }

    // groundingLossMul — product of non-null values
    if (fx.groundingLossMul !== null) {
      groundingMul *= fx.groundingLossMul;
      hasGrounding = true;
    }
  }

  return {
    speedByTwa,
    speedByTws,
    wearMul,
    maneuverMul,
    polarTargetsDeg: polarValues.length > 0 ? Math.min(...polarValues) : 0,
    groundingLossMul: hasGrounding ? groundingMul : 1,
  };
}

// ---------------------------------------------------------------------------
// resolveBoatLoadout
// ---------------------------------------------------------------------------

export function resolveBoatLoadout(
  participantId: string,
  installed: ResolvedItem[],
  boatClass: BoatClass,
): BoatLoadout {
  const { slots, slotsByClass, items: catalog } = GameBalance.upgrades;
  const classSlots = slotsByClass[boatClass];

  // Index installed items by slot for O(1) lookup
  const installedBySlot = new Map<UpgradeSlot, ResolvedItem>();
  const seen = new Set<UpgradeSlot>();
  for (const item of installed) {
    if (seen.has(item.slot)) {
      throw new Error(`Duplicate slot ${item.slot} in installed list for ${participantId}`);
    }
    seen.add(item.slot);
    installedBySlot.set(item.slot, item);
  }

  const bySlot = new Map<UpgradeSlot, ResolvedItem>();

  for (const slot of slots) {
    const availability = classSlots[slot];

    // Skip slots that don't exist on this boat class
    if (availability === 'absent') continue;

    const installedItem = installedBySlot.get(slot);
    if (installedItem) {
      bySlot.set(slot, installedItem);
      continue;
    }

    // Find the Série fallback for this (slot, boatClass)
    const serie = catalog.find(
      (item) =>
        item.slot === slot &&
        item.tier === 'SERIE' &&
        item.compat.includes(boatClass as typeof item.compat[number]),
    );

    if (!serie) {
      throw new Error(
        `No SERIE item found for slot ${slot} and class ${boatClass}. ` +
        'Check game-balance.json catalog.',
      );
    }

    bySlot.set(slot, serie);
  }

  return {
    participantId,
    bySlot,
    items: Array.from(bySlot.values()),
  };
}
