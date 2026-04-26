'use client';
import { useEffect, useRef } from 'react';
import { useGameStore } from '@/lib/store';
import { decodedGridToWeatherGridAtNow } from '@/lib/weather/gridFromBinary';

const RESAMPLE_THROTTLE_GAME_MS = 60_000;     // 1 min de jeu mini entre 2 resamples
const RESAMPLE_THROTTLE_WALL_MS = 350;        // au plus 1 resample / 350 ms wall-clock
const FIVE_MIN = 5 * 60_000;

/**
 * Resample la grille météo (`weather.gridData`) à `timeline.currentTime`
 * dès que le scrub déplace l'instant de plus d'une minute. Permet aux
 * couches WindOverlay/SwellOverlay (qui consomment `gridData`) de
 * pré-visualiser la météo future quand on avance la timeline.
 *
 * Double throttle :
 *  - GAME-TIME : on saute si le delta de jeu est sous la minute (sinon
 *    chaque pixel de drag relancerait le resample)
 *  - WALL-CLOCK (debounce trailing) : on attend 350 ms d'inactivité pour
 *    réellement resample, ce qui évite de saturer le worker projection
 *    pendant un drag rapide ou une lecture 24×.
 *
 * En LIVE on laisse aussi un timer 5 min pour absorber les nouveaux runs GFS.
 */
export function useWeatherTimeSync(): void {
  const decodedGrid = useGameStore((s) => s.weather.decodedGrid);
  const currentTime = useGameStore((s) => s.timeline.currentTime);
  const isLive = useGameStore((s) => s.timeline.isLive);
  const setWeatherGrid = useGameStore((s) => s.setWeatherGrid);

  const lastSampleGameMsRef = useRef<number>(0);
  const lastWallClockMsRef = useRef<number>(0);

  useEffect(() => {
    if (!decodedGrid) return;
    const targetMs = isLive ? Date.now() : currentTime.getTime();
    if (Math.abs(targetMs - lastSampleGameMsRef.current) < RESAMPLE_THROTTLE_GAME_MS) return;

    const t = window.setTimeout(() => {
      const grid = decodedGridToWeatherGridAtNow(decodedGrid, targetMs);
      setWeatherGrid(grid, new Date(targetMs + 6 * 3_600_000));
      lastSampleGameMsRef.current = targetMs;
      lastWallClockMsRef.current = Date.now();
    }, RESAMPLE_THROTTLE_WALL_MS);
    return () => window.clearTimeout(t);
  }, [decodedGrid, currentTime, isLive, setWeatherGrid]);

  // LIVE-mode safety net : also resample every 5 wall-clock minutes so the
  // grid tracks reality even when the tab was inactive (no React renders).
  useEffect(() => {
    if (!isLive || !decodedGrid) return;
    const id = window.setInterval(() => {
      const target = Date.now();
      if (target - lastWallClockMsRef.current < FIVE_MIN) return;
      const grid = decodedGridToWeatherGridAtNow(decodedGrid, target);
      setWeatherGrid(grid, new Date(target + 6 * 3_600_000));
      lastSampleGameMsRef.current = target;
      lastWallClockMsRef.current = target;
    }, FIVE_MIN);
    return () => window.clearInterval(id);
  }, [isLive, decodedGrid, setWeatherGrid]);
}
