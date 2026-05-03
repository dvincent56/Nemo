# Runbook: Adding a Boat Class

**Placeholders used throughout this document:**
- `<CLASS>` — uppercase enum key (e.g. `MINI650`)
- `<class>` — lowercase filename stem (e.g. `mini650`)

**Worked example:** MINI650 on branch `feature/mini650-boat-class`.
See [spec](../superpowers/specs/2026-04-21-mini650-boat-class-design.md) and
[plan](../superpowers/plans/2026-04-21-mini650-boat-class.md) for the full design.

---

## 1. Overview

A `BoatClass` spans: typed catalog (shared-types), Zod validation (game-balance),
polar speed tables (polar-lib + web), balance tuning (game-balance.json), upgrade
items (same JSON), and several UI registries.

**Source-of-truth chain:**

```
packages/shared-types/src/index.ts
  BOAT_CLASSES tuple  ──►  BoatClass type  (TypeScript derives this)
                      ──►  BoatClassZ      (z.enum(BOAT_CLASSES) in game-balance)
```

Every `Record<BoatClass, X>` in the codebase becomes a typecheck error the moment
you add a string to `BOAT_CLASSES` — that is the intended discovery mechanism.

---

## 2. Prerequisites Before Coding

Before touching any source file, confirm you have:

- [ ] **7 polar CSVs** — one per Nemo SailId (`JIB LJ SS C0 SPI HG LG`),
  semicolon-separated, TWA 0–180° rows × TWS 0–70 kt columns.
  The first row is the TWS header; column 0 of each subsequent row is TWA.
- [ ] **Positioning decision** — where in the class ladder?
  (entry-level: CRUISER_RACER → MINI650; mid: FIGARO, CLASS40; high-perf: OCEAN_FIFTY, IMOCA60, ULTIM)
- [ ] **Balance numbers decided** — distance rate, completion bonus, maneuver durations.
  Reference values (existing classes):

  | Class        | distRate | bonus | sailChg | tack | gybe |
  |--------------|----------|-------|---------|------|------|
  | CRUISER_RACER| 0.5      | 200   | 240s    | 75s  | 100s |
  | MINI650      | 0.6      | 300   | 150s    | 45s  | 70s  |
  | FIGARO       | 0.8      | 400   | 180s    | 60s  | 90s  |
  | CLASS40      | 1.0      | 600   | 240s    | 90s  | 120s |
  | OCEAN_FIFTY  | 1.6      | 1000  | 300s    | 150s | 200s |
  | IMOCA60      | 1.4      | 900   | 300s    | 120s | 150s |
  | ULTIM        | 2.0      | 1400  | 360s    | 180s | 240s |

- [ ] **Slot config decided** — each of `HULL MAST SAILS FOILS KEEL ELECTRONICS REINFORCEMENT`
  set to `"open"`, `"monotype"`, or `"absent"`.
- [ ] **Upgrade items list** — at minimum one SERIE-tier item per non-absent slot.

---

## 3. Source of Truth

### Step 3.1 — Add `<CLASS>` to the `BOAT_CLASSES` tuple

File: `packages/shared-types/src/index.ts`

```typescript
export const BOAT_CLASSES = [
  'CRUISER_RACER',
  '<CLASS>',      // ← insert in order
  'FIGARO',
  // ...
] as const;
```

**Verify:** `pnpm typecheck` now emits errors at every `Record<BoatClass, X>` that
needs the new key. Use those errors as your checklist for steps 5, 6, 8.

`BoatClassZ` in `packages/game-balance/src/upgrade-catalog.schema.ts` is
`z.enum(BOAT_CLASSES)` — it auto-updates, no edit needed.

---

## 4. Polar Generation

### Step 4.1 — Convert the first sail (JIB), create the output JSON

```bash
node scripts/convert-polar-csv.mjs \
  <csv-folder>/jib.csv \
  apps/web/public/data/polars/<class>.json \
  --boat <CLASS> --sail JIB
```

### Step 4.2 — Merge the remaining 6 sails

```bash
for SAIL in LJ SS C0 SPI HG LG; do
  node scripts/convert-polar-csv.mjs \
    <csv-folder>/${SAIL,,}.csv \
    apps/web/public/data/polars/<class>.json \
    --boat <CLASS> --sail $SAIL \
    --merge apps/web/public/data/polars/<class>.json
done
```

### Step 4.3 — Run convert directly into polar-lib (single source)

The web copy under `apps/web/public/data/polars/` is **gitignored and
auto-synced** by `scripts/sync-engine-data.mjs` at every `predev` /
`prebuild`. Generate the polar JSON directly into the canonical location :

```bash
node scripts/convert-polar-csv.mjs \
  <csv-folder>/jib.csv \
  packages/polar-lib/polars/<class>.json \
  --boat <CLASS> --sail JIB

for SAIL in LJ SS C0 SPI HG LG; do
  node scripts/convert-polar-csv.mjs \
    <csv-folder>/${SAIL,,}.csv \
    packages/polar-lib/polars/<class>.json \
    --boat <CLASS> --sail $SAIL \
    --merge packages/polar-lib/polars/<class>.json
done
```

> **Si tu as déjà généré dans `apps/web/public/data/polars/<class>.json`** :
> déplace simplement le fichier vers `packages/polar-lib/polars/`. La copie
> sous `apps/web/public/data/` sera regénérée au prochain `pnpm dev`.

### Step 4.4 — Sync + spot-check

```bash
pnpm --filter @nemo/web sync-engine-data    # régénère apps/web/public/data/
node -e "
const p = require('./packages/polar-lib/polars/<class>.json');
console.log({ sails: Object.keys(p.speeds), sample: p.speeds.JIB[40][12] });
"
```

Expected: `sails` has 7 keys; `sample` is a positive number.

---

## 5. Polar Registry Registration

Two typed `Record<BoatClass, string>` maps — typecheck will catch these after step 3.1.

### Step 5.1 — `apps/web/src/lib/polar.ts`

Add to `POLAR_FILES`:
```typescript
<CLASS>: '<class>.json',
```

### Step 5.2 — `packages/polar-lib/src/index.ts`

Add to `POLAR_FILES`:
```typescript
<CLASS>: '<class>.json',
```

### Step 5.3 — `apps/web/src/app/api/v1/polars/[boatClass]/route.ts`

Add to `BOAT_FILES` (typed `Record<BoatClass, string>`):
```typescript
<CLASS>: '<class>.json',
```

### Step 5.4 — `apps/web/src/hooks/useProjectionLine.ts`

Add to `BOAT_CLASS_FILES` (typed `Record<BoatClass, string>`):
```typescript
<CLASS>: '<class>.json',
```

**Verify:** `pnpm --filter @nemo/polar-lib test` — 3/3 pass.

---

## 6. game-balance.json Edits

**Source unique :** `packages/game-balance/game-balance.json`. La copie
sous `apps/web/public/data/game-balance.json` est **gitignored et
auto-synced** par `scripts/sync-engine-data.mjs` au `predev` / `prebuild`.
N'édite jamais la copie sous `apps/web/public/data/` — elle est régénérée.

### Step 6.1 — `rewards.distanceRates`

```json
"<CLASS>": <rate>
```

### Step 6.2 — `economy.completionBonus`

```json
"<CLASS>": <bonus>
```

### Step 6.3 — `maneuvers.sailChange.transitionTimeSec`

```json
"<CLASS>": <seconds>
```

### Step 6.4 — `maneuvers.tack.durationSec`

```json
"<CLASS>": <seconds>
```

### Step 6.5 — `maneuvers.gybe.durationSec`

```json
"<CLASS>": <seconds>
```

### Step 6.6 — `upgrades.slotsByClass`

```json
"<CLASS>": {
  "HULL": "open|monotype|absent",
  "MAST": "open|monotype|absent",
  "SAILS": "open|monotype|absent",
  "FOILS": "open|monotype|absent",
  "KEEL": "open|monotype|absent",
  "ELECTRONICS": "open|monotype|absent",
  "REINFORCEMENT": "open|monotype|absent"
}
```

**Verify:**
```bash
npx tsx -e "
import('./packages/game-balance/src/index.ts')
  .then(m => m.GameBalance.loadFromDisk())
  .then(() => console.log('OK'))
"
```

---

## 7. Upgrade Items

Every non-absent slot needs at least one `SERIE`-tier item with `<CLASS>` in its
`compat` array. Two strategies:

**A — Class-specific items** (use for `monotype` slots):
```json
{
  "id": "hull-<class>-monotype",
  "slot": "HULL",
  "tier": "SERIE",
  "compat": ["<CLASS>"],
  "effects": { ... }
}
```

**B — Extend existing shared items** (use for `open` slots):
```json
{ "id": "electronics-pack-base", "compat": ["FIGARO", "CLASS40", "<CLASS>", ...] }
```

### Step 7.1 — Verify coverage

```bash
node -e "
const gb = require('./packages/game-balance/game-balance.json');
const slots = ['HULL', 'MAST', 'KEEL', 'FOILS', 'SAILS', 'ELECTRONICS'];
for (const s of slots) {
  const items = gb.upgrades.items.filter(
    i => i.slot === s && i.tier === 'SERIE' && i.compat.includes('<CLASS>')
  );
  console.log(s + ':', items.length);
}
"
```

Every non-absent slot must show count ≥ 1.

---

## 8. UI Registries — Typed (Auto-Break on Add)

These are `Record<BoatClass, X>` — typecheck fails after step 3.1 until patched.

### Step 8.1 — `apps/web/src/lib/boat-classes.ts` → `CLASS_LABEL`

```typescript
<CLASS>: '<Human Readable Name>',
```

`BOAT_CLASS_ORDER` is derived from `BOAT_CLASSES` directly — no edit needed.

---

## 9. UI Registries — Untyped (Manual Review)

There is currently **no manually-maintained class array** that needs editing.
Every UI list of boat classes is derived from `BOAT_CLASS_ORDER` (which is
`= BOAT_CLASSES` from `shared-types`), so adding the new class to the
`BOAT_CLASSES` tuple in §3.1 propagates everywhere automatically — including
the marina, race filters, public profile per-class stats.

**Design rule:** every boat class is shown everywhere. Whether a class has
upgradable slots is a game-balance concern (`upgrades.slotsByClass`); the UI
does not exclude classes based on it. A class with all slots `"absent"` simply
shows up in the marina with no upgrades available — that's a valid state.

### Sanity check — `apps/game-engine/src/api/marina.ts` → `VALID_CLASSES`

> **Note:** `VALID_CLASSES` is `new Set(BoatClassZ.options)` — fully typed and
> auto-updating. No manual edit needed unless a future refactor reverts this
> to a hardcoded `Set<string>`. If you see that, add `'<CLASS>'` manually.

---

## 10. Verification

Run all four checks. All must pass before committing.

```bash
# 1. TypeScript — must be green (0 errors)
pnpm typecheck

# 2. polar-lib unit tests — must be 3/3
pnpm --filter @nemo/polar-lib test

# 3. game-engine unit tests — must be 40+
pnpm --filter @nemo/game-engine test

# 4. GameBalance schema validation
npx tsx -e "
import('./packages/game-balance/src/index.ts')
  .then(m => m.GameBalance.loadFromDisk())
  .then(() => console.log('OK'))
"
```

---

## 11. Out of Scope

This runbook covers: catalog typing, polar data, balance configuration, and UI
registries. It does **not** cover:

- Creating boats in the database (handled by the marina API at runtime).
- Race configuration (which classes are allowed in a given race — separate gameplay logic).
- Translations: add the class display name to `apps/web/messages/*.json` if i18n
  coverage is required (fr/es/en/de via next-intl).

---

## 12. Worked Example

The MINI650 addition on `feature/mini650-boat-class` is the reference implementation:

- **Spec:** [`docs/superpowers/specs/2026-04-21-mini650-boat-class-design.md`](../superpowers/specs/2026-04-21-mini650-boat-class-design.md)
- **Plan:** [`docs/superpowers/plans/2026-04-21-mini650-boat-class.md`](../superpowers/plans/2026-04-21-mini650-boat-class.md)
- **Branch:** `feature/mini650-boat-class`
- **Key commits:**
  - `a132022` — register in BoatClass union and polar registries
  - `432122c` — game-balance.json entries
  - `1cb7d64` — upgrade items
  - `8a80a92` — fix silent registries (projection-line, polar API route, marina)

The "silent registries" fix (`8a80a92`) is particularly instructive: three files
(`useProjectionLine.ts`, `polars/[boatClass]/route.ts`, `marina.ts`) used
`Record<string, string>` or `Set<string>` instead of typed variants, so they were
not caught by `pnpm typecheck`. They are now typed or derived from `BoatClassZ.options`.
Check for any new `Record<string, string>` polar maps if the codebase grows.
