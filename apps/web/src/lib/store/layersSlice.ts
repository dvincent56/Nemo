'use client';
import type { LayersState, LayerName, GameStore } from './types';

export const INITIAL_LAYERS: LayersState = { wind: true, swell: false, opponents: true, zones: true, coastline: false };

export function createLayersSlice(set: (fn: (s: GameStore) => Partial<GameStore>) => void) {
  return {
    layers: INITIAL_LAYERS,
    toggleLayer: (layer: LayerName) => set((s) => {
      const next = { ...s.layers };
      next[layer] = !next[layer];
      if (layer === 'wind' && next.wind) next.swell = false;
      if (layer === 'swell' && next.swell) next.wind = false;
      return { layers: next };
    }),
  };
}
