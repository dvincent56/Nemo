import type { DriveMode, WeatherPoint } from '@nemo/shared-types';
import { GameBalance } from '@nemo/game-balance';

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
  driveMode: DriveMode,
  dtSec: number,
  upgrades: ReadonlySet<string>,
): ConditionState {
  const wear = GameBalance.wear;
  const hoursFraction = dtSec / 3600;
  const windMul = windMultiplier(weather.tws);
  const swellMul = swellMultiplier(weather, heading);
  const driveMul = wear.driveModeMultipliers[driveMode];
  const mult = wear.upgradeMultipliers;

  let hullMul = windMul * swellMul;
  let rigMul = windMul;
  let sailsMul = windMul;
  const elecMul = 1.0;

  if (upgrades.has('FOILS')) { rigMul *= mult['foils_rig'] ?? 1; hullMul *= mult['foils_hull'] ?? 1; }
  if (upgrades.has('REINFORCED_HULL')) { hullMul *= mult['reinforced_hull'] ?? 1; }
  if (upgrades.has('KEVLAR_SAILS')) { sailsMul *= mult['kevlar_sails'] ?? 1; }
  if (upgrades.has('CARBON_RIG')) {
    const threshold = mult['carbon_threshold_kts'] ?? 30;
    rigMul *= weather.tws > threshold ? (mult['carbon_rig_strong'] ?? 1) : (mult['carbon_rig_normal'] ?? 1);
  }
  if (upgrades.has('HEAVY_WEATHER_KIT')) {
    rigMul *= mult['heavy_weather_rig'] ?? 1;
    sailsMul *= mult['heavy_weather_sails'] ?? 1;
  }

  return {
    hull: wear.baseRatesPerHour.hull * hoursFraction * hullMul * driveMul,
    rig: wear.baseRatesPerHour.rig * hoursFraction * rigMul * driveMul,
    sails: wear.baseRatesPerHour.sails * hoursFraction * sailsMul * driveMul,
    electronics: wear.baseRatesPerHour.electronics * hoursFraction * elecMul * driveMul,
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
