// packages/routing/src/pruning.ts
import type { Position } from '@nemo/shared-types';
import type { IsochronePoint } from './types';

const DEG = Math.PI / 180;

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
 * Angular-sector pruning: group points by bearing-from-origin into
 * `sectorCount` bins and keep only the furthest-from-origin point per bin.
 * Drops dominated candidates; output has at most `sectorCount` points.
 */
export function pruneBySector(
  points: IsochronePoint[],
  origin: Position,
  sectorCount: number,
): IsochronePoint[] {
  const binWidth = 360 / sectorCount;
  const bins: (IsochronePoint | null)[] = new Array(sectorCount).fill(null);
  for (const p of points) {
    const brg = bearingDeg(origin, p);
    const idx = Math.floor(brg / binWidth) % sectorCount;
    const kept = bins[idx];
    if (!kept || p.distFromStartNm > kept.distFromStartNm) bins[idx] = p;
  }
  const out: IsochronePoint[] = [];
  for (const p of bins) if (p !== null) out.push(p);
  return out;
}
