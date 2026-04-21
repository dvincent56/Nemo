import type { BoatClass, SailId } from '@nemo/shared-types';
import { GameBalance } from '@nemo/game-balance/browser';
import type { Polar } from '@nemo/shared-types';
import { getPolarSpeed } from '@nemo/polar-lib/browser';
import type { AggregatedEffects } from './loadout';

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

const ALL_SAILS: SailId[] = ['JIB', 'LJ', 'SS', 'C0', 'SPI', 'HG', 'LG'];

/**
 * Sélectionne la voile optimale (BSP max au TWA/TWS donnés).
 * La polaire elle-même encode les plages valides (speed > 0 = en plage).
 */
export function pickOptimalSail(polar: Polar, twa: number, tws: number): SailId {
  const twaAbs = Math.min(Math.abs(twa), 180);
  let best: SailId = 'JIB';
  let bestBsp = -Infinity;
  for (const s of ALL_SAILS) {
    const bsp = getPolarSpeed(polar, s, twaAbs, tws);
    if (bsp > bestBsp) { bestBsp = bsp; best = s; }
  }
  return best;
}

/** True if `twaAbs` sits inside the declared TWA range of `sail`.
 *  Used by the auto-sail logic as a hysteresis: while the current sail
 *  covers the TWA we don't switch for marginal BSP gains. */
export function isSailInRange(sail: SailId, twaAbs: number): boolean {
  const def = GameBalance.sails.definitions[sail];
  if (!def) return true;
  return twaAbs >= def.twaMin && twaAbs <= def.twaMax;
}

/**
 * Bonus de recouvrement — n'a de sens qu'en mode voile auto.
 *
 * Quand l'hystérésis d'auto garde la voile active dans sa plage alors
 * qu'une autre voile serait marginalement plus rapide, le moteur accorde
 * la BSP de la voile optimale (ratio opt/active ≥ 1) ; le joueur profite
 * de la vitesse optimale tout en évitant la pénalité de changement de
 * voile — à ses risques : le moindre décalage de vent fait bascule et il
 * encaisse les 360 s de transition.
 *
 * Mode manuel : 1.0 sans exception. Le joueur assume sa voile.
 */
export function computeOverlapFactor(
  activeSail: SailId,
  twa: number,
  tws: number,
  polar: Polar,
  autoMode: boolean,
): number {
  if (!autoMode) return 1.0;
  const twaAbs = Math.min(Math.abs(twa), 180);
  const activeBsp = getPolarSpeed(polar, activeSail, twaAbs, tws);
  if (activeBsp <= 0) return 1.0;
  const optimal = pickOptimalSail(polar, twa, tws);
  if (activeSail === optimal) return 1.0;
  const optBsp = getPolarSpeed(polar, optimal, twaAbs, tws);
  return optBsp / activeBsp;
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

  const activeBsp = getPolarSpeed(polar, next.active, twaAbs, tws);
  if (activeBsp > 0) {
    next.timeOutOfRangeSec = 0;
  } else {
    next.timeOutOfRangeSec += _dtSec;
  }

  const isManoeuvring = next.transitionEndMs > 0 && nowMs < next.transitionEndMs;
  if (next.autoMode && !isManoeuvring) {
    // Keep the current sail while its TWA range still covers us — avoids
    // flapping across a crossover for a sub-percent BSP gain, given that
    // every switch costs a 120-360 s ×0.7 transition penalty.
    const stayInRange = isSailInRange(next.active, twaAbs) && activeBsp > 0;
    if (!stayInRange) {
      const optimal = pickOptimalSail(polar, twa, tws);
      if (optimal !== next.active) {
        const dur = getTransitionDuration(next.active, optimal, loadoutEffects);
        next.active = optimal;
        next.pending = null;
        next.transitionStartMs = nowMs;
        next.transitionEndMs = nowMs + dur * 1000;
      }
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
