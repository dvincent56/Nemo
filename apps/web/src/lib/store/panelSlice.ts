'use client';
import type { PanelState, PanelName, GameStore } from './types';

export const INITIAL_PANEL: PanelState = { activePanel: null };

export function createPanelSlice(set: (fn: (s: GameStore) => Partial<GameStore>) => void) {
  return {
    panel: INITIAL_PANEL,
    openPanel: (p: PanelName) => set(() => ({ panel: { activePanel: p } })),
    closePanel: () => set(() => ({ panel: { activePanel: null } })),
  };
}
