import { randomUUID } from 'node:crypto';
import { inArray } from 'drizzle-orm';
import { type DbClient } from '../db/client.js';
import {
  players,
  campaigns,
  campaignClaims,
  notifications,
  adminActions,
} from '../db/schema.js';

/** Per-test unique suffix to avoid cognito_sub / username / email collisions. */
export function uniqSuffix(): string {
  return randomUUID().replace(/-/g, '').slice(0, 12);
}

export interface TestPlayerOpts {
  tier?: 'FREE' | 'CAREER';
  isAdmin?: boolean;
  trialUntil?: Date | null;
  credits?: number;
}

export async function createTestPlayer(db: DbClient, opts: TestPlayerOpts = {}): Promise<string> {
  const sfx = uniqSuffix();
  const [row] = await db.insert(players).values({
    cognitoSub: `test-${sfx}`,
    username: `test_${sfx}`,
    email: `test-${sfx}@nemo.test`,
    tier: opts.tier ?? 'FREE',
    isAdmin: opts.isAdmin ?? false,
    trialUntil: opts.trialUntil ?? null,
    credits: opts.credits ?? 0,
  }).returning();
  return row!.id;
}

export interface TestCampaignOpts {
  type: 'CREDITS' | 'UPGRADE' | 'TRIAL';
  audience?: 'SUBSCRIBERS' | 'NEW_SIGNUPS';
  creditsAmount?: number;
  upgradeCatalogId?: string;
  trialDays?: number;
  expiresAt?: Date;
  cancelled?: boolean;
  createdByAdminId: string;
  messageTitle?: string;
  messageBody?: string;
}

export async function createTestCampaign(db: DbClient, opts: TestCampaignOpts): Promise<string> {
  const audience = opts.audience ?? (opts.type === 'TRIAL' ? 'NEW_SIGNUPS' : 'SUBSCRIBERS');
  const [row] = await db.insert(campaigns).values({
    type: opts.type,
    audience,
    creditsAmount: opts.type === 'CREDITS' ? (opts.creditsAmount ?? 100) : null,
    upgradeCatalogId: opts.type === 'UPGRADE' ? (opts.upgradeCatalogId ?? 'foils-class40-c') : null,
    trialDays: opts.type === 'TRIAL' ? (opts.trialDays ?? 30) : null,
    expiresAt: opts.expiresAt ?? new Date(Date.now() + 7 * 24 * 3600 * 1000),
    messageTitle: opts.messageTitle ?? 'Test gift',
    messageBody: opts.messageBody ?? 'Test gift description',
    createdByAdminId: opts.createdByAdminId,
    cancelledAt: opts.cancelled ? new Date() : null,
  }).returning();
  return row!.id;
}

/** Cleanup all rows tied to the given player ids, in dependency order. */
export async function cleanupTestPlayers(db: DbClient, playerIds: string[]): Promise<void> {
  if (playerIds.length === 0) return;
  await db.delete(notifications).where(inArray(notifications.playerId, playerIds));
  await db.delete(campaignClaims).where(inArray(campaignClaims.playerId, playerIds));
  await db.delete(adminActions).where(inArray(adminActions.adminId, playerIds));
  // Campaigns FK on createdByAdminId is RESTRICT — must delete campaigns first
  await db.delete(campaigns).where(inArray(campaigns.createdByAdminId, playerIds));
  await db.delete(players).where(inArray(players.id, playerIds));
}
