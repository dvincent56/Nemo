/**
 * Parse GFS wind data (grib2json format) into our WeatherGrid format.
 * The JSON is an array of 2 records: [U-component, V-component].
 * Each record has a header (grid metadata) and data (flat array of values).
 */

import type { WeatherGrid, WeatherGridPoint } from '@/lib/store/types';

interface GfsHeader {
  lo1: number; // longitude start
  lo2: number; // longitude end
  la1: number; // latitude start
  la2: number; // latitude end
  nx: number;  // grid columns
  ny: number;  // grid rows
  dx: number;  // longitude step
  dy: number;  // latitude step (negative = north to south)
}

interface GfsRecord {
  header: GfsHeader;
  data: number[];
}

/** Convert m/s to knots */
function msToKnots(ms: number): number {
  return ms * 1.94384;
}

/**
 * Parse GFS grib2json data into WeatherGrid.
 * Returns a grid with wind speed (tws) in knots and direction (twd) in degrees.
 */
export function parseGfsWind(json: GfsRecord[]): WeatherGrid {
  const uRecord = json[0]!;
  const vRecord = json[1]!;
  const h = uRecord.header;

  const points: WeatherGridPoint[] = [];
  const toRad = Math.PI / 180;

  for (let j = 0; j < h.ny; j++) {
    for (let i = 0; i < h.nx; i++) {
      const idx = j * h.nx + i;
      const u = uRecord.data[idx] ?? 0; // east-west component (m/s)
      const v = vRecord.data[idx] ?? 0; // north-south component (m/s)

      // lat goes from la1 to la2, lon from lo1 to lo2
      const lat = h.la1 + j * h.dy; // dy is negative if la1 > la2 (south to north)
      const lon = h.lo1 + i * h.dx;

      const speedMs = Math.sqrt(u * u + v * v);
      const tws = msToKnots(speedMs);
      // Meteorological convention: direction wind comes FROM
      const twd = ((Math.atan2(-u, -v) / toRad) + 360) % 360;

      points.push({
        lat,
        lon,
        tws,
        twd,
        swellHeight: 0, // no swell in this dataset
        swellDir: 0,
      });
    }
  }

  const bounds = {
    north: Math.max(h.la1, h.la2),
    south: Math.min(h.la1, h.la2),
    east: h.lo2,
    west: h.lo1,
  };

  return {
    points,
    resolution: Math.abs(h.dx),
    bounds,
    timestamps: [Date.now()], // single snapshot for now
  };
}

/**
 * Bilinear interpolation on the parsed GFS grid.
 * Returns wind u/v components and speed/direction at any lat/lon.
 */
export function interpolateGfsWind(
  grid: WeatherGrid,
  lat: number,
  lon: number,
): { tws: number; twd: number; u: number; v: number } {
  const { bounds, resolution } = grid;
  const cols = Math.round((bounds.east - bounds.west) / resolution) + 1;
  const rows = Math.round((bounds.north - bounds.south) / resolution) + 1;

  // Normalize lon to grid range
  let normLon = lon;
  if (normLon < bounds.west) normLon += 360;
  if (normLon > bounds.east) normLon -= 360;

  // Grid-relative fractional coordinates
  // GFS data starts at la1 (south, -90) going north (+dy)
  const fy = (lat - bounds.south) / resolution;
  const fx = (normLon - bounds.west) / resolution;

  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const dx = fx - ix;
  const dy = fy - iy;

  const x0 = Math.max(0, Math.min(ix, cols - 1));
  const x1 = Math.min(x0 + 1, cols - 1);
  const y0 = Math.max(0, Math.min(iy, rows - 1));
  const y1 = Math.min(y0 + 1, rows - 1);

  // GFS stores south-to-north in our parsed format
  const idx = (r: number, c: number) => r * cols + c;
  const p00 = grid.points[idx(y0, x0)];
  const p10 = grid.points[idx(y0, x1)];
  const p01 = grid.points[idx(y1, x0)];
  const p11 = grid.points[idx(y1, x1)];

  if (!p00 || !p10 || !p01 || !p11) {
    return { tws: 0, twd: 0, u: 0, v: 0 };
  }

  // Interpolate speed
  const tws =
    p00.tws * (1 - dx) * (1 - dy) +
    p10.tws * dx * (1 - dy) +
    p01.tws * (1 - dx) * dy +
    p11.tws * dx * dy;

  // Interpolate via u/v to avoid direction wrap artifacts
  const toR = Math.PI / 180;
  const u =
    (-Math.sin(p00.twd * toR) * p00.tws * (1 - dx) * (1 - dy)) +
    (-Math.sin(p10.twd * toR) * p10.tws * dx * (1 - dy)) +
    (-Math.sin(p01.twd * toR) * p01.tws * (1 - dx) * dy) +
    (-Math.sin(p11.twd * toR) * p11.tws * dx * dy);
  const v =
    (-Math.cos(p00.twd * toR) * p00.tws * (1 - dx) * (1 - dy)) +
    (-Math.cos(p10.twd * toR) * p10.tws * dx * (1 - dy)) +
    (-Math.cos(p01.twd * toR) * p01.tws * (1 - dx) * dy) +
    (-Math.cos(p11.twd * toR) * p11.tws * dx * dy);

  const twd = ((Math.atan2(-u, -v) / toR) + 360) % 360;

  return { tws, twd, u, v };
}
