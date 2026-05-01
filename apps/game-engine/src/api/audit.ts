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
