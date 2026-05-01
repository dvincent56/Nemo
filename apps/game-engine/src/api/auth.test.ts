import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { registerAuthRoutes } from './auth.js';

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(cookie);
  registerAuthRoutes(app);
  return app;
}

describe('POST /api/v1/auth/dev-login', () => {
  it('returns 404 when NEMO_ALLOW_DEV_AUTH is unset', async () => {
    const prev = process.env['NEMO_ALLOW_DEV_AUTH'];
    delete process.env['NEMO_ALLOW_DEV_AUTH'];
    const app = await buildApp();
    try {
      const res = await app.inject({ method: 'POST', url: '/api/v1/auth/dev-login', payload: { username: 'alice' } });
      assert.equal(res.statusCode, 404);
    } finally {
      await app.close();
      if (prev === undefined) delete process.env['NEMO_ALLOW_DEV_AUTH'];
      else process.env['NEMO_ALLOW_DEV_AUTH'] = prev;
    }
  });

  it('returns 200 with token when NEMO_ALLOW_DEV_AUTH=1', async () => {
    const prev = process.env['NEMO_ALLOW_DEV_AUTH'];
    process.env['NEMO_ALLOW_DEV_AUTH'] = '1';
    const app = await buildApp();
    try {
      const res = await app.inject({ method: 'POST', url: '/api/v1/auth/dev-login', payload: { username: 'alice' } });
      assert.equal(res.statusCode, 200);
      const body = res.json() as { token: string; username: string };
      assert.equal(body.username, 'alice');
      assert.match(body.token, /^dev\./);
    } finally {
      await app.close();
      if (prev === undefined) delete process.env['NEMO_ALLOW_DEV_AUTH'];
      else process.env['NEMO_ALLOW_DEV_AUTH'] = prev;
    }
  });
});
