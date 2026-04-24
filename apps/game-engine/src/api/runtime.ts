import type { FastifyInstance } from 'fastify';
import type { SailId } from '@nemo/shared-types';
import type { TickManager } from '../engine/manager.js';
import { aggregateEffects, conditionSpeedPenalty, type AggregatedEffects } from '@nemo/game-engine-core';

const SAIL_IDS: SailId[] = ['JIB', 'LJ', 'SS', 'C0', 'SPI', 'HG', 'LG'];

/** REST-friendly snapshot of a boat, matching the shape consumed by the web
 *  client's `fetchMyBoat` — lets the Play screen hydrate before the first
 *  WS tick arrives and avoids the HUD flashing stale mock data. */
interface BoatSnapshotDTO {
  boatClass: string;
  lat: number;
  lon: number;
  hdg: number;
  bsp: number;
  twd: number;
  tws: number;
  twa: number;
  vmg: number;
  dtf: number;
  overlapFactor: number;
  /** Polar→actual BSP multiplier excluding overlap/transition/maneuver/zone. */
  bspBaseMultiplier: number;
  rank: number;
  totalParticipants: number;
  rankTrend: number;
  wearGlobal: number;
  wearDetail: { hull: number; rig: number; sails: number; electronics: number };
  /** Pénalité de vitesse courante en % (0 = pas de pénalité, 8 = max). */
  speedPenaltyPct: number;
  currentSail: SailId;
  sailAuto: boolean;
  transitionStartMs: number;
  transitionEndMs: number;
  maneuverKind: 0 | 1 | 2;
  maneuverStartMs: number;
  maneuverEndMs: number;
  /** Server-authoritative lock angle; null = heading mode. */
  twaLock: number | null;
  seq: number;
  /** Aggregated loadout effects at snapshot TWS — lets the projection
   *  worker apply the same upgrade/wear multipliers as the live engine. */
  effects: AggregatedEffects;
}

export function registerRuntimeRoutes(app: FastifyInstance, tick: TickManager): void {
  app.get<{ Params: { raceId: string; boatId: string } }>(
    '/api/v1/races/:raceId/runtime/:boatId',
    async (req, reply) => {
      const { raceId, boatId } = req.params;
      const snap = tick.getBoatSnapshot(boatId);
      if (!snap || snap.runtime.raceId !== raceId) {
        return reply.code(404).send({ error: 'boat not found in this race' });
      }
      const { runtime, outcome, seq } = snap;
      const { boat, condition, sailState } = runtime;
      const sail = SAIL_IDS.includes(boat.sail as SailId) ? (boat.sail as SailId) : 'JIB';
      const effects = aggregateEffects(runtime.loadout.items, { tws: outcome.tws });
      const wearGlobal = Math.round(
        (condition.hull + condition.rig + condition.sails + condition.electronics) / 4,
      );
      const speedFactor = conditionSpeedPenalty(condition);
      const speedPenaltyPct = Math.round((1 - speedFactor) * 1000) / 10; // 1 décimale
      const twd = ((boat.heading - outcome.twa) % 360 + 360) % 360;
      const dto: BoatSnapshotDTO = {
        boatClass: boat.boatClass,
        lat: boat.position.lat,
        lon: boat.position.lon,
        hdg: boat.heading,
        bsp: outcome.bsp,
        twd,
        tws: outcome.tws,
        twa: runtime.segmentState.twaLock ?? outcome.twa,
        vmg: 0, // not yet computed in tick outcome
        dtf: 0, // requires route/waypoint math — fill later
        overlapFactor: outcome.overlapFactor,
        bspBaseMultiplier: outcome.bspBaseMultiplier,
        rank: 0,
        totalParticipants: 0,
        rankTrend: 0,
        wearGlobal,
        wearDetail: {
          hull: Math.round(condition.hull),
          rig: Math.round(condition.rig),
          sails: Math.round(condition.sails),
          electronics: Math.round(condition.electronics),
        },
        speedPenaltyPct,
        currentSail: sail,
        sailAuto: sailState.autoMode,
        transitionStartMs: sailState.transitionStartMs,
        transitionEndMs: sailState.transitionEndMs,
        maneuverKind: runtime.maneuver ? (runtime.maneuver.kind === 'TACK' ? 1 : 2) : 0,
        maneuverStartMs: runtime.maneuver?.startMs ?? 0,
        maneuverEndMs: runtime.maneuver?.endMs ?? 0,
        twaLock: runtime.segmentState.twaLock,
        seq,
        effects,
      };
      return dto;
    },
  );
}
