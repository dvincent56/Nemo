import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { getDb } from '../db/client.js';
import { createTestPlayer, createTestCampaign, cleanupTestPlayers } from './db-fixtures.js';

describe('db-fixtures', () => {
  const createdIds: string[] = [];
  after(async () => { await cleanupTestPlayers(getDb()!, createdIds); });

  it('creates a default test player and a default test campaign', async () => {
    const db = getDb()!;
    const adminId = await createTestPlayer(db, { isAdmin: true });
    createdIds.push(adminId);
    const campId = await createTestCampaign(db, { type: 'CREDITS', createdByAdminId: adminId });
    assert.equal(typeof campId, 'string');
    assert.equal(campId.length, 36); // uuid v4
  });
});
