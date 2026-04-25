'use client';
import type { HudState, WearDetail, GameStore } from './types';
import { NEUTRAL_BOAT_EFFECTS } from '@/lib/api';

const INITIAL_WEAR: WearDetail = { hull: 100, rig: 100, sails: 100, electronics: 100 };

export const INITIAL_HUD: HudState = {
  boatClass: null,
  tws: 0, twd: 0, twa: 0, hdg: 0, bsp: 0, vmg: 0, dtf: 0,
  overlapFactor: 1.0, bspBaseMultiplier: 1.0, twaColor: 'neutral',
  rank: 0, totalParticipants: 0, rankTrend: 0,
  wearGlobal: 100, wearDetail: INITIAL_WEAR,
  speedPenaltyPct: 0,
  lat: 0, lon: 0,
  twaLock: null,
  effects: NEUTRAL_BOAT_EFFECTS,
  pending: {},
};

export function createHudSlice(set: (fn: (s: GameStore) => Partial<GameStore>) => void) {
  return {
    hud: INITIAL_HUD,
    setHud: (patch: Partial<HudState>) => set((s) => ({ hud: { ...s.hud, ...patch } })),
    setHudOptimistic: (field: 'hdg', value: number) =>
      set((s) => ({
        hud: {
          ...s.hud,
          [field]: value,
          pending: {
            ...s.hud.pending,
            [field]: { expected: value, since: Date.now() },
          },
        },
      })),
    applyOptimisticHud: (patch: { hdg?: number; twa?: number; bsp?: number }) =>
      set((s) => {
        const now = Date.now();
        const nextPending = { ...s.hud.pending };
        if (patch.hdg !== undefined) nextPending.hdg = { expected: patch.hdg, since: now };
        if (patch.twa !== undefined) nextPending.twa = { expected: patch.twa, since: now };
        if (patch.bsp !== undefined) nextPending.bsp = { expected: patch.bsp, since: now };
        return {
          hud: {
            ...s.hud,
            ...(patch.hdg !== undefined ? { hdg: patch.hdg } : {}),
            ...(patch.twa !== undefined ? { twa: patch.twa } : {}),
            ...(patch.bsp !== undefined ? { bsp: patch.bsp } : {}),
            pending: nextPending,
          },
        };
      }),
  };
}
