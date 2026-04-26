'use client';
import type { ProgState, OrderEntry, GameStore } from './types';

export const INITIAL_PROG: ProgState = { orderQueue: [], serverQueue: [] };

export function createProgSlice(set: (fn: (s: GameStore) => Partial<GameStore>) => void) {
  return {
    prog: INITIAL_PROG,
    addOrder: (order: OrderEntry) =>
      set((s) => ({ prog: { ...s.prog, orderQueue: [...s.prog.orderQueue, order] } })),
    removeOrder: (id: string) =>
      set((s) => ({ prog: { ...s.prog, orderQueue: s.prog.orderQueue.filter((o) => o.id !== id) } })),
    reorderQueue: (from: number, to: number) =>
      set((s) => {
        const queue = [...s.prog.orderQueue];
        const moved = queue.splice(from, 1)[0];
        if (moved !== undefined) queue.splice(to, 0, moved);
        return { prog: { ...s.prog, orderQueue: queue } };
      }),
    commitQueue: () =>
      set((s) => ({ prog: { ...s.prog, serverQueue: [...s.prog.orderQueue] } })),
    replaceOrderQueue: (orders: OrderEntry[]) =>
      set((s) => ({ prog: { ...s.prog, orderQueue: orders } })),
  };
}
