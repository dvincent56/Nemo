import { describe, it, expect, beforeEach } from 'vitest';
import { useGameStore } from './index';

describe('routerSlice', () => {
  beforeEach(() => {
    useGameStore.setState(() => ({
      router: {
        phase: 'idle',
        destination: null,
        preset: 'FAST',
        coastDetection: false,
        coneHalfDeg: 60,
        computedRoute: null,
        error: null,
        calcGenId: 0,
      },
      panel: { activePanel: null },
    }));
  });

  it('opens the router panel and sets activePanel', () => {
    useGameStore.getState().openRouter();
    expect(useGameStore.getState().panel.activePanel).toBe('router');
  });

  it('openRouter closes any other active panel and clears it on close', () => {
    useGameStore.getState().openPanel('sails');
    useGameStore.getState().openRouter();
    expect(useGameStore.getState().panel.activePanel).toBe('router');
    useGameStore.getState().closeRouter();
    expect(useGameStore.getState().panel.activePanel).toBe(null);
    expect(useGameStore.getState().router.computedRoute).toBe(null);
  });

  it('enterPlacingMode sets phase to placing', () => {
    useGameStore.getState().enterPlacingMode();
    expect(useGameStore.getState().router.phase).toBe('placing');
  });

  it('exitPlacingMode returns to idle when in placing phase', () => {
    useGameStore.getState().enterPlacingMode();
    useGameStore.getState().exitPlacingMode();
    expect(useGameStore.getState().router.phase).toBe('idle');
  });

  it('setRouterDestination returns to idle and stores coords', () => {
    useGameStore.getState().enterPlacingMode();
    useGameStore.getState().setRouterDestination(46.5, -4.2);
    const { phase, destination } = useGameStore.getState().router;
    expect(phase).toBe('idle');
    expect(destination).toEqual({ lat: 46.5, lon: -4.2 });
  });

  it('startRouteCalculation increments calcGenId and switches phase', () => {
    const genA = useGameStore.getState().startRouteCalculation();
    expect(useGameStore.getState().router.phase).toBe('calculating');
    expect(useGameStore.getState().router.calcGenId).toBe(genA);
    const genB = useGameStore.getState().startRouteCalculation();
    expect(genB).toBe(genA + 1);
  });

  it('setRouteResult only applies if genId matches current calcGenId', () => {
    const gen = useGameStore.getState().startRouteCalculation();
    useGameStore.getState().setRouteResult({} as never, gen);
    expect(useGameStore.getState().router.phase).toBe('results');

    // Stale result (lower genId) is ignored
    useGameStore.getState().startRouteCalculation();
    useGameStore.getState().setRouteResult({ stale: true } as never, gen);
    expect(useGameStore.getState().router.phase).toBe('calculating');
  });

  it('setRouteError applies only if genId matches', () => {
    const gen = useGameStore.getState().startRouteCalculation();
    useGameStore.getState().setRouteError('boom', gen);
    expect(useGameStore.getState().router.phase).toBe('idle');
    expect(useGameStore.getState().router.error).toBe('boom');

    // Stale error (mismatched genId) is ignored
    const stalePhaseBefore = useGameStore.getState().router.phase;
    useGameStore.getState().setRouteError('stale', gen - 1);
    expect(useGameStore.getState().router.phase).toBe(stalePhaseBefore);
    expect(useGameStore.getState().router.error).toBe('boom');
  });

  it('clearRoute removes computedRoute without changing phase or destination', () => {
    useGameStore.getState().setRouterDestination(46, -4);
    const gen = useGameStore.getState().startRouteCalculation();
    useGameStore.getState().setRouteResult({} as never, gen);
    useGameStore.getState().clearRoute();
    expect(useGameStore.getState().router.computedRoute).toBe(null);
    expect(useGameStore.getState().router.destination).toEqual({ lat: 46, lon: -4 });
  });

  it('opening another panel closes router and clears its route', () => {
    useGameStore.getState().setRouterDestination(46, -4);
    const gen = useGameStore.getState().startRouteCalculation();
    useGameStore.getState().setRouteResult({} as never, gen);
    useGameStore.getState().openRouter();
    useGameStore.getState().openPanel('sails');
    expect(useGameStore.getState().router.computedRoute).toBe(null);
  });

  it('setRouterPreset bumps calcGenId so an in-flight result is dropped', () => {
    const gen = useGameStore.getState().startRouteCalculation();
    useGameStore.getState().setRouterPreset('HIGHRES');
    // The worker (hypothetically) returns with the old genId
    useGameStore.getState().setRouteResult({} as never, gen);
    expect(useGameStore.getState().router.computedRoute).toBe(null);
    expect(useGameStore.getState().router.phase).toBe('idle');
  });

  it('setRouterDestination bumps calcGenId so an in-flight result is dropped', () => {
    useGameStore.getState().setRouterDestination(46, -4);
    const gen = useGameStore.getState().startRouteCalculation();
    useGameStore.getState().setRouterDestination(47, -5);
    useGameStore.getState().setRouteResult({} as never, gen);
    expect(useGameStore.getState().router.computedRoute).toBe(null);
  });

  it('closePanel from router clears computedRoute and bumps calcGenId', () => {
    useGameStore.getState().openRouter();
    const gen = useGameStore.getState().startRouteCalculation();
    useGameStore.getState().setRouteResult({} as never, gen);
    expect(useGameStore.getState().router.computedRoute).not.toBeNull();

    useGameStore.getState().closePanel();

    expect(useGameStore.getState().panel.activePanel).toBe(null);
    expect(useGameStore.getState().router.computedRoute).toBe(null);
    expect(useGameStore.getState().router.phase).toBe('idle');
    expect(useGameStore.getState().router.calcGenId).toBeGreaterThan(gen);
  });

  it('closePanel from non-router does not touch router state', () => {
    useGameStore.getState().setRouterDestination(46, -4);
    const beforeGen = useGameStore.getState().router.calcGenId;
    useGameStore.getState().openPanel('sails');
    useGameStore.getState().closePanel();
    // Router state should be preserved (we're not closing router, we're closing sails)
    expect(useGameStore.getState().router.destination).toEqual({ lat: 46, lon: -4 });
    expect(useGameStore.getState().router.calcGenId).toBe(beforeGen);
  });
});
