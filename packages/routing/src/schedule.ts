// packages/routing/src/schedule.ts
import type { RoutePolylinePoint, CapScheduleEntry } from './types';

const DEG = Math.PI / 180;

function bearingBetween(a: RoutePolylinePoint, b: RoutePolylinePoint): number {
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
 * Emit CAP schedule entries at the start of each segment whose outgoing
 * heading differs from the previous segment's heading by >= minDegChange,
 * or whose sail differs from the previous.
 */
export function buildCapSchedule(
  polyline: RoutePolylinePoint[],
  minDegChange: number,
): CapScheduleEntry[] {
  if (polyline.length < 2) return [];
  const entries: CapScheduleEntry[] = [];

  const firstCap = bearingBetween(polyline[0]!, polyline[1]!);
  entries.push({ triggerMs: polyline[0]!.timeMs, cap: firstCap, sail: polyline[1]!.sail });

  let lastCap = firstCap;
  let lastSail = polyline[1]!.sail;
  for (let i = 1; i < polyline.length - 1; i++) {
    const cap = bearingBetween(polyline[i]!, polyline[i + 1]!);
    const sail = polyline[i + 1]!.sail;
    const headingChanged = angleDiffDeg(cap, lastCap) >= minDegChange;
    const sailChanged = sail !== lastSail;
    if (headingChanged || sailChanged) {
      const entry: CapScheduleEntry = { triggerMs: polyline[i]!.timeMs, cap };
      if (sailChanged) entry.sail = sail;
      entries.push(entry);
      lastCap = cap;
      lastSail = sail;
    }
  }
  return entries;
}
