import type { FastifyInstance } from 'fastify';
import type { TickManager } from '../engine/manager.js';

/**
 * Renvoie l'historique des track points d'un bateau dans une course.
 * Phase 1 : lecture en mémoire depuis TickManager.trackHistory.
 * Phase 4 : lecture depuis `boat_track_points` keyed by participant_id.
 *
 * Le path utilise `:boatId` (et non `:participantId`) pour Phase 1 puisque
 * le seeding `race_participants` n'est pas en place. Phase 4 renommera la
 * route en `/api/v1/races/:raceId/participants/:participantId/track`.
 */
export function registerTrackRoutes(app: FastifyInstance, tick: TickManager): void {
  app.get<{ Params: { raceId: string; boatId: string } }>(
    '/api/v1/races/:raceId/boats/:boatId/track',
    async (req, reply) => {
      const { raceId, boatId } = req.params;
      const snap = tick.getBoatSnapshot(boatId);
      if (!snap || snap.runtime.raceId !== raceId) {
        return reply.code(404).send({ error: 'boat not found in this race' });
      }
      const points = tick.getBoatTrack(boatId);
      return {
        boatId,
        points: points.map((p) => ({
          ts: new Date(p.ts).toISOString(),
          lat: p.lat,
          lon: p.lon,
          rank: p.rank,
        })),
      };
    },
  );
}
