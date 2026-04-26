'use client';
import type { TimelineState, PlaybackSpeed, GameStore } from './types';

// Use epoch 0 as initial value to avoid SSR/CSR hydration mismatch.
// The actual "now" is set when the play screen mounts (via goLive or useTicker).
export const INITIAL_TIMELINE: TimelineState = {
  currentTime: new Date(0),
  isLive: true,
  playbackSpeed: 1,
  isPlaying: false,
  raceStartMs: null,
  raceEndMs: null,
  forecastEndMs: null,
};

export function createTimelineSlice(set: (fn: (s: GameStore) => Partial<GameStore>) => void) {
  return {
    timeline: INITIAL_TIMELINE,

    setTime: (t: Date) =>
      set((s) => ({
        timeline: { ...s.timeline, currentTime: t, isLive: false, isPlaying: false },
      })),

    goLive: () =>
      set((s) => ({
        timeline: {
          ...s.timeline,
          currentTime: new Date(),
          isLive: true,
          isPlaying: false,
          playbackSpeed: 1,
        },
      })),

    setPlaybackSpeed: (speed: PlaybackSpeed) =>
      set((s) => ({ timeline: { ...s.timeline, playbackSpeed: speed } })),

    setIsPlaying: (b: boolean) =>
      set((s) => {
        // Pressing Play from LIVE exits LIVE and snapshots wall-clock as the
        // starting cursor position. Otherwise it just toggles the flag.
        if (b && s.timeline.isLive) {
          return {
            timeline: { ...s.timeline, isPlaying: true, isLive: false, currentTime: new Date() },
          };
        }
        return { timeline: { ...s.timeline, isPlaying: b } };
      }),

    setRaceContext: (ctx: { startMs: number | null; endMs?: number | null; forecastEndMs: number | null }) =>
      set((s) => ({
        timeline: {
          ...s.timeline,
          raceStartMs: ctx.startMs,
          raceEndMs: ctx.endMs ?? null,
          forecastEndMs: ctx.forecastEndMs,
        },
      })),
  };
}
