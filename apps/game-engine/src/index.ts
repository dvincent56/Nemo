import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import pino from 'pino';
import type { Boat } from '@nemo/shared-types';
import { GameBalance } from '@nemo/game-balance';
import { TickManager } from './engine/manager.js';
import type { BoatRuntime } from './engine/tick.js';
import { resolveBoatLoadout } from './engine/loadout.js';
import { registerRaceRoutes, seedRacesIfEmpty } from './api/races.js';
import { registerAuthRoutes } from './api/auth.js';
import { registerMarinaRoutes } from './api/marina.js';
import { getDb } from './db/client.js';
import { seedDevPlayer } from './db/seed-dev.js';
import { connectRedis } from './infra/redis.js';
import { createFixtureProvider, createNoaaProvider, type WeatherProvider, type RedisLike } from './weather/provider.js';
import { registerWeatherRoutes } from './routes/weather.js';

const log = pino({ name: 'game-engine' });

/**
 * Phase 3 : un seul bateau démo attaché à la première course in-memory, pour
 * que le broadcast pipeline soit testable visuellement. La création réelle
 * des BoatRuntime arrivera en Phase 4 (inscription en course → hydratation DB).
 */
function createDemoRuntime(): BoatRuntime {
  const boat: Boat = {
    id: 'demo-boat-1',
    ownerId: 'demo-owner',
    name: 'Nemo Démo',
    boatClass: 'IMOCA60',
    position: { lat: 47.0, lon: -3.0 },
    heading: 216,
    bsp: 0,
    sail: 'GEN',
    sailState: 'STABLE',
    hullCondition: 100, rigCondition: 100, sailCondition: 100, elecCondition: 100,
  };
  return {
    boat,
    raceId: 'r-vendee-2026',
    condition: { hull: 100, rig: 100, sails: 100, electronics: 100 },
    sailState: { active: 'GEN', pending: null, transitionStartMs: 0, transitionEndMs: 0, autoMode: false, timeOutOfRangeSec: 0 },
    segmentState: { position: { lat: 47.0, lon: -3.0 }, heading: 216, twaLock: null, sail: 'GEN', sailAuto: false },
    orderHistory: [],
    zonesAlerted: new Set(),
    loadout: resolveBoatLoadout('demo-boat-1', [], 'IMOCA60'),
    prevTwa: null,
    maneuver: null,
  };
}

function validateCatalogCoverage(): void {
  const cat = GameBalance.upgrades;
  const errors: string[] = [];
  for (const [boatClass, slots] of Object.entries(cat.slotsByClass)) {
    for (const [slot, availability] of Object.entries(slots)) {
      if (availability === 'absent') continue;
      const hasSerie = cat.items.some(
        (it) => it.slot === slot && it.tier === 'SERIE' && it.compat.includes(boatClass as any),
      );
      if (!hasSerie) {
        errors.push(`No SERIE item for ${slot}/${boatClass}`);
      }
    }
  }
  if (errors.length > 0) {
    throw new Error(`Upgrade catalog incomplete:\n${errors.map((e) => `  - ${e}`).join('\n')}`);
  }
  console.log(`[engine] Upgrade catalog validated: ${cat.items.length} items, ${Object.keys(cat.slotsByClass).length} classes`);
}

async function main() {
  await GameBalance.loadFromDisk();
  log.info({ version: GameBalance.version }, 'game-balance loaded');
  validateCatalogCoverage();

  const app = Fastify({ logger: false });
  await app.register(cookie);
  await app.register(cors, {
    origin: process.env['WEB_ORIGIN'] ?? 'http://localhost:3000',
    credentials: true,
  });

  app.get('/health', async () => ({
    status: 'ok',
    balanceVersion: GameBalance.version,
    cognito: !!process.env['COGNITO_REGION'],
    redis: !!process.env['REDIS_URL'],
  }));
  registerAuthRoutes(app);
  registerRaceRoutes(app);
  registerMarinaRoutes(app);
  await seedRacesIfEmpty();

  // Dev-only: seed a local player with boats and starter inventory so the
  // marina UI has real DB-backed data to work against without Cognito.
  const db = getDb();
  if (db && !process.env['COGNITO_REGION']) {
    try {
      await seedDevPlayer(db);
    } catch (err) {
      log.error({ err }, 'dev player seed failed — marina mutations will still work against real accounts');
    }
  }

  let weather: WeatherProvider;
  if (process.env['NEMO_WEATHER_MODE'] === 'noaa') {
    try {
      const { default: Redis } = await import('ioredis');
      const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
      const sub = new Redis(redisUrl);
      const client = new Redis(redisUrl);
      const redisLike: RedisLike = {
        get: (k) => client.get(k),
        keys: (p) => client.keys(p),
        subscribe: (ch) => sub.subscribe(ch),
        on: (ev, cb) => sub.on(ev as 'message', cb),
      };
      weather = await createNoaaProvider(redisLike);
      log.info('weather provider: NOAA (live GFS)');
    } catch (err) {
      log.warn({ err }, 'NOAA provider failed in index, falling back to fixture');
      weather = await createFixtureProvider();
    }
  } else {
    weather = await createFixtureProvider();
  }
  registerWeatherRoutes(app, () => weather);

  const port = Number(process.env['PORT'] ?? 3001);
  await app.listen({ port, host: '0.0.0.0' });
  log.info({ port }, 'game-engine listening');

  const redis = connectRedis();
  const tick = new TickManager(redis);
  tick.start([createDemoRuntime()]).catch((err) => {
    log.error({ err }, 'tick worker failed to start — HTTP still up, gameplay disabled');
  });

  const shutdown = async () => {
    log.info('shutting down');
    await tick.stop();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  log.error({ err }, 'fatal');
  process.exit(1);
});
