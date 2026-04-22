// apps/web/src/hooks/useTacticalTile.ts
'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useGameStore } from '@/lib/store';
import {
  fetchTacticalTile,
  isBoatInsideMargin,
  type Bbox,
} from '@/lib/weather/tacticalTile';
import { decodedGridToWeatherGridAtNow } from '@/lib/weather/gridFromBinary';

/**
 * Lazily fetches a 0.25° tactical tile around the boat position (t=0..24h).
 * Refetches when the boat drifts within the edge margin. Safe no-op before the
 * boat position is known.
 */
export function useTacticalTile(): void {
  const lat = useGameStore((s) => s.hud.lat);
  const lon = useGameStore((s) => s.hud.lon);
  const setTacticalTile = useGameStore((s) => s.setTacticalTile);

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
        const { tile, bounds } = await fetchTacticalTile(boat);
        if (cancelled) return;
        currentBoundsRef.current = bounds;
        setTacticalTile(decodedGridToWeatherGridAtNow(tile), bounds);
      } catch {
        // silently ignore — global grid remains active
      } finally {
        inFlightRef.current = false;
      }
    })();

    return () => { cancelled = true; };
  }, [boat, setTacticalTile]);
}
