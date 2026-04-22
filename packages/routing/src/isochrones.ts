// packages/routing/src/isochrones.ts
import type { Polar, SailId } from '@nemo/shared-types';
import {
  CoastlineIndex,
  aggregateEffects,
  computeBsp,
  type BoatLoadout,
  type ConditionState,
} from '@nemo/game-engine-core/browser';
import { advancePosition, computeTWA, haversineNM } from '@nemo/polar-lib/browser';
import { pruneBySector } from './pruning';
import { backtrackPolyline, extractInflectionPoints } from './polyline';
import { buildCapSchedule } from './schedule';
import { sampleWind } from './weatherSampler';
import { PRESETS } from './presets';
import type {
  IsochronePoint, RouteInput, RoutePlan,
} from './types';

const INFLECTION_DEG = 5;

function nearestIdx(arr: readonly number[], v: number): number {
  let best = 0, bestDiff = Infinity;
  for (let i = 0; i < arr.length; i++) {
    const d = Math.abs(arr[i]! - v);
    if (d < bestDiff) { bestDiff = d; best = i; }
  }
  return best;
}

function pickOptimalSailForRouting(polar: Polar, twaAbs: number, tws: number): SailId {
  let best: SailId | null = null;
  let bestBsp = -1;
  for (const sail of Object.keys(polar.speeds) as SailId[]) {
    const table = polar.speeds[sail as SailId];
    if (!table) continue;
    const twaIdx = nearestIdx(polar.twa, twaAbs);
    const twsIdx = nearestIdx(polar.tws, tws);
    const row = table[twaIdx];
    if (!row) continue;
    const v = row[twsIdx] ?? 0;
    if (v > bestBsp) { bestBsp = v; best = sail; }
  }
  return best ?? ('JIB' as SailId);
}

export async function computeRoute(input: RouteInput): Promise<RoutePlan> {
  const t0 = Date.now();
  const params = PRESETS[input.preset];
  const { timeStepSec, headingCount, horizonSec, sectorCount } = params;
  const stepHeading = 360 / headingCount;

  const coastline = new CoastlineIndex();
  coastline.loadFromGeoJson(input.coastlineGeoJson);

  const effects = aggregateEffects(input.loadout.items);
  // Arrival radius: the distance within which a candidate is considered to
  // have "reached" the target. Use a conservative 5 NM/h × step size so
  // the radius scales with resolution without admitting far-off candidates.
  // bspMax-based radii (bspMax * step / 2) are too generous at coarse steps.
  const arrivalRadiusNm = Math.max(1, (timeStepSec / 3600) * 5);

  // Initial sample for iso[0] metadata
  const initSample = sampleWind(input.windGrid, input.windData, input.from.lat, input.from.lon, input.startTimeMs);
  const initTws = initSample?.tws ?? 0;
  const initTwd = initSample?.twd ?? 0;

  const isochrones: IsochronePoint[][] = [[{
    lat: input.from.lat, lon: input.from.lon, hdg: 0, bsp: 0,
    tws: initTws, twd: initTwd, twa: 0, sail: 'JIB' as SailId,
    timeMs: input.startTimeMs, distFromStartNm: 0, parentIdx: -1,
  }]];

  const maxSteps = Math.ceil(horizonSec / timeStepSec);
  let arrivalStep = -1;
  let arrivalPoint: IsochronePoint | null = null;

  for (let step = 1; step <= maxSteps; step++) {
    const prev = isochrones[step - 1]!;
    const candidates: IsochronePoint[] = [];

    for (let idx = 0; idx < prev.length; idx++) {
      const p = prev[idx]!;
      const weather = sampleWind(input.windGrid, input.windData, p.lat, p.lon, p.timeMs);
      if (!weather) continue;

      for (let h = 0; h < 360; h += stepHeading) {
        const twa = computeTWA(h, weather.twd);
        const twaAbs = Math.min(Math.abs(twa), 180);
        if (input.polar.twa[0] !== undefined && twaAbs < input.polar.twa[0]) continue;
        const sail = pickOptimalSailForRouting(input.polar, twaAbs, weather.tws);
        const bsp = computeBsp(input.polar, sail, twa, weather.tws, effects, input.condition);
        if (bsp < 0.1) continue;

        const distNm = bsp * (timeStepSec / 3600);
        const newPos = advancePosition({ lat: p.lat, lon: p.lon }, h, bsp, timeStepSec);
        if (coastline.segmentCrossesCoast({ lat: p.lat, lon: p.lon }, newPos)) continue;

        candidates.push({
          lat: newPos.lat, lon: newPos.lon, hdg: h, bsp,
          tws: weather.tws, twd: weather.twd, twa, sail,
          timeMs: p.timeMs + timeStepSec * 1000,
          distFromStartNm: p.distFromStartNm + distNm,
          parentIdx: idx,
        });
      }
    }

    const pruned = pruneBySector(candidates, input.from, sectorCount);
    isochrones.push(pruned);

    // Among all pruned candidates within arrival radius, pick the one
    // closest to the target rather than the first match in array order.
    let hit: IsochronePoint | null = null;
    let hitDist = Infinity;
    for (const q of pruned) {
      const d = haversineNM({ lat: q.lat, lon: q.lon }, input.to);
      if (d <= arrivalRadiusNm && d < hitDist) { hitDist = d; hit = q; }
    }
    if (hit) {
      arrivalStep = step;
      arrivalPoint = hit;
      break;
    }
  }

  const reachedGoal = arrivalPoint !== null;
  if (!arrivalPoint) {
    const last = isochrones[isochrones.length - 1]!;
    if (last.length === 0) {
      // Nothing reachable — return empty plan
      return {
        reachedGoal: false,
        polyline: [{
          lat: input.from.lat, lon: input.from.lon, timeMs: input.startTimeMs,
          twa: 0, tws: initTws, bsp: 0, sail: 'JIB' as SailId,
        }],
        waypoints: [{ lat: input.from.lat, lon: input.from.lon }],
        capSchedule: [],
        isochrones,
        totalDistanceNm: 0,
        eta: Number.POSITIVE_INFINITY,
        preset: input.preset,
        computeTimeMs: Date.now() - t0,
      };
    }
    let best = last[0]!;
    let bestDist = haversineNM({ lat: best.lat, lon: best.lon }, input.to);
    for (const q of last) {
      const d = haversineNM({ lat: q.lat, lon: q.lon }, input.to);
      if (d < bestDist) { bestDist = d; best = q; }
    }
    arrivalPoint = best;
    arrivalStep = isochrones.length - 1;
  }

  const polyline = backtrackPolyline(isochrones, arrivalPoint, arrivalStep);
  const waypoints = extractInflectionPoints(polyline, INFLECTION_DEG);
  const capSchedule = buildCapSchedule(polyline, INFLECTION_DEG);
  const eta = reachedGoal ? arrivalPoint.timeMs : Number.POSITIVE_INFINITY;
  const totalDistanceNm = arrivalPoint.distFromStartNm;

  return {
    reachedGoal, polyline, waypoints, capSchedule, isochrones,
    totalDistanceNm, eta, preset: input.preset,
    computeTimeMs: Date.now() - t0,
  };
}

// Suppress unused import warning — types used in signatures above.
export type { BoatLoadout, ConditionState };
