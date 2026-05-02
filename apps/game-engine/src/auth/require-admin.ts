import type { FastifyReply, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { players } from '../db/schema.js';

/**
 * Fastify preHandler — chained AFTER enforceAuth. Reads is_admin from the DB
 * (NEVER from the JWT) so a stolen or forged token cannot escalate privileges.
 *
 * Use as `{ preHandler: [enforceAuth, requireAdmin] }`.
 */
export async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!req.auth) {
    reply.code(401).send({ error: 'unauthenticated' });
    return;
  }
  const db = getDb();
  if (!db) {
    reply.code(503).send({ error: 'database unavailable' });
    return;
  }
  const rows = await db.select({ isAdmin: players.isAdmin })
    .from(players)
    .where(eq(players.cognitoSub, req.auth.sub));
  const player = rows[0];
  if (!player || !player.isAdmin) {
    reply.code(403).send({ error: 'admin required' });
    return;
  }
}
