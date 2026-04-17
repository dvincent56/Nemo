import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createNoaaProvider, type RedisLike } from '../provider.js';

function makeGridJson(runTs: number, u: number, v: number): string {
  return JSON.stringify({
    runTs,
    bbox: { latMin: 0, latMax: 0, lonMin: 0, lonMax: 0 },
    resolution: 0.25,
    shape: { rows: 1, cols: 1 },
    forecastHours: [0],
    variables: {
      u: Buffer.from(new Float32Array([u]).buffer).toString('base64'),
      v: Buffer.from(new Float32Array([v]).buffer).toString('base64'),
      swh: Buffer.from(new Float32Array([2]).buffer).toString('base64'),
      mwdSin: Buffer.from(new Float32Array([0]).buffer).toString('base64'),
      mwdCos: Buffer.from(new Float32Array([1]).buffer).toString('base64'),
      mwp: Buffer.from(new Float32Array([8]).buffer).toString('base64'),
    },
  });
}

function createMockRedis(grids: Map<string, string>) {
  const listeners: ((ch: string, msg: string) => void)[] = [];
  return {
    async get(key: string) { return grids.get(key) ?? null; },
    async keys(pattern: string) {
      const prefix = pattern.replace('*', '');
      return [...grids.keys()].filter(k => k.startsWith(prefix));
    },
    async subscribe() {},
    on(_event: string, listener: (ch: string, msg: string) => void) { listeners.push(listener); },
    triggerMessage(ch: string, msg: string) { for (const l of listeners) l(ch, msg); },
  };
}

describe('createNoaaProvider with blending', () => {
  it('starts in noaa-single mode with latest run', async () => {
    // Use a recent runTs so the provider doesn't think the next run is overdue
    const runTs = Math.floor(Date.now() / 1000) - 3600; // 1h ago
    const grids = new Map<string, string>();
    grids.set(`weather:grid:${runTs}`, makeGridJson(runTs, 0, -10));

    const redis = createMockRedis(grids);
    const provider = await createNoaaProvider(redis as unknown as RedisLike);

    assert.equal(provider.mode, 'noaa');
    assert.equal(provider.runTs, runTs);
    assert.equal(provider.blendStatus, 'stable');
    assert.equal(provider.blendAlpha, 0);

    const wp = provider.getForecastAt(0, 0, runTs);
    // u=0, v=-10 → tws = 10 knots, twd = 0°
    assert.ok(Math.abs(wp.tws - 10) < 0.1, `expected tws≈10, got ${wp.tws}`);
  });

  it('transitions to blending when a new run arrives via pub/sub', async () => {
    const runTs1 = Math.floor(Date.now() / 1000) - 3600; // 1h ago
    const runTs2 = runTs1 + 21600; // +6h
    const grids = new Map<string, string>();
    grids.set(`weather:grid:${runTs1}`, makeGridJson(runTs1, 0, -10));

    const redis = createMockRedis(grids);
    const provider = await createNoaaProvider(redis as unknown as RedisLike);

    assert.equal(provider.blendStatus, 'stable');

    // Add new grid and trigger pub/sub
    grids.set(`weather:grid:${runTs2}`, makeGridJson(runTs2, -5, -5));
    redis.triggerMessage('weather:grid:updated', String(runTs2));

    // Wait for async load
    await new Promise(resolve => setTimeout(resolve, 50));

    assert.equal(provider.blendStatus, 'blending');
  });
});
