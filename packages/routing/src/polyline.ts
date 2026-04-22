// packages/routing/src/polyline.ts
import type { Position } from '@nemo/shared-types';
import type { IsochronePoint, RoutePolylinePoint } from './types';

/**
 * Walk parentIdx chains from the arrival point back to the start,
 * producing a chronologically-ordered polyline including the start.
 */
export function backtrackPolyline(
  isochrones: IsochronePoint[][],
  arrival: IsochronePoint,
  arrivalStep: number,
): RoutePolylinePoint[] {
  const chain: IsochronePoint[] = [];
  let current: IsochronePoint | null = arrival;
  let step = arrivalStep;
  while (current && step >= 0) {
    chain.push(current);
    if (current.parentIdx < 0 || step === 0) break;
    const prev = isochrones[step - 1];
    if (!prev) break;
    const next: IsochronePoint | undefined = prev[current.parentIdx];
    current = next ?? null;
    step--;
  }
  chain.reverse();
  return chain.map((p) => ({
    lat: p.lat, lon: p.lon, timeMs: p.timeMs,
    twa: p.twa, tws: p.tws, bsp: p.bsp, sail: p.sail,
  }));
}

const DEG = Math.PI / 180;

function bearingBetween(a: Position, b: Position): number {
  const lat1 = a.lat * DEG;
  const lat2 = b.lat * DEG;
  const dLon = (b.lon - a.lon) * DEG;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (Math.atan2(y, x) / DEG + 360) % 360;
}

function angleDiffDeg(a: number, b: number): number {
  const d = (((a - b) + 540) % 360) - 180;
  return Math.abs(d);
}

/**
 * Decimate the polyline: keep first, last, and any point where the
 * outgoing heading differs from the previous outgoing heading by at
 * least `minDegChange` degrees.
 */
export function extractInflectionPoints(
  polyline: RoutePolylinePoint[],
  minDegChange: number,
): Position[] {
  if (polyline.length < 2) return polyline.map((p) => ({ lat: p.lat, lon: p.lon }));
  const out: Position[] = [{ lat: polyline[0]!.lat, lon: polyline[0]!.lon }];
  let lastHdg = bearingBetween(polyline[0]!, polyline[1]!);
  for (let i = 1; i < polyline.length - 1; i++) {
    const hdgOut = bearingBetween(polyline[i]!, polyline[i + 1]!);
    if (angleDiffDeg(hdgOut, lastHdg) >= minDegChange) {
      out.push({ lat: polyline[i]!.lat, lon: polyline[i]!.lon });
      lastHdg = hdgOut;
    }
  }
  const last = polyline[polyline.length - 1]!;
  out.push({ lat: last.lat, lon: last.lon });
  return out;
}
