'use client';
import type { SelectionState, GameStore } from './types';

export const INITIAL_SELECTION: SelectionState = { selectedBoatIds: new Set() };

export function createSelectionSlice(set: (fn: (s: GameStore) => Partial<GameStore>) => void) {
  return {
    selection: INITIAL_SELECTION,
    toggleBoat: (id: string) => set((s) => {
      const next = new Set(s.selection.selectedBoatIds);
      if (next.has(id)) next.delete(id); else next.add(id);
      return { selection: { ...s.selection, selectedBoatIds: next } };
    }),
    clearSelection: () => set((s) => ({ selection: { ...s.selection, selectedBoatIds: new Set() } })),
  };
}
