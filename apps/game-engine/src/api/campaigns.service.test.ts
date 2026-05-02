import { describe, it, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq } from 'drizzle-orm';
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

import { playerUpgrades } from '../db/schema.js';
import { claimCampaign, type ClaimResult } from './campaigns.service.js';

describe('claimCampaign', () => {
  const createdIds: string[] = [];
  // afterEach + after: per-test cleanup avoids leakage between tests since
  // claimCampaign / eligibility queries are global. Same pattern as the
  // grantTrialIfEligible suite earlier in this file.
  afterEach(async () => {
    await cleanupTestPlayers(getDb()!, createdIds);
    createdIds.length = 0;
  });
  after(async () => { await cleanupTestPlayers(getDb()!, createdIds); });

  async function setup() {
    const db = getDb()!;
    const adminId = await createTestPlayer(db, { isAdmin: true });
    const subscriberId = await createTestPlayer(db, { tier: 'CAREER', credits: 1000 });
    const freeId = await createTestPlayer(db, { tier: 'FREE', credits: 1000 });
    createdIds.push(adminId, subscriberId, freeId);
    return { db, adminId, subscriberId, freeId };
  }

  it('CREDITS happy path — credits added, claim row created', async () => {
    const { db, adminId, subscriberId } = await setup();
    const campaignId = await createTestCampaign(db, {
      type: 'CREDITS', creditsAmount: 500, createdByAdminId: adminId,
    });

    const result: ClaimResult = await claimCampaign(db, { campaignId, playerId: subscriberId });

    assert.equal(result.status, 'granted');
    const player = (await db.select().from(players).where(eq(players.id, subscriberId)))[0]!;
    assert.equal(player.credits, 1500);
    const claims = await db.select().from(campaignClaims)
      .where(and(eq(campaignClaims.campaignId, campaignId), eq(campaignClaims.playerId, subscriberId)));
    assert.equal(claims.length, 1);
  });

  it('UPGRADE happy path — upgrade inserted with source=GIFT', async () => {
    const { db, adminId, subscriberId } = await setup();
    const campaignId = await createTestCampaign(db, {
      type: 'UPGRADE', upgradeCatalogId: 'foils-class40-c', createdByAdminId: adminId,
    });

    const result = await claimCampaign(db, { campaignId, playerId: subscriberId });

    assert.equal(result.status, 'granted');
    const upgrades = await db.select().from(playerUpgrades).where(eq(playerUpgrades.playerId, subscriberId));
    assert.equal(upgrades.length, 1);
    assert.equal(upgrades[0]!.upgradeCatalogId, 'foils-class40-c');
    assert.equal(upgrades[0]!.acquisitionSource, 'GIFT');
  });

  it('idempotent — second claim returns "already_claimed" without side effect', async () => {
    const { db, adminId, subscriberId } = await setup();
    const campaignId = await createTestCampaign(db, {
      type: 'CREDITS', creditsAmount: 500, createdByAdminId: adminId,
    });

    const r1 = await claimCampaign(db, { campaignId, playerId: subscriberId });
    const r2 = await claimCampaign(db, { campaignId, playerId: subscriberId });

    assert.equal(r1.status, 'granted');
    assert.equal(r2.status, 'already_claimed');
    const player = (await db.select().from(players).where(eq(players.id, subscriberId)))[0]!;
    assert.equal(player.credits, 1500, 'credits incremented exactly once');
  });

  it('rejects FREE player on SUBSCRIBERS audience', async () => {
    const { db, adminId, freeId } = await setup();
    const campaignId = await createTestCampaign(db, {
      type: 'CREDITS', creditsAmount: 500, createdByAdminId: adminId,
    });

    const result = await claimCampaign(db, { campaignId, playerId: freeId });
    assert.equal(result.status, 'forbidden');
    const player = (await db.select().from(players).where(eq(players.id, freeId)))[0]!;
    assert.equal(player.credits, 1000, 'credits unchanged');
  });

  it('accepts FREE player with active trial on SUBSCRIBERS audience', async () => {
    const { db, adminId } = await setup();
    const trialId = await createTestPlayer(db, {
      tier: 'FREE',
      trialUntil: new Date(Date.now() + 24 * 3600 * 1000),
      credits: 0,
    });
    createdIds.push(trialId);
    const campaignId = await createTestCampaign(db, {
      type: 'CREDITS', creditsAmount: 500, createdByAdminId: adminId,
    });

    const result = await claimCampaign(db, { campaignId, playerId: trialId });
    assert.equal(result.status, 'granted');
  });

  it('rejects expired campaign', async () => {
    const { db, adminId, subscriberId } = await setup();
    const campaignId = await createTestCampaign(db, {
      type: 'CREDITS', creditsAmount: 500, createdByAdminId: adminId,
      expiresAt: new Date(Date.now() - 1000),
    });

    const result = await claimCampaign(db, { campaignId, playerId: subscriberId });
    assert.equal(result.status, 'expired');
  });

  it('rejects cancelled campaign', async () => {
    const { db, adminId, subscriberId } = await setup();
    const campaignId = await createTestCampaign(db, {
      type: 'CREDITS', creditsAmount: 500, createdByAdminId: adminId, cancelled: true,
    });

    const result = await claimCampaign(db, { campaignId, playerId: subscriberId });
    assert.equal(result.status, 'cancelled');
  });

  it('returns "not_found" for unknown campaign id', async () => {
    const { db, subscriberId } = await setup();
    const result = await claimCampaign(db, {
      campaignId: '00000000-0000-0000-0000-000000000000',
      playerId: subscriberId,
    });
    assert.equal(result.status, 'not_found');
  });

  it('marks the matching GIFT_AVAILABLE notification as read', async () => {
    const { db, adminId, subscriberId } = await setup();
    const campaignId = await createTestCampaign(db, {
      type: 'CREDITS', creditsAmount: 500, createdByAdminId: adminId,
    });
    // Pre-seed a GIFT_AVAILABLE notif for this player + campaign
    await db.insert(notifications).values({
      playerId: subscriberId,
      type: 'GIFT_AVAILABLE',
      payload: { campaign_id: campaignId, message_title: 'x', message_body: 'y' },
    });

    await claimCampaign(db, { campaignId, playerId: subscriberId });

    const notifs = await db.select().from(notifications).where(eq(notifications.playerId, subscriberId));
    assert.equal(notifs.length, 1);
    assert.notEqual(notifs[0]!.readAt, null, 'notif should be marked read');
  });
});

import { pushGiftAvailableSnapshot } from './campaigns.service.js';

describe('pushGiftAvailableSnapshot', () => {
  const createdIds: string[] = [];
  afterEach(async () => {
    await cleanupTestPlayers(getDb()!, createdIds);
    createdIds.length = 0;
  });
  after(async () => { await cleanupTestPlayers(getDb()!, createdIds); });

  it('inserts a notification for every current CAREER player and every active trial', async () => {
    const db = getDb()!;
    const adminId = await createTestPlayer(db, { isAdmin: true });
    const careerId = await createTestPlayer(db, { tier: 'CAREER' });
    const trialId = await createTestPlayer(db, {
      tier: 'FREE',
      trialUntil: new Date(Date.now() + 24 * 3600 * 1000),
    });
    const freeId = await createTestPlayer(db, { tier: 'FREE' });
    createdIds.push(adminId, careerId, trialId, freeId);

    const campaignId = await createTestCampaign(db, {
      type: 'CREDITS', creditsAmount: 500, createdByAdminId: adminId,
    });

    const count = await pushGiftAvailableSnapshot(db, campaignId);
    assert.equal(count >= 2, true, 'at least careerId and trialId received a notif');

    const careerNotifs = await db.select().from(notifications).where(eq(notifications.playerId, careerId));
    const trialNotifs = await db.select().from(notifications).where(eq(notifications.playerId, trialId));
    const freeNotifs = await db.select().from(notifications).where(eq(notifications.playerId, freeId));

    assert.equal(careerNotifs.length, 1);
    assert.equal(careerNotifs[0]!.type, 'GIFT_AVAILABLE');
    assert.equal(trialNotifs.length, 1, 'active trial = subscriber for snapshot purposes');
    assert.equal(freeNotifs.length, 0, 'FREE without trial does not receive snapshot');
  });
});
