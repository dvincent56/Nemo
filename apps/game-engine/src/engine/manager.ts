import { Worker } from 'node:worker_threads';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { encode, decode } from '@msgpack/msgpack';
import pino from 'pino';
import type { OrderEnvelope } from '@nemo/shared-types';
import { GameBalance } from '@nemo/game-balance';
import type { BoatRuntime, TickOutcome } from '@nemo/game-engine-core';
import { buildFullUpdate } from '../broadcast/payload.js';
import { CHANNELS, type RedisPair } from '../infra/redis.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const log = pino({ name: 'tick-manager' });

interface TickDoneMsg {
  kind: 'tick:done';
  seq: number;
  runtimes: BoatRuntime[];
  outcomes: TickOutcome[];
}

export interface BoatSnapshot {
  runtime: BoatRuntime;
  outcome: TickOutcome;
  seq: number;
}

export class TickManager {
  private worker: Worker | null = null;
  private timer: NodeJS.Timeout | null = null;
  private redis: RedisPair | null = null;
  /** Last tick result per boat — read by HTTP routes that need a current
   *  runtime snapshot (e.g. /api/v1/races/:raceId/runtime/:boatId). */
  private snapshots = new Map<string, BoatSnapshot>();

  constructor(redis: RedisPair | null = null) {
    this.redis = redis;
  }

  /** Returns the latest runtime snapshot for a boat, or null if it hasn't
   *  been ticked yet (ie. engine is still booting). */
  getBoatSnapshot(boatId: string): BoatSnapshot | null {
    return this.snapshots.get(boatId) ?? null;
  }

  /** Replace the live runtimes in the tick worker and force an immediate
   *  tick so the snapshot carries real BSP/TWA/TWS instead of the neutral
   *  seed. Used by /api/v1/dev/reset-demo — without the forced tick the
   *  client would see bsp=0 for up to tickIntervalSeconds after reset. */
  async replaceRuntimes(runtimes: BoatRuntime[]): Promise<void> {
    this.seedSnapshots(runtimes);
    if (!this.worker) return;
    this.worker.postMessage({ kind: 'setRuntimes', runtimes });
    await new Promise<void>((resolve) => {
      const onMsg = (msg: unknown): void => {
        if ((msg as { kind: string }).kind === 'tick:done') {
          this.worker!.off('message', onMsg);
          resolve();
        }
      };
      this.worker!.on('message', onMsg);
      this.worker!.postMessage({ kind: 'tick' });
    });
  }

  /** Seed snapshots from the initial runtimes so HTTP readers have a value
   *  to return before the first tick fires. Dynamic outcome fields
   *  (bsp/twa/tws/overlap) start neutral and are replaced on the first
   *  tick:done message. */
  private seedSnapshots(initialRuntimes: BoatRuntime[]): void {
    for (const rt of initialRuntimes) {
      this.snapshots.set(rt.boat.id, {
        runtime: rt,
        outcome: {
          runtime: rt,
          segments: [],
          bsp: rt.boat.bsp,
          twa: 0,
          tws: 0,
          overlapFactor: 1,
          zoneAlerts: [],
          zoneCleared: [],
          coastRisk: 0,
          grounded: false,
        },
        seq: 0,
      });
    }
  }

  async start(initialRuntimes: BoatRuntime[]): Promise<void> {
    this.seedSnapshots(initialRuntimes);
    const isDevTs = import.meta.url.endsWith('.ts');
    // Dev : worker-bootstrap.mjs register tsx explicitement avant de charger
    // worker.ts (contourne la propagation loader défaillante dans les Worker
    // threads sur Windows + paths avec espace).
    // Prod : worker.js compilé, chargé directement.
    const workerUrl = pathToFileURL(
      join(__dirname, isDevTs ? 'worker-bootstrap.mjs' : 'worker.js'),
    );
    this.worker = new Worker(workerUrl, {
      workerData: { runtimes: initialRuntimes },
    });

    await new Promise<void>((resolve, reject) => {
      this.worker!.once('message', (msg) => {
        if ((msg as { kind: string }).kind === 'ready') resolve();
        else reject(new Error('unexpected first message'));
      });
      this.worker!.once('error', reject);
    });

    this.worker.on('message', (msg) => {
      const m = msg as { kind: string };
      if (m.kind === 'tick:done') {
        this.onTickDone(m as TickDoneMsg).catch((err) => log.error({ err }, 'broadcast failed'));
      }
    });

    if (this.redis) await this.subscribeOrders();

    const intervalMs = GameBalance.tickIntervalSeconds * 1000;
    this.timer = setInterval(() => {
      this.worker?.postMessage({ kind: 'tick' });
    }, intervalMs);
    log.info({ intervalMs, runtimes: initialRuntimes.length, redis: !!this.redis }, 'tick loop started');
  }

  private async onTickDone(msg: TickDoneMsg): Promise<void> {
    // Cache the latest snapshot per boat for HTTP readers — done first so
    // the data is available even when Redis (and thus broadcasts) is down.
    const byRace = new Map<string, { runtime: BoatRuntime; outcome: TickOutcome }[]>();
    for (let i = 0; i < msg.runtimes.length; i++) {
      const rt = msg.runtimes[i]!;
      const oc = msg.outcomes[i]!;
      this.snapshots.set(rt.boat.id, { runtime: rt, outcome: oc, seq: msg.seq });
      const list = byRace.get(rt.raceId) ?? [];
      list.push({ runtime: rt, outcome: oc });
      byRace.set(rt.raceId, list);
    }
    if (!this.redis) return;
    for (const [raceId, list] of byRace.entries()) {
      const payload = list.map(({ runtime, outcome }) =>
        buildFullUpdate(runtime, outcome, msg.seq, true), // isOwner=true pour tous en phase 3
      );
      const buf = encode(payload);
      await this.redis.pub.publish(CHANNELS.raceTick(raceId), Buffer.from(buf));
    }
  }

  private async subscribeOrders(): Promise<void> {
    if (!this.redis) return;
    await this.redis.sub.psubscribe(CHANNELS.boatOrderPattern);
    this.redis.sub.on('pmessageBuffer', (_pattern, channel, message) => {
      const channelStr = channel.toString();
      const m = /^boat:([^:]+):order$/.exec(channelStr);
      if (!m) return;
      const boatId = m[1]!;
      let envelope: OrderEnvelope;
      try {
        envelope = decode(message) as OrderEnvelope;
      } catch (err) {
        log.warn({ err, channel: channelStr }, 'invalid order payload');
        return;
      }
      this.worker?.postMessage({ kind: 'ingestOrder', boatId, envelope });
    });
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    if (this.worker) {
      this.worker.postMessage({ kind: 'stop' });
      await this.worker.terminate();
    }
    if (this.redis) await this.redis.close();
  }
}
