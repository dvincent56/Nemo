// apps/web/src/lib/projection/simulate.ts
import { GameBalance } from '@nemo/game-balance/browser';
import { computeBsp as computeBaseBsp, getPolarSpeed as polarLibGetPolarSpeed } from '@nemo/game-engine-core/browser';
import type { Polar, SailId } from '@nemo/shared-types';
import type { ProjectionEffects } from './types';
import type { WeatherAtPoint } from './windLookup';

// ── Constants ──

const EARTH_RADIUS_NM = 3440.065;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

// ── Position advance (rhumb-line) ──

export interface Position {
  lat: number;
  lon: number;
}

export function advancePosition(pos: Position, heading: number, bsp: number, dtSeconds: number): Position {
  const distNm = (bsp * dtSeconds) / 3600;
  const distRad = distNm / EARTH_RADIUS_NM;
  const lat1 = pos.lat * DEG_TO_RAD;
  const lon1 = pos.lon * DEG_TO_RAD;
  const brg = heading * DEG_TO_RAD;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(distRad) + Math.cos(lat1) * Math.sin(distRad) * Math.cos(brg),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(brg) * Math.sin(distRad) * Math.cos(lat1),
      Math.cos(distRad) - Math.sin(lat1) * Math.sin(lat2),
    );

  return {
    lat: lat2 * RAD_TO_DEG,
    lon: ((lon2 * RAD_TO_DEG + 540) % 360) - 180,
  };
}

// ── TWA ──

export function computeTWA(heading: number, twd: number): number {
  let twa = ((heading - twd + 540) % 360) - 180;
  if (twa === -180) twa = 180;
  return twa;
}

// ── Polar lookup (bilinear interpolation) ──

export interface PolarData {
  twa: number[];
  tws: number[];
  speeds: Record<string, number[][]>;
}

// Delegates to @nemo/polar-lib/browser — single source of truth with the
// engine tick and routing. The thin wrapper exists only to accept the
// projection's looser PolarData / sail typing at the worker boundary;
// the interpolation math is defined once, in polar-lib.
export function getPolarSpeed(polar: PolarData, sail: string, twa: number, tws: number): number {
  if (!polar.speeds[sail]) return 0;
  return polarLibGetPolarSpeed(polar as unknown as Polar, sail as SailId, twa, tws);
}

/** Compute BSP max across all TWA/TWS combinations for gradient normalization. */
export function computeBspMax(polar: PolarData): number {
  let max = 0;
  if (!polar.speeds || typeof polar.speeds !== 'object') return 0;
  for (const sailSpeeds of Object.values(polar.speeds)) {
    if (!Array.isArray(sailSpeeds)) continue;
    for (const row of sailSpeeds) {
      if (!Array.isArray(row)) continue;
      for (const v of row) {
        if (typeof v === 'number' && v > max) max = v;
      }
    }
  }
  return max;
}

// ── Wear calculation (port of wear.ts, minus driveMode) ──

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

function windWearMultiplier(tws: number): number {
  const cfg = GameBalance.wear.windMultipliers;
  if (tws <= cfg.zeroBelowKnots) return 0;
  if (tws <= cfg.rampEndKnots) return lerp(tws, cfg.zeroBelowKnots, cfg.rampEndKnots, 0, cfg.midFactor);
  if (tws <= cfg.midEndKnots) return lerp(tws, cfg.rampEndKnots, cfg.midEndKnots, cfg.midFactor, cfg.highFactor);
  if (tws <= cfg.stormEndKnots) return lerp(tws, cfg.midEndKnots, cfg.stormEndKnots, cfg.highFactor, cfg.stormFactor);
  return cfg.stormFactor;
}

function swellWearMultiplier(swh: number, swellDir: number, heading: number, swellPeriod: number): number {
  const cfg = GameBalance.wear.swellMultipliers;
  if (swh <= cfg.zeroBelowMeters) return 0;

  let heightMul: number;
  if (swh <= cfg.rampEndMeters) {
    heightMul = lerp(swh, cfg.zeroBelowMeters, cfg.rampEndMeters, 0, cfg.midFactor);
  } else if (swh <= cfg.midEndMeters) {
    heightMul = lerp(swh, cfg.rampEndMeters, cfg.midEndMeters, cfg.midFactor, cfg.highFactor);
  } else {
    heightMul = cfg.highFactor;
  }

  const encounter = Math.abs(((heading - swellDir + 540) % 360) - 180);
  // encounter 0 = waves astern, 180 = waves at bow
  let dirFactor: number;
  if (encounter <= 60) dirFactor = cfg.dirBackFactor;
  else if (encounter >= 120) dirFactor = cfg.dirFaceFactor;
  else dirFactor = cfg.dirBeamFactor;

  const periodFactor = swellPeriod > 0 && swellPeriod < cfg.shortPeriodThresholdSec
    ? (1 + cfg.shortPeriodBonus)
    : 1.0;

  return heightMul * dirFactor * periodFactor;
}

/**
 * BSP modulation by swell — mirrors game-engine/src/engine/wear.ts::swellSpeedFactor.
 * Kept in sync so the projection line reflects the same physics as the live engine.
 */
function swellSpeedFactor(swh: number, swellDir: number, heading: number): number {
  const cfg = GameBalance.swell;
  if (swh <= cfg.thresholdMeters) return 1.0;
  const span = cfg.maxHeightMeters - cfg.thresholdMeters;
  const h = span > 0 ? Math.max(0, Math.min(1, (swh - cfg.thresholdMeters) / span)) : 1;
  const rel = Math.abs(((heading - swellDir + 540) % 360) - 180);

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

export function computeWearDelta(
  weather: WeatherAtPoint,
  heading: number,
  dtSec: number,
  effects: ProjectionEffects,
): ConditionState {
  const wear = GameBalance.wear;
  const hoursFraction = dtSec / 3600;
  const windMul = windWearMultiplier(weather.tws);
  const swellMul = swellWearMultiplier(weather.swh, weather.swellDir, heading, weather.swellPeriod);
  const weatherMul = windMul + swellMul;

  return {
    hull:        wear.baseRatesPerHour.hull        * hoursFraction * weatherMul * effects.wearMul.hull,
    rig:         wear.baseRatesPerHour.rig         * hoursFraction * weatherMul * effects.wearMul.rig,
    sails:       wear.baseRatesPerHour.sails       * hoursFraction * weatherMul * effects.wearMul.sail,
    electronics: wear.baseRatesPerHour.electronics * hoursFraction * effects.wearMul.elec,
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

// ── Maneuver detection (port of sails.ts) ──

export interface ManeuverState {
  endMs: number;
  speedFactor: number;
}

export function detectManeuver(
  prevTwa: number,
  newTwa: number,
  boatClass: string,
  nowMs: number,
  effects: ProjectionEffects,
): ManeuverState | null {
  const prevSign = Math.sign(prevTwa);
  const newSign = Math.sign(newTwa);
  if (prevSign === 0 || newSign === 0 || prevSign === newSign) return null;

  const isTack = Math.abs(newTwa) < 90;
  const cfg = isTack ? GameBalance.maneuvers.tack : GameBalance.maneuvers.gybe;
  const manKey = isTack ? 'tack' : 'gybe' as const;
  const baseDuration = (cfg.durationSec as Record<string, number>)[boatClass] ?? 30;
  const baseSpeed = cfg.speedFactor;
  const durationMs = baseDuration * effects.maneuverMul[manKey].dur * 1000;
  return {
    endMs: nowMs + durationMs,
    speedFactor: baseSpeed * effects.maneuverMul[manKey].speed,
  };
}

export function maneuverSpeedFactor(maneuver: ManeuverState | null, nowMs: number): number {
  if (!maneuver || nowMs >= maneuver.endMs) return 1.0;
  return maneuver.speedFactor;
}

// ── Sail transition penalty ──

export function transitionSpeedFactor(transition: { endMs: number; speedFactor: number } | null, nowMs: number, effects: ProjectionEffects): number {
  if (!transition || nowMs >= transition.endMs) return 1.0;
  return GameBalance.sails.transitionPenalty * effects.maneuverMul.sailChange.speed;
}

// ── Full speed chain = engine-core base × projection-only transients ──
// Base (polar × condition × TWA/TWS bands) comes from the shared speed
// model in @nemo/game-engine-core — single source of truth with runTick
// and the routing engine. Transient factors (manoeuvre, sail transition,
// swell) are layered on top here because they're specific to the forward
// projection and not available to the routing engine.

export function computeBsp(
  polar: PolarData,
  sail: string,
  twa: number,
  tws: number,
  condition: ConditionState,
  effects: ProjectionEffects,
  maneuver: ManeuverState | null,
  transition: { endMs: number; speedFactor: number } | null,
  nowMs: number,
  weather?: { swh: number; swellDir: number },
  heading?: number,
): number {
  const base = computeBaseBsp(polar as unknown as Polar, sail as SailId, twa, tws, effects, condition);
  const swellFactor = weather && heading !== undefined
    ? swellSpeedFactor(weather.swh, weather.swellDir, heading)
    : 1;

  return base
    * maneuverSpeedFactor(maneuver, nowMs)
    * transitionSpeedFactor(transition, nowMs, effects)
    * swellFactor;
}
