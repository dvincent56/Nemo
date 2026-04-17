'use client';
import type { WeatherState, WeatherGrid, GfsStatus, GameStore } from './types';
import type { DecodedWeatherGrid } from '@/lib/weather/binaryDecoder';

export const INITIAL_WEATHER: WeatherState = {
  gridData: null,
  gridExpiresAt: null,
  isLoading: false,
  decodedGrid: null,
  gfsStatus: null,
};

export function createWeatherSlice(set: (fn: (s: GameStore) => Partial<GameStore>) => void) {
  return {
    weather: INITIAL_WEATHER,
    setWeatherGrid: (grid: WeatherGrid, expiresAt: Date) =>
      set((s) => ({ weather: { ...s.weather, gridData: grid, gridExpiresAt: expiresAt, isLoading: false } })),
    setWeatherLoading: (loading: boolean) =>
      set((s) => ({ weather: { ...s.weather, isLoading: loading } })),
    setDecodedWeatherGrid: (grid: DecodedWeatherGrid) =>
      set((s) => ({ weather: { ...s.weather, decodedGrid: grid } })),
    setGfsStatus: (status: GfsStatus) =>
      set((s) => ({ weather: { ...s.weather, gfsStatus: status } })),
  };
}
