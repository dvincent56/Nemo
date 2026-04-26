import { Worker } from 'node:worker_threads';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { encode, decode } from '@msgpack/msgpack';
import pino from 'pino';
import type { OrderEnvelope } from '@nemo/shared-types';
import { GameBalance } from '@nemo/game-balance';
import type { BoatRuntime, TickOutcome } from '@nemo/game-engine-core';
import { buildFullUpdate } from '../broadcast/payload.js';
import { buildTrackPointAddedMsg } from '../broadcast/track-event.js';
import { CHANNELS, type RedisPair } from '../infra/redis.js';
import { computeRanks } from './rank.js';
import { enqueueCheckpoints, type CheckpointInput, type CheckpointRow } from './track-checkpoint.js';

/** Phase 1 : tracé en mémoire dans le manager. Phase 4 basculera vers
 *  une persistance DB indexée par participant_id quand le seeding
 *  race_participants sera en place. */
export interface InMemoryTrackPoint {
  ts: number;
  lat: number;
  lon: number;
  rank: number;
}

const TRACK_CHECKPOINT_INTERVAL_MS =
  Number(process.env['TRACK_CHECKPOINT_INTERVAL_MIN'] ?? 60) * 60_000;

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

  /** Track history per boat — populated each tick when a checkpoint is due.
   *  Phase 1 in-memory ; Phase 4 will swap for DB persistence keyed by
   *  participant_id. */
  private trackHistory = new Map<string, InMemoryTrackPoint[]>();

  constructor(redis: RedisPair | null = null) {
    this.redis = redis;
  }

  /** Returns the latest runtime snapshot for a boat, or null if it hasn't
   *  been ticked yet (ie. engine is still booting). */
  getBoatSnapshot(boatId: string): BoatSnapshot | null {
    return this.snapshots.get(boatId) ?? null;
  }

  /** Returns the persisted (in-memory) track points for a boat in
   *  chronological order. Empty array if the boat hasn't been ticked yet
   *  or no checkpoint has fired. */
  getBoatTrack(boatId: string): InMemoryTrackPoint[] {
    return this.trackHistory.get(boatId) ?? [];
  }

  /** Replace the live runtimes in the tick worker and force an immediate
   *  tick so the snapshot carries real BSP/TWA/TWS instead of the neutral
   *  seed. Used by /api/v1/dev/reset-demo — without the forced tick the
   *  client would see bsp=0 for up to tickIntervalSeconds after reset. */
  async replaceRuntimes(runtimes: BoatRuntime[]): Promise<void> {
    // Clear the in-memory track history for the replaced boats so the
    // forced first checkpoint after reset doesn't leave a zigzag from the
    // previous (older) position to the fresh start. lastCheckpointTs on
    // the new runtime is null, so the next tick will force a checkpoint
    // at the reset start position.
    for (const rt of runtimes) {
      this.trackHistory.delete(rt.boat.id);
    }
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

    // Track checkpoints — append to in-memory history per boat, then
    // mutate runtime.lastCheckpointTs in place so the next tick sees it.
    const nowMs = Date.now();
    const newCheckpoints: { boatId: string; raceId: string; row: CheckpointRow }[] = [];
    for (const [, list] of byRace.entries()) {
      // Phase 1 single-boat assumption: rank = 1 since we don't compute DTF.
      // Phase 4 will compute DTF + multi-boat ranking via computeRanks.
      const rankInputs = list.map(({ runtime }) => ({
        participantId: runtime.boat.id,
        dtfNm: 0,
      }));
      const ranks = computeRanks(rankInputs);

      const checkpointInputs: CheckpointInput[] = list.map(({ runtime }) => ({
        participantId: runtime.boat.id,
        lat: runtime.boat.position.lat,
        lon: runtime.boat.position.lon,
        lastCheckpointTs: runtime.lastCheckpointTs,
      }));
      const forceFor = new Set<string>();
      for (const { runtime } of list) {
        if (runtime.lastCheckpointTs === null) forceFor.add(runtime.boat.id);
      }
      const checkpoints = enqueueCheckpoints(
        checkpointInputs,
        ranks,
        nowMs,
        TRACK_CHECKPOINT_INTERVAL_MS,
        forceFor,
      );
      for (const cp of checkpoints) {
        const points = this.trackHistory.get(cp.participantId) ?? [];
        points.push({ ts: cp.tsMs, lat: cp.lat, lon: cp.lon, rank: cp.rank });
        this.trackHistory.set(cp.participantId, points);
        // mutate runtime so the next tick has the updated lastCheckpointTs
        const entry = list.find((x) => x.runtime.boat.id === cp.participantId);
        if (entry) entry.runtime.lastCheckpointTs = cp.tsMs;
        newCheckpoints.push({ boatId: cp.participantId, raceId: entry!.runtime.raceId, row: cp });
      }
    }

    if (newCheckpoints.length > 0) {
      log.info({ count: newCheckpoints.length }, 'track checkpoints persisted');
    }

    if (!this.redis) return;
    for (const [raceId, list] of byRace.entries()) {
      const payload = list.map(({ runtime, outcome }) =>
        buildFullUpdate(runtime, outcome, msg.seq, true), // isOwner=true pour tous en phase 3
      );
      const buf = encode(payload);
      await this.redis.pub.publish(CHANNELS.raceTick(raceId), Buffer.from(buf));
    }

    // Emit a separate batch for track checkpoints (one per boat per
    // checkpoint event). The client filters by participantId to append
    // only its own (and Phase 2 selected opponents) to the track store.
    const eventsByRace = new Map<string, ReturnType<typeof buildTrackPointAddedMsg>[]>();
    for (const cp of newCheckpoints) {
      const ev = buildTrackPointAddedMsg({
        participantId: cp.boatId,
        tsMs: cp.row.tsMs,
        lat: cp.row.lat,
        lon: cp.row.lon,
        rank: cp.row.rank,
      });
      const list = eventsByRace.get(cp.raceId) ?? [];
      list.push(ev);
      eventsByRace.set(cp.raceId, list);
    }
    for (const [raceId, events] of eventsByRace.entries()) {
      const buf = encode(events);
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
