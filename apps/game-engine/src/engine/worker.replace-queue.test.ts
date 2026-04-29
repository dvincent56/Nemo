import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { OrderEnvelope } from '@nemo/shared-types';
import { type BoatRuntime } from '@nemo/game-engine-core';
// We import the pure handler so we can drive it without spawning a worker.
// The handler is extracted in step 3 below.
import { handleReplaceUserQueue } from './worker.handlers';

function makeRuntime(boatId: string, history: OrderEnvelope[] = []): BoatRuntime {
  // The handler only reads boat.id and orderHistory; the other fields are
  // not touched. Cast through unknown to bypass strict shape checking for
  // this test stub. If you need a fuller fixture, use the helper at
  // packages/game-engine-core/src/tick.transition.test.ts (search makeRuntime).
  return ({
    boat: { id: boatId },
    orderHistory: history,
  } as unknown) as BoatRuntime;
}

function envelope(opts: {
  id: string;
  effectiveTs: number;
  completed?: boolean;
  type?: 'CAP' | 'WPT' | 'TWA' | 'SAIL' | 'MODE' | 'VMG';
}): OrderEnvelope {
  return {
    order: {
      id: opts.id,
      type: opts.type ?? 'CAP',
      trigger: { type: 'AT_TIME', time: Math.floor(opts.effectiveTs / 1000) },
      value: {},
      ...(opts.completed !== undefined ? { completed: opts.completed } : {}),
    },
    clientTs: opts.effectiveTs,
    clientSeq: 0,
    trustedTs: opts.effectiveTs,
    effectiveTs: opts.effectiveTs,
    receivedAt: opts.effectiveTs,
    connectionId: 'c',
  };
}

describe('handleReplaceUserQueue', () => {
  it('replaces a target boat orderHistory while preserving completed history', () => {
    const runtimes: BoatRuntime[] = [
      makeRuntime('boat-A', [
        envelope({ id: 'old-done', effectiveTs: 100, completed: true }),
        envelope({ id: 'old-future', effectiveTs: 200 }),
      ]),
      makeRuntime('boat-B', [envelope({ id: 'b1', effectiveTs: 100 })]),
    ];

    const result = handleReplaceUserQueue(runtimes, {
      boatId: 'boat-A',
      envelopes: [envelope({ id: 'new-1', effectiveTs: 300 })],
    });

    assert.deepEqual(result.map((r) => r.boat.id), ['boat-A', 'boat-B']);
    assert.deepEqual(result[0]!.orderHistory.map((e) => e.order.id), ['old-done', 'new-1']);
    // Other boat untouched
    assert.deepEqual(result[1]!.orderHistory.map((e) => e.order.id), ['b1']);
  });

  it('returns runtimes unchanged when boatId does not match', () => {
    const runtimes: BoatRuntime[] = [makeRuntime('boat-A', [envelope({ id: 'x', effectiveTs: 1 })])];

    const result = handleReplaceUserQueue(runtimes, {
      boatId: 'boat-Z',
      envelopes: [envelope({ id: 'new', effectiveTs: 2 })],
    });

    assert.deepEqual(result, runtimes);
  });
});
