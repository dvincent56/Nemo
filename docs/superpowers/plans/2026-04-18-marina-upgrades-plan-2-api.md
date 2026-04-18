# Marina Upgrades — Plan 2 : API REST

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implémenter les 9 endpoints REST de la marina (catalogue, inventaire, achat, installation, création de coque, réparation, vente) avec auth, lock checks et transactions Drizzle.

**Architecture:** Un fichier route `api/marina.ts` expose les 9 endpoints, assisté par un module de helpers purs (`api/marina.helpers.ts`) pour les calculs métier (prix de vente, coût de réparation, compatibilité slots, critères de déblocage Proto). L'auth utilise un preHandler par route qui appelle `verifyAccessToken` et set `req.auth`. Les mutations multi-tables utilisent `db.transaction()`.

**Tech Stack:** Fastify, Drizzle ORM (Postgres), TypeScript strict, `@nemo/game-balance` (catalogue), `node --import tsx --test` (tests unitaires).

**Spec source :** [docs/superpowers/specs/2026-04-16-marina-upgrades-design.md](../specs/2026-04-16-marina-upgrades-design.md) — sections D.5 (API), C.5 (réparation), C.6 (vente).

**Dépendance :** Plan 1 (backend foundation) doit être mergé sur `main` — ✅ fait (2026-04-17).

---

## File Structure

### Files to create

| Path | Responsabilité |
|---|---|
| `apps/game-engine/src/api/marina.helpers.ts` | Fonctions pures : `computeSellPrice`, `computeRepairCost`, `meetsUnlockCriteria`, `slotTierForConditionAxis` |
| `apps/game-engine/src/api/marina.helpers.test.ts` | Tests unitaires des helpers |
| `apps/game-engine/src/api/marina.ts` | Enregistrement des 9 routes Fastify + preHandler auth |
| `apps/game-engine/src/test/e2e-marina-api.ts` | Script E2E : build app avec `app.inject()`, teste les 9 endpoints |

### Files to modify

| Path | Changement |
|---|---|
| `apps/game-engine/src/auth/cognito.ts` | Ajouter `declare module 'fastify'` pour `req.auth` typé |
| `apps/game-engine/src/index.ts` | Appeler `registerMarinaRoutes(app)` |

---

## Task 1 — Type augmentation Fastify + helper auth

**Files:**
- Modify: `apps/game-engine/src/auth/cognito.ts`

- [ ] **Step 1: Ajouter la déclaration de module Fastify**

À la fin de `apps/game-engine/src/auth/cognito.ts`, après la fonction `authPreHandler` :

```typescript
// ---------------------------------------------------------------------------
// Fastify type augmentation — makes req.auth available with full type safety
// ---------------------------------------------------------------------------
declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}
```

- [ ] **Step 2: Ajouter un helper `enforceAuth` pour preHandler par route**

Toujours dans `apps/game-engine/src/auth/cognito.ts`, ajouter après le `declare module` :

```typescript
/**
 * Fastify preHandler hook — extracts and validates auth token.
 * Use as `{ preHandler: [enforceAuth] }` on protected routes.
 */
export async function enforceAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = req.headers.authorization;
  const cookieToken = req.cookies?.['nemo_access_token'];
  const token = header?.startsWith('Bearer ') ? header.slice(7) : cookieToken;
  if (!token) {
    reply.code(401).send({ error: 'unauthenticated' });
    return;
  }
  try {
    req.auth = await verifyAccessToken(token);
  } catch {
    reply.code(401).send({ error: 'invalid token' });
  }
}
```

Ajouter `FastifyReply` dans les imports du fichier si absent :

```typescript
import type { FastifyReply, FastifyRequest } from 'fastify';
```

- [ ] **Step 3: Vérifier la compilation**

Run: `cd apps/game-engine && npx tsc --noEmit`
Expected: aucune erreur

- [ ] **Step 4: Commit**

```bash
git add apps/game-engine/src/auth/cognito.ts
git commit -m "feat(auth): add Fastify type augmentation and enforceAuth preHandler"
```

---

## Task 2 — Marina helpers (logique métier pure)

**Files:**
- Create: `apps/game-engine/src/api/marina.helpers.ts`
- Create: `apps/game-engine/src/api/marina.helpers.test.ts`

- [ ] **Step 1: Écrire les tests des helpers**

Créer `apps/game-engine/src/api/marina.helpers.test.ts` :

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeSellPrice,
  computeRepairCost,
  meetsUnlockCriteria,
  conditionAxisToSlot,
} from './marina.helpers.js';
import type { UpgradeTier } from '@nemo/game-balance';

describe('computeSellPrice', () => {
  it('returns 0 for a fresh boat with no stats', () => {
    const price = computeSellPrice({ wins: 0, podiums: 0, top10Finishes: 0 }, 0);
    assert.equal(price, 0);
  });

  it('applies the spec formula: totalNm*1 + wins*500 + podiums*150 + top10*30', () => {
    const price = computeSellPrice({ wins: 0, podiums: 2, top10Finishes: 5 }, 3482);
    // 3482*1 + 0*500 + 2*150 + 5*30 = 3482 + 0 + 300 + 150 = 3932
    assert.equal(price, 3932);
  });

  it('floors fractional NM', () => {
    const price = computeSellPrice({ wins: 1, podiums: 0, top10Finishes: 0 }, 10.7);
    // floor(10.7*1 + 500) = floor(510.7) = 510
    assert.equal(price, 510);
  });
});

describe('computeRepairCost', () => {
  const maintenance = {
    hull: { costPer10pts: 80, durationHours: 8 },
    rig: { costPer10pts: 50, durationHours: 4 },
    sails: { costPer10pts: 120, durationHours: 12 },
    electronics: { costPer10pts: 30, durationHours: 3 },
  };
  const tiers: Record<UpgradeTier, { maintenanceMul: number }> = {
    SERIE: { maintenanceMul: 1.0 },
    BRONZE: { maintenanceMul: 1.5 },
    SILVER: { maintenanceMul: 2.0 },
    GOLD: { maintenanceMul: 3.0 },
    PROTO: { maintenanceMul: 4.5 },
  };

  it('returns 0 for a boat at 100% everywhere', () => {
    const cost = computeRepairCost(
      { hull: 100, rig: 100, sail: 100, elec: 100 },
      { hull: 'SERIE', mast: 'SERIE', sails: 'SERIE', electronics: 'SERIE' },
      maintenance,
      tiers,
    );
    assert.equal(cost.total, 0);
  });

  it('matches the spec example (78/62/45/90 with mixed tiers)', () => {
    const cost = computeRepairCost(
      { hull: 78, rig: 62, sail: 45, elec: 90 },
      { hull: 'SERIE', mast: 'BRONZE', sails: 'SILVER', electronics: 'BRONZE' },
      maintenance,
      tiers,
    );
    // hull: (100-78)/10 * 80 * 1.0 = 2.2 * 80 = 176
    assert.equal(cost.hull, 176);
    // rig: (100-62)/10 * 50 * 1.5 = 3.8 * 50 * 1.5 = 285
    assert.equal(cost.rig, 285);
    // sail: (100-45)/10 * 120 * 2.0 = 5.5 * 120 * 2.0 = 1320
    assert.equal(cost.sail, 1320);
    // elec: (100-90)/10 * 30 * 1.5 = 1.0 * 30 * 1.5 = 45
    assert.equal(cost.elec, 45);
    assert.equal(cost.total, 176 + 285 + 1320 + 45);
  });
});

describe('meetsUnlockCriteria', () => {
  it('returns true when no criteria specified', () => {
    assert.equal(meetsUnlockCriteria({}, { racesFinished: 0, avgRankPct: 1.0 }), true);
  });

  it('AND mode: requires all criteria met', () => {
    const criteria = { racesFinished: 20, avgRankPctMax: 0.20, or: false };
    assert.equal(meetsUnlockCriteria(criteria, { racesFinished: 25, avgRankPct: 0.15 }), true);
    assert.equal(meetsUnlockCriteria(criteria, { racesFinished: 10, avgRankPct: 0.15 }), false);
    assert.equal(meetsUnlockCriteria(criteria, { racesFinished: 25, avgRankPct: 0.50 }), false);
  });

  it('OR mode: requires at least one criterion met', () => {
    const criteria = { racesFinished: 20, avgRankPctMax: 0.20, or: true };
    assert.equal(meetsUnlockCriteria(criteria, { racesFinished: 25, avgRankPct: 0.50 }), true);
    assert.equal(meetsUnlockCriteria(criteria, { racesFinished: 5, avgRankPct: 0.50 }), false);
  });
});

describe('conditionAxisToSlot', () => {
  it('maps each condition axis to its upgrade slot', () => {
    assert.equal(conditionAxisToSlot('hull'), 'HULL');
    assert.equal(conditionAxisToSlot('rig'), 'MAST');
    assert.equal(conditionAxisToSlot('sail'), 'SAILS');
    assert.equal(conditionAxisToSlot('elec'), 'ELECTRONICS');
  });
});
```

- [ ] **Step 2: Vérifier que les tests échouent**

Run: `cd apps/game-engine && node --import tsx --test src/api/marina.helpers.test.ts`
Expected: FAIL — module `./marina.helpers.js` not found

- [ ] **Step 3: Implémenter les helpers**

Créer `apps/game-engine/src/api/marina.helpers.ts` :

```typescript
import type { UpgradeTier } from '@nemo/game-balance';

// ---------------------------------------------------------------------------
// Sell price — spec formula: totalNm × 1 + wins × 500 + podiums × 150 + top10 × 30
// ---------------------------------------------------------------------------

export function computeSellPrice(
  boatStats: { wins: number; podiums: number; top10Finishes: number },
  totalNm: number,
): number {
  return Math.floor(
    totalNm * 1 + boatStats.wins * 500 + boatStats.podiums * 150 + boatStats.top10Finishes * 30,
  );
}

// ---------------------------------------------------------------------------
// Repair cost — per axis: (100 - condition) / 10 × costPer10pts × tierMul
// ---------------------------------------------------------------------------

export interface RepairBreakdown {
  hull: number;
  rig: number;
  sail: number;
  elec: number;
  total: number;
}

type ConditionAxis = 'hull' | 'rig' | 'sail' | 'elec';

interface MaintenanceEntry { costPer10pts: number; durationHours: number }
type MaintenanceConfig = Record<'hull' | 'rig' | 'sails' | 'electronics', MaintenanceEntry>;
type TierConfig = Record<UpgradeTier, { maintenanceMul: number }>;

/** Maps condition axis to the upgrade slot whose tier drives the maintenance multiplier. */
const AXIS_TO_SLOT = {
  hull: 'HULL',
  rig:  'MAST',
  sail: 'SAILS',
  elec: 'ELECTRONICS',
} as const;

/** Maps condition axis to the maintenance config key. */
const AXIS_TO_MAINT_KEY: Record<ConditionAxis, keyof MaintenanceConfig> = {
  hull: 'hull',
  rig:  'rig',
  sail: 'sails',
  elec: 'electronics',
};

export function conditionAxisToSlot(axis: ConditionAxis): string {
  return AXIS_TO_SLOT[axis];
}

function repairAxisCost(
  condition: number,
  maintEntry: MaintenanceEntry,
  tierMul: number,
): number {
  if (condition >= 100) return 0;
  return (100 - condition) / 10 * maintEntry.costPer10pts * tierMul;
}

export function computeRepairCost(
  conditions: Record<ConditionAxis, number>,
  slotTiers: { hull: UpgradeTier; mast: UpgradeTier; sails: UpgradeTier; electronics: UpgradeTier },
  maintenance: MaintenanceConfig,
  tiers: TierConfig,
): RepairBreakdown {
  const hull = repairAxisCost(conditions.hull, maintenance.hull, tiers[slotTiers.hull].maintenanceMul);
  const rig  = repairAxisCost(conditions.rig,  maintenance.rig,  tiers[slotTiers.mast].maintenanceMul);
  const sail = repairAxisCost(conditions.sail, maintenance.sails, tiers[slotTiers.sails].maintenanceMul);
  const elec = repairAxisCost(conditions.elec, maintenance.electronics, tiers[slotTiers.electronics].maintenanceMul);
  return { hull, rig, sail, elec, total: hull + rig + sail + elec };
}

// ---------------------------------------------------------------------------
// Unlock criteria — Proto items
// ---------------------------------------------------------------------------

export interface UnlockCriteria {
  racesFinished?: number;
  avgRankPctMax?: number;
  or?: boolean;
}

export function meetsUnlockCriteria(
  criteria: UnlockCriteria,
  player: { racesFinished: number; avgRankPct: number },
): boolean {
  const checks: boolean[] = [];
  if (criteria.racesFinished !== undefined) {
    checks.push(player.racesFinished >= criteria.racesFinished);
  }
  if (criteria.avgRankPctMax !== undefined) {
    checks.push(player.avgRankPct <= criteria.avgRankPctMax);
  }
  if (checks.length === 0) return true;
  return criteria.or ? checks.some(Boolean) : checks.every(Boolean);
}

// ---------------------------------------------------------------------------
// UUID format check (basic validation for route params)
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(s: string): boolean {
  return UUID_RE.test(s);
}
```

- [ ] **Step 4: Lancer les tests et vérifier qu'ils passent**

Run: `cd apps/game-engine && node --import tsx --test src/api/marina.helpers.test.ts`
Expected: tous les tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/game-engine/src/api/marina.helpers.ts apps/game-engine/src/api/marina.helpers.test.ts
git commit -m "feat(marina): add pure business logic helpers with tests"
```

---

## Task 3 — Route scaffold + GET /upgrades/catalog

**Files:**
- Create: `apps/game-engine/src/api/marina.ts`

- [ ] **Step 1: Créer le scaffold de marina.ts avec le premier endpoint**

Créer `apps/game-engine/src/api/marina.ts` :

```typescript
import type { FastifyInstance } from 'fastify';
import { eq, and, sql } from 'drizzle-orm';
import pino from 'pino';
import { GameBalance, type UpgradeItem, type UpgradeSlot, type UpgradeTier } from '@nemo/game-balance';
import type { BoatClass } from '@nemo/shared-types';
import { enforceAuth, type AuthContext } from '../auth/cognito.js';
import { getDb, type DbClient } from '../db/client.js';
import {
  players,
  boats,
  playerUpgrades,
  boatInstalledUpgrades,
  raceParticipants,
} from '../db/schema.js';
import {
  computeSellPrice,
  computeRepairCost,
  meetsUnlockCriteria,
  isValidUuid,
} from './marina.helpers.js';

const log = pino({ name: 'api.marina' });

const VALID_CLASSES = new Set(['FIGARO', 'CLASS40', 'OCEAN_FIFTY', 'IMOCA60', 'ULTIM']);
const MAX_BOATS_PER_CLASS = 5;

// ---------------------------------------------------------------------------
// Internal helpers (DB-dependent, not pure)
// ---------------------------------------------------------------------------

async function findPlayerBySub(db: DbClient, sub: string) {
  const rows = await db.select().from(players).where(eq(players.cognitoSub, sub));
  return rows[0] ?? null;
}

async function findOwnedBoat(db: DbClient, boatId: string, ownerId: string) {
  const rows = await db.select().from(boats).where(
    and(eq(boats.id, boatId), eq(boats.ownerId, ownerId), eq(boats.status, 'ACTIVE')),
  );
  return rows[0] ?? null;
}

/** Returns the tier of the upgrade installed in a given slot, or 'SERIE' if none. */
function tierForSlot(
  slot: UpgradeSlot,
  installedItems: { slot: string; catalogItem?: UpgradeItem }[],
): UpgradeTier {
  const found = installedItems.find((i) => i.slot === slot);
  return found?.catalogItem?.tier ?? 'SERIE';
}

/** Loads installed upgrades for a boat, resolved against playerUpgrades + catalog. */
async function loadInstalledWithCatalog(db: DbClient, boatId: string) {
  const rows = await db.select({
    slot: boatInstalledUpgrades.slot,
    playerUpgradeId: boatInstalledUpgrades.playerUpgradeId,
    catalogId: playerUpgrades.upgradeCatalogId,
  })
  .from(boatInstalledUpgrades)
  .innerJoin(playerUpgrades, eq(boatInstalledUpgrades.playerUpgradeId, playerUpgrades.id))
  .where(eq(boatInstalledUpgrades.boatId, boatId));

  const catalog = GameBalance.upgrades.items;
  return rows.map((row) => ({
    slot: row.slot,
    playerUpgradeId: row.playerUpgradeId,
    catalogId: row.catalogId,
    catalogItem: catalog.find((i) => i.id === row.catalogId),
  }));
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerMarinaRoutes(app: FastifyInstance): void {

  // =========================================================================
  // GET /api/v1/upgrades/catalog — PUBLIC
  // =========================================================================

  app.get('/api/v1/upgrades/catalog', async (req) => {
    const q = req.query as { boatClass?: string };
    const { items, slots, slotsByClass, tiers } = GameBalance.upgrades;

    let filtered = items;
    if (q.boatClass && VALID_CLASSES.has(q.boatClass)) {
      filtered = items.filter((it) => it.compat.includes(q.boatClass as BoatClass));
    }

    return { items: filtered, slots, slotsByClass, tiers };
  });

}
```

- [ ] **Step 2: Vérifier la compilation**

Run: `cd apps/game-engine && npx tsc --noEmit`
Expected: aucune erreur

- [ ] **Step 3: Commit**

```bash
git add apps/game-engine/src/api/marina.ts
git commit -m "feat(marina): scaffold marina routes + GET /upgrades/catalog"
```

---

## Task 4 — GET /players/me/upgrades

**Files:**
- Modify: `apps/game-engine/src/api/marina.ts`

- [ ] **Step 1: Ajouter l'endpoint dans `registerMarinaRoutes`**

Ajouter dans `registerMarinaRoutes`, après le GET catalog :

```typescript
  // =========================================================================
  // GET /api/v1/players/me/upgrades — AUTHENTICATED
  // =========================================================================

  app.get('/api/v1/players/me/upgrades', { preHandler: [enforceAuth] }, async (req, reply) => {
    const auth = req.auth!;
    const db = getDb();
    if (!db) { reply.code(503); return { error: 'database unavailable' }; }

    const player = await findPlayerBySub(db, auth.sub);
    if (!player) { reply.code(404); return { error: 'player not found' }; }

    // All upgrades owned by the player
    const owned = await db.select().from(playerUpgrades)
      .where(eq(playerUpgrades.playerId, player.id));

    // All currently installed (to mark which are "in use")
    const installed = await db.select({
      playerUpgradeId: boatInstalledUpgrades.playerUpgradeId,
      boatId: boatInstalledUpgrades.boatId,
      slot: boatInstalledUpgrades.slot,
    }).from(boatInstalledUpgrades);

    const installedSet = new Map(
      installed.map((i) => [i.playerUpgradeId, { boatId: i.boatId, slot: i.slot }]),
    );

    const catalog = GameBalance.upgrades.items;

    const inventory = owned.map((pu) => {
      const catalogItem = catalog.find((c) => c.id === pu.upgradeCatalogId);
      const install = installedSet.get(pu.id);
      return {
        id: pu.id,
        upgradeCatalogId: pu.upgradeCatalogId,
        name: catalogItem?.name ?? pu.upgradeCatalogId,
        slot: catalogItem?.slot ?? null,
        tier: catalogItem?.tier ?? null,
        acquiredAt: pu.acquiredAt.toISOString(),
        acquisitionSource: pu.acquisitionSource,
        installedOn: install ? { boatId: install.boatId, slot: install.slot } : null,
      };
    });

    return { inventory, credits: player.credits };
  });
```

- [ ] **Step 2: Vérifier la compilation**

Run: `cd apps/game-engine && npx tsc --noEmit`
Expected: aucune erreur

- [ ] **Step 3: Commit**

```bash
git add apps/game-engine/src/api/marina.ts
git commit -m "feat(marina): GET /players/me/upgrades — inventory endpoint"
```

---

## Task 5 — POST /boats (créer une coque)

**Files:**
- Modify: `apps/game-engine/src/api/marina.ts`

- [ ] **Step 1: Ajouter l'endpoint POST /boats**

Ajouter dans `registerMarinaRoutes` :

```typescript
  // =========================================================================
  // POST /api/v1/boats — create a new hull (free, cap 5 per class)
  // =========================================================================

  app.post<{ Body: { boatClass: string; name: string } }>(
    '/api/v1/boats',
    { preHandler: [enforceAuth] },
    async (req, reply) => {
      const auth = req.auth!;
      const db = getDb();
      if (!db) { reply.code(503); return { error: 'database unavailable' }; }

      const { boatClass, name } = req.body ?? {};
      if (!boatClass || !VALID_CLASSES.has(boatClass)) {
        reply.code(400); return { error: 'invalid boatClass' };
      }
      if (!name || typeof name !== 'string' || name.trim().length === 0 || name.length > 50) {
        reply.code(400); return { error: 'name required (1-50 chars)' };
      }

      const player = await findPlayerBySub(db, auth.sub);
      if (!player) { reply.code(404); return { error: 'player not found' }; }

      // Cap check: max 5 active boats per class
      const [countRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(boats)
        .where(and(
          eq(boats.ownerId, player.id),
          eq(boats.boatClass, boatClass),
          eq(boats.status, 'ACTIVE'),
        ));
      const currentCount = countRow?.count ?? 0;
      if (currentCount >= MAX_BOATS_PER_CLASS) {
        reply.code(400);
        return { error: `max ${MAX_BOATS_PER_CLASS} boats per class reached` };
      }

      const [newBoat] = await db.insert(boats).values({
        ownerId: player.id,
        name: name.trim(),
        boatClass,
      }).returning();

      reply.code(201);
      return {
        id: newBoat!.id,
        name: newBoat!.name,
        boatClass: newBoat!.boatClass,
        status: newBoat!.status,
      };
    },
  );
```

- [ ] **Step 2: Vérifier la compilation**

Run: `cd apps/game-engine && npx tsc --noEmit`
Expected: aucune erreur

- [ ] **Step 3: Commit**

```bash
git add apps/game-engine/src/api/marina.ts
git commit -m "feat(marina): POST /boats — create new hull with cap check"
```

---

## Task 6 — POST /upgrades/purchase

**Files:**
- Modify: `apps/game-engine/src/api/marina.ts`

- [ ] **Step 1: Ajouter l'endpoint POST /upgrades/purchase**

Ajouter dans `registerMarinaRoutes` :

```typescript
  // =========================================================================
  // POST /api/v1/upgrades/purchase — buy an upgrade (to inventory, not installed)
  // =========================================================================

  app.post<{ Body: { itemId: string } }>(
    '/api/v1/upgrades/purchase',
    { preHandler: [enforceAuth] },
    async (req, reply) => {
      const auth = req.auth!;
      const db = getDb();
      if (!db) { reply.code(503); return { error: 'database unavailable' }; }

      const { itemId } = req.body ?? {};
      if (!itemId || typeof itemId !== 'string') {
        reply.code(400); return { error: 'itemId required' };
      }

      const catalog = GameBalance.upgrades;
      const item = catalog.items.find((i) => i.id === itemId);
      if (!item) { reply.code(404); return { error: 'item not found in catalog' }; }
      if (item.tier === 'SERIE') {
        reply.code(400); return { error: 'SERIE items cannot be purchased' };
      }
      if (item.cost === null) {
        reply.code(400); return { error: 'item has no price (Proto — must be unlocked)' };
      }

      const player = await findPlayerBySub(db, auth.sub);
      if (!player) { reply.code(404); return { error: 'player not found' }; }

      // Proto unlock criteria check
      if (item.tier === 'PROTO' && item.unlockCriteria) {
        if (!meetsUnlockCriteria(item.unlockCriteria, player)) {
          reply.code(403); return { error: 'unlock criteria not met', criteria: item.unlockCriteria };
        }
      }

      // Credit check
      if (player.credits < item.cost) {
        reply.code(400);
        return { error: 'insufficient credits', required: item.cost, available: player.credits };
      }

      // Transaction: debit credits + create player_upgrade
      const result = await db.transaction(async (tx) => {
        await tx.update(players)
          .set({ credits: sql`${players.credits} - ${item.cost!}` })
          .where(eq(players.id, player.id));

        const [upgrade] = await tx.insert(playerUpgrades).values({
          playerId: player.id,
          upgradeCatalogId: itemId,
          acquisitionSource: 'PURCHASE',
          paidCredits: item.cost!,
        }).returning();

        return upgrade!;
      });

      return {
        upgrade: {
          id: result.id,
          upgradeCatalogId: result.upgradeCatalogId,
          acquiredAt: result.acquiredAt.toISOString(),
        },
        creditsRemaining: player.credits - item.cost,
      };
    },
  );
```

- [ ] **Step 2: Vérifier la compilation**

Run: `cd apps/game-engine && npx tsc --noEmit`
Expected: aucune erreur

- [ ] **Step 3: Commit**

```bash
git add apps/game-engine/src/api/marina.ts
git commit -m "feat(marina): POST /upgrades/purchase — buy upgrade to inventory"
```

---

## Task 7 — POST /boats/:id/install + POST /boats/:id/uninstall

**Files:**
- Modify: `apps/game-engine/src/api/marina.ts`

- [ ] **Step 1: Ajouter l'endpoint POST /boats/:id/install**

Ajouter dans `registerMarinaRoutes` :

```typescript
  // =========================================================================
  // POST /api/v1/boats/:id/install — install a player_upgrade onto a boat slot
  // =========================================================================

  app.post<{ Params: { id: string }; Body: { playerUpgradeId: string } }>(
    '/api/v1/boats/:id/install',
    { preHandler: [enforceAuth] },
    async (req, reply) => {
      const auth = req.auth!;
      const db = getDb();
      if (!db) { reply.code(503); return { error: 'database unavailable' }; }

      const boatId = req.params.id;
      if (!isValidUuid(boatId)) { reply.code(400); return { error: 'invalid boat id' }; }

      const { playerUpgradeId } = req.body ?? {};
      if (!playerUpgradeId || !isValidUuid(playerUpgradeId)) {
        reply.code(400); return { error: 'playerUpgradeId required (uuid)' };
      }

      const player = await findPlayerBySub(db, auth.sub);
      if (!player) { reply.code(404); return { error: 'player not found' }; }

      // Verify ownership + lock
      const boat = await findOwnedBoat(db, boatId, player.id);
      if (!boat) { reply.code(404); return { error: 'boat not found' }; }
      if (boat.activeRaceId) {
        reply.code(409); return { error: 'boat is in a race', raceId: boat.activeRaceId };
      }

      // Verify the player owns this upgrade
      const [pu] = await db.select().from(playerUpgrades).where(
        and(eq(playerUpgrades.id, playerUpgradeId), eq(playerUpgrades.playerId, player.id)),
      );
      if (!pu) { reply.code(404); return { error: 'upgrade not found in inventory' }; }

      // Resolve catalog item
      const catalogItem = GameBalance.upgrades.items.find((i) => i.id === pu.upgradeCatalogId);
      if (!catalogItem) { reply.code(400); return { error: 'catalog item not found' }; }

      // Slot compatibility: check if this boat class allows this slot
      const slotAvailability = GameBalance.upgrades.slotsByClass[boat.boatClass as BoatClass]?.[catalogItem.slot];
      if (slotAvailability !== 'open') {
        reply.code(400);
        return { error: `slot ${catalogItem.slot} is ${slotAvailability ?? 'unknown'} for class ${boat.boatClass}` };
      }

      // Class compatibility
      if (!catalogItem.compat.includes(boat.boatClass as BoatClass)) {
        reply.code(400);
        return { error: `item not compatible with class ${boat.boatClass}` };
      }

      // Check if upgrade is already installed elsewhere
      const [alreadyInstalled] = await db.select().from(boatInstalledUpgrades)
        .where(eq(boatInstalledUpgrades.playerUpgradeId, playerUpgradeId));
      if (alreadyInstalled) {
        reply.code(409);
        return { error: 'upgrade already installed on another boat', boatId: alreadyInstalled.boatId };
      }

      // Transaction: uninstall current item in this slot (if any) + install new one
      await db.transaction(async (tx) => {
        // Remove existing item in this slot (returns it to inventory)
        await tx.delete(boatInstalledUpgrades).where(
          and(
            eq(boatInstalledUpgrades.boatId, boatId),
            eq(boatInstalledUpgrades.slot, catalogItem.slot),
          ),
        );

        // Install the new item
        await tx.insert(boatInstalledUpgrades).values({
          boatId,
          slot: catalogItem.slot,
          playerUpgradeId,
        });
      });

      return { ok: true, slot: catalogItem.slot, itemId: catalogItem.id };
    },
  );
```

- [ ] **Step 2: Ajouter l'endpoint POST /boats/:id/uninstall**

Ajouter dans `registerMarinaRoutes` :

```typescript
  // =========================================================================
  // POST /api/v1/boats/:id/uninstall — remove upgrade from slot, back to inventory
  // =========================================================================

  app.post<{ Params: { id: string }; Body: { slot: string } }>(
    '/api/v1/boats/:id/uninstall',
    { preHandler: [enforceAuth] },
    async (req, reply) => {
      const auth = req.auth!;
      const db = getDb();
      if (!db) { reply.code(503); return { error: 'database unavailable' }; }

      const boatId = req.params.id;
      if (!isValidUuid(boatId)) { reply.code(400); return { error: 'invalid boat id' }; }

      const { slot } = req.body ?? {};
      if (!slot || !GameBalance.upgrades.slots.includes(slot as UpgradeSlot)) {
        reply.code(400); return { error: 'invalid slot' };
      }

      const player = await findPlayerBySub(db, auth.sub);
      if (!player) { reply.code(404); return { error: 'player not found' }; }

      const boat = await findOwnedBoat(db, boatId, player.id);
      if (!boat) { reply.code(404); return { error: 'boat not found' }; }
      if (boat.activeRaceId) {
        reply.code(409); return { error: 'boat is in a race', raceId: boat.activeRaceId };
      }

      // Check if something is actually installed in this slot
      const [existing] = await db.select().from(boatInstalledUpgrades).where(
        and(
          eq(boatInstalledUpgrades.boatId, boatId),
          eq(boatInstalledUpgrades.slot, slot as UpgradeSlot),
        ),
      );
      if (!existing) {
        reply.code(400); return { error: 'slot already at SERIE (nothing to uninstall)' };
      }

      // Delete the installation link — upgrade stays in player_upgrades (inventory)
      await db.delete(boatInstalledUpgrades).where(
        and(
          eq(boatInstalledUpgrades.boatId, boatId),
          eq(boatInstalledUpgrades.slot, slot as UpgradeSlot),
        ),
      );

      return { ok: true, slot, returnedToInventory: existing.playerUpgradeId };
    },
  );
```

- [ ] **Step 3: Vérifier la compilation**

Run: `cd apps/game-engine && npx tsc --noEmit`
Expected: aucune erreur

- [ ] **Step 4: Commit**

```bash
git add apps/game-engine/src/api/marina.ts
git commit -m "feat(marina): POST /boats/:id/install + uninstall — slot management"
```

---

## Task 8 — POST /upgrades/buy-and-install (combo transactionnel)

**Files:**
- Modify: `apps/game-engine/src/api/marina.ts`

- [ ] **Step 1: Ajouter l'endpoint POST /upgrades/buy-and-install**

Ajouter dans `registerMarinaRoutes` :

```typescript
  // =========================================================================
  // POST /api/v1/upgrades/buy-and-install — purchase + install in one transaction
  // =========================================================================

  app.post<{ Body: { itemId: string; boatId: string } }>(
    '/api/v1/upgrades/buy-and-install',
    { preHandler: [enforceAuth] },
    async (req, reply) => {
      const auth = req.auth!;
      const db = getDb();
      if (!db) { reply.code(503); return { error: 'database unavailable' }; }

      const { itemId, boatId } = req.body ?? {};
      if (!itemId || typeof itemId !== 'string') {
        reply.code(400); return { error: 'itemId required' };
      }
      if (!boatId || !isValidUuid(boatId)) {
        reply.code(400); return { error: 'boatId required (uuid)' };
      }

      const catalog = GameBalance.upgrades;
      const item = catalog.items.find((i) => i.id === itemId);
      if (!item) { reply.code(404); return { error: 'item not found in catalog' }; }
      if (item.tier === 'SERIE') {
        reply.code(400); return { error: 'SERIE items cannot be purchased' };
      }
      if (item.cost === null) {
        reply.code(400); return { error: 'item has no price (Proto — must be unlocked)' };
      }

      const player = await findPlayerBySub(db, auth.sub);
      if (!player) { reply.code(404); return { error: 'player not found' }; }

      // Proto unlock criteria check
      if (item.tier === 'PROTO' && item.unlockCriteria) {
        if (!meetsUnlockCriteria(item.unlockCriteria, player)) {
          reply.code(403); return { error: 'unlock criteria not met', criteria: item.unlockCriteria };
        }
      }

      // Credit check
      if (player.credits < item.cost) {
        reply.code(400);
        return { error: 'insufficient credits', required: item.cost, available: player.credits };
      }

      // Verify boat ownership + lock
      const boat = await findOwnedBoat(db, boatId, player.id);
      if (!boat) { reply.code(404); return { error: 'boat not found' }; }
      if (boat.activeRaceId) {
        reply.code(409); return { error: 'boat is in a race', raceId: boat.activeRaceId };
      }

      // Slot compatibility
      const slotAvailability = catalog.slotsByClass[boat.boatClass as BoatClass]?.[item.slot];
      if (slotAvailability !== 'open') {
        reply.code(400);
        return { error: `slot ${item.slot} is ${slotAvailability ?? 'unknown'} for class ${boat.boatClass}` };
      }
      if (!item.compat.includes(boat.boatClass as BoatClass)) {
        reply.code(400);
        return { error: `item not compatible with class ${boat.boatClass}` };
      }

      // Atomic transaction: debit + create upgrade + uninstall old + install new
      const result = await db.transaction(async (tx) => {
        // 1. Debit credits
        await tx.update(players)
          .set({ credits: sql`${players.credits} - ${item.cost!}` })
          .where(eq(players.id, player.id));

        // 2. Create player_upgrade
        const [upgrade] = await tx.insert(playerUpgrades).values({
          playerId: player.id,
          upgradeCatalogId: itemId,
          acquisitionSource: 'PURCHASE',
          paidCredits: item.cost!,
        }).returning();

        // 3. Remove existing item in this slot (if any)
        await tx.delete(boatInstalledUpgrades).where(
          and(
            eq(boatInstalledUpgrades.boatId, boatId),
            eq(boatInstalledUpgrades.slot, item.slot),
          ),
        );

        // 4. Install the new item
        await tx.insert(boatInstalledUpgrades).values({
          boatId,
          slot: item.slot,
          playerUpgradeId: upgrade!.id,
        });

        return upgrade!;
      });

      return {
        upgrade: {
          id: result.id,
          upgradeCatalogId: result.upgradeCatalogId,
          acquiredAt: result.acquiredAt.toISOString(),
        },
        installedOn: { boatId, slot: item.slot },
        creditsRemaining: player.credits - item.cost,
      };
    },
  );
```

- [ ] **Step 2: Vérifier la compilation**

Run: `cd apps/game-engine && npx tsc --noEmit`
Expected: aucune erreur

- [ ] **Step 3: Commit**

```bash
git add apps/game-engine/src/api/marina.ts
git commit -m "feat(marina): POST /upgrades/buy-and-install — atomic combo endpoint"
```

---

## Task 9 — POST /boats/:id/repair

**Files:**
- Modify: `apps/game-engine/src/api/marina.ts`

- [ ] **Step 1: Ajouter l'endpoint POST /boats/:id/repair**

Ajouter dans `registerMarinaRoutes` :

```typescript
  // =========================================================================
  // POST /api/v1/boats/:id/repair — repair all axes, debit credits
  // =========================================================================

  app.post<{ Params: { id: string } }>(
    '/api/v1/boats/:id/repair',
    { preHandler: [enforceAuth] },
    async (req, reply) => {
      const auth = req.auth!;
      const db = getDb();
      if (!db) { reply.code(503); return { error: 'database unavailable' }; }

      const boatId = req.params.id;
      if (!isValidUuid(boatId)) { reply.code(400); return { error: 'invalid boat id' }; }

      const player = await findPlayerBySub(db, auth.sub);
      if (!player) { reply.code(404); return { error: 'player not found' }; }

      const boat = await findOwnedBoat(db, boatId, player.id);
      if (!boat) { reply.code(404); return { error: 'boat not found' }; }
      if (boat.activeRaceId) {
        reply.code(409); return { error: 'boat is in a race', raceId: boat.activeRaceId };
      }

      // Already at 100% on all axes?
      if (boat.hullCondition >= 100 && boat.rigCondition >= 100 &&
          boat.sailCondition >= 100 && boat.elecCondition >= 100) {
        reply.code(400); return { error: 'boat already at full condition' };
      }

      // Resolve installed upgrade tiers for maintenance multiplier
      const installedWithCatalog = await loadInstalledWithCatalog(db, boatId);

      const slotTiers = {
        hull: tierForSlot('HULL', installedWithCatalog),
        mast: tierForSlot('MAST', installedWithCatalog),
        sails: tierForSlot('SAILS', installedWithCatalog),
        electronics: tierForSlot('ELECTRONICS', installedWithCatalog),
      };

      const repairCost = computeRepairCost(
        {
          hull: boat.hullCondition,
          rig: boat.rigCondition,
          sail: boat.sailCondition,
          elec: boat.elecCondition,
        },
        slotTiers,
        GameBalance.maintenance,
        catalog.tiers,
      );

      if (player.credits < repairCost.total) {
        reply.code(400);
        return {
          error: 'insufficient credits',
          required: repairCost.total,
          available: player.credits,
          breakdown: repairCost,
        };
      }

      // Transaction: debit credits + set conditions to 100
      await db.transaction(async (tx) => {
        await tx.update(players)
          .set({ credits: sql`${players.credits} - ${repairCost.total}` })
          .where(eq(players.id, player.id));

        await tx.update(boats)
          .set({
            hullCondition: 100,
            rigCondition: 100,
            sailCondition: 100,
            elecCondition: 100,
          })
          .where(eq(boats.id, boatId));
      });

      return {
        repaired: true,
        cost: repairCost,
        creditsRemaining: player.credits - repairCost.total,
      };
    },
  );
```

- [ ] **Step 2: Vérifier la compilation**

Run: `cd apps/game-engine && npx tsc --noEmit`
Expected: aucune erreur

- [ ] **Step 3: Commit**

```bash
git add apps/game-engine/src/api/marina.ts
git commit -m "feat(marina): POST /boats/:id/repair — repair with tier-based cost"
```

---

## Task 10 — DELETE /boats/:id (vente)

**Files:**
- Modify: `apps/game-engine/src/api/marina.ts`

- [ ] **Step 1: Ajouter l'endpoint DELETE /boats/:id**

Ajouter dans `registerMarinaRoutes` :

```typescript
  // =========================================================================
  // DELETE /api/v1/boats/:id — sell boat (irréversible)
  // =========================================================================

  app.delete<{ Params: { id: string } }>(
    '/api/v1/boats/:id',
    { preHandler: [enforceAuth] },
    async (req, reply) => {
      const auth = req.auth!;
      const db = getDb();
      if (!db) { reply.code(503); return { error: 'database unavailable' }; }

      const boatId = req.params.id;
      if (!isValidUuid(boatId)) { reply.code(400); return { error: 'invalid boat id' }; }

      const player = await findPlayerBySub(db, auth.sub);
      if (!player) { reply.code(404); return { error: 'player not found' }; }

      const boat = await findOwnedBoat(db, boatId, player.id);
      if (!boat) { reply.code(404); return { error: 'boat not found' }; }
      if (boat.activeRaceId) {
        reply.code(409); return { error: 'boat is in a race', raceId: boat.activeRaceId };
      }

      // Compute total NM for this boat (summed from race participations)
      const [nmRow] = await db
        .select({ total: sql<number>`COALESCE(SUM(${raceParticipants.distanceNm}), 0)::real` })
        .from(raceParticipants)
        .where(eq(raceParticipants.boatId, boatId));
      const totalNm = nmRow?.total ?? 0;

      const sellPrice = computeSellPrice(
        { wins: boat.wins, podiums: boat.podiums, top10Finishes: boat.top10Finishes },
        totalNm,
      );

      // List upgrades that will return to inventory
      const installedUpgrades = await loadInstalledWithCatalog(db, boatId);
      const returnedUpgrades = installedUpgrades.map((u) => ({
        playerUpgradeId: u.playerUpgradeId,
        catalogId: u.catalogId,
        name: u.catalogItem?.name ?? u.catalogId,
        tier: u.catalogItem?.tier ?? 'SERIE',
      }));

      // Transaction: uninstall all upgrades + soft-delete boat + credit player
      await db.transaction(async (tx) => {
        // 1. Remove all installed upgrades (returns to inventory)
        await tx.delete(boatInstalledUpgrades)
          .where(eq(boatInstalledUpgrades.boatId, boatId));

        // 2. Mark boat as SOLD (soft-delete preserves history)
        await tx.update(boats)
          .set({ status: 'SOLD' })
          .where(eq(boats.id, boatId));

        // 3. Credit sell price to player
        if (sellPrice > 0) {
          await tx.update(players)
            .set({ credits: sql`${players.credits} + ${sellPrice}` })
            .where(eq(players.id, player.id));
        }
      });

      return {
        sold: true,
        sellPrice,
        creditsAfter: player.credits + sellPrice,
        returnedUpgrades,
        totalNm,
        palmares: {
          racesCount: boat.racesCount,
          wins: boat.wins,
          podiums: boat.podiums,
          top10Finishes: boat.top10Finishes,
        },
      };
    },
  );
```

- [ ] **Step 2: Vérifier la compilation**

Run: `cd apps/game-engine && npx tsc --noEmit`
Expected: aucune erreur

- [ ] **Step 3: Commit**

```bash
git add apps/game-engine/src/api/marina.ts
git commit -m "feat(marina): DELETE /boats/:id — sell boat with credit + upgrade return"
```

---

## Task 11 — Wire routes dans index.ts

**Files:**
- Modify: `apps/game-engine/src/index.ts`

- [ ] **Step 1: Importer et enregistrer les routes marina**

Dans `apps/game-engine/src/index.ts`, ajouter l'import :

```typescript
import { registerMarinaRoutes } from './api/marina.js';
```

Et dans la fonction `main()`, après `registerRaceRoutes(app)` :

```typescript
  registerMarinaRoutes(app);
```

- [ ] **Step 2: Vérifier la compilation complète**

Run: `cd apps/game-engine && npx tsc --noEmit`
Expected: aucune erreur

- [ ] **Step 3: Lancer les tests existants pour vérifier la non-régression**

Run: `cd apps/game-engine && node --import tsx --test src/engine/loadout.test.ts src/engine/bands.test.ts src/api/marina.helpers.test.ts`
Expected: tous PASS

- [ ] **Step 4: Commit**

```bash
git add apps/game-engine/src/index.ts
git commit -m "feat(marina): wire marina routes into game-engine server"
```

---

## Task 12 — E2E smoke test (inject)

**Files:**
- Create: `apps/game-engine/src/test/e2e-marina-api.ts`

- [ ] **Step 1: Écrire le script E2E avec app.inject()**

Créer `apps/game-engine/src/test/e2e-marina-api.ts` :

```typescript
/**
 * E2E smoke test for marina API endpoints.
 * Requires DATABASE_URL to be set (tests against real Postgres).
 *
 * Usage: npx tsx src/test/e2e-marina-api.ts
 */
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import assert from 'node:assert/strict';
import { GameBalance } from '@nemo/game-balance';
import { registerAuthRoutes } from '../api/auth.js';
import { registerMarinaRoutes } from '../api/marina.js';
import { getDb } from '../db/client.js';
import { players, boats } from '../db/schema.js';
import { eq } from 'drizzle-orm';

async function main() {
  await GameBalance.loadFromDisk();
  console.log('[e2e] game-balance loaded');

  const db = getDb();
  if (!db) {
    console.error('[e2e] DATABASE_URL not set — skipping marina E2E');
    process.exit(0);
  }

  const app = Fastify({ logger: false });
  await app.register(cookie);
  await app.register(cors, { origin: true, credentials: true });
  registerAuthRoutes(app);
  registerMarinaRoutes(app);

  // --- Setup: create a test player via dev-login ---
  const loginRes = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/dev-login',
    payload: { username: 'e2e-marina-test' },
  });
  assert.equal(loginRes.statusCode, 200);
  const { token } = loginRes.json();

  // Ensure the player exists in DB
  const [existing] = await db.select().from(players)
    .where(eq(players.cognitoSub, 'e2e-marina-test'));
  let playerId: string;
  if (existing) {
    playerId = existing.id;
    // Reset credits for clean test
    await db.update(players).set({ credits: 50000 }).where(eq(players.id, playerId));
  } else {
    const [p] = await db.insert(players).values({
      cognitoSub: 'e2e-marina-test',
      username: 'e2e-marina-test',
      email: 'e2e-marina@test.local',
      credits: 50000,
    }).returning();
    playerId = p!.id;
  }

  const authHeaders = { authorization: `Bearer ${token}` };

  // --- Test 1: GET /upgrades/catalog ---
  console.log('[e2e] GET /upgrades/catalog');
  const catalogRes = await app.inject({
    method: 'GET', url: '/api/v1/upgrades/catalog',
  });
  assert.equal(catalogRes.statusCode, 200);
  const catalogBody = catalogRes.json();
  assert.ok(catalogBody.items.length > 0, 'catalog should have items');
  assert.ok(catalogBody.slots.length === 7, 'should have 7 slots');
  console.log(`  ✓ ${catalogBody.items.length} items`);

  // --- Test 2: GET /upgrades/catalog?boatClass=FIGARO ---
  console.log('[e2e] GET /upgrades/catalog?boatClass=FIGARO');
  const figaroCat = await app.inject({
    method: 'GET', url: '/api/v1/upgrades/catalog?boatClass=FIGARO',
  });
  const figaroItems = figaroCat.json().items;
  assert.ok(figaroItems.every((i: { compat: string[] }) => i.compat.includes('FIGARO')));
  console.log(`  ✓ ${figaroItems.length} Figaro items`);

  // --- Test 3: POST /boats — create a hull ---
  console.log('[e2e] POST /boats');
  const createBoatRes = await app.inject({
    method: 'POST', url: '/api/v1/boats',
    headers: authHeaders,
    payload: { boatClass: 'CLASS40', name: 'E2E Mistral' },
  });
  assert.equal(createBoatRes.statusCode, 201);
  const boatId = createBoatRes.json().id;
  console.log(`  ✓ created boat ${boatId}`);

  // --- Test 4: POST /upgrades/purchase ---
  console.log('[e2e] POST /upgrades/purchase');
  const purchaseRes = await app.inject({
    method: 'POST', url: '/api/v1/upgrades/purchase',
    headers: authHeaders,
    payload: { itemId: 'foils-class40-c' },
  });
  assert.equal(purchaseRes.statusCode, 200);
  const upgradeId = purchaseRes.json().upgrade.id;
  console.log(`  ✓ purchased foils-class40-c → ${upgradeId}`);

  // --- Test 5: POST /boats/:id/install ---
  console.log('[e2e] POST /boats/:id/install');
  const installRes = await app.inject({
    method: 'POST', url: `/api/v1/boats/${boatId}/install`,
    headers: authHeaders,
    payload: { playerUpgradeId: upgradeId },
  });
  assert.equal(installRes.statusCode, 200);
  assert.equal(installRes.json().slot, 'FOILS');
  console.log('  ✓ installed foils on FOILS slot');

  // --- Test 6: GET /players/me/upgrades —check inventory ---
  console.log('[e2e] GET /players/me/upgrades');
  const invRes = await app.inject({
    method: 'GET', url: '/api/v1/players/me/upgrades',
    headers: authHeaders,
  });
  assert.equal(invRes.statusCode, 200);
  const inv = invRes.json().inventory;
  const foilsInv = inv.find((i: { id: string }) => i.id === upgradeId);
  assert.ok(foilsInv, 'purchased upgrade should appear in inventory');
  assert.equal(foilsInv.installedOn?.boatId, boatId);
  console.log(`  ✓ inventory has ${inv.length} item(s), foils installed on boat`);

  // --- Test 7: POST /boats/:id/uninstall ---
  console.log('[e2e] POST /boats/:id/uninstall');
  const uninstallRes = await app.inject({
    method: 'POST', url: `/api/v1/boats/${boatId}/uninstall`,
    headers: authHeaders,
    payload: { slot: 'FOILS' },
  });
  assert.equal(uninstallRes.statusCode, 200);
  assert.equal(uninstallRes.json().returnedToInventory, upgradeId);
  console.log('  ✓ uninstalled foils → back to inventory');

  // --- Test 8: POST /upgrades/buy-and-install ---
  console.log('[e2e] POST /upgrades/buy-and-install');
  const comboRes = await app.inject({
    method: 'POST', url: '/api/v1/upgrades/buy-and-install',
    headers: authHeaders,
    payload: { itemId: 'mast-class40-carbon', boatId },
  });
  assert.equal(comboRes.statusCode, 200);
  assert.equal(comboRes.json().installedOn.slot, 'MAST');
  console.log('  ✓ buy-and-install mast-class40-carbon');

  // --- Test 9: POST /boats/:id/repair (damage the boat first) ---
  console.log('[e2e] POST /boats/:id/repair');
  await db.update(boats).set({ hullCondition: 70, rigCondition: 80 }).where(eq(boats.id, boatId));
  const repairRes = await app.inject({
    method: 'POST', url: `/api/v1/boats/${boatId}/repair`,
    headers: authHeaders,
  });
  assert.equal(repairRes.statusCode, 200);
  assert.ok(repairRes.json().cost.total > 0);
  console.log(`  ✓ repair cost: ${repairRes.json().cost.total} cr`);

  // --- Test 10: DELETE /boats/:id (sell) ---
  console.log('[e2e] DELETE /boats/:id');
  const sellRes = await app.inject({
    method: 'DELETE', url: `/api/v1/boats/${boatId}`,
    headers: authHeaders,
  });
  assert.equal(sellRes.statusCode, 200);
  assert.equal(sellRes.json().sold, true);
  console.log(`  ✓ sold boat, price: ${sellRes.json().sellPrice} cr`);

  // --- Test 11: Lock check — create boat, simulate race, try install ---
  console.log('[e2e] Lock check: install on racing boat → 409');
  const [lockedBoat] = await db.insert(boats).values({
    ownerId: playerId,
    name: 'Locked Boat',
    boatClass: 'CLASS40',
    activeRaceId: 'r-fastnet-sprint',
  }).returning();
  const lockRes = await app.inject({
    method: 'POST', url: `/api/v1/boats/${lockedBoat!.id}/install`,
    headers: authHeaders,
    payload: { playerUpgradeId: upgradeId },
  });
  assert.equal(lockRes.statusCode, 409);
  console.log('  ✓ 409 Conflict on racing boat');

  // Cleanup: soft-delete the locked test boat
  await db.update(boats).set({ status: 'SOLD' }).where(eq(boats.id, lockedBoat!.id));

  await app.close();
  console.log('\n[e2e] ✅ All marina API tests passed');
}

main().catch((err) => {
  console.error('[e2e] ❌ FAIL:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Lancer le E2E (nécessite DATABASE_URL)**

Run: `cd apps/game-engine && npx tsx src/test/e2e-marina-api.ts`
Expected: tous les tests ✓, message final « All marina API tests passed »

Si `DATABASE_URL` n'est pas défini, le script skip gracieusement avec exit 0.

- [ ] **Step 3: Commit**

```bash
git add apps/game-engine/src/test/e2e-marina-api.ts
git commit -m "test(marina): E2E smoke test for all 9 marina API endpoints"
```

---

## Récapitulatif des endpoints

| # | Méthode | Route | Auth | Lock | Task |
|---|---------|-------|------|------|------|
| 1 | `GET` | `/api/v1/upgrades/catalog` | ❌ | — | 3 |
| 2 | `GET` | `/api/v1/players/me/upgrades` | ✅ | — | 4 |
| 3 | `POST` | `/api/v1/upgrades/purchase` | ✅ | — | 6 |
| 4 | `POST` | `/api/v1/upgrades/buy-and-install` | ✅ | ✅ | 8 |
| 5 | `POST` | `/api/v1/boats` | ✅ | — | 5 |
| 6 | `POST` | `/api/v1/boats/:id/install` | ✅ | ✅ | 7 |
| 7 | `POST` | `/api/v1/boats/:id/uninstall` | ✅ | ✅ | 7 |
| 8 | `POST` | `/api/v1/boats/:id/repair` | ✅ | ✅ | 9 |
| 9 | `DELETE` | `/api/v1/boats/:id` | ✅ | ✅ | 10 |

## Codes d'erreur

| Code | Signification | Utilisé par |
|------|---------------|-------------|
| `400` | Paramètre invalide, solde insuffisant, slot incompatible, SERIE non-achetable | tous |
| `401` | Token manquant ou invalide | routes auth |
| `403` | Critères Proto non remplis | purchase, buy-and-install |
| `404` | Joueur/bateau/upgrade/item introuvable | tous |
| `409` | Bateau en course (lock check) ou upgrade déjà installée | install, uninstall, repair, sell, buy-and-install |
| `503` | Database indisponible | tous |
