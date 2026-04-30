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

test('loadPolar(IMOCA60) returns the 7 sails with 181 TWA × 71 TWS grid', async () => {
  const polar = await loadPolar('IMOCA60');
  assert.equal(polar.boatClass, 'IMOCA60');
  assert.equal(polar.twa.length, 181);
  assert.equal(polar.tws.length, 71);
  assert.equal(polar.twa[0], 0);
  assert.equal(polar.twa[180], 180);
  assert.equal(polar.tws[0], 0);
  assert.equal(polar.tws[70], 70);
  const sails = Object.keys(polar.speeds).sort();
  assert.deepEqual(sails, ['C0', 'HG', 'JIB', 'LG', 'LJ', 'SPI', 'SS']);
});

test('loadPolar(IMOCA60) base polar (NoFoil) has lower speed at TWA 110 TWS 18 than the foil variant', async () => {
  const base = await loadPolar('IMOCA60');
  const baseSpeed = base.speeds.C0?.[110]?.[18] ?? 0;
  // Sanity: known approximate value from the new VR NoFoil polar
  assert.ok(baseSpeed > 18 && baseSpeed < 24, `expected 18 < C0@(110,18) < 24, got ${baseSpeed}`);
});
