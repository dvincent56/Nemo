// apps/web/src/lib/weather/prefetch.ts
import { decodeWeatherGrid, type DecodedWeatherGrid } from './binaryDecoder';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3001';

export interface PrefetchOptions {
  bounds: { latMin: number; lonMin: number; latMax: number; lonMax: number };
  hours: number[];
}

export async function fetchWeatherGrid(opts: PrefetchOptions): Promise<DecodedWeatherGrid> {
  const boundsStr = `${opts.bounds.latMin},${opts.bounds.lonMin},${opts.bounds.latMax},${opts.bounds.lonMax}`;
  const hoursStr = opts.hours.join(',');
  const url = `${API_BASE}/api/v1/weather/grid?bounds=${boundsStr}&hours=${hoursStr}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`weather grid fetch failed: ${res.status}`);
  const buf = await res.arrayBuffer();
  const decoded = decodeWeatherGrid(buf);
  // Attach the requested hours so consumers (e.g. projection packing) know the
  // actual forecast offsets each layer represents — server packs one layer per
  // hour entry, in the order we requested.
  decoded.hours = opts.hours;
  return decoded;
}

export const PREFETCH_HOURS_PHASE1 = [0, 3, 6, 9, 12, 15, 18, 21, 24, 30, 36, 42, 48];
export const PREFETCH_HOURS_PHASE2 = [54, 60, 66, 72, 78, 84, 90, 96, 102, 108, 114, 120, 132, 144, 156, 168, 180, 192, 204, 216, 228, 240];
export const DEFAULT_BOUNDS = { latMin: -60, lonMin: -80, latMax: 60, lonMax: 30 };
