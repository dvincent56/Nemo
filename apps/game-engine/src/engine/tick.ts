import type { Boat, OrderEnvelope, Polar, Position } from '@nemo/shared-types';
import { GameBalance } from '@nemo/game-balance';
import { computeTWA } from '@nemo/polar-lib';
import { applyWear, computeWearDelta, conditionSpeedPenalty, type ConditionState } from './wear.js';
import {
  advanceSailState,
  computeOverlapFactor,
  detectManeuver,
  maneuverSpeedFactor,
  requestManualSailChange,
  transitionSpeedFactor,
  type ManeuverPenaltyState,
  type SailRuntimeState,
} from './sails.js';
import type { SailId } from '@nemo/shared-types';
import { buildSegments, type SegmentState, type TickSegment } from './segments.js';
import { applyZones, getZonesAtPosition, type IndexedZone } from './zones.js';
import type { WeatherProvider } from '../weather/provider.js';
import { aggregateEffects, type BoatLoadout } from './loadout.js';
import { bandFor } from './bands.js';

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
}

export interface TickOutcome {
  runtime: BoatRuntime;
  segments: TickSegment[];
  bsp: number;                 // BSP du dernier segment (affiché HUD)
  twa: number;                 // TWA du dernier segment
  tws: number;
  overlapFactor: number;
  zoneAlerts: { zoneId: string; type: string; reason: string }[];
  zoneCleared: string[];
}

export interface TickDeps {
  polar: Polar;
  weather: WeatherProvider;
  zones: IndexedZone[];
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
  const twaAtStart = computeTWA(runtime.segmentState.heading, weather.twd);
  let sailState = runtime.sailState;
  for (const env of runtime.orderHistory) {
    if (env.effectiveTs < tickStartMs || env.effectiveTs >= tickEndMs) continue;
    if (env.order.type === 'SAIL') {
      const target = env.order.value['sail'];
      if (typeof target === 'string' && target !== sailState.active && !sailState.pending) {
        sailState = requestManualSailChange(sailState, target as SailId, aggEffects);
      }
    } else if (env.order.type === 'MODE') {
      const auto = env.order.value['auto'];
      if (typeof auto === 'boolean') sailState = { ...sailState, autoMode: auto };
    }
  }
  const newSailState = advanceSailState(
    sailState,
    deps.polar,
    twaAtStart,
    weather.tws,
    tickDurationSec,
    aggEffects,
  );
  const transitionFactor = transitionSpeedFactor(sailState, aggEffects);

  // --- Manœuvre (détection sur franchissement de bord) ---
  let maneuver: ManeuverPenaltyState | null = runtime.maneuver;
  if (runtime.prevTwa !== null) {
    const detected = detectManeuver(runtime.prevTwa, twaAtStart, boat.boatClass, tickStartUnix, aggEffects);
    if (detected) maneuver = detected;
  }
  const manEval = maneuverSpeedFactor(maneuver, tickStartUnix);
  if (manEval.expired) maneuver = null;

  const overlapFactor = computeOverlapFactor(
    newSailState.active,
    twaAtStart,
    weather.tws,
    deps.polar,
  );
  const conditionFactor = conditionSpeedPenalty(runtime.condition);

  const twaBand = bandFor(Math.abs(twaAtStart), [60, 90, 120, 150]);
  const twsBand = bandFor(weather.tws, [10, 20]);

  const bspMultiplier = transitionFactor
    * overlapFactor
    * conditionFactor
    * manEval.factor
    * aggEffects.speedByTwa[twaBand]!
    * aggEffects.speedByTws[twsBand]!;

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
  const { segments, finalState } = buildSegments({
    tickStartMs,
    tickEndMs,
    initialState: runtime.segmentState,
    orders: runtime.orderHistory,
    polar: deps.polar,
    weather,
    bspMultiplier,
    perSegmentBspModulator: zoneModulator,
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

  // --- Position finale : dernier segment ---
  const endPosition: Position = finalState.position;
  const endHeading = finalState.heading;

  // --- Usure cumulative sur la durée du tick ---
  const wearDelta = computeWearDelta(
    weather,
    endHeading,
    boat.driveMode,
    tickDurationSec,
    aggEffects,
  );
  const newCondition = applyWear(runtime.condition, wearDelta);

  const lastSeg = segments[segments.length - 1];
  const displayBsp = lastSeg?.bsp ?? 0;
  const displayTwa = lastSeg?.twa ?? twaAtStart;

  const updatedRuntime: BoatRuntime = {
    ...runtime,
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
    zoneAlerts: newAlerts,
    zoneCleared: clearedAlerts,
  };
}
