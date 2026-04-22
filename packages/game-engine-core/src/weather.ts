import type { WeatherPoint } from '@nemo/shared-types';

/**
 * Minimal WeatherProvider interface required by the core engine.
 *
 * The concrete server-side provider (apps/game-engine/src/weather/provider.ts)
 * satisfies this interface — it has the same getForecastAt signature plus
 * additional server-only fields (mode, blendStatus, getGrid, etc.) that are
 * not needed by the pure engine.
 */
export type { WeatherPoint };

export interface WeatherProvider {
  readonly runTs: number;
  getForecastAt(lat: number, lon: number, timeUnix: number): WeatherPoint;
}

/**
 * Shape of a packed wind grid consumed by downstream weather samplers.
 * Timestamps are in Unix milliseconds, matching production flows.
 */
export interface WindGridConfig {
  bounds: { north: number; south: number; east: number; west: number };
  resolution: number;   // degrees per cell step (assumed square)
  cols: number;
  rows: number;
  timestamps: number[]; // one per forecast hour, in ms since epoch
}
