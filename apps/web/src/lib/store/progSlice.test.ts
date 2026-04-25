import { describe, it, expect, beforeEach } from 'vitest';
import { useGameStore } from './index';
import type { OrderEntry } from './types';

const order = (id: string, type: OrderEntry['type'] = 'CAP'): OrderEntry => ({
  id, type, value: { cap: 0 }, trigger: { type: 'IMMEDIATE' }, label: id,
});

describe('progSlice', () => {
  beforeEach(() => {
    useGameStore.setState(() => ({ prog: { orderQueue: [], serverQueue: [] } }));
  });

  it('replaceOrderQueue replaces all pending orders', () => {
    useGameStore.getState().addOrder(order('a'));
    useGameStore.getState().addOrder(order('b'));
    useGameStore.getState().replaceOrderQueue([order('x'), order('y'), order('z')]);
    const ids = useGameStore.getState().prog.orderQueue.map((o) => o.id);
    expect(ids).toEqual(['x', 'y', 'z']);
  });

  it('replaceOrderQueue leaves serverQueue untouched', () => {
    useGameStore.setState(() => ({ prog: { orderQueue: [], serverQueue: [order('s1')] } }));
    useGameStore.getState().replaceOrderQueue([order('n1')]);
    expect(useGameStore.getState().prog.serverQueue.map((o) => o.id)).toEqual(['s1']);
  });
});
