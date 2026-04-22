# Routing Engine — Design

**Date**: 2026-04-22
**Status**: Draft — awaiting user review

## Motivation

Today there is no way for a player (or the dev simulator) to compute an optimal
sailing route between two points. Players using competing tools like Virtual
Regatta rely on external routing software (qtVlm, Weather4D) to plan their
strategy; Nemo must provide at least a comparable built-in tool so players
stay in the app and so the dev simulator can run auto-piloted boats for
loadout and polar validation.

The routing engine is a **reusable pure module** whose first consumer is the
dev simulator (runs a routing for each of up to 4 boats, auto-pilots them
via CAP schedules) and whose second consumer (separate spec, deferred) is
the in-game `/play` screen (player clicks "route from here to there", sees
the plan, optionally injects it into their order queue).

## Non-goals

- Not an in-game UI. This spec covers only the module + dev-simulator
  integration. The `/play` UI is a follow-up spec.
- Not a multi-segment routing (via required waypoints). A single from → to.
- Not an ensemble-forecast router (no uncertainty over forecast).
- Not a WASM optimization. Pure TypeScript, target ~1–15 s on a modern
  laptop / mid-range phone.
- Not a "keep recomputing as wind evolves" loop. The forecast is fixed at
  the moment of computation (NOAA run); re-routing is explicit, on-demand.

## Architecture

Three concerns, three places.

### Block A — New package `@nemo/routing`

Pure module, browser-safe, no Node built-ins. Depends on
`@nemo/game-engine-core/browser` (for `aggregateEffects`, `CoastlineIndex`,
`WeatherProvider`) and `@nemo/polar-lib/browser` (for `getPolarSpeed`,
`advancePosition`, `haversineNM`, `computeTWA`).

Does **not** depend on `apps/web`. `WindGridConfig` is moved from
`apps/web/src/lib/projection/windLookup.ts` into `@nemo/game-engine-core`
as part of this work so both the routing module and the web app share one
definition. The `createWindLookup` helper stays where it is (it's a web
concern), but the routing module takes the raw `WindGridConfig` +
`Float32Array` and wraps them internally with its own private sampler (which
may delegate to `createWindLookup` if we also move that down, but that's an
implementation detail in the plan).

```
packages/routing/
├── package.json            (type: module, browser-safe)
├── tsconfig.json
└── src/
    ├── index.ts            Exports: computeRoute, PRESETS, types
    ├── types.ts            RouteInput, RoutePlan, Preset, IsochronePoint
    ├── presets.ts          FAST / BALANCED / HIGHRES parameter sets
    ├── isochrones.ts       Main algorithm
    ├── pruning.ts          Angular sectorization pruning
    ├── polyline.ts         Backtrack + inflection-point extraction
    ├── schedule.ts         Polyline → capSchedule (CAP changes ≥ 5°)
    └── *.test.ts           node:test unit tests
```

### Block B — Web Worker `routing.worker.ts`

New worker at `apps/web/src/workers/routing.worker.ts`. One instance per
routing computation — the dev simulator spawns up to N in parallel (N = 4
boats). The worker imports `computeRoute` from `@nemo/routing`, receives a
`compute` message with the full payload, and returns a `result` message
with the `RoutePlan`.

Protocol:
```ts
Main → Worker:
  { type: 'compute', input: RouteInput }

Worker → Main:
  { type: 'result', plan: RoutePlan }
  { type: 'error', message: string }
```

Each worker is single-shot: spawn, send `compute`, receive `result`, terminate.
No long-lived state.

### Block C — Dev-simulator integration

Changes to `apps/web/src/app/dev/simulator/`:

- `EndPointLayer.tsx` (new) — a destination marker on the map, click-to-place
  when status is `idle` (same pattern as the existing `StartPointLayer`).
- `RouteLayer.tsx` (new) — draws per-boat polylines (solid, boat color).
- `IsochroneLayer.tsx` (new) — draws per-boat isochrones for the currently
  selected boat (closed polyline per iso step, low opacity).
- `RoutingControls.tsx` (new) — bottom bar extension: preset selector
  (FAST / BALANCED / HIGHRES, default BALANCED), "Router tous les bateaux"
  button, "Afficher isochrones de" boat selector.
- `DevSimulatorClient.tsx` (modified) — new state: `endPos`, `routes:
  Map<boatId, RoutePlan>`, `isoVisibleBoatId: string | null`, `routing:
  { status: 'idle'|'computing'|'done', error?: string }`. New handler
  `routeAllBoats()` that fans out N workers and awaits all. After a
  successful route, the `launch()` sequence posts each boat's `capSchedule`
  to the sim worker as a new `schedule` message.
- `simulator.worker.ts` (modified) — accept new `schedule` message,
  store the schedule per boat, apply each CAP entry when `tickStart`
  crosses its `triggerMs`.
- `SimulatorEngine` (modified) — add `setSchedule(boatId, entries)` and
  internal logic to consume the schedule during `stepOneTick`.
- A "Re-router depuis ici" button visible when `status === 'paused'`, calls
  `computeRoute` with each boat's current `fleet[id].position` as `from`,
  replaces the remaining schedule.

## Public contract

```ts
// packages/routing/src/types.ts
import type { Position, Polar, SailId } from '@nemo/shared-types';
import type { BoatLoadout, ConditionState, CoastlineIndex } from '@nemo/game-engine-core/browser';
import type { WindGridConfig } from '@/lib/projection/windLookup';  // reused type

export type Preset = 'FAST' | 'BALANCED' | 'HIGHRES';

export interface PresetParams {
  timeStepSec: number;
  headingCount: number;
  horizonSec: number;
  sectorCount: number;       // pruning resolution (e.g., 720 = 0.5° per sector)
}

export const PRESETS: Record<Preset, PresetParams> = {
  FAST:     { timeStepSec: 3 * 3600, headingCount: 24, horizonSec: 72 * 3600,  sectorCount: 360 },
  BALANCED: { timeStepSec: 2 * 3600, headingCount: 36, horizonSec: 168 * 3600, sectorCount: 720 },
  HIGHRES:  { timeStepSec: 1 * 3600, headingCount: 72, horizonSec: 168 * 3600, sectorCount: 1440 },
};

export interface RouteInput {
  from: Position;
  to: Position;
  startTimeMs: number;
  polar: Polar;
  loadout: BoatLoadout;
  condition: ConditionState;
  windGrid: WindGridConfig;
  windData: Float32Array;
  coastlineGeoJson: GeoJSON.FeatureCollection;
  preset: Preset;
}

export interface IsochronePoint {
  lat: number;
  lon: number;
  hdg: number;         // heading that led here from parent
  bsp: number;
  tws: number;
  twd: number;
  twa: number;
  sail: SailId;
  timeMs: number;
  distFromStartNm: number;
  parentIdx: number;   // index into previous iso's array; -1 for step 0
}

export interface RoutePolylinePoint {
  lat: number;
  lon: number;
  timeMs: number;
  twa: number;
  tws: number;
  bsp: number;
  sail: SailId;
}

export interface RoutePlan {
  reachedGoal: boolean;
  polyline: RoutePolylinePoint[];
  waypoints: Position[];       // decimated inflection points (cap change ≥ 5°)
  capSchedule: Array<{ triggerMs: number; cap: number; sail?: SailId }>;
  isochrones: IsochronePoint[][];  // one array per step, including t=0
  totalDistanceNm: number;
  eta: number;                 // absolute ms; Infinity if !reachedGoal
  preset: Preset;
  computeTimeMs: number;
}

export function computeRoute(input: RouteInput): Promise<RoutePlan>;
```

`computeRoute` is `async` for API consistency (the worker awaits it) but the
implementation is synchronous inside.

## Algorithm

Isochrone routing with angular sectorization pruning.

### Main loop (pseudocode)

```
startTimeMs = input.startTimeMs
aggEffects = aggregateEffects(input.loadout.items, { tws: initialTws })
coastline = new CoastlineIndex(); coastline.loadFromGeoJson(input.coastlineGeoJson)
weatherLookup = createWindLookup(input.windGrid, input.windData)

iso[0] = [{
  lat: input.from.lat, lon: input.from.lon, hdg: 0, bsp: 0,
  tws: initialTws, twd: initialTwd, twa: 0, sail: 'JIB',
  timeMs: startTimeMs, distFromStartNm: 0, parentIdx: -1,
}]

maxSteps = horizonSec / timeStepSec
stepHeading = 360 / headingCount

for (step = 1; step <= maxSteps; step++) {
  const nextIso: IsochronePoint[] = []

  for (let idx = 0; idx < iso[step-1].length; idx++) {
    const p = iso[step-1][idx]
    const weather = sampleWind(weatherLookup, p.lat, p.lon, p.timeMs)
    if (!weather) continue  // out of GRIB coverage → drop branch

    for (let h = 0; h < 360; h += stepHeading) {
      const twa = computeTWA(h, weather.twd)
      const twaAbs = Math.min(Math.abs(twa), 180)
      if (twaAbs < polar.twa[0]) continue  // dead zone
      const sail = pickOptimalSail(polar, twaAbs, weather.tws)
      const bsp  = computeBspForRouting(polar, sail, twa, weather.tws, aggEffects, input.condition)
      if (bsp < 0.1) continue  // effectively stopped

      const distNm = bsp * (timeStepSec / 3600)
      const newPos = advancePosition(p, h, bsp, timeStepSec)
      if (coastline.segmentCrossesCoast(p, newPos)) continue

      // computeBspForRouting = same speed formula as runTick:
      //   getPolarSpeed(polar, sail, twaAbs, tws)
      //   × conditionSpeedPenalty(condition)
      //   × (1 + aggEffects.speedByTwa[bandFor(twaAbs, [60,90,120,150])])
      //   × (1 + aggEffects.speedByTws[bandFor(tws, [10,20])])
      // If the tick engine already exports computeBsp, import it from
      // @nemo/game-engine-core; otherwise extract it as part of this work.
      nextIso.push({
        lat: newPos.lat, lon: newPos.lon, hdg: h, bsp,
        tws: weather.tws, twd: weather.twd, twa, sail,
        timeMs: p.timeMs + timeStepSec * 1000,
        distFromStartNm: p.distFromStartNm + distNm,
        parentIdx: idx,
      })
    }
  }

  iso[step] = pruneBySector(nextIso, input.from, sectorCount)

  // Early termination: if any point is close enough to the goal, stop.
  // bspMax = max BSP across the polar (precomputed once); arrival radius
  // is half the distance a boat can cover in one time step at top speed
  // so we don't overshoot silently.
  const arrivalRadiusNm = Math.max(1, bspMax * (timeStepSec / 3600) / 2)
  const hit = iso[step].find(p => haversineNM(p, input.to) <= arrivalRadiusNm)
  if (hit) {
    return buildRoutePlan(iso, hit, step, input, reached = true)
  }
}

// Horizon exhausted: return best effort (closest point to goal in last iso).
const closest = iso[maxSteps].reduce((best, p) =>
  haversineNM(p, input.to) < haversineNM(best, input.to) ? p : best
)
return buildRoutePlan(iso, closest, maxSteps, input, reached = false)
```

### Pruning (angular sectorization)

Given an array of candidate points and the departure position, group points
by bearing-from-origin into `sectorCount` bins; for each non-empty bin, keep
only the point with the highest `distFromStartNm`. This drops dominated
points (a point "behind" another in the same sector is always a worse
branch) and keeps the isochrone size bounded: after step K, iso[K] has at
most `sectorCount` points regardless of how many candidates were generated.

```ts
export function pruneBySector(
  points: IsochronePoint[],
  origin: Position,
  sectorCount: number,
): IsochronePoint[] {
  const binWidth = 360 / sectorCount
  const bins: (IsochronePoint | null)[] = new Array(sectorCount).fill(null)
  for (const p of points) {
    const brg = bearingDeg(origin, p)   // 0..360
    const idx = Math.floor(brg / binWidth) % sectorCount
    const kept = bins[idx]
    if (!kept || p.distFromStartNm > kept.distFromStartNm) bins[idx] = p
  }
  return bins.filter((p): p is IsochronePoint => p !== null)
}
```

### Reconstruction

From the arrival point, walk back via `parentIdx` through each previous
isochrone array. This produces a raw polyline. Apply:

- **Inflection-point extraction** (`polyline.ts`): keep only points where
  `|hdg[i] − hdg[i-1]| ≥ 5°` plus the first and last points. These become
  `waypoints` for `WPT`-style orders.
- **Cap schedule** (`schedule.ts`): emit `{ triggerMs, cap }` at each
  inflection, plus a `{ sail }` field when the optimal sail changed at that
  step.

## Dev-simulator UI

### Layout changes

The existing controls bar at the bottom grows a second row (or expands
vertically) with the routing controls:

```
┌── TOP ──────────────────────────────────────────────────────┐
│ Setup │                Map                 │  Comparison     │
├── CONTROLS (bottom) ────────────────────────────────────────┤
│ [▶ Lancer] Vitesse [600][1800][3600][7200]  [⟲] [Nouvelle]  │
│ Preset [FAST][BALANCED][HIGHRES]  [Router tous]  Iso: [●]…  │
└─────────────────────────────────────────────────────────────┘
```

### States

| Routing status | Map shows | Controls enabled |
|---|---|---|
| `idle` | Start marker, end marker (click to move), no routes | Router button (if end set) |
| `computing` | Spinner overlay, start/end markers visible | Everything disabled |
| `done` | Start, end, route polylines (one per boat), isochrones of selected boat (if toggled) | Router button re-enabled for re-compute |

### Flow at "Lancer la simulation" after routing

1. `fleetAssets` already fetched (polars, coastline, windGrid — cached since the route step).
2. `post({ type: 'init', ... })` as today.
3. **New**: `post({ type: 'schedule', boatId, entries: routes.get(boatId).capSchedule })` for each boat with a route.
4. `post({ type: 'start' })`.

Boats without a route fall through to the default CAP 90° behavior.

### Re-router pendant pause

1. `status === 'paused'` shows a new button "⟲ Re-router depuis ici".
2. Click: for each boat, call `computeRoute({ from: fleet[id].position, ..., startTimeMs: launchTimeMs + simTimeMs })`.
3. Post a new `schedule` message per boat (replaces the previous schedule for all `triggerMs > simTimeMs + launchTimeMs`).
4. Resume: simulation continues with the new plan.

## Weather plumbing

The routing module samples wind along candidate trajectories using the same
`createWindLookup` the sim worker uses. The GRIB buffer passed into
`RouteInput.windData` is **copied** (not transferred) by the caller so that
after `computeRoute` returns, the buffer is still usable by the sim worker
at `init` time. For 4 parallel routings × ~50 MB each, we allocate
~200 MB of JS heap transiently — acceptable on desktop, but the sequence
must be: route → init (buffer transferred once) → discard routing workers.

On out-of-coverage samples (`weatherLookup(...) === null`), the candidate
branch is dropped. This truncates long horizons when the forecast doesn't
reach `horizonSec`. `RoutePlan.reachedGoal` is then `false` with a partial
polyline.

## Error handling

- **No reachable target** within horizon: return with `reachedGoal: false`
  and the polyline toward the closest point reached. UI shows a warning
  overlay "Cible non atteinte dans la fenêtre de {horizon}h — meilleur
  effort affiché".
- **Worker exception** (unexpected): worker posts `{ type: 'error', message }`.
  Main thread: mark `routing.error` and show a toast. No crash.
- **Dead-zone start**: if initial TWA cannot move the boat (e.g., pointing
  straight into wind), iso[0] produces zero children → the algorithm
  terminates with `reachedGoal: false` and zero-length polyline. UI shows
  "Impossible de démarrer : face au vent".

## Testing

### Unit tests (package)

- `isochrones.test.ts` — constant 12 kts N wind, 100 NM east traverse,
  assert reached, polyline length, ETA sanity.
- `pruning.test.ts` — 3600-point input → ≤ 360 bins, max distance per bin
  retained.
- `schedule.test.ts` — 10-segment polyline → schedule entries only on cap
  changes ≥ 5°; replaying the schedule reconstructs the polyline to ε.
- `determinism.test.ts` — same input × 2 → same output (byte-equal).

### Integration

- `e2e-routing.test.ts` in `apps/web` — spawn `SimulatorEngine` with 1 boat,
  apply route schedule, simulate 20 h at 3600×, assert final position within
  3 NM of target.

### Manual recette

1. `/dev/simulator` — set start in Bay of Biscay, end in Azores, add 4
   boats (2 foilers + 2 petit-temps), BALANCED preset.
2. Expected observations:
   - Each boat's route is visibly different (foilers seek windy zones,
     petit-temps cut straighter).
   - Toggling "Iso: Bateau N" shows the propagation pattern — "fingers"
     extend toward favorable wind.
   - ETAs differ by hours between the fastest foiler and the slowest
     petit-temps.
   - Launching and running simulation at 3600× shows boats track their
     routes closely until the first order is given manually.
3. Re-routing test: pause at t=24h, click "Re-router depuis ici" — routes
   redraw from current positions; resume and verify they head to the goal.

## Scope

### In scope
- Package `@nemo/routing` (isochrones, pruning, polyline extraction,
  schedule, 3 presets, all tests).
- Worker `routing.worker.ts` (spawned once per routing, single-shot).
- Dev-simulator UI: `EndPointLayer`, `RouteLayer`, `IsochroneLayer`,
  `RoutingControls`, integration into `DevSimulatorClient`.
- `SimulatorEngine.setSchedule()` + schedule application in `stepOneTick`.
- New `schedule` message in `simulator.worker.ts`.
- "Re-router depuis ici" during pause.
- Tests above + manual recette.

### Out of scope (explicit YAGNI)
- `/play` UI (separate follow-up spec once module is validated).
- Multi-segment routing (via required waypoints).
- Comparing multiple routes side by side.
- Export GPX / KML.
- Animating isochrone propagation (propagation is drawn statically; no
  step-by-step animation).
- Ensemble-forecast / uncertainty.
- Alternative pruning strategies (spatial grid).
- WASM / SharedArrayBuffer optimization.
- Caching routes between sessions.
- Toggling between waypoint-based and cap-schedule-based order injection in
  the dev simulator (we pick cap schedule for precision).

## Implementation order (high level)

1. Create `@nemo/routing` package skeleton + types + presets.
2. Implement pruning + bearing math, unit-test.
3. Implement `computeRoute` main loop, unit-test against constant-wind
   fixture.
4. Implement polyline backtrack + inflection extraction + schedule, unit-test.
5. Build `routing.worker.ts` and wire into `DevSimulatorClient`.
6. Add `EndPointLayer` + `RouteLayer` + `IsochroneLayer`.
7. Add `RoutingControls` + routing flow orchestration.
8. Add `setSchedule` on `SimulatorEngine` + message plumbing.
9. Add re-routing during pause.
10. Manual recette + tune parameters if needed.

Detailed per-task acceptance criteria come in the implementation plan.
