import type { BoatClass, SailId } from '@nemo/shared-types';
import { GameBalance } from '@nemo/game-balance';
import type { Polar } from '@nemo/shared-types';
import { getPolarSpeed } from '@nemo/polar-lib';
import type { AggregatedEffects } from './loadout.js';

export interface SailRuntimeState {
  active: SailId;
  pending: SailId | null;
  /** Timestamp (ms) when the current maneuver started. 0 = no maneuver. */
  transitionStartMs: number;
  /** Timestamp (ms) when the current maneuver ends. 0 = no maneuver. */
  transitionEndMs: number;
  autoMode: boolean;
  /** Durée pendant laquelle la voile active reste hors plage optimale (sec). */
  timeOutOfRangeSec: number;
}

const ALL_SAILS: SailId[] = ['LW', 'JIB', 'GEN', 'C0', 'HG', 'SPI'];

export function isInRange(sail: SailId, twaAbs: number): boolean {
  const def = GameBalance.sails.definitions[sail];
  return twaAbs >= def.twaMin && twaAbs <= def.twaMax;
}

export function isInOverlapZone(sail: SailId, twaAbs: number): boolean {
  const def = GameBalance.sails.definitions[sail];
  const overlap = GameBalance.sails.overlapDegrees[sail];
  const distToEdge = Math.min(Math.abs(twaAbs - def.twaMin), Math.abs(twaAbs - def.twaMax));
  return distToEdge <= overlap;
}

/**
 * Sélectionne la voile optimale (BSP max au TWA/TWS donnés parmi les voiles
 * dont la plage TWA couvre le point).
 */
export function pickOptimalSail(polar: Polar, twa: number, tws: number): SailId {
  const twaAbs = Math.min(Math.abs(twa), 180);
  let best: SailId = 'GEN';
  let bestBsp = -Infinity;
  for (const s of ALL_SAILS) {
    if (!isInRange(s, twaAbs)) continue;
    const bsp = getPolarSpeed(polar, twaAbs, tws);
    if (bsp > bestBsp) { bestBsp = bsp; best = s; }
  }
  return best;
}

/**
 * Facteur de recouvrement : >= 1.0 signifie que le bateau bénéficie de la vitesse
 * de la voile optimale sans avoir déclenché la transition (mécanique compétitive).
 */
export function computeOverlapFactor(
  activeSail: SailId,
  twa: number,
  tws: number,
  polar: Polar,
): number {
  const twaAbs = Math.min(Math.abs(twa), 180);
  if (!isInRange(activeSail, twaAbs)) return 1.0;
  const optimal = pickOptimalSail(polar, twa, tws);
  if (activeSail === optimal) return 1.0;
  if (!isInOverlapZone(activeSail, twaAbs)) return 1.0;
  const optBsp = getPolarSpeed(polar, twaAbs, tws);
  const activeBsp = getPolarSpeed(polar, twaAbs, tws);
  return activeBsp === 0 ? 1.0 : optBsp / activeBsp;
}

function transitionKey(from: SailId, to: SailId): string {
  return `${from}_${to}`;
}

export function getTransitionDuration(from: SailId, to: SailId, loadoutEffects?: AggregatedEffects): number {
  const times = GameBalance.sails.transitionTimes;
  const base = times[transitionKey(from, to)] ?? 180;
  return loadoutEffects ? base * loadoutEffects.maneuverMul.sailChange.dur : base;
}

/**
 * Avance la state machine sails d'un tick :
 * - si transition en cours, décrémente le timer ; à 0, bascule la voile active
 * - sinon, si auto mode + voile sous-optimale hors zone overlap, déclenche une
 *   transition automatique vers la voile optimale.
 */
export function advanceSailState(
  state: SailRuntimeState,
  polar: Polar,
  twa: number,
  tws: number,
  _dtSec: number,
  nowMs: number,
  loadoutEffects?: AggregatedEffects,
): SailRuntimeState {
  const twaAbs = Math.min(Math.abs(twa), 180);
  const next: SailRuntimeState = { ...state };

  // Clear finished maneuver
  if (next.transitionEndMs > 0 && nowMs >= next.transitionEndMs) {
    next.transitionStartMs = 0;
    next.transitionEndMs = 0;
  }

  if (isInRange(next.active, twaAbs)) {
    next.timeOutOfRangeSec = 0;
  } else {
    next.timeOutOfRangeSec += _dtSec;
  }

  const isManoeuvring = next.transitionEndMs > 0 && nowMs < next.transitionEndMs;
  if (next.autoMode && !isManoeuvring) {
    const optimal = pickOptimalSail(polar, twa, tws);
    if (optimal !== next.active && !isInOverlapZone(next.active, twaAbs)) {
      const dur = getTransitionDuration(next.active, optimal, loadoutEffects);
      next.active = optimal;
      next.pending = null;
      next.transitionStartMs = nowMs;
      next.transitionEndMs = nowMs + dur * 1000;
    }
  }

  return next;
}

/**
 * Manual sail change — instant switch, speed penalty starts.
 */
export function requestManualSailChange(state: SailRuntimeState, target: SailId, nowMs: number, loadoutEffects?: AggregatedEffects): SailRuntimeState {
  if (target === state.active) return state;
  const dur = getTransitionDuration(state.active, target, loadoutEffects);
  return {
    ...state,
    active: target,
    pending: null,
    transitionStartMs: nowMs,
    transitionEndMs: nowMs + dur * 1000,
  };
}

/** Pénalité de vitesse pendant un changement de voile (×0.7 par défaut). */
export function transitionSpeedFactor(state: SailRuntimeState, nowMs: number, loadoutEffects?: AggregatedEffects): number {
  if (state.transitionEndMs <= 0 || nowMs >= state.transitionEndMs) return 1.0;
  const base = GameBalance.sails.transitionPenalty;
  return loadoutEffects ? base * loadoutEffects.maneuverMul.sailChange.speed : base;
}

// ----------------------------------------------------------------------------
// Changement d'amure — virement (tack) et empannage (gybe)
// Déclenché quand TWA change de signe (bâbord ↔ tribord). Le type dépend de
// abs(TWA) au nouveau bord : < 90° → TACK (près), > 90° → GYBE (portant).
// Pénalités cumulables avec la transition de voile (multiplication).
// ----------------------------------------------------------------------------

export type ManeuverKind = 'TACK' | 'GYBE';

export interface ManeuverPenaltyState {
  kind: ManeuverKind;
  speedFactor: number;
  startMs: number;
  endMs: number;
}

export function detectManeuver(
  prevTwa: number,
  newTwa: number,
  boatClass: BoatClass,
  nowMs: number,
  loadoutEffects?: AggregatedEffects,
): ManeuverPenaltyState | null {
  const prevSign = Math.sign(prevTwa);
  const newSign = Math.sign(newTwa);
  if (prevSign === 0 || newSign === 0 || prevSign === newSign) return null;

  const isTack = Math.abs(newTwa) < 90;
  const kind: ManeuverKind = isTack ? 'TACK' : 'GYBE';
  const cfg = isTack ? GameBalance.maneuvers.tack : GameBalance.maneuvers.gybe;
  const manKey = isTack ? 'tack' : 'gybe' as const;
  const baseDuration = cfg.durationSec[boatClass];
  const baseSpeed = cfg.speedFactor;
  const durationMs = (loadoutEffects ? baseDuration * loadoutEffects.maneuverMul[manKey].dur : baseDuration) * 1000;
  return {
    kind,
    speedFactor: loadoutEffects ? baseSpeed * loadoutEffects.maneuverMul[manKey].speed : baseSpeed,
    startMs: nowMs,
    endMs: nowMs + durationMs,
  };
}

export function maneuverSpeedFactor(penalty: ManeuverPenaltyState | null, nowMs: number): {
  factor: number;
  expired: boolean;
} {
  if (!penalty) return { factor: 1.0, expired: false };
  if (nowMs >= penalty.endMs) return { factor: 1.0, expired: true };
  return { factor: penalty.speedFactor, expired: false };
}
