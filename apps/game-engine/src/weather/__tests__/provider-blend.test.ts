import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createNoaaProvider, type RedisLike } from '../provider.js';

/** Create mock Redis meta + hour keys for a 1x1 grid with one forecast hour. */
function seedGrid(grids: Map<string, string>, runTs: number, u: number, v: number): void {
  // Meta key
  grids.set(`weather:grid:${runTs}`, JSON.stringify({
    runTs,
    bbox: { latMin: 0, latMax: 0.25, lonMin: 0, lonMax: 0.25 },
    resolution: 0.25,
    shape: { rows: 1, cols: 1 },
    forecastHours: [0],
  }));
  // Hour key
  grids.set(`weather:grid:${runTs}:f000`, JSON.stringify({
    u: Buffer.from(new Float32Array([u]).buffer).toString('base64'),
    v: Buffer.from(new Float32Array([v]).buffer).toString('base64'),
    swh: Buffer.from(new Float32Array([2]).buffer).toString('base64'),
    mwdSin: Buffer.from(new Float32Array([0]).buffer).toString('base64'),
    mwdCos: Buffer.from(new Float32Array([1]).buffer).toString('base64'),
    mwp: Buffer.from(new Float32Array([8]).buffer).toString('base64'),
  }));
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
    const runTs = Math.floor(Date.now() / 1000) - 3600;
    const grids = new Map<string, string>();
    seedGrid(grids, runTs, 0, -10);

    const redis = createMockRedis(grids);
    const provider = await createNoaaProvider(redis as unknown as RedisLike);

    assert.equal(provider.mode, 'noaa');
    assert.equal(provider.runTs, runTs);
    assert.equal(provider.blendStatus, 'stable');
    assert.equal(provider.blendAlpha, 0);

    const wp = provider.getForecastAt(0.1, 0.1, runTs);
    assert.ok(Math.abs(wp.tws - 10) < 0.5, `expected tws≈10, got ${wp.tws}`);
  });

  it('transitions to blending when a new run arrives via pub/sub', async () => {
    const runTs1 = Math.floor(Date.now() / 1000) - 3600;
    const runTs2 = runTs1 + 21600;
    const grids = new Map<string, string>();
    seedGrid(grids, runTs1, 0, -10);

    const redis = createMockRedis(grids);
    const provider = await createNoaaProvider(redis as unknown as RedisLike);

    assert.equal(provider.blendStatus, 'stable');

    // Add new grid and trigger pub/sub
    seedGrid(grids, runTs2, -5, -5);
    redis.triggerMessage('weather:grid:updated', String(runTs2));

    await new Promise(resolve => setTimeout(resolve, 50));

    assert.equal(provider.blendStatus, 'blending');
  });
});
