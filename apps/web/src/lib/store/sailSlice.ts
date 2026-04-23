'use client';
import type { SailId } from '@nemo/shared-types';
import type { SailSliceState, SailAvailability, GameStore } from './types';

const ALL_SAILS: SailId[] = ['JIB', 'LJ', 'SS', 'C0', 'SPI', 'HG', 'LG'];

function defaultAvailability(): Record<SailId, SailAvailability> {
  return Object.fromEntries(ALL_SAILS.map((s) => [s, 'available'])) as Record<SailId, SailAvailability>;
}

export const INITIAL_SAIL: SailSliceState = {
  currentSail: 'JIB', sailPending: null,
  transitionStartMs: 0, transitionEndMs: 0,
  sailAuto: false, sailAvailability: defaultAvailability(),
  maneuverKind: 0, maneuverStartMs: 0, maneuverEndMs: 0,
  pending: {},
};

export function createSailSlice(set: (fn: (s: GameStore) => Partial<GameStore>) => void) {
  return {
    sail: INITIAL_SAIL,
    setSail: (patch: Partial<SailSliceState>) => set((s) => ({ sail: { ...s.sail, ...patch } })),
    toggleSailAuto: () => set((s) => ({ sail: { ...s.sail, sailAuto: !s.sail.sailAuto } })),
  };
}
