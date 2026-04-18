import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Boat, OrderEnvelope, Position } from '@nemo/shared-types';
import { GameBalance } from '@nemo/game-balance';
import { advancePosition, getPolarSpeed, haversineNM, loadPolar } from '@nemo/polar-lib';
import { runTick, type BoatRuntime } from '../engine/tick.js';
import { resolveBoatLoadout } from '../engine/loadout.js';
import { buildZoneIndex } from '../engine/zones.js';
import { createFixtureProvider } from '../weather/provider.js';

/**
 * Test segments — scénario 3 ordres dans un seul tick (30s).
 *
 *   t+0 ms     : CAP 090°   (8s est)
 *   t+8 000 ms : CAP 180°   (12s sud)
 *   t+20 000 ms: CAP 270°   (10s ouest)
 *
 * Position finale attendue : somme vectorielle des 3 segments, PAS 30s
 * pleins sur le dernier cap. Tolérance 0.001 NM.
 *
 * On calcule la position attendue localement en reproduisant la même
 * séquence de `advancePosition`/`getPolarSpeed` que le moteur.
 */

function makeCapEnvelope(heading: number, effectiveTs: number, seq: number): OrderEnvelope {
  return {
    order: {
      id: randomUUID(),
      type: 'CAP',
      value: { heading },
      trigger: { type: 'AT_TIME', time: effectiveTs / 1000 },
    },
    clientTs: effectiveTs,
    clientSeq: seq,
    trustedTs: effectiveTs,
    effectiveTs,
    receivedAt: effectiveTs,
    connectionId: 'test-seg',
  };
}

async function main(): Promise<void> {
  await GameBalance.loadFromDisk();
  const polar = await loadPolar('CLASS40');
  const weather = await createFixtureProvider();
  const zones = buildZoneIndex([]);

  const t0Ms = weather.runTs * 1000;
  const tickStart = t0Ms;
  const tickEnd = t0Ms + 30_000;

  const startPos: Position = { lat: 47.0, lon: -3.0 };
  const boat: Boat = {
    id: 'seg-boat', ownerId: 'seg-owner', name: 'Segmenter', boatClass: 'CLASS40',
    position: { ...startPos }, heading: 90, bsp: 0, sail: 'SPI', sailState: 'STABLE',
    hullCondition: 100, rigCondition: 100, sailCondition: 100, elecCondition: 100,
  };

  const orderHistory: OrderEnvelope[] = [
    makeCapEnvelope(90,  tickStart + 0,      1),
    makeCapEnvelope(180, tickStart + 8_000,  2),
    makeCapEnvelope(270, tickStart + 20_000, 3),
  ];

  let runtime: BoatRuntime = {
    boat,
    raceId: 'test-race',
    condition: { hull: 100, rig: 100, sails: 100, electronics: 100 },
    sailState: { active: 'SPI', pending: null, transitionStartMs: 0, transitionEndMs: 0, autoMode: false, timeOutOfRangeSec: 0 },
    segmentState: { position: { ...startPos }, heading: 90, twaLock: null, sail: 'SPI', sailAuto: false },
    orderHistory,
    zonesAlerted: new Set(),
    loadout: resolveBoatLoadout('test-boat', [], 'CLASS40'),
    prevTwa: null,
    maneuver: null,
  };

  const out = runTick(runtime, { polar, weather, zones }, tickStart, tickEnd);
  runtime = out.runtime;

  // --- Position attendue : rejouer localement la même logique ---
  // Le tick n'a pas d'ordre à tickStart (le premier CAP 090° est à t+0 = tickStart,
  // mais la convention du segment builder est : à la frontière tickStartMs elle-même,
  // on n'applique rien (l'état initial = heading=90 déjà). Donc le premier segment
  // est [t+0, t+8000) avec heading=90, puis boundary à t+8000 applique CAP=180, etc.
  const w0 = weather.getForecastAt(startPos.lat, startPos.lon, Math.floor(tickStart / 1000));
  const TWD = w0.twd;
  const TWS = w0.tws;

  function twa(heading: number): number {
    let t = ((heading - TWD + 540) % 360) - 180;
    if (t === -180) t = 180;
    return t;
  }

  let expected: Position = { ...startPos };
  // Segment 1 : [0, 8000) heading 90°
  const bsp1 = getPolarSpeed(polar, twa(90), TWS);
  expected = advancePosition(expected, 90, bsp1, 8);
  // Segment 2 : [8000, 20000) heading 180°
  const bsp2 = getPolarSpeed(polar, twa(180), TWS);
  expected = advancePosition(expected, 180, bsp2, 12);
  // Segment 3 : [20000, 30000) heading 270°
  const bsp3 = getPolarSpeed(polar, twa(270), TWS);
  expected = advancePosition(expected, 270, bsp3, 10);

  // --- Position naïve (scénario faux : 30s plein sur le dernier cap) ---
  const naive = advancePosition(startPos, 270, bsp3, 30);

  const deltaExpected = haversineNM(runtime.boat.position, expected);
  const deltaNaive = haversineNM(runtime.boat.position, naive);

  console.log('=== Test segments — 3 ordres dans un tick ===');
  console.log(`TWS=${TWS} TWD=${TWD}°`);
  console.log(`Segment 1 (0-8s)   : HDG 090° TWA ${twa(90).toFixed(1)}° BSP ${bsp1.toFixed(3)}`);
  console.log(`Segment 2 (8-20s)  : HDG 180° TWA ${twa(180).toFixed(1)}° BSP ${bsp2.toFixed(3)}`);
  console.log(`Segment 3 (20-30s) : HDG 270° TWA ${twa(270).toFixed(1)}° BSP ${bsp3.toFixed(3)}`);
  console.log(`Segments construits par runTick : ${out.segments.length}`);
  for (const [i, s] of out.segments.entries()) {
    console.log(
      `  seg ${i} [${s.startMs - tickStart}ms, ${s.endMs - tickStart}ms) ` +
      `hdg=${s.heading}° twa=${s.twa.toFixed(1)}° bsp=${s.bsp.toFixed(3)} ` +
      `dur=${s.durationSec}s → lat=${s.endPosition.lat.toFixed(6)} lon=${s.endPosition.lon.toFixed(6)}`,
    );
  }
  console.log(`\nPosition moteur    : ${runtime.boat.position.lat.toFixed(6)}, ${runtime.boat.position.lon.toFixed(6)}`);
  console.log(`Position attendue  : ${expected.lat.toFixed(6)}, ${expected.lon.toFixed(6)}`);
  console.log(`Position naïve     : ${naive.lat.toFixed(6)}, ${naive.lon.toFixed(6)}`);
  console.log(`Δ moteur vs attendue : ${deltaExpected.toFixed(6)} NM (tolérance 0.001)`);
  console.log(`Δ moteur vs naïve    : ${deltaNaive.toFixed(6)} NM (doit être >> 0.001)`);

  assert.equal(out.segments.length, 3, 'on attendait 3 segments');
  assert.ok(
    deltaExpected < 0.001,
    `position moteur ≠ position attendue (Δ=${deltaExpected.toFixed(6)} NM)`,
  );
  assert.ok(
    deltaNaive > 0.005,
    `le moteur ne distingue pas les segments — position moteur = position naïve (Δ=${deltaNaive.toFixed(6)})`,
  );

  console.log('\n✓ Test segments OK — le modèle événementiel respecte les timestamps.');
}

main().catch((err) => { console.error(err); process.exit(1); });
