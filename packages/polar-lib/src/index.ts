import type { BoatClass, Polar, Position } from '@nemo/shared-types';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const EARTH_RADIUS_NM = 3440.065;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

const __dirname = dirname(fileURLToPath(import.meta.url));

const POLAR_FILES: Record<BoatClass, string> = {
  FIGARO: 'figaro.json',
  CLASS40: 'class40.json',
  OCEAN_FIFTY: 'ocean-fifty.json',
  IMOCA60: 'imoca60.json',
  ULTIM: 'ultim.json',
};

const polarCache = new Map<BoatClass, Polar>();

export async function loadPolar(boatClass: BoatClass): Promise<Polar> {
  const cached = polarCache.get(boatClass);
  if (cached) return cached;
  const filename = POLAR_FILES[boatClass];
  const path = join(__dirname, '..', 'polars', filename);
  const raw = await readFile(path, 'utf8');
  const polar = JSON.parse(raw) as Polar;
  polarCache.set(boatClass, polar);
  return polar;
}

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

/**
 * Bilinear interpolation on the polar grid.
 * TWA symmetry: absolute value used (port/starboard symmetric).
 * Returns BSP in knots.
 */
export function getPolarSpeed(polar: Polar, twa: number, tws: number): number {
  const absTwa = Math.min(Math.abs(twa), 180);
  const a = findBracket(polar.twa, absTwa);
  const s = findBracket(polar.tws, tws);

  const r0 = polar.speeds[a.i0];
  const r1 = polar.speeds[a.i1];
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

/**
 * Advance position along a rhumb-line approximation suitable for a 30s tick.
 * Heading is true, in degrees. bsp in knots. dtSeconds in seconds.
 * Returns new position in degrees.
 */
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

/**
 * Great-circle distance in nautical miles between two GPS points.
 */
export function haversineNM(a: Position, b: Position): number {
  const dLat = (b.lat - a.lat) * DEG_TO_RAD;
  const dLon = (b.lon - a.lon) * DEG_TO_RAD;
  const lat1 = a.lat * DEG_TO_RAD;
  const lat2 = b.lat * DEG_TO_RAD;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_NM * Math.asin(Math.sqrt(h));
}

/**
 * TWA from heading and TWD (both in true degrees, compass frame).
 * Returned signed: + starboard, - port. Range (-180, 180].
 */
export function computeTWA(heading: number, twd: number): number {
  let twa = ((heading - twd + 540) % 360) - 180;
  if (twa === -180) twa = 180;
  return twa;
}
