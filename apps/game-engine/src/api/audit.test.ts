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
