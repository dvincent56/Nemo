import { describe, it, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { players, campaignClaims, notifications } from '../db/schema.js';
import {
  createTestPlayer, createTestCampaign, cleanupTestPlayers,
} from '../test/db-fixtures.js';
import { grantTrialIfEligible } from './campaigns.service.js';

describe('grantTrialIfEligible', () => {
  // Per-test cleanup: each test pushes its created player ids here, and we
  // wipe them after every test so prior-test campaigns can't leak into the
  // global TRIAL/NEW_SIGNUPS scan that grantTrialIfEligible performs.
  let createdIds: string[] = [];
  afterEach(async () => {
    await cleanupTestPlayers(getDb()!, createdIds);
    createdIds = [];
  });
  after(async () => { await cleanupTestPlayers(getDb()!, createdIds); });

  it('does nothing when no TRIAL campaign is active', async () => {
    const db = getDb()!;
    const playerId = await createTestPlayer(db);
    createdIds.push(playerId);

    await grantTrialIfEligible(db, playerId);

    const player = (await db.select().from(players).where(eq(players.id, playerId)))[0]!;
    assert.equal(player.trialUntil, null);
    const claims = await db.select().from(campaignClaims).where(eq(campaignClaims.playerId, playerId));
    assert.equal(claims.length, 0);
  });

  it('grants trial_until = now + trial_days and creates a claim + notification', async () => {
    const db = getDb()!;
    const adminId = await createTestPlayer(db, { isAdmin: true });
    const playerId = await createTestPlayer(db);
    createdIds.push(adminId, playerId);

    const campaignId = await createTestCampaign(db, {
      type: 'TRIAL', trialDays: 30, createdByAdminId: adminId,
    });

    const before = Date.now();
    await grantTrialIfEligible(db, playerId);
    const after = Date.now();

    const player = (await db.select().from(players).where(eq(players.id, playerId)))[0]!;
    assert.ok(player.trialUntil, 'trial_until should be set');
    const trialMs = player.trialUntil!.getTime();
    const expectedMin = before + 30 * 24 * 3600 * 1000;
    const expectedMax = after + 30 * 24 * 3600 * 1000;
    assert.ok(trialMs >= expectedMin && trialMs <= expectedMax,
      `trial_until ${trialMs} not within [${expectedMin}, ${expectedMax}]`);

    const claims = await db.select().from(campaignClaims).where(eq(campaignClaims.playerId, playerId));
    assert.equal(claims.length, 1);
    assert.equal(claims[0]!.campaignId, campaignId);

    const notifs = await db.select().from(notifications).where(eq(notifications.playerId, playerId));
    assert.equal(notifs.length, 1);
    assert.equal(notifs[0]!.type, 'TRIAL_GRANTED');
  });

  it('is monotonic — does not shorten an already-active trial', async () => {
    const db = getDb()!;
    const adminId = await createTestPlayer(db, { isAdmin: true });
    const playerId = await createTestPlayer(db);
    createdIds.push(adminId, playerId);

    // Player already has a 60-day trial active
    const longTrial = new Date(Date.now() + 60 * 24 * 3600 * 1000);
    await db.update(players).set({ trialUntil: longTrial }).where(eq(players.id, playerId));

    // A new 7-day TRIAL campaign is created
    await createTestCampaign(db, {
      type: 'TRIAL', trialDays: 7, createdByAdminId: adminId,
    });

    await grantTrialIfEligible(db, playerId);

    const player = (await db.select().from(players).where(eq(players.id, playerId)))[0]!;
    // Trial should remain at 60-day mark, not be shortened to 7
    assert.equal(player.trialUntil!.getTime(), longTrial.getTime());
  });

  it('does not double-grant if the player already claimed this campaign', async () => {
    const db = getDb()!;
    const adminId = await createTestPlayer(db, { isAdmin: true });
    const playerId = await createTestPlayer(db);
    createdIds.push(adminId, playerId);

    await createTestCampaign(db, { type: 'TRIAL', trialDays: 30, createdByAdminId: adminId });

    await grantTrialIfEligible(db, playerId);
    await grantTrialIfEligible(db, playerId); // second call

    const claims = await db.select().from(campaignClaims).where(eq(campaignClaims.playerId, playerId));
    assert.equal(claims.length, 1, 'UNIQUE constraint must prevent double-claim');
    const notifs = await db.select().from(notifications).where(eq(notifications.playerId, playerId));
    assert.equal(notifs.length, 1, 'no duplicate notification');
  });

  it('skips cancelled campaigns', async () => {
    const db = getDb()!;
    const adminId = await createTestPlayer(db, { isAdmin: true });
    const playerId = await createTestPlayer(db);
    createdIds.push(adminId, playerId);

    await createTestCampaign(db, {
      type: 'TRIAL', trialDays: 30, createdByAdminId: adminId, cancelled: true,
    });

    await grantTrialIfEligible(db, playerId);

    const player = (await db.select().from(players).where(eq(players.id, playerId)))[0]!;
    assert.equal(player.trialUntil, null);
  });

  it('skips expired campaigns', async () => {
    const db = getDb()!;
    const adminId = await createTestPlayer(db, { isAdmin: true });
    const playerId = await createTestPlayer(db);
    createdIds.push(adminId, playerId);

    await createTestCampaign(db, {
      type: 'TRIAL', trialDays: 30, createdByAdminId: adminId,
      expiresAt: new Date(Date.now() - 1000),
    });

    await grantTrialIfEligible(db, playerId);

    const player = (await db.select().from(players).where(eq(players.id, playerId)))[0]!;
    assert.equal(player.trialUntil, null);
  });
});
