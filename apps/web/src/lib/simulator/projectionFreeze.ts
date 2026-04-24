// apps/web/src/lib/simulator/projectionFreeze.ts
// Kick off the existing projection.worker.ts once at launch with the primary
// boat's setup. Returns the computed ProjectionResult — the polyline the
// player WOULD see at t=0 given the orders queued. Dev simulator compares
// this frozen line against the live tick-driven trajectory.
//
// referenceTwd choice: we sample the wind at the start position using the
// same packed grid data that the sim worker uses. This gives a consistent
// offset so the projection starts aligned with what the engine sees.

import type {
  ProjectionInput,
  ProjectionResult,
  WorkerInMessage,
  WorkerOutMessage,
} from '@/lib/projection/types';
import type { WindGridConfig } from '@/lib/projection/windLookup';
import { createWindLookup } from '@/lib/projection/windLookup';
import { aggregateEffects } from '@nemo/game-engine-core/browser';
import type { SimBoatSetup } from './types';
import type { Position } from '@nemo/shared-types';
import type { Polar } from '@nemo/shared-types';

export interface FreezePayload {
  boat: SimBoatSetup;
  startPos: Position;
  startTimeMs: number;
  windGrid: WindGridConfig;
  windData: Float32Array;
  polar: Polar;
}

export function freezeProjection(payload: FreezePayload): Promise<ProjectionResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL('../../workers/projection.worker.ts', import.meta.url),
      { type: 'module' },
    );

    worker.onmessage = (e: MessageEvent<WorkerOutMessage>) => {
      const msg = e.data;
      if (msg.type === 'result') {
        resolve(msg.result);
        worker.terminate();
      } else if (msg.type === 'error') {
        reject(new Error(msg.message));
        worker.terminate();
      }
    };

    worker.onerror = (err) => {
      reject(err);
      worker.terminate();
    };

    // Sample the wind at the start position to get a referenceTwd that
    // matches what the game engine sees — avoids a phantom twdOffset.
    const lookup = createWindLookup(payload.windGrid, payload.windData);
    const sample = lookup(payload.startPos.lat, payload.startPos.lon, payload.startTimeMs);
    const referenceTwd = sample?.twd ?? 180; // fallback: north wind

    // Build neutral aggregated effects from the boat's loadout items.
    // aggregateEffects returns an AggregatedEffects which is a structural
    // superset of ProjectionEffects — all required fields are present.
    const aggregated = aggregateEffects(payload.boat.loadout.items);

    const effects: ProjectionInput['effects'] = {
      speedByTwa: aggregated.speedByTwa,
      speedByTws: aggregated.speedByTws,
      wearMul: aggregated.wearMul,
      maneuverMul: aggregated.maneuverMul,
    };

    const input: ProjectionInput = {
      lat: payload.startPos.lat,
      lon: payload.startPos.lon,
      hdg: 270, // heading west — reasonable default for a Vendée-style race
      nowMs: payload.startTimeMs,
      boatClass: payload.boat.boatClass,
      activeSail: payload.boat.initialSail,
      sailAuto: false,
      twaLock: null,
      segments: [],
      polar: payload.polar as ProjectionInput['polar'],
      effects,
      condition: payload.boat.initialCondition,
      activeManeuver: null,
      activeTransition: null,
      prevTwa: null,
      referenceTwd,
      zones: [],
    };

    // Must send setWindGrid before compute so the worker has a cached lookup.
    // We clone windData because the sim worker may have already transferred it;
    // slice() creates a fresh copy from whatever buffer is still accessible.
    const windDataCopy = payload.windData.slice();
    const setGrid: WorkerInMessage = {
      type: 'setWindGrid',
      windGrid: payload.windGrid,
      windData: windDataCopy,
    };
    worker.postMessage(setGrid, [windDataCopy.buffer]);

    const computeMsg: WorkerInMessage = { type: 'compute', input };
    worker.postMessage(computeMsg);
  });
}

// Linearly interpolate the projection polyline at a given absolute timestamp.
// pointsBuf is laid out as [lat, lon, dtMs, bsp, tws, twd] × pointsCount,
// where dtMs is the offset from result.startMs.
export function projectionAt(result: ProjectionResult, absMs: number): Position {
  const buf = result.pointsBuf;
  const n = result.pointsCount;
  if (n === 0) return { lat: 0, lon: 0 };
  const targetDt = absMs - result.startMs;
  if (targetDt <= buf[2]!) return { lat: buf[0]!, lon: buf[1]! };
  for (let i = 1; i < n; i++) {
    const bb = i * 6;
    const bDt = buf[bb + 2]!;
    if (bDt >= targetDt) {
      const ab = (i - 1) * 6;
      const aDt = buf[ab + 2]!;
      const span = bDt - aDt || 1;
      const t = (targetDt - aDt) / span;
      const aLat = buf[ab]!, aLon = buf[ab + 1]!;
      const bLat = buf[bb]!, bLon = buf[bb + 1]!;
      return { lat: aLat + (bLat - aLat) * t, lon: aLon + (bLon - aLon) * t };
    }
  }
  const lastB = (n - 1) * 6;
  return { lat: buf[lastB]!, lon: buf[lastB + 1]! };
}
