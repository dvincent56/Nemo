import type { FastifyInstance } from 'fastify';
import { eq, and, sql, inArray } from 'drizzle-orm';
import { GameBalance, type UpgradeItem, type UpgradeSlot, type UpgradeTier } from '@nemo/game-balance';
import type { BoatClass } from '@nemo/shared-types';
import { enforceAuth } from '../auth/cognito.js';
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
  type UnlockCriteria,
} from './marina.helpers.js';

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
  installedItems: { slot: string; catalogItem: UpgradeItem | undefined }[],
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

    // Which of the player's upgrades are currently installed?
    const ownedIds = owned.map((pu) => pu.id);
    const installed = ownedIds.length > 0
      ? await db.select({
          playerUpgradeId: boatInstalledUpgrades.playerUpgradeId,
          boatId: boatInstalledUpgrades.boatId,
          slot: boatInstalledUpgrades.slot,
        }).from(boatInstalledUpgrades)
          .where(inArray(boatInstalledUpgrades.playerUpgradeId, ownedIds))
      : [];

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

  // =========================================================================
  // GET /api/v1/players/me/boats — AUTHENTICATED
  // =========================================================================

  app.get('/api/v1/players/me/boats', { preHandler: [enforceAuth] }, async (req, reply) => {
    const auth = req.auth!;
    const db = getDb();
    if (!db) { reply.code(503); return { error: 'database unavailable' }; }

    const player = await findPlayerBySub(db, auth.sub);
    if (!player) { reply.code(404); return { error: 'player not found' }; }

    const playerBoats = await db.select().from(boats)
      .where(and(eq(boats.ownerId, player.id), eq(boats.status, 'ACTIVE')));

    return { boats: playerBoats, credits: player.credits };
  });

  // =========================================================================
  // GET /api/v1/boats/:id — AUTHENTICATED
  // =========================================================================

  app.get<{ Params: { id: string } }>(
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

      const installedUpgrades = await loadInstalledWithCatalog(db, boatId);

      return {
        boat,
        installedUpgrades: installedUpgrades.map((u) => ({
          slot: u.slot,
          playerUpgradeId: u.playerUpgradeId,
          catalogId: u.catalogId,
          name: u.catalogItem?.name ?? u.catalogId,
          tier: u.catalogItem?.tier ?? 'SERIE',
          profile: u.catalogItem?.profile ?? '',
          effects: u.catalogItem?.effects ?? null,
        })),
        credits: player.credits,
      };
    },
  );

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
        if (!meetsUnlockCriteria(item.unlockCriteria as UnlockCriteria, player)) {
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
        if (!meetsUnlockCriteria(item.unlockCriteria as UnlockCriteria, player)) {
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
        GameBalance.upgrades.tiers,
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

  // =========================================================================
  // DELETE /api/v1/boats/:id — sell boat (irreversible)
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

  // =========================================================================
  // DELETE /api/v1/upgrades/:id — sell an owned upgrade back to credits
  // Refund = paidCredits × buybackUpgradePct% (floor). 0 for admin-granted items.
  // =========================================================================

  app.delete<{ Params: { id: string } }>(
    '/api/v1/upgrades/:id',
    { preHandler: [enforceAuth] },
    async (req, reply) => {
      const auth = req.auth!;
      const db = getDb();
      if (!db) { reply.code(503); return { error: 'database unavailable' }; }

      const upgradeId = req.params.id;
      if (!isValidUuid(upgradeId)) { reply.code(400); return { error: 'invalid upgrade id' }; }

      const player = await findPlayerBySub(db, auth.sub);
      if (!player) { reply.code(404); return { error: 'player not found' }; }

      // Verify ownership
      const [pu] = await db.select().from(playerUpgrades).where(
        and(eq(playerUpgrades.id, upgradeId), eq(playerUpgrades.playerId, player.id)),
      );
      if (!pu) { reply.code(404); return { error: 'upgrade not found in inventory' }; }

      // Must not be installed anywhere (CASCADE would silently take it off a boat)
      const [installed] = await db.select().from(boatInstalledUpgrades)
        .where(eq(boatInstalledUpgrades.playerUpgradeId, upgradeId));
      if (installed) {
        reply.code(409);
        return { error: 'upgrade installed on a boat — uninstall first', boatId: installed.boatId, slot: installed.slot };
      }

      const refund = Math.floor(pu.paidCredits * GameBalance.economy.buybackUpgradePct / 100);

      await db.transaction(async (tx) => {
        await tx.delete(playerUpgrades).where(eq(playerUpgrades.id, upgradeId));
        if (refund > 0) {
          await tx.update(players)
            .set({ credits: sql`${players.credits} + ${refund}` })
            .where(eq(players.id, player.id));
        }
      });

      return {
        sold: true,
        refund,
        creditsAfter: player.credits + refund,
      };
    },
  );

}
