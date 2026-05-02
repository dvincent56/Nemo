import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, count, desc, eq, isNull, gt, lt, isNotNull } from 'drizzle-orm';
import { enforceAuth } from '../auth/cognito.js';
import { requireAdmin } from '../auth/require-admin.js';
import { getDb } from '../db/client.js';
import { campaigns, campaignClaims, players } from '../db/schema.js';
import { logAdminAction } from './audit.js';
import { pushGiftAvailableSnapshot } from './campaigns.service.js';

const CreateCampaignSchema = z.object({
  type: z.enum(['CREDITS', 'UPGRADE', 'TRIAL']),
  creditsAmount: z.number().int().positive().optional(),
  upgradeCatalogId: z.string().optional(),
  trialDays: z.number().int().positive().optional(),
  audience: z.enum(['SUBSCRIBERS', 'NEW_SIGNUPS']),
  expiresAt: z.string().datetime(),
  linkedRaceId: z.string().optional(),
  messageTitle: z.string().min(1).max(100),
  messageBody: z.string().min(1).max(500),
}).refine(
  (d) => (d.type === 'CREDITS' && d.creditsAmount !== undefined && !d.upgradeCatalogId && !d.trialDays)
      || (d.type === 'UPGRADE' && d.upgradeCatalogId !== undefined && !d.creditsAmount && !d.trialDays)
      || (d.type === 'TRIAL'   && d.trialDays !== undefined && !d.creditsAmount && !d.upgradeCatalogId),
  { message: 'Payload field must match type (CREDITS→creditsAmount, UPGRADE→upgradeCatalogId, TRIAL→trialDays)' },
).refine(
  (d) => (d.type === 'TRIAL' && d.audience === 'NEW_SIGNUPS')
      || (d.type !== 'TRIAL' && d.audience === 'SUBSCRIBERS'),
  { message: 'TRIAL must target NEW_SIGNUPS, CREDITS/UPGRADE must target SUBSCRIBERS' },
).refine(
  (d) => new Date(d.expiresAt).getTime() > Date.now(),
  { message: 'expiresAt must be in the future' },
);

export function registerCampaignAdminRoutes(app: FastifyInstance): void {
  const guards = { preHandler: [enforceAuth, requireAdmin] };

  app.post('/api/v1/admin/campaigns', guards, async (req, reply) => {
    const parsed = CreateCampaignSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid payload', issues: parsed.error.issues };
    }
    const db = getDb();
    if (!db) { reply.code(503); return { error: 'database unavailable' }; }

    // Resolve admin id from session sub
    const adminRow = (await db.select().from(players).where(eq(players.cognitoSub, req.auth!.sub)))[0];
    if (!adminRow) { reply.code(403); return { error: 'admin not found' }; }

    const created = await db.transaction(async (tx) => {
      const [row] = await tx.insert(campaigns).values({
        type: parsed.data.type,
        creditsAmount: parsed.data.creditsAmount ?? null,
        upgradeCatalogId: parsed.data.upgradeCatalogId ?? null,
        trialDays: parsed.data.trialDays ?? null,
        audience: parsed.data.audience,
        expiresAt: new Date(parsed.data.expiresAt),
        linkedRaceId: parsed.data.linkedRaceId ?? null,
        messageTitle: parsed.data.messageTitle,
        messageBody: parsed.data.messageBody,
        createdByAdminId: adminRow.id,
      }).returning();

      await logAdminAction(tx, {
        adminId: adminRow.id,
        actionType: 'CAMPAIGN_CREATED',
        targetType: 'campaign',
        targetId: row!.id,
        payload: { type: row!.type, audience: row!.audience },
      });

      // Snapshot push of GIFT_AVAILABLE notifications for SUBSCRIBERS campaigns
      if (row!.audience === 'SUBSCRIBERS') {
        await pushGiftAvailableSnapshot(tx, row!.id);
      }
      return row!;
    });

    reply.code(201);
    return created;
  });

  app.get<{ Querystring: { status?: string } }>('/api/v1/admin/campaigns', guards, async (req) => {
    const db = getDb()!;
    const status = req.query.status ?? 'active';
    const now = new Date();
    let where;
    switch (status) {
      case 'active':    where = and(isNull(campaigns.cancelledAt), gt(campaigns.expiresAt, now)); break;
      case 'expired':   where = and(isNull(campaigns.cancelledAt), lt(campaigns.expiresAt, now)); break;
      case 'cancelled': where = isNotNull(campaigns.cancelledAt); break;
      case 'all':       where = undefined; break;
      default:          where = undefined;
    }
    const rows = await db.select().from(campaigns)
      .where(where)
      .orderBy(desc(campaigns.createdAt))
      .limit(200);
    return { campaigns: rows };
  });

  app.get<{ Params: { id: string } }>('/api/v1/admin/campaigns/:id', guards, async (req, reply) => {
    const db = getDb()!;
    const row = (await db.select().from(campaigns).where(eq(campaigns.id, req.params.id)))[0];
    if (!row) { reply.code(404); return { error: 'not found' }; }
    const [{ totalClaims }] = await db.select({ totalClaims: count() }).from(campaignClaims)
      .where(eq(campaignClaims.campaignId, row.id));
    return { ...row, stats: { totalClaims: Number(totalClaims) } };
  });

  app.post<{ Params: { id: string } }>('/api/v1/admin/campaigns/:id/cancel', guards, async (req, reply) => {
    const db = getDb()!;
    const adminRow = (await db.select().from(players).where(eq(players.cognitoSub, req.auth!.sub)))[0];
    if (!adminRow) { reply.code(403); return { error: 'admin not found' }; }

    await db.transaction(async (tx) => {
      // Idempotent: only set cancelled_at if not already cancelled
      await tx.update(campaigns)
        .set({ cancelledAt: new Date() })
        .where(and(eq(campaigns.id, req.params.id), isNull(campaigns.cancelledAt)));

      await logAdminAction(tx, {
        adminId: adminRow.id,
        actionType: 'CAMPAIGN_CANCELLED',
        targetType: 'campaign',
        targetId: req.params.id,
        payload: {},
      });
    });

    return { ok: true };
  });
}
