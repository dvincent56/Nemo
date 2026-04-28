import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { OrderEnvelope } from '@nemo/shared-types';
import { replaceUserQueue } from './orderHistory';

function makeEnvelope(opts: {
  id: string;
  effectiveTs: number;
  type?: OrderEnvelope['order']['type'];
  completed?: boolean;
  trigger?: OrderEnvelope['order']['trigger'];
  connectionId?: string;
  clientSeq?: number;
}): OrderEnvelope {
  return {
    order: {
      id: opts.id,
      type: opts.type ?? 'CAP',
      trigger: opts.trigger ?? { type: 'AT_TIME', time: Math.floor(opts.effectiveTs / 1000) },
      value: { heading: 200 },
      ...(opts.completed !== undefined ? { completed: opts.completed } : {}),
    },
    clientTs: opts.effectiveTs,
    clientSeq: opts.clientSeq ?? 0,
    trustedTs: opts.effectiveTs,
    effectiveTs: opts.effectiveTs,
    receivedAt: opts.effectiveTs,
    connectionId: opts.connectionId ?? 'conn-A',
  };
}

describe('replaceUserQueue', () => {
  it('preserves envelopes marked completed, drops the others, then appends new envelopes sorted by effectiveTs', () => {
    const history: OrderEnvelope[] = [
      makeEnvelope({ id: 'old-completed', effectiveTs: 1000, completed: true }),
      makeEnvelope({ id: 'old-future-cap', effectiveTs: 5000 }),
      makeEnvelope({ id: 'old-active-wpt', effectiveTs: 2000, type: 'WPT' }),
    ];
    const incoming: OrderEnvelope[] = [
      makeEnvelope({ id: 'new-1', effectiveTs: 4000, clientSeq: 10 }),
      makeEnvelope({ id: 'new-2', effectiveTs: 3000, clientSeq: 11 }),
    ];

    const out = replaceUserQueue(history, incoming);

    assert.deepEqual(out.map((e) => e.order.id), ['old-completed', 'new-2', 'new-1']);
  });

  it('returns the new envelopes sorted by effectiveTs even if input is unsorted', () => {
    const incoming: OrderEnvelope[] = [
      makeEnvelope({ id: 'c', effectiveTs: 3000 }),
      makeEnvelope({ id: 'a', effectiveTs: 1000 }),
      makeEnvelope({ id: 'b', effectiveTs: 2000 }),
    ];

    const out = replaceUserQueue([], incoming);

    assert.deepEqual(out.map((e) => e.order.id), ['a', 'b', 'c']);
  });

  it('is a no-op on history when incoming is empty (still drops non-completed)', () => {
    const history: OrderEnvelope[] = [
      makeEnvelope({ id: 'kept', effectiveTs: 1000, completed: true }),
      makeEnvelope({ id: 'dropped', effectiveTs: 2000 }),
    ];

    const out = replaceUserQueue(history, []);

    assert.deepEqual(out.map((e) => e.order.id), ['kept']);
  });

  it('preserves completed history regardless of effectiveTs ordering vs incoming', () => {
    const history: OrderEnvelope[] = [
      makeEnvelope({ id: 'completed-future', effectiveTs: 9000, completed: true }),
    ];
    const incoming: OrderEnvelope[] = [
      makeEnvelope({ id: 'new', effectiveTs: 1000 }),
    ];

    const out = replaceUserQueue(history, incoming);

    assert.deepEqual(out.map((e) => e.order.id), ['completed-future', 'new']);
  });
});
