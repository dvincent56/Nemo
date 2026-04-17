import type { WeatherGrid, WeatherGridPoint } from '@/lib/store/types';

const BOUNDS = { north: 55, south: 35, east: 5, west: -20 };
const RESOLUTION = 1;

/**
 * Simulate realistic Atlantic weather with low-pressure systems.
 *
 * Creates 2-3 cyclonic systems (Northern Hemisphere = counter-clockwise rotation)
 * with realistic wind speed gradients (stronger near center, weaker far away).
 * Background westerly flow overlaid.
 */

interface LowPressure {
  lat: number;
  lon: number;
  strength: number; // max wind speed in knots near the center
  radius: number;   // radius of influence in degrees
}

const LOWS: LowPressure[] = [
  { lat: 50, lon: -12, strength: 30, radius: 8 },   // Deep low off Ireland
  { lat: 42, lon: -5, strength: 18, radius: 6 },     // Moderate low Bay of Biscay
  { lat: 48, lon: 2, strength: 12, radius: 5 },      // Weak low near Brittany
];

function distDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dlat = lat2 - lat1;
  const dlon = (lon2 - lon1) * Math.cos((lat1 + lat2) / 2 * Math.PI / 180);
  return Math.sqrt(dlat * dlat + dlon * dlon);
}

function computeWind(lat: number, lon: number): { tws: number; twd: number } {
  // Background westerly flow (jet stream effect)
  let u = -8; // east component (negative = from west)
  let v = -1; // north component (slight southerly)

  // Add contribution from each low-pressure system
  for (const low of LOWS) {
    const dist = distDeg(lat, lon, low.lat, low.lon);
    if (dist > low.radius * 1.5) continue;

    // Wind speed peaks at ~1/3 of the radius, drops off outside
    const normDist = dist / low.radius;
    const speedFactor = normDist < 0.15
      ? normDist / 0.15 * 0.3 // calm eye-like center
      : Math.exp(-((normDist - 0.35) * (normDist - 0.35)) / 0.18);

    const windSpeed = low.strength * speedFactor;

    // Counter-clockwise rotation (NH) + inward spiral (~20° inflow)
    const dx = lon - low.lon;
    const dy = lat - low.lat;
    const angle = Math.atan2(dy, dx);
    const inflowAngle = 20 * Math.PI / 180;
    // Tangential (counter-clockwise) + radial (inward)
    const tangU = -Math.sin(angle) * windSpeed; // perpendicular
    const tangV = Math.cos(angle) * windSpeed;
    const radU = -Math.cos(angle) * windSpeed * Math.sin(inflowAngle);
    const radV = -Math.sin(angle) * windSpeed * Math.sin(inflowAngle);

    u += (tangU + radU) * Math.cos(inflowAngle);
    v += (tangV + radV) * Math.cos(inflowAngle);
  }

  const tws = Math.sqrt(u * u + v * v);
  const twd = ((Math.atan2(-u, -v) * 180 / Math.PI) + 360) % 360;

  return { tws: Math.max(1, tws), twd };
}

export function generateMockWeatherGrid(): WeatherGrid {
  const now = Date.now();
  const timestamps: number[] = [];
  for (let h = -24; h <= 168; h += 6) {
    timestamps.push(now + h * 3600 * 1000);
  }

  const points: WeatherGridPoint[] = [];
  for (let lat = BOUNDS.south; lat <= BOUNDS.north; lat += RESOLUTION) {
    for (let lon = BOUNDS.west; lon <= BOUNDS.east; lon += RESOLUTION) {
      const { tws, twd } = computeWind(lat, lon);

      // Swell: correlates loosely with wind but smoother, from NW
      const latFactor = (lat - BOUNDS.south) / (BOUNDS.north - BOUNDS.south);
      const swellHeight = 0.5 + latFactor * 2.0 + tws * 0.05;
      const swellDir = 310 + Math.sin(lat * 0.15) * 20;

      points.push({
        lat, lon,
        tws,
        twd,
        swellHeight: Math.max(0.3, swellHeight),
        swellDir: ((swellDir % 360) + 360) % 360,
      });
    }
  }

  return { points, resolution: RESOLUTION, bounds: BOUNDS, timestamps };
}

export function getPointsAtTime(grid: WeatherGrid, _time: number): WeatherGridPoint[] {
  return grid.points;
}

export { BOUNDS, RESOLUTION };
