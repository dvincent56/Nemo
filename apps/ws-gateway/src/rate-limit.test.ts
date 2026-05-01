import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TokenBucket } from './rate-limit.js';

describe('TokenBucket', () => {
  it('allows up to capacity messages immediately', () => {
    const b = new TokenBucket({ capacity: 5, refillPerSec: 1, now: () => 1000 });
    for (let i = 0; i < 5; i++) assert.equal(b.tryConsume(), true);
    assert.equal(b.tryConsume(), false);
  });

  it('refills over time', () => {
    let t = 1000;
    const b = new TokenBucket({ capacity: 5, refillPerSec: 10, now: () => t });
    for (let i = 0; i < 5; i++) b.tryConsume();
    t = 1500; // 500ms later → 5 tokens refilled
    for (let i = 0; i < 5; i++) assert.equal(b.tryConsume(), true);
    assert.equal(b.tryConsume(), false);
  });

  it('does not refill above capacity', () => {
    let t = 1000;
    const b = new TokenBucket({ capacity: 5, refillPerSec: 10, now: () => t });
    t = 10_000; // long delay
    for (let i = 0; i < 5; i++) assert.equal(b.tryConsume(), true);
    assert.equal(b.tryConsume(), false);
  });
});
