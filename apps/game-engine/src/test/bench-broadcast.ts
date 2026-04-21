import type { Boat } from '@nemo/shared-types';
import { GameBalance } from '@nemo/game-balance';
import { loadPolar } from '@nemo/polar-lib';
import { runTick, resolveBoatLoadout, buildZoneIndex, CoastlineIndex, type BoatRuntime, type TickOutcome } from '@nemo/game-engine-core';
import { createFixtureProvider } from '../weather/provider.js';
import { buildFullUpdate } from '../broadcast/payload.js';
import { encode } from '@msgpack/msgpack';
import { CHANNELS, connectRedis } from '../infra/redis.js';

/**
 * Tier 2 scaling bench — coût du pipeline broadcast par tick.
 *
 * Étapes mesurées par taille N :
 *   1. buildFullUpdate × N           (construction de l'objet payload)
 *   2. msgpack encode(batch)         (sérialisation)
 *   3. redis.publish(buf)            (seulement si REDIS_URL défini)
 *
 * Taille du payload aussi reportée → utile pour estimer la bande passante
 * Redis et WS en aval.
 */

function buildRuntime(i: number, raceId: string): BoatRuntime {
  const latJitter = ((i * 37) % 1000) / 10000;
  const lonJitter = ((i * 53) % 1000) / 10000;
  const pos = { lat: 47.0 + latJitter, lon: -3.0 + lonJitter };
  const boat: Boat = {
    id: `bench-boat-${i}`,
    ownerId: `owner-${i}`,
    name: `B${i}`,
    boatClass: 'CLASS40',
    position: { ...pos },
    heading: 90,
    bsp: 0,
    sail: 'SPI',
    sailState: 'STABLE',
    hullCondition: 100, rigCondition: 100, sailCondition: 100, elecCondition: 100,
  };
  return {
    boat,
    raceId,
    condition: { hull: 100, rig: 100, sails: 100, electronics: 100 },
    sailState: { active: 'SPI', pending: null, transitionStartMs: 0, transitionEndMs: 0, autoMode: false, timeOutOfRangeSec: 0 },
    segmentState: { position: { ...pos }, heading: 90, twaLock: null, sail: 'SPI', sailAuto: false },
    orderHistory: [],
    zonesAlerted: new Set(),
    loadout: resolveBoatLoadout(`bench-boat-${i}`, [], 'CLASS40'),
    prevTwa: null,
    maneuver: null,
  };
}

async function main(): Promise<void> {
  await GameBalance.loadFromDisk();
  const polar = await loadPolar('CLASS40');
  const weather = await createFixtureProvider();
  const zones = buildZoneIndex([]);
  const coastline = new CoastlineIndex();
  const deps = { polar, weather, zones, coastline };
  const t0Ms = weather.runTs * 1000;

  const redis = connectRedis();
  if (redis) console.log('Redis détecté → publish sera mesuré.');
  else console.log('REDIS_URL non défini → publish non mesuré (build + encode uniquement).');

  const sizes = [1_000, 10_000, 100_000, 500_000];
  const raceId = 'bench-race';

  console.log(`\nBench broadcast pipeline (build + encode${redis ? ' + publish' : ''})`);
  console.log('─'.repeat(110));
  console.log('boats       | build       | encode      | publish     | payload size   | total/tick');
  console.log('─'.repeat(110));

  for (const n of sizes) {
    // 1. Produire runtimes + outcomes réels via un tick.
    const runtimes: BoatRuntime[] = [];
    for (let i = 0; i < n; i++) runtimes.push(buildRuntime(i, raceId));
    const outcomes: TickOutcome[] = [];
    for (let i = 0; i < n; i++) {
      const res = runTick(runtimes[i]!, deps, t0Ms, t0Ms + 30_000);
      runtimes[i] = res.runtime;
      outcomes.push(res);
    }

    // 2. buildFullUpdate × N
    const tBuild = performance.now();
    const payloads = new Array(n);
    for (let i = 0; i < n; i++) {
      payloads[i] = buildFullUpdate(runtimes[i]!, outcomes[i]!, 1, true);
    }
    const buildMs = performance.now() - tBuild;

    // 3. msgpack encode
    const tEnc = performance.now();
    const buf = encode(payloads);
    const encodeMs = performance.now() - tEnc;

    // 4. Redis publish (optionnel)
    let publishMs = -1;
    if (redis) {
      const tPub = performance.now();
      await redis.pub.publish(CHANNELS.raceTick(raceId), Buffer.from(buf));
      publishMs = performance.now() - tPub;
    }

    const totalMs = buildMs + encodeMs + (publishMs > 0 ? publishMs : 0);
    const sizeKb = buf.byteLength / 1024;
    const sizeMb = sizeKb / 1024;
    const sizeStr = sizeMb >= 1 ? `${sizeMb.toFixed(2)} MB` : `${sizeKb.toFixed(1)} KB`;

    console.log(
      `${String(n).padStart(11)} | ` +
      `${buildMs.toFixed(2).padStart(9)}ms | ` +
      `${encodeMs.toFixed(2).padStart(9)}ms | ` +
      `${(publishMs >= 0 ? publishMs.toFixed(2) + 'ms' : 'skipped').padStart(11)} | ` +
      `${sizeStr.padStart(13)} | ` +
      `${totalMs.toFixed(2).padStart(9)}ms`,
    );

    if (global.gc) global.gc();
  }
  console.log('─'.repeat(110));
  console.log('\nLecture :');
  console.log('  - "total/tick" doit rester << 30 000 ms (intervalle tick).');
  console.log('  - "payload size" × (ticks/min) ≈ bande passante Redis sortante et WS downstream.');
  console.log('  - À 100k bateaux, un payload > 5 MB indique qu\'il faudra passer en delta-update au lieu de full.\n');

  if (redis) await redis.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
