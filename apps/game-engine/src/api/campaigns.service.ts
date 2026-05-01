import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import pino from 'pino';
import type { DbClient } from '../db/client.js';
import { campaigns, campaignClaims, notifications, players } from '../db/schema.js';

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
  try {
    const active = await db.select().from(campaigns).where(
      and(
        eq(campaigns.type, 'TRIAL'),
        eq(campaigns.audience, 'NEW_SIGNUPS'),
        isNull(campaigns.cancelledAt),
        gt(campaigns.expiresAt, new Date()),
      ),
    );

    for (const c of active) {
      await db.transaction(async (tx) => {
        try {
          await tx.insert(campaignClaims).values({
            campaignId: c.id,
            playerId: newPlayerId,
          });
        } catch (err) {
          // Duplicate key (player already received this campaign) — skip silently.
          if (isUniqueViolation(err)) return;
          throw err;
        }

        // Monotonic trial extension
        await tx.update(players).set({
          trialUntil: sql`greatest(coalesce(${players.trialUntil}, now()), now() + (${c.trialDays} || ' days')::interval)`,
        }).where(eq(players.id, newPlayerId));

        await tx.insert(notifications).values({
          playerId: newPlayerId,
          type: 'TRIAL_GRANTED',
          payload: {
            campaign_id: c.id,
            trial_days: c.trialDays,
            expires_at: new Date(Date.now() + (c.trialDays! * 24 * 3600 * 1000)).toISOString(),
            message_title: c.messageTitle,
            message_body: c.messageBody,
          },
        });
      });
    }
  } catch (err) {
    log.error({ err, newPlayerId }, 'grantTrialIfEligible failed — signup will continue without trial');
  }
}

function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const code = (err as { code?: string }).code;
  return code === '23505'; // PostgreSQL unique_violation
}
