import type { Boat } from '@nemo/shared-types';
import { GameBalance } from '@nemo/game-balance';
import { loadPolar } from '@nemo/polar-lib';
import { runTick, type BoatRuntime } from '../engine/tick.js';
import { resolveBoatLoadout } from '../engine/loadout.js';
import { buildZoneIndex } from '../engine/zones.js';
import { createFixtureProvider } from '../weather/provider.js';

/**
 * Tier 1 scaling bench — mesure le coût CPU du tick pour N bateaux.
 *
 * Objectif : déterminer combien de bateaux un seul Worker thread peut
 * traiter dans un tick de 30s (budget GameBalance.tickIntervalSeconds).
 *
 * Résultat attendu : µs/bateau stable → on en déduit la capacité max
 * par course et si un sharding intra-course est nécessaire.
 */

interface BenchRow {
  boats: number;
  ticks: number;
  totalMs: number;
  msPerTick: number;
  usPerBoat: number;
  boatsIn30s: number;
}

function buildRuntime(i: number, raceId: string): BoatRuntime {
  // Dispersion légère autour du centre de la fixture météo pour éviter
  // que tous les bateaux tapent exactement la même cellule.
  const latJitter = ((i * 37) % 1000) / 10000;   // 0–0.1°
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
    driveMode: 'NORMAL',
  };

  return {
    boat,
    raceId,
    condition: { hull: 100, rig: 100, sails: 100, electronics: 100 },
    sailState: { active: 'SPI', pending: null, transitionRemainingSec: 0, autoMode: false, timeOutOfRangeSec: 0 },
    segmentState: { position: { ...pos }, heading: 90, twaLock: null, sail: 'SPI', sailAuto: false },
    orderHistory: [],
    zonesAlerted: new Set(),
    loadout: resolveBoatLoadout(`bench-boat-${i}`, [], 'CLASS40'),
    prevTwa: null,
    maneuver: null,
  };
}

async function benchN(boats: number, ticks: number, deps: Parameters<typeof runTick>[1], t0Ms: number): Promise<BenchRow> {
  const TICK_MS = 30_000;
  const runtimes: BoatRuntime[] = [];
  for (let i = 0; i < boats; i++) runtimes.push(buildRuntime(i, 'bench-race'));

  // Warmup : 1 tick non mesuré pour JIT / allocation pools.
  for (let i = 0; i < runtimes.length; i++) {
    const r = runtimes[i]!;
    runtimes[i] = runTick(r, deps, t0Ms, t0Ms + TICK_MS).runtime;
  }

  const start = performance.now();
  for (let t = 1; t <= ticks; t++) {
    const tickStart = t0Ms + t * TICK_MS;
    const tickEnd = tickStart + TICK_MS;
    for (let i = 0; i < runtimes.length; i++) {
      const r = runtimes[i]!;
      runtimes[i] = runTick(r, deps, tickStart, tickEnd).runtime;
    }
  }
  const totalMs = performance.now() - start;
  const msPerTick = totalMs / ticks;
  const usPerBoat = (msPerTick * 1000) / boats;
  const boatsIn30s = Math.floor(30_000_000 / usPerBoat);

  return { boats, ticks, totalMs, msPerTick, usPerBoat, boatsIn30s };
}

async function main(): Promise<void> {
  await GameBalance.loadFromDisk();
  const polar = await loadPolar('CLASS40');
  const weather = await createFixtureProvider();
  const zones = buildZoneIndex([]);
  const deps = { polar, weather, zones };
  const t0Ms = weather.runTs * 1000;

  const sizes = [1_000, 10_000, 100_000, 500_000];
  const ticks = 5;

  console.log(`\nBench tick CPU — ${ticks} ticks mesurés par taille (après 1 warmup)`);
  console.log('─'.repeat(90));
  console.log('boats       | ms/tick     | µs/boat   | budget 30s (estim.)   | total');
  console.log('─'.repeat(90));

  for (const n of sizes) {
    const row = await benchN(n, ticks, deps, t0Ms);
    console.log(
      `${String(row.boats).padStart(11)} | ` +
      `${row.msPerTick.toFixed(2).padStart(10)}ms | ` +
      `${row.usPerBoat.toFixed(2).padStart(8)} | ` +
      `${String(row.boatsIn30s).padStart(15)} boats | ` +
      `${row.totalMs.toFixed(0)}ms`,
    );
    if (global.gc) global.gc();
  }
  console.log('─'.repeat(90));
  console.log('\nLecture : "budget 30s" = combien de bateaux 1 Worker peut traiter');
  console.log('dans 1 tick de 30s en extrapolant le coût/bateau observé.\n');
}

main().catch((err) => { console.error(err); process.exit(1); });
