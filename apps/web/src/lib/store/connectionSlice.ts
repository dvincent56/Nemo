'use client';
import type { ConnectionState, ConnState, GameStore } from './types';

export const INITIAL_CONNECTION: ConnectionState = { wsState: 'idle' };

export function createConnectionSlice(set: (fn: (s: GameStore) => Partial<GameStore>) => void) {
  return {
    connection: INITIAL_CONNECTION,
    setConnection: (wsState: ConnState) => set(() => ({ connection: { wsState } })),
  };
}
