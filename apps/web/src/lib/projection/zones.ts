/**
 * Zone speed-modulation for the projection worker.
 * Browser-safe, no @turf dependency.
 */
import type { ProjectionZone } from './types';

function inBBox(lat: number, lon: number, b: ProjectionZone['bbox']): boolean {
  return lat >= b.minLat && lat <= b.maxLat && lon >= b.minLon && lon <= b.maxLon;
}

function isTemporallyActive(z: ProjectionZone, nowMs: number): boolean {
  if (z.activeFromMs !== null && nowMs < z.activeFromMs) return false;
  if (z.activeToMs !== null && nowMs > z.activeToMs) return false;
  return true;
}

/**
 * Ray-casting point-in-polygon against a flattened ring.
 * Ring is [lon0, lat0, lon1, lat1, ...] closed or not.
 */
function pointInRing(lat: number, lon: number, ring: number[]): boolean {
  let inside = false;
  const n = ring.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i * 2]!;
    const yi = ring[i * 2 + 1]!;
    const xj = ring[j * 2]!;
    const yj = ring[j * 2 + 1]!;
    const intersect = ((yi > lat) !== (yj > lat)) &&
      (lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Compute the cumulative speed multiplier from all zones covering the point.
 * Multipliers stack multiplicatively (matches game-engine behaviour).
 */
export function zoneSpeedModulator(
  lat: number,
  lon: number,
  zones: ProjectionZone[],
  nowMs: number,
): { factor: number; hitNames: string[] } {
  let factor = 1;
  const hitNames: string[] = [];
  for (const z of zones) {
    if (!isTemporallyActive(z, nowMs)) continue;
    if (!inBBox(lat, lon, z.bbox)) continue;
    if (!pointInRing(lat, lon, z.ring)) continue;
    factor *= z.speedMultiplier;
    hitNames.push(z.name);
  }
  return { factor, hitNames };
}
