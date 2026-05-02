import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { getDb } from '../db/client.js';
import { createTestPlayer, cleanupTestPlayers } from '../test/db-fixtures.js';
import { enforceAuth } from './cognito.js';
import { requireAdmin } from './require-admin.js';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(cookie);
  app.get('/admin-only', { preHandler: [enforceAuth, requireAdmin] }, async () => ({ ok: true }));
  await app.ready();
  return app;
}

describe('requireAdmin', () => {
  const createdIds: string[] = [];
  // NEMO_ALLOW_DEV_AUTH is set globally by test/setup-env.ts.
  after(async () => {
    await cleanupTestPlayers(getDb()!, createdIds);
  });

  it('returns 403 when the authenticated player is not admin', async () => {
    const db = getDb()!;
    const playerId = await createTestPlayer(db, { isAdmin: false });
    createdIds.push(playerId);

    // Dev token format is `dev.<sub>.<username>` — see auth/cognito.ts:53
    const sub = (await db.query.players.findFirst({ where: (p, { eq }) => eq(p.id, playerId) }))!.cognitoSub;
    const token = `dev.${sub}.test`;

    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/admin-only',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(res.statusCode, 403);
    await app.close();
  });

  it('returns 200 when the authenticated player is admin', async () => {
    const db = getDb()!;
    const playerId = await createTestPlayer(db, { isAdmin: true });
    createdIds.push(playerId);
    const sub = (await db.query.players.findFirst({ where: (p, { eq }) => eq(p.id, playerId) }))!.cognitoSub;
    const token = `dev.${sub}.test`;

    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/admin-only',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(res.body), { ok: true });
    await app.close();
  });

  it('returns 401 when not authenticated', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/admin-only' });
    assert.equal(res.statusCode, 401);
    await app.close();
  });
});
