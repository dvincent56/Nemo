// apps/web/src/workers/projection.worker.ts
/// <reference lib="webworker" />

import type {
  ProjectionInput,
  ProjectionResult,
  ProjectionPoint,
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
  type PolarData,
  type ConditionState,
  type ManeuverState,
} from '../lib/projection/simulate';
import { createWindLookup } from '../lib/projection/windLookup';
import { GameBalance } from '@nemo/game-balance/browser';

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
const DAYS_7 = 7 * 24 * 3600;

function getStepSize(elapsedSec: number): number {
  if (elapsedSec < HOUR_1) return STEP_1M;
  if (elapsedSec < HOURS_12) return STEP_5M;
  if (elapsedSec < HOURS_48) return STEP_15M;
  return STEP_30M;
}

// ── Time marker labels ──

const TIME_MARKER_HOURS = [1, 2, 3, 6, 12, 24, 48, 72, 96, 120, 144, 168];

// ── Init: load GameBalance on worker start ──

let balanceReady = false;

async function ensureBalance(): Promise<void> {
  if (balanceReady) return;
  const resp = await fetch('/data/game-balance.json');
  const json = await resp.json();
  GameBalance.load(json);
  balanceReady = true;
}

// ── Main simulation ──

function simulate(input: ProjectionInput): ProjectionResult {
  const rawGetWeatherAt = createWindLookup(input.windGrid, input.windData);

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

  const points: ProjectionPoint[] = [];
  const timeMarkers: TimeMarker[] = [];
  const maneuverMarkers: ManeuverMarker[] = [];

  // State
  let lat = input.lat;
  let lon = input.lon;
  let hdg = input.hdg;
  let twaLock = input.twaLock;
  let activeSail = input.activeSail;
  // sailAuto tracked for future auto-sail logic in projection
  let condition: ConditionState = { ...input.condition };
  let maneuver: ManeuverState | null = input.activeManeuver ? { ...input.activeManeuver } : null;
  let transition: { endMs: number; speedFactor: number } | null =
    input.activeTransition ? { ...input.activeTransition } : null;
  let prevTwa = input.prevTwa;

  const startMs = input.nowMs;
  let currentMs = startMs;
  const endMs = startMs + DAYS_7 * 1000;

  // Sort segments by trigger time
  const segments = [...input.segments].sort((a, b) => a.triggerMs - b.triggerMs);
  let segIdx = 0;

  // Track which time marker hours we've passed
  let nextTimeMarkerIdx = 0;

  // Initial point
  const initWeather = getWeatherAt(lat, lon, currentMs);
  if (!initWeather) {
    return { points: [], timeMarkers: [], maneuverMarkers: [], bspMax };
  }
  const initTwa = twaLock ?? computeTWA(hdg, initWeather.twd);
  console.log('[Worker] init', {
    lat, lon, hdg, twaLock,
    referenceTwd: input.referenceTwd,
    twdOffset,
    initTwd: initWeather.twd,
    initTws: initWeather.tws,
    initTwa,
    initBsp: computeBsp(polar, activeSail, initTwa, initWeather.tws, condition, effects, maneuver, transition, currentMs),
  });
  points.push({
    lat, lon,
    timestamp: currentMs,
    bsp: computeBsp(polar, activeSail, initTwa, initWeather.tws, condition, effects, maneuver, transition, currentMs),
    tws: initWeather.tws,
    twd: initWeather.twd,
  });

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
        const bsp = computeBsp(polar, activeSail, twa, weather.tws, condition, effects, maneuver, transition, currentMs);
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
          markerDetail = `TWA ${prevTwaLock !== null ? Math.round(prevTwaLock) + '°' : 'off'} → ${Math.round(twaLock)}° lock`;
          break;
        case 'SAIL': {
          activeSail = seg.value as typeof activeSail;
          markerType = 'sail_change';
          markerDetail = `Voile: ${prevSail} → ${activeSail}`;
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
          // sailAuto state tracked for future auto-sail projection
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
            markerDetail += ` (${markerType})`;
          }
        }
      }

      // Add maneuver marker (skip MODE changes which are invisible)
      if (seg.type !== 'MODE') {
        maneuverMarkers.push({
          index: points.length, // will be the next point added
          type: markerType,
          detail: markerDetail,
        });
      }

      // Record point at segment transition
      const weather = getWeatherAt(lat, lon, currentMs);
      if (weather) {
        const twa = twaLock !== null ? twaLock : computeTWA(hdg, weather.twd);
        prevTwa = twa;
        points.push({
          lat, lon,
          timestamp: currentMs,
          bsp: computeBsp(polar, activeSail, twa, weather.tws, condition, effects, maneuver, transition, currentMs),
          tws: weather.tws,
          twd: weather.twd,
        });
      }

      segIdx++;
      segmentTriggered = true;
    }

    // If we processed segments, recalculate remaining dt for this step
    if (segmentTriggered) {
      const newElapsed = (currentMs - startMs) / 1000;
      dt = getStepSize(newElapsed);
    }

    // Get weather at current position/time
    const weather = getWeatherAt(lat, lon, currentMs);
    if (!weather) break; // Beyond GRIB coverage

    // If in TWA lock mode, update heading from wind direction
    const twa = twaLock !== null ? twaLock : computeTWA(hdg, weather.twd);
    if (twaLock !== null) {
      // Heading = TWD + TWA (reverse of computeTWA)
      hdg = ((weather.twd + twaLock) % 360 + 360) % 360;
    }

    // Compute BSP
    const bsp = computeBsp(polar, activeSail, twa, weather.tws, condition, effects, maneuver, transition, currentMs);

    // Advance position
    const newPos = advancePosition({ lat, lon }, hdg, bsp, dt);
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
    const bspAtNew = computeBsp(polar, activeSail, twaAtNew, weatherAtNew.tws, condition, effects, maneuver, transition, currentMs);

    points.push({
      lat, lon,
      timestamp: currentMs,
      bsp: bspAtNew,
      tws: weatherAtNew.tws,
      twd: weatherAtNew.twd,
    });

    // Check time markers
    const elapsedHours = (currentMs - startMs) / (3600 * 1000);
    while (
      nextTimeMarkerIdx < TIME_MARKER_HOURS.length &&
      elapsedHours >= TIME_MARKER_HOURS[nextTimeMarkerIdx]!
    ) {
      const h = TIME_MARKER_HOURS[nextTimeMarkerIdx]!;
      console.log(`[Worker] ${h}h marker`, {
        lat: lat.toFixed(3),
        lon: lon.toFixed(3),
        hdg: Math.round(hdg),
        bsp: bspAtNew.toFixed(2),
        tws: weatherAtNew.tws.toFixed(1),
        twd: Math.round(weatherAtNew.twd),
      });
      timeMarkers.push({
        index: points.length - 1,
        label: `${h}h`,
      });
      nextTimeMarkerIdx++;
    }
  }

  return { points, timeMarkers, maneuverMarkers, bspMax };
}

// ── Worker message handler ──

self.onmessage = async (e: MessageEvent<WorkerInMessage>) => {
  const msg = e.data;

  if (msg.type === 'compute') {
    try {
      await ensureBalance();
      const result = simulate(msg.input);
      const out: WorkerOutMessage = { type: 'result', result };
      self.postMessage(out);
    } catch (err) {
      const out: WorkerOutMessage = { type: 'error', message: String(err) };
      self.postMessage(out);
    }
  }
};
