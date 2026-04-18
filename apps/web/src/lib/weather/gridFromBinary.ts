/**
 * Convert a DecodedWeatherGrid (binary U/V from REST endpoint) to
 * the legacy WeatherGrid format used by WindOverlay and SwellOverlay.
 * Only converts the first forecast hour (f000 = current weather).
 */
import type { DecodedWeatherGrid } from './binaryDecoder';
import type { WeatherGrid, WeatherGridPoint } from '@/lib/store/types';

/** m/s to knots */
const MS_TO_KTS = 1.94384;

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
