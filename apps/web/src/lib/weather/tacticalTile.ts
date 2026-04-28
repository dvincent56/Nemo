// apps/web/src/lib/weather/tacticalTile.ts
import { fetchWeatherGrid } from './prefetch';
import type { DecodedWeatherGrid } from './binaryDecoder';

const TILE_SIZE_DEG = 40;       // full width of the 0.25° tile
const TILE_MARGIN_DEG = 10;     // trigger refetch when boat is within this margin
const TILE_HOURS = [0, 3, 6, 9, 12, 15, 18, 21, 24];

export interface BoatPos { lat: number; lon: number; }
export interface Bbox { latMin: number; latMax: number; lonMin: number; lonMax: number; }

export function computeTileBounds(boat: BoatPos): Bbox {
  const half = TILE_SIZE_DEG / 2;
  const latMin = Math.max(-90, boat.lat - half);
  const latMax = Math.min(90, boat.lat + half);
  // lon wraps ±180; keep simple and clip (consumers use the normalized lookup)
  const lonMin = Math.max(-180, boat.lon - half);
  const lonMax = Math.min(180, boat.lon + half);
  return { latMin, latMax, lonMin, lonMax };
}

export function isBoatInsideMargin(boat: BoatPos, tile: Bbox, margin = TILE_MARGIN_DEG): boolean {
  return (
    boat.lat >= tile.latMin + margin &&
    boat.lat <= tile.latMax - margin &&
    boat.lon >= tile.lonMin + margin &&
    boat.lon <= tile.lonMax - margin
  );
}

export async function fetchTacticalTile(boat: BoatPos): Promise<{
  tile: DecodedWeatherGrid;
  bounds: Bbox;
}> {
  const bounds = computeTileBounds(boat);
  const tile = await fetchWeatherGrid({
    bounds,
    hours: TILE_HOURS,
    resolution: 0.25,
    encoding: 'int16',
  });
  return { tile, bounds };
}

/**
 * Latest wall-clock time the tile can faithfully sample. Beyond this, callers
 * must fall back to the global grid (which has a longer horizon).
 */
export function tileMaxValidMs(decoded: DecodedWeatherGrid): number {
  const hours = decoded.hours ?? Array.from({ length: decoded.header.numHours }, (_, i) => i);
  const maxHour = hours[hours.length - 1] ?? 0;
  return (decoded.header.runTimestamp + maxHour * 3600) * 1000;
}
