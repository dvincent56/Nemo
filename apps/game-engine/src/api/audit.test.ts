import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { adminActions } from '../db/schema.js';
import { createTestPlayer, cleanupTestPlayers } from '../test/db-fixtures.js';
import { logAdminAction } from './audit.js';

describe('logAdminAction', () => {
  const createdIds: string[] = [];
  after(async () => { await cleanupTestPlayers(getDb()!, createdIds); });

  it('inserts an admin_actions row with the given fields', async () => {
    const db = getDb()!;
    const adminId = await createTestPlayer(db, { isAdmin: true });
    createdIds.push(adminId);

    await logAdminAction(db, {
      adminId,
      actionType: 'CAMPAIGN_CREATED',
      targetType: 'campaign',
      targetId: 'test-campaign-id',
      payload: { type: 'CREDITS', amount: 500 },
    });

    const rows = await db.select().from(adminActions).where(eq(adminActions.adminId, adminId));
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.actionType, 'CAMPAIGN_CREATED');
    assert.equal(rows[0]!.targetType, 'campaign');
    assert.equal(rows[0]!.targetId, 'test-campaign-id');
    assert.deepEqual(rows[0]!.payload, { type: 'CREDITS', amount: 500 });
  });

  it('omits targetType/targetId when not provided', async () => {
    const db = getDb()!;
    const adminId = await createTestPlayer(db, { isAdmin: true });
    createdIds.push(adminId);

    await logAdminAction(db, {
      adminId,
      actionType: 'TEST_NO_TARGET',
      payload: {},
    });

    const rows = await db.select().from(adminActions).where(eq(adminActions.adminId, adminId));
    assert.equal(rows[0]!.targetType, null);
    assert.equal(rows[0]!.targetId, null);
  });
});

import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { registerAuditRoutes } from './audit.js';

async function buildAuditApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(cookie);
  registerAuditRoutes(app);
  await app.ready();
  return app;
}

describe('GET /admin/audit-log', () => {
  const createdIds: string[] = [];
  after(async () => { await cleanupTestPlayers(getDb()!, createdIds); });

  it('returns paginated admin actions, newest first', async () => {
    const db = getDb()!;
    const adminId = await createTestPlayer(db, { isAdmin: true });
    createdIds.push(adminId);

    await logAdminAction(db, { adminId, actionType: 'TEST_ONE', payload: {} });
    await logAdminAction(db, { adminId, actionType: 'TEST_TWO', payload: {} });

    const sub = (await db.query.players.findFirst({ where: (p, { eq }) => eq(p.id, adminId) }))!.cognitoSub;
    const app = await buildAuditApp();
    const res = await app.inject({
      method: 'GET', url: '/api/v1/admin/audit-log',
      headers: { authorization: `Bearer dev.${sub}.x` },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(Array.isArray(body.actions));
    assert.ok(body.actions.length >= 2);
    // newest first
    const first = body.actions[0];
    const second = body.actions[1];
    assert.ok(new Date(first.createdAt).getTime() >= new Date(second.createdAt).getTime());
    await app.close();
  });

  it('rejects non-admin → 403', async () => {
    const db = getDb()!;
    const userId = await createTestPlayer(db, { isAdmin: false });
    createdIds.push(userId);
    const sub = (await db.query.players.findFirst({ where: (p, { eq }) => eq(p.id, userId) }))!.cognitoSub;
    const app = await buildAuditApp();
    const res = await app.inject({
      method: 'GET', url: '/api/v1/admin/audit-log',
      headers: { authorization: `Bearer dev.${sub}.x` },
    });
    assert.equal(res.statusCode, 403);
    await app.close();
  });
});
