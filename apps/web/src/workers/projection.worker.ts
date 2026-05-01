// apps/web/src/workers/projection.worker.ts
/// <reference lib="webworker" />

import type {
  ProjectionInput,
  ProjectionResult,
  ProjectionRun,
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

// ── AT_WAYPOINT-trigger sentinel ──
// orderQueueToSegments stamps AT_WAYPOINT-triggered non-WPT segments (final
// cap, sail-at-WP) with Number.MAX_SAFE_INTEGER so they sort to the end and
// don't fire by time. The worker rewrites triggerMs to currentMs when the
// referenced WPT is captured. This threshold detects "still pending" — any
// triggerMs at or above it is treated as not-yet-activated.
const TRIGGER_MS_PENDING_THRESHOLD = Number.MAX_SAFE_INTEGER - 1;

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

function simulate(input: ProjectionInput, segmentsOverride?: ProjectionSegment[]): ProjectionRun {
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
  const sourceSegments = segmentsOverride ?? input.segments;
  // Sort by triggerMs. AT_WAYPOINT-triggered segments carry the
  // Number.MAX_SAFE_INTEGER sentinel and naturally sort to the end — they
  // become eligible for processing only once their predecessor WPT is
  // captured (we rewrite triggerMs at that moment, see captureCallbacks).
  const allSegments = [...sourceSegments].sort((a, b) => a.triggerMs - b.triggerMs);
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

  // Skip WPTs the boat has already physically reached. The engine captures
  // WPTs server-side when the boat enters captureRadiusNm; the order is then
  // marked completed and dropped from the engine's orderHistory. The client's
  // prog.orderQueue intentionally keeps captured WPTs (so the AT_WAYPOINT
  // chain references stay intact for ProgPanel display), so by the time the
  // boat snapshot arrives here the boat has typically already moved PAST the
  // chain head's position. If we don't prune, the in-loop override below sets
  // `hdg = bearingDeg(boat, wp1)` — pointing backward — and the projection
  // ends up as a straight line / U-turn instead of curving through the
  // remaining WPs. Tolerance: 2× captureRadius so we don't get stuck just
  // outside the radius when the boat drifted slightly past the capture point
  // between the server tick and the client render.
  let wptIdx = 0;
  while (wptIdx < wptQueue.length) {
    const w = wptQueue[wptIdx]!;
    const v = w.value as { lat: number; lon: number; captureRadiusNm: number };
    const distNm = haversinePosNM({ lat, lon }, { lat: v.lat, lon: v.lon });
    if (distNm < v.captureRadiusNm * 2) {
      wptIdx++;
      continue;
    }
    break;
  }
  let segIdx = 0;

  // Note: pre-2026-04-28, exhausting the WPT chain ended the simulation
  // ("WPT-mode" routing — no extrapolation past the last WP). That broke the
  // final cap (CAP/TWA + AT_WAYPOINT(lastWp)): it could never drive the
  // trajectory because the loop exited the moment the last WPT was captured.
  // Now the simulation always runs to DAYS_5 (or weather coverage end). When
  // a final cap is present, it activates on capture (driveWptOnce stamps its
  // triggerMs to currentMs) and applies via the normal segment loop on the
  // next outer iteration. When no final cap is present, the heading set just
  // before capture (toward the final WP) carries the boat onward — natural
  // "continue at boat heading" past the last WP.

  // Drive the WPT chain at the boat's CURRENT position: capture any WPTs
  // we are inside (or just swept past during the optional prev→curr leg),
  // then point heading at the next active WPT. Returns true when every WPT
  // in the chain has been captured (caller should stop).
  //
  // Called both at the top of the outer step AND after each partial advance
  // inside the segment loop. The latter is critical: when a SAIL change
  // triggers in the same step that the boat enters a WPT capture radius,
  // a partial advance along the OLD (toward-current-WPT) heading would
  // overshoot the natural turn point and the resulting pushPoint at the
  // segment trigger creates a visible V/spur (geometry: P_prev → P_over
  // along H_a, P_over → P_new along H_b). Capturing the WPT mid-segment-
  // loop ensures the partial advance for any subsequent segment uses the
  // already-flipped heading toward the next WPT, so no overshoot vertex.
  //
  // The optional prev{Lat,Lon} args mirror the engine's wptCheckPositions
  // (tick.ts ~L287): when the step is large (post-t+1h dt is 5–30 min, easy
  // to cover several NM) a full advance can fly *past* a small-radius WPT,
  // leaving the boat outside the radius on the far side. Without sampling
  // along the swept leg we miss the capture; the next iter then sees
  // dist > captureRadius and points heading BACKWARD at the WPT, producing
  // a zigzag (forward, then backward, then forward again as the boat
  // overshoots/undershoots). Sampling 4 intermediate points along the leg
  // catches the pass-by even when the endpoint is outside the radius.
  const NUM_SWEEP_SAMPLES = 4;
  const sweptInsideRadius = (
    prevLat: number, prevLon: number, curLat: number, curLon: number,
    wptLat: number, wptLon: number, radiusNm: number,
  ): boolean => {
    if (haversinePosNM({ lat: curLat, lon: curLon }, { lat: wptLat, lon: wptLon }) < radiusNm) return true;
    if (haversinePosNM({ lat: prevLat, lon: prevLon }, { lat: wptLat, lon: wptLon }) < radiusNm) return true;
    for (let i = 1; i < NUM_SWEEP_SAMPLES; i++) {
      const t = i / NUM_SWEEP_SAMPLES;
      const sLat = prevLat + (curLat - prevLat) * t;
      const sLon = prevLon + (curLon - prevLon) * t;
      if (haversinePosNM({ lat: sLat, lon: sLon }, { lat: wptLat, lon: wptLon }) < radiusNm) return true;
    }
    return false;
  };

  // Capture at most one WPT per call. Returns true when a capture happened
  // (caller can re-call to handle WPT chains where the snapped position is
  // already inside the next WPT's radius). Returns false when the queue is
  // empty or the boat is still outside the next WPT's radius. Heading is
  // overridden toward the active WPT on every call where no capture occurred.
  const driveWptOnce = (prevLat?: number, prevLon?: number): boolean => {
    if (wptIdx >= wptQueue.length) return false;
    const w = wptQueue[wptIdx]!;
    const v = w.value as { lat: number; lon: number; captureRadiusNm: number };
    const captured = prevLat !== undefined && prevLon !== undefined
      ? sweptInsideRadius(prevLat, prevLon, lat, lon, v.lat, v.lon, v.captureRadiusNm)
      : haversinePosNM({ lat, lon }, { lat: v.lat, lon: v.lon }) < v.captureRadiusNm;
    if (!captured) {
      // Override heading toward the active WPT.
      hdg = bearingDeg({ lat, lon }, { lat: v.lat, lon: v.lon });
      twaLock = null;
      return false;
    }
    // Captured. Push a synthetic vertex at the WPT's lat/lon so the polyline
    // bends exactly at the waypoint, and snap the boat to the WPT so the next
    // step's heading recompute starts cleanly toward the next WPT in the chain.
    //
    // Previous attempt (e97b233) reverted because it caused a fly-by oscillation
    // bug at coarse step sizes (5–30 min): a full advance could cross past the
    // WPT, leave the boat outside the radius on the far side, and the next iter
    // would point heading backward — producing a zigzag. That root cause is now
    // fixed by `sweptInsideRadius` (commit 2a63bcd) which catches fly-bys along
    // the swept leg, so snapping is safe again and gives a clean visual bend.
    const wptWeather = getWeatherAt(v.lat, v.lon, currentMs);
    if (wptWeather) {
      const wptTwa = twaLock !== null ? twaLock : computeTWA(hdg, wptWeather.twd);
      const wptBsp = computeBsp(polar, activeSail, wptTwa, wptWeather.tws, condition, effects, maneuver, transition, currentMs, wptWeather, hdg);
      pushPoint(v.lat, v.lon, currentMs, wptBsp, wptWeather.tws, wptWeather.twd);
      maneuverMarkers.push({
        index: count > 0 ? count - 1 : 0,
        type: 'cap_change',
        detail: `WPT atteint (${v.lat.toFixed(2)}°·${v.lon.toFixed(2)}°)`,
      });
    } else {
      // No weather at the WPT (out of GRIB coverage) — anchor the marker via
      // explicit coords so it still lands at the WPT location. We don't push
      // a synthetic vertex here since the BSP/TWS/TWD fields would be junk.
      maneuverMarkers.push({
        index: count > 0 ? count - 1 : 0,
        type: 'cap_change',
        detail: `WPT atteint (${v.lat.toFixed(2)}°·${v.lon.toFixed(2)}°)`,
        lat: v.lat,
        lon: v.lon,
      });
    }
    // Snap so the next iteration's heading recompute / advance starts from
    // the bend point itself.
    lat = v.lat;
    lon = v.lon;

    // Activate any AT_WAYPOINT-triggered non-WPT segments that referenced
    // THIS WPT. We stamp their triggerMs to currentMs so the existing
    // segment-trigger loop (above) catches them on the next outer iteration
    // — keeping a single code path for CAP/TWA/SAIL/MODE application. This
    // is what makes the final cap (CAP/TWA + AT_WAYPOINT(lastWp)) and
    // sail-at-WP changes actually fire in the projection.
    const capturedId = w.id;
    if (capturedId) {
      for (const s of segments) {
        if (s.waypointPredecessorId === capturedId && s.triggerMs >= TRIGGER_MS_PENDING_THRESHOLD) {
          s.triggerMs = currentMs;
        }
      }
      // Re-sort to bring newly-activated segments into chronological order.
      // Cheap (small array) — and required because segIdx walks in sorted order.
      segments.sort((a, b) => a.triggerMs - b.triggerMs);
      // segIdx may now point past activated segments; reset to first un-applied.
      // Conservative: any segment whose triggerMs <= currentMs hasn't been
      // applied yet if its index is >= segIdx in the new sorted order.
      // Simpler approach: scan once for the smallest index whose triggerMs
      // is in the future relative to currentMs. We don't decrement segIdx
      // (segments before our current position were either already applied
      // or stamped in the past; either way the next segment loop iteration
      // handles only triggerMs <= currentMs + dt*1000).
    }

    wptIdx++;
    return true;
  };

  // Drive the WPT chain: capture as many WPTs as possible from the current
  // (possibly swept) position, then point heading at the next active WPT.
  // The loop handles WPT chains where post-snap position is already inside
  // the next WPT's radius (tight clusters). MAX_CAPTURES_PER_STEP guards
  // against pathological cases (degenerate chain, all WPTs at same point).
  //
  // Always returns false — the outer loop never breaks on chain exhaustion
  // anymore. After the last WPT is captured the boat continues with whatever
  // heading was last set: the bearing toward the final WPT (set just before
  // the snap), or — if a final-cap CAP/TWA segment with AT_WAYPOINT(lastWp)
  // was activated by the capture — the explicit final cap applied in the
  // upcoming segment loop iteration. This makes the final cap projection
  // visible past the last WP, and gives a natural "continue at boat heading"
  // when no final cap is present (matches user expectation).
  const MAX_CAPTURES_PER_STEP = 10;
  const driveWpt = (prevLat?: number, prevLon?: number): void => {
    let captures = 0;
    // First pass: use the swept leg (if provided) — only for the FIRST capture
    // since after a snap we're at the WPT itself, no swept leg to consider.
    while (driveWptOnce(captures === 0 ? prevLat : undefined, captures === 0 ? prevLon : undefined)) {
      captures++;
      if (captures >= MAX_CAPTURES_PER_STEP) break;
    }
  };

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

    // Capture any WPTs the boat is already inside and update heading toward
    // the next one BEFORE processing segments. Without this, a SAIL trigger
    // inside the same step would partial-advance along the stale toward-
    // current-WPT heading and push an overshoot vertex (the spur).
    driveWpt();

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
        const prevLat = lat;
        const prevLon = lon;
        const newPos = advancePosition({ lat, lon }, hdg, bsp, partialDt);
        lat = newPos.lat;
        lon = newPos.lon;

        // Wear
        const wearDelta = computeWearDelta(weather, hdg, partialDt, effects);
        condition = applyWear(condition, wearDelta);

        currentMs = seg.triggerMs;

        // After advancing, re-check WPT capture: the partial advance may
        // have crossed into a WPT capture radius. If so, flip heading toward
        // the next WPT BEFORE pushing the segment vertex, so the
        // segment-trigger pushPoint below sits on a clean bend rather than
        // overshooting along the now-stale heading. Pass prev pos so the
        // sweep-sample test catches a fly-by even if the endpoint is
        // outside the radius. driveWpt no longer signals chain exhaustion —
        // post-last-WP simulation continues so the final cap (if any) and
        // continued-heading projection are visible.
        driveWpt(prevLat, prevLon);
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

    // ── WPT chain: drive heading + capture. The post-segment-advance
    // position may also have crossed a WPT capture radius (segments
    // partial-advance the boat earlier in this iteration). driveWpt()
    // handles capture, marker emission, and heading override. After chain
    // exhaustion the simulation continues with the heading set just before
    // the last capture (or the AT_WAYPOINT-final-cap if one was activated)
    // until the DAYS_5 horizon — projection extends past the last WP.
    driveWpt();

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

    const advancePrevLat = lat;
    const advancePrevLon = lon;
    lat = newPos.lat;
    lon = newPos.lon;

    // Advance time
    currentMs += dt * 1000;

    // After the full advance, sample along the swept leg for WPT capture.
    // Without this, large step sizes (post-t+1h dt is 5–30 min, easily 5+ NM
    // covered per step) can fly past a small-radius WPT and leave the boat
    // outside the radius on the far side. The next iter's top driveWpt()
    // would then point heading BACKWARD at the un-captured WPT, producing a
    // visible zigzag (forward → backward → forward) in the projection line.
    // Mirrors tick.ts' wptCheckPositions strategy (capture at every segment
    // boundary, not just the endpoint).
    driveWpt(advancePrevLat, advancePrevLon);

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
      const input = msg.input;

      // Always run the committed simulation. Its fields land at the root of
      // ProjectionResult so legacy consumers keep working.
      const committedRun = simulate(input);

      // Run the draft simulation only when the caller flagged a distinct
      // edit. The hook hands us the SAME array reference for the no-edit
      // case (or omits draftSegments entirely), so the cheap referential
      // check skips the second sim with zero false negatives. A deeper
      // structural compare would be wasted work — the hook already memoizes.
      let draftRun: ProjectionRun | undefined;
      if (input.draftSegments && input.draftSegments !== input.segments) {
        draftRun = simulate(input, input.draftSegments);
      }

      const result: ProjectionResult = draftRun
        ? { ...committedRun, draft: draftRun }
        : committedRun;

      const out: WorkerOutMessage = { type: 'result', result };
      // Zero-copy transfer of both points buffers — postMessage no longer
      // serializes ~500 small objects per run, just hands the ArrayBuffers over.
      const transfer: Transferable[] = [committedRun.pointsBuf.buffer as ArrayBuffer];
      if (draftRun) transfer.push(draftRun.pointsBuf.buffer as ArrayBuffer);
      self.postMessage(out, transfer);
    } catch (err) {
      const out: WorkerOutMessage = { type: 'error', message: String(err) };
      self.postMessage(out);
    }
  }
};
