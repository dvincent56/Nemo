import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Boat, OrderEnvelope, Position, WeatherPoint } from '@nemo/shared-types';
import { GameBalance } from '@nemo/game-balance';
import { loadPolar } from '@nemo/polar-lib';
import {
  buildZoneIndex,
  CoastlineIndex,
  resolveBoatLoadout,
  runTick,
  type BoatRuntime,
  type WeatherProvider,
} from './index.js';

// ---------------------------------------------------------------------------
// Test fixtures — minimal weather + boat runtime for WPT scenarios.
// ---------------------------------------------------------------------------

before(async () => {
  await GameBalance.loadFromDisk();
});

/** Constant-wind WeatherProvider — wind from north (TWD=0), 12 kts, no swell. */
function makeWeatherProvider(runTs: number, point?: Partial<WeatherPoint>): WeatherProvider {
  const wp: WeatherPoint = { tws: 12, twd: 0, swh: 0, mwd: 0, mwp: 0, ...point };
  return {
    runTs,
    getForecastAt: () => wp,
  };
}

function makeWptEnvelope(
  lat: number,
  lon: number,
  effectiveTs: number,
  seq: number,
  captureRadiusNm?: number,
): OrderEnvelope {
  const value: Record<string, unknown> = { lat, lon };
  if (captureRadiusNm !== undefined) value['captureRadiusNm'] = captureRadiusNm;
  return {
    order: {
      id: randomUUID(),
      type: 'WPT',
      value,
      trigger: { type: 'IMMEDIATE' },
    },
    clientTs: effectiveTs,
    clientSeq: seq,
    trustedTs: effectiveTs,
    effectiveTs,
    receivedAt: effectiveTs,
    connectionId: 'test-wpt',
  };
}

async function makeRuntime(startPos: Position, orderHistory: OrderEnvelope[]): Promise<BoatRuntime> {
  const boat: Boat = {
    id: 'wpt-boat',
    ownerId: 'wpt-owner',
    name: 'WPT Tester',
    boatClass: 'CLASS40',
    position: { ...startPos },
    heading: 0,
    bsp: 0,
    sail: 'JIB',
    sailState: 'STABLE',
    hullCondition: 100,
    rigCondition: 100,
    sailCondition: 100,
    elecCondition: 100,
  };
  return {
    boat,
    raceId: 'test-race',
    condition: { hull: 100, rig: 100, sails: 100, electronics: 100 },
    sailState: {
      active: 'JIB',
      pending: null,
      transitionStartMs: 0,
      transitionEndMs: 0,
      autoMode: false,
      timeOutOfRangeSec: 0,
    },
    segmentState: {
      position: { ...startPos },
      heading: 0,
      twaLock: null,
      sail: 'JIB',
      sailAuto: false,
    },
    orderHistory,
    zonesAlerted: new Set(),
    loadout: resolveBoatLoadout('wpt-boat', [], 'CLASS40'),
    prevTwa: null,
    maneuver: null,
  };
}

// ---------------------------------------------------------------------------
// Test 1 — bearing applied: boat at (46, -4) heading toward waypoint at (46, -3).
// Due east → expected heading ≈ 90°. Tolerance: 10°.
// ---------------------------------------------------------------------------

describe('WPT order — bearing applied to segment heading', () => {
  test('boat heads toward waypoint due east', async () => {
    const polar = await loadPolar('CLASS40');
    const zones = buildZoneIndex([]);
    const coastline = new CoastlineIndex();
    const tickStartMs = 1_700_000_000_000;
    const tickEndMs = tickStartMs + 30_000;
    const weather = makeWeatherProvider(Math.floor(tickStartMs / 1000));

    const startPos: Position = { lat: 46, lon: -4 };
    const wpt: Position = { lat: 46, lon: -3 }; // due east, ~41 NM away
    const orders: OrderEnvelope[] = [
      makeWptEnvelope(wpt.lat, wpt.lon, tickStartMs, 1),
    ];
    const runtime = await makeRuntime(startPos, orders);

    const out = runTick(runtime, { polar, weather, zones, coastline }, tickStartMs, tickEndMs);

    // The first segment should have heading ≈ 90° (east). Tolerance 10°.
    assert.ok(out.segments.length > 0, 'at least one segment expected');
    const firstSegHeading = out.segments[0]!.heading;
    const delta = Math.abs(firstSegHeading - 90);
    assert.ok(
      delta < 10 || Math.abs(delta - 360) < 10,
      `first segment heading should be ~90° (due east), got ${firstSegHeading}`,
    );
  });
});

// ---------------------------------------------------------------------------
// Test 2 — capture detection: boat already inside the capture radius.
// After running a tick the WPT order should be marked completed and removed
// from the runtime's orderHistory.
// ---------------------------------------------------------------------------

describe('WPT order — capture detection', () => {
  test('order is marked completed and removed when boat is within capture radius', async () => {
    const polar = await loadPolar('CLASS40');
    const zones = buildZoneIndex([]);
    const coastline = new CoastlineIndex();
    const tickStartMs = 1_700_000_000_000;
    const tickEndMs = tickStartMs + 30_000;
    const weather = makeWeatherProvider(Math.floor(tickStartMs / 1000));

    // Boat is essentially on the waypoint (within 0.1 NM).
    const startPos: Position = { lat: 46.0, lon: -4.0 };
    const wpt: Position = { lat: 46.001, lon: -4.0 }; // ~0.06 NM north
    const wptEnv = makeWptEnvelope(wpt.lat, wpt.lon, tickStartMs, 1);
    const wptOrderId = wptEnv.order.id;
    const runtime = await makeRuntime(startPos, [wptEnv]);

    const out = runTick(runtime, { polar, weather, zones, coastline }, tickStartMs, tickEndMs);

    // The WPT order should no longer be in remaining orderHistory (it was consumed).
    const stillThere = out.runtime.orderHistory.find((o) => o.order.id === wptOrderId);
    assert.equal(
      stillThere,
      undefined,
      `WPT should be removed/completed after capture; found: ${JSON.stringify(stillThere)}`,
    );
  });

  test('order is NOT removed when boat is outside capture radius', async () => {
    const polar = await loadPolar('CLASS40');
    const zones = buildZoneIndex([]);
    const coastline = new CoastlineIndex();
    const tickStartMs = 1_700_000_000_000;
    const tickEndMs = tickStartMs + 30_000;
    const weather = makeWeatherProvider(Math.floor(tickStartMs / 1000));

    // Boat far from waypoint — won't reach in 30s.
    const startPos: Position = { lat: 46.0, lon: -4.0 };
    const wpt: Position = { lat: 46.0, lon: -3.0 }; // ~41 NM east
    const wptEnv = makeWptEnvelope(wpt.lat, wpt.lon, tickStartMs, 1);
    const wptOrderId = wptEnv.order.id;
    const runtime = await makeRuntime(startPos, [wptEnv]);

    const out = runTick(runtime, { polar, weather, zones, coastline }, tickStartMs, tickEndMs);

    // The WPT order should still be in orderHistory for the next tick.
    const stillThere = out.runtime.orderHistory.find((o) => o.order.id === wptOrderId);
    assert.ok(
      stillThere !== undefined,
      `WPT should remain active until captured; orderHistory has ${out.runtime.orderHistory.length} orders`,
    );
  });
});

// ---------------------------------------------------------------------------
// Test 3 — sequential WPTs: after WPT A is captured, WPT B remains as the next
// not-yet-completed order. We use AT_TIME triggers with B in the future so it
// doesn't fight A within the same tick.
// ---------------------------------------------------------------------------

describe('WPT order — sequential waypoints', () => {
  test('after WPT A is captured, WPT B remains in queue', async () => {
    const polar = await loadPolar('CLASS40');
    const zones = buildZoneIndex([]);
    const coastline = new CoastlineIndex();
    const tickStartMs = 1_700_000_000_000;
    const tickEndMs = tickStartMs + 30_000;
    const weather = makeWeatherProvider(Math.floor(tickStartMs / 1000));

    const startPos: Position = { lat: 46.0, lon: -4.0 };
    const wptA: Position = { lat: 46.001, lon: -4.0 }; // ~0.06 NM north — captured immediately
    const wptB: Position = { lat: 46.5, lon: -4.0 };   // 30 NM north — far

    const envA = makeWptEnvelope(wptA.lat, wptA.lon, tickStartMs, 1);
    const envB = makeWptEnvelope(wptB.lat, wptB.lon, tickEndMs + 60_000, 2); // far future
    const runtime = await makeRuntime(startPos, [envA, envB]);

    const out = runTick(runtime, { polar, weather, zones, coastline }, tickStartMs, tickEndMs);

    // A should be gone, B should remain.
    const aStillThere = out.runtime.orderHistory.find((o) => o.order.id === envA.order.id);
    const bStillThere = out.runtime.orderHistory.find((o) => o.order.id === envB.order.id);
    assert.equal(aStillThere, undefined, 'WPT A should be consumed after capture');
    assert.ok(bStillThere !== undefined, 'WPT B should remain in orderHistory');
    assert.notEqual(bStillThere?.order.completed, true, 'WPT B should not be marked completed');
  });
});
