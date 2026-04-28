'use client';
import { useCallback } from 'react';
import { useGameStore } from '@/lib/store';
import type { WeatherGrid } from '@/lib/store/types';
import { useResampleAtTime } from './useResampleAtTime';

/**
 * Re-resample the global weather grid (`weather.gridData`) at
 * `timeline.currentTime` so WindOverlay / SwellOverlay can preview the future
 * weather when the user scrubs the timeline. Throttling is delegated to
 * `useResampleAtTime`.
 */
export function useWeatherTimeSync(): void {
  const decodedGrid = useGameStore((s) => s.weather.decodedGrid);
  const currentTime = useGameStore((s) => s.timeline.currentTime);
  const isLive = useGameStore((s) => s.timeline.isLive);
  const setWeatherGrid = useGameStore((s) => s.setWeatherGrid);

  const onSample = useCallback(
    (grid: WeatherGrid, targetMs: number) => {
      setWeatherGrid(grid, new Date(targetMs + 6 * 3_600_000));
    },
    [setWeatherGrid],
  );

  useResampleAtTime(decodedGrid, currentTime, isLive, onSample);
}
