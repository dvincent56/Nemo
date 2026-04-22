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

  // --- Test 6: GET /players/me/upgrades — check inventory ---
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

  // --- Test 9: DELETE /boats/:id (sell) ---
  console.log('[e2e] DELETE /boats/:id');
  const sellRes = await app.inject({
    method: 'DELETE', url: `/api/v1/boats/${boatId}`,
    headers: authHeaders,
  });
  assert.equal(sellRes.statusCode, 200);
  assert.equal(sellRes.json().sold, true);
  console.log(`  ✓ sold boat, price: ${sellRes.json().sellPrice} cr`);

  // --- Test 10: Lock check — create boat, simulate race, try install ---
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
