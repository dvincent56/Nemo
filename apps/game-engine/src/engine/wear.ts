import type { WeatherPoint } from '@nemo/shared-types';
import { GameBalance } from '@nemo/game-balance';
import type { AggregatedEffects } from './loadout.js';

export interface ConditionState {
  hull: number;
  rig: number;
  sails: number;
  electronics: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

function windMultiplier(tws: number): number {
  const { thresholdKnots, maxFactor, scaleKnots } = GameBalance.wear.windMultipliers;
  if (tws <= thresholdKnots) return 1.0;
  const excess = (tws - thresholdKnots) / scaleKnots;
  return Math.min(maxFactor, 1 + excess * (maxFactor - 1));
}

/**
 * BSP modulation by swell.
 * - swh ≤ thresholdMeters : no effect (calm sea)
 * - Head sea (encounter ∈ [0, headSectorDeg]) : malus up to maxSpeedMalus %,
 *   peaks at bow, tapers linearly to 0 at the sector edge
 * - Following sea (encounter ∈ [180 − followingSectorDeg, 180]) : bonus up
 *   to maxSpeedBonus %, peaks astern
 * - Beam (in between) : malus up to sideMaxMalus %, peaks mid-sector
 * Intensity ramps 0→1 between thresholdMeters and maxHeightMeters.
 *
 * `mwd` is direction waves come FROM (GFS WW3 convention, same as wind).
 * Encounter angle 0° = swell hits bow, 180° = swell pushes stern.
 */
export function swellSpeedFactor(swh: number, mwd: number, heading: number): number {
  const cfg = GameBalance.swell;
  if (swh <= cfg.thresholdMeters) return 1.0;
  const span = cfg.maxHeightMeters - cfg.thresholdMeters;
  const h = span > 0 ? clamp((swh - cfg.thresholdMeters) / span, 0, 1) : 1;
  const rel = Math.abs(((heading - mwd + 540) % 360) - 180);

  if (rel < cfg.headSectorDeg) {
    const coef = 1 - rel / cfg.headSectorDeg;
    return 1 - (cfg.maxSpeedMalus / 100) * h * coef;
  }
  if (rel > 180 - cfg.followingSectorDeg) {
    const coef = 1 - (180 - rel) / cfg.followingSectorDeg;
    return 1 + (cfg.maxSpeedBonus / 100) * h * coef;
  }
  // Beam sector — between the head and following sectors. Peak malus at centre.
  const zoneLow = cfg.headSectorDeg;
  const zoneHigh = 180 - cfg.followingSectorDeg;
  const zoneCentre = (zoneLow + zoneHigh) / 2;
  const zoneHalf = (zoneHigh - zoneLow) / 2;
  const coef = zoneHalf > 0 ? 1 - Math.abs(rel - zoneCentre) / zoneHalf : 0;
  return 1 - (cfg.sideMaxMalus / 100) * h * coef;
}

function swellMultiplier(w: WeatherPoint, heading: number): number {
  const cfg = GameBalance.wear.swellMultipliers;
  if (w.swh <= cfg.thresholdMeters) return 1.0;
  const encounterAngle = Math.abs(((heading - w.mwd + 540) % 360) - 180);
  const faceBlend = encounterAngle / 180;
  const dirFactor = cfg.dirBackMin + (cfg.dirFaceMax - cfg.dirBackMin) * faceBlend;
  const heightFactor = clamp(w.swh / cfg.maxHeightMeters, 0, 1);
  const periodFactor = w.mwp > 0 && w.mwp < cfg.shortPeriodThreshold ? cfg.shortPeriodFactor : 1.0;
  return 1 + dirFactor * heightFactor * periodFactor;
}

/**
 * Calcule la perte de condition (points par composant) pour un tick.
 * Retourne un delta positif à soustraire.
 */
export function computeWearDelta(
  weather: WeatherPoint,
  heading: number,
  dtSec: number,
  loadoutEffects: AggregatedEffects,
): ConditionState {
  const wear = GameBalance.wear;
  const hoursFraction = dtSec / 3600;
  const windMul = windMultiplier(weather.tws);
  const swellMul = swellMultiplier(weather, heading);

  const hullMul  = windMul * swellMul * loadoutEffects.wearMul.hull;
  const rigMul   = windMul            * loadoutEffects.wearMul.rig;
  const sailsMul = windMul            * loadoutEffects.wearMul.sail;
  const elecMul  = loadoutEffects.wearMul.elec; // no weather multiplier on electronics (by design)

  return {
    hull: wear.baseRatesPerHour.hull * hoursFraction * hullMul,
    rig: wear.baseRatesPerHour.rig * hoursFraction * rigMul,
    sails: wear.baseRatesPerHour.sails * hoursFraction * sailsMul,
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
 * Pénalité de vitesse selon la pire condition parmi hull/rig/sails.
 * Au-dessus de thresholdNone (60) : 0. À thresholdMax (35) : maxSpeedPenalty (15%).
 * Linéaire entre les deux.
 */
export function conditionSpeedPenalty(c: ConditionState): number {
  const { thresholdNone, thresholdMax, slopePerPoint } = GameBalance.wear.penaltyCurve;
  const worst = Math.min(c.hull, c.rig, c.sails);
  if (worst >= thresholdNone) return 1.0;
  const pointsLost = thresholdNone - worst;
  const pct = Math.min(GameBalance.wear.maxSpeedPenalty, pointsLost * slopePerPoint);
  const clampedPct = worst <= thresholdMax ? GameBalance.wear.maxSpeedPenalty : pct;
  return 1 - clampedPct / 100;
}
