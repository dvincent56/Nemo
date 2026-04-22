// packages/routing/src/isochrones.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Polar } from '@nemo/shared-types';
import { resolveBoatLoadout } from '@nemo/game-engine-core';
import { GameBalance } from '@nemo/game-balance';
import type { WindGridConfig } from '@nemo/game-engine-core';
import { computeRoute } from './index';
import { haversineNM } from '@nemo/polar-lib/browser';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../..');

function loadPolar(): Polar {
  return JSON.parse(readFileSync(resolve(repoRoot, 'packages/polar-lib/polars/class40.json'), 'utf-8'));
}

function loadGameBalance(): unknown {
  return JSON.parse(readFileSync(resolve(repoRoot, 'packages/game-balance/game-balance.json'), 'utf-8'));
}

// 2x2 grid covering 46..48 N, -4..-2 W, constant 12 kts from north over 48 h.
function constantWind(): { windGrid: WindGridConfig; windData: Float32Array } {
  const cols = 2, rows = 2;
  const now = 1_700_000_000_000;
  const timestamps = [now, now + 48 * 3_600_000];
  const windGrid: WindGridConfig = {
    bounds: { north: 48, south: 46, east: -2, west: -4 },
    resolution: 2, cols, rows, timestamps,
  };
  const points = cols * rows;
  const data = new Float32Array(timestamps.length * points * 5);
  for (let t = 0; t < timestamps.length; t++) {
    for (let i = 0; i < points; i++) {
      const base = (t * points + i) * 5;
      data[base + 0] = 12;       // tws
      data[base + 1] = 180;      // twd (wind blowing from south → heading north gives TWA 0, heading east gives TWA 90)
      data[base + 2] = 0;
      data[base + 3] = 0;
      data[base + 4] = 0;
    }
  }
  return { windGrid, windData: data };
}

test('computeRoute reaches a target with constant wind', async () => {
  GameBalance.load(loadGameBalance());
  const polar = loadPolar();
  const loadout = resolveBoatLoadout('test', [], 'CLASS40');
  const { windGrid, windData } = constantWind();

  const from = { lat: 47, lon: -3 };
  const to   = { lat: 47, lon: -2.5 };  // ~21 NM east

  // BALANCED (2 h step) lands the boat ~1 NM from the 21-NM-east target,
  // satisfying the < 5 NM arrival check. FAST (3 h step) overshoots to
  // ~11 NM away, which is > 5 NM and would fail the arrival assertion.
  const plan = await computeRoute({
    from, to,
    startTimeMs: windGrid.timestamps[0]!,
    polar, loadout,
    condition: { hull: 100, rig: 100, sails: 100, electronics: 100 },
    windGrid, windData,
    coastlineGeoJson: { type: 'FeatureCollection', features: [] },
    preset: 'BALANCED',
  });

  assert.equal(plan.reachedGoal, true, 'expected to reach goal');
  const arrival = plan.polyline[plan.polyline.length - 1]!;
  const distanceToTarget = haversineNM(arrival, to);
  assert.ok(distanceToTarget < 5, `arrival within 5 NM of target, got ${distanceToTarget}`);
  assert.ok(plan.isochrones.length >= 1, 'isochrones captured');
  assert.ok(plan.capSchedule.length >= 1, 'capSchedule produced');
});

test('computeRoute is deterministic', async () => {
  GameBalance.load(loadGameBalance());
  const polar = loadPolar();
  const loadout = resolveBoatLoadout('det', [], 'CLASS40');
  const { windGrid, windData } = constantWind();
  const input = {
    from: { lat: 47, lon: -3 },
    to:   { lat: 47, lon: -2.5 },
    startTimeMs: windGrid.timestamps[0]!,
    polar, loadout,
    condition: { hull: 100, rig: 100, sails: 100, electronics: 100 },
    windGrid, windData,
    coastlineGeoJson: { type: 'FeatureCollection', features: [] },
    preset: 'FAST' as const,
  };
  const a = await computeRoute(input);
  const b = await computeRoute(input);
  assert.deepStrictEqual(a.polyline, b.polyline);
  assert.deepStrictEqual(a.capSchedule, b.capSchedule);
});
