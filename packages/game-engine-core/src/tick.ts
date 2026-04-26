import type { Boat, OrderEnvelope, Polar, Position } from '@nemo/shared-types';
import { GameBalance } from '@nemo/game-balance/browser';
import { computeTWA, getPolarSpeed } from '@nemo/polar-lib/browser';
import { applyWear, computeWearDelta, swellSpeedFactor, type ConditionState } from './wear';
import {
  advanceSailState,
  computeOverlapFactor,
  detectManeuver,
  maneuverSpeedFactor,
  requestManualSailChange,
  transitionSpeedFactor,
  type ManeuverPenaltyState,
  type SailRuntimeState,
} from './sails';
import type { SailId } from '@nemo/shared-types';
import { activeWaypointId, buildSegments, type SegmentState, type TickSegment } from './segments';
import { applyZones, getZonesAtPosition, type IndexedZone } from './zones';
import type { WeatherProvider } from './weather';
import { aggregateEffects, type BoatLoadout } from './loadout';
import { computeBsp } from './speed-model';
import { haversineNM } from '@nemo/polar-lib/browser';
import { WPT_DEFAULT_CAPTURE_NM } from './geo';

export interface CoastlineProbe {
  isLoaded(): boolean;
  segmentCrossesCoast(from: Position, to: Position, intermediatePoints?: number): boolean;
  coastRiskLevel(lat: number, lon: number): 0 | 1 | 2 | 3;
}

export interface BoatRuntime {
  boat: Boat;
  raceId: string;                 // canal Redis race:{raceId}:tick
  condition: ConditionState;
  sailState: SailRuntimeState;
  segmentState: SegmentState;
  orderHistory: OrderEnvelope[];
  zonesAlerted: Set<string>;
  loadout: BoatLoadout;
  prevTwa: number | null;
  maneuver: ManeuverPenaltyState | null;
  /** Wall-clock ms du dernier checkpoint trace persisté en base.
   *  null tant qu'aucun checkpoint n'a encore été écrit. */
  lastCheckpointTs: number | null;
}

export interface TickOutcome {
  runtime: BoatRuntime;
  segments: TickSegment[];
  bsp: number;                 // BSP du dernier segment (affiché HUD)
  twa: number;                 // TWA du dernier segment
  tws: number;
  overlapFactor: number;
  /** Multiplier to apply to raw polar speed to get expected BSP under current
   *  conditions, EXCLUDING overlap, transition, maneuver and zone factors.
   *  Includes condition (wear), loadout effects (upgrades) and swell.
   *  Used by client SailPanel to display realistic per-sail speeds. */
  bspBaseMultiplier: number;
  zoneAlerts: { zoneId: string; type: string; reason: string }[];
  zoneCleared: string[];
  coastRisk: 0 | 1 | 2 | 3;
  grounded: boolean;
}

export interface TickDeps {
  polar: Polar;
  weather: WeatherProvider;
  zones: IndexedZone[];
  coastline: CoastlineProbe;
}

/**
 * Tick événementiel :
 *   1. Météo interpolée au point GPS (constante sur les 30s).
 *   2. Facteurs de vitesse amont (condition, transition voile, recouvrement,
 *      manœuvre, zones PENALTY au point d'entrée).
 *   3. buildSegments découpe l'intervalle [tickStartMs, tickEndMs) par
 *      effectiveTs des ordres ; chaque segment avance la position selon
 *      l'état (heading, sail) à ce moment.
 *   4. PIP zones vérifié à chaque boundary de segment (pas seulement final).
 *   5. Usure cumulative sur la durée totale du tick.
 */
export function runTick(
  runtime: BoatRuntime,
  deps: TickDeps,
  tickStartMs: number,
  tickEndMs: number,
): TickOutcome {
  const { boat } = runtime;
  const tickStartUnix = Math.floor(tickStartMs / 1000);
  const tickDurationSec = (tickEndMs - tickStartMs) / 1000;

  const weather = deps.weather.getForecastAt(
    runtime.segmentState.position.lat,
    runtime.segmentState.position.lon,
    tickStartUnix,
  );

  // --- Aggregated loadout effects (TWS-gated) ---
  const aggEffects = aggregateEffects(runtime.loadout.items, { tws: weather.tws });

  // --- État voiles : intégrer les ordres SAIL/MODE du tick AVANT advance ---
  // Include "late" orders (effectiveTs < tickStartMs) — they arrived between ticks
  const twaAtStart = computeTWA(runtime.segmentState.heading, weather.twd);
  let sailState = runtime.sailState;
  // Track effectiveTs of the MODE(auto:true) order so the auto-switch uses the
  // click timestamp as transitionStartMs — keeping client optimistic in sync.
  let autoEnableTs: number | undefined;
  for (const env of runtime.orderHistory) {
    if (env.effectiveTs >= tickEndMs) continue;
    if (env.order.completed) continue;
    if (env.order.type === 'SAIL') {
      const target = env.order.value['sail'];
      if (typeof target === 'string' && target !== sailState.active && !sailState.pending) {
        sailState = requestManualSailChange(sailState, target as SailId, env.effectiveTs, aggEffects);
      }
    } else if (env.order.type === 'MODE') {
      const auto = env.order.value['auto'];
      if (typeof auto === 'boolean') {
        if (auto && !sailState.autoMode) autoEnableTs = env.effectiveTs;
        sailState = { ...sailState, autoMode: auto };
      }
    }
  }
  const newSailState = advanceSailState(
    sailState,
    deps.polar,
    twaAtStart,
    weather.tws,
    tickDurationSec,
    tickStartMs,
    aggEffects,
    autoEnableTs ?? Date.now(),
  );
  // --- Manœuvre (détection sur franchissement de bord) ---
  let maneuver: ManeuverPenaltyState | null = runtime.maneuver;
  if (runtime.prevTwa !== null) {
    const detected = detectManeuver(runtime.prevTwa, twaAtStart, boat.boatClass, tickStartMs, aggEffects);
    if (detected) maneuver = detected;
  }
  // Snapshot the maneuver active at tickStart for per-segment evaluation, then
  // expire it for the runtime continuation if it ends within this tick.
  const maneuverAtStart = maneuver;
  if (maneuver !== null && tickStartMs >= maneuver.endMs) maneuver = null;

  // Facteur = 1 si une manœuvre est en cours (transition de voile OU
  // virement/empannage) : ces états ont déjà leurs propres pénalités et
  // mélanger un bonus de recouvrement avec une pénalité n'a pas de sens.
  const isSailTransitioning = newSailState.transitionEndMs > 0 && tickStartMs < newSailState.transitionEndMs;
  const isTackOrGybe = maneuver !== null && tickStartMs < maneuver.endMs;
  const overlapFactor = computeOverlapFactor(
    newSailState.active,
    twaAtStart,
    weather.tws,
    deps.polar,
    newSailState.autoMode,
    isSailTransitioning || isTackOrGybe,
  );
  const swellFactor = swellSpeedFactor(weather.swh, weather.mwd, runtime.segmentState.heading);

  // Core speed (polar × condition × loadout effects) — shared with routing engine.
  const coreBsp = computeBsp(deps.polar, newSailState.active, twaAtStart, weather.tws, aggEffects, runtime.condition);
  const polarBase = getPolarSpeed(deps.polar, newSailState.active, Math.abs(twaAtStart), weather.tws);
  // Derive the core multiplier without re-expanding the formula: coreBsp / polarBase
  // gives (condition × twaFactor × twsFactor), which is then combined with the
  // remaining tick-specific transients.
  const coreMultiplier = polarBase > 0 ? coreBsp / polarBase : 1;

  // Static portion of the multiplier (constant on the whole tick).
  // The transition (sail change) and maneuver (tack/gybe) penalties are
  // time-bounded — they may end mid-tick. We evaluate them per segment via
  // `perSegmentTimeModulator` so a segment that starts AFTER the penalty's end
  // gets its full BSP, and the broadcast `bsp` (last segment) reflects the
  // boat's instantaneous post-penalty speed.
  const bspMultiplier = overlapFactor
    * coreMultiplier
    * swellFactor;

  // Per-segment time modulator: evaluates transition + maneuver penalties at
  // the segment's start time. We add transitionEndMs and maneuver.endMs as
  // implicit segment boundaries so the post-penalty segment exists.
  const perSegmentTimeModulator = (segStartMs: number): number => {
    const tFactor = transitionSpeedFactor(newSailState, segStartMs, aggEffects);
    const mFactor = maneuverSpeedFactor(maneuverAtStart, segStartMs).factor;
    return tFactor * mFactor;
  };
  const extraBoundariesMs: number[] = [];
  if (newSailState.transitionEndMs > tickStartMs && newSailState.transitionEndMs < tickEndMs) {
    extraBoundariesMs.push(newSailState.transitionEndMs);
  }
  if (maneuverAtStart && maneuverAtStart.endMs > tickStartMs && maneuverAtStart.endMs < tickEndMs) {
    extraBoundariesMs.push(maneuverAtStart.endMs);
  }

  // --- Modulateur zone par segment : calcule le speedMultiplier cumulé ---
  //     des zones WARN + PENALTY qui couvrent la position de DÉPART du segment.
  //     Les 2 types ralentissent (défauts 0.8 / 0.5 via game-balance).
  const zoneModulator = (segStart: Position): number => {
    const hits = getZonesAtPosition(segStart.lat, segStart.lon, deps.zones, tickStartUnix);
    let f = 1.0;
    for (const z of hits) {
      if (z.speedMultiplier !== undefined) {
        f *= z.speedMultiplier;
      } else {
        f *= z.type === 'WARN'
          ? GameBalance.zones.warnDefaultMultiplier
          : GameBalance.zones.penaltyDefaultMultiplier;
      }
    }
    return f;
  };

  // --- Segmentation ---
  // Seed the segment state with the sail decided by advanceSailState so that
  // auto-switch transitions use the correct sail polar from the first segment.
  const { segments, finalState } = buildSegments({
    tickStartMs,
    tickEndMs,
    initialState: { ...runtime.segmentState, sail: newSailState.active },
    orders: runtime.orderHistory,
    polar: deps.polar,
    weather,
    bspMultiplier,
    perSegmentBspModulator: zoneModulator,
    perSegmentTimeModulator,
    extraBoundariesMs,
  });

  // --- PIP zones à chaque boundary (entrée segment = position de départ) ---
  const zoneHitsAcrossTick = new Set<string>();
  const newAlerts: { zoneId: string; type: string; reason: string }[] = [];
  const checkPositions: Position[] = [runtime.segmentState.position];
  for (const seg of segments) checkPositions.push(seg.endPosition);

  for (const pos of checkPositions) {
    const zonesHere = getZonesAtPosition(pos.lat, pos.lon, deps.zones, tickStartUnix);
    const res = applyZones(0, zonesHere, runtime.zonesAlerted);
    for (const z of zonesHere) zoneHitsAcrossTick.add(z.id);
    for (const a of res.newAlerts) {
      if (!newAlerts.find((x) => x.zoneId === a.zoneId)) {
        newAlerts.push({ zoneId: a.zoneId, type: a.type, reason: a.reason });
      }
    }
  }

  const clearedAlerts: string[] = [];
  for (const prev of runtime.zonesAlerted) {
    if (!zoneHitsAcrossTick.has(prev)) clearedAlerts.push(prev);
  }

  // --- Coastline grounding detection ---
  let grounded = false;
  let groundedPosition: Position | null = null;
  if (deps.coastline.isLoaded()) {
    const intermediatePoints = GameBalance.grounding.detectionIntermediatePoints;
    for (const seg of segments) {
      if (deps.coastline.segmentCrossesCoast(seg.startPosition, seg.endPosition, intermediatePoints)) {
        grounded = true;
        groundedPosition = seg.startPosition; // boat stops at pre-crossing position
        break;
      }
    }
  }

  // If grounded, override final position: boat stays at last safe position
  if (grounded && groundedPosition) {
    finalState.position = groundedPosition;
  }

  // --- Position finale : dernier segment ---
  const endPosition: Position = finalState.position;
  const endHeading = finalState.heading;

  // --- Usure cumulative sur la durée du tick ---
  const wearDelta = computeWearDelta(
    weather,
    endHeading,
    tickDurationSec,
    aggEffects,
  );
  let newCondition = applyWear(runtime.condition, wearDelta);

  // Grounding condition damage (scaled by groundingLossMul from loadout)
  if (grounded) {
    const gc = GameBalance.grounding;
    const baseLoss = gc.conditionLossMin +
      Math.random() * (gc.conditionLossMax - gc.conditionLossMin);
    const lossMul = aggEffects.groundingLossMul;
    const loss = baseLoss * lossMul;
    newCondition = {
      hull: Math.max(0, newCondition.hull - loss * 2),
      rig: Math.max(0, newCondition.rig - loss),
      sails: Math.max(0, newCondition.sails - loss * 0.5),
      electronics: newCondition.electronics,
    };
  }

  const lastSeg = segments[segments.length - 1];
  const displayBsp = grounded ? 0 : (lastSeg?.bsp ?? 0);
  const displayTwa = lastSeg?.twa ?? twaAtStart;
  const risk = deps.coastline.isLoaded() ? deps.coastline.coastRiskLevel(endPosition.lat, endPosition.lon) : 0 as const;

  // --- WPT capture detection ---
  // A WPT order stays active across many ticks (it persists until the boat
  // reaches its capture radius — default 0.5 NM). On each tick we check if
  // any active WPT order whose effectiveTs has elapsed should be marked
  // completed based on the current/end position.
  // Default capture radius mirrors the legacy queue-based engine
  // (apps/game-engine/src/engine/orders.ts WPT_REACHED_NM = 0.5).
  // Use the segments list to test capture at any boundary (start, segment ends),
  // so a fast boat that crosses the capture radius mid-tick is detected.
  const wptCheckPositions: Position[] = [runtime.segmentState.position];
  for (const seg of segments) wptCheckPositions.push(seg.endPosition);

  // Only the chain-active WPT may be captured this tick. A WPT whose
  // AT_WAYPOINT predecessor is not yet completed is dormant — its
  // capture radius must NOT trigger completion (otherwise the boat
  // could "skip" intermediate waypoints just by passing near them).
  const activeWptForCapture = activeWaypointId(runtime.orderHistory);
  const completedWptIds = new Set<string>();
  for (const env of runtime.orderHistory) {
    if (env.order.type !== 'WPT') continue;
    if (env.order.completed) continue;
    if (env.effectiveTs >= tickEndMs) continue; // not active yet
    if (env.order.id !== activeWptForCapture) continue; // not the chain head
    const lat = env.order.value['lat'];
    const lon = env.order.value['lon'];
    if (typeof lat !== 'number' || typeof lon !== 'number') continue;
    const radiusRaw = env.order.value['captureRadiusNm'];
    const captureRadiusNm =
      typeof radiusRaw === 'number' && Number.isFinite(radiusRaw) && radiusRaw > 0
        ? radiusRaw
        : WPT_DEFAULT_CAPTURE_NM;
    const wpt: Position = { lat, lon };
    for (const pos of wptCheckPositions) {
      if (haversineNM(pos, wpt) < captureRadiusNm) {
        completedWptIds.add(env.order.id);
        break;
      }
    }
  }

  // Purge orders that fell within this tick's window (already processed).
  // Orders with effectiveTs before tickStartMs are "late" — process them once
  // at the START of the next tick, then purge. So only purge orders strictly
  // within [tickStartMs, tickEndMs).
  // EXCEPTION: WPT orders persist until captured (completed=true) — they are
  // re-applied each tick to recompute the bearing from the new position.
  const remainingOrders = runtime.orderHistory
    .map((o) => completedWptIds.has(o.order.id)
      ? { ...o, order: { ...o.order, completed: true } }
      : o)
    .filter((o) => {
      // Drop completed orders unconditionally — they have been superseded
      // (WPT captured, or CAP/TWA superseded by a later WPT, or vice versa)
      // and should never influence subsequent ticks. Without this, a future
      // CAP marked completed by a freshly-applied WPT route would survive
      // the purge (effectiveTs >= tickEndMs) and re-fire at its scheduled
      // tick, overriding the WPT heading.
      if (o.order.completed) return false;
      // Keep future orders.
      if (o.effectiveTs >= tickEndMs) return true;
      // Keep active, not-yet-captured WPT orders.
      if (o.order.type === 'WPT') return true;
      // Drop everything else (consumed within this tick).
      return false;
    });

  const updatedRuntime: BoatRuntime = {
    ...runtime,
    orderHistory: remainingOrders,
    boat: {
      ...boat,
      position: endPosition,
      heading: endHeading,
      bsp: displayBsp,
      sail: newSailState.active,
      sailState: newSailState.pending ? 'TRANSITION' : 'STABLE',
      hullCondition: Math.round(newCondition.hull),
      rigCondition: Math.round(newCondition.rig),
      sailCondition: Math.round(newCondition.sails),
      elecCondition: Math.round(newCondition.electronics),
    },
    segmentState: {
      position: endPosition,
      heading: endHeading,
      twaLock: finalState.twaLock,
      sail: newSailState.active,
      sailAuto: finalState.sailAuto,
    },
    condition: newCondition,
    sailState: newSailState,
    zonesAlerted: zoneHitsAcrossTick,
    prevTwa: displayTwa,
    maneuver,
  };

  return {
    runtime: updatedRuntime,
    segments,
    bsp: displayBsp,
    twa: displayTwa,
    tws: weather.tws,
    overlapFactor,
    bspBaseMultiplier: coreMultiplier * swellFactor,
    zoneAlerts: newAlerts,
    zoneCleared: clearedAlerts,
    coastRisk: risk,
    grounded,
  };
}
