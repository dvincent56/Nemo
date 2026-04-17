import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { blendGridForecast, type BlendState } from '../blend.js';
import type { WeatherGridUV } from '../grid.js';

function makeGrid(runTs: number, u: number, v: number, swh: number): WeatherGridUV {
  return {
    runTs,
    bbox: { latMin: 0, latMax: 0, lonMin: 0, lonMax: 0 },
    resolution: 0.25,
    shape: { rows: 1, cols: 1 },
    forecastHours: [0],
    u: new Float32Array([u]),
    v: new Float32Array([v]),
    swh: new Float32Array([swh]),
    mwdSin: new Float32Array([0]),
    mwdCos: new Float32Array([1]),
    mwp: new Float32Array([8]),
  };
}

describe('blendGridForecast', () => {
  it('returns currentRun point when no blend is active', () => {
    const state: BlendState = {
      currentRun: makeGrid(0, 0, -10, 2),
      nextRun: null,
      blendStartMs: 0,
    };
    const wp = blendGridForecast(state, 0, 0, 0, Date.now());
    assert.ok(Math.abs(wp.tws - 10) < 0.1);
    assert.ok(Math.abs(wp.twd - 0) < 1);
  });

  it('blends 50/50 at halfway through BLEND_DURATION', () => {
    const now = 1000000;
    const state: BlendState = {
      currentRun: makeGrid(0, 0, -10, 2),
      nextRun: makeGrid(21600, -10, 0, 4),
      blendStartMs: now - 1800000, // started 30min ago
    };
    const wp = blendGridForecast(state, 0, 0, 0, now);
    assert.ok(Math.abs(wp.tws - 7.071) < 0.1);
    assert.ok(Math.abs(wp.swh - 3) < 0.1);
  });

  it('returns nextRun point when blend is complete', () => {
    const now = 1000000;
    const state: BlendState = {
      currentRun: makeGrid(0, 0, -10, 2),
      nextRun: makeGrid(21600, -10, 0, 4),
      blendStartMs: now - 3601000,
    };
    const wp = blendGridForecast(state, 0, 0, 0, now);
    assert.ok(Math.abs(wp.tws - 10) < 0.1);
    assert.ok(Math.abs(wp.twd - 90) < 1);
    assert.ok(Math.abs(wp.swh - 4) < 0.1);
  });
});
