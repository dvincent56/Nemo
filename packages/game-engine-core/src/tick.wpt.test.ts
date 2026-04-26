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
  supersedeCapTwaByWaypoint,
  supersedeHeadingIntent,
  supersedeWaypointsByCapTwa,
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

// ---------------------------------------------------------------------------
// Test 4 — captureRadiusNm validation: malformed values (NaN, 0, negative) are
// rejected and the default 0.5 NM applies. A crafted order with NaN must not
// DoS the boat by making capture impossible (NaN <= NaN === false).
// ---------------------------------------------------------------------------

describe('WPT order — captureRadiusNm validation', () => {
  test('NaN captureRadiusNm is ignored, default 0.5 NM applies', async () => {
    const polar = await loadPolar('CLASS40');
    const zones = buildZoneIndex([]);
    const coastline = new CoastlineIndex();
    const tickStartMs = 1_700_000_000_000;
    const tickEndMs = tickStartMs + 30_000;
    const weather = makeWeatherProvider(Math.floor(tickStartMs / 1000));

    // Boat at ~0.4 NM south of waypoint (within default 0.5 NM).
    const startPos: Position = { lat: 46.0, lon: -4.0 };
    const wpt: Position = { lat: 46 + 0.4 / 60, lon: -4.0 }; // ~0.4 NM north
    const wptEnv = makeWptEnvelope(wpt.lat, wpt.lon, tickStartMs, 1, NaN);
    const wptOrderId = wptEnv.order.id;
    const runtime = await makeRuntime(startPos, [wptEnv]);

    const out = runTick(runtime, { polar, weather, zones, coastline }, tickStartMs, tickEndMs);

    // The malformed NaN radius must be rejected; the default 0.5 NM applies,
    // so the boat (~0.4 NM away) captures the waypoint.
    const stillThere = out.runtime.orderHistory.find((o) => o.order.id === wptOrderId);
    assert.equal(
      stillThere,
      undefined,
      `WPT with NaN captureRadiusNm should fall back to default and be captured at 0.4 NM`,
    );
  });

  test('custom captureRadiusNm of 2 NM is honored', async () => {
    const polar = await loadPolar('CLASS40');
    const zones = buildZoneIndex([]);
    const coastline = new CoastlineIndex();
    const tickStartMs = 1_700_000_000_000;
    const tickEndMs = tickStartMs + 30_000;
    const weather = makeWeatherProvider(Math.floor(tickStartMs / 1000));

    // Boat ~1.0 NM south of waypoint, with custom radius 2 NM → capturable.
    const startPos: Position = { lat: 46.0, lon: -4.0 };
    const wpt: Position = { lat: 46 + 1.0 / 60, lon: -4.0 }; // ~1.0 NM north
    const wptEnv = makeWptEnvelope(wpt.lat, wpt.lon, tickStartMs, 1, 2);
    const wptOrderId = wptEnv.order.id;
    const runtime = await makeRuntime(startPos, [wptEnv]);

    const out = runTick(runtime, { polar, weather, zones, coastline }, tickStartMs, tickEndMs);

    const stillThere = out.runtime.orderHistory.find((o) => o.order.id === wptOrderId);
    assert.equal(
      stillThere,
      undefined,
      `WPT with captureRadiusNm=2 should be captured when boat is ~1 NM away`,
    );
  });
});

// ---------------------------------------------------------------------------
// Test 5 — heading-intent supersession: when a CAP order is ingested AFTER
// existing WPT orders, the WPTs must be marked completed so they no longer
// override heading on subsequent ticks. Reproduces the WPT-then-CAP route
// regression where the boat held the bearing-to-last-WPT instead of CAP°.
// ---------------------------------------------------------------------------

describe('orderHistory — supersedeWaypointsByCapTwa', () => {
  test('a CAP order marks earlier non-completed WPTs as completed', () => {
    const wptA = makeWptEnvelope(46, -3, 1_000, 1);
    const wptB = makeWptEnvelope(46.5, -2, 1_001, 2);
    const cap: OrderEnvelope = {
      order: { id: randomUUID(), type: 'CAP', value: { heading: 240 }, trigger: { type: 'IMMEDIATE' } },
      clientTs: 2_000,
      clientSeq: 3,
      trustedTs: 2_000,
      effectiveTs: 2_000,
      receivedAt: 2_000,
      connectionId: 'test',
    };

    const updated = supersedeWaypointsByCapTwa([wptA, wptB], cap);

    assert.equal(updated[0]?.order.completed, true, 'WPT A should be superseded');
    assert.equal(updated[1]?.order.completed, true, 'WPT B should be superseded');
  });

  test('a TWA order marks earlier non-completed WPTs as completed', () => {
    const wptA = makeWptEnvelope(46, -3, 1_000, 1);
    const twa: OrderEnvelope = {
      order: { id: randomUUID(), type: 'TWA', value: { twa: 60 }, trigger: { type: 'IMMEDIATE' } },
      clientTs: 2_000,
      clientSeq: 2,
      trustedTs: 2_000,
      effectiveTs: 2_000,
      receivedAt: 2_000,
      connectionId: 'test',
    };

    const updated = supersedeWaypointsByCapTwa([wptA], twa);
    assert.equal(updated[0]?.order.completed, true, 'WPT should be superseded by TWA');
  });

  test('a SAIL or MODE order does NOT mark WPTs as completed', () => {
    const wptA = makeWptEnvelope(46, -3, 1_000, 1);
    const mode: OrderEnvelope = {
      order: { id: randomUUID(), type: 'MODE', value: { auto: true }, trigger: { type: 'IMMEDIATE' } },
      clientTs: 2_000,
      clientSeq: 2,
      trustedTs: 2_000,
      effectiveTs: 2_000,
      receivedAt: 2_000,
      connectionId: 'test',
    };

    const updated = supersedeWaypointsByCapTwa([wptA], mode);
    assert.notEqual(updated[0]?.order.completed, true, 'MODE must not supersede WPT');
  });

  test('CAP does NOT supersede WPTs whose effectiveTs is later than the CAP', () => {
    const cap: OrderEnvelope = {
      order: { id: randomUUID(), type: 'CAP', value: { heading: 240 }, trigger: { type: 'IMMEDIATE' } },
      clientTs: 1_000,
      clientSeq: 1,
      trustedTs: 1_000,
      effectiveTs: 1_000,
      receivedAt: 1_000,
      connectionId: 'test',
    };
    // Existing history: a WPT at t=500 (will be superseded) and a WPT at t=2000 (newer than CAP, kept).
    const oldWpt = makeWptEnvelope(46, -3, 500, 1);
    const newWpt = makeWptEnvelope(47, -2, 2_000, 2);

    const updated = supersedeWaypointsByCapTwa([oldWpt, newWpt], cap);

    assert.equal(updated[0]?.order.completed, true, 'older WPT superseded');
    assert.notEqual(updated[1]?.order.completed, true, 'newer WPT kept');
  });
});

describe('WPT order — CAP arrives after WPTs and wins heading on subsequent ticks', () => {
  test('boat holds CAP heading after WPT route is superseded by CAP order', async () => {
    const polar = await loadPolar('CLASS40');
    const zones = buildZoneIndex([]);
    const coastline = new CoastlineIndex();
    const tickStartMs = 1_700_000_000_000;
    const tickEndMs = tickStartMs + 30_000;
    const weather = makeWeatherProvider(Math.floor(tickStartMs / 1000));

    const startPos: Position = { lat: 46, lon: -4 };
    // Two WPTs: due east. If they win, heading would be ~90°.
    const wptA = makeWptEnvelope(46, -3.5, tickStartMs - 35_000, 1);
    const wptB = makeWptEnvelope(46, -3.0, tickStartMs - 35_000, 2);
    // Then a CAP @ 180° (due south) arrives later.
    const cap: OrderEnvelope = {
      order: { id: randomUUID(), type: 'CAP', value: { heading: 180 }, trigger: { type: 'IMMEDIATE' } },
      clientTs: tickStartMs - 30_000,
      clientSeq: 3,
      trustedTs: tickStartMs - 30_000,
      effectiveTs: tickStartMs - 30_000,
      receivedAt: tickStartMs - 30_000,
      connectionId: 'test',
    };
    // Apply the same supersession logic the worker uses on ingest.
    const history = supersedeWaypointsByCapTwa([wptA, wptB], cap);
    history.push(cap);

    const runtime = await makeRuntime(startPos, history);

    const out = runTick(runtime, { polar, weather, zones, coastline }, tickStartMs, tickEndMs);

    // Final heading should reflect the CAP (~180°), not the bearing toward WPT B (~90°).
    const finalHeading = out.runtime.boat.heading;
    const deltaToCap = Math.abs(((finalHeading - 180 + 540) % 360) - 180);
    assert.ok(
      deltaToCap < 5,
      `final heading should be ~180° (CAP wins after supersession), got ${finalHeading}`,
    );
  });
});

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

// ---------------------------------------------------------------------------
// Symmetric supersession — a new WPT must mark scheduled-future CAP / TWA
// orders as completed. Without this, the bug-3 scenario reproduces: user
// applies a CAP route (with AT_TIME futures), then applies a WPT route,
// the future CAP fires at its scheduled tick and overrides the WPT heading.
// ---------------------------------------------------------------------------

describe('orderHistory — supersedeCapTwaByWaypoint', () => {
  test('a WPT order marks future CAP orders as completed', () => {
    const cap1: OrderEnvelope = {
      order: { id: randomUUID(), type: 'CAP', value: { heading: 90 }, trigger: { type: 'AT_TIME', time: 5 } },
      clientTs: 1_000, clientSeq: 1, trustedTs: 1_000,
      effectiveTs: 5_000, // future
      receivedAt: 1_000, connectionId: 'test',
    };
    const cap2: OrderEnvelope = {
      order: { id: randomUUID(), type: 'CAP', value: { heading: 180 }, trigger: { type: 'AT_TIME', time: 10 } },
      clientTs: 1_000, clientSeq: 2, trustedTs: 1_000,
      effectiveTs: 10_000, // further future
      receivedAt: 1_000, connectionId: 'test',
    };
    const wpt = makeWptEnvelope(46, -3, 2_000, 3); // earlier than both CAPs

    const updated = supersedeCapTwaByWaypoint([cap1, cap2], wpt);

    assert.equal(updated[0]?.order.completed, true, 'future CAP1 should be superseded by new WPT');
    assert.equal(updated[1]?.order.completed, true, 'future CAP2 should be superseded by new WPT');
  });

  test('a WPT order marks future TWA orders as completed', () => {
    const twa: OrderEnvelope = {
      order: { id: randomUUID(), type: 'TWA', value: { twa: 60 }, trigger: { type: 'AT_TIME', time: 5 } },
      clientTs: 1_000, clientSeq: 1, trustedTs: 1_000,
      effectiveTs: 5_000, receivedAt: 1_000, connectionId: 'test',
    };
    const wpt = makeWptEnvelope(46, -3, 2_000, 2);

    const updated = supersedeCapTwaByWaypoint([twa], wpt);
    assert.equal(updated[0]?.order.completed, true, 'future TWA should be superseded by new WPT');
  });

  test('a WPT order does NOT mark earlier CAP orders as completed', () => {
    // CAP at t=1000 (already in the past relative to WPT at t=2000) was
    // applied at its tick and is no longer in history in practice; the
    // function still skips it gracefully without marking it completed.
    const oldCap: OrderEnvelope = {
      order: { id: randomUUID(), type: 'CAP', value: { heading: 90 }, trigger: { type: 'IMMEDIATE' } },
      clientTs: 1_000, clientSeq: 1, trustedTs: 1_000,
      effectiveTs: 1_000, receivedAt: 1_000, connectionId: 'test',
    };
    const wpt = makeWptEnvelope(46, -3, 2_000, 2);

    const updated = supersedeCapTwaByWaypoint([oldCap], wpt);
    assert.notEqual(updated[0]?.order.completed, true, 'past CAP must not be marked completed');
  });

  test('a CAP order at the same instant as the WPT is superseded (cutoff inclusive)', () => {
    const sameInstantCap: OrderEnvelope = {
      order: { id: randomUUID(), type: 'CAP', value: { heading: 90 }, trigger: { type: 'AT_TIME', time: 2 } },
      clientTs: 2_000, clientSeq: 1, trustedTs: 2_000,
      effectiveTs: 2_000, receivedAt: 2_000, connectionId: 'test',
    };
    const wpt = makeWptEnvelope(46, -3, 2_000, 2);

    const updated = supersedeCapTwaByWaypoint([sameInstantCap], wpt);
    assert.equal(updated[0]?.order.completed, true, 'same-instant CAP must be superseded by WPT');
  });

  test('a non-WPT incoming order is a no-op for supersedeCapTwaByWaypoint', () => {
    const cap: OrderEnvelope = {
      order: { id: randomUUID(), type: 'CAP', value: { heading: 90 }, trigger: { type: 'IMMEDIATE' } },
      clientTs: 1_000, clientSeq: 1, trustedTs: 1_000,
      effectiveTs: 5_000, receivedAt: 1_000, connectionId: 'test',
    };
    const incomingCap: OrderEnvelope = {
      order: { id: randomUUID(), type: 'CAP', value: { heading: 180 }, trigger: { type: 'IMMEDIATE' } },
      clientTs: 2_000, clientSeq: 2, trustedTs: 2_000,
      effectiveTs: 2_000, receivedAt: 2_000, connectionId: 'test',
    };

    const updated = supersedeCapTwaByWaypoint([cap], incomingCap);
    assert.notEqual(updated[0]?.order.completed, true, 'non-WPT incoming must not trigger CAP supersession');
  });
});

describe('orderHistory — supersedeHeadingIntent dispatcher', () => {
  test('CAP incoming → supersedes earlier WPTs', () => {
    const wpt = makeWptEnvelope(46, -3, 1_000, 1);
    const cap: OrderEnvelope = {
      order: { id: randomUUID(), type: 'CAP', value: { heading: 240 }, trigger: { type: 'IMMEDIATE' } },
      clientTs: 2_000, clientSeq: 2, trustedTs: 2_000,
      effectiveTs: 2_000, receivedAt: 2_000, connectionId: 'test',
    };
    const updated = supersedeHeadingIntent([wpt], cap);
    assert.equal(updated[0]?.order.completed, true);
  });

  test('WPT incoming → supersedes future CAP/TWAs', () => {
    const cap: OrderEnvelope = {
      order: { id: randomUUID(), type: 'CAP', value: { heading: 90 }, trigger: { type: 'AT_TIME', time: 5 } },
      clientTs: 1_000, clientSeq: 1, trustedTs: 1_000,
      effectiveTs: 5_000, receivedAt: 1_000, connectionId: 'test',
    };
    const wpt = makeWptEnvelope(46, -3, 2_000, 2);
    const updated = supersedeHeadingIntent([cap], wpt);
    assert.equal(updated[0]?.order.completed, true);
  });
});

// ---------------------------------------------------------------------------
// End-to-end: a future scheduled CAP that has been superseded by a newer WPT
// must NOT influence heading at its scheduled tick. The boat must keep
// heading toward the WPT instead of flipping to the CAP heading.
// ---------------------------------------------------------------------------

describe('WPT order — scheduled future CAP superseded by later WPT does not fire', () => {
  test('boat heads toward WPT even at the tick when superseded CAP would have fired', async () => {
    const polar = await loadPolar('CLASS40');
    const zones = buildZoneIndex([]);
    const coastline = new CoastlineIndex();
    const tickStartMs = 1_700_000_000_000;
    const tickEndMs = tickStartMs + 30_000;
    const weather = makeWeatherProvider(Math.floor(tickStartMs / 1000));

    const startPos: Position = { lat: 46, lon: -4 };
    // Scheduled future CAP @ 212° (SSW) — would flip the heading away from WPT.
    const futureCap: OrderEnvelope = {
      order: {
        id: randomUUID(),
        type: 'CAP',
        value: { heading: 212 },
        trigger: { type: 'AT_TIME', time: Math.floor((tickStartMs + 10_000) / 1000) },
      },
      clientTs: tickStartMs - 60_000,
      clientSeq: 1,
      trustedTs: tickStartMs - 60_000,
      effectiveTs: tickStartMs + 10_000, // mid-tick, would normally fire
      receivedAt: tickStartMs - 60_000,
      connectionId: 'test',
    };
    // WPT due NW (heading ≈ 315°) applied just before the tick.
    const wpt = makeWptEnvelope(46.5, -4.5, tickStartMs - 5_000, 2);
    // Apply symmetric supersession (worker.ts ingest path).
    const history = supersedeHeadingIntent([futureCap], wpt);
    history.push(wpt);

    const runtime = await makeRuntime(startPos, history);

    const out = runTick(runtime, { polar, weather, zones, coastline }, tickStartMs, tickEndMs);

    // Final heading should reflect the WPT bearing (~315°), not the CAP (212°).
    const finalHeading = out.runtime.boat.heading;
    const deltaToCap = Math.abs(((finalHeading - 212 + 540) % 360) - 180);
    const deltaToWpt = Math.abs(((finalHeading - 315 + 540) % 360) - 180);
    assert.ok(
      deltaToWpt < deltaToCap,
      `final heading ${finalHeading} should be closer to WPT bearing (315°) than to superseded CAP (212°)`,
    );
    // And the future CAP must have been dropped from history (purge dropped it).
    const capStillThere = out.runtime.orderHistory.find((o) => o.order.id === futureCap.order.id);
    assert.equal(capStillThere, undefined, 'superseded future CAP should be purged from orderHistory');
  });
});
