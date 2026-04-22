'use client';
import type { WeatherState, WeatherGrid, GfsStatus, GameStore } from './types';
import type { DecodedWeatherGrid } from '@/lib/weather/binaryDecoder';

export const INITIAL_WEATHER: WeatherState = {
  gridData: null,
  gridExpiresAt: null,
  isLoading: false,
  decodedGrid: null,
  prevDecodedGrid: null,
  gfsStatus: null,
  tacticalTile: null,
};

export function createWeatherSlice(set: (fn: (s: GameStore) => Partial<GameStore>) => void) {
  return {
    weather: INITIAL_WEATHER,
    setWeatherGrid: (grid: WeatherGrid, expiresAt: Date) =>
      set((s) => ({ weather: { ...s.weather, gridData: grid, gridExpiresAt: expiresAt, isLoading: false } })),
    setWeatherLoading: (loading: boolean) =>
      set((s) => ({ weather: { ...s.weather, isLoading: loading } })),
    setDecodedWeatherGrid: (grid: DecodedWeatherGrid) =>
      set((s) => {
        const currentRun = s.weather.decodedGrid?.header.runTimestamp;
        const incomingRun = grid.header.runTimestamp;
        // Only rotate the current grid into `prevDecodedGrid` when the
        // incoming grid is from a *different* GFS run. Cumulative phase
        // fetches of the same run just replace the current layer set.
        const prevDecodedGrid =
          currentRun !== undefined && currentRun !== incomingRun
            ? s.weather.decodedGrid
            : s.weather.prevDecodedGrid;
        return { weather: { ...s.weather, decodedGrid: grid, prevDecodedGrid } };
      }),
    setGfsStatus: (status: GfsStatus) =>
      set((s) => ({ weather: { ...s.weather, gfsStatus: status } })),
    setTacticalTile: (grid: WeatherGrid | null, bounds: { latMin: number; latMax: number; lonMin: number; lonMax: number } | null) =>
      set((s) => ({
        weather: {
          ...s.weather,
          tacticalTile: (grid && bounds) ? { grid, bounds } : null,
        },
      })),
  };
}
