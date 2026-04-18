import { and, eq } from 'drizzle-orm';
import pino from 'pino';
import type { DbClient } from './client.js';
import { players, boats, playerUpgrades, boatInstalledUpgrades } from './schema.js';

const log = pino({ name: 'db.seed-dev' });

/**
 * Seed the local dev player, its boats and a starter inventory.
 * Idempotent: runs only if the dev player has no active boats yet.
 * Credits are always reset to 50000 to keep dev iterations snappy.
 */
export async function seedDevPlayer(db: DbClient): Promise<void> {
  // 1. Upsert the dev player
  const [existing] = await db.select().from(players).where(eq(players.cognitoSub, 'dev'));

  let playerId: string;
  if (existing) {
    playerId = existing.id;
    await db.update(players).set({ credits: 50000 }).where(eq(players.id, playerId));
    log.info({ playerId }, 'dev player credits reset to 50000');
  } else {
    const [created] = await db.insert(players).values({
      cognitoSub: 'dev',
      username: 'dev',
      email: 'dev@nemo.local',
      credits: 50000,
      racesFinished: 18,
      wins: 2,
      podiums: 5,
      top10Finishes: 9,
      avgRankPct: 0.35,
      totalNm: 8420,
    }).returning();
    playerId = created!.id;
    log.info({ playerId }, 'dev player created');
  }

  // 2. If the dev player already has active boats, stop here (no duplicates)
  const existingBoats = await db.select().from(boats)
    .where(and(eq(boats.ownerId, playerId), eq(boats.status, 'ACTIVE')));
  if (existingBoats.length > 0) {
    log.info({ count: existingBoats.length }, 'dev player already has boats — skip seeding');
    return;
  }

  // 3. Create a small realistic fleet: 1 in race, 1 at port, 1 damaged
  const [albatros] = await db.insert(boats).values({
    ownerId: playerId,
    name: 'Albatros',
    boatClass: 'CLASS40',
    hullColor: '#1a2840',
    activeRaceId: 'r-fastnet-sprint',
    racesCount: 12,
    wins: 0,
    podiums: 2,
    top10Finishes: 5,
    hullCondition: 78,
    rigCondition: 92,
    sailCondition: 85,
    elecCondition: 100,
  }).returning();

  const [mistral] = await db.insert(boats).values({
    ownerId: playerId,
    name: 'Mistral',
    boatClass: 'CLASS40',
    hullColor: '#2d4a6f',
    racesCount: 8,
    wins: 1,
    podiums: 1,
    top10Finishes: 3,
    hullCondition: 100,
    rigCondition: 100,
    sailCondition: 100,
    elecCondition: 100,
  }).returning();

  await db.insert(boats).values({
    ownerId: playerId,
    name: 'Sirocco',
    boatClass: 'FIGARO',
    hullColor: '#8b0000',
    racesCount: 22,
    wins: 3,
    podiums: 5,
    top10Finishes: 12,
    hullCondition: 65,
    rigCondition: 70,
    sailCondition: 50,
    elecCondition: 90,
  }).returning();

  // 4. Grant a starter inventory of upgrades (ADMIN_GRANT = no credits spent)
  const starterItems = [
    'foils-class40-c',              // will be installed on Albatros
    'mast-class40-carbon',          // will be installed on Mistral
    'sails-class40-mylar',          // stays in inventory
    'reinforcement-heavy-weather',  // stays in inventory
    'electronics-pack-race',        // stays in inventory
  ];

  const granted: { id: string; upgradeCatalogId: string }[] = [];
  for (const itemId of starterItems) {
    const [row] = await db.insert(playerUpgrades).values({
      playerId,
      upgradeCatalogId: itemId,
      acquisitionSource: 'ADMIN_GRANT',
      paidCredits: 0,
    }).returning();
    granted.push(row!);
  }

  // 5. Install 2 of them on boats to showcase the slot system
  const foils = granted.find((g) => g.upgradeCatalogId === 'foils-class40-c');
  if (foils) {
    await db.insert(boatInstalledUpgrades).values({
      boatId: albatros!.id,
      slot: 'FOILS',
      playerUpgradeId: foils.id,
    });
  }
  const mast = granted.find((g) => g.upgradeCatalogId === 'mast-class40-carbon');
  if (mast) {
    await db.insert(boatInstalledUpgrades).values({
      boatId: mistral!.id,
      slot: 'MAST',
      playerUpgradeId: mast.id,
    });
  }

  log.info({
    boats: 3,
    inventory: granted.length,
    installed: 2,
  }, 'dev player fleet seeded');
}
