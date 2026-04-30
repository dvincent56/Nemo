import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { OrderZ, OrderTriggerZ } from './orders.zod.js';

describe('OrderTriggerZ', () => {
  it('accepts IMMEDIATE', () => {
    assert.equal(OrderTriggerZ.safeParse({ type: 'IMMEDIATE' }).success, true);
  });
  it('accepts AT_TIME with numeric time', () => {
    assert.equal(OrderTriggerZ.safeParse({ type: 'AT_TIME', time: 1700000000 }).success, true);
  });
  it('rejects AT_TIME without time', () => {
    assert.equal(OrderTriggerZ.safeParse({ type: 'AT_TIME' }).success, false);
  });
  it('rejects unknown trigger type', () => {
    assert.equal(OrderTriggerZ.safeParse({ type: 'NUKE' }).success, false);
  });
});

describe('OrderZ', () => {
  it('accepts a CAP order with numeric heading value', () => {
    const r = OrderZ.safeParse({
      id: 'o1', type: 'CAP', trigger: { type: 'IMMEDIATE' },
      value: { heading: 180 },
    });
    assert.equal(r.success, true);
  });
  it('rejects unknown order type', () => {
    const r = OrderZ.safeParse({
      id: 'o1', type: 'TROLL', trigger: { type: 'IMMEDIATE' }, value: {},
    });
    assert.equal(r.success, false);
  });
  it('rejects oversize value blob (>2KB)', () => {
    const huge = { junk: 'x'.repeat(3000) };
    const r = OrderZ.safeParse({
      id: 'o1', type: 'CAP', trigger: { type: 'IMMEDIATE' }, value: huge,
    });
    assert.equal(r.success, false);
  });
});
