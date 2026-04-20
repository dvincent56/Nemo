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
 * Returns the hit zones so the caller can annotate markers.
 */
export function zoneSpeedModulator(
  lat: number,
  lon: number,
  zones: ProjectionZone[],
  nowMs: number,
): { factor: number; hitNames: string[]; hitZones: ProjectionZone[] } {
  let factor = 1;
  const hitNames: string[] = [];
  const hitZones: ProjectionZone[] = [];
  for (const z of zones) {
    if (!isTemporallyActive(z, nowMs)) continue;
    if (!inBBox(lat, lon, z.bbox)) continue;
    if (!pointInRing(lat, lon, z.ring)) continue;
    factor *= z.speedMultiplier;
    hitNames.push(z.name);
    hitZones.push(z);
  }
  return { factor, hitNames, hitZones };
}

/**
 * Compute the first intersection of segment (fromLat, fromLon) → (toLat, toLon)
 * with the boundary of the given zone. Returns parametric t along the segment
 * (0..1) and the (lat, lon) of the hit, or null if no intersection.
 */
export function segmentEntersZone(
  fromLat: number, fromLon: number,
  toLat: number, toLon: number,
  z: ProjectionZone,
): { t: number; lat: number; lon: number } | null {
  // Quick reject via bbox expanded by the segment's own bbox.
  const sMinLat = Math.min(fromLat, toLat);
  const sMaxLat = Math.max(fromLat, toLat);
  const sMinLon = Math.min(fromLon, toLon);
  const sMaxLon = Math.max(fromLon, toLon);
  if (sMaxLat < z.bbox.minLat || sMinLat > z.bbox.maxLat) return null;
  if (sMaxLon < z.bbox.minLon || sMinLon > z.bbox.maxLon) return null;

  const n = z.ring.length / 2;
  let bestT = Infinity;
  let bestLat = 0;
  let bestLon = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const cx1 = z.ring[j * 2]!;
    const cy1 = z.ring[j * 2 + 1]!;
    const cx2 = z.ring[i * 2]!;
    const cy2 = z.ring[i * 2 + 1]!;
    // Segment (fromLon, fromLat) → (toLon, toLat) vs (cx1, cy1) → (cx2, cy2)
    const denom = (cy2 - cy1) * (toLon - fromLon) - (cx2 - cx1) * (toLat - fromLat);
    if (denom === 0) continue;
    const ua = ((cx2 - cx1) * (fromLat - cy1) - (cy2 - cy1) * (fromLon - cx1)) / denom;
    const ub = ((toLon - fromLon) * (fromLat - cy1) - (toLat - fromLat) * (fromLon - cx1)) / denom;
    if (ua < 0 || ua > 1 || ub < 0 || ub > 1) continue;
    if (ua < bestT) {
      bestT = ua;
      bestLon = fromLon + ua * (toLon - fromLon);
      bestLat = fromLat + ua * (toLat - fromLat);
    }
  }
  if (!isFinite(bestT)) return null;
  return { t: bestT, lat: bestLat, lon: bestLon };
}
