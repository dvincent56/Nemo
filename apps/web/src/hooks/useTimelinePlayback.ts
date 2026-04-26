'use client';
import { useEffect, useRef } from 'react';
import { useGameStore } from '@/lib/store';
import { selectTimelineBounds, type RaceStatus } from '@/lib/store/timeline-selectors';

/**
 * Pilote la timeline :
 * - mode LIVE : refresh `currentTime` toutes les 5s pour suivre wall-clock
 * - mode Play (pas live) : rAF loop qui avance currentTime à playbackSpeed
 *   réelle (1x/6x/24x). En atteignant maxMs, retour LIVE auto.
 */
export function useTimelinePlayback(raceStatus: RaceStatus): void {
  const isPlaying = useGameStore((s) => s.timeline.isPlaying);
  const isLive = useGameStore((s) => s.timeline.isLive);
  const playbackSpeed = useGameStore((s) => s.timeline.playbackSpeed);
  const raceStartMs = useGameStore((s) => s.timeline.raceStartMs);
  const raceEndMs = useGameStore((s) => s.timeline.raceEndMs);
  const forecastEndMs = useGameStore((s) => s.timeline.forecastEndMs);
  const setTime = useGameStore((s) => s.setTime);
  const setIsPlaying = useGameStore((s) => s.setIsPlaying);
  const goLive = useGameStore((s) => s.goLive);

  // Live tracking — refresh currentTime every 5s so the cursor sticks to "now".
  useEffect(() => {
    if (!isLive) return;
    const id = window.setInterval(() => {
      goLive();
    }, 5_000);
    return () => window.clearInterval(id);
  }, [isLive, goLive]);

  // Play loop — advance currentTime in real time × playbackSpeed.
  const lastFrameRef = useRef<number>(0);
  useEffect(() => {
    if (!isPlaying || isLive) {
      lastFrameRef.current = 0;
      return;
    }
    let raf = 0;
    const tick = (frameTime: number) => {
      const last = lastFrameRef.current || frameTime;
      const dtRealMs = frameTime - last;
      lastFrameRef.current = frameTime;

      const state = useGameStore.getState();
      const currentMs = state.timeline.currentTime.getTime();
      const next = currentMs + dtRealMs * playbackSpeed;

      const bounds = selectTimelineBounds({
        raceStartMs, raceEndMs, forecastEndMs, status: raceStatus,
      });
      if (next >= bounds.maxMs) {
        setIsPlaying(false);
        goLive();
        return;
      }
      setTime(new Date(next));
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(raf);
      lastFrameRef.current = 0;
    };
  }, [isPlaying, isLive, playbackSpeed, raceStartMs, raceEndMs, forecastEndMs, raceStatus, setTime, setIsPlaying, goLive]);
}
