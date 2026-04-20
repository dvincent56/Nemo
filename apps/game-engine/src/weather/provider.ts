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

interface HourData {
  u: string; v: string; swh: string; mwdSin: string; mwdCos: string; mwp: string;
}

const DELAY_THRESHOLD_MS = 5 * 3_600_000; // 5 hours

export async function createNoaaProvider(redis: RedisLike): Promise<WeatherProvider> {
  /** Load a run from split keys: meta + per-hour data. */
  async function loadGrid(runTs: number): Promise<WeatherGridUV> {
    const metaRaw = await redis.get(`weather:grid:${runTs}`);
    if (!metaRaw) throw new Error(`meta weather:grid:${runTs} not found`);
    const meta = JSON.parse(metaRaw) as WeatherGridUVMeta;

    const pointsPerHour = meta.shape.rows * meta.shape.cols;
    const totalPoints = pointsPerHour * meta.forecastHours.length;

    const u = new Float32Array(totalPoints);
    const v = new Float32Array(totalPoints);
    const swh = new Float32Array(totalPoints);
    const mwdSin = new Float32Array(totalPoints);
    const mwdCos = new Float32Array(totalPoints);
    const mwp = new Float32Array(totalPoints);

    const toArr = (b64: string): Float32Array => {
      const buf = Buffer.from(b64, 'base64');
      return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
    };

    for (let i = 0; i < meta.forecastHours.length; i++) {
      const fh = meta.forecastHours[i]!;
      const hourKey = `weather:grid:${runTs}:f${String(fh).padStart(3, '0')}`;
      const hourRaw = await redis.get(hourKey);
      if (!hourRaw) continue; // skip missing hours
      const hourData = JSON.parse(hourRaw) as HourData;
      const offset = i * pointsPerHour;
      u.set(toArr(hourData.u), offset);
      v.set(toArr(hourData.v), offset);
      swh.set(toArr(hourData.swh), offset);
      mwdSin.set(toArr(hourData.mwdSin), offset);
      mwdCos.set(toArr(hourData.mwdCos), offset);
      mwp.set(toArr(hourData.mwp), offset);
    }

    const loaded: WeatherGridUV = { ...meta, u, v, swh, mwdSin, mwdCos, mwp };
    console.log('[weather] loaded grid', {
      runTs,
      bbox: meta.bbox,
      resolution: meta.resolution,
      shape: meta.shape,
      forecastHours: meta.forecastHours.slice(0, 5),
    });

    // NOAA GFS ships lon in 0..360 convention. Normalise to -180..180 so the
    // rest of the stack (frontend included) can work with the standard range.
    if (meta.bbox.lonMin >= 0 && meta.bbox.lonMax > 180) {
      try {
        const rolled = rollLon0To360ToNeg180To180(loaded);
        console.log('[weather] rolled lon 0..360 → -180..180, new bbox:', rolled.bbox);
        return rolled;
      } catch (err) {
        console.error('[weather] roll failed:', err);
        return loaded;
      }
    }
    console.log('[weather] bbox already in -180..180 range, no roll needed');
    return loaded;
  }

  /**
   * Shift columns so the grid goes from -180..180 (standard) instead of 0..360
   * (NOAA GFS native). The wrap point lands exactly at col = cols/2.
   */
  function rollLon0To360ToNeg180To180(grid: WeatherGridUV): WeatherGridUV {
    const { rows, cols } = grid.shape;
    const half = Math.floor(cols / 2);
    const slots = grid.forecastHours.length;
    const plane = rows * cols;

    const shift = (src: Float32Array): Float32Array => {
      const out = new Float32Array(src.length);
      for (let s = 0; s < slots; s++) {
        const base = s * plane;
        for (let r = 0; r < rows; r++) {
          const rowBase = base + r * cols;
          // Copy [half..end] to [0..(cols-half)], and [0..half] to [(cols-half)..end]
          out.set(src.subarray(rowBase + half, rowBase + cols), rowBase);
          out.set(src.subarray(rowBase, rowBase + half), rowBase + (cols - half));
        }
      }
      return out;
    };

    return {
      ...grid,
      bbox: {
        latMin: grid.bbox.latMin,
        latMax: grid.bbox.latMax,
        lonMin: grid.bbox.lonMin - 180,
        lonMax: grid.bbox.lonMax - 180,
      },
      u: shift(grid.u),
      v: shift(grid.v),
      swh: shift(grid.swh),
      mwdSin: shift(grid.mwdSin),
      mwdCos: shift(grid.mwdCos),
      mwp: shift(grid.mwp),
    };
  }

  async function loadLatest(): Promise<WeatherGridUV> {
    // Find meta keys (pattern: weather:grid:TIMESTAMP, no :f suffix)
    const allKeys = await redis.keys('weather:grid:*');
    const metaKeys = allKeys.filter(k => !k.includes(':f'));
    if (metaKeys.length === 0) throw new Error('no weather grid in redis');
    metaKeys.sort();
    const latestKey = metaKeys[metaKeys.length - 1]!;
    const runTs = Number(latestKey.split(':').pop());
    return loadGrid(runTs);
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
      maybePromote();
      if (state.nextRun) return 'blending';
      // Check if next run is overdue (6h cycle + 5h threshold)
      const expectedNext = state.currentRun.runTs * 1000 + 6 * 3_600_000;
      if (Date.now() > expectedNext + DELAY_THRESHOLD_MS) return 'delayed';
      return 'stable';
    },
    get nextRunExpectedUtc() {
      // Next run = current + 6h cycle + ~4.5h publication delay
      return state.currentRun.runTs + 6 * 3600 + 4.5 * 3600;
    },
    getForecastAt(lat, lon, t) {
      maybePromote();
      return blendGridForecast(state, lat, lon, t, Date.now());
    },
    getGrid: () => state.currentRun,
  };
}
