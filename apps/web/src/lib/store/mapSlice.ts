'use client';
import type { MapState, GameStore } from './types';

export const INITIAL_MAP: MapState = { center: [0, 0], zoom: 6, isFollowingBoat: true };

export function createMapSlice(set: (fn: (s: GameStore) => Partial<GameStore>) => void) {
  return {
    map: INITIAL_MAP,
    setMapView: (center: [number, number], zoom: number) =>
      set((s) => ({ map: { ...s.map, center, zoom, isFollowingBoat: false } })),
    setFollowBoat: (follow: boolean) =>
      set((s) => ({ map: { ...s.map, isFollowingBoat: follow } })),
  };
}
