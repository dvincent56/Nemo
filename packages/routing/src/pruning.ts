// packages/routing/src/pruning.ts
import type { Position } from '@nemo/shared-types';
import type { IsochronePoint } from './types';

const DEG = Math.PI / 180;
const EARTH_RADIUS_NM = 3440.065;

/**
 * Initial bearing in degrees from `a` to `b`, 0 = north, clockwise, 0..360.
 */
export function bearingDeg(a: Position, b: Position): number {
  const lat1 = a.lat * DEG;
  const lat2 = b.lat * DEG;
  const dLon = (b.lon - a.lon) * DEG;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (Math.atan2(y, x) / DEG + 360) % 360;
}

/**
 * Great-circle distance in nautical miles from `a` to `b`.
 * Used by pruning to rank points within a sector — we want the point
 * that reached the furthest **away from origin** (straight line), not
 * the one that travelled the most path-distance (which would reward
 * zig-zag over direct progress).
 */
function greatCircleNm(a: Position, b: Position): number {
  const dLat = (b.lat - a.lat) * DEG;
  const dLon = (b.lon - a.lon) * DEG;
  const lat1 = a.lat * DEG;
  const lat2 = b.lat * DEG;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_NM * Math.asin(Math.sqrt(h));
}

/**
 * Angular-sector pruning: group points by bearing-from-origin into
 * `sectorCount` bins and keep only the point whose great-circle distance
 * from origin is greatest in each bin. Drops dominated candidates; output
 * has at most `sectorCount` points.
 */
export function pruneBySector(
  points: IsochronePoint[],
  origin: Position,
  sectorCount: number,
): IsochronePoint[] {
  const binWidth = 360 / sectorCount;
  const bins: (IsochronePoint | null)[] = new Array(sectorCount).fill(null);
  const binDist: number[] = new Array(sectorCount).fill(-1);
  for (const p of points) {
    const pos = { lat: p.lat, lon: p.lon };
    const brg = bearingDeg(origin, pos);
    const idx = Math.floor(brg / binWidth) % sectorCount;
    const d = greatCircleNm(origin, pos);
    if (!bins[idx] || d > binDist[idx]!) {
      bins[idx] = p;
      binDist[idx] = d;
    }
  }
  const out: IsochronePoint[] = [];
  for (const p of bins) if (p !== null) out.push(p);
  return out;
}
