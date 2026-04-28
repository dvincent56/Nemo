'use client';
import { useEffect, useRef } from 'react';
import { decodedGridToWeatherGridAtNow } from '@/lib/weather/gridFromBinary';
import type { DecodedWeatherGrid } from '@/lib/weather/binaryDecoder';
import type { WeatherGrid } from '@/lib/store/types';

const RESAMPLE_THROTTLE_GAME_MS = 5 * 60_000;
const RESAMPLE_THROTTLE_WALL_MS = 150;
const FIVE_MIN = 5 * 60_000;

/**
 * Re-resample `decoded` at `currentTime` (or `Date.now()` when `isLive`) and
 * forward the resulting WeatherGrid to `onSample`. Used by overlays that
 * consume a 2D `WeatherGrid` snapshot but want it to track the timeline.
 *
 * Throttling:
 * - 5 min of game time minimum between samples — the underlying forecast is
 *   3-hourly so finer scrub steps add no information.
 * - 150 ms wall-clock trailing debounce — a fast cursor drag fires
 *   `currentTime` updates at ~60 Hz; without this guard each pixel of drag
 *   re-decodes the grid.
 * - In live mode, also re-samples every 5 wall-clock minutes so the grid
 *   tracks reality even when the tab was inactive.
 *
 * When `decoded` reference changes (e.g. tactical tile refetched after the
 * boat drifted), the throttle is bypassed so the new grid is sampled
 * immediately at the current scrub time.
 *
 * `onSample` MUST be referentially stable across renders.
 */
export function useResampleAtTime(
  decoded: DecodedWeatherGrid | null,
  currentTime: Date,
  isLive: boolean,
  onSample: (grid: WeatherGrid, targetMs: number) => void,
): void {
  const lastSampleGameMsRef = useRef<number>(0);
  const lastWallClockMsRef = useRef<number>(0);
  const decodedRef = useRef<DecodedWeatherGrid | null>(null);

  useEffect(() => {
    if (!decoded) return;
    const decodedChanged = decodedRef.current !== decoded;
    decodedRef.current = decoded;

    const targetMs = isLive ? Date.now() : currentTime.getTime();
    if (
      !decodedChanged &&
      Math.abs(targetMs - lastSampleGameMsRef.current) < RESAMPLE_THROTTLE_GAME_MS
    ) {
      return;
    }
    const nowWall = Date.now();
    const sinceLastWall = nowWall - lastWallClockMsRef.current;
    if (!decodedChanged && sinceLastWall < RESAMPLE_THROTTLE_WALL_MS) {
      const wait = RESAMPLE_THROTTLE_WALL_MS - sinceLastWall;
      const id = window.setTimeout(() => {
        const t = isLive ? Date.now() : currentTime.getTime();
        onSample(decodedGridToWeatherGridAtNow(decoded, t), t);
        lastSampleGameMsRef.current = t;
        lastWallClockMsRef.current = Date.now();
      }, wait);
      return () => window.clearTimeout(id);
    }
    onSample(decodedGridToWeatherGridAtNow(decoded, targetMs), targetMs);
    lastSampleGameMsRef.current = targetMs;
    lastWallClockMsRef.current = nowWall;
    return undefined;
  }, [decoded, currentTime, isLive, onSample]);

  useEffect(() => {
    if (!isLive || !decoded) return;
    const id = window.setInterval(() => {
      const target = Date.now();
      if (target - lastWallClockMsRef.current < FIVE_MIN) return;
      onSample(decodedGridToWeatherGridAtNow(decoded, target), target);
      lastSampleGameMsRef.current = target;
      lastWallClockMsRef.current = target;
    }, FIVE_MIN);
    return () => window.clearInterval(id);
  }, [isLive, decoded, onSample]);
}
