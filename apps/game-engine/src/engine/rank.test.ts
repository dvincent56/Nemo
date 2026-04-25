import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeRanks } from './rank.js';

describe('computeRanks', () => {
  it('ranks participants by ascending DTF (1 = closest to finish)', () => {
    const ranks = computeRanks([
      { participantId: 'a', dtfNm: 50 },
      { participantId: 'b', dtfNm: 10 },
      { participantId: 'c', dtfNm: 100 },
    ]);
    assert.equal(ranks.get('b'), 1);
    assert.equal(ranks.get('a'), 2);
    assert.equal(ranks.get('c'), 3);
  });

  it('handles a single participant', () => {
    const ranks = computeRanks([{ participantId: 'solo', dtfNm: 42 }]);
    assert.equal(ranks.get('solo'), 1);
  });

  it('handles ties deterministically by participantId asc', () => {
    const ranks = computeRanks([
      { participantId: 'b', dtfNm: 50 },
      { participantId: 'a', dtfNm: 50 },
    ]);
    assert.equal(ranks.get('a'), 1);
    assert.equal(ranks.get('b'), 2);
  });

  it('returns empty map on empty input', () => {
    const ranks = computeRanks([]);
    assert.equal(ranks.size, 0);
  });
});
