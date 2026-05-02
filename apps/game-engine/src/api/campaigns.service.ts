import { and, eq, gt, isNotNull, isNull, or, sql } from 'drizzle-orm';
import pino from 'pino';
import type { DbClient } from '../db/client.js';
import { campaigns, campaignClaims, notifications, players, playerUpgrades } from '../db/schema.js';
import { isCareer } from './campaigns.helpers.js';

const log = pino({ name: 'campaigns.service' });

/**
 * Case 3 — auto-grant of a TRIAL campaign at signup.
 *
 * MUST be called *after* the signup transaction commits, in its own transaction.
 * Failure here is logged but never propagated, so a broken grant never blocks
 * a legitimate signup.
 *
 * Idempotent thanks to the UNIQUE (campaign_id, player_id) constraint on
 * campaign_claims: a duplicate insert raises a UniqueViolation which we treat
 * as a no-op for that campaign.
 *
 * Monotonic: trial_until is set with greatest(now() + trial_days, current),
 * so an already-longer trial is never shortened.
 */
export async function grantTrialIfEligible(db: DbClient, newPlayerId: string): Promise<void> {
  let active;
  try {
    active = await db.select().from(campaigns).where(
      and(
        eq(campaigns.type, 'TRIAL'),
        eq(campaigns.audience, 'NEW_SIGNUPS'),
        isNull(campaigns.cancelledAt),
        gt(campaigns.expiresAt, new Date()),
      ),
    );
  } catch (err) {
    log.error({ err, newPlayerId }, 'grantTrialIfEligible: failed to load active campaigns — signup will continue without trial');
    return;
  }

  for (const c of active) {
    if (c.trialDays === null) {
      // Defense in depth: campaigns_payload_chk guarantees this for type=TRIAL,
      // but a future schema change shouldn't silently corrupt the SQL below.
      log.warn({ campaignId: c.id }, 'grantTrialIfEligible: TRIAL campaign with null trial_days, skipping');
      continue;
    }
    try {
      await db.transaction(async (tx) => {
        await tx.insert(campaignClaims).values({ campaignId: c.id, playerId: newPlayerId });

        // Monotonic trial extension. The UPDATE acquires a row lock and
        // re-evaluates ${players.trialUntil} after the lock, so concurrent
        // grants for the same player resolve to the maximum end date safely
        // under PostgreSQL's default READ COMMITTED isolation.
        await tx.update(players).set({
          trialUntil: sql`greatest(coalesce(${players.trialUntil}, now()), now() + (${c.trialDays} || ' days')::interval)`,
        }).where(eq(players.id, newPlayerId));

        await tx.insert(notifications).values({
          playerId: newPlayerId,
          type: 'TRIAL_GRANTED',
          payload: {
            campaign_id: c.id,
            trial_days: c.trialDays,
            expires_at: new Date(Date.now() + (c.trialDays * 24 * 3600 * 1000)).toISOString(),
            message_title: c.messageTitle,
            message_body: c.messageBody,
          },
        });
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        log.debug({ campaignId: c.id, newPlayerId }, 'grantTrialIfEligible: claim already exists, skipping (idempotent replay)');
        continue;
      }
      log.error({ err, campaignId: c.id, newPlayerId },
        'grantTrialIfEligible: campaign grant failed — signup continues, other campaigns may still grant');
    }
  }
}

function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const code = (err as { code?: string }).code;
  return code === '23505'; // PostgreSQL unique_violation
}

export type ClaimStatus =
  | 'granted'
  | 'already_claimed'
  | 'forbidden'
  | 'expired'
  | 'cancelled'
  | 'not_found'
  | 'invalid_audience';

export interface ClaimResult {
  status: ClaimStatus;
  campaignId: string;
}

export interface ClaimInput {
  campaignId: string;
  playerId: string;
}

/**
 * Cases 1 + 2 — explicit claim of a SUBSCRIBERS campaign.
 *
 * Validates eligibility live (audience, expires_at, cancelled_at) on each
 * call — the UI cannot be trusted. Side effects (credits / upgrade insert)
 * run in the same transaction as the claim row insert.
 *
 * Idempotent: a duplicate claim returns 'already_claimed' (HTTP 200 at the
 * route level) instead of a UniqueViolation error, so retries are safe.
 *
 * Note on transaction semantics under postgres-js: a duplicate-key error
 * inside the transaction body is re-thrown by the wrapper before commit,
 * so we detect it in the OUTER catch (same pattern as grantTrialIfEligible).
 */
export async function claimCampaign(db: DbClient, input: ClaimInput): Promise<ClaimResult> {
  const camp = (await db.select().from(campaigns).where(eq(campaigns.id, input.campaignId)))[0];
  if (!camp) return { status: 'not_found', campaignId: input.campaignId };
  if (camp.cancelledAt) return { status: 'cancelled', campaignId: input.campaignId };
  if (camp.expiresAt.getTime() <= Date.now()) return { status: 'expired', campaignId: input.campaignId };
  if (camp.audience === 'NEW_SIGNUPS') {
    // NEW_SIGNUPS is auto-granted at signup, never claimed
    return { status: 'invalid_audience', campaignId: input.campaignId };
  }

  const player = (await db.select().from(players).where(eq(players.id, input.playerId)))[0];
  if (!player) return { status: 'not_found', campaignId: input.campaignId };
  if (camp.audience === 'SUBSCRIBERS' && !isCareer({ tier: player.tier, trialUntil: player.trialUntil })) {
    return { status: 'forbidden', campaignId: input.campaignId };
  }

  try {
    await db.transaction(async (tx) => {
      await tx.insert(campaignClaims).values({
        campaignId: camp.id,
        playerId: input.playerId,
      });

      switch (camp.type) {
        case 'CREDITS':
          // Non-null assert safe: campaigns_payload_chk enforces creditsAmount IS NOT NULL
          // for type=CREDITS, and the row was just loaded from DB so it satisfies the constraint.
          await tx.update(players).set({
            credits: sql`${players.credits} + ${camp.creditsAmount!}`,
          }).where(eq(players.id, input.playerId));
          break;
        case 'UPGRADE':
          // Non-null assert safe: campaigns_payload_chk enforces upgradeCatalogId IS NOT NULL
          // for type=UPGRADE.
          await tx.insert(playerUpgrades).values({
            playerId: input.playerId,
            upgradeCatalogId: camp.upgradeCatalogId!,
            acquisitionSource: 'GIFT',
            paidCredits: 0,
          });
          break;
        case 'TRIAL':
          // Should be unreachable thanks to the audience CHECK, but guard anyway
          throw new Error('claimCampaign called with TRIAL — should be auto-granted');
      }

      await tx.update(notifications).set({ readAt: new Date() }).where(
        and(
          eq(notifications.playerId, input.playerId),
          eq(notifications.type, 'GIFT_AVAILABLE'),
          sql`${notifications.payload}->>'campaign_id' = ${camp.id}`,
        ),
      );
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { status: 'already_claimed', campaignId: camp.id };
    }
    throw err;
  }

  return { status: 'granted', campaignId: camp.id };
}

/**
 * Snapshot push of GIFT_AVAILABLE notifications to all current "subscribers"
 * (CAREER + active trial) at the moment of campaign creation. Future
 * subscribers (post-creation) discover the campaign via /campaigns/eligible.
 *
 * Returns the number of notifications inserted (for stats / logging).
 *
 * Caller MUST execute this in the same transaction as the campaign creation,
 * exactly once per campaign id, to avoid duplicate GIFT_AVAILABLE notifications.
 *
 * Note: writers MUST use the campaign UUID as a string in payload.campaign_id —
 * the matching read in claimCampaign uses jsonb `->>'campaign_id'` which
 * returns text, so a numeric value would silently fail to match.
 */
export async function pushGiftAvailableSnapshot(db: DbClient, campaignId: string): Promise<number> {
  const camp = (await db.select().from(campaigns).where(eq(campaigns.id, campaignId)))[0];
  if (!camp) throw new Error(`campaign ${campaignId} not found`);
  if (camp.audience !== 'SUBSCRIBERS') {
    throw new Error(`pushGiftAvailableSnapshot called on non-SUBSCRIBERS campaign ${campaignId}`);
  }

  const eligible = await db.select({ id: players.id }).from(players).where(
    or(
      eq(players.tier, 'CAREER'),
      and(isNotNull(players.trialUntil), gt(players.trialUntil, new Date())),
    ),
  );
  if (eligible.length === 0) return 0;

  // TODO(scaling): chunk into batches of ~5k once subscriber count > 20k to
  // stay below PostgreSQL's 65,535 bound-parameter limit per statement
  // (3 columns/row × ~21,800 rows = ceiling). Failure mode is a hard runtime
  // error from the wire protocol, not a gradual slowdown.
  await db.insert(notifications).values(eligible.map((p) => ({
    playerId: p.id,
    type: 'GIFT_AVAILABLE' as const,
    payload: {
      campaign_id: camp.id,
      message_title: camp.messageTitle,
      message_body: camp.messageBody,
    },
  })));
  return eligible.length;
}
