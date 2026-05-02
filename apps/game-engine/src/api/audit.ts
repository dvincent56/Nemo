import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { enforceAuth } from '../auth/cognito.js';
import { requireAdmin } from '../auth/require-admin.js';
import { getDb } from '../db/client.js';
import type { DbClient } from '../db/client.js';
import { adminActions } from '../db/schema.js';

export interface AdminActionInput {
  adminId: string;
  actionType: string;
  targetType?: string;
  targetId?: string;
  payload: Record<string, unknown>;
}

/**
 * Append-only audit log. Never UPDATE or DELETE rows here — cancellations etc.
 * are written as new entries with a different actionType.
 *
 * Intended to be called inside the same transaction as the action it records,
 * so a failed action does not produce a phantom audit entry.
 */
export async function logAdminAction(db: DbClient, input: AdminActionInput): Promise<void> {
  await db.insert(adminActions).values({
    adminId: input.adminId,
    actionType: input.actionType,
    targetType: input.targetType ?? null,
    targetId: input.targetId ?? null,
    payload: input.payload,
  });
}

export function registerAuditRoutes(app: FastifyInstance): void {
  const guards = { preHandler: [enforceAuth, requireAdmin] };

  app.get<{
    Querystring: { adminId?: string; actionType?: string; limit?: number };
  }>('/api/v1/admin/audit-log', {
    ...guards,
    schema: {
      querystring: {
        type: 'object',
        properties: {
          adminId: { type: 'string', format: 'uuid' },
          actionType: { type: 'string', maxLength: 64 },
          limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
        },
        additionalProperties: false,
      },
    },
  }, async (req) => {
    const db = getDb()!;
    const limit = req.query.limit ?? 50; // default also enforced by schema, belt+suspenders
    const conditions = [];
    if (req.query.adminId)    conditions.push(eq(adminActions.adminId, req.query.adminId));
    if (req.query.actionType) conditions.push(eq(adminActions.actionType, req.query.actionType));
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const actions = await db.select().from(adminActions)
      .where(where)
      .orderBy(desc(adminActions.createdAt))
      .limit(limit);
    return { actions };
  });
}
