import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WeatherPoint } from '@nemo/shared-types';
import { decodeGridFromBase64, getForecastAt, type WeatherGrid, type WeatherGridMeta } from './grid.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface WeatherProvider {
  readonly mode: 'fixture' | 'noaa';
  readonly runTs: number;
  getForecastAt(lat: number, lon: number, timeUnix: number): WeatherPoint;
}

type RawGridJson = WeatherGridMeta & {
  variables: { tws: string; twd: string; swh: string; mwd: string; mwp: string };
};

export async function createFixtureProvider(
  fixturePath = join(__dirname, '..', '..', 'fixtures', 'weather-grid.json'),
): Promise<WeatherProvider> {
  const raw = await readFile(fixturePath, 'utf8');
  const parsed = JSON.parse(raw) as RawGridJson;
  const grid: WeatherGrid = decodeGridFromBase64(parsed, parsed.variables);
  return {
    mode: 'fixture',
    runTs: grid.runTs,
    getForecastAt: (lat, lon, t) => getForecastAt(grid, lat, lon, t),
  };
}

/**
 * Redis-backed provider — consumes `weather:grid:{runTs}` published by the
 * Python weather-engine. Subscribes to `weather:grid:updated` for hot reload.
 *
 * Phase 2 minimal wiring: expects an ioredis-compatible client from the caller.
 */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  keys(pattern: string): Promise<string[]>;
  subscribe(channel: string): Promise<unknown>;
  on(event: 'message', listener: (channel: string, message: string) => void): unknown;
}

export async function createNoaaProvider(redis: RedisLike): Promise<WeatherProvider> {
  async function loadLatest(): Promise<WeatherGrid> {
    const keys = await redis.keys('weather:grid:*');
    if (keys.length === 0) throw new Error('no weather grid in redis');
    keys.sort();
    const key = keys[keys.length - 1] as string;
    const raw = await redis.get(key);
    if (!raw) throw new Error(`grid ${key} vanished`);
    const parsed = JSON.parse(raw) as RawGridJson;
    return decodeGridFromBase64(parsed, parsed.variables);
  }

  let grid = await loadLatest();
  await redis.subscribe('weather:grid:updated');
  redis.on('message', (channel, _msg) => {
    if (channel === 'weather:grid:updated') {
      loadLatest().then((g) => { grid = g; }).catch(() => { /* keep previous grid */ });
    }
  });

  return {
    mode: 'noaa',
    get runTs() { return grid.runTs; },
    getForecastAt: (lat, lon, t) => getForecastAt(grid, lat, lon, t),
  };
}
