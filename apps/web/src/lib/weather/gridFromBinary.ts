/**
 * Convert a DecodedWeatherGrid (binary U/V from REST endpoint) to
 * the legacy WeatherGrid format used by WindOverlay and SwellOverlay.
 * Only converts the first forecast hour (f000 = current weather).
 */
import type { DecodedWeatherGrid } from './binaryDecoder';
import type { WeatherGrid, WeatherGridPoint } from '@/lib/store/types';

/** m/s to knots */
const MS_TO_KTS = 1.94384;

const RAD_TO_DEG = 180 / Math.PI;

/**
 * Like decodedGridToWeatherGrid but interpolates TEMPORALLY between the two
 * forecast hours surrounding the given time (defaults to `Date.now()`).
 * Pass an explicit `nowMs` to sample weather at a specific wall-clock time
 * (e.g. when the dev simulator overrides the current time).
 */
export function decodedGridToWeatherGridAtNow(decoded: DecodedWeatherGrid, nowMs?: number): WeatherGrid {
  const { header, data } = decoded;
  const { numLat, numLon, latMin, latMax, lonMin, lonMax, gridStepLat, runTimestamp } = header;
  const hours = decoded.hours ?? Array.from({ length: header.numHours }, (_, i) => i);

  // Pick the two layers bracketing the requested time (defaults to wall clock).
  const nowSec = Math.floor((nowMs ?? Date.now()) / 1000);
  const elapsedHours = (nowSec - runTimestamp) / 3600;
  let a = 0, b = 0, frac = 0;
  if (hours.length <= 1 || elapsedHours <= hours[0]!) {
    a = 0; b = 0; frac = 0;
  } else if (elapsedHours >= hours[hours.length - 1]!) {
    a = hours.length - 1; b = a; frac = 0;
  } else {
    for (let i = 0; i < hours.length - 1; i++) {
      if (elapsedHours >= hours[i]! && elapsedHours < hours[i + 1]!) {
        a = i;
        b = i + 1;
        frac = (elapsedHours - hours[i]!) / (hours[i + 1]! - hours[i]!);
        break;
      }
    }
  }

  const pointsPerHour = numLat * numLon;
  const floatsPerHour = pointsPerHour * 6;
  const points: WeatherGridPoint[] = [];

  for (let latIdx = 0; latIdx < numLat; latIdx++) {
    for (let lonIdx = 0; lonIdx < numLon; lonIdx++) {
      const offsetA = a * floatsPerHour + (latIdx * numLon + lonIdx) * 6;
      const offsetB = b * floatsPerHour + (latIdx * numLon + lonIdx) * 6;
      const uA = data[offsetA]!, vA = data[offsetA + 1]!;
      const uB = data[offsetB]!, vB = data[offsetB + 1]!;
      const u = uA * (1 - frac) + uB * frac;
      const v = vA * (1 - frac) + vB * frac;
      const swhA = data[offsetA + 2]!, swhB = data[offsetB + 2]!;
      const mwdSinA = data[offsetA + 3]!, mwdSinB = data[offsetB + 3]!;
      const mwdCosA = data[offsetA + 4]!, mwdCosB = data[offsetB + 4]!;
      const mwpA = data[offsetA + 5]!, mwpB = data[offsetB + 5]!;

      const tws = Math.sqrt(u * u + v * v) * MS_TO_KTS;
      const twd = ((Math.atan2(-u, -v) * RAD_TO_DEG) + 360) % 360;
      const rawSwh = swhA * (1 - frac) + swhB * frac;
      const swh = Number.isFinite(rawSwh) ? Math.max(0, rawSwh) : 0;
      const mwdSin = mwdSinA * (1 - frac) + mwdSinB * frac;
      const mwdCos = mwdCosA * (1 - frac) + mwdCosB * frac;
      const swellDir = Number.isFinite(mwdSin) && Number.isFinite(mwdCos)
        ? ((Math.atan2(mwdSin, mwdCos) * RAD_TO_DEG) + 360) % 360
        : 0;
      const rawMwp = mwpA * (1 - frac) + mwpB * frac;
      const swellPeriod = Number.isFinite(rawMwp) ? rawMwp : 0;

      const lat = latMin + latIdx * gridStepLat;
      const lon = lonMin + lonIdx * header.gridStepLon;
      points.push({ lat, lon, tws, twd, swellHeight: swh, swellDir, swellPeriod });
    }
  }

  return {
    points,
    resolution: gridStepLat,
    cols: numLon,
    rows: numLat,
    bounds: { north: latMax, south: latMin, east: lonMax, west: lonMin },
    timestamps: [nowMs ?? Date.now()],
  };
}

/**
 * Sample wind at a single (lat, lon) on the decoded binary grid, with full
 * spatial bilinear + temporal linear interpolation at `nowMs` (defaults to
 * `Date.now()`). Used by live readers (map tooltip) that must match the
 * engine's tick-time computation — otherwise the map and HUD diverge as
 * simulation time advances beyond the moment `decodedGridToWeatherGridAtNow`
 * was last called (the latter collapses the 3D grid into a 2D snapshot).
 *
 * Returns `{ tws: 0, twd: 0 }` if the point is outside the grid bounds.
 */
export function sampleDecodedWindAtTime(
  decoded: DecodedWeatherGrid,
  lat: number,
  lon: number,
  nowMs?: number,
): { tws: number; twd: number } {
  const { header, data } = decoded;
  const { numLat, numLon, latMin, latMax, lonMin, lonMax, gridStepLat, gridStepLon, runTimestamp } = header;
  const hours = decoded.hours ?? Array.from({ length: header.numHours }, (_, i) => i);

  // Normalize lon to grid range (handles 0..360 grids where -180..0 wraps).
  let normLon = lon;
  if (normLon < lonMin) normLon += 360;
  if (normLon > lonMax) normLon -= 360;
  if (lat < latMin || lat > latMax || normLon < lonMin || normLon > lonMax) {
    return { tws: 0, twd: 0 };
  }

  // Spatial corners (bilinear)
  const fLat = (lat - latMin) / gridStepLat;
  const fLon = (normLon - lonMin) / gridStepLon;
  const lat0 = Math.max(0, Math.min(numLat - 1, Math.floor(fLat)));
  const lat1 = Math.min(numLat - 1, lat0 + 1);
  const lon0 = Math.max(0, Math.min(numLon - 1, Math.floor(fLon)));
  const lon1 = Math.min(numLon - 1, lon0 + 1);
  const tLat = fLat - lat0;
  const tLon = fLon - lon0;

  // Temporal slots (linear)
  const nowSec = Math.floor((nowMs ?? Date.now()) / 1000);
  const elapsedHours = (nowSec - runTimestamp) / 3600;
  let hourA = 0, hourB = 0, tHour = 0;
  if (hours.length <= 1 || elapsedHours <= hours[0]!) {
    hourA = 0; hourB = 0; tHour = 0;
  } else if (elapsedHours >= hours[hours.length - 1]!) {
    hourA = hours.length - 1; hourB = hourA; tHour = 0;
  } else {
    for (let i = 0; i < hours.length - 1; i++) {
      if (elapsedHours >= hours[i]! && elapsedHours < hours[i + 1]!) {
        hourA = i;
        hourB = i + 1;
        tHour = (elapsedHours - hours[i]!) / (hours[i + 1]! - hours[i]!);
        break;
      }
    }
  }

  // Helper: fetch the 6-float record at (hour, lat, lon)
  const pointsPerHour = numLat * numLon;
  const floatsPerHour = pointsPerHour * 6;
  const sampleUV = (hour: number): { u: number; v: number } => {
    const base = hour * floatsPerHour;
    const off = (r: number, c: number): number => base + (r * numLon + c) * 6;
    const u00 = data[off(lat0, lon0)]!, v00 = data[off(lat0, lon0) + 1]!;
    const u01 = data[off(lat0, lon1)]!, v01 = data[off(lat0, lon1) + 1]!;
    const u10 = data[off(lat1, lon0)]!, v10 = data[off(lat1, lon0) + 1]!;
    const u11 = data[off(lat1, lon1)]!, v11 = data[off(lat1, lon1) + 1]!;
    const uTop = u00 * (1 - tLon) + u01 * tLon;
    const uBot = u10 * (1 - tLon) + u11 * tLon;
    const vTop = v00 * (1 - tLon) + v01 * tLon;
    const vBot = v10 * (1 - tLon) + v11 * tLon;
    return {
      u: uTop * (1 - tLat) + uBot * tLat,
      v: vTop * (1 - tLat) + vBot * tLat,
    };
  };

  const a = sampleUV(hourA);
  const b = hourA === hourB ? a : sampleUV(hourB);
  const u = a.u * (1 - tHour) + b.u * tHour;
  const v = a.v * (1 - tHour) + b.v * tHour;

  const tws = Math.sqrt(u * u + v * v) * MS_TO_KTS;
  const twd = ((Math.atan2(-u, -v) * RAD_TO_DEG) + 360) % 360;
  return { tws, twd };
}

export function decodedGridToWeatherGrid(decoded: DecodedWeatherGrid): WeatherGrid {
  const { header, data } = decoded;
  const { numLat, numLon, latMin, latMax, lonMin, lonMax, gridStepLat } = header;

  const points: WeatherGridPoint[] = [];

  // Binary data: for each point: u, v, swh, mwdSin, mwdCos, mwp (6 floats)
  // First forecast hour only (hourIdx=0)
  for (let latIdx = 0; latIdx < numLat; latIdx++) {
    for (let lonIdx = 0; lonIdx < numLon; lonIdx++) {
      const base = (latIdx * numLon + lonIdx) * 6;
      const u = data[base]!;
      const v = data[base + 1]!;
      const rawSwh = data[base + 2]!;
      const mwdSin = data[base + 3]!;
      const mwdCos = data[base + 4]!;
      const rawMwp = data[base + 5]!;

      // U/V (m/s) → TWS (knots) + TWD (degrees compass)
      const tws = Math.sqrt(u * u + v * v) * MS_TO_KTS;
      const twd = ((Math.atan2(-u, -v) * 180) / Math.PI + 360) % 360;

      // Wave data: NaN on land (GFS has no wave data over land)
      const swh = Number.isFinite(rawSwh) ? rawSwh : 0;
      const swellDir = Number.isFinite(mwdSin) && Number.isFinite(mwdCos)
        ? ((Math.atan2(mwdSin, mwdCos) * 180) / Math.PI + 360) % 360
        : 0;
      const swellPeriod = Number.isFinite(rawMwp) ? rawMwp : 0;

      const lat = latMin + latIdx * gridStepLat;
      const lon = lonMin + lonIdx * header.gridStepLon;

      points.push({ lat, lon, tws, twd, swellHeight: swh, swellDir, swellPeriod });
    }
  }

  return {
    points,
    resolution: gridStepLat,
    cols: numLon,
    rows: numLat,
    bounds: { north: latMax, south: latMin, east: lonMax, west: lonMin },
    timestamps: [header.runTimestamp * 1000],
  };
}
