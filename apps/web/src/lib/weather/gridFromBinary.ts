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
 * forecast hours surrounding `Date.now()`. Use this when you need wind for
 * "right now" rather than at the GFS run time.
 */
export function decodedGridToWeatherGridAtNow(decoded: DecodedWeatherGrid): WeatherGrid {
  const { header, data } = decoded;
  const { numLat, numLon, latMin, latMax, lonMin, lonMax, gridStepLat, runTimestamp } = header;
  const hours = decoded.hours ?? Array.from({ length: header.numHours }, (_, i) => i);

  // Pick the two layers bracketing current time.
  const nowSec = Math.floor(Date.now() / 1000);
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
    timestamps: [Date.now()],
  };
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
