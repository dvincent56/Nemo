# Dev Simulator — Design

**Date**: 2026-04-20
**Status**: Draft — awaiting user review

## Motivation

Today there is no way to validate subjectively whether the game engine tick output and the projection worker agree with each other, nor to compare the behavior of different boat configurations side by side. Debugging polar tuning, loadout balance, or projection drift requires either running a real race and watching scripts, or running the Node e2e tests which print numbers but not visuals.

The dev simulator provides an offline, browser-only tool where the developer can:

1. Place up to 4 boats (same class or different classes) with full loadout at the same point.
2. Give global CAP / TWA / SAIL orders.
3. Accelerate time and watch the boats advance with real GFS weather.
4. See the **game-engine truth trace** compared against the **projection worker estimate** for the primary boat — the gap between the two is the key validation signal.
5. Compare how different IMOCA loadouts react to the same orders.

## Non-goals

- Not a production feature — dev-only, gated by `NODE_ENV`.
- Not a replacement for the e2e engine tests — the simulator is a visual subjective tool, the tests are the objective regression.
- Not a tuning UI — no sliders to edit polars or game-balance values, just visualization.

## Architecture

### Block A — Extract `@nemo/game-engine-core`

The directory `apps/game-engine/src/engine/` contains the pure tick logic (tick, sails, wear, segments, zones, loadout, bands, coastline). It is moved into a new package `packages/game-engine-core` with:

- ESM build targeting both Node and browser (no `fs`, no `node:*` imports).
- The existing tests in `apps/game-engine/src/test/e2e-tick.ts` and `e2e-segments.ts` move alongside and become the package's own regression tests.
- `apps/game-engine` adds `@nemo/game-engine-core` as a dependency and re-imports from it. Zero behavioral change in production.
- The `WeatherProvider` interface stays abstract in the core package. Node and browser each supply their own implementation.
- The coastline module is already dual-natured (Node side uses fs; web side has its own loader in `apps/web/src/lib/projection/coastline.ts`). The core exposes the pure geometry functions (`segmentCrossesCoast`, `coastRiskLevel`) and leaves loading/state to the caller.

### Block B — Web worker `simulator.worker.ts`

New worker located next to `apps/web/src/workers/projection.worker.ts`.

**Responsibilities**:

- Receive boats (class + loadout + initial condition), start position, start timestamp.
- Receive orders (CAP / TWA / SAIL / MODE) applied globally at the current sim time.
- Receive control messages (`start`, `pause`, `reset`, `setSpeed`).
- Iterate `runTick()` from `@nemo/game-engine-core` for each boat at the requested speed factor.
- Stream fleet state to the main thread every ~100 ms.
- Stop cleanly when GRIB coverage ends or all boats are grounded.

**Message protocol**:

```
Main → Worker:
  { type: 'init',   boats, startPos, startTimeMs, windGrid, windData }
  { type: 'order',  order: { kind: 'CAP'|'TWA'|'SAIL'|'MODE', value }, triggerSimMs }
  { type: 'start' }
  { type: 'pause' }
  { type: 'reset' }            // soft reset to t=0, same boats
  { type: 'setSpeed', factor } // 600 | 1800 | 3600 | 7200

Worker → Main:
  { type: 'tick',   simTimeMs, fleet: { [boatId]: { lat, lon, hdg, bsp, twa, sail, sailState, condition } } }
  { type: 'done',   reason: 'grib_exhausted' | 'all_grounded' }
  { type: 'error',  message }
```

**Loop internals**: the worker runs a `setInterval` (~16 ms or `requestAnimationFrame` equivalent for workers) that computes N ticks of 30 s simulated time per frame based on the speed factor. It batches a `tick` message to the main thread every ~100 ms to avoid overwhelming React.

### Block C — Route `/dev/simulator` (dev-only)

A new Next.js route `apps/web/src/app/dev/simulator/page.tsx` + `DevSimulatorClient.tsx`.

**Gating**: the route returns 404 (or redirects) if `process.env.NODE_ENV === 'production'`. Implemented at the page level so the bundle is not even served in prod.

**Composition**:

- Reuses `MapCanvas`, `WindOverlay`, `SwellOverlay`, `Compass` from `apps/web/src/components/play`.
- Adds a new prop `simTimeMs` to `MapCanvas` that overrides the default `Date.now()`. When supplied, overlays sample the GRIB data at this timestamp.
- Adds three new panels: `SetupPanel` (left), `ComparisonPanel` (right), `SimControlsBar` (bottom).
- Hides the production-only panels (`ProgPanel`, `RankingPanel`, `SailPanel`).

**Projection overlay**: the existing `projection.worker.ts` is reused as-is. It is called **once** at the moment the user clicks "Lancer la simulation", producing a frozen line for the primary boat from t=0. The line is drawn dashed in gold on the map. On every fleet tick, the main thread computes `Δ projection = haversineNM(realPosition, projectionPointAt(simTimeMs))` and displays it in the comparison panel.

Rationale for freezing the projection: this represents what the player would have seen at t=0 with the orders queued at that moment. The divergence between the frozen projection and the real trace is the validation signal. Recomputing on every order would make the gap always zero, defeating the purpose.

## Screen layout

Three-column grid + bottom bar.

### State "Setup" (before launch)

```
┌─────────────────────────────────────────────────────────────┐
│ LEFT 280px  │        CENTER (map)           │ RIGHT 300px   │
│             │                                │               │
│ Bateaux 1/4 │   ⊙ ← 4 boats stacked         │ Comparaison   │
│             │      at start point            │   (empty,     │
│  [Bateau 1] │                                │    waiting)   │
│  IMOCA      │   wind arrows live             │               │
│  PRINCIPAL  │                                │               │
│             │                                │               │
│  [+ Ajouter]│                                │               │
│             │                                │               │
│  Départ     │                                │               │
│  47°N 3°W   │                                │               │
│             │                                │               │
├─────────────┴────────────────────────────────┴───────────────┤
│ [▶ Lancer]  Vitesse: [600][1800][3600][7200]  [Nouvelle simu]│
└─────────────────────────────────────────────────────────────┘
```

### State "Running" (at t=12h, new order queued)

```
┌─────────────────────────────────────────────────────────────┐
│ Setup verrouillé │    CENTER                │ Comparaison    │
│                  │                           │                │
│ Ordres envoyés:  │  ╭─╴projection (dashed)  │ Bateau 1 (●)   │
│ t=0  CAP 090 SPI │  │                        │  BSP 14.2 kts  │
│ t=6  CAP 075     │  ●─── real trail          │  Δ proj +2.3NM │
│                  │  ●─── boat 2              │                │
│ [EN ATTENTE]     │  ●─── boat 3              │ Bateau 2 (●)   │
│ CAP 120 → tous   │  ●─── boat 4              │  BSP 13.4 kts  │
│ [OK] [Annuler]   │                           │                │
│                  │  Sim t=12h00              │                │
├──────────────────┴──────────────────────────┴─────────────────┤
│ [❚❚ Pause] Vitesse [selected]  [⟲ Relancer] [Nouvelle simu]   │
└──────────────────────────────────────────────────────────────┘
```

Full visual mockups are in the brainstorm session at `.superpowers/brainstorm/*/content/layout.html`.

## Data flow

### React state

- `setupState`: `{ boats: BoatSetup[], locked: boolean }`
- `simState`: `{ status: 'idle'|'running'|'paused', simTimeMs, speed, orderHistory }`
- `fleetState`: `Map<boatId, { position, heading, bsp, twa, sail, sailState, condition, trail: Point[], distanceNm }>`
- `projectionLine`: `ProjectionResult | null` — frozen at launch
- `pendingOrder`: `Order | null` — queued by user, awaiting confirmation

### Worker orchestration

1. User clicks "Ajouter bateau" → modal to pick class + loadout + starting sail + conditions → pushed to `setupState.boats`.
2. User clicks "Lancer la simulation":
   a. Main thread calls `projection.worker.ts` with the primary boat to get the frozen line.
   b. Main thread posts `init` to `simulator.worker.ts` with all boats.
   c. Main thread posts `start`.
   d. `setupState.locked = true`, `simState.status = 'running'`.
3. Worker streams `tick` messages → main thread updates `fleetState` and `simState.simTimeMs`.
4. `simTimeMs` is passed as prop to `MapCanvas` → overlays re-interpolate GRIB at that time.
5. User gives order → `pendingOrder` set → user confirms → main thread posts `order` to worker with `triggerSimMs = simState.simTimeMs` → order appears in history.
6. User clicks "Pause" → worker posts `pause`, `simState.status = 'paused'`. User can still queue orders; they will apply at resume time.
7. User clicks "⟲ Relancer" → worker posts `reset` → `fleetState` cleared, `simState.simTimeMs = 0`, `simState.orderHistory` cleared, projection line recomputed. Boats stay, conditions reset to original values.
8. User clicks "Nouvelle simu" → everything cleared, back to setup state.

### Trail memory

At 3600× speed for 168 h with 4 boats, storing every 30-s tick gives 4 × 168 × 120 = 80 640 points. Acceptable. If trails become too dense visually, decimate to one point per 5 min for display only (keep the full trace in memory for Δ projection calculation).

## Boat setup panel

Modal "Ajouter un bateau" contains:

- **Classe**: dropdown (CLASS40, IMOCA60, OCEAN_FIFTY, ULTIM, FIGARO).
- **Voile initiale**: dropdown restricted to the polars available for the class.
- **Loadout (upgrades marina)**: accordion per category (coque, gréement, foils, quille, électronique, voilerie) with level selectors. Defaults all to level 0.
- **Conditions**: four number inputs (hull, rig, sails, electronics) 0-100, default 100.
- **Nom** (optional label for the list).

The primary boat selector is a radio button next to each entry in `SetupPanel`. First added boat is primary by default.

## Error handling

- **GRIB coverage exhausted**: worker sends `done{reason:'grib_exhausted'}`. Main thread shows "Fin de couverture météo" and auto-pauses.
- **All boats grounded (coastline)**: worker sends `done{reason:'all_grounded'}`. Main thread shows the reason.
- **Worker error** (exception in tick): main thread shows the error inline in the control bar and pauses. Developer can inspect in devtools.

## Testing

### Migrated to `@nemo/game-engine-core`

- `e2e-tick.ts` — existing.
- `e2e-segments.ts` — existing.

These keep running in CI as package-level regression tests for the core logic.

### New tests

- **`e2e-core-browser.test.ts`** (Vitest + jsdom): loads the core in a browser-like environment and runs the same fixture scenarios as `e2e-tick.ts`, asserting equivalent output. Anti-regression for browser portability.
- **`e2e-simulator-worker.test.ts`** (Vitest): spawns the simulator worker with 2 boats, sends `init → start → wait 1 s → pause → reset → start → wait 1 s → pause`, asserts that the final fleet state is identical between the two runs (determinism).

### Manual recette

1. Two identical IMOCA boats → trails overlap within ε.
2. Two IMOCA with different loadouts → divergence grows monotonically.
3. CAP order during sim → all boats turn at the same sim timestamp.
4. Pause + reset soft → clean return to t=0.
5. Δ projection vs real over 168 h stays within a few NM (if it grows to tens of NM, there is a real projection bug to investigate — which is precisely the signal this tool exists for).

## Scope

### In scope

- Route `/dev/simulator` (dev-only).
- Extraction of `@nemo/game-engine-core` (browser-safe).
- Worker `simulator.worker.ts`.
- Setup panel with full loadout configuration.
- Fixed start point Bay of Biscay (47°N / 3°W).
- Global orders CAP / TWA / SAIL / MODE.
- Four speeds (600× / 1800× / 3600× / 7200×) + Pause + Reset soft + Nouvelle simu.
- Weather overlays driven by `simTimeMs`.
- Frozen projection of the primary boat + live Δ projection metric.
- Up to 4 boats.
- Order history panel.

### Out of scope (explicit YAGNI)

- Persistence of setups (no localStorage, no URL sharing).
- CSV / JSON export of traces.
- Time-series charts (BSP over time, etc.).
- Injection of zones (no-go / storm) — the core handles them but the simulator seeds none.
- Multi-point or custom start position.
- Selecting a past GFS run.
- Adding a boat during a running sim.
- Dynamic projection recomputation on each order.
- Automated UI tests.
- i18n — all French, dev-only.

## Implementation order (high level)

1. Extract `@nemo/game-engine-core` and migrate existing tests. Verify prod game-engine still runs via regression.
2. Add browser portability test (`e2e-core-browser.test.ts`).
3. Build `simulator.worker.ts` with determinism test.
4. Add `simTimeMs` prop to `MapCanvas` + overlays and verify weather animation via a throwaway harness.
5. Build `DevSimulatorClient` with setup panel, comparison panel, controls bar.
6. Wire projection freeze + Δ projection live metric.
7. Manual recette over the five scenarios.

Detailed steps and per-task acceptance criteria will come in the implementation plan.
