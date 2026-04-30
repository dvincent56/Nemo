import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { enforceAuth, requireAdmin, verifyAccessToken } from './cognito.js';

function withEnv<T>(env: Record<string, string | undefined>, fn: () => Promise<T> | T): Promise<T> {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) { prev[k] = process.env[k]; }
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  return Promise.resolve(fn()).finally(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });
}

describe('verifyAccessToken', () => {
  it('rejects dev.* token when NEMO_ALLOW_DEV_AUTH is unset', async () => {
    await withEnv(
      { COGNITO_REGION: undefined, COGNITO_USER_POOL_ID: undefined, COGNITO_CLIENT_ID: undefined, NEMO_ALLOW_DEV_AUTH: undefined },
      async () => {
        await assert.rejects(
          () => verifyAccessToken('dev.alice-sub.alice'),
          /dev tokens disabled/,
        );
      },
    );
  });

  it('accepts dev.* token when NEMO_ALLOW_DEV_AUTH=1', async () => {
    await withEnv(
      { COGNITO_REGION: undefined, COGNITO_USER_POOL_ID: undefined, COGNITO_CLIENT_ID: undefined, NEMO_ALLOW_DEV_AUTH: '1' },
      async () => {
        const ctx = await verifyAccessToken('dev.alice-sub.alice');
        assert.equal(ctx.sub, 'alice-sub');
        assert.equal(ctx.username, 'alice');
        assert.equal(ctx.tier, 'FREE');
      },
    );
  });

  it('does not accept dev.* token when COGNITO_* is configured (defense in depth)', async () => {
    await withEnv(
      { COGNITO_REGION: 'eu-west-3', COGNITO_USER_POOL_ID: 'eu-west-3_X', COGNITO_CLIENT_ID: 'cid', NEMO_ALLOW_DEV_AUTH: '1' },
      async () => {
        // With Cognito configured, dev tokens are NEVER accepted, even if flag is set.
        // (Cognito path will try to verify the JWT signature and fail.)
        await assert.rejects(() => verifyAccessToken('dev.alice-sub.alice'));
      },
    );
  });
});

describe('requireAdmin', () => {
  it('returns 403 for a dev token (non-admin by construction)', async () => {
    const prev = process.env['NEMO_ALLOW_DEV_AUTH'];
    process.env['NEMO_ALLOW_DEV_AUTH'] = '1';
    const app = Fastify({ logger: false });
    await app.register(cookie);
    app.get('/admin/ping', { preHandler: [enforceAuth, requireAdmin] }, async () => ({ ok: true }));
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/admin/ping',
        headers: { authorization: 'Bearer dev.alice-sub.alice' },
      });
      assert.equal(res.statusCode, 403);
    } finally {
      await app.close();
      if (prev === undefined) delete process.env['NEMO_ALLOW_DEV_AUTH'];
      else process.env['NEMO_ALLOW_DEV_AUTH'] = prev;
    }
  });
});
