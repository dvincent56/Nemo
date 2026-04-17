'use client';
import type { HudState, WearDetail, GameStore } from './types';

const INITIAL_WEAR: WearDetail = { hull: 100, rig: 100, sails: 100, electronics: 100 };

export const INITIAL_HUD: HudState = {
  tws: 0, twd: 0, twa: 0, hdg: 0, bsp: 0, vmg: 0, dtf: 0,
  overlapFactor: 1.0, twaColor: 'neutral',
  rank: 0, totalParticipants: 0, rankTrend: 0,
  wearGlobal: 100, wearDetail: INITIAL_WEAR,
  lat: 0, lon: 0,
};

export function createHudSlice(set: (fn: (s: GameStore) => Partial<GameStore>) => void) {
  return {
    hud: INITIAL_HUD,
    setHud: (patch: Partial<HudState>) => set((s) => ({ hud: { ...s.hud, ...patch } })),
  };
}
