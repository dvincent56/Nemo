// apps/web/src/hooks/useWeatherPrefetch.ts
import { useEffect, useRef } from 'react';
import { useGameStore } from '@/lib/store';
import {
  fetchWeatherGrid,
  PREFETCH_HOURS_PHASE1,
  PREFETCH_HOURS_PHASE2,
  DEFAULT_BOUNDS,
} from '@/lib/weather/prefetch';

export function useWeatherPrefetch(options?: { phase2?: boolean }) {
  const setDecodedWeatherGrid = useGameStore((s) => s.setDecodedWeatherGrid);
  const gfsStatus = useGameStore((s) => s.weather.gfsStatus);
  const lastRunRef = useRef<number>(0);

  useEffect(() => {
    const currentRun = gfsStatus?.run ?? 0;
    if (currentRun === lastRunRef.current && lastRunRef.current !== 0) return;
    lastRunRef.current = currentRun;

    let cancelled = false;

    async function prefetch() {
      try {
        // Fetch phase 1 first (fast feedback); then, if requested, replace
        // with the combined phase1+phase2 set so the projection covers the
        // whole 10-day horizon.
        const grid1 = await fetchWeatherGrid({
          bounds: DEFAULT_BOUNDS,
          hours: PREFETCH_HOURS_PHASE1,
        });
        if (cancelled) return;
        setDecodedWeatherGrid(grid1);

        if (options?.phase2) {
          const gridFull = await fetchWeatherGrid({
            bounds: DEFAULT_BOUNDS,
            hours: [...PREFETCH_HOURS_PHASE1, ...PREFETCH_HOURS_PHASE2],
          });
          if (cancelled) return;
          setDecodedWeatherGrid(gridFull);
        }
      } catch {
        // silently ignore
      }
    }

    prefetch();
    return () => { cancelled = true; };
  }, [gfsStatus?.run, options?.phase2, setDecodedWeatherGrid]);
}
