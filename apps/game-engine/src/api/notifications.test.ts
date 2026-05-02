import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { players, notifications } from '../db/schema.js';
import { createTestPlayer, cleanupTestPlayers } from '../test/db-fixtures.js';
import { registerNotificationRoutes } from './notifications.js';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(cookie);
  registerNotificationRoutes(app);
  await app.ready();
  return app;
}
function tokenFor(sub: string): string { return `dev.${sub}.${sub}`; }

describe('notifications endpoints', () => {
  const createdIds: string[] = [];
  after(async () => { await cleanupTestPlayers(getDb()!, createdIds); });

  async function setup() {
    const db = getDb()!;
    const playerId = await createTestPlayer(db);
    createdIds.push(playerId);
    const sub = (await db.select().from(players).where(eq(players.id, playerId)))[0]!.cognitoSub;
    return { db, playerId, sub };
  }

  it('GET /notifications — returns own notifs only', async () => {
    const { db, playerId, sub } = await setup();
    const otherId = await createTestPlayer(db);
    createdIds.push(otherId);
    await db.insert(notifications).values([
      { playerId, type: 'GIFT_AVAILABLE', payload: { campaign_id: 'x', message_title: 't', message_body: 'b' } },
      { playerId: otherId, type: 'GIFT_AVAILABLE', payload: { campaign_id: 'y', message_title: 'z', message_body: 'w' } },
    ]);

    const app = await buildApp();
    const res = await app.inject({
      method: 'GET', url: '/api/v1/notifications',
      headers: { authorization: `Bearer ${tokenFor(sub)}` },
    });
    const body = JSON.parse(res.body);
    assert.equal(body.notifications.length, 1);
    assert.equal(body.notifications[0].payload.campaign_id, 'x');
    await app.close();
  });

  it('GET /notifications/unread-count — counts only unread', async () => {
    const { db, playerId, sub } = await setup();
    await db.insert(notifications).values([
      { playerId, type: 'GIFT_AVAILABLE', payload: {} },
      { playerId, type: 'GIFT_AVAILABLE', payload: {}, readAt: new Date() },
      { playerId, type: 'TRIAL_GRANTED',  payload: {} },
    ]);

    const app = await buildApp();
    const res = await app.inject({
      method: 'GET', url: '/api/v1/notifications/unread-count',
      headers: { authorization: `Bearer ${tokenFor(sub)}` },
    });
    const body = JSON.parse(res.body);
    assert.equal(body.unread, 2);
    await app.close();
  });

  it('POST /notifications/:id/read — marks own notif as read', async () => {
    const { db, playerId, sub } = await setup();
    const [n] = await db.insert(notifications).values({
      playerId, type: 'GIFT_AVAILABLE', payload: {},
    }).returning();

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: `/api/v1/notifications/${n!.id}/read`,
      headers: { authorization: `Bearer ${tokenFor(sub)}` },
    });
    assert.equal(res.statusCode, 200);
    const stored = (await db.select().from(notifications).where(eq(notifications.id, n!.id)))[0]!;
    assert.notEqual(stored.readAt, null);
    await app.close();
  });

  it('POST /notifications/:id/read — cannot mark someone else’s notif → 404', async () => {
    const { db, sub } = await setup();
    const otherId = await createTestPlayer(db);
    createdIds.push(otherId);
    const [n] = await db.insert(notifications).values({
      playerId: otherId, type: 'GIFT_AVAILABLE', payload: {},
    }).returning();

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: `/api/v1/notifications/${n!.id}/read`,
      headers: { authorization: `Bearer ${tokenFor(sub)}` },
    });
    assert.equal(res.statusCode, 404);
    await app.close();
  });
});
