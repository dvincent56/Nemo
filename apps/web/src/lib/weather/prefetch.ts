// apps/web/src/lib/weather/prefetch.ts
import { decodeWeatherGrid, type DecodedWeatherGrid } from './binaryDecoder';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3001';

export interface PrefetchOptions {
  bounds: { latMin: number; lonMin: number; latMax: number; lonMax: number };
  hours: number[];
  /** Grid resolution in degrees. Server decimates if > source. Defaults to source (0.25°). */
  resolution?: number;
  /** Wire encoding. 'int16' halves payload with 0.01 m/s precision. */
  encoding?: 'float32' | 'int16';
}

export async function fetchWeatherGrid(opts: PrefetchOptions): Promise<DecodedWeatherGrid> {
  const boundsStr = `${opts.bounds.latMin},${opts.bounds.lonMin},${opts.bounds.latMax},${opts.bounds.lonMax}`;
  const hoursStr = opts.hours.join(',');
  const params = new URLSearchParams({ bounds: boundsStr, hours: hoursStr });
  if (opts.resolution !== undefined) params.set('resolution', String(opts.resolution));
  if (opts.encoding === 'int16') params.set('q', 'int16');
  const url = `${API_BASE}/api/v1/weather/grid?${params.toString()}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`weather grid fetch failed: ${res.status}`);
  const buf = await res.arrayBuffer();
  const decoded = decodeWeatherGrid(buf);
  // Attach the requested hours so consumers (e.g. projection packing) know the
  // actual forecast offsets each layer represents — server packs one layer per
  // hour entry, in the order we requested.
  decoded.hours = opts.hours;
  return decoded;
}

// === Prefetch plan (global 1°, cap 5 days) ===
//
// TTFW (Time To First Wind): t=0 only — visible overlay in <1 s.
// PHASE1: t=3..48h — short-term overlay + projection (~2-4 s).
// PHASE2: t=54..120h — long-term overlay, capped at J+5 (~3-5 s).
// Server keeps 10 days; we only display 5.
export const PREFETCH_HOURS_TTFW = [0];
export const PREFETCH_HOURS_PHASE1 = [3, 6, 9, 12, 15, 18, 21, 24, 30, 36, 42, 48];
export const PREFETCH_HOURS_PHASE2 = [54, 60, 66, 72, 78, 84, 90, 96, 102, 108, 114, 120];

export const DEFAULT_BOUNDS = { latMin: -80, lonMin: -180, latMax: 80, lonMax: 180 };
export const DEFAULT_RESOLUTION = 1;
