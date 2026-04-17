'use client';
import type { TimelineState, PlaybackSpeed, GameStore } from './types';

export const INITIAL_TIMELINE: TimelineState = { currentTime: new Date(), isLive: true, playbackSpeed: 1 };

export function createTimelineSlice(set: (fn: (s: GameStore) => Partial<GameStore>) => void) {
  return {
    timeline: INITIAL_TIMELINE,
    setTime: (t: Date) => set(() => ({ timeline: { currentTime: t, isLive: false, playbackSpeed: 1 } })),
    goLive: () => set(() => ({ timeline: { currentTime: new Date(), isLive: true, playbackSpeed: 1 } })),
    setPlaybackSpeed: (speed: PlaybackSpeed) => set((s) => ({ timeline: { ...s.timeline, playbackSpeed: speed } })),
  };
}
