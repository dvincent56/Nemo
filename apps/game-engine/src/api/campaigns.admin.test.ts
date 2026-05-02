import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { and, eq, isNotNull } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { campaigns, adminActions } from '../db/schema.js';
import { createTestPlayer, cleanupTestPlayers } from '../test/db-fixtures.js';
import { registerCampaignAdminRoutes } from './campaigns.admin.js';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(cookie);
  registerCampaignAdminRoutes(app);
  await app.ready();
  return app;
}

function tokenFor(sub: string): string { return `dev.${sub}.${sub}`; }

describe('admin campaigns endpoints', () => {
  const createdIds: string[] = [];
  let app: FastifyInstance;
  let adminToken: string;
  let nonAdminToken: string;
  let testAdminId: string;

  before(async () => {
    const db = getDb()!;
    const adminId = await createTestPlayer(db, { isAdmin: true });
    const userId = await createTestPlayer(db, { isAdmin: false });
    createdIds.push(adminId, userId);
    testAdminId = adminId;
    const adminSub = (await db.query.players.findFirst({ where: (p, { eq }) => eq(p.id, adminId) }))!.cognitoSub;
    const userSub = (await db.query.players.findFirst({ where: (p, { eq }) => eq(p.id, userId) }))!.cognitoSub;
    adminToken = tokenFor(adminSub);
    nonAdminToken = tokenFor(userSub);
    app = await buildApp();
  });
  after(async () => { await app.close(); await cleanupTestPlayers(getDb()!, createdIds); });

  it('POST /admin/campaigns — non-admin → 403', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/admin/campaigns',
      headers: { authorization: `Bearer ${nonAdminToken}` },
      payload: { type: 'CREDITS', creditsAmount: 500, audience: 'SUBSCRIBERS', expiresAt: new Date(Date.now() + 86400000).toISOString(), messageTitle: 'T', messageBody: 'B' },
    });
    assert.equal(res.statusCode, 403);
  });

  it('POST /admin/campaigns — invalid payload (TRIAL with audience=SUBSCRIBERS) → 400', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/admin/campaigns',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { type: 'TRIAL', trialDays: 30, audience: 'SUBSCRIBERS', expiresAt: new Date(Date.now() + 86400000).toISOString(), messageTitle: 'T', messageBody: 'B' },
    });
    assert.equal(res.statusCode, 400);
  });

  it('POST /admin/campaigns — CREDITS happy path → 201, returns campaign, logs admin_actions', async () => {
    const db = getDb()!;
    const res = await app.inject({
      method: 'POST', url: '/api/v1/admin/campaigns',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        type: 'CREDITS', creditsAmount: 500, audience: 'SUBSCRIBERS',
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        messageTitle: '500 crédits offerts', messageBody: 'Pour le départ Vendée',
      },
    });
    assert.equal(res.statusCode, 201);
    const body = JSON.parse(res.body);
    assert.ok(body.id);
    assert.equal(body.type, 'CREDITS');

    const inDb = await db.select().from(campaigns).where(eq(campaigns.id, body.id));
    assert.equal(inDb.length, 1);

    const audit = await db.select().from(adminActions).where(eq(adminActions.actionType, 'CAMPAIGN_CREATED'));
    assert.ok(audit.some((a) => a.targetId === body.id), 'audit entry created');
  });

  it('GET /admin/campaigns — returns active campaigns by default', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/v1/admin/campaigns',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(Array.isArray(body.campaigns));
  });

  it('GET /admin/campaigns/:id — returns campaign + claim stats', async () => {
    const db = getDb()!;
    const adminId = (await db.select().from(adminActions).where(eq(adminActions.adminId, testAdminId)).limit(1))[0]?.adminId;
    assert.ok(adminId, 'sanity check — should have at least one admin action');
    const camp = (await db.select().from(campaigns).where(eq(campaigns.createdByAdminId, testAdminId)).limit(1))[0]!;
    const res = await app.inject({
      method: 'GET', url: `/api/v1/admin/campaigns/${camp.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.id, camp.id);
    assert.equal(typeof body.stats.totalClaims, 'number');
  });

  it('POST /admin/campaigns/:id/cancel — sets cancelled_at + logs admin action', async () => {
    const db = getDb()!;
    const camp = (await db.select().from(campaigns).where(eq(campaigns.createdByAdminId, testAdminId)).limit(1))[0]!;
    const res = await app.inject({
      method: 'POST', url: `/api/v1/admin/campaigns/${camp.id}/cancel`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.statusCode, 200);
    const after = (await db.select().from(campaigns).where(eq(campaigns.id, camp.id)))[0]!;
    assert.notEqual(after.cancelledAt, null);

    const audit = await db.select().from(adminActions).where(eq(adminActions.actionType, 'CAMPAIGN_CANCELLED'));
    assert.ok(audit.some((a) => a.targetId === camp.id));
  });

  it('POST /admin/campaigns/:id/cancel — second cancel is idempotent', async () => {
    const db = getDb()!;
    const camp = (await db.select().from(campaigns).where(and(eq(campaigns.createdByAdminId, testAdminId), isNotNull(campaigns.cancelledAt))).limit(1))[0]!;
    const res = await app.inject({
      method: 'POST', url: `/api/v1/admin/campaigns/${camp.id}/cancel`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.statusCode, 200);
  });
});
