import type { WeatherGrid, WeatherGridPoint } from '@/lib/store/types';

const BOUNDS = { north: 55, south: 35, east: 5, west: -20 };
const RESOLUTION = 1;

/**
 * Generate a simple deterministic weather grid.
 * Wind: westerly flow (~270°) with 15-25kt speeds, varying by latitude.
 * Swell: from the northwest, 1-3m depending on latitude.
 */
export function generateMockWeatherGrid(): WeatherGrid {
  const now = Date.now();
  const timestamps: number[] = [];
  // 24h past + 7 days ahead, every 6h
  for (let h = -24; h <= 168; h += 6) {
    timestamps.push(now + h * 3600 * 1000);
  }

  const points: WeatherGridPoint[] = [];
  for (let lat = BOUNDS.south; lat <= BOUNDS.north; lat += RESOLUTION) {
    for (let lon = BOUNDS.west; lon <= BOUNDS.east; lon += RESOLUTION) {
      // Wind: westerly with latitude variation
      const latFactor = (lat - BOUNDS.south) / (BOUNDS.north - BOUNDS.south);
      const tws = 12 + latFactor * 15 + Math.sin(lon * 0.5) * 3;
      const twd = 260 + Math.sin(lat * 0.3) * 20 + Math.cos(lon * 0.2) * 10;

      // Swell: NW, height increases with latitude
      const swellHeight = 0.8 + latFactor * 2.5 + Math.sin(lon * 0.4) * 0.5;
      const swellDir = 310 + Math.sin(lat * 0.2) * 15;

      points.push({
        lat, lon,
        tws: Math.max(2, tws),
        twd: ((twd % 360) + 360) % 360,
        swellHeight: Math.max(0.2, swellHeight),
        swellDir: ((swellDir % 360) + 360) % 360,
      });
    }
  }

  return { points, resolution: RESOLUTION, bounds: BOUNDS, timestamps };
}

/** Get points at a specific time — for now just return the base grid (time variation TODO) */
export function getPointsAtTime(grid: WeatherGrid, _time: number): WeatherGridPoint[] {
  return grid.points;
}

export { BOUNDS, RESOLUTION };
