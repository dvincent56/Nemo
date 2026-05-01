# Admin Promo Campaigns — Plan 1: Backend

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the backend foundations for admin promo campaigns: DB schema, service helpers (`isCareer`, `claimCampaign`, `grantTrialIfEligible`), admin endpoints, player endpoints, notifications endpoints, and a generic `admin_actions` audit log. UI is out of scope (Plan 2 = HTML mockups, Plan 3 = Next.js integration).

**Architecture:** Single `campaigns` table with discriminated payload columns and CHECK constraints; generic `notifications` table reusable for future features (teams, friends, race reminders); generic `admin_actions` audit log; `players.trial_until` for the lightweight trial mechanism (Phase 4 will absorb it into the full Stripe model). All campaign side effects (credit add, upgrade insert, trial extension) execute in Drizzle transactions with `UNIQUE (campaign_id, player_id)` on `campaign_claims` providing DB-level idempotence.

**Tech Stack:** Drizzle ORM (PostgreSQL), Fastify, TypeScript strict, Zod for input validation, `node:test` + `node:assert/strict` for unit/integration tests (existing project convention).

**Spec reference:** [docs/superpowers/specs/2026-05-01-admin-promo-campaigns-design.md](../specs/2026-05-01-admin-promo-campaigns-design.md)

---

## File structure

**New files:**

```
apps/game-engine/src/auth/require-admin.ts            — Fastify preHandler middleware
apps/game-engine/src/auth/require-admin.test.ts

apps/game-engine/src/api/campaigns.helpers.ts         — pure helpers (isCareer, audience matchers)
apps/game-engine/src/api/campaigns.helpers.test.ts

apps/game-engine/src/api/campaigns.service.ts         — DB service functions (claim, grant trial, snapshot push)
apps/game-engine/src/api/campaigns.service.test.ts

apps/game-engine/src/api/campaigns.admin.ts           — admin HTTP endpoints
apps/game-engine/src/api/campaigns.admin.test.ts

apps/game-engine/src/api/campaigns.player.ts          — player HTTP endpoints (eligible, claim)
apps/game-engine/src/api/campaigns.player.test.ts

apps/game-engine/src/api/notifications.ts             — notifications HTTP endpoints
apps/game-engine/src/api/notifications.test.ts

apps/game-engine/src/api/audit.ts                     — logAdminAction helper + GET /audit-log endpoint
apps/game-engine/src/api/audit.test.ts

apps/game-engine/src/test/db-fixtures.ts              — test fixture helpers (createTestPlayer, createTestCampaign, etc.)
```

**Modified files:**

```
apps/game-engine/src/db/schema.ts                     — add tables and columns
apps/game-engine/drizzle/0003_admin_promo_campaigns.sql — auto-generated migration
apps/game-engine/src/index.ts                          — register new routes + rate limiting
apps/game-engine/package.json                         — add @fastify/rate-limit if not present
```

**Out of scope (Plans 2 + 3):**
- HTML mockups (Plan 2: `mockups/admin-campaigns-v1.html`, `mockups/marina-claim-card-v1.html`)
- Next.js admin pages and marina components (Plan 3)
- Wiring `grantTrialIfEligible` into a real signup endpoint (waits for Phase 4 Cognito signup)

---

## Test infrastructure approach

Tests use `node:test` (existing project convention, see [marina.helpers.test.ts](../../apps/game-engine/src/api/marina.helpers.test.ts)) and run against the dev Postgres database. Each test creates fixtures with **random UUIDs** for `cognitoSub` (so parallel tests don't collide) and cleans up its own data via `afterEach` hooks. The test fixture helpers live in `apps/game-engine/src/test/db-fixtures.ts` and are introduced in Task 1.

**No mock DB.** Hitting real Postgres catches Drizzle/SQL errors that mocks would mask, including CHECK constraint violations and UNIQUE conflicts which are central to this feature's correctness.

Run tests with: `pnpm --filter @nemo/game-engine test` (existing script).

---

## Task 1: Drizzle schema + migration

**Files:**
- Modify: `apps/game-engine/src/db/schema.ts`
- Create: `apps/game-engine/drizzle/0003_admin_promo_campaigns.sql` (generated)
- Create: `apps/game-engine/src/test/db-fixtures.ts`

- [ ] **Step 1: Add new enums and tables to schema.ts**

Append to [apps/game-engine/src/db/schema.ts](apps/game-engine/src/db/schema.ts) (after line 234, end of file):

```typescript
// ---------------------------------------------------------------------------
// Admin promo campaigns
// ---------------------------------------------------------------------------

export const campaignTypeEnum = pgEnum('campaign_type', ['CREDITS', 'UPGRADE', 'TRIAL']);
export const campaignAudienceEnum = pgEnum('campaign_audience', ['SUBSCRIBERS', 'NEW_SIGNUPS']);
export const notificationTypeEnum = pgEnum('notification_type', [
  'GIFT_AVAILABLE',
  'TRIAL_GRANTED',
  'TEAM_INVITE',
  'FRIEND_REQUEST',
  'RACE_REMINDER',
]);

export const campaigns = pgTable('campaigns', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: campaignTypeEnum('type').notNull(),
  creditsAmount: integer('credits_amount'),
  upgradeCatalogId: text('upgrade_catalog_id'),
  trialDays: integer('trial_days'),
  audience: campaignAudienceEnum('audience').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  // races.id is text (slug), not uuid — see schema.ts:69
  linkedRaceId: text('linked_race_id').references(() => races.id, { onDelete: 'set null' }),
  messageTitle: varchar('message_title', { length: 100 }).notNull(),
  messageBody: varchar('message_body', { length: 500 }).notNull(),
  createdByAdminId: uuid('created_by_admin_id').notNull().references(() => players.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
}, (t) => [
  check('campaigns_payload_chk', sql`
    (${t.type} = 'CREDITS' AND ${t.creditsAmount} IS NOT NULL AND ${t.upgradeCatalogId} IS NULL AND ${t.trialDays} IS NULL) OR
    (${t.type} = 'UPGRADE' AND ${t.upgradeCatalogId} IS NOT NULL AND ${t.creditsAmount} IS NULL AND ${t.trialDays} IS NULL) OR
    (${t.type} = 'TRIAL'   AND ${t.trialDays} IS NOT NULL AND ${t.creditsAmount} IS NULL AND ${t.upgradeCatalogId} IS NULL)
  `),
  check('campaigns_audience_chk', sql`
    (${t.type} = 'TRIAL' AND ${t.audience} = 'NEW_SIGNUPS') OR
    (${t.type} IN ('CREDITS', 'UPGRADE') AND ${t.audience} = 'SUBSCRIBERS')
  `),
  check('campaigns_credits_positive', sql`${t.creditsAmount} IS NULL OR ${t.creditsAmount} > 0`),
  check('campaigns_trial_days_positive', sql`${t.trialDays} IS NULL OR ${t.trialDays} > 0`),
]);

export const campaignClaims = pgTable('campaign_claims', {
  id: uuid('id').primaryKey().defaultRandom(),
  campaignId: uuid('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
  playerId: uuid('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
  grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique('uniq_claim_per_player').on(t.campaignId, t.playerId),
  index('idx_campaign_claims_player').on(t.playerId),
]);

export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  playerId: uuid('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
  type: notificationTypeEnum('type').notNull(),
  payload: jsonb('payload').notNull(),
  readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('idx_notifications_player_unread').on(t.playerId, t.readAt, t.createdAt),
]);

export const adminActions = pgTable('admin_actions', {
  id: uuid('id').primaryKey().defaultRandom(),
  adminId: uuid('admin_id').notNull().references(() => players.id, { onDelete: 'restrict' }),
  actionType: varchar('action_type', { length: 64 }).notNull(),
  targetType: varchar('target_type', { length: 32 }),
  targetId: varchar('target_id', { length: 64 }),
  payload: jsonb('payload').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('idx_admin_actions_admin_created').on(t.adminId, t.createdAt),
  index('idx_admin_actions_type_created').on(t.actionType, t.createdAt),
]);
```

- [ ] **Step 2: Add `trial_until` and `is_admin` columns to `players`**

Edit the existing `players` table definition in [apps/game-engine/src/db/schema.ts](apps/game-engine/src/db/schema.ts) (lines 44-65). After the `avatarUrl` line (line 60), before `createdAt`, add:

```typescript
  trialUntil: timestamp('trial_until', { withTimezone: true }),
  isAdmin: boolean('is_admin').notNull().default(false),
```

- [ ] **Step 3: Generate the migration**

Run:
```bash
cd apps/game-engine && pnpm drizzle-kit generate --name=admin_promo_campaigns
```

Expected: a new file `apps/game-engine/drizzle/0003_admin_promo_campaigns.sql` is created.

- [ ] **Step 4: Inspect the generated migration**

Read `apps/game-engine/drizzle/0003_admin_promo_campaigns.sql` and confirm it contains:
- `CREATE TYPE` for the three new enums
- `CREATE TABLE` for `campaigns`, `campaign_claims`, `notifications`, `admin_actions`
- `ALTER TABLE players ADD COLUMN trial_until` and `ADD COLUMN is_admin`
- The 4 CHECK constraints on `campaigns`
- The UNIQUE on `campaign_claims`
- The 3 indexes (`idx_campaign_claims_player`, `idx_notifications_player_unread`, two on `admin_actions`)

If anything is missing, fix the schema and re-run `pnpm drizzle-kit generate`. Drizzle is sensitive to schema declaration order — the `campaigns` table's FK to `players` requires `players` to be declared first (which it is, at line 44).

- [ ] **Step 5: Apply the migration locally**

Run:
```bash
cd apps/game-engine && pnpm drizzle-kit migrate
```

Expected: migration applied without error. Verify with:
```bash
cd apps/game-engine && pnpm drizzle-kit studio
```
or via `psql`:
```bash
psql $DATABASE_URL -c "\dt campaigns campaign_claims notifications admin_actions"
psql $DATABASE_URL -c "\d players" | grep -E "trial_until|is_admin"
```

- [ ] **Step 6: Create test fixture helpers**

Create `apps/game-engine/src/test/db-fixtures.ts`:

```typescript
import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { getDb, type DbClient } from '../db/client.js';
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
```

- [ ] **Step 7: Smoke-test fixture helpers**

Create `apps/game-engine/src/test/db-fixtures.test.ts`:

```typescript
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
```

Run: `pnpm --filter @nemo/game-engine test src/test/db-fixtures.test.ts`
Expected: 1 test pass.

- [ ] **Step 8: Commit**

```bash
git add apps/game-engine/src/db/schema.ts apps/game-engine/drizzle/0003_admin_promo_campaigns.sql apps/game-engine/drizzle/meta apps/game-engine/src/test/db-fixtures.ts apps/game-engine/src/test/db-fixtures.test.ts
git commit -m "feat(campaigns): db schema + test fixtures for admin promo campaigns"
```

---

## Task 2: `isCareer()` pure helper

**Files:**
- Create: `apps/game-engine/src/api/campaigns.helpers.ts`
- Create: `apps/game-engine/src/api/campaigns.helpers.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/game-engine/src/api/campaigns.helpers.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isCareer } from './campaigns.helpers.js';

describe('isCareer', () => {
  const FUTURE = new Date(Date.now() + 24 * 3600 * 1000);
  const PAST = new Date(Date.now() - 24 * 3600 * 1000);

  it('returns true for tier CAREER (no trial)', () => {
    assert.equal(isCareer({ tier: 'CAREER', trialUntil: null }), true);
  });
  it('returns false for tier FREE with no trial', () => {
    assert.equal(isCareer({ tier: 'FREE', trialUntil: null }), false);
  });
  it('returns false for tier FREE with expired trial', () => {
    assert.equal(isCareer({ tier: 'FREE', trialUntil: PAST }), false);
  });
  it('returns true for tier FREE with active trial', () => {
    assert.equal(isCareer({ tier: 'FREE', trialUntil: FUTURE }), true);
  });
  it('returns true for tier CAREER even with expired trial', () => {
    assert.equal(isCareer({ tier: 'CAREER', trialUntil: PAST }), true);
  });
  it('accepts a custom now() for time-travel testing', () => {
    const now = new Date('2030-01-01T00:00:00Z');
    const trialUntil = new Date('2029-12-31T00:00:00Z');
    assert.equal(isCareer({ tier: 'FREE', trialUntil }, now), false);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter @nemo/game-engine test src/api/campaigns.helpers.test.ts`
Expected: FAIL with "Cannot find module './campaigns.helpers.js'".

- [ ] **Step 3: Implement the helper**

Create `apps/game-engine/src/api/campaigns.helpers.ts`:

```typescript
export interface PlayerTierState {
  tier: 'FREE' | 'CAREER';
  trialUntil: Date | null;
}

/**
 * Single source of truth for "is this player effectively Carrière right now?".
 * Reads tier and trialUntil from a *DB-loaded* player snapshot (never from JWT).
 *
 * The optional `now` parameter exists for deterministic testing only.
 */
export function isCareer(p: PlayerTierState, now: Date = new Date()): boolean {
  if (p.tier === 'CAREER') return true;
  if (p.trialUntil && p.trialUntil.getTime() > now.getTime()) return true;
  return false;
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `pnpm --filter @nemo/game-engine test src/api/campaigns.helpers.test.ts`
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/game-engine/src/api/campaigns.helpers.ts apps/game-engine/src/api/campaigns.helpers.test.ts
git commit -m "feat(campaigns): isCareer() helper with trial_until support"
```

---

## Task 3: `logAdminAction()` helper + `requireAdmin` middleware

**Files:**
- Create: `apps/game-engine/src/api/audit.ts` (helper only for now; the GET endpoint comes in Task 11)
- Create: `apps/game-engine/src/api/audit.test.ts`
- Create: `apps/game-engine/src/auth/require-admin.ts`
- Create: `apps/game-engine/src/auth/require-admin.test.ts`

- [ ] **Step 1: Write the failing test for `logAdminAction`**

Create `apps/game-engine/src/api/audit.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter @nemo/game-engine test src/api/audit.test.ts`
Expected: FAIL with "Cannot find module './audit.js'".

- [ ] **Step 3: Implement `logAdminAction`**

Create `apps/game-engine/src/api/audit.ts`:

```typescript
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
```

- [ ] **Step 4: Run test, verify it passes**

Run: `pnpm --filter @nemo/game-engine test src/api/audit.test.ts`
Expected: 2 tests pass.

- [ ] **Step 5: Write the failing test for `requireAdmin` middleware**

Create `apps/game-engine/src/auth/require-admin.test.ts`:

```typescript
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { getDb } from '../db/client.js';
import { createTestPlayer, cleanupTestPlayers } from '../test/db-fixtures.js';
import { enforceAuth } from './cognito.js';
import { requireAdmin } from './require-admin.js';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(cookie);
  app.get('/admin-only', { preHandler: [enforceAuth, requireAdmin] }, async () => ({ ok: true }));
  await app.ready();
  return app;
}

describe('requireAdmin', () => {
  const createdIds: string[] = [];
  after(async () => { await cleanupTestPlayers(getDb()!, createdIds); });

  it('returns 403 when the authenticated player is not admin', async () => {
    const db = getDb()!;
    const playerId = await createTestPlayer(db, { isAdmin: false });
    createdIds.push(playerId);

    // The dev token format is `dev.<sub>.<username>` — see auth/cognito.ts:53
    // We need the cognitoSub to match what we inserted.
    const sub = (await db.query.players.findFirst({ where: (p, { eq }) => eq(p.id, playerId) }))!.cognitoSub;
    const token = `dev.${sub}.test`;

    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/admin-only',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(res.statusCode, 403);
    await app.close();
  });

  it('returns 200 when the authenticated player is admin', async () => {
    const db = getDb()!;
    const playerId = await createTestPlayer(db, { isAdmin: true });
    createdIds.push(playerId);
    const sub = (await db.query.players.findFirst({ where: (p, { eq }) => eq(p.id, playerId) }))!.cognitoSub;
    const token = `dev.${sub}.test`;

    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/admin-only',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(res.body), { ok: true });
    await app.close();
  });

  it('returns 401 when not authenticated', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/admin-only' });
    assert.equal(res.statusCode, 401);
    await app.close();
  });
});
```

- [ ] **Step 6: Run test, verify it fails**

Run: `pnpm --filter @nemo/game-engine test src/auth/require-admin.test.ts`
Expected: FAIL with "Cannot find module './require-admin.js'".

- [ ] **Step 7: Implement `requireAdmin` middleware**

Create `apps/game-engine/src/auth/require-admin.ts`:

```typescript
import type { FastifyReply, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { players } from '../db/schema.js';

/**
 * Fastify preHandler — chained AFTER enforceAuth. Reads is_admin from the DB
 * (NEVER from the JWT) so a stolen or forged token cannot escalate privileges.
 *
 * Use as `{ preHandler: [enforceAuth, requireAdmin] }`.
 */
export async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!req.auth) {
    reply.code(401).send({ error: 'unauthenticated' });
    return;
  }
  const db = getDb();
  if (!db) {
    reply.code(503).send({ error: 'database unavailable' });
    return;
  }
  const rows = await db.select({ isAdmin: players.isAdmin })
    .from(players)
    .where(eq(players.cognitoSub, req.auth.sub));
  const player = rows[0];
  if (!player || !player.isAdmin) {
    reply.code(403).send({ error: 'admin required' });
    return;
  }
}
```

- [ ] **Step 8: Run test, verify it passes**

Run: `pnpm --filter @nemo/game-engine test src/auth/require-admin.test.ts`
Expected: 3 tests pass.

- [ ] **Step 9: Commit**

```bash
git add apps/game-engine/src/api/audit.ts apps/game-engine/src/api/audit.test.ts apps/game-engine/src/auth/require-admin.ts apps/game-engine/src/auth/require-admin.test.ts
git commit -m "feat(campaigns): logAdminAction helper + requireAdmin middleware"
```

---

## Task 4: `grantTrialIfEligible()` service (case 3)

**Files:**
- Modify: `apps/game-engine/src/api/campaigns.service.ts` (create new)
- Create: `apps/game-engine/src/api/campaigns.service.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/game-engine/src/api/campaigns.service.test.ts`:

```typescript
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { players, campaignClaims, notifications } from '../db/schema.js';
import {
  createTestPlayer, createTestCampaign, cleanupTestPlayers,
} from '../test/db-fixtures.js';
import { grantTrialIfEligible } from './campaigns.service.js';

describe('grantTrialIfEligible', () => {
  const createdIds: string[] = [];
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
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `pnpm --filter @nemo/game-engine test src/api/campaigns.service.test.ts`
Expected: FAIL with "Cannot find module './campaigns.service.js'".

- [ ] **Step 3: Implement `grantTrialIfEligible`**

Create `apps/game-engine/src/api/campaigns.service.ts`:

```typescript
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
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `pnpm --filter @nemo/game-engine test src/api/campaigns.service.test.ts`
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/game-engine/src/api/campaigns.service.ts apps/game-engine/src/api/campaigns.service.test.ts
git commit -m "feat(campaigns): grantTrialIfEligible service (case 3, case-safe + monotonic)"
```

---

## Task 5: `claimCampaign()` service (cases 1 + 2)

**Files:**
- Modify: `apps/game-engine/src/api/campaigns.service.ts` (extend)
- Modify: `apps/game-engine/src/api/campaigns.service.test.ts` (extend)

- [ ] **Step 1: Append failing tests**

Append to `apps/game-engine/src/api/campaigns.service.test.ts`:

```typescript
import { playerUpgrades } from '../db/schema.js';
import { claimCampaign, type ClaimResult } from './campaigns.service.js';

describe('claimCampaign', () => {
  const createdIds: string[] = [];
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
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `pnpm --filter @nemo/game-engine test src/api/campaigns.service.test.ts`
Expected: 9 tests fail with "claimCampaign is not a function" or similar.

- [ ] **Step 3: Implement `claimCampaign`**

Append to `apps/game-engine/src/api/campaigns.service.ts`:

```typescript
import { isCareer } from './campaigns.helpers.js';

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
          await tx.update(players).set({
            credits: sql`${players.credits} + ${camp.creditsAmount!}`,
          }).where(eq(players.id, input.playerId));
          break;
        case 'UPGRADE':
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
```

Add the missing import at the top of `campaigns.service.ts` (next to the existing imports):

```typescript
import { playerUpgrades } from '../db/schema.js';
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `pnpm --filter @nemo/game-engine test src/api/campaigns.service.test.ts`
Expected: 15 tests pass (6 from Task 4 + 9 new).

- [ ] **Step 5: Commit**

```bash
git add apps/game-engine/src/api/campaigns.service.ts apps/game-engine/src/api/campaigns.service.test.ts
git commit -m "feat(campaigns): claimCampaign service (cases 1+2, atomic + idempotent)"
```

---

## Task 6: Snapshot push helper for SUBSCRIBERS campaigns

**Files:**
- Modify: `apps/game-engine/src/api/campaigns.service.ts` (extend)
- Modify: `apps/game-engine/src/api/campaigns.service.test.ts` (extend)

- [ ] **Step 1: Append failing test**

Append to `apps/game-engine/src/api/campaigns.service.test.ts`:

```typescript
import { pushGiftAvailableSnapshot } from './campaigns.service.js';

describe('pushGiftAvailableSnapshot', () => {
  const createdIds: string[] = [];
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
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter @nemo/game-engine test src/api/campaigns.service.test.ts`
Expected: 1 new test fails with "pushGiftAvailableSnapshot is not a function".

- [ ] **Step 3: Implement `pushGiftAvailableSnapshot`**

Update the imports at the top of `apps/game-engine/src/api/campaigns.service.ts`. Replace the existing drizzle-orm import line with:

```typescript
import { and, eq, gt, isNotNull, isNull, or, sql } from 'drizzle-orm';
```

Then append the function at the end of the file:

```typescript
/**
 * Snapshot push of GIFT_AVAILABLE notifications to all current "subscribers"
 * (CAREER + active trial) at the moment of campaign creation. Future
 * subscribers (post-creation) discover the campaign via /campaigns/eligible.
 *
 * Returns the number of notifications inserted (for stats / logging).
 *
 * Caller MUST execute this in the same transaction as the campaign creation
 * to avoid the half-state where the campaign exists but no one is notified.
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
```

- [ ] **Step 4: Run test, verify it passes**

Run: `pnpm --filter @nemo/game-engine test src/api/campaigns.service.test.ts`
Expected: 16 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/game-engine/src/api/campaigns.service.ts apps/game-engine/src/api/campaigns.service.test.ts
git commit -m "feat(campaigns): pushGiftAvailableSnapshot for SUBSCRIBERS campaigns"
```

---

## Task 7: Admin endpoints — campaigns CRUD

**Files:**
- Create: `apps/game-engine/src/api/campaigns.admin.ts`
- Create: `apps/game-engine/src/api/campaigns.admin.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/game-engine/src/api/campaigns.admin.test.ts`:

```typescript
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { campaigns, adminActions } from '../db/schema.js';
import { createTestPlayer, cleanupTestPlayers } from '../test/db-fixtures.js';
import { registerCampaignAdminRoutes } from './campaigns.admin.js';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(cookie);
  registerCampaignAdminRoutes(app);
  await app.ready();
  return app;
}

function tokenFor(sub: string): string { return `dev.${sub}.${sub}`; }

describe('admin campaigns endpoints', () => {
  const createdIds: string[] = [];
  let app: FastifyInstance;
  let adminToken: string;
  let nonAdminToken: string;

  before(async () => {
    const db = getDb()!;
    const adminId = await createTestPlayer(db, { isAdmin: true });
    const userId = await createTestPlayer(db, { isAdmin: false });
    createdIds.push(adminId, userId);
    const adminSub = (await db.query.players.findFirst({ where: (p, { eq }) => eq(p.id, adminId) }))!.cognitoSub;
    const userSub = (await db.query.players.findFirst({ where: (p, { eq }) => eq(p.id, userId) }))!.cognitoSub;
    adminToken = tokenFor(adminSub);
    nonAdminToken = tokenFor(userSub);
    app = await buildApp();
  });
  after(async () => { await app.close(); await cleanupTestPlayers(getDb()!, createdIds); });

  it('POST /admin/campaigns — non-admin → 403', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/admin/campaigns',
      headers: { authorization: `Bearer ${nonAdminToken}` },
      payload: { type: 'CREDITS', creditsAmount: 500, audience: 'SUBSCRIBERS', expiresAt: new Date(Date.now() + 86400000).toISOString(), messageTitle: 'T', messageBody: 'B' },
    });
    assert.equal(res.statusCode, 403);
  });

  it('POST /admin/campaigns — invalid payload (TRIAL with audience=SUBSCRIBERS) → 400', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/admin/campaigns',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { type: 'TRIAL', trialDays: 30, audience: 'SUBSCRIBERS', expiresAt: new Date(Date.now() + 86400000).toISOString(), messageTitle: 'T', messageBody: 'B' },
    });
    assert.equal(res.statusCode, 400);
  });

  it('POST /admin/campaigns — CREDITS happy path → 201, returns campaign, logs admin_actions', async () => {
    const db = getDb()!;
    const res = await app.inject({
      method: 'POST', url: '/api/v1/admin/campaigns',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        type: 'CREDITS', creditsAmount: 500, audience: 'SUBSCRIBERS',
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        messageTitle: '500 crédits offerts', messageBody: 'Pour le départ Vendée',
      },
    });
    assert.equal(res.statusCode, 201);
    const body = JSON.parse(res.body);
    assert.ok(body.id);
    assert.equal(body.type, 'CREDITS');

    const inDb = await db.select().from(campaigns).where(eq(campaigns.id, body.id));
    assert.equal(inDb.length, 1);

    const audit = await db.select().from(adminActions).where(eq(adminActions.actionType, 'CAMPAIGN_CREATED'));
    assert.ok(audit.some((a) => a.targetId === body.id), 'audit entry created');
  });

  it('GET /admin/campaigns — returns active campaigns by default', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/v1/admin/campaigns',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(Array.isArray(body.campaigns));
  });

  it('GET /admin/campaigns/:id — returns campaign + claim stats', async () => {
    const db = getDb()!;
    const adminId = (await db.select().from(adminActions).limit(1))[0]?.adminId;
    assert.ok(adminId, 'sanity check — should have at least one admin action');
    const camp = (await db.select().from(campaigns).limit(1))[0]!;
    const res = await app.inject({
      method: 'GET', url: `/api/v1/admin/campaigns/${camp.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.id, camp.id);
    assert.equal(typeof body.stats.totalClaims, 'number');
  });

  it('POST /admin/campaigns/:id/cancel — sets cancelled_at + logs admin action', async () => {
    const db = getDb()!;
    const camp = (await db.select().from(campaigns).limit(1))[0]!;
    const res = await app.inject({
      method: 'POST', url: `/api/v1/admin/campaigns/${camp.id}/cancel`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.statusCode, 200);
    const after = (await db.select().from(campaigns).where(eq(campaigns.id, camp.id)))[0]!;
    assert.notEqual(after.cancelledAt, null);

    const audit = await db.select().from(adminActions).where(eq(adminActions.actionType, 'CAMPAIGN_CANCELLED'));
    assert.ok(audit.some((a) => a.targetId === camp.id));
  });

  it('POST /admin/campaigns/:id/cancel — second cancel is idempotent', async () => {
    const db = getDb()!;
    const camp = (await db.select().from(campaigns).where(isNotNull(campaigns.cancelledAt)).limit(1))[0]!;
    const res = await app.inject({
      method: 'POST', url: `/api/v1/admin/campaigns/${camp.id}/cancel`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.statusCode, 200);
  });
});
```

Add the missing import at the top of `campaigns.admin.test.ts`:
```typescript
import { isNotNull } from 'drizzle-orm';
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `pnpm --filter @nemo/game-engine test src/api/campaigns.admin.test.ts`
Expected: FAIL with "Cannot find module './campaigns.admin.js'".

- [ ] **Step 3: Implement the admin endpoints**

Create `apps/game-engine/src/api/campaigns.admin.ts`:

```typescript
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
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `pnpm --filter @nemo/game-engine test src/api/campaigns.admin.test.ts`
Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/game-engine/src/api/campaigns.admin.ts apps/game-engine/src/api/campaigns.admin.test.ts
git commit -m "feat(campaigns): admin endpoints (create + list + detail + cancel)"
```

---

## Task 8: Admin endpoint — `GET /audit-log`

**Files:**
- Modify: `apps/game-engine/src/api/audit.ts` (extend with route registrar)
- Modify: `apps/game-engine/src/api/audit.test.ts` (add HTTP test)

- [ ] **Step 1: Append failing test**

Append to `apps/game-engine/src/api/audit.test.ts`:

```typescript
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { registerAuditRoutes } from './audit.js';

async function buildAuditApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(cookie);
  registerAuditRoutes(app);
  await app.ready();
  return app;
}

describe('GET /admin/audit-log', () => {
  const createdIds: string[] = [];
  after(async () => { await cleanupTestPlayers(getDb()!, createdIds); });

  it('returns paginated admin actions, newest first', async () => {
    const db = getDb()!;
    const adminId = await createTestPlayer(db, { isAdmin: true });
    createdIds.push(adminId);

    await logAdminAction(db, { adminId, actionType: 'TEST_ONE', payload: {} });
    await logAdminAction(db, { adminId, actionType: 'TEST_TWO', payload: {} });

    const sub = (await db.query.players.findFirst({ where: (p, { eq }) => eq(p.id, adminId) }))!.cognitoSub;
    const app = await buildAuditApp();
    const res = await app.inject({
      method: 'GET', url: '/api/v1/admin/audit-log',
      headers: { authorization: `Bearer dev.${sub}.x` },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(Array.isArray(body.actions));
    assert.ok(body.actions.length >= 2);
    // newest first
    const first = body.actions[0];
    const second = body.actions[1];
    assert.ok(new Date(first.createdAt).getTime() >= new Date(second.createdAt).getTime());
    await app.close();
  });

  it('rejects non-admin → 403', async () => {
    const db = getDb()!;
    const userId = await createTestPlayer(db, { isAdmin: false });
    createdIds.push(userId);
    const sub = (await db.query.players.findFirst({ where: (p, { eq }) => eq(p.id, userId) }))!.cognitoSub;
    const app = await buildAuditApp();
    const res = await app.inject({
      method: 'GET', url: '/api/v1/admin/audit-log',
      headers: { authorization: `Bearer dev.${sub}.x` },
    });
    assert.equal(res.statusCode, 403);
    await app.close();
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter @nemo/game-engine test src/api/audit.test.ts`
Expected: FAIL with "registerAuditRoutes is not a function".

- [ ] **Step 3: Implement `registerAuditRoutes`**

Add the new imports at the top of `apps/game-engine/src/api/audit.ts` (next to the existing `import type { DbClient }` and `import { adminActions }` lines):

```typescript
import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { enforceAuth } from '../auth/cognito.js';
import { requireAdmin } from '../auth/require-admin.js';
import { getDb } from '../db/client.js';
```

Then append the route registrar at the end of the file:

```typescript
export function registerAuditRoutes(app: FastifyInstance): void {
  const guards = { preHandler: [enforceAuth, requireAdmin] };

  app.get<{ Querystring: { adminId?: string; actionType?: string; limit?: string } }>(
    '/api/v1/admin/audit-log', guards,
    async (req) => {
      const db = getDb()!;
      const limit = Math.min(Math.max(Number(req.query.limit ?? 50), 1), 200);
      const conditions = [];
      if (req.query.adminId)    conditions.push(eq(adminActions.adminId, req.query.adminId));
      if (req.query.actionType) conditions.push(eq(adminActions.actionType, req.query.actionType));
      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const actions = await db.select().from(adminActions)
        .where(where)
        .orderBy(desc(adminActions.createdAt))
        .limit(limit);
      return { actions };
    },
  );
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `pnpm --filter @nemo/game-engine test src/api/audit.test.ts`
Expected: 4 tests pass (2 from Task 3 + 2 new).

- [ ] **Step 5: Commit**

```bash
git add apps/game-engine/src/api/audit.ts apps/game-engine/src/api/audit.test.ts
git commit -m "feat(campaigns): GET /admin/audit-log endpoint"
```

---

## Task 9: Player endpoints — eligible + claim

**Files:**
- Create: `apps/game-engine/src/api/campaigns.player.ts`
- Create: `apps/game-engine/src/api/campaigns.player.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/game-engine/src/api/campaigns.player.test.ts`:

```typescript
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { players, campaignClaims } from '../db/schema.js';
import { createTestPlayer, createTestCampaign, cleanupTestPlayers } from '../test/db-fixtures.js';
import { registerCampaignPlayerRoutes } from './campaigns.player.js';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(cookie);
  registerCampaignPlayerRoutes(app);
  await app.ready();
  return app;
}

function tokenFor(sub: string): string { return `dev.${sub}.${sub}`; }

describe('player campaigns endpoints', () => {
  const createdIds: string[] = [];
  after(async () => { await cleanupTestPlayers(getDb()!, createdIds); });

  it('GET /campaigns/eligible — lists active SUBSCRIBERS campaigns not yet claimed', async () => {
    const db = getDb()!;
    const adminId = await createTestPlayer(db, { isAdmin: true });
    const subId = await createTestPlayer(db, { tier: 'CAREER' });
    createdIds.push(adminId, subId);

    const c1 = await createTestCampaign(db, { type: 'CREDITS', creditsAmount: 100, createdByAdminId: adminId });
    await createTestCampaign(db, { type: 'CREDITS', creditsAmount: 200, createdByAdminId: adminId, cancelled: true });

    const sub = (await db.select().from(players).where(eq(players.id, subId)))[0]!.cognitoSub;
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET', url: '/api/v1/campaigns/eligible',
      headers: { authorization: `Bearer ${tokenFor(sub)}` },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    const ids: string[] = body.campaigns.map((c: { id: string }) => c.id);
    assert.ok(ids.includes(c1));
    await app.close();
  });

  it('GET /campaigns/eligible — FREE without trial sees nothing', async () => {
    const db = getDb()!;
    const adminId = await createTestPlayer(db, { isAdmin: true });
    const freeId = await createTestPlayer(db, { tier: 'FREE' });
    createdIds.push(adminId, freeId);

    await createTestCampaign(db, { type: 'CREDITS', creditsAmount: 100, createdByAdminId: adminId });

    const sub = (await db.select().from(players).where(eq(players.id, freeId)))[0]!.cognitoSub;
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET', url: '/api/v1/campaigns/eligible',
      headers: { authorization: `Bearer ${tokenFor(sub)}` },
    });
    const body = JSON.parse(res.body);
    assert.equal(body.campaigns.length, 0);
    await app.close();
  });

  it('POST /campaigns/:id/claim — happy path → 200, credits granted', async () => {
    const db = getDb()!;
    const adminId = await createTestPlayer(db, { isAdmin: true });
    const subId = await createTestPlayer(db, { tier: 'CAREER', credits: 0 });
    createdIds.push(adminId, subId);
    const campId = await createTestCampaign(db, { type: 'CREDITS', creditsAmount: 500, createdByAdminId: adminId });

    const sub = (await db.select().from(players).where(eq(players.id, subId)))[0]!.cognitoSub;
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: `/api/v1/campaigns/${campId}/claim`,
      headers: { authorization: `Bearer ${tokenFor(sub)}` },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.status, 'granted');

    const player = (await db.select().from(players).where(eq(players.id, subId)))[0]!;
    assert.equal(player.credits, 500);
    await app.close();
  });

  it('POST /campaigns/:id/claim — second claim → 200 with status=already_claimed (idempotent)', async () => {
    const db = getDb()!;
    const adminId = await createTestPlayer(db, { isAdmin: true });
    const subId = await createTestPlayer(db, { tier: 'CAREER', credits: 0 });
    createdIds.push(adminId, subId);
    const campId = await createTestCampaign(db, { type: 'CREDITS', creditsAmount: 500, createdByAdminId: adminId });
    const sub = (await db.select().from(players).where(eq(players.id, subId)))[0]!.cognitoSub;

    const app = await buildApp();
    await app.inject({
      method: 'POST', url: `/api/v1/campaigns/${campId}/claim`,
      headers: { authorization: `Bearer ${tokenFor(sub)}` },
    });
    const res = await app.inject({
      method: 'POST', url: `/api/v1/campaigns/${campId}/claim`,
      headers: { authorization: `Bearer ${tokenFor(sub)}` },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(res.body).status, 'already_claimed');
    const player = (await db.select().from(players).where(eq(players.id, subId)))[0]!;
    assert.equal(player.credits, 500, 'credits granted exactly once');
    await app.close();
  });

  it('POST /campaigns/:id/claim — FREE player → 403', async () => {
    const db = getDb()!;
    const adminId = await createTestPlayer(db, { isAdmin: true });
    const freeId = await createTestPlayer(db, { tier: 'FREE' });
    createdIds.push(adminId, freeId);
    const campId = await createTestCampaign(db, { type: 'CREDITS', creditsAmount: 500, createdByAdminId: adminId });
    const sub = (await db.select().from(players).where(eq(players.id, freeId)))[0]!.cognitoSub;

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: `/api/v1/campaigns/${campId}/claim`,
      headers: { authorization: `Bearer ${tokenFor(sub)}` },
    });
    assert.equal(res.statusCode, 403);
    await app.close();
  });

  it('POST /campaigns/:id/claim — uses session player_id, ignores body', async () => {
    const db = getDb()!;
    const adminId = await createTestPlayer(db, { isAdmin: true });
    const subId = await createTestPlayer(db, { tier: 'CAREER', credits: 0 });
    const otherId = await createTestPlayer(db, { tier: 'CAREER', credits: 0 });
    createdIds.push(adminId, subId, otherId);
    const campId = await createTestCampaign(db, { type: 'CREDITS', creditsAmount: 500, createdByAdminId: adminId });
    const sub = (await db.select().from(players).where(eq(players.id, subId)))[0]!.cognitoSub;

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: `/api/v1/campaigns/${campId}/claim`,
      headers: { authorization: `Bearer ${tokenFor(sub)}` },
      payload: { playerId: otherId },
    });
    assert.equal(res.statusCode, 200);
    const sub2 = (await db.select().from(players).where(eq(players.id, subId)))[0]!;
    const other2 = (await db.select().from(players).where(eq(players.id, otherId)))[0]!;
    assert.equal(sub2.credits, 500, 'session player got credits');
    assert.equal(other2.credits, 0, 'forged playerId in body was ignored');
    await app.close();
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `pnpm --filter @nemo/game-engine test src/api/campaigns.player.test.ts`
Expected: FAIL with "Cannot find module './campaigns.player.js'".

- [ ] **Step 3: Implement the player endpoints**

Create `apps/game-engine/src/api/campaigns.player.ts`:

```typescript
import type { FastifyInstance } from 'fastify';
import { and, desc, eq, gt, isNull, notInArray, or } from 'drizzle-orm';
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
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `pnpm --filter @nemo/game-engine test src/api/campaigns.player.test.ts`
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/game-engine/src/api/campaigns.player.ts apps/game-engine/src/api/campaigns.player.test.ts
git commit -m "feat(campaigns): player endpoints (eligible + claim, session-trusted player_id)"
```

---

## Task 10: Notifications endpoints

**Files:**
- Create: `apps/game-engine/src/api/notifications.ts`
- Create: `apps/game-engine/src/api/notifications.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/game-engine/src/api/notifications.test.ts`:

```typescript
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { players, notifications } from '../db/schema.js';
import { createTestPlayer, cleanupTestPlayers } from '../test/db-fixtures.js';
import { registerNotificationRoutes } from './notifications.js';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(cookie);
  registerNotificationRoutes(app);
  await app.ready();
  return app;
}
function tokenFor(sub: string): string { return `dev.${sub}.${sub}`; }

describe('notifications endpoints', () => {
  const createdIds: string[] = [];
  after(async () => { await cleanupTestPlayers(getDb()!, createdIds); });

  async function setup() {
    const db = getDb()!;
    const playerId = await createTestPlayer(db);
    createdIds.push(playerId);
    const sub = (await db.select().from(players).where(eq(players.id, playerId)))[0]!.cognitoSub;
    return { db, playerId, sub };
  }

  it('GET /notifications — returns own notifs only', async () => {
    const { db, playerId, sub } = await setup();
    const otherId = await createTestPlayer(db);
    createdIds.push(otherId);
    await db.insert(notifications).values([
      { playerId, type: 'GIFT_AVAILABLE', payload: { campaign_id: 'x', message_title: 't', message_body: 'b' } },
      { playerId: otherId, type: 'GIFT_AVAILABLE', payload: { campaign_id: 'y', message_title: 'z', message_body: 'w' } },
    ]);

    const app = await buildApp();
    const res = await app.inject({
      method: 'GET', url: '/api/v1/notifications',
      headers: { authorization: `Bearer ${tokenFor(sub)}` },
    });
    const body = JSON.parse(res.body);
    assert.equal(body.notifications.length, 1);
    assert.equal(body.notifications[0].payload.campaign_id, 'x');
    await app.close();
  });

  it('GET /notifications/unread-count — counts only unread', async () => {
    const { db, playerId, sub } = await setup();
    await db.insert(notifications).values([
      { playerId, type: 'GIFT_AVAILABLE', payload: {} },
      { playerId, type: 'GIFT_AVAILABLE', payload: {}, readAt: new Date() },
      { playerId, type: 'TRIAL_GRANTED',  payload: {} },
    ]);

    const app = await buildApp();
    const res = await app.inject({
      method: 'GET', url: '/api/v1/notifications/unread-count',
      headers: { authorization: `Bearer ${tokenFor(sub)}` },
    });
    const body = JSON.parse(res.body);
    assert.equal(body.unread, 2);
    await app.close();
  });

  it('POST /notifications/:id/read — marks own notif as read', async () => {
    const { db, playerId, sub } = await setup();
    const [n] = await db.insert(notifications).values({
      playerId, type: 'GIFT_AVAILABLE', payload: {},
    }).returning();

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: `/api/v1/notifications/${n!.id}/read`,
      headers: { authorization: `Bearer ${tokenFor(sub)}` },
    });
    assert.equal(res.statusCode, 200);
    const stored = (await db.select().from(notifications).where(eq(notifications.id, n!.id)))[0]!;
    assert.notEqual(stored.readAt, null);
    await app.close();
  });

  it('POST /notifications/:id/read — cannot mark someone else’s notif → 404', async () => {
    const { db, sub } = await setup();
    const otherId = await createTestPlayer(db);
    createdIds.push(otherId);
    const [n] = await db.insert(notifications).values({
      playerId: otherId, type: 'GIFT_AVAILABLE', payload: {},
    }).returning();

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: `/api/v1/notifications/${n!.id}/read`,
      headers: { authorization: `Bearer ${tokenFor(sub)}` },
    });
    assert.equal(res.statusCode, 404);
    await app.close();
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `pnpm --filter @nemo/game-engine test src/api/notifications.test.ts`
Expected: FAIL with "Cannot find module './notifications.js'".

- [ ] **Step 3: Implement the notifications endpoints**

Create `apps/game-engine/src/api/notifications.ts`:

```typescript
import type { FastifyInstance } from 'fastify';
import { and, count, desc, eq, isNull, asc, sql } from 'drizzle-orm';
import { enforceAuth } from '../auth/cognito.js';
import { getDb } from '../db/client.js';
import { notifications, players } from '../db/schema.js';

export function registerNotificationRoutes(app: FastifyInstance): void {
  const guards = { preHandler: [enforceAuth] };

  app.get<{ Querystring: { limit?: string } }>('/api/v1/notifications', guards, async (req, reply) => {
    const db = getDb()!;
    const player = (await db.select({ id: players.id }).from(players)
      .where(eq(players.cognitoSub, req.auth!.sub)))[0];
    if (!player) { reply.code(404); return { error: 'player not found' }; }

    const limit = Math.min(Math.max(Number(req.query.limit ?? 50), 1), 200);
    // Unread first (read_at IS NULL), then by created_at DESC
    const rows = await db.select().from(notifications)
      .where(eq(notifications.playerId, player.id))
      .orderBy(asc(sql`${notifications.readAt} IS NOT NULL`), desc(notifications.createdAt))
      .limit(limit);
    return { notifications: rows };
  });

  app.get('/api/v1/notifications/unread-count', guards, async (req, reply) => {
    const db = getDb()!;
    const player = (await db.select({ id: players.id }).from(players)
      .where(eq(players.cognitoSub, req.auth!.sub)))[0];
    if (!player) { reply.code(404); return { error: 'player not found' }; }

    const [{ unread }] = await db.select({ unread: count() }).from(notifications)
      .where(and(eq(notifications.playerId, player.id), isNull(notifications.readAt)));
    return { unread: Number(unread) };
  });

  app.post<{ Params: { id: string } }>('/api/v1/notifications/:id/read', guards, async (req, reply) => {
    const db = getDb()!;
    const player = (await db.select({ id: players.id }).from(players)
      .where(eq(players.cognitoSub, req.auth!.sub)))[0];
    if (!player) { reply.code(404); return { error: 'player not found' }; }

    const result = await db.update(notifications).set({ readAt: new Date() })
      .where(and(eq(notifications.id, req.params.id), eq(notifications.playerId, player.id)))
      .returning({ id: notifications.id });
    if (result.length === 0) { reply.code(404); return { error: 'notification not found' }; }
    return { ok: true };
  });
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `pnpm --filter @nemo/game-engine test src/api/notifications.test.ts`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/game-engine/src/api/notifications.ts apps/game-engine/src/api/notifications.test.ts
git commit -m "feat(campaigns): notifications endpoints (list + unread-count + mark read)"
```

---

## Task 11: Wire up routes + rate limiting + smoke test

**Files:**
- Modify: `apps/game-engine/src/index.ts`
- Modify: `apps/game-engine/package.json` (only if `@fastify/rate-limit` is missing)

- [ ] **Step 1: Verify `@fastify/rate-limit` is installed**

Run:
```bash
cd apps/game-engine && pnpm list @fastify/rate-limit 2>/dev/null
```

If absent (no entry in output), install it:
```bash
cd apps/game-engine && pnpm add @fastify/rate-limit
```

- [ ] **Step 2: Add the imports to `index.ts`**

Edit [apps/game-engine/src/index.ts](apps/game-engine/src/index.ts), after the existing route imports (around line 20), add:

```typescript
import rateLimit from '@fastify/rate-limit';
import { registerCampaignAdminRoutes } from './api/campaigns.admin.js';
import { registerCampaignPlayerRoutes } from './api/campaigns.player.js';
import { registerNotificationRoutes } from './api/notifications.js';
import { registerAuditRoutes } from './api/audit.js';
```

- [ ] **Step 3: Register the routes and rate limits**

Locate the section of `index.ts` where existing routes are registered (search for `registerMarinaRoutes(app)`). Add adjacent:

```typescript
// Rate limit: shared instance, applied per-route via { config: { rateLimit: ... } }
await app.register(rateLimit, { global: false });

// Player-facing campaign + notification endpoints — generous limits
app.register(async (scope) => {
  await scope.register(rateLimit, { max: 5, timeWindow: '1 minute' });
  registerCampaignPlayerRoutes(scope);
  registerNotificationRoutes(scope);
});

// Admin-facing endpoints — 30 req/min/admin (rate limit keyed by IP, refined later)
app.register(async (scope) => {
  await scope.register(rateLimit, { max: 30, timeWindow: '1 minute' });
  registerCampaignAdminRoutes(scope);
  registerAuditRoutes(scope);
});
```

Note: rate limiting is keyed by IP by default. Per-player keying is a follow-up (would need a custom keyGenerator reading `req.auth?.sub`); for the MVP, IP-based is acceptable since these endpoints all require auth.

- [ ] **Step 4: Build and start the engine to verify it boots**

Run:
```bash
cd apps/game-engine && pnpm build
```
Expected: TypeScript compilation succeeds with no errors.

Then start:
```bash
cd apps/game-engine && pnpm dev
```
Expected: server starts, no crash. Look for log lines confirming registered routes (Fastify logs them at boot).

`Ctrl+C` to stop.

- [ ] **Step 5: Run the full test suite to verify nothing regressed**

Run:
```bash
pnpm --filter @nemo/game-engine test
```
Expected: all tests in this plan pass + all pre-existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add apps/game-engine/src/index.ts apps/game-engine/package.json apps/game-engine/pnpm-lock.yaml
git commit -m "feat(campaigns): register routes + rate limits in main entry"
```

---

## What's left (out of scope for Plan 1)

These items are deliberately deferred — the spec covers them but they belong to Plans 2 and 3:

- **Mockups HTML standalone** (`mockups/admin-campaigns-v1.html`, `mockups/marina-claim-card-v1.html`, `mockups/marina-notif-panel-v1.html`) — Plan 2.
- **Next.js admin pages** (`/[locale]/admin/campaigns`, `/[locale]/admin/audit-log`) and **marina components** (`<NotifBadge>`, `<NotifPanel>`, `<ClaimCard>`, welcome-trial auto-open) — Plan 3.
- **Wiring `grantTrialIfEligible` into the real Cognito signup endpoint** — waits for Phase 4 when Cognito signup is wired up. The function is exported and ready to be called from `apps/game-engine/src/api/auth.ts` (or wherever the production signup lands) with a single line: `await grantTrialIfEligible(db, newPlayerId);` after the signup transaction commits.
- **Per-player rate-limit keying** (instead of per-IP) — straightforward follow-up, not blocking.
- **Promotion to admin** is intentionally not exposed via API. To create the first admin, run a one-off SQL (or extend `seed-dev.ts`):
  ```sql
  UPDATE players SET is_admin = TRUE WHERE cognito_sub = 'dev';
  ```
