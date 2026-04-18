# Per-Sail Polars Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-grid polar system with per-sail speed grids so each of the 7 sails has its own performance curve, sourced from real VR data.

**Architecture:** The `Polar` type changes from `speeds: number[][]` to `speeds: Record<SailId, number[][]>`. A conversion script transforms VR polar data (toxcct/VRPolarsChartData) to our format. All consumers of `getPolarSpeed` gain a `sail` parameter. SailId expands from 6 to 7 values aligned with VR.

**Tech Stack:** TypeScript, Node.js scripts, bilinear interpolation, Next.js API routes

**Spec:** `docs/superpowers/specs/2026-04-19-per-sail-polars-design.md`

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `packages/shared-types/src/index.ts` | SailId union (7 values), Polar interface (per-sail speeds) |
| Modify | `packages/polar-lib/src/index.ts` | `getPolarSpeed(polar, sail, twa, tws)` signature |
| Modify | `packages/polar-lib/package.json` | Remove single polar export, add wildcard |
| Create | `scripts/vr-source/*.json` | Downloaded VR polar source files (5 boats) |
| Create | `scripts/convert-vr-polars.ts` | Conversion script: VR format → our format |
| Modify | `apps/web/public/data/polars/*.json` | 5 boat class files in new per-sail format |
| Modify | `packages/game-balance/game-balance.json` | Sails block: 7 sails, remove definitions/overlapDegrees |
| Modify | `apps/game-engine/src/engine/sails.ts` | ALL_SAILS, pickOptimalSail, computeOverlapFactor, isInRange removed |
| Modify | `apps/game-engine/src/engine/segments.ts` | Pass active sail to getPolarSpeed |
| Modify | `apps/game-engine/src/engine/tick.ts` | No structural change (sail already tracked) |
| Modify | `apps/game-engine/src/broadcast/payload.ts` | SAIL_IDS array → 7 sails |
| Modify | `apps/game-engine/src/engine/orders.ts` | No change needed (already uses SailId) |
| Modify | `apps/web/src/lib/polar.ts` | getPolarSpeed gains sail param |
| Modify | `apps/web/src/lib/projection/simulate.ts` | PolarData + getPolarSpeed gain sail param |
| Modify | `apps/web/src/components/play/Compass.tsx` | SAIL_RANGES → 7 sails, getPolarSpeed calls add sail |
| Modify | `apps/web/src/components/play/SailPanel.tsx` | SAILS → 7 entries, new icons, per-sail speed display |
| Modify | `apps/web/src/components/play/SailPanel.module.css` | No change needed |
| Modify | `apps/web/src/lib/store/sailSlice.ts` | ALL_SAILS → 7, default sail |
| Modify | `apps/web/src/lib/store/index.ts` | SAIL_CODES → 7 entries |
| Create | `apps/web/src/app/api/v1/polars/[boatClass]/route.ts` | Public API endpoint for polars |
| Modify | `apps/game-engine/src/test/e2e-tick.ts` | Update polar data for per-sail format |
| Modify | `apps/game-engine/src/test/e2e-segments.ts` | Update polar data + getPolarSpeed calls |
| Modify | `apps/game-engine/src/test/e2e-phase2.ts` | Update sail IDs + polar data |
| Modify | `apps/game-engine/src/test/bench-tick.ts` | Update polar data |
| Modify | `apps/game-engine/src/test/bench-broadcast.ts` | Update SAIL_IDS |

---

## Task 1: Update SailId type (7 sails)

**Files:**
- Modify: `packages/shared-types/src/index.ts:3`

- [ ] **Step 1: Update SailId union**

In `packages/shared-types/src/index.ts`, replace the SailId type:

```ts
// Before (line 3):
export type SailId = 'LW' | 'JIB' | 'GEN' | 'C0' | 'HG' | 'SPI';

// After:
export type SailId = 'JIB' | 'LJ' | 'SS' | 'C0' | 'SPI' | 'HG' | 'LG';
```

- [ ] **Step 2: Verify no compile errors in shared-types**

Run: `cd packages/shared-types && npx tsc --noEmit`
Expected: Errors in downstream packages (expected at this stage — we'll fix them in later tasks).

- [ ] **Step 3: Commit**

```bash
git add packages/shared-types/src/index.ts
git commit -m "feat(types): update SailId to 7 sails aligned with VR"
```

---

## Task 2: Update Polar type to per-sail speeds

**Files:**
- Modify: `packages/shared-types/src/index.ts:20-25`

- [ ] **Step 1: Change Polar interface**

In `packages/shared-types/src/index.ts`, replace the Polar interface:

```ts
// Before:
export interface Polar {
  boatClass: BoatClass;
  tws: number[];
  twa: number[];
  speeds: number[][];
}

// After:
export interface Polar {
  boatClass: BoatClass;
  tws: number[];
  twa: number[];
  speeds: Record<SailId, number[][]>;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/shared-types/src/index.ts
git commit -m "feat(types): Polar.speeds now Record<SailId, number[][]>"
```

---

## Task 3: Update getPolarSpeed in polar-lib

**Files:**
- Modify: `packages/polar-lib/src/index.ts:60-85`

- [ ] **Step 1: Add sail parameter to getPolarSpeed**

In `packages/polar-lib/src/index.ts`, update the function signature and body:

```ts
// Before (line 60):
export function getPolarSpeed(polar: Polar, twa: number, tws: number): number {
  const absTwa = Math.min(Math.abs(twa), 180);
  const a = findBracket(polar.twa, absTwa);
  const s = findBracket(polar.tws, tws);

  const r0 = polar.speeds[a.i0];
  const r1 = polar.speeds[a.i1];

// After:
export function getPolarSpeed(polar: Polar, sail: SailId, twa: number, tws: number): number {
  const absTwa = Math.min(Math.abs(twa), 180);
  const sailSpeeds = polar.speeds[sail];
  if (!sailSpeeds) return 0;
  const a = findBracket(polar.twa, absTwa);
  const s = findBracket(polar.tws, tws);

  const r0 = sailSpeeds[a.i0];
  const r1 = sailSpeeds[a.i1];
```

The rest of the function (lines 67-79) stays identical — bilinear interpolation on `r0`/`r1`.

- [ ] **Step 2: Update the import**

Add `SailId` to the import at line 1:

```ts
// Before:
import type { BoatClass, Polar } from '@nemo/shared-types';

// After:
import type { BoatClass, Polar, SailId } from '@nemo/shared-types';
```

- [ ] **Step 3: Commit**

```bash
git add packages/polar-lib/src/index.ts
git commit -m "feat(polar-lib): getPolarSpeed takes sail parameter"
```

---

## Task 4: Download VR source polars + write conversion script

**Files:**
- Create: `scripts/vr-source/class_40.json`
- Create: `scripts/vr-source/figaro3.json`
- Create: `scripts/vr-source/imoca_60_foils.json`
- Create: `scripts/vr-source/multi_50_v2.json`
- Create: `scripts/vr-source/ultim_macif.json`
- Create: `scripts/convert-vr-polars.ts`

- [ ] **Step 1: Download VR polar source files**

```bash
mkdir -p scripts/vr-source
curl -sL "https://raw.githubusercontent.com/toxcct/VRPolarsChartData/main/data/boats/mono/class_40.json" -o scripts/vr-source/class_40.json
curl -sL "https://raw.githubusercontent.com/toxcct/VRPolarsChartData/main/data/boats/mono/figaro3.json" -o scripts/vr-source/figaro3.json
curl -sL "https://raw.githubusercontent.com/toxcct/VRPolarsChartData/main/data/boats/mono/imoca_60_foils.json" -o scripts/vr-source/imoca_60_foils.json
curl -sL "https://raw.githubusercontent.com/toxcct/VRPolarsChartData/main/data/boats/multi/multi_50_v2.json" -o scripts/vr-source/multi_50_v2.json
curl -sL "https://raw.githubusercontent.com/toxcct/VRPolarsChartData/main/data/boats/multi/ultim_macif.json" -o scripts/vr-source/ultim_macif.json
```

Verify each file is valid JSON and >1KB:
```bash
for f in scripts/vr-source/*.json; do echo "$f: $(wc -c < "$f") bytes"; done
```

- [ ] **Step 2: Write the conversion script**

Create `scripts/convert-vr-polars.ts`:

```ts
/**
 * Converts VR polar data (toxcct/VRPolarsChartData format) to Nemo per-sail polar format.
 *
 * VR format:  { tws: number[], twa: number[], sail: [{ name: string, speed: number[][] }] }
 * Nemo format: { boatClass: string, tws: number[], twa: number[], speeds: Record<SailId, number[][]> }
 *
 * Usage: npx tsx scripts/convert-vr-polars.ts
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config ──

const TARGET_TWA = [40, 52, 60, 75, 90, 110, 120, 135, 150, 165, 180];
const TARGET_TWS = [6, 8, 10, 12, 14, 16, 20, 25, 30, 35];

/** Map VR sail name → our SailId */
const SAIL_MAP: Record<string, string> = {
  JIB: 'JIB', Jib: 'JIB',
  SPI: 'SPI', Spi: 'SPI',
  STAYSAIL: 'SS', Staysail: 'SS',
  LIGHT_JIB: 'LJ', LightJib: 'LJ',
  CODE_0: 'C0', Code0: 'C0',
  HEAVY_GNK: 'HG', HeavyGnk: 'HG',
  LIGHT_GNK: 'LG', LightGnk: 'LG',
};

const BOATS: { vrFile: string; boatClass: string; outFile: string }[] = [
  { vrFile: 'class_40.json', boatClass: 'CLASS40', outFile: 'class40.json' },
  { vrFile: 'figaro3.json', boatClass: 'FIGARO', outFile: 'figaro.json' },
  { vrFile: 'imoca_60_foils.json', boatClass: 'IMOCA60', outFile: 'imoca60.json' },
  { vrFile: 'multi_50_v2.json', boatClass: 'OCEAN_FIFTY', outFile: 'ocean-fifty.json' },
  { vrFile: 'ultim_macif.json', boatClass: 'ULTIM', outFile: 'ultim.json' },
];

// ── Bilinear interpolation ──

function findBracket(arr: number[], value: number): { i0: number; i1: number; t: number } {
  if (value <= arr[0]!) return { i0: 0, i1: 0, t: 0 };
  if (value >= arr[arr.length - 1]!) {
    const i = arr.length - 1;
    return { i0: i, i1: i, t: 0 };
  }
  for (let i = 0; i < arr.length - 1; i++) {
    if (value >= arr[i]! && value <= arr[i + 1]!) {
      const span = arr[i + 1]! - arr[i]!;
      return { i0: i, i1: i + 1, t: span === 0 ? 0 : (value - arr[i]!) / span };
    }
  }
  return { i0: 0, i1: 0, t: 0 };
}

function interpolate2D(
  srcTwa: number[], srcTws: number[], srcSpeeds: number[][],
  targetTwa: number, targetTws: number,
): number {
  const a = findBracket(srcTwa, targetTwa);
  const s = findBracket(srcTws, targetTws);
  const r0 = srcSpeeds[a.i0];
  const r1 = srcSpeeds[a.i1];
  if (!r0 || !r1) return 0;
  const v00 = r0[s.i0] ?? 0;
  const v01 = r0[s.i1] ?? 0;
  const v10 = r1[s.i0] ?? 0;
  const v11 = r1[s.i1] ?? 0;
  const top = v00 * (1 - s.t) + v01 * s.t;
  const bot = v10 * (1 - s.t) + v11 * s.t;
  return top * (1 - a.t) + bot * a.t;
}

// ── Resample one sail's speed grid ──

function resampleSail(
  srcTwa: number[], srcTws: number[], srcSpeeds: number[][],
): number[][] {
  return TARGET_TWA.map((twa) =>
    TARGET_TWS.map((tws) => {
      const v = interpolate2D(srcTwa, srcTws, srcSpeeds, twa, tws);
      return Math.round(Math.max(0, v) * 100) / 100; // clamp negatives, round to 2 decimals
    }),
  );
}

// ── Main ──

const outDirWeb = join(__dirname, '..', 'apps', 'web', 'public', 'data', 'polars');
mkdirSync(outDirWeb, { recursive: true });

for (const boat of BOATS) {
  const srcPath = join(__dirname, 'vr-source', boat.vrFile);
  const src = JSON.parse(readFileSync(srcPath, 'utf8'));
  const srcTwa: number[] = src.twa;
  const srcTws: number[] = src.tws;

  const speeds: Record<string, number[][]> = {};
  let sailCount = 0;

  for (const sailDef of src.sail) {
    const ourId = SAIL_MAP[sailDef.name];
    if (!ourId) {
      console.warn(`  ⚠ Unknown sail "${sailDef.name}" in ${boat.vrFile}, skipping`);
      continue;
    }
    speeds[ourId] = resampleSail(srcTwa, srcTws, sailDef.speed);
    sailCount++;
  }

  const polar = {
    boatClass: boat.boatClass,
    tws: TARGET_TWS,
    twa: TARGET_TWA,
    speeds,
  };

  const outPath = join(outDirWeb, boat.outFile);
  writeFileSync(outPath, JSON.stringify(polar, null, 2) + '\n');
  console.log(`✓ ${boat.boatClass}: ${sailCount} sails → ${outPath}`);
}

console.log('\nDone.');
```

- [ ] **Step 3: Run the conversion script**

```bash
npx tsx scripts/convert-vr-polars.ts
```

Expected output:
```
✓ CLASS40: 7 sails → .../apps/web/public/data/polars/class40.json
✓ FIGARO: 7 sails → .../apps/web/public/data/polars/figaro.json
✓ IMOCA60: 7 sails → .../apps/web/public/data/polars/imoca60.json
✓ OCEAN_FIFTY: 7 sails → .../apps/web/public/data/polars/ocean-fifty.json
✓ ULTIM: 7 sails → .../apps/web/public/data/polars/ultim.json
```

- [ ] **Step 4: Verify output — spot-check a file**

```bash
node -e "const d=JSON.parse(require('fs').readFileSync('apps/web/public/data/polars/class40.json','utf8')); console.log('sails:', Object.keys(d.speeds)); console.log('twa:', d.twa.length, 'tws:', d.tws.length); console.log('JIB[0]:', d.speeds.JIB[0]); console.log('SPI[0]:', d.speeds.SPI[0])"
```

Expected: 7 sail keys (`JIB, LJ, SS, C0, SPI, HG, LG`), 11 TWA × 10 TWS per sail, JIB and SPI showing different speed values at the same TWA index.

- [ ] **Step 5: Commit**

```bash
git add scripts/vr-source/ scripts/convert-vr-polars.ts apps/web/public/data/polars/
git commit -m "feat(polars): VR source data + conversion script, 7-sail polar files"
```

---

## Task 5: Update game-balance.json sails block

**Files:**
- Modify: `packages/game-balance/game-balance.json` (sails block, lines 52-82)

- [ ] **Step 1: Update the sails configuration**

Replace the entire `"sails"` block in `packages/game-balance/game-balance.json`:

```json
"sails": {
  "transitionPenalty": 0.7,
  "transitionTimes": {
    "JIB_LJ": 120,  "LJ_JIB": 120,
    "JIB_SS": 150,   "SS_JIB": 150,
    "JIB_C0": 180,   "C0_JIB": 180,
    "C0_SPI": 300,   "SPI_C0": 300,
    "C0_HG": 240,    "HG_C0": 240,
    "SPI_HG": 240,   "HG_SPI": 240,
    "SPI_LG": 180,   "LG_SPI": 180,
    "HG_LG": 180,    "LG_HG": 180,
    "SS_C0": 180,    "C0_SS": 180,
    "LJ_SS": 150,    "SS_LJ": 150,
    "JIB_SPI": 360,  "SPI_JIB": 360,
    "LJ_C0": 240,    "C0_LJ": 240
  }
}
```

Remove the `"overlapDegrees"` and `"definitions"` sub-blocks entirely — TWA ranges and overlaps are now encoded in the polar data itself.

- [ ] **Step 2: Verify JSON is valid**

```bash
node -e "JSON.parse(require('fs').readFileSync('packages/game-balance/game-balance.json','utf8')); console.log('OK')"
```

- [ ] **Step 3: Commit**

```bash
git add packages/game-balance/game-balance.json
git commit -m "feat(balance): sails block updated for 7 sails, remove definitions/overlap"
```

---

## Task 6: Update game engine — sails.ts

**Files:**
- Modify: `apps/game-engine/src/engine/sails.ts`

- [ ] **Step 1: Update imports and ALL_SAILS**

```ts
// Line 1 — add SailId to Polar import:
import type { BoatClass, SailId } from '@nemo/shared-types';

// Line 19 — update ALL_SAILS:
const ALL_SAILS: SailId[] = ['JIB', 'LJ', 'SS', 'C0', 'SPI', 'HG', 'LG'];
```

- [ ] **Step 2: Remove isInRange and isInOverlapZone**

Delete functions `isInRange` (lines 21-24) and `isInOverlapZone` (lines 26-31). These relied on `GameBalance.sails.definitions` and `overlapDegrees` which are removed.

- [ ] **Step 3: Rewrite pickOptimalSail**

```ts
/**
 * Sélectionne la voile optimale (BSP max au TWA/TWS donnés).
 * La polaire elle-même encode les plages valides (speed > 0 = en plage).
 */
export function pickOptimalSail(polar: Polar, twa: number, tws: number): SailId {
  const twaAbs = Math.min(Math.abs(twa), 180);
  let best: SailId = 'JIB';
  let bestBsp = -Infinity;
  for (const s of ALL_SAILS) {
    const bsp = getPolarSpeed(polar, s, twaAbs, tws);
    if (bsp > bestBsp) { bestBsp = bsp; best = s; }
  }
  return best;
}
```

- [ ] **Step 4: Rewrite computeOverlapFactor**

```ts
/**
 * Facteur de recouvrement : compare la BSP de la voile active à la voile optimale.
 * Si la voile active est sous-optimale, renvoie le ratio optimal/active.
 */
export function computeOverlapFactor(
  activeSail: SailId,
  twa: number,
  tws: number,
  polar: Polar,
): number {
  const twaAbs = Math.min(Math.abs(twa), 180);
  const activeBsp = getPolarSpeed(polar, activeSail, twaAbs, tws);
  if (activeBsp <= 0) return 1.0;
  const optimal = pickOptimalSail(polar, twa, tws);
  if (activeSail === optimal) return 1.0;
  const optBsp = getPolarSpeed(polar, optimal, twaAbs, tws);
  return optBsp / activeBsp;
}
```

- [ ] **Step 5: Simplify advanceSailState — remove isInRange/isInOverlapZone usage**

In `advanceSailState` (line 85+), replace:
```ts
// Remove these lines (around lines 103-107):
  if (isInRange(next.active, twaAbs)) {
    next.timeOutOfRangeSec = 0;
  } else {
    next.timeOutOfRangeSec += _dtSec;
  }
```

Replace with:
```ts
  const activeBsp = getPolarSpeed(polar, next.active, twaAbs, tws);
  if (activeBsp > 0) {
    next.timeOutOfRangeSec = 0;
  } else {
    next.timeOutOfRangeSec += _dtSec;
  }
```

And replace the auto-mode block (around lines 110-118):
```ts
// Remove:
  if (next.autoMode && !isManoeuvring) {
    const optimal = pickOptimalSail(polar, twa, tws);
    if (optimal !== next.active && !isInOverlapZone(next.active, twaAbs)) {

// Replace with:
  if (next.autoMode && !isManoeuvring) {
    const optimal = pickOptimalSail(polar, twa, tws);
    if (optimal !== next.active) {
```

- [ ] **Step 6: Commit**

```bash
git add apps/game-engine/src/engine/sails.ts
git commit -m "feat(engine): per-sail pickOptimalSail + computeOverlapFactor"
```

---

## Task 7: Update game engine — segments.ts

**Files:**
- Modify: `apps/game-engine/src/engine/segments.ts:144`

- [ ] **Step 1: Pass sail to getPolarSpeed**

At line 144, update the call:

```ts
// Before:
const baseBsp = getPolarSpeed(polar, twa, weather.tws);

// After:
const baseBsp = getPolarSpeed(polar, state.sail, twa, weather.tws);
```

- [ ] **Step 2: Update import if needed**

Check that `SailId` is available — it's already imported via `SegmentState` which has `sail: SailId`.

- [ ] **Step 3: Commit**

```bash
git add apps/game-engine/src/engine/segments.ts
git commit -m "feat(engine): segments pass active sail to getPolarSpeed"
```

---

## Task 8: Update broadcast payload

**Files:**
- Modify: `apps/game-engine/src/broadcast/payload.ts:50-54`

- [ ] **Step 1: Update SAIL_IDS and SailCode**

```ts
// Before (line 50-51):
const SAIL_IDS = ['LW', 'JIB', 'GEN', 'C0', 'HG', 'SPI'] as const;
export type SailCode = 0 | 1 | 2 | 3 | 4 | 5;

// After:
const SAIL_IDS = ['JIB', 'LJ', 'SS', 'C0', 'SPI', 'HG', 'LG'] as const;
export type SailCode = 0 | 1 | 2 | 3 | 4 | 5 | 6;
```

- [ ] **Step 2: Commit**

```bash
git add apps/game-engine/src/broadcast/payload.ts
git commit -m "feat(broadcast): SAIL_IDS updated for 7 sails"
```

---

## Task 9: Update client polar.ts

**Files:**
- Modify: `apps/web/src/lib/polar.ts:68-85`

- [ ] **Step 1: Add SailId import and update getPolarSpeed**

```ts
// Add to imports (line 6):
import type { BoatClass, Polar, SailId } from '@nemo/shared-types';

// Update function signature (line 68):
// Before:
export function getPolarSpeed(polar: Polar, twa: number, tws: number): number {
  const absTwa = Math.min(Math.abs(twa), 180);
  const a = findBracket(polar.twa, absTwa);
  const s = findBracket(polar.tws, tws);
  const r0 = polar.speeds[a.i0];
  const r1 = polar.speeds[a.i1];

// After:
export function getPolarSpeed(polar: Polar, sail: SailId, twa: number, tws: number): number {
  const absTwa = Math.min(Math.abs(twa), 180);
  const sailSpeeds = polar.speeds[sail];
  if (!sailSpeeds) return 0;
  const a = findBracket(polar.twa, absTwa);
  const s = findBracket(polar.tws, tws);
  const r0 = sailSpeeds[a.i0];
  const r1 = sailSpeeds[a.i1];
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/lib/polar.ts
git commit -m "feat(client): getPolarSpeed takes sail parameter"
```

---

## Task 10: Update projection simulate.ts

**Files:**
- Modify: `apps/web/src/lib/projection/simulate.ts`

- [ ] **Step 1: Update PolarData interface**

```ts
// Before (line 52-56):
export interface PolarData {
  twa: number[];
  tws: number[];
  speeds: number[][];
}

// After:
export interface PolarData {
  twa: number[];
  tws: number[];
  speeds: Record<string, number[][]>;
}
```

- [ ] **Step 2: Update getPolarSpeed function**

```ts
// Before (line 73):
export function getPolarSpeed(polar: PolarData, twa: number, tws: number): number {
  const absTwa = Math.min(Math.abs(twa), 180);
  const a = findBracket(polar.twa, absTwa);
  const s = findBracket(polar.tws, tws);
  const r0 = polar.speeds[a.i0]!;
  const r1 = polar.speeds[a.i1]!;

// After:
export function getPolarSpeed(polar: PolarData, sail: string, twa: number, tws: number): number {
  const absTwa = Math.min(Math.abs(twa), 180);
  const sailSpeeds = polar.speeds[sail];
  if (!sailSpeeds) return 0;
  const a = findBracket(polar.twa, absTwa);
  const s = findBracket(polar.tws, tws);
  const r0 = sailSpeeds[a.i0]!;
  const r1 = sailSpeeds[a.i1]!;
```

- [ ] **Step 3: Update computeBspMax**

```ts
// Before (line 91):
export function computeBspMax(polar: PolarData): number {
  let max = 0;
  for (const row of polar.speeds) {
    for (const v of row) { if (v > max) max = v; }
  }
  return max;
}

// After:
export function computeBspMax(polar: PolarData): number {
  let max = 0;
  for (const sailSpeeds of Object.values(polar.speeds)) {
    for (const row of sailSpeeds) {
      for (const v of row) { if (v > max) max = v; }
    }
  }
  return max;
}
```

- [ ] **Step 4: Update computeBsp at line 222**

Add `sail` parameter to `computeBsp`:

```ts
// Before (line 222):
export function computeBsp(
  polar: PolarData,
  twa: number,
  tws: number,
  condition: ConditionState,
  effects: ProjectionEffects,
  maneuver: ManeuverState | null,
  transition: { endMs: number; speedFactor: number } | null,
  nowMs: number,
): number {
  const baseBsp = getPolarSpeed(polar, twa, tws);

// After:
export function computeBsp(
  polar: PolarData,
  sail: string,
  twa: number,
  tws: number,
  condition: ConditionState,
  effects: ProjectionEffects,
  maneuver: ManeuverState | null,
  transition: { endMs: number; speedFactor: number } | null,
  nowMs: number,
): number {
  const baseBsp = getPolarSpeed(polar, sail, twa, tws);
```

Then find all callers of `computeBsp` in the projection system and pass the active sail through. The projection input already has `activeSail: SailId` in `ProjectionInput` (see `apps/web/src/lib/projection/types.ts:15`).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/projection/simulate.ts
git commit -m "feat(projection): per-sail getPolarSpeed in simulation"
```

---

## Task 11: Update Compass.tsx

**Files:**
- Modify: `apps/web/src/components/play/Compass.tsx`

- [ ] **Step 1: Update SAIL_RANGES for 7 sails**

Replace the SAIL_RANGES constant (line 27-30):

```ts
// Before:
const SAIL_RANGES: Record<string, [number, number]> = {
  LW: [0, 60], JIB: [30, 100], GEN: [50, 140],
  C0: [60, 150], HG: [100, 170], SPI: [120, 180],
};

// After — derive ranges from polar data at runtime is ideal,
// but for the compass arc display, hardcode approximate VR ranges:
const SAIL_RANGES: Record<string, [number, number]> = {
  JIB: [30, 100], LJ: [0, 70], SS: [0, 60],
  C0: [60, 150], SPI: [80, 180], HG: [100, 180], LG: [80, 170],
};
```

- [ ] **Step 2: Update bestSailForTwa**

Replace the function (line 47-54):

```ts
function bestSailForTwa(absT: number): string | null {
  const order = ['SPI', 'HG', 'LG', 'C0', 'JIB', 'LJ', 'SS'];
  for (const s of order) {
    const range = SAIL_RANGES[s];
    if (range && absT >= range[0] && absT <= range[1]) return s;
  }
  return null;
}
```

- [ ] **Step 3: Update getPolarSpeed calls**

At lines 135 and 140, add the current sail parameter:

```ts
// Line 135 — during heading edit, use current sail for estimate:
const displayBsp = applyActive && polar
  ? getPolarSpeed(polar, currentSail, displayTwa, tws)
  : bsp;

// Line 140 — max polar BSP across all angles (use best sail per angle):
const maxPolarBsp = polar
  ? Math.max(...polar.twa.map((a) => {
      const best = Object.keys(polar.speeds).reduce((bestS, s) => {
        const v = getPolarSpeed(polar, s as any, a, tws);
        return v > (bestS.v ?? 0) ? { s, v } : bestS;
      }, { s: '', v: 0 });
      return best.v;
    }))
  : 0;
```

The `currentSail` must be read from the store. Add to the component's store selector:

```ts
const currentSail = useGameStore((s) => s.sail.currentSail);
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/play/Compass.tsx
git commit -m "feat(compass): 7 sails + per-sail polar speed lookups"
```

---

## Task 12: Update SailPanel.tsx — 7 sails with per-sail speeds

**Files:**
- Modify: `apps/web/src/components/play/SailPanel.tsx`

- [ ] **Step 1: Update SAILS array**

Replace the SAILS constant (lines 65-72):

```ts
const SAILS: { id: SailId; name: string }[] = [
  { id: 'JIB', name: 'Foc' },
  { id: 'LJ', name: 'Foc léger' },
  { id: 'SS', name: 'Trinquette' },
  { id: 'C0', name: 'Code 0' },
  { id: 'SPI', name: 'Spinnaker' },
  { id: 'HG', name: 'Gennaker lourd' },
  { id: 'LG', name: 'Gennaker léger' },
];
```

- [ ] **Step 2: Add SVG icons for new sails**

Update SAIL_ICONS — remove LW/GEN, add LJ/SS/LG icons:

```tsx
const SAIL_ICONS: Record<SailId, React.ReactElement> = {
  JIB: (
    <svg viewBox="0 0 32 40" fill="none" className={styles.sailIcon}>
      <line x1="6" y1="2" x2="6" y2="38" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 3 L6 37 L22 37 Z" stroke="currentColor" strokeWidth="1.2" fill="currentColor" fillOpacity="0.15" />
    </svg>
  ),
  LJ: (
    <svg viewBox="0 0 32 40" fill="none" className={styles.sailIcon}>
      <line x1="6" y1="2" x2="6" y2="38" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 4 Q16 14 18 24 Q16 32 6 36" stroke="currentColor" strokeWidth="1.2" fill="currentColor" fillOpacity="0.10" strokeDasharray="3 2" />
    </svg>
  ),
  SS: (
    <svg viewBox="0 0 32 40" fill="none" className={styles.sailIcon}>
      <line x1="6" y1="2" x2="6" y2="38" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 6 L6 34 L16 34 Z" stroke="currentColor" strokeWidth="1.2" fill="currentColor" fillOpacity="0.15" />
    </svg>
  ),
  C0: (
    <svg viewBox="0 0 32 40" fill="none" className={styles.sailIcon}>
      <line x1="6" y1="2" x2="6" y2="38" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 3 Q28 8 30 20 Q28 32 6 37" stroke="currentColor" strokeWidth="1.2" fill="currentColor" fillOpacity="0.15" />
    </svg>
  ),
  SPI: (
    <svg viewBox="0 0 32 40" fill="none" className={styles.sailIcon}>
      <line x1="4" y1="2" x2="4" y2="38" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4 3 Q32 6 30 20 Q32 34 4 37" stroke="currentColor" strokeWidth="1.2" fill="currentColor" fillOpacity="0.2" />
      <line x1="4" y1="3" x2="20" y2="2" stroke="currentColor" strokeWidth="0.8" strokeDasharray="2 1" />
    </svg>
  ),
  HG: (
    <svg viewBox="0 0 32 40" fill="none" className={styles.sailIcon}>
      <line x1="8" y1="2" x2="8" y2="38" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 3 Q24 6 28 20 Q24 34 8 37" stroke="currentColor" strokeWidth="1.2" fill="currentColor" fillOpacity="0.2" />
      <line x1="8" y1="3" x2="4" y2="6" stroke="currentColor" strokeWidth="1" />
      <line x1="8" y1="37" x2="4" y2="34" stroke="currentColor" strokeWidth="1" />
    </svg>
  ),
  LG: (
    <svg viewBox="0 0 32 40" fill="none" className={styles.sailIcon}>
      <line x1="8" y1="2" x2="8" y2="38" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 4 Q22 8 26 20 Q22 32 8 36" stroke="currentColor" strokeWidth="1.0" fill="currentColor" fillOpacity="0.10" strokeDasharray="3 2" />
      <line x1="8" y1="4" x2="4" y2="7" stroke="currentColor" strokeWidth="0.8" />
    </svg>
  ),
};
```

- [ ] **Step 3: Update TRANSITION_TIMES**

Replace the hardcoded transition times to match game-balance.json:

```ts
const TRANSITION_TIMES: Record<string, number> = {
  JIB_LJ: 120, LJ_JIB: 120,
  JIB_SS: 150, SS_JIB: 150,
  JIB_C0: 180, C0_JIB: 180,
  C0_SPI: 300, SPI_C0: 300,
  C0_HG: 240, HG_C0: 240,
  SPI_HG: 240, HG_SPI: 240,
  SPI_LG: 180, LG_SPI: 180,
  HG_LG: 180, LG_HG: 180,
  SS_C0: 180, C0_SS: 180,
  LJ_SS: 150, SS_LJ: 150,
  JIB_SPI: 360, SPI_JIB: 360,
  LJ_C0: 240, C0_LJ: 240,
};
```

- [ ] **Step 4: Update per-sail speed calculation**

Replace the `baseBsp` calculation (around line 95) — now each sail gets its own speed:

```ts
// Remove the single baseBsp line. In the map loop, compute per-sail:
// (already inside SAILS.map)
const estimatedBsp = polar ? getPolarSpeed(polar, s.id, absTwa, tws) : null;
const inRange = estimatedBsp !== null && estimatedBsp > 0.5;
```

And update the JSX speed display:
```tsx
<span className={inRange ? styles.sailRowSpeed : styles.sailRowSpeedOff}>
  {estimatedBsp !== null ? `${estimatedBsp.toFixed(1)} kn` : '—'}
</span>
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/play/SailPanel.tsx
git commit -m "feat(sail-panel): 7 sails with per-sail speed estimates"
```

---

## Task 13: Update store — sailSlice + index

**Files:**
- Modify: `apps/web/src/lib/store/sailSlice.ts:5,12`
- Modify: `apps/web/src/lib/store/index.ts:23`

- [ ] **Step 1: Update sailSlice ALL_SAILS and default**

```ts
// Before (line 5):
const ALL_SAILS: SailId[] = ['LW', 'JIB', 'GEN', 'C0', 'HG', 'SPI'];

// After:
const ALL_SAILS: SailId[] = ['JIB', 'LJ', 'SS', 'C0', 'SPI', 'HG', 'LG'];

// Before (line 12):
  currentSail: 'GEN',

// After:
  currentSail: 'JIB',
```

- [ ] **Step 2: Update store index SAIL_CODES**

```ts
// Before (line 23):
const SAIL_CODES = ['LW', 'JIB', 'GEN', 'C0', 'HG', 'SPI'] as const;

// After:
const SAIL_CODES = ['JIB', 'LJ', 'SS', 'C0', 'SPI', 'HG', 'LG'] as const;
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/store/sailSlice.ts apps/web/src/lib/store/index.ts
git commit -m "feat(store): 7-sail codes + default sail JIB"
```

---

## Task 14: Update polar-lib package.json

**Files:**
- Modify: `packages/polar-lib/package.json`

- [ ] **Step 1: Remove single polar export**

The polar JSON files now live in `apps/web/public/data/polars/` and are fetched via HTTP on client, or loaded from disk by the engine. Remove the single export entry:

```json
// Before:
  "exports": {
    ".": "./src/index.ts",
    "./polars/class40": "./polars/class40.json"
  },

// After:
  "exports": {
    ".": "./src/index.ts"
  },
```

- [ ] **Step 2: Commit**

```bash
git add packages/polar-lib/package.json
git commit -m "chore(polar-lib): remove single polar export"
```

---

## Task 15: Create public API endpoint for polars

**Files:**
- Create: `apps/web/src/app/api/v1/polars/[boatClass]/route.ts`

- [ ] **Step 1: Create the API route**

```ts
import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const BOAT_FILES: Record<string, string> = {
  FIGARO: 'figaro.json',
  CLASS40: 'class40.json',
  OCEAN_FIFTY: 'ocean-fifty.json',
  IMOCA60: 'imoca60.json',
  ULTIM: 'ultim.json',
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ boatClass: string }> },
) {
  const { boatClass } = await params;
  const file = BOAT_FILES[boatClass.toUpperCase()];
  if (!file) {
    return NextResponse.json({ error: 'Unknown boat class' }, { status: 404 });
  }

  const filePath = join(process.cwd(), 'public', 'data', 'polars', file);
  const raw = await readFile(filePath, 'utf8');
  const polar = JSON.parse(raw);

  return NextResponse.json(
    { ...polar, version: '1.0.0' },
    {
      headers: {
        'Cache-Control': 'public, max-age=86400',
      },
    },
  );
}
```

- [ ] **Step 2: Test the endpoint**

Start dev server and test:
```bash
curl http://localhost:3000/api/v1/polars/CLASS40 | node -e "const d=[];process.stdin.on('data',c=>d.push(c));process.stdin.on('end',()=>{const j=JSON.parse(d.join(''));console.log('version:', j.version, 'sails:', Object.keys(j.speeds))})"
```

Expected: `version: 1.0.0 sails: ['JIB', 'LJ', 'SS', 'C0', 'SPI', 'HG', 'LG']`

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/api/v1/polars/
git commit -m "feat(api): GET /api/v1/polars/:boatClass public endpoint"
```

---

## Task 16: Update game engine tests

**Files:**
- Modify: `apps/game-engine/src/test/e2e-tick.ts`
- Modify: `apps/game-engine/src/test/e2e-segments.ts`
- Modify: `apps/game-engine/src/test/e2e-phase2.ts`
- Modify: `apps/game-engine/src/test/bench-tick.ts`
- Modify: `apps/game-engine/src/test/bench-broadcast.ts`

- [ ] **Step 1: Create a test helper for per-sail polar data**

The tests currently call `loadPolar('CLASS40')` which loads from disk. Since the conversion script already generated new polar files, we need the engine's polar loader to find them. Check if `loadPolar` in polar-lib reads from the `polars/` subdirectory — if so, copy the generated files there:

```bash
cp apps/web/public/data/polars/class40.json packages/polar-lib/polars/class40.json
```

Alternatively, if tests use the converted files from `apps/web/public/data/polars/`, update the `loadPolar` path in polar-lib to point there, or create a test utility that reads from the correct location.

- [ ] **Step 2: Update e2e-tick.ts**

Update sail IDs from old values to new:
```ts
// Replace all occurrences of 'SPI' used as initial sail — it's still valid
// Replace 'GEN' with 'JIB' if used as default
// The key change: ensure loadPolar returns the new per-sail format
```

- [ ] **Step 3: Update e2e-segments.ts**

Update the direct `getPolarSpeed` calls to include sail:

```ts
// Before (line 98):
const bsp1 = getPolarSpeed(polar, twa(90), TWS);

// After:
const bsp1 = getPolarSpeed(polar, 'JIB', twa(90), TWS);
```

Update any `'GEN'` or `'LW'` sail references to valid new SailIds.

- [ ] **Step 4: Update e2e-phase2.ts**

Update sail order references:
```ts
// Before (line 59-60):
makeEnvelope('SAIL', { sail: 'JIB' }, ...)
makeEnvelope('SAIL', { sail: 'C0' }, ...)

// These are still valid SailIds — no change needed for JIB and C0.
// But update any 'GEN' or 'LW' references.
```

- [ ] **Step 5: Update bench-tick.ts and bench-broadcast.ts**

Update any old SailId references (`'LW'`, `'GEN'`) to new valid IDs.

- [ ] **Step 6: Run all tests**

```bash
cd apps/game-engine && pnpm test
```

Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/game-engine/src/test/ packages/polar-lib/polars/
git commit -m "test(engine): update all tests for 7-sail per-sail polars"
```

---

## Task 17: Full build + type-check

- [ ] **Step 1: Type-check all packages**

```bash
pnpm -r typecheck
```

Fix any remaining type errors from the SailId/Polar changes.

- [ ] **Step 2: Build**

```bash
pnpm build
```

- [ ] **Step 3: Commit any fixes**

```bash
git add -A && git commit -m "fix: resolve type errors from per-sail polars migration"
```

---

## Task 18: Manual verification — dev server

- [ ] **Step 1: Start dev server**

```bash
pnpm dev
```

- [ ] **Step 2: Open the game and verify SailPanel**

Navigate to a race in the browser. Open the sail panel and verify:
- 7 sails are displayed with correct names and icons
- Each sail shows a **different** estimated speed (the core feature)
- Downwind sails (SPI, HG, LG) show higher speeds at high TWA
- Upwind sails (JIB, LJ, SS) show higher speeds at low TWA
- Sail change transitions work correctly

- [ ] **Step 3: Verify Compass**

Check the compass display:
- Sail arcs display correctly for 7 sails
- BSP estimate updates correctly when dragging heading
- BSP efficiency color (vert/orange/rouge) works

- [ ] **Step 4: Verify API endpoint**

```bash
curl http://localhost:3000/api/v1/polars/CLASS40 | head -100
curl http://localhost:3000/api/v1/polars/IMOCA60 | head -100
curl http://localhost:3000/api/v1/polars/UNKNOWN
```

Verify: CLASS40 and IMOCA60 return full polar JSON with 7 sails, UNKNOWN returns 404.
