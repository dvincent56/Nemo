import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shouldCheckpoint, enqueueCheckpoints } from './track-checkpoint.js';

describe('shouldCheckpoint', () => {
  const intervalMs = 60 * 60_000; // 1h

  it('returns true on first checkpoint (lastCheckpointTs null)', () => {
    assert.equal(shouldCheckpoint(null, Date.now(), intervalMs), true);
  });

  it('returns false when interval not elapsed', () => {
    const now = 100_000;
    assert.equal(shouldCheckpoint(now - 30 * 60_000, now, intervalMs), false);
  });

  it('returns true when interval elapsed', () => {
    const now = 100_000;
    assert.equal(shouldCheckpoint(now - 60 * 60_000, now, intervalMs), true);
  });
});

describe('enqueueCheckpoints', () => {
  it('emits one checkpoint per participant whose interval has elapsed', () => {
    const now = 100_000_000;
    const intervalMs = 60 * 60_000;
    const inputs = [
      { participantId: 'a', lat: 1, lon: 2, lastCheckpointTs: null },
      { participantId: 'b', lat: 3, lon: 4, lastCheckpointTs: now - 30 * 60_000 },
      { participantId: 'c', lat: 5, lon: 6, lastCheckpointTs: now - 60 * 60_000 },
    ];
    const ranks = new Map([['a', 2], ['b', 1], ['c', 3]]);
    const out = enqueueCheckpoints(inputs, ranks, now, intervalMs);
    assert.equal(out.length, 2);
    assert.deepEqual(out.map((p) => p.participantId).sort(), ['a', 'c']);
    const a = out.find((p) => p.participantId === 'a')!;
    assert.equal(a.lat, 1);
    assert.equal(a.lon, 2);
    assert.equal(a.rank, 2);
    assert.equal(a.tsMs, now);
  });

  it('forces a checkpoint when forceFor includes the participant id', () => {
    const now = 100_000_000;
    const intervalMs = 60 * 60_000;
    const inputs = [
      { participantId: 'a', lat: 1, lon: 2, lastCheckpointTs: now - 5_000 },
    ];
    const out = enqueueCheckpoints(inputs, new Map([['a', 1]]), now, intervalMs, new Set(['a']));
    assert.equal(out.length, 1);
  });

  it('skips participants without a known rank', () => {
    const now = 100_000_000;
    const intervalMs = 60 * 60_000;
    const inputs = [
      { participantId: 'a', lat: 1, lon: 2, lastCheckpointTs: null },
      { participantId: 'b', lat: 3, lon: 4, lastCheckpointTs: null },
    ];
    const ranks = new Map([['a', 1]]); // b has no rank
    const out = enqueueCheckpoints(inputs, ranks, now, intervalMs);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.participantId, 'a');
  });
});
