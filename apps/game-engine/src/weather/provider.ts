import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WeatherPoint } from '@nemo/shared-types';
import { decodeGridFromBase64, decodeGridFromBase64Legacy, getForecastAt, type WeatherGridUV, type WeatherGridUVMeta } from './grid.js';
import { blendGridForecast, isBlendComplete, BLEND_DURATION_MS, type BlendState } from './blend.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export type WeatherStatus = 'stable' | 'blending' | 'delayed';

export interface WeatherProvider {
  readonly mode: 'fixture' | 'noaa';
  readonly runTs: number;
  readonly blendStatus: WeatherStatus;
  readonly blendAlpha: number;
  readonly nextRunExpectedUtc: number;
  getForecastAt(lat: number, lon: number, timeUnix: number): WeatherPoint;
  getGrid(): WeatherGridUV;
}

export interface RedisLike {
  get(key: string): Promise<string | null>;
  keys(pattern: string): Promise<string[]>;
  subscribe(channel: string): Promise<unknown>;
  on(event: 'message', listener: (channel: string, message: string) => void): unknown;
}

type RawGridJson = WeatherGridUVMeta & {
  variables: { tws: string; twd: string; swh: string; mwd: string; mwp: string };
};

export async function createFixtureProvider(
  fixturePath = join(__dirname, '..', '..', 'fixtures', 'weather-grid.json'),
): Promise<WeatherProvider> {
  const raw = await readFile(fixturePath, 'utf8');
  const parsed = JSON.parse(raw) as RawGridJson;
  const grid: WeatherGridUV = decodeGridFromBase64Legacy(parsed, parsed.variables);
  return {
    mode: 'fixture',
    runTs: grid.runTs,
    blendStatus: 'stable',
    blendAlpha: 0,
    nextRunExpectedUtc: 0,
    getForecastAt: (lat, lon, t) => getForecastAt(grid, lat, lon, t),
    getGrid: () => grid,
  };
}

type RawGridJsonUV = WeatherGridUVMeta & {
  variables: { u: string; v: string; swh: string; mwdSin: string; mwdCos: string; mwp: string };
};

const DELAY_THRESHOLD_MS = 5 * 3_600_000; // 5 hours

export async function createNoaaProvider(redis: RedisLike): Promise<WeatherProvider> {
  async function loadGrid(runTs: number): Promise<WeatherGridUV> {
    const raw = await redis.get(`weather:grid:${runTs}`);
    if (!raw) throw new Error(`grid weather:grid:${runTs} not found`);
    const parsed = JSON.parse(raw) as RawGridJsonUV;
    return decodeGridFromBase64(parsed, parsed.variables);
  }

  async function loadLatest(): Promise<WeatherGridUV> {
    const keys = await redis.keys('weather:grid:*');
    if (keys.length === 0) throw new Error('no weather grid in redis');
    keys.sort();
    const key = keys[keys.length - 1] as string;
    const raw = await redis.get(key);
    if (!raw) throw new Error(`grid ${key} vanished`);
    const parsed = JSON.parse(raw) as RawGridJsonUV;
    return decodeGridFromBase64(parsed, parsed.variables);
  }

  const initialGrid = await loadLatest();
  const state: BlendState = {
    currentRun: initialGrid,
    nextRun: null,
    blendStartMs: 0,
  };

  await redis.subscribe('weather:grid:updated');
  redis.on('message', (channel, msg) => {
    if (channel !== 'weather:grid:updated') return;
    const runTs = Number(msg);
    loadGrid(runTs)
      .then((newGrid) => {
        if (state.nextRun) {
          // Already blending — snap current to next, start new blend
          state.currentRun = state.nextRun;
        }
        state.nextRun = newGrid;
        state.blendStartMs = Date.now();
      })
      .catch(() => { /* keep previous grid */ });
  });

  function maybePromote(): void {
    if (isBlendComplete(state, Date.now())) {
      state.currentRun = state.nextRun!;
      state.nextRun = null;
      state.blendStartMs = 0;
    }
  }

  return {
    mode: 'noaa',
    get runTs() { return state.currentRun.runTs; },
    get blendAlpha() {
      if (!state.nextRun) return 0;
      return Math.min(1, Math.max(0, (Date.now() - state.blendStartMs) / BLEND_DURATION_MS));
    },
    get blendStatus(): WeatherStatus {
      if (state.nextRun) return 'blending';
      // Check if next run is overdue (6h cycle + 5h threshold)
      const expectedNext = state.currentRun.runTs * 1000 + 6 * 3_600_000;
      if (Date.now() > expectedNext + DELAY_THRESHOLD_MS) return 'delayed';
      return 'stable';
    },
    get nextRunExpectedUtc() {
      return state.currentRun.runTs + 6 * 3600;
    },
    getForecastAt(lat, lon, t) {
      maybePromote();
      return blendGridForecast(state, lat, lon, t, Date.now());
    },
    getGrid: () => state.currentRun,
  };
}
