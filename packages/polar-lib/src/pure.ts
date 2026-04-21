// Pure numerical helpers shared between Node (loadPolar in ./index) and the
// browser entry (./browser). No fs/path/node:* imports allowed here.

import type { Polar, Position, SailId } from '@nemo/shared-types';

const EARTH_RADIUS_NM = 3440.065;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

function findBracket(arr: readonly number[], value: number): { i0: number; i1: number; t: number } {
  if (arr.length === 0) {
    throw new Error('polar axis empty');
  }
  const first = arr[0] as number;
  const last = arr[arr.length - 1] as number;
  if (value <= first) return { i0: 0, i1: 0, t: 0 };
  if (value >= last) {
    const last1 = arr.length - 1;
    return { i0: last1, i1: last1, t: 0 };
  }
  for (let i = 0; i < arr.length - 1; i++) {
    const a = arr[i] as number;
    const b = arr[i + 1] as number;
    if (value >= a && value <= b) {
      const span = b - a;
      return { i0: i, i1: i + 1, t: span === 0 ? 0 : (value - a) / span };
    }
  }
  throw new Error(`findBracket failed for value ${value}`);
}

export function getPolarSpeed(polar: Polar, sail: SailId, twa: number, tws: number): number {
  const absTwa = Math.min(Math.abs(twa), 180);
  const sailSpeeds = polar.speeds[sail];
  if (!sailSpeeds) return 0;
  const minTwa = polar.twa[0];
  if (minTwa !== undefined && absTwa < minTwa) return 0;
  const a = findBracket(polar.twa, absTwa);
  const s = findBracket(polar.tws, tws);

  const r0 = sailSpeeds[a.i0];
  const r1 = sailSpeeds[a.i1];
  if (!r0 || !r1) throw new Error('polar speed row missing');
  const v00 = r0[s.i0];
  const v01 = r0[s.i1];
  const v10 = r1[s.i0];
  const v11 = r1[s.i1];
  if (v00 === undefined || v01 === undefined || v10 === undefined || v11 === undefined) {
    throw new Error('polar speed cell missing');
  }

  const top = v00 * (1 - s.t) + v01 * s.t;
  const bot = v10 * (1 - s.t) + v11 * s.t;
  return top * (1 - a.t) + bot * a.t;
}

export function advancePosition(pos: Position, heading: number, bsp: number, dtSeconds: number): Position {
  const distNm = (bsp * dtSeconds) / 3600;
  const distRad = distNm / EARTH_RADIUS_NM;
  const lat1 = pos.lat * DEG_TO_RAD;
  const lon1 = pos.lon * DEG_TO_RAD;
  const brg = heading * DEG_TO_RAD;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(distRad) + Math.cos(lat1) * Math.sin(distRad) * Math.cos(brg),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(brg) * Math.sin(distRad) * Math.cos(lat1),
      Math.cos(distRad) - Math.sin(lat1) * Math.sin(lat2),
    );

  return {
    lat: lat2 * RAD_TO_DEG,
    lon: ((lon2 * RAD_TO_DEG + 540) % 360) - 180,
  };
}

export function haversineNM(a: Position, b: Position): number {
  const dLat = (b.lat - a.lat) * DEG_TO_RAD;
  const dLon = (b.lon - a.lon) * DEG_TO_RAD;
  const lat1 = a.lat * DEG_TO_RAD;
  const lat2 = b.lat * DEG_TO_RAD;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_NM * Math.asin(Math.sqrt(h));
}

export function computeTWA(heading: number, twd: number): number {
  let twa = ((heading - twd + 540) % 360) - 180;
  if (twa === -180) twa = 180;
  return twa;
}
