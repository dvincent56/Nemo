import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bandFor } from './bands.js';

test('bandFor — value below first threshold returns 0', () => {
  assert.equal(bandFor(5, [10, 20]), 0);
});

test('bandFor — value at threshold goes into next band', () => {
  assert.equal(bandFor(10, [10, 20]), 1);
});

test('bandFor — value above last threshold returns last band', () => {
  assert.equal(bandFor(35, [10, 20]), 2);
});

test('bandFor — TWA bands [60, 90, 120, 150]', () => {
  assert.equal(bandFor(0, [60, 90, 120, 150]), 0);
  assert.equal(bandFor(45, [60, 90, 120, 150]), 0);
  assert.equal(bandFor(60, [60, 90, 120, 150]), 1);
  assert.equal(bandFor(89, [60, 90, 120, 150]), 1);
  assert.equal(bandFor(90, [60, 90, 120, 150]), 2);
  assert.equal(bandFor(150, [60, 90, 120, 150]), 4);
  assert.equal(bandFor(180, [60, 90, 120, 150]), 4);
});

test('bandFor — empty thresholds returns 0', () => {
  assert.equal(bandFor(100, []), 0);
});
