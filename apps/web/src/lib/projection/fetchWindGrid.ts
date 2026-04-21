// apps/web/src/lib/projection/fetchWindGrid.ts
// Standalone helper that fetches the latest GFS wind grid and packs it into the
// flat Float32Array format consumed by createWindLookup / SimulatorEngine.init.

import {
  fetchWeatherGrid,
  PREFETCH_HOURS_PHASE1,
  PREFETCH_HOURS_PHASE2,
  DEFAULT_BOUNDS,
} from '@/lib/weather/prefetch';
import type { DecodedWeatherGrid } from '@/lib/weather/binaryDecoder';
import type { WindGridConfig } from './windLookup';

const FIELDS_PER_POINT = 5; // tws, twd, swh, swellDir, swellPeriod
const MS_TO_KTS = 1.94384;

/**
 * Convert a multi-hour decoded GRIB grid into the packed Float32Array format
 * expected by createWindLookup. One layer per forecast hour, 5 floats per cell:
 * [tws (kn), twd (deg), swh (m), swellDir (deg), swellPeriod (s)].
 *
 * Extracted from useProjectionLine so it can be reused by the dev simulator
 * without pulling in React hooks or game-store dependencies.
 */
function packWindData(decoded: DecodedWeatherGrid): {
  windGrid: WindGridConfig;
  windData: Float32Array;
} {
  const { header, data: src } = decoded;
  const { numLat, numLon, numHours } = header;
  const pointsPerHour = numLat * numLon;
  const out = new Float32Array(numHours * pointsPerHour * FIELDS_PER_POINT);
  const timestamps: number[] = [];
  const hoursList = decoded.hours ?? Array.from({ length: numHours }, (_, i) => i);

  for (let h = 0; h < numHours; h++) {
    const forecastHour = hoursList[h] ?? h;
    timestamps.push((header.runTimestamp + forecastHour * 3600) * 1000);
    const srcHour = h * pointsPerHour * 6;
    const outHour = h * pointsPerHour * FIELDS_PER_POINT;
    for (let i = 0; i < pointsPerHour; i++) {
      const sb = srcHour + i * 6;
      const u = src[sb]!;
      const v = src[sb + 1]!;
      const swh = src[sb + 2]!;
      const mwdSin = src[sb + 3]!;
      const mwdCos = src[sb + 4]!;
      const mwp = src[sb + 5]!;
      const tws = Math.sqrt(u * u + v * v) * MS_TO_KTS;
      const twd = ((Math.atan2(-u, -v) * 180 / Math.PI) + 360) % 360;
      const swellDir =
        Number.isFinite(mwdSin) && Number.isFinite(mwdCos)
          ? ((Math.atan2(mwdSin, mwdCos) * 180 / Math.PI) + 360) % 360
          : 0;
      const ob = outHour + i * FIELDS_PER_POINT;
      out[ob] = tws;
      out[ob + 1] = twd;
      out[ob + 2] = Number.isFinite(swh) ? Math.max(0, swh) : 0;
      out[ob + 3] = swellDir;
      out[ob + 4] = Number.isFinite(mwp) ? mwp : 0;
    }
  }

  const windGrid: WindGridConfig = {
    bounds: {
      north: header.latMax,
      south: header.latMin,
      east: header.lonMax,
      west: header.lonMin,
    },
    resolution: header.gridStepLat,
    cols: numLon,
    rows: numLat,
    timestamps,
  };

  return { windGrid, windData: out };
}

/**
 * Fetch the latest GFS wind grid (phase-1 hours) and return a packed
 * { windGrid, windData } pair ready to pass to SimulatorEngine.init.
 */
export async function fetchLatestWindGrid(): Promise<{
  windGrid: WindGridConfig;
  windData: Float32Array;
}> {
  // Include phase 2 so the sim covers the full 10-day horizon instead of
  // stopping at 48 h. Dev simulator runs offline (no rolling hour ticks),
  // so we pay the extra fetch time once at launch.
  const decoded = await fetchWeatherGrid({
    bounds: DEFAULT_BOUNDS,
    hours: [...PREFETCH_HOURS_PHASE1, ...PREFETCH_HOURS_PHASE2],
  });
  return packWindData(decoded);
}
