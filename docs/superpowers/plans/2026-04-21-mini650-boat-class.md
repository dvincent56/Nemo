# Mini 6.50 Boat Class Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Mini 6.50 as a new playable `BoatClass` (`MINI650`) with its polars, slot configuration, upgrade items, and economy/maneuver tuning — positioned as the entry-level offshore boat between `CRUISER_RACER` and `FIGARO`.

**Architecture:** Pure data + type extension. Add `MINI650` to the `BoatClass` union (TypeScript) and the `BoatClassZ` Zod enum (validation), then fill the resulting holes in every `Record<BoatClass, X>` (game-balance config, polar registries). Generate the polar JSON from the 7 CSV files in `tmp/mini-6.50/` using the existing `scripts/convert-polar-csv.mjs`. Add 7 new upgrade items + extend `compat` on 4 existing items for shared electronics/sails.

**Tech Stack:** TypeScript strict, Zod schemas, Node 22 + `node:test` for polar-lib tests, pnpm/Turborepo monorepo.

**Spec reference:** [docs/superpowers/specs/2026-04-21-mini650-boat-class-design.md](../specs/2026-04-21-mini650-boat-class-design.md)

---

## File Structure

**Files created:**
- `apps/web/public/data/polars/mini650.json` (generated, ~1 MB) — polar data for browser
- `packages/polar-lib/polars/mini650.json` (copy of above) — polar data for engine
- `packages/polar-lib/src/index.test.ts` (small) — load test for the new polar

**Files modified:**
- `packages/shared-types/src/index.ts:1` — add `'MINI650'` to `BoatClass` union
- `packages/game-balance/src/upgrade-catalog.schema.ts:9` — add `'MINI650'` to `BoatClassZ` Zod enum
- `apps/web/src/lib/polar.ts:11-18` — register `MINI650` in `POLAR_FILES`
- `packages/polar-lib/src/index.ts:13-20` — register `MINI650` in `POLAR_FILES`
- `packages/game-balance/game-balance.json` — add MINI650 entries + 7 new items + extend 4 compat arrays
- `apps/web/public/data/game-balance.json` — same as above (manually kept in sync)

**Note on duplicates:** `game-balance.json` exists in two locations (source-of-truth in `packages/game-balance/`, served copy in `apps/web/public/data/`). They've already drifted on the `swell` block — that pre-existing divergence is **not in scope**. We add MINI650 to both, leaving the rest untouched.

---

## Task 1: Generate the MINI650 polar JSON

The 7 CSV files in `tmp/mini-6.50/` need to be merged into a single `mini650.json`. The existing converter `scripts/convert-polar-csv.mjs` already does CSV → JSON with a `--merge` flag — we run it 7 times, once per sail.

**Files:**
- Read: `tmp/mini-6.50/{jib,lightJib,stay,c0,spi,hg,lg}` (7 CSVs)
- Create: `apps/web/public/data/polars/mini650.json`
- Create: `packages/polar-lib/polars/mini650.json` (copy of above)

- [ ] **Step 1.1: Run converter for the JIB sail (creates the file)**

```bash
node scripts/convert-polar-csv.mjs \
  tmp/mini-6.50/jib \
  apps/web/public/data/polars/mini650.json \
  --boat MINI650 --sail JIB
```

Expected stdout: `Wrote apps/web/public/data/polars/mini650.json — sail=JIB, TWA=181 pts, TWS=71 pts`

- [ ] **Step 1.2: Run converter for the 6 remaining sails (merge mode)**

```bash
node scripts/convert-polar-csv.mjs tmp/mini-6.50/lightJib apps/web/public/data/polars/mini650.json --boat MINI650 --sail LJ  --merge apps/web/public/data/polars/mini650.json
node scripts/convert-polar-csv.mjs tmp/mini-6.50/stay     apps/web/public/data/polars/mini650.json --boat MINI650 --sail SS  --merge apps/web/public/data/polars/mini650.json
node scripts/convert-polar-csv.mjs tmp/mini-6.50/c0       apps/web/public/data/polars/mini650.json --boat MINI650 --sail C0  --merge apps/web/public/data/polars/mini650.json
node scripts/convert-polar-csv.mjs tmp/mini-6.50/spi      apps/web/public/data/polars/mini650.json --boat MINI650 --sail SPI --merge apps/web/public/data/polars/mini650.json
node scripts/convert-polar-csv.mjs tmp/mini-6.50/hg       apps/web/public/data/polars/mini650.json --boat MINI650 --sail HG  --merge apps/web/public/data/polars/mini650.json
node scripts/convert-polar-csv.mjs tmp/mini-6.50/lg       apps/web/public/data/polars/mini650.json --boat MINI650 --sail LG  --merge apps/web/public/data/polars/mini650.json
```

After the last command, expected stdout ends with: `Sails populated: JIB, LJ, SS, C0, SPI, HG, LG`

- [ ] **Step 1.3: Verify file shape with a one-liner**

Run:
```bash
node -e "const p=require('./apps/web/public/data/polars/mini650.json'); console.log({boatClass:p.boatClass, twa:p.twa.length, tws:p.tws.length, sails:Object.keys(p.speeds), sample:p.speeds.JIB[40][12]});"
```

Expected output (sample is JIB at TWA=40°, TWS=12kt, ~5 knots):
```
{ boatClass: 'MINI650', twa: 181, tws: 71, sails: [ 'JIB', 'LJ', 'SS', 'C0', 'SPI', 'HG', 'LG' ], sample: <number around 4-6> }
```

If `sample` is ~0 or > 10, something is wrong with the conversion — investigate before continuing.

- [ ] **Step 1.4: Copy the polar to packages/polar-lib**

```bash
cp apps/web/public/data/polars/mini650.json packages/polar-lib/polars/mini650.json
```

- [ ] **Step 1.5: Commit**

```bash
git add apps/web/public/data/polars/mini650.json packages/polar-lib/polars/mini650.json
git commit -m "feat(polar): add Mini 6.50 polar JSON generated from tmp CSVs"
```

---

## Task 2: Extend the BoatClass type and Zod enum

Add `'MINI650'` to both the TypeScript union (forces compile-time completion of every `Record<BoatClass, X>`) and the runtime Zod enum (forces validation of game-balance.json on load). Both must change in the same commit because the engine validates against the Zod enum at startup.

**Files:**
- Modify: `packages/shared-types/src/index.ts:1`
- Modify: `packages/game-balance/src/upgrade-catalog.schema.ts:9`

- [ ] **Step 2.1: Add MINI650 to the BoatClass union**

In `packages/shared-types/src/index.ts:1`, change:

```ts
export type BoatClass = 'CRUISER_RACER' | 'FIGARO' | 'CLASS40' | 'OCEAN_FIFTY' | 'IMOCA60' | 'ULTIM';
```

to:

```ts
export type BoatClass = 'CRUISER_RACER' | 'MINI650' | 'FIGARO' | 'CLASS40' | 'OCEAN_FIFTY' | 'IMOCA60' | 'ULTIM';
```

- [ ] **Step 2.2: Add MINI650 to the BoatClassZ Zod enum**

In `packages/game-balance/src/upgrade-catalog.schema.ts:9`, change:

```ts
export const BoatClassZ = z.enum(['CRUISER_RACER', 'FIGARO', 'CLASS40', 'OCEAN_FIFTY', 'IMOCA60', 'ULTIM']);
```

to:

```ts
export const BoatClassZ = z.enum(['CRUISER_RACER', 'MINI650', 'FIGARO', 'CLASS40', 'OCEAN_FIFTY', 'IMOCA60', 'ULTIM']);
```

- [ ] **Step 2.3: Run typecheck — expect failures**

```bash
pnpm typecheck
```

Expected: TypeScript errors in files using `Record<BoatClass, X>` because `MINI650` is now a missing key. Typical errors point to `apps/web/src/lib/polar.ts`, `packages/polar-lib/src/index.ts`, and the game-balance loader (which casts JSON to `GameBalanceConfig`). These will be fixed in subsequent tasks. Do **not** commit yet — the type change is a setup move that needs the rest of the plan to compile.

---

## Task 3: Register MINI650 in both polar registries

Two `POLAR_FILES` records need a new entry. Both must pass typecheck after this task because `Record<BoatClass, string>` enforces completion.

**Files:**
- Modify: `apps/web/src/lib/polar.ts:11-18`
- Modify: `packages/polar-lib/src/index.ts:13-20`

- [ ] **Step 3.1: Register MINI650 in the web polar registry**

In `apps/web/src/lib/polar.ts:11-18`, change:

```ts
const POLAR_FILES: Record<BoatClass, string> = {
  CRUISER_RACER: 'cruiser-racer.json',
  FIGARO: 'figaro.json',
  CLASS40: 'class40.json',
  OCEAN_FIFTY: 'ocean-fifty.json',
  IMOCA60: 'imoca60.json',
  ULTIM: 'ultim.json',
};
```

to:

```ts
const POLAR_FILES: Record<BoatClass, string> = {
  CRUISER_RACER: 'cruiser-racer.json',
  MINI650: 'mini650.json',
  FIGARO: 'figaro.json',
  CLASS40: 'class40.json',
  OCEAN_FIFTY: 'ocean-fifty.json',
  IMOCA60: 'imoca60.json',
  ULTIM: 'ultim.json',
};
```

- [ ] **Step 3.2: Register MINI650 in the polar-lib registry**

In `packages/polar-lib/src/index.ts:13-20`, apply the exact same change (insert `MINI650: 'mini650.json',` between `CRUISER_RACER` and `FIGARO`).

- [ ] **Step 3.3: Add a load test for MINI650 polar**

Create `packages/polar-lib/src/index.test.ts` with:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPolar } from './index.js';

test('loadPolar(MINI650) returns the 7 sails with expected axis lengths', async () => {
  const polar = await loadPolar('MINI650');
  assert.equal(polar.boatClass, 'MINI650');
  assert.equal(polar.twa.length, 181);
  assert.equal(polar.tws.length, 71);
  const sails = Object.keys(polar.speeds).sort();
  assert.deepEqual(sails, ['C0', 'HG', 'JIB', 'LG', 'LJ', 'SPI', 'SS']);
});

test('loadPolar(MINI650) returns a non-zero JIB speed at typical close-hauled point', async () => {
  const polar = await loadPolar('MINI650');
  // JIB at TWA=40, TWS=12 should be a meaningful upwind speed
  const speed = polar.speeds.JIB?.[40]?.[12] ?? 0;
  assert.ok(speed > 2 && speed < 10, `expected 2 < speed < 10, got ${speed}`);
});

test('loadPolar(MINI650) returns 0 in the dead zone (TWA=0)', async () => {
  const polar = await loadPolar('MINI650');
  const speed = polar.speeds.JIB?.[0]?.[10] ?? -1;
  assert.equal(speed, 0);
});
```

- [ ] **Step 3.4: Run the new tests**

```bash
pnpm --filter @nemo/polar-lib test
```

Expected: all 3 tests pass.

If they fail because of a missing `MINI650` enum somewhere (e.g. typecheck error in the test file), check that Step 2.1 was applied. Don't commit until tests are green.

- [ ] **Step 3.5: Commit type-system + registries + test**

```bash
git add packages/shared-types/src/index.ts \
        packages/game-balance/src/upgrade-catalog.schema.ts \
        apps/web/src/lib/polar.ts \
        packages/polar-lib/src/index.ts \
        packages/polar-lib/src/index.test.ts
git commit -m "feat(boats): register MINI650 in BoatClass union and polar registries"
```

Note: `pnpm typecheck` is still red at this point because game-balance.json doesn't yet contain MINI650 entries. That's expected and gets fixed in Task 4.

---

## Task 4: Add MINI650 entries to game-balance.json (both files)

Add the slot config, distance rate, completion bonus, and three maneuver durations. After this task, `pnpm typecheck` should be **green** (no upgrade items are required by Zod schemas — `slotsByClass` validation passes even with zero items, the Zod check is per-key only).

**Files:**
- Modify: `packages/game-balance/game-balance.json`
- Modify: `apps/web/public/data/game-balance.json`

The exact same edits apply to both files — the structure of the keys we touch is identical even though the `swell` block has drifted (we leave that alone).

- [ ] **Step 4.1: Add MINI650 to rewards.distanceRates**

In both files, locate the block:

```json
"distanceRates": {
  "CRUISER_RACER": 0.5,
  "FIGARO": 0.8,
  ...
}
```

Insert `"MINI650": 0.6,` between `CRUISER_RACER` and `FIGARO`:

```json
"distanceRates": {
  "CRUISER_RACER": 0.5,
  "MINI650": 0.6,
  "FIGARO": 0.8,
  "CLASS40": 1.0,
  "OCEAN_FIFTY": 1.6,
  "IMOCA60": 1.4,
  "ULTIM": 2.0
},
```

- [ ] **Step 4.2: Add MINI650 to economy.completionBonus**

In both files, change:

```json
"completionBonus": {
  "CRUISER_RACER": 200,
  "FIGARO": 400, "CLASS40": 600, "OCEAN_FIFTY": 1000,
  "IMOCA60": 900, "ULTIM": 1400
}
```

to:

```json
"completionBonus": {
  "CRUISER_RACER": 200,
  "MINI650": 300,
  "FIGARO": 400, "CLASS40": 600, "OCEAN_FIFTY": 1000,
  "IMOCA60": 900, "ULTIM": 1400
}
```

- [ ] **Step 4.3: Add MINI650 to all three maneuvers blocks**

In both files, in `maneuvers.sailChange.transitionTimeSec`, insert `"MINI650": 150,`:

```json
"transitionTimeSec": {
  "CRUISER_RACER": 240,
  "MINI650": 150,
  "FIGARO": 180,
  "CLASS40": 240,
  "OCEAN_FIFTY": 300,
  "IMOCA60": 300,
  "ULTIM": 360
}
```

In `maneuvers.tack.durationSec`, insert `"MINI650": 45,`:

```json
"durationSec": {
  "CRUISER_RACER": 75,
  "MINI650": 45,
  "FIGARO": 60,
  "CLASS40": 90,
  "OCEAN_FIFTY": 150,
  "IMOCA60": 120,
  "ULTIM": 180
}
```

In `maneuvers.gybe.durationSec`, insert `"MINI650": 70,`:

```json
"durationSec": {
  "CRUISER_RACER": 100,
  "MINI650": 70,
  "FIGARO": 90,
  "CLASS40": 120,
  "OCEAN_FIFTY": 200,
  "IMOCA60": 150,
  "ULTIM": 240
}
```

- [ ] **Step 4.4: Add MINI650 to upgrades.slotsByClass**

In both files, in `upgrades.slotsByClass`, insert this entry between `CRUISER_RACER` and `FIGARO`:

```json
"MINI650":     { "HULL": "monotype", "MAST": "monotype", "SAILS": "open",
                 "FOILS": "open", "KEEL": "monotype",
                 "ELECTRONICS": "open", "REINFORCEMENT": "absent" },
```

- [ ] **Step 4.5: Verify typecheck and game-balance load**

```bash
pnpm typecheck
```

Expected: green (no errors).

```bash
pnpm --filter @nemo/game-balance test 2>&1 | tail -20
```

If `@nemo/game-balance` has no test script, instead spot-check the load:

```bash
node --import tsx -e "import('./packages/game-balance/src/index.ts').then(m => m.GameBalance.loadFromDisk()).then(() => console.log('OK'))"
```

Expected: `OK`. If the script throws a Zod validation error, re-check that the `BoatClassZ` enum in Step 2.2 contains `MINI650` and that the JSON edits in 4.1–4.4 are well-formed.

- [ ] **Step 4.6: Commit**

```bash
git add packages/game-balance/game-balance.json apps/web/public/data/game-balance.json
git commit -m "feat(game-balance): add MINI650 entries (slots, economy, maneuvers)"
```

---

## Task 5: Add the 7 new MINI650 upgrade items + extend compat on 4 existing items

Same edits applied to both `game-balance.json` files. We append new items to the `upgrades.items` array and extend `compat` arrays of 4 existing items.

**Files:**
- Modify: `packages/game-balance/game-balance.json` (`upgrades.items` array)
- Modify: `apps/web/public/data/game-balance.json` (same)

- [ ] **Step 5.1: Append the 7 new MINI650 items to upgrades.items**

In both files, locate the end of the `upgrades.items` array (just before `]`, which is followed by the `}` closing the `upgrades` block) and insert the 7 items below. They go right after the last existing item (`foils-ultim-standard`):

```json
,
{
  "id": "hull-mini650-monotype",
  "slot": "HULL",
  "tier": "SERIE",
  "name": "Coque Mini 6.50 Série",
  "profile": "réglementaire",
  "description": "Coque de série Mini 6.50, conforme aux règles de jauge Série.",
  "compat": ["MINI650"],
  "cost": 0,
  "effects": {
    "speedByTwa": [0, 0, 0, 0, 0],
    "speedByTws": [0, 0, 0],
    "wearMul": {},
    "maneuverMul": {},
    "polarTargetsDeg": null,
    "activation": {},
    "groundingLossMul": null
  }
},
{
  "id": "mast-mini650-monotype",
  "slot": "MAST",
  "tier": "SERIE",
  "name": "Mât Mini 6.50 Série",
  "profile": "réglementaire",
  "description": "Mât aluminium de série Mini 6.50.",
  "compat": ["MINI650"],
  "cost": 0,
  "effects": {
    "speedByTwa": [0, 0, 0, 0, 0],
    "speedByTws": [0, 0, 0],
    "wearMul": {},
    "maneuverMul": {},
    "polarTargetsDeg": null,
    "activation": {},
    "groundingLossMul": null
  }
},
{
  "id": "keel-mini650-monotype",
  "slot": "KEEL",
  "tier": "SERIE",
  "name": "Quille Mini 6.50 Série",
  "profile": "fixe à bulbe",
  "description": "Quille fixe à bulbe, conforme à la jauge Mini Série.",
  "compat": ["MINI650"],
  "cost": 0,
  "effects": {
    "speedByTwa": [0, 0, 0, 0, 0],
    "speedByTws": [0, 0, 0],
    "wearMul": {},
    "maneuverMul": {},
    "polarTargetsDeg": null,
    "activation": {},
    "groundingLossMul": null
  }
},
{
  "id": "foils-mini650-none",
  "slot": "FOILS",
  "tier": "SERIE",
  "name": "Sans Foils Mini 6.50",
  "profile": "coque seule",
  "description": "Configuration sans foils, coque pure en mode déplacement.",
  "compat": ["MINI650"],
  "cost": 0,
  "effects": {
    "speedByTwa": [0, 0, 0, 0, 0],
    "speedByTws": [0, 0, 0],
    "wearMul": {},
    "maneuverMul": {},
    "polarTargetsDeg": null,
    "activation": {},
    "groundingLossMul": null
  }
},
{
  "id": "foils-mini650-lateral",
  "slot": "FOILS",
  "tier": "BRONZE",
  "name": "Foils Latéraux Mini 6.50",
  "profile": "reaching modeste",
  "description": "Petits foils latéraux Mini Proto, gain léger au reaching dès 14 nds.",
  "compat": ["MINI650"],
  "cost": 3000,
  "effects": {
    "speedByTwa": [-0.01, 0, 0.04, 0.03, 0],
    "speedByTws": [0, 0.01, 0.02],
    "wearMul": { "hull": 1.30, "rig": 1.15 },
    "maneuverMul": {},
    "polarTargetsDeg": null,
    "activation": { "minTws": 14 },
    "groundingLossMul": null,
    "passiveEffects": {
      "speedByTws": [-0.02, 0, 0]
    }
  }
},
{
  "id": "sails-mini650-dacron",
  "slot": "SAILS",
  "tier": "SERIE",
  "name": "Voiles Dacron Mini 6.50",
  "profile": "polyvalent",
  "description": "Jeu Dacron de série, polyvalent et durable.",
  "compat": ["MINI650"],
  "cost": 0,
  "effects": {
    "speedByTwa": [0, 0, 0, 0, 0],
    "speedByTws": [0, 0, 0],
    "wearMul": {},
    "maneuverMul": {},
    "polarTargetsDeg": null,
    "activation": {},
    "groundingLossMul": null
  }
},
{
  "id": "sails-mini650-cert",
  "slot": "SAILS",
  "tier": "BRONZE",
  "name": "Voiles Certifiées Classe Mini",
  "profile": "rendement classe",
  "description": "Voiles certifiées classe Mini, meilleur rendement dans les limites du règlement.",
  "compat": ["MINI650"],
  "cost": 2200,
  "effects": {
    "speedByTwa": [0.02, 0.02, 0.03, 0.02, 0.01],
    "speedByTws": [0.01, 0.02, 0.01],
    "wearMul": { "sail": 1.20 },
    "maneuverMul": {},
    "polarTargetsDeg": null,
    "activation": {},
    "groundingLossMul": null
  }
}
```

(The leading `,` is essential — it separates this block from the previous last item.)

- [ ] **Step 5.2: Extend compat on 4 existing items**

In both files, find each item below and add `"MINI650"` to its `compat` array.

Item `sails-class40-mylar` — change `"compat": ["CLASS40", "IMOCA60"],` to `"compat": ["CLASS40", "IMOCA60", "MINI650"],`

Item `electronics-pack-base` — change `"compat": ["FIGARO", "CLASS40", "OCEAN_FIFTY", "IMOCA60", "ULTIM"],` to `"compat": ["FIGARO", "CLASS40", "OCEAN_FIFTY", "IMOCA60", "ULTIM", "MINI650"],`

Item `electronics-pack-race` — same compat extension as `electronics-pack-base`.

Item `electronics-pack-offshore` — same compat extension as `electronics-pack-base`.

- [ ] **Step 5.3: Verify game-balance loads + Zod validates the new items**

```bash
node --import tsx -e "import('./packages/game-balance/src/index.ts').then(m => m.GameBalance.loadFromDisk()).then(() => { const gb = require('./packages/game-balance/game-balance.json'); const mini = gb.upgrades.items.filter(i => i.compat.includes('MINI650')); console.log('MINI650-compatible items:', mini.length); console.log('IDs:', mini.map(i => i.id).join(', ')); })"
```

Expected output:
```
MINI650-compatible items: 11
IDs: hull-mini650-monotype, mast-mini650-monotype, keel-mini650-monotype, foils-mini650-none, foils-mini650-lateral, sails-mini650-dacron, sails-mini650-cert, sails-class40-mylar, electronics-pack-base, electronics-pack-race, electronics-pack-offshore
```

If the count is not 11 or the loader throws, re-check the JSON syntax (trailing commas, quote escaping).

- [ ] **Step 5.4: Verify slot coverage (every non-absent slot has ≥1 SERIE item compat MINI650)**

The MINI650 slot config has 6 non-absent slots: HULL, MAST, KEEL, FOILS, SAILS, ELECTRONICS. Each must have at least one SERIE item compatible with MINI650.

```bash
node -e "const gb = require('./packages/game-balance/game-balance.json'); const slots = ['HULL','MAST','KEEL','FOILS','SAILS','ELECTRONICS']; for (const s of slots) { const items = gb.upgrades.items.filter(i => i.slot === s && i.tier === 'SERIE' && i.compat.includes('MINI650')); console.log(s + ':', items.length, items.map(i=>i.id).join('|')); }"
```

Expected output (all counts ≥ 1):
```
HULL: 1 hull-mini650-monotype
MAST: 1 mast-mini650-monotype
KEEL: 1 keel-mini650-monotype
FOILS: 1 foils-mini650-none
SAILS: 1 sails-mini650-dacron
ELECTRONICS: 1 electronics-pack-base
```

- [ ] **Step 5.5: Commit**

```bash
git add packages/game-balance/game-balance.json apps/web/public/data/game-balance.json
git commit -m "feat(upgrades): add MINI650 upgrade items and extend compat on shared items"
```

---

## Task 6: End-to-end verification

Final checks: full typecheck, full test suite, and a smoke test of polar loading from the web bundle.

**Files:** none modified.

- [ ] **Step 6.1: Full monorepo typecheck**

```bash
pnpm typecheck
```

Expected: green across all packages and apps.

- [ ] **Step 6.2: Full test suite for the affected packages**

```bash
pnpm --filter @nemo/polar-lib test
pnpm --filter @nemo/game-balance test
pnpm --filter @nemo/game-engine test
```

Expected: all green. (`@nemo/game-balance` may have no `test` script — that's fine, skip silently.)

- [ ] **Step 6.3: Lint**

```bash
pnpm lint
```

Expected: no new warnings related to MINI650 (the JSON additions don't go through eslint, only the TS edits).

- [ ] **Step 6.4: Quick smoke test — game-balance + polar loadable together**

```bash
node --import tsx -e "
import('./packages/game-balance/src/index.ts').then(async (m) => {
  await m.GameBalance.loadFromDisk();
  console.log('distanceRate:', m.GameBalance.rewards.distanceRates.MINI650);
  console.log('completionBonus:', m.GameBalance.economy.completionBonus.MINI650);
  console.log('tack duration:', m.GameBalance.maneuvers.tack.durationSec.MINI650);
  console.log('slot config:', m.GameBalance.upgrades.slotsByClass.MINI650);
  const polar = await import('./packages/polar-lib/src/index.ts').then(p => p.loadPolar('MINI650'));
  console.log('polar OK, sails:', Object.keys(polar.speeds).join(','));
});"
```

Expected:
```
distanceRate: 0.6
completionBonus: 300
tack duration: 45
slot config: { HULL: 'monotype', MAST: 'monotype', SAILS: 'open', FOILS: 'open', KEEL: 'monotype', ELECTRONICS: 'open', REINFORCEMENT: 'absent' }
polar OK, sails: JIB,LJ,SS,C0,SPI,HG,LG
```

- [ ] **Step 6.5: Final commit (if any leftover changes from formatters/etc.)**

```bash
git status
# If clean, nothing to do. Otherwise:
git add -p   # review and stage manually
git commit -m "chore(mini650): final cleanup after verification"
```

---

## Self-review notes (post-write)

- **Spec coverage**: §2 polaires → Task 1; §3.1 BoatClass → Task 2.1; §3.2 polar registry → Task 3.1+3.2; §3.3 propagation → Task 4 (every record); §4 game-balance entries → Task 4; §5 items → Task 5; §6 tests → Task 3.3 + Task 6. All sections covered.
- **Placeholders**: none — every step has the actual JSON/TS to paste, and every shell command has expected output.
- **Type consistency**: `BoatClass`, `BoatClassZ`, `POLAR_FILES`, `Record<BoatClass, X>` all reference the same `'MINI650'` string literal. Item IDs match between spec, plan, and verification commands.
- **Out of scope (explicit)**: marina UI auto-rendering is not tested in this plan — the spec called it out and the user can verify in-browser if needed. The pre-existing `swell` divergence between the two `game-balance.json` files is intentionally left alone.
