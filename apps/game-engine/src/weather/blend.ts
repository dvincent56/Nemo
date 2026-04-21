import type { WeatherPoint } from '@nemo/shared-types';
import { getForecastAt, type WeatherGridUV } from './grid.js';
import { lerp, recomposeAngle } from './grid-uv.js';

export const BLEND_DURATION_MS = 3_600_000; // 1 hour

export interface BlendState {
  currentRun: WeatherGridUV;
  nextRun: WeatherGridUV | null;
  blendStartMs: number;
}

export function blendGridForecast(
  state: BlendState,
  lat: number,
  lon: number,
  timeUnix: number,
  nowMs: number,
): WeatherPoint {
  const pointA = getForecastAt(state.currentRun, lat, lon, timeUnix);

  if (!state.nextRun) return pointA;

  const alpha = Math.min(1, Math.max(0, (nowMs - state.blendStartMs) / BLEND_DURATION_MS));
  const pointB = getForecastAt(state.nextRun, lat, lon, timeUnix);

  // Blend wind in U/V space
  const radA = (pointA.twd * Math.PI) / 180;
  const uA = -pointA.tws * Math.sin(radA);
  const vA = -pointA.tws * Math.cos(radA);
  const radB = (pointB.twd * Math.PI) / 180;
  const uB = -pointB.tws * Math.sin(radB);
  const vB = -pointB.tws * Math.cos(radB);

  // Note: uA/vA/uB/vB are reconstructed from WeatherPoint.tws which is
  // already in knots (see grid-uv.ts::uvToTwsTwd), so we must NOT re-apply
  // the m/s→knots factor here. Compute magnitude/direction directly.
  const u = lerp(uA, uB, alpha);
  const v = lerp(vA, vB, alpha);
  const tws = Math.sqrt(u * u + v * v);
  const twd = ((Math.atan2(-u, -v) * 180) / Math.PI + 360) % 360;

  // Blend MWD in sin/cos space
  const mwdRadA = (pointA.mwd * Math.PI) / 180;
  const mwdRadB = (pointB.mwd * Math.PI) / 180;
  const mwdSin = lerp(Math.sin(mwdRadA), Math.sin(mwdRadB), alpha);
  const mwdCos = lerp(Math.cos(mwdRadA), Math.cos(mwdRadB), alpha);

  return {
    tws,
    twd,
    swh: lerp(pointA.swh, pointB.swh, alpha),
    mwd: recomposeAngle(mwdSin, mwdCos),
    mwp: lerp(pointA.mwp, pointB.mwp, alpha),
  };
}

export function isBlendComplete(state: BlendState, nowMs: number): boolean {
  if (!state.nextRun) return false;
  return (nowMs - state.blendStartMs) >= BLEND_DURATION_MS;
}
