'use client';

import type { MapAppearanceState, GameStore } from './types';
import {
  DEFAULT_OCEAN_ID,
  DEFAULT_LAND_ID,
  STORAGE_KEY,
  findOceanPreset,
  findLandPreset,
} from '@/lib/mapAppearance';

function readFromStorage(): MapAppearanceState {
  const fallback: MapAppearanceState = {
    oceanPresetId: DEFAULT_OCEAN_ID,
    landPresetId: DEFAULT_LAND_ID,
  };
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return fallback;
    const rec = parsed as Record<string, unknown>;
    const oceanId = typeof rec['oceanPresetId'] === 'string' ? rec['oceanPresetId'] : '';
    const landId = typeof rec['landPresetId'] === 'string' ? rec['landPresetId'] : '';
    return {
      oceanPresetId: findOceanPreset(oceanId) ? oceanId : DEFAULT_OCEAN_ID,
      landPresetId: findLandPreset(landId) ? landId : DEFAULT_LAND_ID,
    };
  } catch {
    return fallback;
  }
}

function writeToStorage(state: MapAppearanceState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Quota exceeded or disabled — swallow silently.
  }
}

export function createMapAppearanceSlice(
  set: (fn: (s: GameStore) => Partial<GameStore>) => void,
) {
  return {
    mapAppearance: readFromStorage(),

    setOceanPreset: (id: string) => set((s) => {
      if (!findOceanPreset(id)) return {};
      const next = { ...s.mapAppearance, oceanPresetId: id };
      writeToStorage(next);
      return { mapAppearance: next };
    }),

    setLandPreset: (id: string) => set((s) => {
      if (!findLandPreset(id)) return {};
      const next = { ...s.mapAppearance, landPresetId: id };
      writeToStorage(next);
      return { mapAppearance: next };
    }),
  };
}
