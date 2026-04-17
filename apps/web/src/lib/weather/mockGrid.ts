// apps/web/src/lib/weather/mockGrid.ts
import type { WeatherGrid, WeatherGridPoint } from '@/lib/store/types';

const BOUNDS = { north: 55, south: 35, east: 5, west: -20 };
const RESOLUTION = 1; // 1 degree grid
const HOURS_AHEAD = 168; // 7 days of forecast
const TIME_STEP_HOURS = 6;

/** Simplex-like noise for smooth variation */
function noise(x: number, y: number, seed: number): number {
  const n = Math.sin(x * 12.9898 + y * 78.233 + seed * 43.758) * 43758.5453;
  return n - Math.floor(n);
}

function smoothNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const a = noise(ix, iy, seed);
  const b = noise(ix + 1, iy, seed);
  const c = noise(ix, iy + 1, seed);
  const d = noise(ix + 1, iy + 1, seed);
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function generatePointsForTime(timeIndex: number): WeatherGridPoint[] {
  const points: WeatherGridPoint[] = [];
  const seed = timeIndex * 7.3;

  for (let lat = BOUNDS.south; lat <= BOUNDS.north; lat += RESOLUTION) {
    for (let lon = BOUNDS.west; lon <= BOUNDS.east; lon += RESOLUTION) {
      // Wind: base pattern + time variation
      const windBase = smoothNoise(lon * 0.15, lat * 0.15, seed) * 25 + 5;
      const windDir = (smoothNoise(lon * 0.1, lat * 0.1, seed + 100) * 360) % 360;

      // Swell: longer wavelength, slower variation
      const swellH = smoothNoise(lon * 0.08, lat * 0.08, seed + 200) * 4 + 0.5;
      const swellD = (smoothNoise(lon * 0.06, lat * 0.06, seed + 300) * 360) % 360;

      points.push({
        lat,
        lon,
        tws: Math.max(0, windBase),
        twd: windDir,
        swellHeight: Math.max(0, swellH),
        swellDir: swellD,
      });
    }
  }
  return points;
}

/** Generate a complete mock weather grid with 7 days of 6-hourly data */
export function generateMockWeatherGrid(): WeatherGrid {
  const now = Date.now();
  const timestamps: number[] = [];

  // Past 24h + future 7 days
  for (let h = -24; h <= HOURS_AHEAD; h += TIME_STEP_HOURS) {
    timestamps.push(now + h * 3600 * 1000);
  }

  // Generate points for the first timestamp (others will be interpolated from this seed)
  const points = generatePointsForTime(0);

  return {
    points,
    resolution: RESOLUTION,
    bounds: BOUNDS,
    timestamps,
  };
}

/** Get weather points for a specific timestamp (interpolated) */
export function getPointsAtTime(grid: WeatherGrid, time: number): WeatherGridPoint[] {
  // Find the time index
  const ts = grid.timestamps;
  const timeIndex = (time - ts[0]!) / ((ts[1]! - ts[0]!) || 1);

  return generatePointsForTime(timeIndex);
}

export { BOUNDS, RESOLUTION };
