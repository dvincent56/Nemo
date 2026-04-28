// apps/web/src/hooks/useTacticalTile.ts
'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useGameStore } from '@/lib/store';
import {
  fetchTacticalTile,
  isBoatInsideMargin,
  type Bbox,
} from '@/lib/weather/tacticalTile';
import { decodedGridToWeatherGridAtNow } from '@/lib/weather/gridFromBinary';
import type { WeatherGrid } from '@/lib/store/types';
import { useResampleAtTime } from './useResampleAtTime';

/**
 * Lazily fetches a 0.25° tactical tile around the boat position (t=0..24h).
 * Refetches when the boat drifts within the edge margin. Safe no-op before the
 * boat position is known.
 *
 * Re-samples the tile whenever the timeline is scrubbed — without this, the
 * tactical patch around the boat stays frozen at "now" while the global grid
 * advances, so the user sees stale wind in the area that matters most.
 */
export function useTacticalTile(): void {
  const lat = useGameStore((s) => s.hud.lat);
  const lon = useGameStore((s) => s.hud.lon);
  const setTacticalTile = useGameStore((s) => s.setTacticalTile);
  const tile = useGameStore((s) => s.weather.tacticalTile);
  const currentTime = useGameStore((s) => s.timeline.currentTime);
  const isLive = useGameStore((s) => s.timeline.isLive);

  // Build a stable object reference — primitives compare by value so this
  // only produces a new object when lat or lon actually changes.
  const boat = useMemo(
    () => (lat === 0 && lon === 0 ? null : { lat, lon }),
    [lat, lon],
  );

  const currentBoundsRef = useRef<Bbox | null>(null);
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!boat) return;
    const current = currentBoundsRef.current;
    if (current && isBoatInsideMargin(boat, current)) return;
    if (inFlightRef.current) return;

    let cancelled = false;
    inFlightRef.current = true;
    (async () => {
      try {
        const { tile: decoded, bounds } = await fetchTacticalTile(boat);
        if (cancelled) return;
        currentBoundsRef.current = bounds;
        const state = useGameStore.getState();
        const targetMs = state.timeline.isLive
          ? Date.now()
          : state.timeline.currentTime.getTime();
        setTacticalTile(decodedGridToWeatherGridAtNow(decoded, targetMs), decoded, bounds);
      } catch {
        // silently ignore — global grid remains active
      } finally {
        inFlightRef.current = false;
      }
    })();

    return () => { cancelled = true; };
  }, [boat, setTacticalTile]);

  // Keep the tile's WeatherGrid in sync with the timeline. The decoded 3D
  // grid is already in the store — we only re-resample, no network refetch.
  const decoded = tile?.decoded ?? null;
  const bounds = tile?.bounds ?? null;
  const onSample = useCallback(
    (grid: WeatherGrid) => {
      if (!decoded || !bounds) return;
      setTacticalTile(grid, decoded, bounds);
    },
    [setTacticalTile, decoded, bounds],
  );
  useResampleAtTime(decoded, currentTime, isLive, onSample);
}
