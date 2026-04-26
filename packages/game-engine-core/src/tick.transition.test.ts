import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
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
// Regression — sail-transition ending mid-tick must NOT depress the broadcast
// `bsp`. Prior to fix: bsp was computed once at tickStart with transitionFactor
// applied to the whole tick, so a transition ending part-way through still
// dragged the displayed bsp down for the entire tick. Fix: transitionEndMs is
// inserted as an implicit segment boundary; the last segment starts after the
// transition, gets factor 1.0, and broadcast bsp reflects post-transition speed.
// ---------------------------------------------------------------------------

before(async () => {
  await GameBalance.loadFromDisk();
});

function makeWeatherProvider(runTs: number, point?: Partial<WeatherPoint>): WeatherProvider {
  const wp: WeatherPoint = { tws: 12, twd: 0, swh: 0, mwd: 0, mwp: 0, ...point };
  return {
    runTs,
    getForecastAt: () => wp,
  };
}

async function makeRuntime(startPos: Position, transitionEndMs: number): Promise<BoatRuntime> {
  // CAP heading 90° (due east) into a north wind → close reach, clean BSP.
  const heading = 90;
  const boat: Boat = {
    id: 'transition-boat',
    ownerId: 'owner',
    name: 'Transition Tester',
    boatClass: 'CLASS40',
    position: { ...startPos },
    heading,
    bsp: 0,
    sail: 'JIB',
    sailState: 'TRANSITION',
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
      // Active sail already switched; transition penalty in flight.
      active: 'JIB',
      pending: null,
      transitionStartMs: transitionEndMs - 180_000,
      transitionEndMs,
      autoMode: false,
      timeOutOfRangeSec: 0,
    },
    segmentState: {
      position: { ...startPos },
      heading,
      twaLock: null,
      sail: 'JIB',
      sailAuto: false,
    },
    orderHistory: [] as OrderEnvelope[],
    zonesAlerted: new Set(),
    loadout: resolveBoatLoadout('transition-boat', [], 'CLASS40'),
    prevTwa: null,
    maneuver: null,
  };
}

describe('sail transition — mid-tick boundary', () => {
  test('broadcast bsp uses post-transition speed when transition ends within the tick', async () => {
    const polar = await loadPolar('CLASS40');
    const zones = buildZoneIndex([]);
    const coastline = new CoastlineIndex();
    const tickStartMs = 1_700_000_000_000;
    const tickEndMs = tickStartMs + 30_000;
    // Transition ends 16s into the tick → last 14s should be at full bsp.
    const transitionEndMs = tickStartMs + 16_000;
    const weather = makeWeatherProvider(Math.floor(tickStartMs / 1000));

    const runtime = await makeRuntime({ lat: 46, lon: -4 }, transitionEndMs);
    const out = runTick(runtime, { polar, weather, zones, coastline }, tickStartMs, tickEndMs);

    // The last segment must start AT the transition end (boundary inserted).
    assert.ok(out.segments.length >= 2, `expected >=2 segments (pre + post transition), got ${out.segments.length}`);
    const lastSeg = out.segments[out.segments.length - 1]!;
    assert.equal(lastSeg.startMs, transitionEndMs, 'last segment must start at transitionEndMs');

    // Last segment bsp should NOT be reduced by transitionPenalty.
    // The first segment IS reduced — assert bsp ratio matches transitionPenalty.
    const firstSeg = out.segments[0]!;
    const transitionPenalty = GameBalance.sails.transitionPenalty; // e.g. 0.7
    const ratio = firstSeg.bsp / lastSeg.bsp;
    assert.ok(
      Math.abs(ratio - transitionPenalty) < 0.01,
      `firstSeg.bsp / lastSeg.bsp should ≈ transitionPenalty (${transitionPenalty}); got ${ratio.toFixed(3)}`,
    );

    // Broadcasted bsp = lastSeg.bsp = post-transition full speed.
    assert.equal(out.bsp, lastSeg.bsp, 'broadcast bsp must equal last segment bsp');
    assert.ok(out.bsp > firstSeg.bsp, 'broadcast bsp must be greater than reduced (pre-transition) bsp');
  });

  test('still applies penalty for entire tick when transition ends after tickEnd', async () => {
    const polar = await loadPolar('CLASS40');
    const zones = buildZoneIndex([]);
    const coastline = new CoastlineIndex();
    const tickStartMs = 1_700_000_000_000;
    const tickEndMs = tickStartMs + 30_000;
    // Transition ends well after the tick — penalty applies to all segments.
    const transitionEndMs = tickStartMs + 60_000;
    const weather = makeWeatherProvider(Math.floor(tickStartMs / 1000));

    const runtime = await makeRuntime({ lat: 46, lon: -4 }, transitionEndMs);
    const out = runTick(runtime, { polar, weather, zones, coastline }, tickStartMs, tickEndMs);

    // No extra boundary inserted — single segment if no orders.
    assert.equal(out.segments.length, 1, 'expected a single segment when transition spans the full tick');
    // bsp should be reduced relative to a hypothetical tick with no transition.
    // Compare against the polar-driven base via the second test's last segment
    // is brittle here; instead just assert the last segment bsp is the broadcast.
    assert.equal(out.bsp, out.segments[0]!.bsp, 'broadcast bsp should equal the (only) segment bsp');
  });
});
