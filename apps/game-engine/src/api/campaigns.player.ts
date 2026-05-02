import type { FastifyInstance } from 'fastify';
import { and, desc, eq, gt, isNull, notInArray } from 'drizzle-orm';
import { enforceAuth } from '../auth/cognito.js';
import { getDb } from '../db/client.js';
import { campaigns, campaignClaims, players } from '../db/schema.js';
import { isCareer } from './campaigns.helpers.js';
import { claimCampaign, type ClaimStatus } from './campaigns.service.js';

const STATUS_TO_HTTP: Record<ClaimStatus, number> = {
  granted:          200,
  already_claimed:  200, // idempotent
  forbidden:        403,
  expired:          409,
  cancelled:        409,
  not_found:        404,
  invalid_audience: 400,
};

export function registerCampaignPlayerRoutes(app: FastifyInstance): void {
  const guards = { preHandler: [enforceAuth] };

  app.get('/api/v1/campaigns/eligible', guards, async (req, reply) => {
    const db = getDb()!;
    const player = (await db.select().from(players).where(eq(players.cognitoSub, req.auth!.sub)))[0];
    if (!player) { reply.code(404); return { error: 'player not found' }; }

    if (!isCareer({ tier: player.tier, trialUntil: player.trialUntil })) {
      // Only SUBSCRIBERS campaigns are claimable; FREE without trial sees nothing
      return { campaigns: [] };
    }

    // Subquery: campaigns this player has already claimed
    const claimed = await db.select({ campaignId: campaignClaims.campaignId })
      .from(campaignClaims).where(eq(campaignClaims.playerId, player.id));
    const claimedIds = claimed.map((c) => c.campaignId);

    const baseWhere = and(
      eq(campaigns.audience, 'SUBSCRIBERS'),
      isNull(campaigns.cancelledAt),
      gt(campaigns.expiresAt, new Date()),
    );
    const where = claimedIds.length > 0
      ? and(baseWhere, notInArray(campaigns.id, claimedIds))
      : baseWhere;

    const rows = await db.select().from(campaigns).where(where).orderBy(desc(campaigns.createdAt)).limit(50);
    return { campaigns: rows };
  });

  app.post<{ Params: { id: string } }>('/api/v1/campaigns/:id/claim', guards, async (req, reply) => {
    const db = getDb()!;
    const player = (await db.select().from(players).where(eq(players.cognitoSub, req.auth!.sub)))[0];
    if (!player) { reply.code(404); return { error: 'player not found' }; }

    const result = await claimCampaign(db, { campaignId: req.params.id, playerId: player.id });
    reply.code(STATUS_TO_HTTP[result.status]);
    return result;
  });
}
