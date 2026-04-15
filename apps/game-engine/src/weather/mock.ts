import type { Position, WeatherPoint } from '@nemo/shared-types';

/**
 * Phase 1 weather mock: constant 15 kts from 270° everywhere, no swell.
 * Replaced in Phase 2 by NOAA GFS ingestion + bilinear interpolation.
 */
export function getWeatherAt(_pos: Position, _timeUnix: number): WeatherPoint {
  return {
    tws: 15,
    twd: 270,
    swh: 0,
    mwd: 0,
    mwp: 0,
  };
}
