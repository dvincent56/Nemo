'use client';
import { useEffect, useRef } from 'react';
import { useGameStore } from '@/lib/store';
import { decodedGridToWeatherGridAtNow } from '@/lib/weather/gridFromBinary';

const RESAMPLE_THROTTLE_MS = 60_000; // re-échantillonne au plus 1×/min de jeu
const FIVE_MIN = 5 * 60_000;

/**
 * Resample la grille météo (`weather.gridData`) à `timeline.currentTime`
 * dès que le scrub déplace l'instant de plus d'une minute. Permet aux
 * couches WindOverlay/SwellOverlay (qui consomment `gridData`) de
 * pré-visualiser la météo future quand on avance la timeline.
 *
 * En mode LIVE le hook recale aussi à wall-clock toutes les ~5 min, ce
 * qui complète `useWeatherPrefetch` pour absorber les nouveaux runs GFS.
 */
export function useWeatherTimeSync(): void {
  const decodedGrid = useGameStore((s) => s.weather.decodedGrid);
  const currentTime = useGameStore((s) => s.timeline.currentTime);
  const isLive = useGameStore((s) => s.timeline.isLive);
  const setWeatherGrid = useGameStore((s) => s.setWeatherGrid);

  const lastSampleMsRef = useRef<number>(0);
  const lastWallClockMsRef = useRef<number>(0);

  useEffect(() => {
    if (!decodedGrid) return;
    const targetMs = isLive ? Date.now() : currentTime.getTime();
    if (Math.abs(targetMs - lastSampleMsRef.current) < RESAMPLE_THROTTLE_MS) return;
    const grid = decodedGridToWeatherGridAtNow(decodedGrid, targetMs);
    setWeatherGrid(grid, new Date(targetMs + 6 * 3_600_000));
    lastSampleMsRef.current = targetMs;
    lastWallClockMsRef.current = Date.now();
  }, [decodedGrid, currentTime, isLive, setWeatherGrid]);

  // In LIVE mode, also resample every 5 wall-clock minutes so the grid
  // tracks reality even if currentTime didn't tick (e.g. tab inactive).
  useEffect(() => {
    if (!isLive || !decodedGrid) return;
    const id = window.setInterval(() => {
      const target = Date.now();
      if (target - lastWallClockMsRef.current < FIVE_MIN) return;
      const grid = decodedGridToWeatherGridAtNow(decodedGrid, target);
      setWeatherGrid(grid, new Date(target + 6 * 3_600_000));
      lastSampleMsRef.current = target;
      lastWallClockMsRef.current = target;
    }, FIVE_MIN);
    return () => window.clearInterval(id);
  }, [isLive, decodedGrid, setWeatherGrid]);
}
