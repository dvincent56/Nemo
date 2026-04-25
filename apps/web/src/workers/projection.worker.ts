// apps/web/src/workers/projection.worker.ts
/// <reference lib="webworker" />

import type {
  ProjectionInput,
  ProjectionResult,
  ProjectionSegment,
  TimeMarker,
  ManeuverMarker,
  WorkerInMessage,
  WorkerOutMessage,
} from '../lib/projection/types';
import {
  advancePosition,
  computeTWA,
  computeBsp,
  computeBspMax,
  computeWearDelta,
  applyWear,
  detectManeuver,
  getPolarSpeed,
  type PolarData,
  type ConditionState,
  type ManeuverState,
} from '../lib/projection/simulate';
import { createWindLookup } from '../lib/projection/windLookup';
import { CoastlineIndex } from '../lib/projection/coastline';
import { zoneSpeedModulator, segmentEntersZone } from '../lib/projection/zones';
import { GameBalance } from '@nemo/game-balance/browser';
import { haversinePosNM } from '../lib/geo';

// ── Geo helpers ──
// Inline great-circle bearing — mirror of @nemo/game-engine-core/src/geo
// `bearingDeg`. Kept local to avoid widening engine-core's exports just for
// the projection worker. Same math, same units.
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
function bearingDeg(from: { lat: number; lon: number }, to: { lat: number; lon: number }): number {
  const f1 = from.lat * DEG_TO_RAD;
  const f2 = to.lat * DEG_TO_RAD;
  const dLon = (to.lon - from.lon) * DEG_TO_RAD;
  const y = Math.sin(dLon) * Math.cos(f2);
  const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dLon);
  const theta = Math.atan2(y, x);
  return ((theta * RAD_TO_DEG) + 360) % 360;
}

// ── Adaptive step config ──
// Tuned for responsiveness: fine grain where course/manoeuvres matter,
// coarser for long-range where wind varies slowly.

const STEP_1M = 60;
const STEP_5M = 5 * 60;
const STEP_15M = 15 * 60;
const STEP_30M = 30 * 60;

const HOUR_1 = 1 * 3600;
const HOURS_12 = 12 * 3600;
const HOURS_48 = 48 * 3600;
const DAYS_5 = 5 * 24 * 3600;

function getStepSize(elapsedSec: number): number {
  if (elapsedSec < HOUR_1) return STEP_1M;
  if (elapsedSec < HOURS_12) return STEP_5M;
  if (elapsedSec < HOURS_48) return STEP_15M;
  return STEP_30M;
}

// ── Time marker labels ──

// Major markers carry a visible label; minor ones are unlabelled dots so the
// projection line has enough visual density to show curves between major
// checkpoints (e.g. the turn between 24h and 48h).
const MAJOR_MARKERS = [1, 3, 6, 12, 24, 48, 72, 96, 120];
const MINOR_MARKERS = [2, 9, 15, 18, 21, 30, 36, 42, 60, 84, 108];
const TIME_MARKER_HOURS = [...MAJOR_MARKERS, ...MINOR_MARKERS].sort((a, b) => a - b);
const isMajorMarker = (h: number): boolean => MAJOR_MARKERS.includes(h);

/**
 * Pick the sail with the highest BSP at the given TWA/TWS. The polar
 * itself encodes the valid range (speed > 0 = in range), matching the
 * game-engine's pickOptimalSail().
 */
function pickOptimalSail(polar: PolarData, twa: number, tws: number): string {
  const twaAbs = Math.min(Math.abs(twa), 180);
  let best: string | null = null;
  let bestBsp = -Infinity;
  for (const sail of Object.keys(polar.speeds)) {
    const bsp = getPolarSpeed(polar, sail, twaAbs, tws);
    if (bsp > bestBsp) { bestBsp = bsp; best = sail; }
  }
  return best ?? Object.keys(polar.speeds)[0]!;
}


// ── Init: load GameBalance on worker start ──

let balanceReady = false;

async function ensureBalance(): Promise<void> {
  if (balanceReady) return;
  // cache: 'no-store' bypasses the Workbox SW cache so schema additions
  // (new boat classes, etc.) show up immediately on next load.
  const resp = await fetch('/data/game-balance.json', { cache: 'no-store' });
  const json = await resp.json();
  GameBalance.load(json);
  balanceReady = true;
}

// ── Coastline for grounding detection ──

const coast = new CoastlineIndex();
let coastReady = false;
let coastLoading: Promise<void> | null = null;

async function ensureCoastline(): Promise<void> {
  if (coastReady) return;
  if (coastLoading) return coastLoading;
  coastLoading = (async () => {
    try {
      const resp = await fetch('/data/coastline.geojson', { cache: 'no-store' });
      const json = await resp.json() as GeoJSON.FeatureCollection;
      coast.load(json);
      coastReady = true;
    } catch (err) {
      console.error('[Worker] coastline load failed:', err);
    }
  })();
  return coastLoading;
}

// ── Cached wind grid ──
// The wind grid is heavy (10-30 MB). We receive it once via a `setWindGrid`
// message and keep it here so subsequent `compute` messages stay small — no
// per-drag Float32Array reallocation/transfer.
let cachedWindLookup: ReturnType<typeof createWindLookup> | null = null;

// ── Result buffer layout ──
// Float32Array packed as [lat, lon, dtMs, bsp, tws, twd] × N. dtMs is the
// offset from result.startMs in milliseconds (fits in f32 up to ~24 days,
// well above the 5-day projection horizon). The full 4096×6 buffer is
// pre-allocated per simulate() call and transferred zero-copy back to the
// main thread — no JSON serialization of N small objects.
const POINT_FIELDS = 6;
const MAX_POINTS = 4096; // 5d × 30min ≈ 240; 4096 is safe headroom

// ── Main simulation ──

function simulate(input: ProjectionInput): ProjectionResult {
  if (!cachedWindLookup) {
    throw new Error('projection: wind grid not set (setWindGrid must be sent before compute)');
  }
  const rawGetWeatherAt = cachedWindLookup;

  // Compute the offset between the player-facing TWD (hud) and the local grid TWD
  // at the boat's position. Apply this offset to all sampled wind directions so
  // the projection starts consistent with what the player sees in the HUD/Compass.
  const initSample = rawGetWeatherAt(input.lat, input.lon, input.nowMs);
  const twdOffset = initSample
    ? (((input.referenceTwd - initSample.twd + 540) % 360) - 180)
    : 0;

  const getWeatherAt = (lat: number, lon: number, ms: number) => {
    const w = rawGetWeatherAt(lat, lon, ms);
    if (!w) return null;
    return { ...w, twd: ((w.twd + twdOffset) % 360 + 360) % 360 };
  };

  const polar: PolarData = input.polar;
  const bspMax = computeBspMax(polar);
  const effects = input.effects;

  // Output buffer + counters. Maneuver/time markers carry an `index` into
  // pointsBuf (in points, not floats). pushPoint() writes the next slot.
  const pointsBuf = new Float32Array(MAX_POINTS * POINT_FIELDS);
  let count = 0;
  const startMs = input.nowMs;
  const pushPoint = (lat: number, lon: number, ts: number, bsp: number, tws: number, twd: number) => {
    if (count >= MAX_POINTS) return;
    const b = count * POINT_FIELDS;
    pointsBuf[b] = lat;
    pointsBuf[b + 1] = lon;
    pointsBuf[b + 2] = ts - startMs; // dtMs offset from startMs
    pointsBuf[b + 3] = bsp;
    pointsBuf[b + 4] = tws;
    pointsBuf[b + 5] = twd;
    count++;
  };

  const timeMarkers: TimeMarker[] = [];
  const maneuverMarkers: ManeuverMarker[] = [];

  // State
  let lat = input.lat;
  let lon = input.lon;
  let hdg = input.hdg;
  let twaLock = input.twaLock;
  let activeSail = input.activeSail;
  let sailAuto = input.sailAuto;
  let condition: ConditionState = { ...input.condition };
  let maneuver: ManeuverState | null = input.activeManeuver ? { ...input.activeManeuver } : null;
  let transition: { endMs: number; speedFactor: number } | null =
    input.activeTransition ? { ...input.activeTransition } : null;
  let prevTwa = input.prevTwa;
  let zonesInside = new Set<string>();

  let currentMs = startMs;
  const endMs = startMs + DAYS_5 * 1000;

  // Split orders into:
  //   - time-triggered "segments" (CAP/TWA/SAIL/MODE) processed at triggerMs
  //   - WPT chain processed sequentially as previous WPTs are captured.
  //
  // The engine tick treats WPT specially: it persists across ticks and on
  // each application recomputes heading toward the waypoint. We mirror that
  // here by overriding `hdg` every step while a WPT is active, and
  // advancing the chain on capture (mirrors tick.ts WPT capture detection
  // and the orderHistory purge filter that keeps un-captured WPTs alive).
  const allSegments = [...input.segments].sort((a, b) => a.triggerMs - b.triggerMs);
  const segments: ProjectionSegment[] = allSegments.filter((s) => s.type !== 'WPT');
  const wptList: ProjectionSegment[] = allSegments.filter((s) => s.type === 'WPT');
  // Order WPTs along the chain: a WPT comes AFTER its predecessor. WPTs
  // with no predecessor (IMMEDIATE) come first. Stable sort by index.
  const wptQueue: ProjectionSegment[] = [];
  const remaining = [...wptList];
  while (remaining.length > 0) {
    const lastId = wptQueue.length > 0 ? wptQueue[wptQueue.length - 1]!.id : undefined;
    const idx = remaining.findIndex((w) => (w.waypointPredecessorId ?? undefined) === lastId);
    if (idx < 0) break; // chain broken — stop accumulating
    wptQueue.push(remaining.splice(idx, 1)[0]!);
  }
  let wptIdx = 0;
  let segIdx = 0;

  // Track which time marker hours we've passed
  let nextTimeMarkerIdx = 0;

  // Initial point
  const initWeather = getWeatherAt(lat, lon, currentMs);
  if (!initWeather) {
    return { pointsBuf, pointsCount: 0, startMs, timeMarkers: [], maneuverMarkers: [], bspMax };
  }
  const initTwa = twaLock ?? computeTWA(hdg, initWeather.twd);
  const initBsp = computeBsp(polar, activeSail, initTwa, initWeather.tws, condition, effects, maneuver, transition, currentMs, initWeather, hdg);
  pushPoint(lat, lon, currentMs, initBsp, initWeather.tws, initWeather.twd);

  while (currentMs < endMs) {
    const elapsedSec = (currentMs - startMs) / 1000;
    let dt = getStepSize(elapsedSec);

    // Check if a segment triggers within this step — force exact computation at trigger
    let segmentTriggered = false;
    while (segIdx < segments.length && segments[segIdx]!.triggerMs <= currentMs + dt * 1000) {
      const seg = segments[segIdx]!;

      // Advance to segment trigger time first (if in the future)
      if (seg.triggerMs > currentMs) {
        const partialDt = (seg.triggerMs - currentMs) / 1000;
        const weather = getWeatherAt(lat, lon, currentMs);
        if (!weather) break;
        const twa = twaLock !== null ? twaLock : computeTWA(hdg, weather.twd);
        const bsp = computeBsp(polar, activeSail, twa, weather.tws, condition, effects, maneuver, transition, currentMs, weather, hdg);
        const newPos = advancePosition({ lat, lon }, hdg, bsp, partialDt);
        lat = newPos.lat;
        lon = newPos.lon;

        // Wear
        const wearDelta = computeWearDelta(weather, hdg, partialDt, effects);
        condition = applyWear(condition, wearDelta);

        currentMs = seg.triggerMs;
      }

      // Apply segment order
      const prevHdg = hdg;
      const prevTwaLock = twaLock;
      const prevSail = activeSail;

      let markerType: ManeuverMarker['type'] = 'cap_change';
      let markerDetail = '';

      switch (seg.type) {
        case 'CAP':
          hdg = seg.value as number;
          twaLock = null;
          markerType = 'cap_change';
          markerDetail = `CAP ${Math.round(prevHdg)}° → ${Math.round(hdg)}°`;
          break;
        case 'TWA':
          twaLock = seg.value as number;
          markerType = 'twa_change';
          markerDetail = `TWA verrouillé à ${Math.round(twaLock)}°${prevTwaLock !== null ? ` (précédent : ${Math.round(prevTwaLock)}°)` : ''}`;
          break;
        case 'SAIL': {
          activeSail = seg.value as typeof activeSail;
          markerType = 'sail_change';
          markerDetail = `${prevSail} → ${activeSail}`;
          // Sail change penalty
          const transKey = `${prevSail}_${activeSail}`;
          const sailTransDur = (GameBalance.sails.transitionTimes as Record<string, number>)[transKey] ?? 180;
          const sailTransDurAdj = sailTransDur * effects.maneuverMul.sailChange.dur;
          transition = {
            endMs: currentMs + sailTransDurAdj * 1000,
            speedFactor: GameBalance.sails.transitionPenalty * effects.maneuverMul.sailChange.speed,
          };
          break;
        }
        case 'MODE':
          sailAuto = seg.value as boolean;
          break;
      }

      // Detect tack/gybe from heading/TWA change
      if (seg.type === 'CAP' || seg.type === 'TWA') {
        const weather = getWeatherAt(lat, lon, currentMs);
        if (weather && prevTwa !== null) {
          const newTwa = twaLock !== null ? twaLock : computeTWA(hdg, weather.twd);
          const man = detectManeuver(prevTwa, newTwa, input.boatClass, currentMs, effects);
          if (man) {
            maneuver = man;
            markerType = Math.abs(newTwa) < 90 ? 'tack' : 'gybe';
            markerDetail += markerType === 'tack' ? ' — virement' : ' — empannage';
          }
        }
      }

      // Add maneuver marker (skip MODE changes which are invisible)
      if (seg.type !== 'MODE') {
        maneuverMarkers.push({
          index: count, // will be the next point added
          type: markerType,
          detail: markerDetail,
        });
      }

      // Record point at segment transition
      const weather = getWeatherAt(lat, lon, currentMs);
      if (weather) {
        const twa = twaLock !== null ? twaLock : computeTWA(hdg, weather.twd);
        prevTwa = twa;
        const segBsp = computeBsp(polar, activeSail, twa, weather.tws, condition, effects, maneuver, transition, currentMs, weather, hdg);
        pushPoint(lat, lon, currentMs, segBsp, weather.tws, weather.twd);
      }

      segIdx++;
      segmentTriggered = true;
    }

    // If we processed segments, recalculate remaining dt for this step
    if (segmentTriggered) {
      const newElapsed = (currentMs - startMs) / 1000;
      dt = getStepSize(newElapsed);
    }

    // ── WPT chain: drive heading toward the active waypoint, advance on capture.
    // Mirrors packages/game-engine-core/src/segments.ts applyOrder WPT case
    // (heading = bearingDeg(position, wpt), twaLock cleared) and the capture
    // detection in tick.ts (advance to next when distance < captureRadiusNm).
    // We check capture before recomputing heading so a boat that has already
    // reached the WPT immediately steers toward the next.
    while (wptIdx < wptQueue.length) {
      const w = wptQueue[wptIdx]!;
      const v = w.value as { lat: number; lon: number; captureRadiusNm: number };
      if (haversinePosNM({ lat, lon }, { lat: v.lat, lon: v.lon }) < v.captureRadiusNm) {
        // Captured — advance the chain. Mark a maneuver marker so the
        // route-following step is visible to the player.
        maneuverMarkers.push({
          index: count,
          type: 'cap_change',
          detail: `WPT atteint (${v.lat.toFixed(2)}°·${v.lon.toFixed(2)}°)`,
        });
        wptIdx++;
        continue;
      }
      // Override heading to point at the active WPT.
      hdg = bearingDeg({ lat, lon }, { lat: v.lat, lon: v.lon });
      twaLock = null;
      break;
    }

    // Get weather at current position/time
    const weather = getWeatherAt(lat, lon, currentMs);
    if (!weather) break; // Beyond GRIB coverage

    // If in TWA lock mode, update heading from wind direction
    const twa = twaLock !== null ? twaLock : computeTWA(hdg, weather.twd);

    // Auto-sail: switch to optimal sail if in auto mode and not currently
    // transitioning. Mirror engine/sails.ts hysteresis: switch only when the
    // optimal sail beats the active by more than `overlapThreshold` (e.g.
    // +1.4%) so the projection doesn't predict flap switches for marginal
    // gains. When the active is out of its polar range (bsp=0), switch
    // unconditionally.
    const isTransitioning = transition !== null && currentMs < transition.endMs;
    const twaAbs = Math.min(Math.abs(twa), 180);
    const currentBsp = getPolarSpeed(polar, activeSail, twaAbs, weather.tws);
    if (sailAuto && !isTransitioning) {
      const optimal = pickOptimalSail(polar, twa, weather.tws);
      if (optimal !== activeSail) {
        const optimalBsp = getPolarSpeed(polar, optimal, twaAbs, weather.tws);
        const threshold = GameBalance.sails.overlapThreshold;
        const shouldSwitch = currentBsp <= 0 || optimalBsp / currentBsp > threshold;
        if (shouldSwitch) {
          const transKey = `${activeSail}_${optimal}`;
          const sailTransDur = (GameBalance.sails.transitionTimes as Record<string, number>)[transKey] ?? 180;
          const sailTransDurAdj = sailTransDur * effects.maneuverMul.sailChange.dur;
          transition = {
            endMs: currentMs + sailTransDurAdj * 1000,
            speedFactor: GameBalance.sails.transitionPenalty * effects.maneuverMul.sailChange.speed,
          };
          maneuverMarkers.push({
            index: count,
            type: 'sail_change',
            detail: `Auto: ${activeSail} → ${optimal}`,
          });
          activeSail = optimal as typeof activeSail;
        }
      }
    }

    if (twaLock !== null) {
      // Heading = TWD + TWA (reverse of computeTWA)
      hdg = ((weather.twd + twaLock) % 360 + 360) % 360;
    }

    // Compute BSP — apply zone modulation for the segment we're ABOUT to traverse.
    // In auto mode, when the hysteresis keeps a sub-optimal sail active (inside
    // its range but not the global best), the engine awards the optimal sail's
    // BSP via overlapFactor. Mirror that by looking up polar speed on the
    // optimal sail, not the visually-active one. In manual mode the player
    // assumes their choice: BSP is the active sail's polar speed, no bonus.
    const bspSail = sailAuto
      ? pickOptimalSail(polar, twa, weather.tws)
      : activeSail;
    let bsp = computeBsp(polar, bspSail, twa, weather.tws, condition, effects, maneuver, transition, currentMs, weather, hdg);
    const zoneAtStart = zoneSpeedModulator(lat, lon, input.zones, currentMs);
    if (zoneAtStart.factor !== 1) {
      bsp *= zoneAtStart.factor;
    }

    // Advance position
    const newPos = advancePosition({ lat, lon }, hdg, bsp, dt);

    // Detect zone entries on the segment (fromStart → newPos). For each zone
    // we weren't inside at the start, find the intersection with the zone
    // boundary and place the marker exactly there.
    for (const z of input.zones) {
      if (zonesInside.has(z.name)) continue;
      // If the endpoint is inside the zone but the start wasn't → we entered it
      // during this step. Use segmentEntersZone to get the crossing point.
      const endInside = zoneSpeedModulator(newPos.lat, newPos.lon, [z], currentMs).factor !== 1;
      if (!endInside) continue;
      const cross = segmentEntersZone(lat, lon, newPos.lat, newPos.lon, z);
      if (!cross) continue;
      // Insert a point at the crossing (outside-side, with pre-zone BSP) so the
      // rendered line color transitions exactly at the boundary.
      pushPoint(
        cross.lat,
        cross.lon,
        currentMs + cross.t * dt * 1000,
        bsp / (zoneAtStart.factor !== 1 ? zoneAtStart.factor : 1),
        weather.tws,
        weather.twd,
      );
      maneuverMarkers.push({
        index: count - 1,
        type: 'zone_entry',
        detail: `${z.name} (×${z.speedMultiplier.toFixed(2)} vitesse)`,
      });
    }
    // Refresh zonesInside from the endpoint state
    const endHit = zoneSpeedModulator(newPos.lat, newPos.lon, input.zones, currentMs);
    zonesInside = new Set(endHit.hitNames);

    // Grounding check: if the segment crosses coastline, stop projection at impact.
    if (coastReady) {
      const hit = coast.segmentCrossesCoast(lat, lon, newPos.lat, newPos.lon, 6);
      if (hit) {
        // Record grounding marker and final point, then exit the loop.
        pushPoint(hit.lat, hit.lon, currentMs, 0, weather.tws, weather.twd);
        maneuverMarkers.push({
          index: count - 1,
          type: 'grounding',
          detail: 'Échouage — collision avec la côte',
        });
        lat = hit.lat;
        lon = hit.lon;
        break;
      }
    }

    lat = newPos.lat;
    lon = newPos.lon;

    // Advance time
    currentMs += dt * 1000;

    // Wear progression
    const wearDelta = computeWearDelta(weather, hdg, dt, effects);
    condition = applyWear(condition, wearDelta);

    // Clear expired maneuver/transition
    if (maneuver && currentMs >= maneuver.endMs) maneuver = null;
    if (transition && currentMs >= transition.endMs) transition = null;

    // Detect maneuver from TWA change (in TWA lock mode, wind shift can cause tack/gybe)
    if (prevTwa !== null) {
      const newTwa = twaLock !== null ? twaLock : computeTWA(hdg, weather.twd);
      const man = detectManeuver(prevTwa, newTwa, input.boatClass, currentMs, effects);
      if (man) maneuver = man;
      prevTwa = newTwa;
    } else {
      prevTwa = twa;
    }

    // New weather at new position for the recorded point
    const weatherAtNew = getWeatherAt(lat, lon, currentMs);
    if (!weatherAtNew) break;
    const twaAtNew = twaLock !== null ? twaLock : computeTWA(hdg, weatherAtNew.twd);
    const bspAtNew = computeBsp(polar, activeSail, twaAtNew, weatherAtNew.tws, condition, effects, maneuver, transition, currentMs, weatherAtNew, hdg);

    pushPoint(lat, lon, currentMs, bspAtNew, weatherAtNew.tws, weatherAtNew.twd);

    // Check time markers
    const elapsedHours = (currentMs - startMs) / (3600 * 1000);
    while (
      nextTimeMarkerIdx < TIME_MARKER_HOURS.length &&
      elapsedHours >= TIME_MARKER_HOURS[nextTimeMarkerIdx]!
    ) {
      const h = TIME_MARKER_HOURS[nextTimeMarkerIdx]!;
      const major = isMajorMarker(h);
      const label = major ? (h >= 72 ? `${h / 24}j` : `${h}h`) : '';
      timeMarkers.push({
        index: count - 1,
        label,
      });
      nextTimeMarkerIdx++;
    }
  }

  return { pointsBuf, pointsCount: count, startMs, timeMarkers, maneuverMarkers, bspMax };
}

// ── Worker message handler ──

// Kick off coastline load immediately so it's ready by the time the
// first compute request lands.
ensureCoastline();

self.onmessage = async (e: MessageEvent<WorkerInMessage>) => {
  const msg = e.data;

  if (msg.type === 'setWindGrid') {
    cachedWindLookup = createWindLookup(msg.windGrid, msg.windData);
    return;
  }

  if (msg.type === 'compute') {
    try {
      await Promise.all([ensureBalance(), ensureCoastline()]);
      const result = simulate(msg.input);
      const out: WorkerOutMessage = { type: 'result', result };
      // Zero-copy transfer of the points buffer — postMessage no longer
      // serializes ~500 small objects, just hands the ArrayBuffer over.
      self.postMessage(out, [result.pointsBuf.buffer]);
    } catch (err) {
      const out: WorkerOutMessage = { type: 'error', message: String(err) };
      self.postMessage(out);
    }
  }
};
