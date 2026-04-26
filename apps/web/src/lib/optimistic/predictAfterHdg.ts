import type { Polar, SailId, BoatClass } from '@nemo/shared-types';
import {
  detectManeuver,
  pickOptimalSail,
  getTransitionDuration,
  getPolarSpeed,
} from '@nemo/game-engine-core';
import { GameBalance } from '@nemo/game-balance/browser';

/**
 * Inputs needed to predict the boat state after a heading-change order.
 *
 * Mirrors the engine's `runTick` step that processes a CAP/TWA order and
 * recomputes `bsp`, `twa`, the active sail (auto-mode), and the maneuver
 * state. By running the same logic client-side at the moment the player
 * clicks Valider, the UI can show the post-tick state immediately instead
 * of waiting up to ~1 s for the next tick payload.
 */
export interface PredictAfterHdgInputs {
  newHdg: number;
  prevTwa: number;
  twd: number;
  tws: number;
  currentSail: SailId;
  sailAuto: boolean;
  bspBaseMultiplier: number;
  /** End ms of in-progress sail transition. 0 = none. */
  transitionEndMs: number;
  /** End ms of in-progress tack/gybe. 0 = none. */
  maneuverEndMs: number;
  /** Current maneuver kind for in-progress maneuver (preserved for BSP factor). */
  maneuverKind: 0 | 1 | 2;
  polar: Polar;
  boatClass: BoatClass;
  now: number;
}

export interface PredictAfterHdgPatch {
  hud: {
    hdg: number;
    twa: number;
    bsp: number;
  };
  sail: {
    sailChange?: {
      currentSail: SailId;
      transitionStartMs: number;
      transitionEndMs: number;
    };
    maneuver?: {
      kind: 1 | 2;
      startMs: number;
      endMs: number;
    };
  };
}

function wrapTwa(deg: number): number {
  return ((deg + 540) % 360) - 180;
}

export function predictAfterHdg(inputs: PredictAfterHdgInputs): PredictAfterHdgPatch {
  const newTwa = wrapTwa(inputs.newHdg - inputs.twd);

  const wasManeuvering = inputs.maneuverEndMs > 0 && inputs.now < inputs.maneuverEndMs;
  const wasTransitioning = inputs.transitionEndMs > 0 && inputs.now < inputs.transitionEndMs;

  // 1. Detect new maneuver from sign change (engine: detectManeuver)
  let triggeredManeuver: { kind: 1 | 2; startMs: number; endMs: number } | undefined;
  if (!wasManeuvering) {
    const det = detectManeuver(inputs.prevTwa, newTwa, inputs.boatClass, inputs.now);
    if (det) {
      triggeredManeuver = {
        kind: det.kind === 'TACK' ? 1 : 2,
        startMs: det.startMs,
        endMs: det.endMs,
      };
    }
  }

  // 2. Detect auto sail switch — only if no maneuver active or triggered, and no transition
  let triggeredSailChange:
    | { currentSail: SailId; transitionStartMs: number; transitionEndMs: number }
    | undefined;
  let finalSail: SailId = inputs.currentSail;
  if (
    inputs.sailAuto &&
    !triggeredManeuver &&
    !wasManeuvering &&
    !wasTransitioning
  ) {
    const optimal = pickOptimalSail(inputs.polar, newTwa, inputs.tws);
    if (optimal !== inputs.currentSail) {
      const twaAbs = Math.min(Math.abs(newTwa), 180);
      const activeBsp = getPolarSpeed(inputs.polar, inputs.currentSail, twaAbs, inputs.tws);
      const optimalBsp = getPolarSpeed(inputs.polar, optimal, twaAbs, inputs.tws);
      const threshold = GameBalance.sails.overlapThreshold;
      const shouldSwitch = activeBsp <= 0 || optimalBsp / activeBsp > threshold;
      if (shouldSwitch) {
        const dur = getTransitionDuration(inputs.currentSail, optimal);
        triggeredSailChange = {
          currentSail: optimal,
          transitionStartMs: inputs.now,
          transitionEndMs: inputs.now + dur * 1000,
        };
        finalSail = optimal;
      }
    }
  }

  // 3. Compute BSP — polar × bspBaseMultiplier × maneuverFactor × transitionFactor
  const polarBase = getPolarSpeed(inputs.polar, finalSail, Math.min(Math.abs(newTwa), 180), inputs.tws);
  let bsp = polarBase * inputs.bspBaseMultiplier;

  const activeManeuverKind: 0 | 1 | 2 = triggeredManeuver
    ? triggeredManeuver.kind
    : wasManeuvering
      ? inputs.maneuverKind
      : 0;
  if (activeManeuverKind === 1) {
    bsp *= GameBalance.maneuvers.tack.speedFactor;
  } else if (activeManeuverKind === 2) {
    bsp *= GameBalance.maneuvers.gybe.speedFactor;
  }

  if (triggeredSailChange || wasTransitioning) {
    bsp *= GameBalance.sails.transitionPenalty;
  }

  return {
    hud: {
      hdg: inputs.newHdg,
      twa: newTwa,
      bsp,
    },
    sail: {
      ...(triggeredSailChange ? { sailChange: triggeredSailChange } : {}),
      ...(triggeredManeuver ? { maneuver: triggeredManeuver } : {}),
    },
  };
}
