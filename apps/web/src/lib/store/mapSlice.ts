'use client';
import type { MapState, MapBounds, GameStore } from './types';

const INITIAL_BOUNDS: MapBounds = { north: 55, south: 35, east: 5, west: -20 };

export const INITIAL_MAP: MapState = {
  center: [-3, 47],
  zoom: 5,
  isFollowingBoat: true,
  bounds: INITIAL_BOUNDS,
};

export function createMapSlice(set: (fn: (s: GameStore) => Partial<GameStore>) => void) {
  return {
    map: INITIAL_MAP,
    setMapView: (center: [number, number], zoom: number) =>
      set((s) => ({ map: { ...s.map, center, zoom, isFollowingBoat: false } })),
    setMapBounds: (bounds: MapBounds) =>
      set((s) => ({ map: { ...s.map, bounds } })),
    setFollowBoat: (follow: boolean) =>
      set((s) => ({ map: { ...s.map, isFollowingBoat: follow } })),
  };
}
