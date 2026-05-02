import type { FastifyInstance } from 'fastify';
import { and, count, desc, eq, isNull, asc, sql } from 'drizzle-orm';
import { enforceAuth } from '../auth/cognito.js';
import { getDb } from '../db/client.js';
import { notifications, players } from '../db/schema.js';

export function registerNotificationRoutes(app: FastifyInstance): void {
  const guards = { preHandler: [enforceAuth] };

  app.get<{ Querystring: { limit?: number } }>('/api/v1/notifications', {
    ...guards,
    schema: {
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const db = getDb()!;
    const player = (await db.select({ id: players.id }).from(players)
      .where(eq(players.cognitoSub, req.auth!.sub)))[0];
    if (!player) { reply.code(404); return { error: 'player not found' }; }

    const limit = req.query.limit ?? 50;
    // Unread first (read_at IS NULL), then by created_at DESC
    const rows = await db.select().from(notifications)
      .where(eq(notifications.playerId, player.id))
      .orderBy(asc(sql`${notifications.readAt} IS NOT NULL`), desc(notifications.createdAt))
      .limit(limit);
    return { notifications: rows };
  });

  app.get('/api/v1/notifications/unread-count', guards, async (req, reply) => {
    const db = getDb()!;
    const player = (await db.select({ id: players.id }).from(players)
      .where(eq(players.cognitoSub, req.auth!.sub)))[0];
    if (!player) { reply.code(404); return { error: 'player not found' }; }

    const [aggRow] = await db.select({ unread: count() }).from(notifications)
      .where(and(eq(notifications.playerId, player.id), isNull(notifications.readAt)));
    return { unread: Number(aggRow?.unread ?? 0) };
  });

  app.post<{ Params: { id: string } }>('/api/v1/notifications/:id/read', guards, async (req, reply) => {
    const db = getDb()!;
    const player = (await db.select({ id: players.id }).from(players)
      .where(eq(players.cognitoSub, req.auth!.sub)))[0];
    if (!player) { reply.code(404); return { error: 'player not found' }; }

    const result = await db.update(notifications).set({ readAt: new Date() })
      .where(and(eq(notifications.id, req.params.id), eq(notifications.playerId, player.id)))
      .returning({ id: notifications.id });
    if (result.length === 0) { reply.code(404); return { error: 'notification not found' }; }
    return { ok: true };
  });
}
