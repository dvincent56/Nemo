import assert from 'node:assert/strict';
import type { Boat } from '@nemo/shared-types';
import { GameBalance } from '@nemo/game-balance';
import { haversineNM, loadPolar } from '@nemo/polar-lib';
import { runTick, resolveBoatLoadout, buildZoneIndex, CoastlineIndex, type BoatRuntime } from '@nemo/game-engine-core';
import { createFixtureProvider } from '../weather/provider.js';

/**
 * Phase 1 e2e (modèle événementiel) — bateau sans ordres, 10 ticks de 30s.
 * Fixture TWS=12 kts slot 0, TWA=180° (vent arrière), Class40 SPI ≈ 3.8–4.7 kts
 * (per-sail polars, TWS monte 12→15 sur 10 ticks). Fenêtre [0.25, 0.55] NM.
 */
async function main(): Promise<void> {
  await GameBalance.loadFromDisk();
  const polar = await loadPolar('CLASS40');
  const weather = await createFixtureProvider();

  const startPos = { lat: 47.0, lon: -3.0 };
  const t0Ms = weather.runTs * 1000;
  const boat: Boat = {
    id: 'test-boat-1',
    ownerId: 'test-owner',
    name: 'Nautilus',
    boatClass: 'CLASS40',
    position: { ...startPos },
    heading: 90,
    bsp: 0,
    sail: 'SPI',
    sailState: 'STABLE',
    hullCondition: 100, rigCondition: 100, sailCondition: 100, elecCondition: 100,
  };

  let runtime: BoatRuntime = {
    boat,
    raceId: 'test-race',
    condition: { hull: 100, rig: 100, sails: 100, electronics: 100 },
    sailState: { active: 'SPI', pending: null, transitionStartMs: 0, transitionEndMs: 0, autoMode: false, timeOutOfRangeSec: 0 },
    segmentState: {
      position: { ...startPos },
      heading: 90,
      twaLock: null,
      sail: 'SPI',
      sailAuto: false,
    },
    orderHistory: [],
    zonesAlerted: new Set(),
    loadout: resolveBoatLoadout('demo-boat-1', [], 'CLASS40'),
    prevTwa: null,
    maneuver: null,
  };

  const zones = buildZoneIndex([]);
  const coastline = new CoastlineIndex();
  const TICK_MS = 30_000;

  for (let i = 1; i <= 10; i++) {
    const tickStart = t0Ms + (i - 1) * TICK_MS;
    const tickEnd = t0Ms + i * TICK_MS;
    const res = runTick(runtime, { polar, weather, zones, coastline }, tickStart, tickEnd);
    runtime = res.runtime;
    console.log(
      `tick ${String(i).padStart(2)} | lat ${runtime.boat.position.lat.toFixed(6)} lon ${runtime.boat.position.lon.toFixed(6)} | TWA ${res.twa.toFixed(2)}° BSP ${res.bsp.toFixed(3)} kts TWS ${res.tws}`,
    );
  }

  const totalNm = haversineNM(startPos, runtime.boat.position);
  const eastDelta = runtime.boat.position.lon - startPos.lon;
  assert.ok(eastDelta > 0, 'no east progress');
  assert.ok(totalNm >= 0.25 && totalNm <= 0.55, `distance ${totalNm.toFixed(3)} NM out of [0.25, 0.55]`);
  console.log(`\n✓ Phase 1 e2e OK — ${totalNm.toFixed(3)} NM est.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
