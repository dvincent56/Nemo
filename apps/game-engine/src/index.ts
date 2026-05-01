import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { parseCorsAllowlist } from './lib/cors-allowlist.js';
import pino from 'pino';
import type { Boat } from '@nemo/shared-types';
import { GameBalance } from '@nemo/game-balance';
import { TickManager } from './engine/manager.js';
import type { BoatRuntime } from '@nemo/game-engine-core';
import { resolveBoatLoadout, INITIAL_CONDITIONS } from '@nemo/game-engine-core';
import { registerRaceRoutes, seedRacesIfEmpty } from './api/races.js';
import { registerAuthRoutes } from './api/auth.js';
import { loadAuthConfig, assertAuthConfig } from './auth/config.js';
import { registerMarinaRoutes } from './api/marina.js';
import { getDb } from './db/client.js';
import { seedDevPlayer } from './db/seed-dev.js';
import { connectRedis } from './infra/redis.js';
import { createFixtureProvider, createNoaaProvider, type WeatherProvider, type RedisLike } from './weather/provider.js';
import { registerWeatherRoutes } from './routes/weather.js';
import { registerRuntimeRoutes } from './api/runtime.js';
import { registerDevRoutes } from './api/dev.js';
import { registerTrackRoutes } from './api/track.js';

const log = pino({ name: 'game-engine' });

/**
 * Phase 3 : un seul bateau démo attaché à la première course in-memory, pour
 * que le broadcast pipeline soit testable visuellement. La création réelle
 * des BoatRuntime arrivera en Phase 4 (inscription en course → hydratation DB).
 */
export function createDemoRuntime(): BoatRuntime {
  // 45°44'10.04"N / 5°50'23.31"W
  const START_POS = { lat: 45.736122, lon: -5.839808 };
  const boat: Boat = {
    id: 'demo-boat-1',
    ownerId: 'demo-owner',
    name: 'Nemo Démo',
    boatClass: 'CRUISER_RACER',
    position: START_POS,
    heading: 216,
    bsp: 0,
    sail: 'JIB',
    sailState: 'STABLE',
    hullCondition: INITIAL_CONDITIONS.hull,
    rigCondition: INITIAL_CONDITIONS.rig,
    sailCondition: INITIAL_CONDITIONS.sails,
    elecCondition: INITIAL_CONDITIONS.electronics,
  };
  return {
    boat,
    raceId: 'r-vendee-2026',
    condition: { ...INITIAL_CONDITIONS },
    sailState: { active: 'JIB', pending: null, transitionStartMs: 0, transitionEndMs: 0, autoMode: false, timeOutOfRangeSec: 0 },
    segmentState: { position: START_POS, heading: 216, twaLock: null, sail: 'JIB', sailAuto: false },
    orderHistory: [],
    zonesAlerted: new Set(),
    loadout: resolveBoatLoadout('demo-boat-1', [], 'CRUISER_RACER'),
    prevTwa: null,
    maneuver: null,
    lastCheckpointTs: null,
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
  const authConfig = loadAuthConfig();
  assertAuthConfig(authConfig);
  log.info({ mode: authConfig.mode }, 'auth mode resolved');

  await GameBalance.loadFromDisk();
  log.info({ version: GameBalance.version }, 'game-balance loaded');
  validateCatalogCoverage();

  const allowlist = parseCorsAllowlist(process.env['WEB_ORIGIN'] ?? 'http://localhost:3000');
  log.info({ origins: allowlist }, 'CORS allowlist resolved');

  const app = Fastify({ logger: false });
  await app.register(helmet, { contentSecurityPolicy: false }); // API: no CSP, but X-Frame-Options/HSTS/etc.
  await app.register(rateLimit, {
    max: 200,
    timeWindow: '1 minute',
    // Per-IP by default. Authenticated users get a higher quota at route level if needed.
  });
  await app.register(cookie);
  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // same-origin / curl
      if (allowlist.includes(origin)) return cb(null, true);
      cb(new Error('Not allowed by CORS'), false);
    },
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

  // Default to NOAA (live GFS via Redis) so dev + prod share the same data
  // source. Pass `NEMO_WEATHER_MODE=fixture` to force the bundled static
  // fixture (offline dev, tests).
  let weather: WeatherProvider;
  const weatherMode = process.env['NEMO_WEATHER_MODE'] ?? 'noaa';
  if (weatherMode === 'fixture') {
    weather = await createFixtureProvider();
    log.info('weather provider: fixture (NEMO_WEATHER_MODE=fixture)');
  } else {
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
      log.warn({ err }, 'NOAA provider failed, falling back to fixture');
      weather = await createFixtureProvider();
    }
  }
  registerWeatherRoutes(app, () => weather);

  const redis = connectRedis();
  const tick = new TickManager(redis);
  registerRuntimeRoutes(app, tick);
  registerTrackRoutes(app, tick);
  // Dev routes are OFF by default. Local dev sets NEMO_DEV_ROUTES=1 in .env.
  if (process.env['NEMO_DEV_ROUTES'] === '1') {
    registerDevRoutes(app, tick, createDemoRuntime);
    log.warn('dev routes ENABLED — POST /api/v1/dev/reset-demo available (local dev only)');
  }

  const port = Number(process.env['PORT'] ?? 3001);
  await app.listen({ port, host: '0.0.0.0' });
  log.info({ port }, 'game-engine listening');

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
