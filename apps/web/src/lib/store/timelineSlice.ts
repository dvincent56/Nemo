'use client';
import type { TimelineState, PlaybackSpeed, GameStore } from './types';

// Use epoch 0 as initial value to avoid SSR/CSR hydration mismatch.
// The actual "now" is set when the play screen mounts (via goLive or useTicker).
export const INITIAL_TIMELINE: TimelineState = { currentTime: new Date(0), isLive: true, playbackSpeed: 1 };

export function createTimelineSlice(set: (fn: (s: GameStore) => Partial<GameStore>) => void) {
  return {
    timeline: INITIAL_TIMELINE,
    setTime: (t: Date) => set(() => ({ timeline: { currentTime: t, isLive: false, playbackSpeed: 1 } })),
    goLive: () => set(() => ({ timeline: { currentTime: new Date(), isLive: true, playbackSpeed: 1 } })),
    setPlaybackSpeed: (speed: PlaybackSpeed) => set((s) => ({ timeline: { ...s.timeline, playbackSpeed: speed } })),
  };
}
