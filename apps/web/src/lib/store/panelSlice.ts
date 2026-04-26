'use client';
import type { PanelState, PanelName, GameStore } from './types';

export const INITIAL_PANEL: PanelState = { activePanel: null };

export function createPanelSlice(set: (fn: (s: GameStore) => Partial<GameStore>) => void) {
  return {
    panel: INITIAL_PANEL,
    openPanel: (p: PanelName) =>
      set((s) => {
        const closingRouter = s.panel.activePanel === 'router' && p !== 'router';
        return {
          panel: { activePanel: p },
          ...(closingRouter
            ? {
                router: {
                  ...s.router,
                  phase: 'idle' as const,
                  destination: null,
                  computedRoute: null,
                  error: null,
                  calcGenId: s.router.calcGenId + 1,
                },
              }
            : {}),
        };
      }),
    closePanel: () =>
      set((s) => ({
        panel: { activePanel: null },
        ...(s.panel.activePanel === 'router'
          ? {
              router: {
                ...s.router,
                phase: 'idle' as const,
                destination: null,
                computedRoute: null,
                error: null,
                calcGenId: s.router.calcGenId + 1,
              },
            }
          : {}),
      })),
  };
}
