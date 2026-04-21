// apps/web/src/workers/simulator.worker.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SimulatorEngine } from '../lib/simulator/engine';
import type { SimOutMessage, SimFleetState } from '../lib/simulator/types';
import { loadFixturePolars, loadFixtureGameBalance, makeConstantWind, makeBoat } from '../lib/simulator/test-fixtures';

function lastTick(events: SimOutMessage[]): Record<string, SimFleetState> {
  const ticks = events.filter((e): e is Extract<SimOutMessage, { type: 'tick' }> => e.type === 'tick');
  const last = ticks[ticks.length - 1];
  assert.ok(last, 'expected at least one tick event');
  return last.fleet;
}

test('simulator engine is deterministic across reset', async () => {
  const polars = loadFixturePolars(['IMOCA60']);
  const gameBalanceJson = loadFixtureGameBalance();
  const { windGrid, windData } = makeConstantWind();
  const coastlineGeoJson = { type: 'FeatureCollection', features: [] };
  const boats = [makeBoat('a', 'IMOCA60'), makeBoat('b', 'IMOCA60')];
  const startTimeMs = 1_700_000_000_000;

  const events1: SimOutMessage[] = [];
  const sim = new SimulatorEngine((msg: SimOutMessage) => events1.push(msg));
  await sim.init({ type: 'init', boats, startPos: { lat: 47, lon: -3 }, startTimeMs, windGrid, windData, coastlineGeoJson, polars, gameBalanceJson });
  sim.setSpeed(3600);
  sim.advanceSync(60_000);
  const fleet1 = lastTick(events1);

  sim.reset();
  const events2: SimOutMessage[] = [];
  sim.setListener((msg: SimOutMessage) => events2.push(msg));
  sim.advanceSync(60_000);
  const fleet2 = lastTick(events2);

  for (const id of Object.keys(fleet1)) {
    const s1 = fleet1[id] as SimFleetState;
    const s2 = fleet2[id] as SimFleetState;
    assert.deepStrictEqual(s2.position, s1.position, `${id} position diverges`);
    assert.equal(s2.distanceNm, s1.distanceNm, `${id} distance diverges`);
  }
});
