// apps/web/src/lib/projection/simulate.ts
import { GameBalance } from '@nemo/game-balance/browser';
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

function findBracket(arr: number[], value: number): { i0: number; i1: number; t: number } {
  if (value <= arr[0]!) return { i0: 0, i1: 0, t: 0 };
  if (value >= arr[arr.length - 1]!) {
    const last = arr.length - 1;
    return { i0: last, i1: last, t: 0 };
  }
  for (let i = 0; i < arr.length - 1; i++) {
    if (value >= arr[i]! && value <= arr[i + 1]!) {
      const span = arr[i + 1]! - arr[i]!;
      return { i0: i, i1: i + 1, t: span === 0 ? 0 : (value - arr[i]!) / span };
    }
  }
  return { i0: 0, i1: 0, t: 0 };
}

export function getPolarSpeed(polar: PolarData, sail: string, twa: number, tws: number): number {
  const absTwa = Math.min(Math.abs(twa), 180);
  const sailSpeeds = polar.speeds[sail];
  // Unavailable sail (e.g., Cruiser Racer only has JIB/SPI) → 0.
  if (!sailSpeeds || !Array.isArray(sailSpeeds)) return 0;
  return getPolarSpeedFromGrid(sailSpeeds, polar.twa, polar.tws, absTwa, tws);
}

function getPolarSpeedFromGrid(
  speeds: number[][],
  twaAxis: number[],
  twsAxis: number[],
  absTwa: number,
  tws: number,
): number {
  // Dead zone: below the first TWA in the polar axis → 0 (face-to-wind).
  const minTwa = twaAxis[0];
  if (minTwa !== undefined && absTwa < minTwa) return 0;
  const a = findBracket(twaAxis, absTwa);
  const s = findBracket(twsAxis, tws);

  const r0 = speeds[a.i0];
  const r1 = speeds[a.i1];
  if (!Array.isArray(r0) || !Array.isArray(r1)) return 0;
  const v00 = r0[s.i0] ?? 0;
  const v01 = r0[s.i1] ?? 0;
  const v10 = r1[s.i0] ?? 0;
  const v11 = r1[s.i1] ?? 0;

  const top = v00 * (1 - s.t) + v01 * s.t;
  const bot = v10 * (1 - s.t) + v11 * s.t;
  return top * (1 - a.t) + bot * a.t;
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

// ── TWA/TWS band selection (matches game-engine bands.ts) ──

function bandFor(value: number, thresholds: readonly number[]): number {
  let band = 0;
  for (const t of thresholds) {
    if (value >= t) band++;
    else break;
  }
  return band;
}

// ── Wear calculation (port of wear.ts, minus driveMode) ──

export interface ConditionState {
  hull: number;
  rig: number;
  sails: number;
  electronics: number;
}

function windWearMultiplier(tws: number): number {
  const { thresholdKnots, maxFactor, scaleKnots } = GameBalance.wear.windMultipliers;
  if (tws <= thresholdKnots) return 1.0;
  const excess = (tws - thresholdKnots) / scaleKnots;
  return Math.min(maxFactor, 1 + excess * (maxFactor - 1));
}

function swellWearMultiplier(swh: number, swellDir: number, heading: number, swellPeriod: number): number {
  const cfg = GameBalance.wear.swellMultipliers;
  if (swh <= cfg.thresholdMeters) return 1.0;
  const encounterAngle = Math.abs(((heading - swellDir + 540) % 360) - 180);
  const faceBlend = encounterAngle / 180;
  const dirFactor = cfg.dirBackMin + (cfg.dirFaceMax - cfg.dirBackMin) * faceBlend;
  const heightFactor = Math.min(swh / cfg.maxHeightMeters, 1);
  const periodFactor = swellPeriod > 0 && swellPeriod < cfg.shortPeriodThreshold ? cfg.shortPeriodFactor : 1.0;
  return 1 + dirFactor * heightFactor * periodFactor;
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

  return {
    hull: wear.baseRatesPerHour.hull * hoursFraction * windMul * swellMul * effects.wearMul.hull,
    rig: wear.baseRatesPerHour.rig * hoursFraction * windMul * effects.wearMul.rig,
    sails: wear.baseRatesPerHour.sails * hoursFraction * windMul * effects.wearMul.sail,
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
  const worst = Math.min(c.hull, c.rig, c.sails);
  if (worst >= thresholdNone) return 1.0;
  const pointsLost = thresholdNone - worst;
  const pct = Math.min(GameBalance.wear.maxSpeedPenalty, pointsLost * slopePerPoint);
  const clampedPct = worst <= thresholdMax ? GameBalance.wear.maxSpeedPenalty : pct;
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

// ── Full speed chain (matches tick.ts bspMultiplier) ──

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
): number {
  const baseBsp = getPolarSpeed(polar, sail, twa, tws);
  const twaBand = bandFor(Math.abs(twa), [60, 90, 120, 150]);
  const twsBand = bandFor(tws, [10, 20]);

  const multiplier =
    effects.speedByTwa[twaBand]! *
    effects.speedByTws[twsBand]! *
    conditionSpeedPenalty(condition) *
    maneuverSpeedFactor(maneuver, nowMs) *
    transitionSpeedFactor(transition, nowMs, effects);

  return baseBsp * multiplier;
}
