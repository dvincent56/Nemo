import { parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import pino from 'pino';
import type { OrderEnvelope, Polar } from '@nemo/shared-types';
import { GameBalance } from '@nemo/game-balance';
import { loadPolar } from '@nemo/polar-lib';
import { buildZoneIndex, runTick, type BoatRuntime, type CoastlineProbe, type IndexedZone, type TickOutcome } from '@nemo/game-engine-core';
import { createFixtureProvider, createNoaaProvider, type WeatherProvider } from '../weather/provider.js';
import {
  loadCoastline,
  isCoastlineLoaded,
  segmentCrossesCoast,
  coastRiskLevel,
} from './coastline.js';

interface WorkerInit {
  runtimes: BoatRuntime[];
}

type WorkerMsg =
  | { kind: 'tick' }
  | { kind: 'stop' }
  | { kind: 'setRuntimes'; runtimes: BoatRuntime[] }
  | { kind: 'ingestOrder'; boatId: string; envelope: OrderEnvelope };

const log = pino({ name: 'tick-worker' });

async function createWeather(): Promise<WeatherProvider> {
  if (process.env.NEMO_WEATHER_MODE === 'noaa') {
    try {
      const { default: Redis } = await import('ioredis');
      const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
      const sub = new Redis(redisUrl);
      const client = new Redis(redisUrl);
      const redis = {
        get: (k: string) => client.get(k),
        keys: (p: string) => client.keys(p),
        subscribe: (ch: string) => sub.subscribe(ch),
        on: (ev: string, cb: (ch: string, msg: string) => void) => sub.on(ev as 'message', cb),
      };
      return await createNoaaProvider(redis);
    } catch (err) {
      log.warn({ err }, 'NOAA provider failed, falling back to fixture');
      return createFixtureProvider();
    }
  }
  return createFixtureProvider();
}

async function main() {
  if (!parentPort) throw new Error('worker has no parentPort');
  const init = workerData as WorkerInit;

  await GameBalance.loadFromDisk();
  const polar: Polar = await loadPolar('CRUISER_RACER');
  const weather: WeatherProvider = await createWeather();
  const zones: IndexedZone[] = buildZoneIndex([]);

  // Load coastline for grounding detection (same file as frontend)
  const coastlinePath = process.env.NEMO_COASTLINE_PATH
    ?? fileURLToPath(new URL('../../../../apps/web/public/data/coastline.geojson', import.meta.url));
  try {
    loadCoastline(coastlinePath);
    log.info('coastline loaded for grounding detection');
  } catch (err) {
    log.warn({ err }, 'coastline not loaded — grounding detection disabled');
  }

  // Adapter: wrap module-level coastline functions into the CoastlineProbe interface
  const coastline: CoastlineProbe = {
    isLoaded: isCoastlineLoaded,
    segmentCrossesCoast,
    coastRiskLevel,
  };

  let runtimes: BoatRuntime[] = init.runtimes ?? [];
  let seq = 0;
  const TICK_MS = GameBalance.tickIntervalSeconds * 1000;
  let lastTickEnd = Date.now();

  parentPort.on('message', (msg: WorkerMsg) => {
    if (msg.kind === 'setRuntimes') { runtimes = msg.runtimes; return; }
    if (msg.kind === 'stop') { process.exit(0); }

    if (msg.kind === 'ingestOrder') {
      // Insertion dans l'orderHistory du bon runtime, triée par effectiveTs.
      const idx = runtimes.findIndex((r) => r.boat.id === msg.boatId);
      if (idx < 0) { log.warn({ boatId: msg.boatId }, 'order for unknown boat'); return; }
      const rt = runtimes[idx]!;
      const already = rt.orderHistory.some(
        (o) => o.connectionId === msg.envelope.connectionId && o.clientSeq === msg.envelope.clientSeq,
      );
      if (already) return; // dédup idempotent
      const insertAt = rt.orderHistory.findIndex((o) => o.effectiveTs > msg.envelope.effectiveTs);
      const history = rt.orderHistory.slice();
      if (insertAt === -1) history.push(msg.envelope);
      else history.splice(insertAt, 0, msg.envelope);
      runtimes[idx] = { ...rt, orderHistory: history };
      log.info(
        {
          boatId: msg.boatId,
          type: msg.envelope.order.type,
          effectiveTs: msg.envelope.effectiveTs,
          clientTs: msg.envelope.clientTs,
          receivedAt: msg.envelope.receivedAt,
          value: msg.envelope.order.value,
          wallNow: Date.now(),
        },
        'order ingested',
      );
      return;
    }

    if (msg.kind === 'tick') {
      // Drain any pending ingestOrder messages before running the tick.
      // When a 'tick' and an 'ingestOrder' land in the queue close together,
      // whichever was dequeued first would otherwise win — we want orders
      // that arrived before the tick's wall-clock boundary to be part of
      // this tick. A single setImmediate yield lets the message loop process
      // anything already queued, then we resume with the tick handler below.
      void (async () => {
        await new Promise((r) => setImmediate(r));
        seq += 1;
        const wallNow = Date.now();
        // Anchor tickEndMs to the actual wall clock so lastTickEnd can never
        // drift ahead of real time (e.g. after dev resets or rapid replays).
        const tickStartMs = Math.min(lastTickEnd, wallNow);
        const tickEndMs = wallNow;
        lastTickEnd = wallNow;
        const outcomes: TickOutcome[] = runtimes.map(
          (r) => runTick(r, { polar, weather, zones, coastline }, tickStartMs, tickEndMs),
        );
        runtimes = outcomes.map((o) => o.runtime);
        for (const o of outcomes) {
          log.info({
            tick: seq,
            boat: o.runtime.boat.id,
            lat: o.runtime.boat.position.lat.toFixed(6),
            lon: o.runtime.boat.position.lon.toFixed(6),
            hdg: o.runtime.boat.heading,
            twa: o.twa.toFixed(2),
            tws: o.tws,
            bsp: o.bsp.toFixed(3),
            sail: o.runtime.boat.sail,
            segments: o.segments.length,
            transitionStartMs: o.runtime.sailState.transitionStartMs,
            transitionEndMs: o.runtime.sailState.transitionEndMs,
            tickStartMs,
            tickEndMs,
            now: Date.now(),
          }, 'tick');
        }
        parentPort!.postMessage({ kind: 'tick:done', seq, runtimes, outcomes });
      })();
      return;
    }
  });

  parentPort.postMessage({ kind: 'ready' });
}

main().catch((err) => {
  log.error({ err }, 'worker crashed');
  process.exit(1);
});
