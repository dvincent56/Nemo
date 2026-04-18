# Per-Sail Polars — Design Spec

**Date:** 2026-04-19  
**Status:** Approved  
**Scope:** Shared types, polar-lib, game engine, client, API

---

## Problem

The current polar system uses a single speed grid per boat class — `speeds[twa][tws]` — with no sail differentiation. All sails produce the same BSP at a given TWA/TWS, making sail choice irrelevant beyond TWA range compliance. `pickOptimalSail` always returns the same speed for every in-range sail.

## Solution

Per-sail polars: each sail has its own speed grid, sourced from real VR data (toxcct/VRPolarsChartData). A spinnaker is faster downwind, a jib faster upwind, etc. Sail choice now has real speed consequences.

---

## 1. SailId — 6 → 7 voiles alignées VR

### New SailId type

```ts
type SailId = 'JIB' | 'LJ' | 'SS' | 'C0' | 'SPI' | 'HG' | 'LG';
```

### Mapping

| SailId | Display name | VR source name | Role |
|--------|-------------|----------------|------|
| JIB | Foc | Jib | Standard upwind |
| LJ | Foc léger | LightJib | Light wind upwind |
| SS | Trinquette | Staysail | Close-hauled / heavy weather |
| C0 | Code 0 | Code0 | Reaching |
| SPI | Spinnaker | Spi | Standard downwind |
| HG | Gennaker lourd | HeavyGnk | Downwind heavy weather |
| LG | Gennaker léger | LightGnk | Downwind light weather |

### Impact

- `packages/shared-types` — update SailId union
- `packages/game-balance/game-balance.json` — update sails.definitions, transitionTimes, overlapDegrees for 7 sails
- `apps/game-engine/src/engine/sails.ts` — ALL_SAILS array
- `apps/web/src/components/play/SailPanel.tsx` — SAILS array, icons
- `apps/web/src/lib/store/sailSlice.ts` — ALL_SAILS, defaults
- `apps/web/src/lib/store/index.ts` — SAIL_CODES mapping

---

## 2. Polar type — per-sail speed grids

### Before

```ts
interface Polar {
  boatClass: BoatClass;
  tws: number[];
  twa: number[];
  speeds: number[][];
}
```

### After

```ts
interface Polar {
  boatClass: BoatClass;
  tws: number[];
  twa: number[];
  speeds: Record<SailId, number[][]>;
}
```

Each `speeds[sailId]` is a 2D array `[twaIndex][twsIndex]` giving BSP in knots. If a sail is ineffective at a given TWA/TWS, the value is 0.

### Files affected

- `packages/shared-types/src/index.ts` — Polar interface
- `apps/web/public/data/polars/*.json` — all 5 boat class files
- Any code consuming `polar.speeds` directly

---

## 3. Polar data conversion

### Source

VR polar data from `github.com/toxcct/VRPolarsChartData`:

| BoatClass | VR file | VR grid size |
|-----------|---------|-------------|
| FIGARO | mono/figaro3.json | 19 TWA × 11 TWS |
| CLASS40 | mono/class_40.json | 31 TWA × 18 TWS |
| OCEAN_FIFTY | multi/multi_50_v2.json | 30 TWA × 21 TWS |
| IMOCA60 | mono/imoca_60_foils.json | 32 TWA × 36 TWS |
| ULTIM | multi/ultim_macif.json | 30 TWA × 21 TWS |

### Conversion script

A Node.js script `scripts/convert-vr-polars.ts`:
1. Reads VR JSON files (downloaded to `scripts/vr-source/`)
2. Maps VR sail names → our SailId
3. Resamples each sail's speed grid to our standard axes via bilinear interpolation:
   - TWA: `[40, 52, 60, 75, 90, 110, 120, 135, 150, 165, 180]` (11 points)
   - TWS: `[6, 8, 10, 12, 14, 16, 20, 25, 30, 35]` (10 points)
4. Clamps negative values to 0
5. Outputs per-boat JSON to `apps/web/public/data/polars/<boatclass>.json`
6. Also outputs to `packages/game-balance/polars/<boatclass>.json` for engine use

VR source files are committed to `scripts/vr-source/` so conversion is reproducible.

---

## 4. polar-lib changes

### getPolarSpeed

```ts
// Before
function getPolarSpeed(polar: Polar, twa: number, tws: number): number

// After
function getPolarSpeed(polar: Polar, sail: SailId, twa: number, tws: number): number
```

Implementation: looks up `polar.speeds[sail]` instead of `polar.speeds`, same bilinear interpolation.

### All callers updated

- `apps/game-engine/src/engine/sails.ts` — pickOptimalSail, computeOverlapFactor
- `apps/game-engine/src/engine/segments.ts` — buildSegments
- `apps/web/src/components/play/SailPanel.tsx` — speed estimates

---

## 5. Game engine changes

### sails.ts

**`pickOptimalSail`** — compares real per-sail BSP:
```ts
function pickOptimalSail(polar: Polar, twa: number, tws: number): SailId {
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

**`isInRange` / `isInOverlapZone`** — removed. The polar data itself encodes valid ranges (speed > 0 = in range). No more separate TWA range definitions needed.

**`computeOverlapFactor`** — simplified. Compares active sail BSP vs optimal sail BSP directly from polars.

**`game-balance.json` sails block** — `definitions` (twaMin/twaMax) removed. `overlapDegrees` removed (overlap is now implicit from the polar curves). `transitionTimes` updated for 7 sails. `transitionPenalty` unchanged.

### segments.ts

`buildSegments` passes `sailState.active` to `getPolarSpeed`:
```ts
const baseBsp = getPolarSpeed(polar, sailState.active, twa, weather.tws);
```

### tick.ts

No structural change — `bspMultiplier` composition is unchanged. The sail ID is already tracked in `SailRuntimeState.active`.

---

## 6. Client changes

### SailPanel.tsx

- 7 sails with new IDs, names, and SVG icons
- Each sail row shows its own estimated BSP from `getPolarSpeed(polar, sailId, twa, tws)`
- Speeds will now differ between sails — the core UX improvement
- TWA range indicator derived from polar data (speed > 0 threshold)

### Store

- `sailSlice.ts` — `ALL_SAILS` updated to 7 entries, default sail stays `JIB`
- `store/index.ts` — `SAIL_CODES` array updated for 7 sails, server message mapping adjusted
- `store/types.ts` — no change (already uses `SailId`)

### polar.ts

- `POLAR_FILES` map updated (same 5 boat classes, new JSON format)
- `getPolarSpeed` re-exported with sail parameter

---

## 7. API endpoint

### Route

`GET /api/v1/polars/:boatClass`

### Response

```json
{
  "boatClass": "CLASS40",
  "version": "1.0.0",
  "tws": [6, 8, 10, ...],
  "twa": [40, 52, 60, ...],
  "sails": {
    "JIB": { "speeds": [[...], ...] },
    "LJ": { "speeds": [[...], ...] },
    ...
  }
}
```

### Details

- Public, no auth required
- Cache-Control: `public, max-age=86400` (24h)
- Versioned via `version` field in response
- Next.js API route at `apps/web/src/app/api/v1/polars/[boatClass]/route.ts`
- Reads from `public/data/polars/`, wraps with version metadata
- Serves same data the client uses internally

---

## 8. Upgrades interaction

**No change to upgrade system.** `AggregatedEffects.speedByTwa` and `speedByTws` remain global multipliers applied after polar lookup. A sail upgrade like "3DI" boosts all sails equally. Per-sail upgrade effects are deferred to a future phase.

---

## 9. Tests

### Unit tests to update

- `apps/game-engine/src/test/bench-tick.ts` — provide per-sail polar data
- `apps/game-engine/src/test/e2e-tick.ts` — same
- `apps/game-engine/src/test/e2e-segments.ts` — same
- `packages/polar-lib` tests (if any) — update for new signature

### New tests

- Conversion script: verify resampled data matches VR source at shared grid points
- `pickOptimalSail`: verify different sails win at different TWA angles
- `getPolarSpeed`: verify per-sail interpolation

---

## 10. Migration notes

- Breaking change on `Polar` type — all consumers must update
- Server messages already send sail as numeric index — index mapping updated for 7 sails
- Existing game-balance.json `sails.definitions` block can be removed after migration
- No database migration needed (polars are static files, not persisted)
