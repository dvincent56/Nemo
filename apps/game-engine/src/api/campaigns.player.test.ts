import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { players } from '../db/schema.js';
import { createTestPlayer, createTestCampaign, cleanupTestPlayers } from '../test/db-fixtures.js';
import { registerCampaignPlayerRoutes } from './campaigns.player.js';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(cookie);
  registerCampaignPlayerRoutes(app);
  await app.ready();
  return app;
}

function tokenFor(sub: string): string { return `dev.${sub}.${sub}`; }

describe('player campaigns endpoints', () => {
  const createdIds: string[] = [];
  after(async () => { await cleanupTestPlayers(getDb()!, createdIds); });

  it('GET /campaigns/eligible — lists active SUBSCRIBERS campaigns not yet claimed', async () => {
    const db = getDb()!;
    const adminId = await createTestPlayer(db, { isAdmin: true });
    const subId = await createTestPlayer(db, { tier: 'CAREER' });
    createdIds.push(adminId, subId);

    const c1 = await createTestCampaign(db, { type: 'CREDITS', creditsAmount: 100, createdByAdminId: adminId });
    await createTestCampaign(db, { type: 'CREDITS', creditsAmount: 200, createdByAdminId: adminId, cancelled: true });

    const sub = (await db.select().from(players).where(eq(players.id, subId)))[0]!.cognitoSub;
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET', url: '/api/v1/campaigns/eligible',
      headers: { authorization: `Bearer ${tokenFor(sub)}` },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    const ids: string[] = body.campaigns.map((c: { id: string }) => c.id);
    assert.ok(ids.includes(c1));
    await app.close();
  });

  it('GET /campaigns/eligible — FREE without trial sees nothing', async () => {
    const db = getDb()!;
    const adminId = await createTestPlayer(db, { isAdmin: true });
    const freeId = await createTestPlayer(db, { tier: 'FREE' });
    createdIds.push(adminId, freeId);

    await createTestCampaign(db, { type: 'CREDITS', creditsAmount: 100, createdByAdminId: adminId });

    const sub = (await db.select().from(players).where(eq(players.id, freeId)))[0]!.cognitoSub;
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET', url: '/api/v1/campaigns/eligible',
      headers: { authorization: `Bearer ${tokenFor(sub)}` },
    });
    const body = JSON.parse(res.body);
    assert.equal(body.campaigns.length, 0);
    await app.close();
  });

  it('POST /campaigns/:id/claim — happy path → 200, credits granted', async () => {
    const db = getDb()!;
    const adminId = await createTestPlayer(db, { isAdmin: true });
    const subId = await createTestPlayer(db, { tier: 'CAREER', credits: 0 });
    createdIds.push(adminId, subId);
    const campId = await createTestCampaign(db, { type: 'CREDITS', creditsAmount: 500, createdByAdminId: adminId });

    const sub = (await db.select().from(players).where(eq(players.id, subId)))[0]!.cognitoSub;
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: `/api/v1/campaigns/${campId}/claim`,
      headers: { authorization: `Bearer ${tokenFor(sub)}` },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.status, 'granted');

    const player = (await db.select().from(players).where(eq(players.id, subId)))[0]!;
    assert.equal(player.credits, 500);
    await app.close();
  });

  it('POST /campaigns/:id/claim — second claim → 200 with status=already_claimed (idempotent)', async () => {
    const db = getDb()!;
    const adminId = await createTestPlayer(db, { isAdmin: true });
    const subId = await createTestPlayer(db, { tier: 'CAREER', credits: 0 });
    createdIds.push(adminId, subId);
    const campId = await createTestCampaign(db, { type: 'CREDITS', creditsAmount: 500, createdByAdminId: adminId });
    const sub = (await db.select().from(players).where(eq(players.id, subId)))[0]!.cognitoSub;

    const app = await buildApp();
    await app.inject({
      method: 'POST', url: `/api/v1/campaigns/${campId}/claim`,
      headers: { authorization: `Bearer ${tokenFor(sub)}` },
    });
    const res = await app.inject({
      method: 'POST', url: `/api/v1/campaigns/${campId}/claim`,
      headers: { authorization: `Bearer ${tokenFor(sub)}` },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(res.body).status, 'already_claimed');
    const player = (await db.select().from(players).where(eq(players.id, subId)))[0]!;
    assert.equal(player.credits, 500, 'credits granted exactly once');
    await app.close();
  });

  it('POST /campaigns/:id/claim — FREE player → 403', async () => {
    const db = getDb()!;
    const adminId = await createTestPlayer(db, { isAdmin: true });
    const freeId = await createTestPlayer(db, { tier: 'FREE' });
    createdIds.push(adminId, freeId);
    const campId = await createTestCampaign(db, { type: 'CREDITS', creditsAmount: 500, createdByAdminId: adminId });
    const sub = (await db.select().from(players).where(eq(players.id, freeId)))[0]!.cognitoSub;

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: `/api/v1/campaigns/${campId}/claim`,
      headers: { authorization: `Bearer ${tokenFor(sub)}` },
    });
    assert.equal(res.statusCode, 403);
    await app.close();
  });

  it('POST /campaigns/:id/claim — uses session player_id, ignores body', async () => {
    const db = getDb()!;
    const adminId = await createTestPlayer(db, { isAdmin: true });
    const subId = await createTestPlayer(db, { tier: 'CAREER', credits: 0 });
    const otherId = await createTestPlayer(db, { tier: 'CAREER', credits: 0 });
    createdIds.push(adminId, subId, otherId);
    const campId = await createTestCampaign(db, { type: 'CREDITS', creditsAmount: 500, createdByAdminId: adminId });
    const sub = (await db.select().from(players).where(eq(players.id, subId)))[0]!.cognitoSub;

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: `/api/v1/campaigns/${campId}/claim`,
      headers: { authorization: `Bearer ${tokenFor(sub)}` },
      payload: { playerId: otherId },
    });
    assert.equal(res.statusCode, 200);
    const sub2 = (await db.select().from(players).where(eq(players.id, subId)))[0]!;
    const other2 = (await db.select().from(players).where(eq(players.id, otherId)))[0]!;
    assert.equal(sub2.credits, 500, 'session player got credits');
    assert.equal(other2.credits, 0, 'forged playerId in body was ignored');
    await app.close();
  });
});
