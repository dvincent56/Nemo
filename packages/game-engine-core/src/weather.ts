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
