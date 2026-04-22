// apps/web/src/hooks/useWeatherPrefetch.ts
import { useEffect, useRef } from 'react';
import { useGameStore } from '@/lib/store';
import {
  fetchWeatherGrid,
  PREFETCH_HOURS_TTFW,
  PREFETCH_HOURS_PHASE1,
  PREFETCH_HOURS_PHASE2,
  DEFAULT_BOUNDS,
  DEFAULT_RESOLUTION,
} from '@/lib/weather/prefetch';
import {
  decodedGridToWeatherGrid,
  decodedGridToWeatherGridAtNow,
} from '@/lib/weather/gridFromBinary';

/**
 * Three-phase prefetch of the global weather grid at 1° resolution, int16-quantized.
 * Each phase fetches a *cumulative* hour list so the store always has the widest
 * temporal horizon available, and downstream consumers (overlay, projection, HUD)
 * always read the most complete grid.
 *
 * Phase cap is J+7 (168h). The server still holds J+10 — upgrade here when the UI
 * needs it (and when GFS reliability at that horizon is acceptable).
 */
export function useWeatherPrefetch(options?: { phase2?: boolean }) {
  const setDecodedWeatherGrid = useGameStore((s) => s.setDecodedWeatherGrid);
  const setWeatherGrid = useGameStore((s) => s.setWeatherGrid);
  const gfsStatus = useGameStore((s) => s.weather.gfsStatus);
  const lastRunRef = useRef<number>(0);

  useEffect(() => {
    const currentRun = gfsStatus?.run ?? 0;
    if (currentRun === lastRunRef.current && lastRunRef.current !== 0) return;
    lastRunRef.current = currentRun;

    let cancelled = false;

    async function prefetch() {
      const common = {
        bounds: DEFAULT_BOUNDS,
        resolution: DEFAULT_RESOLUTION,
        encoding: 'int16' as const,
      };
      try {
        // Phase TTFW — t=0 only, visible overlay ASAP.
        const ttfw = await fetchWeatherGrid({ ...common, hours: PREFETCH_HOURS_TTFW });
        if (cancelled) return;
        setDecodedWeatherGrid(ttfw);
        setWeatherGrid(decodedGridToWeatherGridAtNow(ttfw), new Date(Date.now() + 6 * 3600 * 1000));

        // Phase 1 — cumulative t=0..48h.
        const phase1Hours = [...PREFETCH_HOURS_TTFW, ...PREFETCH_HOURS_PHASE1];
        const phase1 = await fetchWeatherGrid({ ...common, hours: phase1Hours });
        if (cancelled) return;
        setDecodedWeatherGrid(phase1);
        setWeatherGrid(decodedGridToWeatherGridAtNow(phase1), new Date(Date.now() + 6 * 3600 * 1000));

        if (options?.phase2) {
          // Phase 2 — cumulative t=0..168h.
          const phase2Hours = [...phase1Hours, ...PREFETCH_HOURS_PHASE2];
          const phase2 = await fetchWeatherGrid({ ...common, hours: phase2Hours });
          if (cancelled) return;
          setDecodedWeatherGrid(phase2);
          setWeatherGrid(decodedGridToWeatherGrid(phase2), new Date(Date.now() + 6 * 3600 * 1000));
        }
      } catch {
        // silently ignore (e.g. server unreachable)
      }
    }

    prefetch();
    return () => { cancelled = true; };
  }, [gfsStatus?.run, options?.phase2, setDecodedWeatherGrid, setWeatherGrid]);
}
