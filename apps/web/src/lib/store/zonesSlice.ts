'use client';
import type { ExclusionZone } from '@nemo/shared-types';
import type { GameStore } from './types';

/**
 * Race exclusion zones (WARN/PENALTY polygons).
 * Populated once when the race is loaded; consumed by the projection
 * and map rendering.
 */
export interface ZonesState {
  zones: ExclusionZone[];
}

export const INITIAL_ZONES: ZonesState = {
  zones: [],
};

export function createZonesSlice(set: (fn: (s: GameStore) => Partial<GameStore>) => void) {
  return {
    zones: INITIAL_ZONES.zones,
    setZones: (zones: ExclusionZone[]) =>
      set(() => ({ zones })),
  };
}
