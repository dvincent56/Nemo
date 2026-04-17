// apps/web/src/lib/weather/interpolate.ts
import type { WeatherGridPoint } from '@/lib/store/types';
import { BOUNDS, RESOLUTION } from './mockGrid';

export interface WindAtPoint {
  tws: number;
  twd: number;
  u: number; // east component (m/s for rendering)
  v: number; // north component
}

export interface SwellAtPoint {
  height: number;
  dir: number;
}

/** Bilinear interpolation of wind at a specific lat/lon */
export function interpolateWind(
  points: WeatherGridPoint[],
  lat: number,
  lon: number,
): WindAtPoint {
  const cols = Math.floor((BOUNDS.east - BOUNDS.west) / RESOLUTION) + 1;

  // Grid indices
  const fx = (lon - BOUNDS.west) / RESOLUTION;
  const fy = (BOUNDS.north - lat) / RESOLUTION;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const dx = fx - ix;
  const dy = fy - iy;

  // Clamp
  const maxX = cols - 1;
  const maxY = Math.floor((BOUNDS.north - BOUNDS.south) / RESOLUTION);
  const x0 = Math.max(0, Math.min(ix, maxX));
  const x1 = Math.min(x0 + 1, maxX);
  const y0 = Math.max(0, Math.min(iy, maxY));
  const y1 = Math.min(y0 + 1, maxY);

  const idx = (r: number, c: number) => r * cols + c;
  const p00 = points[idx(y0, x0)];
  const p10 = points[idx(y0, x1)];
  const p01 = points[idx(y1, x0)];
  const p11 = points[idx(y1, x1)];

  if (!p00 || !p10 || !p01 || !p11) {
    return { tws: 0, twd: 0, u: 0, v: 0 };
  }

  // Interpolate speed
  const tws =
    p00.tws * (1 - dx) * (1 - dy) +
    p10.tws * dx * (1 - dy) +
    p01.tws * (1 - dx) * dy +
    p11.tws * dx * dy;

  // Interpolate direction (via u/v components to avoid wrap-around issues)
  const toRad = Math.PI / 180;
  const u =
    (-Math.sin(p00.twd * toRad) * p00.tws * (1 - dx) * (1 - dy)) +
    (-Math.sin(p10.twd * toRad) * p10.tws * dx * (1 - dy)) +
    (-Math.sin(p01.twd * toRad) * p01.tws * (1 - dx) * dy) +
    (-Math.sin(p11.twd * toRad) * p11.tws * dx * dy);
  const v =
    (-Math.cos(p00.twd * toRad) * p00.tws * (1 - dx) * (1 - dy)) +
    (-Math.cos(p10.twd * toRad) * p10.tws * dx * (1 - dy)) +
    (-Math.cos(p01.twd * toRad) * p01.tws * (1 - dx) * dy) +
    (-Math.cos(p11.twd * toRad) * p11.tws * dx * dy);

  const twd = ((Math.atan2(-u, -v) / toRad) + 360) % 360;

  return { tws, twd, u, v };
}

/** Bilinear interpolation of swell at a specific lat/lon */
export function interpolateSwell(
  points: WeatherGridPoint[],
  lat: number,
  lon: number,
): SwellAtPoint {
  const cols = Math.floor((BOUNDS.east - BOUNDS.west) / RESOLUTION) + 1;

  const fx = (lon - BOUNDS.west) / RESOLUTION;
  const fy = (BOUNDS.north - lat) / RESOLUTION;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const dx = fx - ix;
  const dy = fy - iy;

  const maxX = cols - 1;
  const maxY = Math.floor((BOUNDS.north - BOUNDS.south) / RESOLUTION);
  const x0 = Math.max(0, Math.min(ix, maxX));
  const x1 = Math.min(x0 + 1, maxX);
  const y0 = Math.max(0, Math.min(iy, maxY));
  const y1 = Math.min(y0 + 1, maxY);

  const idx = (r: number, c: number) => r * cols + c;
  const p00 = points[idx(y0, x0)];
  const p10 = points[idx(y0, x1)];
  const p01 = points[idx(y1, x0)];
  const p11 = points[idx(y1, x1)];

  if (!p00 || !p10 || !p01 || !p11) {
    return { height: 0, dir: 0 };
  }

  const height =
    p00.swellHeight * (1 - dx) * (1 - dy) +
    p10.swellHeight * dx * (1 - dy) +
    p01.swellHeight * (1 - dx) * dy +
    p11.swellHeight * dx * dy;

  const dir =
    p00.swellDir * (1 - dx) * (1 - dy) +
    p10.swellDir * dx * (1 - dy) +
    p01.swellDir * (1 - dx) * dy +
    p11.swellDir * dx * dy;

  return { height, dir };
}
