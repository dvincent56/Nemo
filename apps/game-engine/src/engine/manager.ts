import { Worker } from 'node:worker_threads';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { encode, decode } from '@msgpack/msgpack';
import pino from 'pino';
import type { OrderEnvelope } from '@nemo/shared-types';
import { GameBalance } from '@nemo/game-balance';
import type { BoatRuntime, TickOutcome } from './tick.js';
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

export class TickManager {
  private worker: Worker | null = null;
  private timer: NodeJS.Timeout | null = null;
  private redis: RedisPair | null = null;

  constructor(redis: RedisPair | null = null) {
    this.redis = redis;
  }

  async start(initialRuntimes: BoatRuntime[]): Promise<void> {
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
    if (!this.redis) return;
    // Regroupe par raceId puis publie un batch par course.
    const byRace = new Map<string, { runtime: BoatRuntime; outcome: TickOutcome }[]>();
    for (let i = 0; i < msg.runtimes.length; i++) {
      const rt = msg.runtimes[i]!;
      const oc = msg.outcomes[i]!;
      const list = byRace.get(rt.raceId) ?? [];
      list.push({ runtime: rt, outcome: oc });
      byRace.set(rt.raceId, list);
    }
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
