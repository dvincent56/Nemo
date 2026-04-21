import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPolar } from './index.js';

test('loadPolar(MINI650) returns the 7 sails with expected axis lengths', async () => {
  const polar = await loadPolar('MINI650');
  assert.equal(polar.boatClass, 'MINI650');
  assert.equal(polar.twa.length, 181);
  assert.equal(polar.tws.length, 71);
  const sails = Object.keys(polar.speeds).sort();
  assert.deepEqual(sails, ['C0', 'HG', 'JIB', 'LG', 'LJ', 'SPI', 'SS']);
});

test('loadPolar(MINI650) returns a non-zero JIB speed at typical close-hauled point', async () => {
  const polar = await loadPolar('MINI650');
  // JIB at TWA=40, TWS=12 should be a meaningful upwind speed
  const speed = polar.speeds.JIB?.[40]?.[12] ?? 0;
  assert.ok(speed > 2 && speed < 10, `expected 2 < speed < 10, got ${speed}`);
});

test('loadPolar(MINI650) raw data has 0 speed at TWA=0 (head-to-wind source row)', async () => {
  const polar = await loadPolar('MINI650');
  const speed = polar.speeds.JIB?.[0]?.[10] ?? -1;
  assert.equal(speed, 0);
});
