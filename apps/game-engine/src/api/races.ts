import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import pino from 'pino';
import { getDb } from '../db/client.js';
import { races as racesTable } from '../db/schema.js';

const log = pino({ name: 'api.races' });

export type RaceStatus = 'DRAFT' | 'PUBLISHED' | 'BRIEFING' | 'LIVE' | 'FINISHED';

export interface RaceSummary {
  id: string;
  name: string;
  boatClass: 'FIGARO' | 'CLASS40' | 'OCEAN_FIFTY' | 'IMOCA60' | 'ULTIM';
  status: RaceStatus;
  tierRequired: 'FREE' | 'CAREER';
  startsAt: string;
  estimatedDurationHours: number;
  participants: number;
  maxParticipants: number;
  rewardMaxCredits: number;
  course: { start: [number, number]; finish: [number, number]; waypoints: [number, number][] };
}

const SEED: RaceSummary[] = [
  {
    id: 'r-vendee-2026', name: 'Vendée Express 2026', boatClass: 'IMOCA60',
    status: 'LIVE', tierRequired: 'CAREER',
    startsAt: '2026-04-12T12:00:00Z', estimatedDurationHours: 190,
    participants: 428, maxParticipants: 500, rewardMaxCredits: 18000,
    course: { start: [-1.78, 46.50], finish: [-1.78, 46.50], waypoints: [[-50, 0], [20, -40], [-65, -56]] },
  },
  {
    id: 'r-fastnet-sprint', name: 'Fastnet Sprint', boatClass: 'CLASS40',
    status: 'PUBLISHED', tierRequired: 'FREE',
    startsAt: '2026-04-20T09:30:00Z', estimatedDurationHours: 72,
    participants: 116, maxParticipants: 300, rewardMaxCredits: 4200,
    course: { start: [-1.40, 50.75], finish: [-6.70, 51.37], waypoints: [[-2.5, 50.3], [-6.7, 51.37]] },
  },
  {
    id: 'r-atlantic-crossing', name: 'Atlantic Crossing', boatClass: 'ULTIM',
    status: 'BRIEFING', tierRequired: 'CAREER',
    startsAt: '2026-04-18T14:00:00Z', estimatedDurationHours: 96,
    participants: 32, maxParticipants: 50, rewardMaxCredits: 24000,
    course: { start: [-17.1, 32.6], finish: [-60.0, 16.3], waypoints: [[-30, 28], [-45, 22], [-60, 16.3]] },
  },
  {
    id: 'r-figaro-baie-seine', name: 'Baie de Seine Cup', boatClass: 'FIGARO',
    status: 'PUBLISHED', tierRequired: 'FREE',
    startsAt: '2026-04-19T10:00:00Z', estimatedDurationHours: 26,
    participants: 58, maxParticipants: 120, rewardMaxCredits: 2100,
    course: { start: [0.10, 49.50], finish: [-1.88, 49.65], waypoints: [[-0.5, 49.9], [-1.88, 49.65]] },
  },
  {
    id: 'r-transat-jacques-vabre', name: 'Transat Jacques Vabre', boatClass: 'CLASS40',
    status: 'PUBLISHED', tierRequired: 'CAREER',
    startsAt: '2026-05-08T13:00:00Z', estimatedDurationHours: 260,
    participants: 220, maxParticipants: 400, rewardMaxCredits: 14500,
    course: { start: [0.10, 49.50], finish: [-61.5, 16.3], waypoints: [[-9, 43], [-18, 32], [-40, 22], [-61.5, 16.3]] },
  },
  {
    id: 'r-pro-sailing-tour', name: 'Pro Sailing Tour', boatClass: 'OCEAN_FIFTY',
    status: 'PUBLISHED', tierRequired: 'FREE',
    startsAt: '2026-04-25T11:00:00Z', estimatedDurationHours: 54,
    participants: 42, maxParticipants: 80, rewardMaxCredits: 6800,
    course: { start: [-4.50, 48.36], finish: [-1.78, 46.50], waypoints: [[-5.5, 47.8], [-3.2, 47.1], [-1.78, 46.50]] },
  },
  {
    id: 'r-ultim-round-world', name: 'Arkéa Ultim Challenge', boatClass: 'ULTIM',
    status: 'FINISHED', tierRequired: 'CAREER',
    startsAt: '2026-01-07T13:00:00Z', estimatedDurationHours: 1200,
    participants: 6, maxParticipants: 6, rewardMaxCredits: 120000,
    course: { start: [-4.50, 48.36], finish: [-4.50, 48.36], waypoints: [[20, -35], [150, -50], [-65, -56]] },
  },
];

/**
 * Seed idempotent : insère les 7 courses démo si la table `races` est vide.
 * Appelé au démarrage du game-engine quand la DB est disponible.
 */
export async function seedRacesIfEmpty(): Promise<void> {
  const db = getDb();
  if (!db) return;
  try {
    const [row] = await db.execute(sql`SELECT COUNT(*)::int AS count FROM ${racesTable}`);
    const count = Number((row as { count?: number })?.count ?? 0);
    if (count > 0) { log.info({ count }, 'races table already populated — skip seed'); return; }
    for (const r of SEED) {
      await db.insert(racesTable).values({
        id: r.id,
        name: r.name,
        status: r.status,
        boatClass: r.boatClass,
        tierRequired: r.tierRequired,
        courseGeoJson: r.course,
        startsAt: new Date(r.startsAt),
        estimatedDurationHours: r.estimatedDurationHours,
        maxParticipants: r.maxParticipants,
        rewardsConfig: { max: r.rewardMaxCredits },
      }).onConflictDoNothing();
    }
    log.info({ inserted: SEED.length }, 'races seeded');
  } catch (err) {
    log.error({ err }, 'races seed failed — API utilisera le fallback in-memory');
  }
}

async function loadFromDb(): Promise<RaceSummary[] | null> {
  const db = getDb();
  if (!db) return null;
  try {
    const rows = await db.select().from(racesTable);
    return rows.map((r): RaceSummary => {
      const course = (r.courseGeoJson as RaceSummary['course']) ??
        { start: [0, 0], finish: [0, 0], waypoints: [] };
      return {
        id: r.id,
        name: r.name,
        boatClass: r.boatClass as RaceSummary['boatClass'],
        status: r.status as RaceStatus,
        tierRequired: r.tierRequired as 'FREE' | 'CAREER',
        startsAt: r.startsAt.toISOString(),
        estimatedDurationHours: r.estimatedDurationHours ?? 0,
        participants: 0,
        maxParticipants: r.maxParticipants ?? 0,
        rewardMaxCredits: Number(
          (r.rewardsConfig as { max?: number } | null)?.max ?? 0,
        ),
        course,
      };
    });
  } catch (err) {
    log.error({ err }, 'db select failed — fallback in-memory');
    return null;
  }
}

export function registerRaceRoutes(app: FastifyInstance): void {
  app.get('/api/v1/races', async (req) => {
    const q = req.query as { class?: string; status?: string };
    const fromDb = await loadFromDb();
    let out = fromDb ?? SEED.slice();
    if (q.class) out = out.filter((r) => r.boatClass === q.class);
    if (q.status) out = out.filter((r) => r.status === q.status);
    return { races: out, source: fromDb ? 'db' : 'memory' };
  });

  app.get<{ Params: { id: string } }>('/api/v1/races/:id', async (req, reply) => {
    const fromDb = await loadFromDb();
    const list = fromDb ?? SEED;
    const race = list.find((r) => r.id === req.params.id);
    if (!race) { reply.code(404); return { error: 'not found' }; }
    return race;
  });
}
