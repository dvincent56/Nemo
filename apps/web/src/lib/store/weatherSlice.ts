'use client';
import type { WeatherState, WeatherGrid, GameStore } from './types';

export const INITIAL_WEATHER: WeatherState = { gridData: null, gridExpiresAt: null, isLoading: false };

export function createWeatherSlice(set: (fn: (s: GameStore) => Partial<GameStore>) => void) {
  return {
    weather: INITIAL_WEATHER,
    setWeatherGrid: (grid: WeatherGrid, expiresAt: Date) =>
      set(() => ({ weather: { gridData: grid, gridExpiresAt: expiresAt, isLoading: false } })),
    setWeatherLoading: (loading: boolean) =>
      set((s) => ({ weather: { ...s.weather, isLoading: loading } })),
  };
}
