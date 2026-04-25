'use client';
import type { GameStore, RouterState } from './types';
import type { RoutePlan } from '@nemo/routing';

export const INITIAL_ROUTER: RouterState = {
  phase: 'idle',
  destination: null,
  preset: 'FAST',
  coastDetection: false,
  coneHalfDeg: 60,
  computedRoute: null,
  error: null,
  calcGenId: 0,
};

export function createRouterSlice(
  set: (fn: (s: GameStore) => Partial<GameStore>) => void,
  get: () => GameStore,
) {
  return {
    router: INITIAL_ROUTER,

    openRouter: () =>
      set(() => ({ panel: { activePanel: 'router' } })),

    closeRouter: () =>
      set((s) => ({
        panel: { activePanel: s.panel.activePanel === 'router' ? null : s.panel.activePanel },
        router: {
          ...s.router,
          phase: 'idle',
          computedRoute: null,
          error: null,
          calcGenId: s.router.calcGenId + 1,
        },
      })),

    enterPlacingMode: () =>
      set((s) => ({ router: { ...s.router, phase: 'placing' } })),

    exitPlacingMode: () =>
      set((s) => ({
        router: {
          ...s.router,
          phase: s.router.phase === 'placing' ? 'idle' : s.router.phase,
        },
      })),

    setRouterDestination: (lat: number, lon: number) =>
      set((s) => ({
        router: {
          ...s.router,
          phase: 'idle',
          destination: { lat, lon },
          computedRoute: null,
          error: null,
        },
      })),

    setRouterPreset: (preset: RouterState['preset']) =>
      set((s) => ({ router: { ...s.router, preset, computedRoute: null } })),

    setRouterCoastDetection: (coastDetection: boolean) =>
      set((s) => ({ router: { ...s.router, coastDetection, computedRoute: null } })),

    setRouterConeHalfDeg: (coneHalfDeg: number) =>
      set((s) => ({ router: { ...s.router, coneHalfDeg, computedRoute: null } })),

    startRouteCalculation: (): number => {
      const next = get().router.calcGenId + 1;
      set((s) => ({
        router: { ...s.router, phase: 'calculating', error: null, calcGenId: next },
      }));
      return next;
    },

    setRouteResult: (plan: RoutePlan, genId: number) =>
      set((s) => {
        if (s.router.calcGenId !== genId) return {};
        return { router: { ...s.router, phase: 'results', computedRoute: plan } };
      }),

    setRouteError: (msg: string, genId: number) =>
      set((s) => {
        if (s.router.calcGenId !== genId) return {};
        return { router: { ...s.router, phase: 'idle', error: msg } };
      }),

    clearRoute: () =>
      set((s) => ({ router: { ...s.router, computedRoute: null, error: null } })),
  };
}
