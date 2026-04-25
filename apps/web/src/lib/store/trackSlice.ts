'use client';
import type { GameStore, TrackPoint, TrackState } from './types';

export const INITIAL_TRACK: TrackState = {
  myPoints: [],
  isLoading: false,
  error: null,
  selfParticipantId: null,
};

export function createTrackSlice(set: (fn: (s: GameStore) => Partial<GameStore>) => void) {
  return {
    track: INITIAL_TRACK,

    setTrackLoading: (isLoading: boolean) =>
      set((s) => ({ track: { ...s.track, isLoading } })),

    setTrackError: (error: string | null) =>
      set((s) => ({ track: { ...s.track, error, isLoading: false } })),

    setTrack: (points: TrackPoint[]) =>
      set((s) => ({
        track: {
          ...s.track,
          myPoints: [...points].sort((a, b) => a.ts - b.ts),
          isLoading: false,
          error: null,
        },
      })),

    appendTrackPoint: (p: TrackPoint) =>
      set((s) => {
        if (s.track.myPoints.some((x) => x.ts === p.ts)) return { track: s.track };
        const next = [...s.track.myPoints, p].sort((a, b) => a.ts - b.ts);
        return { track: { ...s.track, myPoints: next } };
      }),

    clearTrack: () =>
      set((s) => ({
        // preserve selfParticipantId — only point data is cleared
        track: { ...INITIAL_TRACK, selfParticipantId: s.track.selfParticipantId },
      })),

    setSelfParticipantId: (id: string | null) =>
      set((s) => ({ track: { ...s.track, selfParticipantId: id } })),
  };
}
