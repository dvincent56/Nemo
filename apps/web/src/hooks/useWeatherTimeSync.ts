'use client';
import { useEffect, useRef } from 'react';
import { useGameStore } from '@/lib/store';
import { decodedGridToWeatherGridAtNow } from '@/lib/weather/gridFromBinary';

const RESAMPLE_THROTTLE_GAME_MS = 5 * 60_000;  // 5 min de jeu mini entre 2 resamples
const RESAMPLE_THROTTLE_WALL_MS = 150;        // 150 ms wall-clock mini — empêche 50 resamples/s pendant un drag de curseur
const FIVE_MIN = 5 * 60_000;

/**
 * Resample la grille météo (`weather.gridData`) à `timeline.currentTime`
 * dès que le scrub déplace l'instant de plus de 5 min de jeu. Permet aux
 * couches WindOverlay/SwellOverlay (qui consomment `gridData`) de
 * pré-visualiser la météo future quand on avance la timeline.
 *
 * Le throttle est en TEMPS DE JEU (pas wall-clock) — ça borne naturellement
 * la fréquence : un drag rapide ou une lecture 24× ne tape la grille que
 * tous les 5 min de scrubbed time, ce qui est largement suffisant pour
 * ressentir l'évolution météo (qui change à granularité horaire de toute façon).
 *
 * En LIVE on laisse aussi un timer 5 min wall-clock pour absorber les
 * nouveaux runs GFS quand l'onglet est revenu actif.
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
    // Wall-clock throttle: a fast cursor drag fires currentTime updates at
    // ~60 Hz; without this guard each pixel of drag re-decodes the global
    // grid (~50-100 ms each), blocking the main thread. Defer to a trailing
    // setTimeout so the LAST drag position still gets its sample.
    const nowWall = Date.now();
    const sinceLastWall = nowWall - lastWallClockMsRef.current;
    if (sinceLastWall < RESAMPLE_THROTTLE_WALL_MS) {
      const wait = RESAMPLE_THROTTLE_WALL_MS - sinceLastWall;
      const id = window.setTimeout(() => {
        // Re-read latest target on fire — store may have moved further.
        const state = useGameStore.getState();
        const live = state.timeline.isLive;
        const t = live ? Date.now() : state.timeline.currentTime.getTime();
        const grid = decodedGridToWeatherGridAtNow(decodedGrid, t);
        setWeatherGrid(grid, new Date(t + 6 * 3_600_000));
        lastSampleGameMsRef.current = t;
        lastWallClockMsRef.current = Date.now();
      }, wait);
      return () => window.clearTimeout(id);
    }
    const grid = decodedGridToWeatherGridAtNow(decodedGrid, targetMs);
    setWeatherGrid(grid, new Date(targetMs + 6 * 3_600_000));
    lastSampleGameMsRef.current = targetMs;
    lastWallClockMsRef.current = nowWall;
    return undefined;
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
