# IMOCA 60 — New VR Polars + Polar-Switch Foils + Finish Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import the new VR per-sail IMOCA polars (Foil / NoFoil variants), make the FOILS upgrade tier switch the boat between the NoFoil base polar (Série) and the Foil polar (Mk2 60% blend, Proto 100%), reposition `hull-imoca60-non-foiler` as a petit-temps hull profile, and add 3-tier polish items to the REINFORCEMENT slot.

**Architecture:** Each IMOCA60 carries TWO polar JSONs on disk — `imoca60.json` (NoFoil = stock without foils) and `imoca60-foil.json` (Foil = full foiling). At runtime, a new `resolveBoatPolar(boatClass, loadout)` reads `foilPolarMix` from the FOILS upgrade item (0 / 0.6 / 1) and returns either the base polar, the foil polar, or a per-cell linearly-blended polar (cached). Polar lookup in `tick.ts`, isochrones and projection consumers shifts from `deps.polar` (single class polar) to per-boat resolution. The hull `non-foiler` upgrade is renamed to `light-air` with description tuned to "petit-temps specialist" (no cross-slot incompatibility rule). Polish Bronze/Silver/Gold are added to the REINFORCEMENT slot (cross-class, mutually exclusive with reinforcement-heavy-weather and reinforcement-pro by virtue of single-item-per-slot semantics).

**Tech Stack:** TypeScript (strict), Node.js, pnpm/turborepo monorepo, node:test, Zod schemas, Next.js (web), Fastify (game-engine).

---

## File Structure

**Created:**
- `apps/web/public/data/polars/imoca60.legacy.json` — backup of current polar (browser)
- `apps/web/public/data/polars/imoca60-foil.json` — new VR Foil polar (browser)
- `packages/polar-lib/polars/imoca60.legacy.json` — backup of current polar (engine)
- `packages/polar-lib/polars/imoca60-foil.json` — new VR Foil polar (engine)
- `scripts/import-vr-imoca-polars.ts` — converter script (per-sail CSV → JSON)
- `packages/polar-lib/src/resolve.ts` — `resolveBoatPolar` + `loadPolarVariant` + blend cache
- `packages/polar-lib/src/resolve.test.ts` — tests for the resolver

**Modified:**
- `apps/web/public/data/polars/imoca60.json` — replaced with VR NoFoil
- `packages/polar-lib/polars/imoca60.json` — replaced with VR NoFoil
- `packages/polar-lib/src/index.ts` — re-export resolve.ts API + add startup pre-loader
- `packages/polar-lib/src/index.test.ts` — add IMOCA60 base + foil shape checks
- `packages/game-balance/src/upgrade-catalog.schema.ts` — add `foilPolarMix?: number` field
- `packages/game-balance/game-balance.json` — FOILS items: foilPolarMix + zeroed speedByTws; rename hull-imoca60-non-foiler → hull-imoca60-light-air; add 3 polish items
- `apps/web/public/data/game-balance.json` — same changes (must stay in sync per CLAUDE.md, except `swell` block)
- `packages/game-engine-core/src/tick.ts` — use `resolveBoatPolar(boat, loadout)` at top of `runTick` instead of `deps.polar`
- `apps/game-engine/src/engine/worker.ts` — call `loadAllPolarsForBoatClasses` at startup
- `packages/routing/src/isochrones.ts` — accept resolved polar (already takes `Polar` parameter, no change expected; verify)
- `apps/web/src/lib/polar.ts` — add browser equivalent of `loadPolarVariant` + `resolveBoatPolar`

**Test fixtures touched (downstream of polar values):**
- `packages/game-engine-core/src/tick.wpt.test.ts` — only IMOCA-using tests if any (currently CLASS40-only, verify)
- `apps/web/src/lib/simulator/test-fixtures.ts` — verify no IMOCA-specific hard-coded speeds

---

## Task 1: Backup current IMOCA polars

**Files:**
- Create: `apps/web/public/data/polars/imoca60.legacy.json`
- Create: `packages/polar-lib/polars/imoca60.legacy.json`

- [ ] **Step 1: Copy the current polars to .legacy.json files**

```bash
cp "apps/web/public/data/polars/imoca60.json" "apps/web/public/data/polars/imoca60.legacy.json"
cp "packages/polar-lib/polars/imoca60.json" "packages/polar-lib/polars/imoca60.legacy.json"
```

- [ ] **Step 2: Verify both backups exist with correct content**

```bash
diff "apps/web/public/data/polars/imoca60.legacy.json" "packages/polar-lib/polars/imoca60.legacy.json"
```

Expected: no output (files identical — they were in sync per CLAUDE.md).

- [ ] **Step 3: Commit**

```bash
git add apps/web/public/data/polars/imoca60.legacy.json packages/polar-lib/polars/imoca60.legacy.json
git commit -m "chore(polars): backup IMOCA60 polar before VR re-import"
```

---

## Task 2: Write the VR per-sail import script

**Files:**
- Create: `scripts/import-vr-imoca-polars.ts`

- [ ] **Step 1: Write the importer**

```typescript
// scripts/import-vr-imoca-polars.ts
/**
 * Imports the new VR IMOCA per-sail polars from tmp/imoca/new/{foil,noFoil}/*
 * to apps/web/public/data/polars/imoca60{,-foil}.json and packages/polar-lib/polars/imoca60{,-foil}.json.
 *
 * VR per-sail format: CSV-like with header "TWA\TWS;0;1;...;70" and 181 rows TWA 0..180,
 * separator ';', CRLF line endings.
 *
 * Output Nemo Polar format: { boatClass, tws[71], twa[181], speeds: Record<SailId, number[181][71]>, source }
 *
 * Usage: npx tsx scripts/import-vr-imoca-polars.ts
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const SAIL_FILE_TO_ID: Record<string, string> = {
  jib: 'JIB',
  lightJib: 'LJ',
  stay: 'SS',
  c0: 'C0',
  spi: 'SPI',
  hg: 'HG',
  lg: 'LG',
};

interface ParsedCSV {
  tws: number[];
  twa: number[];
  grid: number[][];
}

function parseCSV(path: string): ParsedCSV {
  const raw = readFileSync(path, 'utf8').replace(/\r/g, '');
  const lines = raw.split('\n').filter((l) => l.length > 0);
  const headerCells = lines[0]!.split(';');
  if (headerCells[0] !== 'TWA\\TWS') {
    throw new Error(`unexpected header in ${path}: ${headerCells[0]}`);
  }
  const tws = headerCells.slice(1).map(Number);
  const twa: number[] = [];
  const grid: number[][] = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i]!.split(';').map(Number);
    twa.push(parts[0]!);
    grid.push(parts.slice(1));
  }
  if (twa.length !== 181) {
    throw new Error(`${path}: expected 181 TWA rows, got ${twa.length}`);
  }
  if (tws.length !== 71) {
    throw new Error(`${path}: expected 71 TWS columns, got ${tws.length}`);
  }
  return { tws, twa, grid };
}

function buildPolarJSON(srcDir: string, sourceLabel: string) {
  const speeds: Record<string, number[][]> = {};
  let tws: number[] | null = null;
  let twa: number[] | null = null;

  for (const [filename, sailId] of Object.entries(SAIL_FILE_TO_ID)) {
    const parsed = parseCSV(join(srcDir, filename));
    if (tws === null) tws = parsed.tws;
    if (twa === null) twa = parsed.twa;
    speeds[sailId] = parsed.grid;
  }

  return {
    boatClass: 'IMOCA60' as const,
    tws,
    twa,
    speeds,
    source: sourceLabel,
  };
}

const baseDir = join(ROOT, 'tmp', 'imoca', 'new');

const noFoil = buildPolarJSON(join(baseDir, 'nofoil'), 'VR-2026-imoca-nofoil');
const foil = buildPolarJSON(join(baseDir, 'foil'), 'VR-2026-imoca-foil');

const targets = [
  { variant: 'base', polar: noFoil, paths: [
    join(ROOT, 'apps', 'web', 'public', 'data', 'polars', 'imoca60.json'),
    join(ROOT, 'packages', 'polar-lib', 'polars', 'imoca60.json'),
  ]},
  { variant: 'foil', polar: foil, paths: [
    join(ROOT, 'apps', 'web', 'public', 'data', 'polars', 'imoca60-foil.json'),
    join(ROOT, 'packages', 'polar-lib', 'polars', 'imoca60-foil.json'),
  ]},
];

for (const target of targets) {
  const json = JSON.stringify(target.polar, null, 2) + '\n';
  for (const path of target.paths) {
    writeFileSync(path, json);
    console.log(`OK ${target.variant} -> ${path}`);
  }
}

console.log('Done.');
```

- [ ] **Step 2: Run the importer**

```bash
npx tsx scripts/import-vr-imoca-polars.ts
```

Expected output:
```
OK base -> .../apps/web/public/data/polars/imoca60.json
OK base -> .../packages/polar-lib/polars/imoca60.json
OK foil -> .../apps/web/public/data/polars/imoca60-foil.json
OK foil -> .../packages/polar-lib/polars/imoca60-foil.json
Done.
```

- [ ] **Step 3: Verify the two location pairs are byte-identical**

```bash
diff "apps/web/public/data/polars/imoca60.json" "packages/polar-lib/polars/imoca60.json"
diff "apps/web/public/data/polars/imoca60-foil.json" "packages/polar-lib/polars/imoca60-foil.json"
```

Expected: no output for both (in-sync).

- [ ] **Step 4: Sanity-check peak speeds via Node**

```bash
node -e "
const fs=require('fs');
for (const f of ['imoca60.json','imoca60-foil.json']) {
  const d = JSON.parse(fs.readFileSync('packages/polar-lib/polars/'+f,'utf8'));
  let peak=0, sail='', twa=0, tws=0;
  for (const s of Object.keys(d.speeds)) {
    for (let i=0;i<d.twa.length;i++) for (let j=0;j<d.tws.length;j++) {
      const v = d.speeds[s][i][j]; if (v>peak) {peak=v; sail=s; twa=d.twa[i]; tws=d.tws[j];}
    }
  }
  console.log(f+': peak '+peak.toFixed(2)+' kn @ TWA '+twa+' TWS '+tws+' ('+sail+')');
}
"
```

Expected:
- `imoca60.json` (NoFoil) peak ≈ 27.09 kn around TWA 125 TWS 36
- `imoca60-foil.json` (Foil) peak ≈ 28.91 kn around TWA 125 TWS 36

- [ ] **Step 5: Commit**

```bash
git add scripts/import-vr-imoca-polars.ts apps/web/public/data/polars/ packages/polar-lib/polars/
git commit -m "feat(polars): import new VR IMOCA60 per-sail polars (NoFoil base + Foil variant)"
```

---

## Task 3: Add IMOCA60 polar shape tests

**Files:**
- Modify: `packages/polar-lib/src/index.test.ts`

- [ ] **Step 1: Add the new tests at the end of the file**

```typescript
// Append to packages/polar-lib/src/index.test.ts:

test('loadPolar(IMOCA60) returns the 7 sails with 181 TWA × 71 TWS grid', async () => {
  const polar = await loadPolar('IMOCA60');
  assert.equal(polar.boatClass, 'IMOCA60');
  assert.equal(polar.twa.length, 181);
  assert.equal(polar.tws.length, 71);
  assert.equal(polar.twa[0], 0);
  assert.equal(polar.twa[180], 180);
  assert.equal(polar.tws[0], 0);
  assert.equal(polar.tws[70], 70);
  const sails = Object.keys(polar.speeds).sort();
  assert.deepEqual(sails, ['C0', 'HG', 'JIB', 'LG', 'LJ', 'SPI', 'SS']);
});

test('loadPolar(IMOCA60) base polar (NoFoil) has lower speed at TWA 110 TWS 18 than the foil variant', async () => {
  const base = await loadPolar('IMOCA60');
  const baseSpeed = base.speeds.C0?.[110]?.[18] ?? 0;
  // Sanity: known approximate value from the new VR NoFoil polar
  assert.ok(baseSpeed > 18 && baseSpeed < 24, `expected 18 < C0@(110,18) < 24, got ${baseSpeed}`);
});
```

- [ ] **Step 2: Run polar-lib tests to confirm they pass**

```bash
pnpm --filter @nemo/polar-lib test
```

Expected: PASS for the two new tests + existing MINI650 tests.

- [ ] **Step 3: Commit**

```bash
git add packages/polar-lib/src/index.test.ts
git commit -m "test(polars): add IMOCA60 base polar shape and value sanity checks"
```

---

## Task 4: Add `loadPolarVariant` to polar-lib

**Files:**
- Modify: `packages/polar-lib/src/index.ts`

- [ ] **Step 1: Add the variant loader (Node)**

Add to `packages/polar-lib/src/index.ts` after the existing `loadPolar` function:

```typescript
/**
 * Loads a polar variant (e.g. "foil" → imoca60-foil.json).
 * Throws if the variant file does not exist for the given boat class.
 * Cached by `${boatClass}|${variant}` key.
 */
const variantCache = new Map<string, Polar>();

export async function loadPolarVariant(
  boatClass: BoatClass,
  variant: string,
): Promise<Polar> {
  const key = `${boatClass}|${variant}`;
  const cached = variantCache.get(key);
  if (cached) return cached;
  const baseFile = POLAR_FILES[boatClass];
  // Insert "-{variant}" before ".json": "imoca60.json" → "imoca60-foil.json"
  const variantFile = baseFile.replace(/\.json$/, `-${variant}.json`);
  const path = join(__dirname, '..', 'polars', variantFile);
  const raw = await readFile(path, 'utf8');
  const polar = JSON.parse(raw) as Polar;
  variantCache.set(key, polar);
  return polar;
}
```

- [ ] **Step 2: Write a test for the variant loader**

Append to `packages/polar-lib/src/index.test.ts`:

```typescript
test('loadPolarVariant(IMOCA60, "foil") returns a different polar from the base', async () => {
  const base = await loadPolar('IMOCA60');
  const foil = await loadPolarVariant('IMOCA60', 'foil');
  assert.equal(foil.boatClass, 'IMOCA60');
  // Foil should be strictly faster than base in the foiling zone (TWA 110, TWS 18)
  const baseC0 = base.speeds.C0?.[110]?.[18] ?? 0;
  const foilC0 = foil.speeds.C0?.[110]?.[18] ?? 0;
  assert.ok(foilC0 > baseC0, `expected foil C0 > base C0 at (110,18); got ${foilC0} vs ${baseC0}`);
});
```

Update the import line at the top of the test file:

```typescript
import { loadPolar, loadPolarVariant } from './index.js';
```

- [ ] **Step 3: Run polar-lib tests**

```bash
pnpm --filter @nemo/polar-lib test
```

Expected: PASS including the new variant test.

- [ ] **Step 4: Commit**

```bash
git add packages/polar-lib/src/index.ts packages/polar-lib/src/index.test.ts
git commit -m "feat(polar-lib): add loadPolarVariant() for foil-variant polars"
```

---

## Task 5: Add `foilPolarMix` field to upgrade schema

**Files:**
- Modify: `packages/game-balance/src/upgrade-catalog.schema.ts:62-73`

- [ ] **Step 1: Add the optional field on UpgradeItemZ**

Replace the `UpgradeItemZ` definition with:

```typescript
export const UpgradeItemZ = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  slot: UpgradeSlotZ,
  tier: UpgradeTierZ,
  name: z.string(),
  profile: z.string(),
  description: z.string(),
  compat: z.array(BoatClassZ).min(1),
  cost: z.number().nullable(),
  effects: UpgradeEffectsZ,
  unlockCriteria: UnlockCriteriaZ.optional(),
  /** When set on a FOILS upgrade, mixes the boat's NoFoil polar (mix=0) with
   *  its Foil variant (mix=1) per cell. Used by polar-lib resolveBoatPolar.
   *  Optional; absent = treated as 0 (= base polar, no foiling effect). */
  foilPolarMix: z.number().min(0).max(1).optional(),
});
```

- [ ] **Step 2: Verify the schema still compiles**

```bash
pnpm --filter @nemo/game-balance build
```

Expected: clean build, no type errors.

- [ ] **Step 3: Commit**

```bash
git add packages/game-balance/src/upgrade-catalog.schema.ts
git commit -m "feat(game-balance): add foilPolarMix field to upgrade item schema"
```

---

## Task 6: Add polar resolver with blending

**Files:**
- Create: `packages/polar-lib/src/resolve.ts`
- Create: `packages/polar-lib/src/resolve.test.ts`
- Modify: `packages/polar-lib/src/index.ts` (re-export)

- [ ] **Step 1: Write a failing test for resolveBoatPolar**

Create `packages/polar-lib/src/resolve.test.ts`:

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { UpgradeItem } from '@nemo/game-balance';
import { loadPolar, loadPolarVariant } from './index.js';
import { resolveBoatPolar, preloadPolarsForBoatClass } from './resolve.js';

function makeFoilsItem(tier: 'SERIE' | 'BRONZE' | 'SILVER', mix?: number): UpgradeItem {
  return {
    id: `foils-imoca60-${tier.toLowerCase()}`,
    slot: 'FOILS',
    tier,
    name: 'test',
    profile: 'test',
    description: 'test',
    compat: ['IMOCA60'],
    cost: 0,
    effects: {
      speedByTwa: [0,0,0,0,0],
      speedByTws: [0,0,0],
      wearMul: {},
      maneuverMul: {},
      polarTargetsDeg: null,
      activation: {},
      groundingLossMul: null,
    },
    foilPolarMix: mix,
  };
}

test('resolveBoatPolar with foilPolarMix=0 (or absent) returns the base NoFoil polar', async () => {
  await preloadPolarsForBoatClass('IMOCA60');
  const base = await loadPolar('IMOCA60');
  const items: UpgradeItem[] = [makeFoilsItem('SERIE', 0)];
  const polar = resolveBoatPolar('IMOCA60', items);
  // Same reference: SERIE returns the cached base
  assert.equal(polar.speeds.C0![110]![18], base.speeds.C0![110]![18]);
});

test('resolveBoatPolar with foilPolarMix=1 returns the Foil variant', async () => {
  await preloadPolarsForBoatClass('IMOCA60');
  const foil = await loadPolarVariant('IMOCA60', 'foil');
  const items: UpgradeItem[] = [makeFoilsItem('SILVER', 1)];
  const polar = resolveBoatPolar('IMOCA60', items);
  assert.equal(polar.speeds.C0![110]![18], foil.speeds.C0![110]![18]);
});

test('resolveBoatPolar with foilPolarMix=0.6 returns per-cell linear blend', async () => {
  await preloadPolarsForBoatClass('IMOCA60');
  const base = await loadPolar('IMOCA60');
  const foil = await loadPolarVariant('IMOCA60', 'foil');
  const items: UpgradeItem[] = [makeFoilsItem('BRONZE', 0.6)];
  const polar = resolveBoatPolar('IMOCA60', items);
  const expected = 0.4 * base.speeds.C0![110]![18]! + 0.6 * foil.speeds.C0![110]![18]!;
  const actual = polar.speeds.C0![110]![18]!;
  assert.ok(Math.abs(actual - expected) < 0.0001, `blend mismatch: ${actual} vs ${expected}`);
});

test('resolveBoatPolar caches blends — same args returns same reference', async () => {
  await preloadPolarsForBoatClass('IMOCA60');
  const items: UpgradeItem[] = [makeFoilsItem('BRONZE', 0.6)];
  const a = resolveBoatPolar('IMOCA60', items);
  const b = resolveBoatPolar('IMOCA60', items);
  assert.equal(a, b);
});

test('resolveBoatPolar for boat class without foil variant returns the base polar', async () => {
  await preloadPolarsForBoatClass('CLASS40');
  // CLASS40 has no foil variant; even if we pass a foilPolarMix=1 item, it should fallback
  const base = await loadPolar('CLASS40');
  const items: UpgradeItem[] = [makeFoilsItem('SILVER', 1)];
  const polar = resolveBoatPolar('CLASS40', items);
  assert.equal(polar, base);
});
```

- [ ] **Step 2: Run the test — expect FAIL (resolve.ts not yet written)**

```bash
pnpm --filter @nemo/polar-lib test
```

Expected: FAIL on `resolve.test.ts` with "Cannot find module './resolve.js'" or similar.

- [ ] **Step 3: Write the resolver**

Create `packages/polar-lib/src/resolve.ts`:

```typescript
import type { BoatClass, Polar, SailId } from '@nemo/shared-types';
import type { UpgradeItem } from '@nemo/game-balance';
import { loadPolar, loadPolarVariant } from './index.js';

const polarLoaded = new Map<BoatClass, { base: Polar; foil: Polar | null }>();
const blendCache = new Map<string, Polar>();

const FOIL_VARIANT_BOATS: BoatClass[] = ['IMOCA60'];

/** Preload base + variant polars for a boat class. Must be called at startup
 *  before resolveBoatPolar (which is sync). */
export async function preloadPolarsForBoatClass(boatClass: BoatClass): Promise<void> {
  if (polarLoaded.has(boatClass)) return;
  const base = await loadPolar(boatClass);
  let foil: Polar | null = null;
  if (FOIL_VARIANT_BOATS.includes(boatClass)) {
    try {
      foil = await loadPolarVariant(boatClass, 'foil');
    } catch {
      foil = null; // variant absent → boat doesn't foil
    }
  }
  polarLoaded.set(boatClass, { base, foil });
}

/** Preload all known boat classes. Use at engine startup. */
export async function preloadAllPolars(boatClasses: BoatClass[]): Promise<void> {
  await Promise.all(boatClasses.map(preloadPolarsForBoatClass));
}

function blendPolars(base: Polar, foil: Polar, mix: number): Polar {
  const speeds: Record<string, number[][]> = {};
  for (const sail of Object.keys(base.speeds) as SailId[]) {
    const baseGrid = base.speeds[sail]!;
    const foilGrid = foil.speeds[sail]!;
    const blendGrid: number[][] = [];
    for (let i = 0; i < baseGrid.length; i++) {
      const baseRow = baseGrid[i]!;
      const foilRow = foilGrid[i]!;
      const blendRow: number[] = [];
      for (let j = 0; j < baseRow.length; j++) {
        const b = baseRow[j]!;
        const f = foilRow[j]!;
        blendRow.push((1 - mix) * b + mix * f);
      }
      blendGrid.push(blendRow);
    }
    speeds[sail] = blendGrid;
  }
  return { ...base, speeds: speeds as Polar['speeds'], source: `${base.source ?? 'base'}+blend${mix.toFixed(2)}` };
}

/** Returns the polar to use for a given boat (per its FOILS upgrade tier).
 *  Pre-condition: preloadPolarsForBoatClass(boatClass) must have been awaited.
 *  Sync — fast path for the tick loop. */
export function resolveBoatPolar(boatClass: BoatClass, loadoutItems: readonly UpgradeItem[]): Polar {
  const loaded = polarLoaded.get(boatClass);
  if (!loaded) {
    throw new Error(`Polar not preloaded for ${boatClass} — call preloadPolarsForBoatClass first`);
  }
  if (!loaded.foil) return loaded.base;

  const foilsItem = loadoutItems.find((i) => i.slot === 'FOILS');
  const mix = foilsItem?.foilPolarMix ?? 0;
  if (mix <= 0) return loaded.base;
  if (mix >= 1) return loaded.foil;

  const cacheKey = `${boatClass}|${mix.toFixed(3)}`;
  const cached = blendCache.get(cacheKey);
  if (cached) return cached;

  const blended = blendPolars(loaded.base, loaded.foil, mix);
  blendCache.set(cacheKey, blended);
  return blended;
}
```

- [ ] **Step 4: Re-export from polar-lib index**

Add at the top of `packages/polar-lib/src/index.ts` (after the existing `export * from './pure'`):

```typescript
export { resolveBoatPolar, preloadPolarsForBoatClass, preloadAllPolars } from './resolve.js';
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
pnpm --filter @nemo/polar-lib test
```

Expected: all tests pass including the 5 new resolve tests.

- [ ] **Step 6: Commit**

```bash
git add packages/polar-lib/src/resolve.ts packages/polar-lib/src/resolve.test.ts packages/polar-lib/src/index.ts
git commit -m "feat(polar-lib): add resolveBoatPolar() with foil-variant blending and cache"
```

---

## Task 7: Update FOILS items to use foilPolarMix

**Files:**
- Modify: `packages/game-balance/game-balance.json` (FOILS items for IMOCA60)
- Modify: `apps/web/public/data/game-balance.json` (mirror)

- [ ] **Step 1: Locate the three FOILS items in game-balance.json**

```bash
node -e "
const fs=require('fs');
const d=JSON.parse(fs.readFileSync('packages/game-balance/game-balance.json','utf8'));
const foils = d.upgrades.items.filter(i=>i.slot==='FOILS' && i.compat.includes('IMOCA60'));
for (const f of foils) console.log(f.id, '|tier=', f.tier, '|speedByTws=', JSON.stringify(f.effects.speedByTws));
"
```

Expected: 3 items — `foils-imoca60-standard` (SERIE), `foils-imoca60-mk2` (BRONZE), `foils-imoca60-proto` (SILVER).

- [ ] **Step 2: Edit `packages/game-balance/game-balance.json`**

Find each item by id and apply:

For `foils-imoca60-standard` (SERIE), set:
```json
"foilPolarMix": 0,
"effects": {
  "speedByTwa": [0,0,0,0,0],
  "speedByTws": [0,0,0],
  ...
}
```

For `foils-imoca60-mk2` (BRONZE), change `effects.speedByTws` to `[0, 0, 0]` (was `[-0.01, 0.05, 0.07]`) and add `"foilPolarMix": 0.6`. Keep `wearMul: { "hull": 1.05 }`.

For `foils-imoca60-proto` (SILVER), change `effects.speedByTws` to `[0, 0, 0]` (was `[-0.03, 0.08, 0.12]`) and add `"foilPolarMix": 1`. Keep `wearMul: { "hull": 1.15 }`.

Update top-level `version` to bump (e.g. `1.0.0` → `1.1.0`) and `updatedAt` to today's date `2026-04-29T00:00:00Z`, `updatedBy` to `imoca-vr-polars-import`.

- [ ] **Step 3: Mirror the same changes to `apps/web/public/data/game-balance.json`**

Apply the exact same edits to the web mirror. They must stay in sync (CLAUDE.md), except `swell` block which has the known divergence — leave swell alone in both files.

- [ ] **Step 4: Verify both files validate against the schema by booting GameBalance**

```bash
pnpm --filter @nemo/game-balance build
node -e "
const { GameBalance } = require('./packages/game-balance/dist/index.js');
GameBalance.loadFromDisk().then(() => {
  const items = GameBalance.upgrades.items.filter(i=>i.slot==='FOILS' && i.compat.includes('IMOCA60'));
  for (const f of items) console.log(f.id, 'foilPolarMix=', f.foilPolarMix, 'speedByTws=', f.effects.speedByTws);
}).catch(e => { console.error(e); process.exit(1); });
"
```

Expected output (no schema errors):
```
foils-imoca60-standard foilPolarMix= 0 speedByTws= [0, 0, 0]
foils-imoca60-mk2 foilPolarMix= 0.6 speedByTws= [0, 0, 0]
foils-imoca60-proto foilPolarMix= 1 speedByTws= [0, 0, 0]
```

- [ ] **Step 5: Commit**

```bash
git add packages/game-balance/game-balance.json apps/web/public/data/game-balance.json
git commit -m "feat(upgrades): IMOCA60 FOILS upgrades drive polar switch via foilPolarMix"
```

---

## Task 8: Rename hull-imoca60-non-foiler → hull-imoca60-light-air

**Files:**
- Modify: `packages/game-balance/game-balance.json` (and the web mirror)

- [ ] **Step 1: Verify no code references the old id**

```bash
grep -r "hull-imoca60-non-foiler" --include="*.ts" --include="*.tsx" .
```

Expected: no hits in source files (only in the two game-balance.json files and possibly some legacy docs/specs).

If any source file references the old id, update it as part of this task.

- [ ] **Step 2: Edit the item in `packages/game-balance/game-balance.json`**

Locate the item with `"id": "hull-imoca60-non-foiler"` and replace with:

```json
{
  "id": "hull-imoca60-light-air",
  "slot": "HULL",
  "tier": "SILVER",
  "name": "Coque IMOCA Affinée Petit Temps",
  "profile": "petit temps spécialiste",
  "description": "Carène allégée et finement profilée, optimisée pour le près et le petit temps. Brille avec un setup dérive droite ; ses gains se réduisent quand on monte en foils performance.",
  "compat": ["IMOCA60"],
  "cost": 12000,
  "effects": {
    "speedByTwa": [0.06, 0.04, 0.02, 0, 0],
    "speedByTws": [0.08, 0.02, -0.05],
    "wearMul": {},
    "maneuverMul": {},
    "polarTargetsDeg": null,
    "activation": {},
    "groundingLossMul": null
  }
}
```

(Slight tweak from prior `[+0.1, +0.04, -0.06]` to `[+0.08, +0.02, -0.05]` since the new NoFoil base already captures most petit-temps benefit; this upgrade now layers a smaller but real bonus.)

- [ ] **Step 3: Mirror to `apps/web/public/data/game-balance.json`**

- [ ] **Step 4: Verify the catalog still validates**

```bash
node -e "
const { GameBalance } = require('./packages/game-balance/dist/index.js');
GameBalance.loadFromDisk().then(() => {
  const item = GameBalance.upgrades.items.find(i=>i.id==='hull-imoca60-light-air');
  if (!item) { console.error('MISSING'); process.exit(1); }
  console.log('OK', item.name);
}).catch(e => { console.error(e); process.exit(1); });
"
```

Expected: `OK Coque IMOCA Affinée Petit Temps`.

- [ ] **Step 5: Commit**

```bash
git add packages/game-balance/game-balance.json apps/web/public/data/game-balance.json
git commit -m "refactor(upgrades): rename hull-imoca60-non-foiler -> hull-imoca60-light-air"
```

---

## Task 9: Add polish BRONZE/SILVER/GOLD to REINFORCEMENT slot

**Files:**
- Modify: `packages/game-balance/game-balance.json` (and the web mirror)

- [ ] **Step 1: Add 3 new items in the `upgrades.items` array of `packages/game-balance/game-balance.json`**

Insert after the existing `reinforcement-pro` item:

```json
{
  "id": "polish-bronze",
  "slot": "REINFORCEMENT",
  "tier": "BRONZE",
  "name": "Polish Bronze",
  "profile": "finition glisse",
  "description": "Antifouling racing et carène poncée. Gain de glisse régulier sur tous les angles, usure de coque légèrement accrue.",
  "compat": ["FIGARO", "CLASS40", "OCEAN_FIFTY", "IMOCA60", "ULTIM"],
  "cost": 3000,
  "effects": {
    "speedByTwa": [0,0,0,0,0],
    "speedByTws": [0.01, 0.01, 0.01],
    "wearMul": { "hull": 1.15 },
    "maneuverMul": {},
    "polarTargetsDeg": null,
    "activation": {},
    "groundingLossMul": null
  }
},
{
  "id": "polish-silver",
  "slot": "REINFORCEMENT",
  "tier": "SILVER",
  "name": "Polish Silver",
  "profile": "finition course",
  "description": "Polish de carène complet et appendices polis miroir. Glisse nette, usure de coque sensiblement accrue.",
  "compat": ["FIGARO", "CLASS40", "OCEAN_FIFTY", "IMOCA60", "ULTIM"],
  "cost": 8000,
  "effects": {
    "speedByTwa": [0,0,0,0,0],
    "speedByTws": [0.02, 0.02, 0.02],
    "wearMul": { "hull": 1.25 },
    "maneuverMul": {},
    "polarTargetsDeg": null,
    "activation": {},
    "groundingLossMul": null
  }
},
{
  "id": "polish-gold",
  "slot": "REINFORCEMENT",
  "tier": "GOLD",
  "name": "Polish Gold",
  "profile": "préparation course pro",
  "description": "Préparation course professionnelle : antifouling teflon haut de gamme, polish miroir intégral. Gain maximal, usure de coque fortement accrue.",
  "compat": ["FIGARO", "CLASS40", "OCEAN_FIFTY", "IMOCA60", "ULTIM"],
  "cost": 18000,
  "effects": {
    "speedByTwa": [0,0,0,0,0],
    "speedByTws": [0.03, 0.03, 0.03],
    "wearMul": { "hull": 1.40 },
    "maneuverMul": {},
    "polarTargetsDeg": null,
    "activation": {},
    "groundingLossMul": null
  }
}
```

- [ ] **Step 2: Mirror the same insertion to `apps/web/public/data/game-balance.json`**

- [ ] **Step 3: Verify the catalog still validates and the new items load**

```bash
node -e "
const { GameBalance } = require('./packages/game-balance/dist/index.js');
GameBalance.loadFromDisk().then(() => {
  const items = GameBalance.upgrades.items.filter(i=>i.id.startsWith('polish-'));
  console.log('Polish items:', items.length);
  for (const i of items) console.log('  ', i.id, '| tier=', i.tier, '| speedByTws=', i.effects.speedByTws, '| wearMul=', i.effects.wearMul);
}).catch(e => { console.error(e); process.exit(1); });
"
```

Expected:
```
Polish items: 3
   polish-bronze | tier= BRONZE | speedByTws= [0.01,0.01,0.01] | wearMul= {hull:1.15}
   polish-silver | tier= SILVER | speedByTws= [0.02,0.02,0.02] | wearMul= {hull:1.25}
   polish-gold   | tier= GOLD   | speedByTws= [0.03,0.03,0.03] | wearMul= {hull:1.4}
```

- [ ] **Step 4: Commit**

```bash
git add packages/game-balance/game-balance.json apps/web/public/data/game-balance.json
git commit -m "feat(upgrades): add Polish Bronze/Silver/Gold to REINFORCEMENT slot (cross-class)"
```

---

## Task 10: Wire `resolveBoatPolar` into the tick engine

**Files:**
- Modify: `packages/game-engine-core/src/tick.ts:64-69, 82-90, 122-165`

- [ ] **Step 1: Read the current tick.ts top section to confirm location**

```bash
sed -n '60,170p' packages/game-engine-core/src/tick.ts
```

- [ ] **Step 2: Update the polar-lib import in tick.ts**

Change line 3:

```typescript
// Before:
import { computeTWA, getPolarSpeed } from '@nemo/polar-lib/browser';
```

To:

```typescript
import { computeTWA, getPolarSpeed, resolveBoatPolar } from '@nemo/polar-lib/browser';
```

- [ ] **Step 3: Replace `deps.polar` usages with the per-boat resolved polar**

Inside `runTick(runtime, deps, tickStartMs, tickEndMs)`, immediately after destructuring `const { boat } = runtime;` (around line 88), insert:

```typescript
// Resolve the polar variant the boat is actually sailing under (per FOILS upgrade tier).
// preloadPolarsForBoatClass(boat.boatClass) MUST have been awaited at startup.
const boatPolar = resolveBoatPolar(boat.boatClass, runtime.loadout.items);
```

Then in the function body, replace each `deps.polar` reference with `boatPolar`. The current lines using it are:

- Line 126: `deps.polar` → `boatPolar` (inside `advanceSailState` call)
- Line 154: `deps.polar` → `boatPolar` (inside `computeOverlapFactor` call)
- Line 161: `deps.polar` → `boatPolar` (inside `computeBsp` call)
- Line 162: `deps.polar` → `boatPolar` (inside `getPolarSpeed` call)
- Line 220: `deps.polar` → `boatPolar` (inside `buildSegments` deps)

Leave `deps.polar` in the `TickDeps` interface for now (it's still used as a default for boats without per-boat polars in the simulator and tests).

- [ ] **Step 4: Add browser equivalent of `resolveBoatPolar` for the web client**

Modify `packages/polar-lib/src/browser.ts` to expose the resolver too:

```typescript
// packages/polar-lib/src/browser.ts
export {
  getPolarSpeed,
  advancePosition,
  haversineNM,
  computeTWA,
} from './pure';
export { resolveBoatPolar, preloadPolarsForBoatClass, preloadAllPolars } from './resolve-browser.js';
```

Create `packages/polar-lib/src/resolve-browser.ts`:

```typescript
// Browser-safe variant of resolve.ts. Loads polars via fetch instead of fs.
// Same public API: preloadPolarsForBoatClass / preloadAllPolars / resolveBoatPolar.

import type { BoatClass, Polar, SailId } from '@nemo/shared-types';
import type { UpgradeItem } from '@nemo/game-balance';

const polarLoaded = new Map<BoatClass, { base: Polar; foil: Polar | null }>();
const blendCache = new Map<string, Polar>();

const POLAR_FILES: Record<BoatClass, string> = {
  CRUISER_RACER: 'cruiser-racer.json',
  MINI650: 'mini650.json',
  FIGARO: 'figaro.json',
  CLASS40: 'class40.json',
  OCEAN_FIFTY: 'ocean-fifty.json',
  IMOCA60: 'imoca60.json',
  ULTIM: 'ultim.json',
};

const FOIL_VARIANT_BOATS: BoatClass[] = ['IMOCA60'];

async function fetchPolar(filename: string): Promise<Polar> {
  const r = await fetch(`/data/polars/${filename}`);
  if (!r.ok) throw new Error(`failed to load polar ${filename}: ${r.status}`);
  return r.json() as Promise<Polar>;
}

export async function preloadPolarsForBoatClass(boatClass: BoatClass): Promise<void> {
  if (polarLoaded.has(boatClass)) return;
  const baseFile = POLAR_FILES[boatClass];
  const base = await fetchPolar(baseFile);
  let foil: Polar | null = null;
  if (FOIL_VARIANT_BOATS.includes(boatClass)) {
    try {
      foil = await fetchPolar(baseFile.replace(/\.json$/, '-foil.json'));
    } catch {
      foil = null;
    }
  }
  polarLoaded.set(boatClass, { base, foil });
}

export async function preloadAllPolars(boatClasses: BoatClass[]): Promise<void> {
  await Promise.all(boatClasses.map(preloadPolarsForBoatClass));
}

function blendPolars(base: Polar, foil: Polar, mix: number): Polar {
  const speeds: Record<string, number[][]> = {};
  for (const sail of Object.keys(base.speeds) as SailId[]) {
    const baseGrid = base.speeds[sail]!;
    const foilGrid = foil.speeds[sail]!;
    const blendGrid: number[][] = [];
    for (let i = 0; i < baseGrid.length; i++) {
      const baseRow = baseGrid[i]!;
      const foilRow = foilGrid[i]!;
      const blendRow: number[] = [];
      for (let j = 0; j < baseRow.length; j++) {
        blendRow.push((1 - mix) * baseRow[j]! + mix * foilRow[j]!);
      }
      blendGrid.push(blendRow);
    }
    speeds[sail] = blendGrid;
  }
  return { ...base, speeds: speeds as Polar['speeds'], source: `${base.source ?? 'base'}+blend${mix.toFixed(2)}` };
}

export function resolveBoatPolar(boatClass: BoatClass, loadoutItems: readonly UpgradeItem[]): Polar {
  const loaded = polarLoaded.get(boatClass);
  if (!loaded) {
    throw new Error(`Polar not preloaded for ${boatClass} — call preloadPolarsForBoatClass first`);
  }
  if (!loaded.foil) return loaded.base;

  const foilsItem = loadoutItems.find((i) => i.slot === 'FOILS');
  const mix = foilsItem?.foilPolarMix ?? 0;
  if (mix <= 0) return loaded.base;
  if (mix >= 1) return loaded.foil;

  const cacheKey = `${boatClass}|${mix.toFixed(3)}`;
  const cached = blendCache.get(cacheKey);
  if (cached) return cached;

  const blended = blendPolars(loaded.base, loaded.foil, mix);
  blendCache.set(cacheKey, blended);
  return blended;
}
```

- [ ] **Step 5: Build and run the engine-core tests**

```bash
pnpm --filter @nemo/game-engine-core test
```

Existing tests use CLASS40 (no foil variant), so `resolveBoatPolar` should fall back to the base polar — they should still pass. Note: tests that didn't previously call `preloadPolarsForBoatClass('CLASS40')` will now throw. Add a `before(async () => { await preloadPolarsForBoatClass('CLASS40'); })` to test files that use IMOCA60... or for safety, to all test files that build a BoatRuntime.

If tests fail with "Polar not preloaded", add the preload call to the test's `before()` block. Example for `tick.wpt.test.ts`:

```typescript
before(async () => {
  await GameBalance.loadFromDisk();
  await preloadPolarsForBoatClass('CLASS40');
});
```

(Add the import: `import { preloadPolarsForBoatClass } from '@nemo/polar-lib';`.)

- [ ] **Step 6: Commit**

```bash
git add packages/game-engine-core/src/tick.ts packages/polar-lib/src/browser.ts packages/polar-lib/src/resolve-browser.ts packages/game-engine-core/src/tick.wpt.test.ts packages/game-engine-core/src/tick.transition.test.ts
git commit -m "feat(engine): tick uses resolveBoatPolar() for per-boat foil-aware polar"
```

---

## Task 11: Preload polars at engine startup and in browser app

**Files:**
- Modify: `apps/game-engine/src/engine/worker.ts:52-58`
- Modify: `apps/web/src/app/play/[raceId]/PlayClient.tsx` (or the appropriate bootstrap location for client-side polars — verify by `grep "loadPolar" apps/web/src/`)

- [ ] **Step 1: Find the right engine worker startup location**

```bash
sed -n '50,75p' apps/game-engine/src/engine/worker.ts
```

- [ ] **Step 2: Replace the single `loadPolar('CRUISER_RACER')` with preloadAllPolars**

In `apps/game-engine/src/engine/worker.ts` around lines 56-57, change:

```typescript
// Before:
await GameBalance.loadFromDisk();
const polar: Polar = await loadPolar('CRUISER_RACER');
```

To:

```typescript
import { loadPolar, preloadAllPolars } from '@nemo/polar-lib';
import { BOAT_CLASSES } from '@nemo/shared-types';
// ...
await GameBalance.loadFromDisk();
await preloadAllPolars(Array.from(BOAT_CLASSES));
const polar: Polar = await loadPolar('CRUISER_RACER'); // kept for default TickDeps
```

- [ ] **Step 3: Add browser-side preloading for active boats**

Find where the web client currently calls `loadPolar`:

```bash
grep -rn "loadPolar(" apps/web/src/
```

In each location that loads a polar for a participating boat, replace with `preloadPolarsForBoatClass(boatClass)` followed by the existing usage. The simplest path is to call `preloadPolarsForBoatClass(myBoat.boatClass)` once at race start in `PlayClient.tsx` or its parent loader.

- [ ] **Step 4: Boot the engine worker locally and confirm no startup errors**

```bash
pnpm --filter @nemo/game-engine dev
```

Expected: clean startup logs, no "Polar not preloaded" errors.

- [ ] **Step 5: Commit**

```bash
git add apps/game-engine/src/engine/worker.ts apps/web/src/
git commit -m "feat(bootstrap): preload base+foil polars for all boat classes at startup"
```

---

## Task 12: Update isochrones / projection consumers

**Files:**
- Verify (no changes if already taking `Polar` parameter): `packages/routing/src/isochrones.ts`, `apps/web/src/lib/projection/simulate.ts`, `apps/web/src/hooks/useProjectionLine.ts`, `apps/web/src/workers/projection.worker.ts`

- [ ] **Step 1: Check each consumer's polar source**

```bash
grep -n "loadPolar\|getPolarSpeed\|polar\." packages/routing/src/isochrones.ts apps/web/src/lib/projection/simulate.ts apps/web/src/hooks/useProjectionLine.ts apps/web/src/workers/projection.worker.ts
```

- [ ] **Step 2: For each consumer that takes a Polar parameter — no change needed**

The caller is responsible for passing the right polar. We update the callers (the components/hooks that fetch polars) to use `resolveBoatPolar(boatClass, loadout)` from the browser API.

For each call site that calls `loadPolar(boatClass)` and passes the result to isochrones/projection, replace with:

```typescript
// Browser side, after preloadPolarsForBoatClass(boatClass) has been awaited
import { resolveBoatPolar } from '@nemo/polar-lib/browser';
const polar = resolveBoatPolar(boatClass, myBoat.loadout.items);
// pass `polar` into isochrones / projection as before
```

- [ ] **Step 3: Run web typecheck and unit tests**

```bash
pnpm --filter @nemo/web typecheck
pnpm --filter @nemo/web test
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/ packages/routing/src/
git commit -m "refactor(consumers): isochrones and projection use resolveBoatPolar for per-boat polar"
```

---

## Task 13: Update existing test fixtures referencing IMOCA polar values

**Files:**
- Verify and update if needed: `packages/game-engine-core/src/tick.wpt.test.ts`, `packages/game-engine-core/src/tick.transition.test.ts`, `apps/web/src/lib/simulator/test-fixtures.ts`, `packages/routing/src/isochrones.test.ts`

- [ ] **Step 1: Find all IMOCA60-specific assertions in tests**

```bash
grep -rn "IMOCA60" packages/game-engine-core/src/ apps/web/src/lib/simulator/ packages/routing/src/ apps/game-engine/src/test/
```

- [ ] **Step 2: For each test that asserts a specific BSP/value for IMOCA60**

Recompute the expected value from the new polar (NoFoil base, since test loadouts use FOILS/SERIE by default unless they explicitly install Mk2/Proto). Update the assertion or — if the test is purely a regression on a specific number — re-establish the snapshot.

If a test installs `foils-imoca60-mk2` or `foils-imoca60-proto` in its loadout, the boat now sails the blended/foil polar. Update expected values accordingly.

- [ ] **Step 3: Run the full test suite**

```bash
pnpm test
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/game-engine-core/src/ packages/routing/src/ apps/web/src/lib/simulator/
git commit -m "test(fixtures): update IMOCA60-dependent test assertions for new VR polars"
```

---

## Task 14: Smoke test end-to-end

- [ ] **Step 1: Boot the dev environment**

```bash
pnpm dev
```

- [ ] **Step 2: Open the simulator with an IMOCA60 boat**

In the browser, navigate to `/dev/simulator`, pick `IMOCA60` as boat class. Verify:
- Default loadout (FOILS Série) → polaire NoFoil utilisée. Best VMG upwind ≈ 48° à TWS 18.
- Equip FOILS Mk2 (foilPolarMix=0.6) → speed at TWA 110, TWS 18 increases visibly (~+1 kn vs base).
- Equip FOILS Proto (foilPolarMix=1) → speed at TWA 110, TWS 18 ≈ +1.8 kn vs base.
- Equip Polish Gold (REINFORCEMENT) on top → +3% global, log shows hull wear accelerated.
- Equip `hull-imoca60-light-air` (HULL) → small petit-temps bonus (TWS 10) visible.

- [ ] **Step 3: Verify the marina UI lists the renamed hull and the 3 polish items**

Navigate to `/marina/[boatId]` for an IMOCA. Check:
- HULL slot shows: Standard, "Coque IMOCA Affinée Petit Temps".
- REINFORCEMENT slot shows: Sans Renforcement, Renforcement Gros Temps, Blindage Compétition Pro, Polish Bronze, Polish Silver, Polish Gold.

- [ ] **Step 4: Final commit (any leftover fixture tweaks discovered during smoke)**

```bash
git status
git add <any leftover changes>
git commit -m "chore: final fixture tweaks from end-to-end smoke test"
```

---

## Self-Review

**Spec coverage check (against the brainstorming session decisions):**

- [x] Sauvegarder les anciennes polaires → Task 1 (`*.legacy.json` backups in both locations)
- [x] Importer les polaires VR voile-par-voile → Task 2 (importer script, generates both NoFoil and Foil JSONs in both locations)
- [x] NoFoil = polaire de base (IMOCA Série n'a pas de foils) → Task 2 writes NoFoil to `imoca60.json`
- [x] Foil = polaire cible des upgrades FOILS → Task 2 writes Foil to `imoca60-foil.json`
- [x] FOILS upgrade tier drives polar selection (SERIE 0, BRONZE 0.6, SILVER 1) → Tasks 5-7 (schema field + resolver + catalog values)
- [x] Pas de règle d'incompatibilité cross-slot → not implemented (per user decision in conversation)
- [x] Renommer hull-imoca60-non-foiler → hull-imoca60-light-air avec nouvelle description → Task 8
- [x] Polish Bronze/Silver/Gold sur slot REINFORCEMENT, cross-class → Task 9
- [x] Synergy bonus → explicitly deferred per user message ("on pourra la mettre en place plus tard")
- [x] Wire engine to use resolved polar → Tasks 10-12
- [x] Update tests/fixtures → Task 13
- [x] End-to-end smoke → Task 14

**Placeholder scan:** No "TBD", "implement later", or generic "add validation" instructions. Each step has either explicit code or an explicit shell command with expected output.

**Type consistency:**
- `resolveBoatPolar(boatClass, loadoutItems)` signature consistent across Tasks 6, 10, 12.
- `preloadPolarsForBoatClass(boatClass)` consistent across Tasks 6, 10, 11.
- `foilPolarMix` field consistent across Tasks 5 (schema), 6 (resolver reads), 7 (catalog writes).
- Polar JSON shape (`boatClass`, `tws`, `twa`, `speeds`, `source`) matches existing `Polar` type used by polar-lib.

**Risks flagged:**
- Task 13 may surface unexpected fixture breakage. If many test snapshots need updating, consider splitting Task 13 into per-package tasks during execution.
- Task 11 step 3 (browser preload) requires finding the right component bootstrap location; if the codebase doesn't have a centralized place, prepare to insert a small `useEffect` in `PlayClient.tsx` and the simulator client.
- Task 7 changes the FOILS items' `speedByTws` from non-zero to zero. This is intentional (polar switching replaces the additive bonus) but means raw boat speeds with foils Mk2/Proto will shift by ±1-2 kn vs the previous behavior — confirm this is the user's intent during smoke (Task 14).
