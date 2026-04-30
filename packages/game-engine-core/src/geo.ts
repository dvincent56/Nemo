// Engine-internal geo helpers. No fs / node:* imports — safe for browser entry.

import type { Position } from '@nemo/shared-types';

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/**
 * Initial great-circle bearing from `from` to `to`, in compass degrees
 * [0, 360). 0° = north, 90° = east.
 *
 * For waypoint-following: this is the bearing the boat should currently steer
 * to head straight at the waypoint along a great-circle path. The exact
 * heading must be re-evaluated as the boat advances (it changes along the
 * route, except along meridians/the equator).
 */
export function bearingDeg(from: Position, to: Position): number {
  const f1 = from.lat * DEG_TO_RAD;
  const f2 = to.lat * DEG_TO_RAD;
  const dLon = (to.lon - from.lon) * DEG_TO_RAD;
  const y = Math.sin(dLon) * Math.cos(f2);
  const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dLon);
  const theta = Math.atan2(y, x);
  return ((theta * RAD_TO_DEG) + 360) % 360;
}

/**
 * Default WP capture radius — 0.001 NM ≈ 1.85m. Achieves meter-level
 * tactical precision (matches Virtual Regatta's WP passage detection).
 * Combined with the line-distance check in tick.ts capture detection,
 * a boat crosses a WP's "circle" only when its path actually passes
 * within ~2m of the WP coordinates.
 *
 * Players who want a more lenient WP can set a per-WP captureRadiusNm
 * via the order value (validated as a positive finite number in the
 * tick capture loop).
 */
export const WPT_DEFAULT_CAPTURE_NM = 0.001;

/**
 * Closest distance (in nautical miles) from a point P to a line segment A→B.
 * Returns Infinity when the perpendicular projection falls outside the
 * segment (the closest point is one of the endpoints, which the caller
 * tests separately).
 *
 * Uses local-tangent flat-earth approximation: valid for segments shorter
 * than ~10 NM at any latitude, with sub-meter error. For typical 30s ticks
 * (~0.06 NM) the approximation error is negligible.
 *
 * Returns the haversine-equivalent distance to the closest point on the
 * segment line. The caller is expected to also check distance to A and B
 * if it wants full point-to-segment semantics — this function only handles
 * the "perpendicular falls inside the segment" case.
 */
export function pointToSegmentClosestNM(
  p: Position,
  a: Position,
  b: Position,
): number {
  // Local-tangent projection: convert lat/lon to local NM around a's
  // latitude. For short segments this is accurate to sub-meter.
  const latRefRad = a.lat * DEG_TO_RAD;
  const cosLat = Math.cos(latRefRad);
  const NM_PER_DEG_LAT = 60;
  // Project A, B, P into local NM coordinates (NM east, NM north of A).
  const ax = 0;
  const ay = 0;
  const bx = (b.lon - a.lon) * cosLat * NM_PER_DEG_LAT;
  const by = (b.lat - a.lat) * NM_PER_DEG_LAT;
  const px = (p.lon - a.lon) * cosLat * NM_PER_DEG_LAT;
  const py = (p.lat - a.lat) * NM_PER_DEG_LAT;

  // Compute t = projection of P-A onto B-A, normalized.
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) {
    // Degenerate (A === B). Return Euclidean distance in NM.
    return Math.sqrt(px * px + py * py);
  }
  const t = (px * dx + py * dy) / len2;
  if (t < 0 || t > 1) return Infinity; // perpendicular falls outside segment

  // Closest point on the segment in local-NM space.
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  const ddx = px - cx;
  const ddy = py - cy;
  return Math.sqrt(ddx * ddx + ddy * ddy);
}
