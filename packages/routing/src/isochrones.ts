// packages/routing/src/isochrones.ts
import type { Polar, SailId } from '@nemo/shared-types';
import {
  CoastlineIndex,
  aggregateEffects,
  computeBsp,
  detectManeuver,
  swellSpeedFactor,
  type BoatLoadout,
  type ConditionState,
  type ManeuverPenaltyState,
} from '@nemo/game-engine-core/browser';
import { advancePosition, computeTWA, getPolarSpeed, haversineNM } from '@nemo/polar-lib/browser';
import { pruneBySector, bearingDeg } from './pruning';
import { backtrackPolyline, extractInflectionPoints } from './polyline';
import { buildCapSchedule } from './schedule';
import { sampleWind } from './weatherSampler';
import { PRESETS } from './presets';
import type {
  IsochronePoint, RouteInput, RoutePlan,
} from './types';

const INFLECTION_DEG = 5;

// Use getPolarSpeed (bilinear) — same lookup the tick engine uses via
// computeBsp. The previous nearest-neighbor version caused the routed
// trail to offset from the simulated trail by a constant ~5-10%.
function pickOptimalSailForRouting(polar: Polar, twaAbs: number, tws: number): SailId {
  let best: SailId | null = null;
  let bestBsp = -1;
  for (const sail of Object.keys(polar.speeds) as SailId[]) {
    if (!polar.speeds[sail]) continue;
    const v = getPolarSpeed(polar, sail, twaAbs, tws);
    if (v > bestBsp) { bestBsp = v; best = sail; }
  }
  return best ?? ('JIB' as SailId);
}

export async function computeRoute(input: RouteInput): Promise<RoutePlan> {
  const t0 = Date.now();
  const params = PRESETS[input.preset];
  const { timeStepSec, headingCount, horizonSec, sectorCount } = params;
  const stepHeading = 360 / headingCount;

  const coastDetection = input.coastDetection === true;

  console.log('[routing] start', {
    preset: input.preset,
    from: input.from,
    to: input.to,
    horizonSec,
    headingCount,
    sectorCount,
    coastDetection,
    coneHalfDeg: input.coneHalfDeg ?? 90,
  });

  // Only build / reuse the coastline index when detection is on. Skipping
  // the index when off avoids its ~10 MB memory footprint and (for callers
  // that pass raw GeoJSON) its ~500 ms build time.
  let coastline: CoastlineIndex;
  if (!coastDetection) {
    coastline = new CoastlineIndex();
  } else if (input.coastlineIndex && input.coastlineIndex.isLoaded()) {
    coastline = input.coastlineIndex;
    console.log('[routing] coastline reused from prebuilt index');
  } else if (input.coastlineGeoJson && input.coastlineGeoJson.features.length > 0) {
    coastline = new CoastlineIndex();
    const tc = Date.now();
    coastline.loadFromGeoJson(input.coastlineGeoJson);
    console.log(`[routing] coastline loaded in ${Date.now() - tc} ms`);
  } else {
    coastline = new CoastlineIndex();
    console.log('[routing] coastline requested but no geojson/index provided — ignoring');
  }

  // Arrival radius: half the max distance the boat can cover in one step.
  // At coarse steps (FAST = 3 h), the boat may leap 40+ NM per step, so a
  // too-tight radius causes the candidate to "jump over" the target and
  // never register a hit. Half-step at peak speed is the classical choice.
  let bspMax = 0;
  for (const sail of Object.keys(input.polar.speeds) as SailId[]) {
    const table = input.polar.speeds[sail];
    if (!table) continue;
    for (const row of table) for (const v of row) if (v > bspMax) bspMax = v;
  }
  const arrivalRadiusNm = Math.max(3, (bspMax * timeStepSec) / 3600 / 2);

  // Initial sample for iso[0] metadata
  const initSample = sampleWind(input.windGrid, input.windData, input.from.lat, input.from.lon, input.startTimeMs, input.prevWindGrid, input.prevWindData);
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

  // Heading cone toward destination: only explore headings within
  // CONE_HALF_DEG of the great-circle bearing *from the current candidate*
  // to the target (recomputed per candidate, not once from start). Fixing
  // it to start→target like before meant that once the boat drifted past
  // the target latitude, the cone still pointed south and rejected the
  // north-bound headings needed to loop back — the boat would sail past
  // the destination and keep going. 90° half-angle = 180° arc.
  const CONE_HALF_DEG = input.coneHalfDeg ?? 90;
  const inConeFrom = (h: number, bearing: number): boolean => {
    const d = (((h - bearing) % 360) + 540) % 360 - 180;
    return Math.abs(d) <= CONE_HALF_DEG;
  };

  // Hard distance-from-coast floor. Any candidate endpoint closer than this
  // to a shoreline is rejected outright. Prevents the classic "hugs the
  // coast in zigzags" failure mode: the angular-sector pruning rewards the
  // point furthest from origin in each sector, which along a shore is the
  // one grazing every inlet.
  const MIN_COAST_DISTANCE_NM = 2;

  for (let step = 1; step <= maxSteps; step++) {
    const prev = isochrones[step - 1]!;
    const candidates: IsochronePoint[] = [];

    // SUB-SAMPLING constant: how many chunks each step is split into for
    // wind+physics integration. The sim runs 30 s ticks (so a 2 h step is
    // 240 ticks); 8 sub-steps gives us 15 min granularity — fine enough
    // to catch typical wind gradients while staying ~10× cheaper than
    // actual 30 s ticks (which would push BALANCED over 10 s of compute).
    const SUB_STEPS = 8;
    const subStepSec = timeStepSec / SUB_STEPS;

    for (let idx = 0; idx < prev.length; idx++) {
      const p = prev[idx]!;
      // Sample wind at step midpoint at the parent position to pick the
      // sail (held across the step — matches sim behaviour where sail
      // only changes via explicit schedule entry at step boundaries).
      const midTimeMs = p.timeMs + (timeStepSec * 500);
      const sailWeather = sampleWind(input.windGrid, input.windData, p.lat, p.lon, midTimeMs, input.prevWindGrid, input.prevWindData);
      if (!sailWeather) continue;
      const localEffects = aggregateEffects(input.loadout.items, { tws: sailWeather.tws });

      // Per-candidate cone toward the target — recomputed from this parent's
      // position so a candidate that has overshot can turn back.
      const localBearing = bearingDeg({ lat: p.lat, lon: p.lon }, input.to);

      for (let h = 0; h < 360; h += stepHeading) {
        if (!inConeFrom(h, localBearing)) continue;

        // Pick the sail once per step from the midpoint wind (this sail
        // is what the schedule will emit; the sim will use it the whole
        // step too).
        const midTwa = computeTWA(h, sailWeather.twd);
        const midTwaAbs = Math.min(Math.abs(midTwa), 180);
        if (input.polar.twa[0] !== undefined && midTwaAbs < input.polar.twa[0]) continue;
        const sail = pickOptimalSailForRouting(input.polar, midTwaAbs, sailWeather.tws);

        // One-shot maneuver penalty (fires on the first sub-step if this
        // heading crosses the wind from parent's TWA).
        let maneuverMul = 1;
        if (p.parentIdx >= 0) {
          const penalty: ManeuverPenaltyState | null = detectManeuver(
            p.twa, midTwa, input.boatClass, p.timeMs, localEffects,
          );
          if (penalty) {
            const durSec = Math.min((penalty.endMs - penalty.startMs) / 1000, timeStepSec);
            maneuverMul = (durSec * penalty.speedFactor + (timeStepSec - durSec)) / timeStepSec;
          }
        }

        // Sub-simulate: walk the boat forward in SUB_STEPS chunks, each
        // resampling wind at the sub-position + sub-time. Accumulate
        // distance so we can compare against the cumulative distances of
        // other candidates. Heading is held constant across sub-steps
        // (what a real boat does between schedule entries).
        let subLat = p.lat;
        let subLon = p.lon;
        let subTimeMs = p.timeMs;
        let totalDistNm = 0;
        let lastBsp = 0;
        let lastTws = sailWeather.tws;
        let lastTwd = sailWeather.twd;
        let lastTwa = midTwa;
        let deadZone = false;
        for (let k = 0; k < SUB_STEPS; k++) {
          const subMidMs = subTimeMs + (subStepSec * 500);
          const w = sampleWind(input.windGrid, input.windData, subLat, subLon, subMidMs, input.prevWindGrid, input.prevWindData);
          if (!w) { deadZone = true; break; }
          const twa = computeTWA(h, w.twd);
          const twaAbs = Math.min(Math.abs(twa), 180);
          if (input.polar.twa[0] !== undefined && twaAbs < input.polar.twa[0]) {
            deadZone = true; break;
          }
          const effects = aggregateEffects(input.loadout.items, { tws: w.tws });
          const coreBsp = computeBsp(input.polar, sail, twa, w.tws, effects, input.condition);
          const swellMul = swellSpeedFactor(w.swh, w.swellDir, h);
          const bsp = coreBsp * swellMul * maneuverMul;
          if (bsp < 0.1) { deadZone = true; break; }
          const distSub = bsp * (subStepSec / 3600);
          totalDistNm += distSub;
          const newSub = advancePosition({ lat: subLat, lon: subLon }, h, bsp, subStepSec);
          subLat = newSub.lat;
          subLon = newSub.lon;
          subTimeMs += subStepSec * 1000;
          lastBsp = bsp;
          lastTws = w.tws;
          lastTwd = w.twd;
          lastTwa = twa;
        }
        if (deadZone) continue;

        const bsp = lastBsp;
        const distNm = totalDistNm;
        const newPos = { lat: subLat, lon: subLon };
        const weather = { tws: lastTws, twd: lastTwd }; // for the candidate record
        // `segmentCrossesCoast` has its own cheap bbox short-circuit via
        // `cellsForBBox`: if the path's bounding box doesn't intersect any
        // grid cell containing a coast segment, the inner loop is skipped
        // and we return false in a few µs. The earlier `distanceToCoastNm`
        // pre-gate was redundant *and* slow — turf's `nearestPointOnLine`
        // iterates every vertex of every candidate segment, which dominated
        // routing time. intermediatePoints=1 (just endpoints) is enough at
        // a 2h step: the great-circle is near-straight at those distances.
        if (coastDetection && coastline.isLoaded()) {
          if (coastline.segmentCrossesCoast({ lat: p.lat, lon: p.lon }, newPos, 1)) continue;
          if (coastline.distanceToCoastNmFast(newPos.lat, newPos.lon, MIN_COAST_DISTANCE_NM) < MIN_COAST_DISTANCE_NM) continue;
        }
        // else: coastline detection disabled — accept any path.

        candidates.push({
          lat: newPos.lat, lon: newPos.lon, hdg: h, bsp,
          tws: weather.tws, twd: weather.twd, twa: lastTwa, sail,
          timeMs: p.timeMs + timeStepSec * 1000,
          distFromStartNm: p.distFromStartNm + distNm,
          parentIdx: idx,
        });
      }
    }

    // Arrival check is done on the *unpruned* candidate set. The sector
    // pruner rewards the candidate furthest from origin in each sector,
    // which near the target can be the one that has overshot and ended up
    // on the far side — the direct-to-target candidate gets dropped and
    // the route orbits the destination forever. Checking arrival before
    // pruning guarantees we catch it the moment any heading lands us in
    // the arrival radius.
    let hit: IsochronePoint | null = null;
    let hitDist = Infinity;
    for (const q of candidates) {
      const d = haversineNM({ lat: q.lat, lon: q.lon }, input.to);
      if (d <= arrivalRadiusNm && d < hitDist) { hitDist = d; hit = q; }
    }

    const pruned = pruneBySector(candidates, input.from, sectorCount);
    // If the winning arrival candidate got pruned out, re-insert it so the
    // backtrack can chain back through this step.
    if (hit && !pruned.includes(hit)) pruned.push(hit);
    isochrones.push(pruned);

    // Log each step: how many candidates, how many survived pruning,
    // distance to target from best candidate so far. Every ~4 steps to
    // keep the console readable.
    if (step % 4 === 0 || hit) {
      let bestD = Infinity;
      for (const q of pruned) {
        const d = haversineNM({ lat: q.lat, lon: q.lon }, input.to);
        if (d < bestD) bestD = d;
      }
      console.log(
        `[routing] step ${step}/${maxSteps} · candidates=${candidates.length} · pruned=${pruned.length} · bestDist=${bestD.toFixed(1)} NM · elapsed=${Date.now() - t0} ms`,
      );
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

  console.log(
    `[routing] done · reachedGoal=${reachedGoal} · totalDist=${totalDistanceNm.toFixed(1)} NM · polyline=${polyline.length} pts · cap=${capSchedule.length} entries · totalTime=${Date.now() - t0} ms`,
  );
  // Plan details — compare with [sim-schedule] logs when the sim runs.
  for (let i = 0; i < capSchedule.length; i++) {
    const e = capSchedule[i]!;
    const simT = (e.triggerMs - input.startTimeMs) / 3_600_000;
    console.log(
      `[routing-plan] #${i} simT=${simT.toFixed(2)}h · cap=${e.cap.toFixed(0)}°${e.sail ? ' · sail=' + e.sail : ''} · pos=(${e.plannedLat?.toFixed(3)}, ${e.plannedLon?.toFixed(3)})`,
    );
  }
  // Router's expected BSP trace — pair with [sim-tick] lines. Log every
  // 30 sim-minutes (every ~step/4) from the polyline to match the sim's
  // sampling cadence.
  const logEveryMs = 30 * 60_000;
  let nextLogMs = input.startTimeMs;
  for (const p of polyline) {
    if (p.timeMs < nextLogMs) continue;
    const simT = (p.timeMs - input.startTimeMs) / 3_600_000;
    console.log(
      `[routing-tick] simT=${simT.toFixed(2)}h · bsp=${p.bsp.toFixed(2)} · tws=${p.tws.toFixed(1)} · twa=${p.twa.toFixed(0)}° · sail=${p.sail} · pos=(${p.lat.toFixed(3)}, ${p.lon.toFixed(3)})`,
    );
    nextLogMs = p.timeMs + logEveryMs;
  }

  return {
    reachedGoal, polyline, waypoints, capSchedule, isochrones,
    totalDistanceNm, eta, preset: input.preset,
    computeTimeMs: Date.now() - t0,
  };
}

// Suppress unused import warning — types used in signatures above.
export type { BoatLoadout, ConditionState };
