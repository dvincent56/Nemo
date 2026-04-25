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

/** Default capture radius for WPT orders. Boat is considered to have reached
 *  the waypoint when distance to it is strictly less than this value (NM). */
export const WPT_DEFAULT_CAPTURE_NM = 0.5;
