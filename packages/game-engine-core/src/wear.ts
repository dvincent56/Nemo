import type { WeatherPoint } from '@nemo/shared-types';
import { GameBalance } from '@nemo/game-balance/browser';
import type { AggregatedEffects } from './loadout';

export interface ConditionState {
  hull: number;
  rig: number;
  sails: number;
  electronics: number;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

function lerp(x: number, x0: number, x1: number, y0: number, y1: number): number {
  if (x1 === x0) return y0;
  const t = clamp01((x - x0) / (x1 - x0));
  return y0 + t * (y1 - y0);
}

/**
 * Courbe d'usure vent :
 *  - TWS < zeroBelow : 0
 *  - TWS zeroBelow → rampEnd : 0 → midFactor
 *  - TWS rampEnd → midEnd : midFactor → highFactor
 *  - TWS midEnd → stormEnd : highFactor → stormFactor
 *  - TWS > stormEnd : stormFactor (plafond)
 */
function windWearMultiplier(tws: number): number {
  const cfg = GameBalance.wear.windMultipliers;
  if (tws <= cfg.zeroBelowKnots) return 0;
  if (tws <= cfg.rampEndKnots) return lerp(tws, cfg.zeroBelowKnots, cfg.rampEndKnots, 0, cfg.midFactor);
  if (tws <= cfg.midEndKnots) return lerp(tws, cfg.rampEndKnots, cfg.midEndKnots, cfg.midFactor, cfg.highFactor);
  if (tws <= cfg.stormEndKnots) return lerp(tws, cfg.midEndKnots, cfg.stormEndKnots, cfg.highFactor, cfg.stormFactor);
  return cfg.stormFactor;
}

/**
 * Courbe d'usure houle :
 *  - Hs < zeroBelow : 0
 *  - Hs zeroBelow → rampEnd : 0 → midFactor
 *  - Hs rampEnd → midEnd : midFactor → highFactor
 *  - Hs > midEnd : highFactor (plafond)
 * Modulation :
 *  - Période courte (Tp < thresholdSec) : +shortPeriodBonus (multiplicatif)
 *  - Direction : face ×1.5, travers ×1.0, arrière ×0.5
 *  - mwd = direction FROM which waves come (WW3 convention). Encounter angle
 *    = |((heading − mwd + 540) % 360) − 180|. 0° = waves at bow, 180° = waves astern.
 */
function swellWearMultiplier(w: WeatherPoint, heading: number): number {
  const cfg = GameBalance.wear.swellMultipliers;
  if (w.swh <= cfg.zeroBelowMeters) return 0;

  let heightMul: number;
  if (w.swh <= cfg.rampEndMeters) {
    heightMul = lerp(w.swh, cfg.zeroBelowMeters, cfg.rampEndMeters, 0, cfg.midFactor);
  } else if (w.swh <= cfg.midEndMeters) {
    heightMul = lerp(w.swh, cfg.rampEndMeters, cfg.midEndMeters, cfg.midFactor, cfg.highFactor);
  } else {
    heightMul = cfg.highFactor;
  }

  const encounter = Math.abs(((heading - w.mwd + 540) % 360) - 180);
  // encounter 0 = vagues en poupe (arrière), 180 = face
  let dirFactor: number;
  if (encounter <= 60) dirFactor = cfg.dirBackFactor;
  else if (encounter >= 120) dirFactor = cfg.dirFaceFactor;
  else dirFactor = cfg.dirBeamFactor;

  const periodFactor = w.mwp > 0 && w.mwp < cfg.shortPeriodThresholdSec
    ? (1 + cfg.shortPeriodBonus)
    : 1.0;

  return heightMul * dirFactor * periodFactor;
}

/**
 * BSP modulation by swell (speed factor, not wear).
 * Inchangé — même signature, même logique que l'ancienne version. Exporté pour
 * consommation par tick.ts.
 */
export function swellSpeedFactor(swh: number, mwd: number, heading: number): number {
  const cfg = GameBalance.swell;
  if (swh <= cfg.thresholdMeters) return 1.0;
  const span = cfg.maxHeightMeters - cfg.thresholdMeters;
  const h = span > 0 ? Math.min(1, Math.max(0, (swh - cfg.thresholdMeters) / span)) : 1;
  const rel = Math.abs(((heading - mwd + 540) % 360) - 180);

  if (rel < cfg.headSectorDeg) {
    const coef = 1 - rel / cfg.headSectorDeg;
    return 1 - (cfg.maxSpeedMalus / 100) * h * coef;
  }
  if (rel > 180 - cfg.followingSectorDeg) {
    const coef = 1 - (180 - rel) / cfg.followingSectorDeg;
    return 1 + (cfg.maxSpeedBonus / 100) * h * coef;
  }
  const zoneLow = cfg.headSectorDeg;
  const zoneHigh = 180 - cfg.followingSectorDeg;
  const zoneCentre = (zoneLow + zoneHigh) / 2;
  const zoneHalf = (zoneHigh - zoneLow) / 2;
  const coef = zoneHalf > 0 ? 1 - Math.abs(rel - zoneCentre) / zoneHalf : 0;
  return 1 - (cfg.sideMaxMalus / 100) * h * coef;
}

/**
 * Calcule la perte de condition (points par composant) pour un tick.
 * Les multiplicateurs vent et houle sont ADDITIFS (pas multiplicatifs) pour éviter
 * l'explosion combinée : mer 8m sous 50 kt = 5 + 2.5 = 7.5×, pas 12.5×.
 * En mer calme (TWS < 15, Hs < 1.5) l'usure structurelle est exactement 0 ;
 * seule l'électronique a un taux de base indépendant de la météo.
 */
export function computeWearDelta(
  weather: WeatherPoint,
  heading: number,
  dtSec: number,
  loadoutEffects: AggregatedEffects,
): ConditionState {
  const wear = GameBalance.wear;
  const hoursFraction = dtSec / 3600;
  const weatherMul = windWearMultiplier(weather.tws) + swellWearMultiplier(weather, heading);

  const hullMul  = weatherMul * loadoutEffects.wearMul.hull;
  const rigMul   = weatherMul * loadoutEffects.wearMul.rig;
  const sailsMul = weatherMul * loadoutEffects.wearMul.sail;
  const elecMul  = loadoutEffects.wearMul.elec; // électronique : pas de lien météo, taux de base constant

  return {
    hull:        wear.baseRatesPerHour.hull        * hoursFraction * hullMul,
    rig:         wear.baseRatesPerHour.rig         * hoursFraction * rigMul,
    sails:       wear.baseRatesPerHour.sails       * hoursFraction * sailsMul,
    electronics: wear.baseRatesPerHour.electronics * hoursFraction * elecMul,
  };
}

export function applyWear(current: ConditionState, delta: ConditionState): ConditionState {
  const floor = GameBalance.wear.minCondition;
  return {
    hull: Math.max(floor, current.hull - delta.hull),
    rig: Math.max(floor, current.rig - delta.rig),
    sails: Math.max(floor, current.sails - delta.sails),
    electronics: Math.max(floor, current.electronics - delta.electronics),
  };
}

/**
 * Pénalité de vitesse basée sur une moyenne pondérée des composants vitesse-critiques.
 * conditionAvg = 0.5 × sails + 0.3 × rig + 0.2 × hull
 * Au-dessus de thresholdNone (85) : 0% de pénalité.
 * À thresholdMax (50) ou en dessous : maxSpeedPenalty (8%).
 * Linéaire entre les deux.
 * Electronics n'entre pas dans le calcul vitesse.
 */
export function conditionSpeedPenalty(c: ConditionState): number {
  const { thresholdNone, thresholdMax, slopePerPoint } = GameBalance.wear.penaltyCurve;
  const w = GameBalance.wear.componentWeights;
  const avg = w.sails * c.sails + w.rig * c.rig + w.hull * c.hull;
  if (avg >= thresholdNone) return 1.0;
  const pointsLost = thresholdNone - avg;
  const pct = Math.min(GameBalance.wear.maxSpeedPenalty, pointsLost * slopePerPoint);
  const clampedPct = avg <= thresholdMax ? GameBalance.wear.maxSpeedPenalty : pct;
  return 1 - clampedPct / 100;
}

/**
 * Conditions de départ d'une course : tous composants à 100.
 * À utiliser partout où un BoatRuntime démarre (inscription, hydratation, dev simulator).
 */
export const INITIAL_CONDITIONS: Readonly<ConditionState> = Object.freeze({
  hull: 100,
  rig: 100,
  sails: 100,
  electronics: 100,
});
