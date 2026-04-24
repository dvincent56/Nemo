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

/**
 * Bonus de recouvrement — uniquement en mode voile auto, hors manœuvre.
 *
 * L'auto-switch ne déclenche que si la voile optimale bat l'active de plus
 * de `overlapThreshold` (ex: 1.014 = +1.4%). Sous ce seuil le moteur garde
 * l'active mais lui applique la BSP de l'optimale : le joueur profite de la
 * vitesse optimale sans payer la pénalité de changement de voile. Le facteur
 * renvoyé = ratio opt/active, borné à `overlapThreshold` — au-delà, la
 * transition a dû être déclenchée (si ce n'est pas le cas, le cap protège
 * contre un facteur absurde).
 *
 * Retourne 1.0 en mode manuel, pendant une transition de voile, ou pendant
 * un virement/empannage (ces états cumulent déjà leurs propres pénalités).
 */
export function computeOverlapFactor(
  activeSail: SailId,
  twa: number,
  tws: number,
  polar: Polar,
  autoMode: boolean,
  isManoeuvring: boolean,
): number {
  if (!autoMode || isManoeuvring) return 1.0;
  const twaAbs = Math.min(Math.abs(twa), 180);
  const activeBsp = getPolarSpeed(polar, activeSail, twaAbs, tws);
  if (activeBsp <= 0) return 1.0;
  const optimal = pickOptimalSail(polar, twa, tws);
  if (activeSail === optimal) return 1.0;
  const optBsp = getPolarSpeed(polar, optimal, twaAbs, tws);
  const ratio = optBsp / activeBsp;
  const cap = GameBalance.sails.overlapThreshold;
  return Math.max(1.0, Math.min(ratio, cap));
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
    // Hystérésis BSP : on ne déclenche un changement de voile que si l'optimale
    // bat l'active d'au moins `overlapThreshold` (+1.4% par défaut). Sous ce
    // seuil, l'overlap applique la BSP optimale à la voile active (voir
    // computeOverlapFactor). Si l'active donne 0 kt (hors plage polar), on
    // switch sans condition.
    const optimal = pickOptimalSail(polar, twa, tws);
    if (optimal !== next.active) {
      const optimalBsp = getPolarSpeed(polar, optimal, twaAbs, tws);
      const threshold = GameBalance.sails.overlapThreshold;
      const shouldSwitch = activeBsp <= 0 || optimalBsp / activeBsp > threshold;
      if (shouldSwitch) {
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
