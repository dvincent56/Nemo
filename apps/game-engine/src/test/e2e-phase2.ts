import assert from 'node:assert/strict';
import type { Boat, ExclusionZone, OrderEnvelope } from '@nemo/shared-types';
import { randomUUID } from 'node:crypto';
import { GameBalance } from '@nemo/game-balance';
import { loadPolar } from '@nemo/polar-lib';
import { runTick, type BoatRuntime } from '../engine/tick.js';
import { resolveBoatLoadout } from '../engine/loadout.js';
import { buildZoneIndex } from '../engine/zones.js';
import { createFixtureProvider } from '../weather/provider.js';

/**
 * Phase 2 validation (modèle événementiel) — 1h de simulation.
 *   - TWS variable via fixture (12 → 22 → 28 → 32 kts).
 *   - 2 changements de voile programmés avec effectiveTs précis.
 *   - Zone PENALTY 0.70 traversée par le bateau.
 */
function makeEnvelope(
  type: 'SAIL' | 'CAP' | 'TWA',
  value: Record<string, unknown>,
  effectiveTs: number,
  clientSeq: number,
): OrderEnvelope {
  return {
    order: { id: randomUUID(), type, value, trigger: { type: 'AT_TIME', time: effectiveTs / 1000 } },
    clientTs: effectiveTs,
    clientSeq,
    trustedTs: effectiveTs,
    effectiveTs,
    receivedAt: effectiveTs,
    connectionId: 'test-conn',
  };
}

async function main(): Promise<void> {
  await GameBalance.loadFromDisk();
  const polar = await loadPolar('CLASS40');
  const weather = await createFixtureProvider();

  const start = { lat: 47.0, lon: -3.0 };
  const boat: Boat = {
    id: 'p2-boat', ownerId: 'p2-owner', name: 'Argonaut', boatClass: 'CLASS40',
    position: { ...start }, heading: 90, bsp: 0, sail: 'SPI', sailState: 'STABLE',
    hullCondition: 100, rigCondition: 100, sailCondition: 100, elecCondition: 100,
    driveMode: 'NORMAL',
  };

  const penaltyZone: ExclusionZone = {
    id: 'zone-1', raceId: 'race-1', name: 'Dépression ouest', type: 'PENALTY',
    speedMultiplier: 0.70, color: '#c0392b', reason: 'Dépression sévère',
    activeFrom: null, activeTo: null,
    geometry: {
      type: 'Polygon',
      coordinates: [[[-2.92, 46.80], [-2.70, 46.80], [-2.70, 47.20], [-2.92, 47.20], [-2.92, 46.80]]],
    },
  };
  const zones = buildZoneIndex([penaltyZone]);

  const t0Ms = weather.runTs * 1000;
  const orderHistory: OrderEnvelope[] = [
    makeEnvelope('SAIL', { sail: 'JIB' }, t0Ms + 10 * 60 * 1000, 1),
    makeEnvelope('SAIL', { sail: 'C0' },  t0Ms + 30 * 60 * 1000, 2),
  ];

  let runtime: BoatRuntime = {
    boat,
    raceId: 'test-race',
    condition: { hull: 100, rig: 100, sails: 100, electronics: 100 },
    sailState: { active: 'SPI', pending: null, transitionRemainingSec: 0, autoMode: false, timeOutOfRangeSec: 0 },
    segmentState: { position: { ...start }, heading: 90, twaLock: null, sail: 'SPI', sailAuto: false },
    orderHistory,
    zonesAlerted: new Set(),
    loadout: resolveBoatLoadout('test-boat', [], 'CLASS40'),
    prevTwa: null,
    maneuver: null,
  };

  const TICK_MS = 30_000;
  const TICKS = 120;
  let bspInsideZoneMax = 0;
  let bspOutsideZoneMax = 0;
  let sailChanges = 0;
  let lastSail = runtime.boat.sail;
  let maxTws = 0;
  const sailEvents: { tick: number; from: string; to: string }[] = [];

  for (let i = 1; i <= TICKS; i++) {
    const tickStart = t0Ms + (i - 1) * TICK_MS;
    const tickEnd = t0Ms + i * TICK_MS;
    // « inZone » = bateau DÉJÀ dans la zone au début du tick → le modulator
    // zone s'applique sur tous les segments de ce tick. Au tick d'entrée,
    // startedInZone = false (bateau arrive en zone à mi-tick), le BSP n'est
    // pas encore réduit — on ne veut pas le compter dans bspInsideZoneMax.
    const startedInZone = runtime.zonesAlerted.has('zone-1');
    const out = runTick(runtime, { polar, weather, zones }, tickStart, tickEnd);
    runtime = out.runtime;
    maxTws = Math.max(maxTws, out.tws);
    if (runtime.boat.sail !== lastSail) {
      sailChanges += 1;
      sailEvents.push({ tick: i, from: lastSail, to: runtime.boat.sail });
      lastSail = runtime.boat.sail;
    }
    if (startedInZone) bspInsideZoneMax = Math.max(bspInsideZoneMax, out.bsp);
    else bspOutsideZoneMax = Math.max(bspOutsideZoneMax, out.bsp);
  }

  const sailsLoss = 100 - runtime.condition.sails;

  console.log('=== Phase 2 validation (1h, 120 ticks, modèle événementiel) ===');
  console.log(`Max TWS rencontré      : ${maxTws.toFixed(1)} kts`);
  console.log(`BSP max hors zone      : ${bspOutsideZoneMax.toFixed(3)} kts`);
  console.log(`BSP max en zone 0.70   : ${bspInsideZoneMax.toFixed(3)} kts`);
  if (bspOutsideZoneMax > 0) {
    console.log(`Ratio intra/extra      : ${(bspInsideZoneMax / bspOutsideZoneMax).toFixed(3)}`);
  }
  console.log(`Changements de voile   : ${sailChanges}`);
  for (const e of sailEvents) console.log(`  tick ${e.tick} : ${e.from} → ${e.to}`);
  console.log(`Usure voiles           : 100 → ${runtime.condition.sails.toFixed(2)} (perte ${sailsLoss.toFixed(2)} pts)`);
  console.log(`Position finale        : ${runtime.boat.position.lat.toFixed(6)}, ${runtime.boat.position.lon.toFixed(6)}`);

  assert.ok(bspInsideZoneMax > 0, 'le bateau n\'est jamais entré dans la zone PENALTY');
  assert.ok(
    bspOutsideZoneMax > 0 && bspInsideZoneMax / bspOutsideZoneMax < 0.85,
    `ratio BSP intra/extra ne reflète pas la réduction`,
  );
  assert.ok(sailChanges >= 2, `seulement ${sailChanges} changements de voile — attendu ≥ 2`);
  assert.ok(
    sailsLoss >= 0.08,
    `usure voiles ${sailsLoss.toFixed(3)}% — attendu ≥ 0.08% sur 1h`,
  );

  console.log('\n✓ Phase 2 validation OK.');
}

main().catch((err) => { console.error(err); process.exit(1); });
