import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildEnvelope, CLIENT_TS_TOLERANCE_MS } from './build-envelope.js';

const baseArgs = {
  clientTs: 1_000_000,
  clientSeq: 0,
  connectionId: 'conn_test',
  serverNow: 1_000_000,
};

describe('buildEnvelope', () => {
  it('accepts a valid CAP order', () => {
    const env = buildEnvelope({
      ...baseArgs,
      rawOrder: { type: 'CAP', trigger: { type: 'IMMEDIATE' }, value: { heading: 90 } },
    });
    assert.ok(env);
    assert.equal(env!.order.type, 'CAP');
    assert.equal(env!.connectionId, 'conn_test');
  });

  it('rejects unknown type', () => {
    const env = buildEnvelope({
      ...baseArgs,
      rawOrder: { type: 'NUKE', trigger: { type: 'IMMEDIATE' }, value: {} },
    });
    assert.equal(env, null);
  });

  it('rejects oversize value blob', () => {
    const env = buildEnvelope({
      ...baseArgs,
      rawOrder: { type: 'CAP', trigger: { type: 'IMMEDIATE' }, value: { x: 'a'.repeat(3000) } },
    });
    assert.equal(env, null);
  });

  it('rejects null/non-object payload', () => {
    assert.equal(buildEnvelope({ ...baseArgs, rawOrder: null }), null);
    assert.equal(buildEnvelope({ ...baseArgs, rawOrder: 42 }), null);
    assert.equal(buildEnvelope({ ...baseArgs, rawOrder: 'oops' }), null);
  });

  it('falls back to serverNow when clientTs is too far in the past', () => {
    const env = buildEnvelope({
      ...baseArgs,
      clientTs: baseArgs.serverNow - (CLIENT_TS_TOLERANCE_MS + 1),
      rawOrder: { type: 'CAP', trigger: { type: 'IMMEDIATE' }, value: { heading: 90 } },
    });
    assert.ok(env);
    assert.equal(env!.trustedTs, baseArgs.serverNow);
  });

  it('keeps clientTs when within tolerance', () => {
    const env = buildEnvelope({
      ...baseArgs,
      clientTs: baseArgs.serverNow - 100,
      rawOrder: { type: 'CAP', trigger: { type: 'IMMEDIATE' }, value: { heading: 90 } },
    });
    assert.ok(env);
    assert.equal(env!.trustedTs, baseArgs.serverNow - 100);
  });
});
