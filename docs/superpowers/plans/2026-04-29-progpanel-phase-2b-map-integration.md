# ProgPanel Phase 2b — Map integration + projection 2-layers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the ProgPanel V2 redesign by adding map integration: per-order markers on the map (cap/sail/wp/finalCap with lucide icons), click-marker-to-edit, WP click-to-place + drag-on-map. Render the projection in two layers (committed dimmed when dirty + draft full). Add `programming.minWpDistanceNm: 3` to game-balance.json with safety-radius validation. Bonus: clean up the tech debt flagged in Phase 2a's final review.

**Out of scope:** Anything beyond the spec. No engine changes (Phase 0 + 2a already cover the wire). No new editors. No keyboard support (deferred).

**Architecture:** The projection worker is extended to accept a `ProgSnapshot { committed, draft }` and emits both projections in one tick. MapCanvas grows a new GeoJSON source for order markers, registers click handlers per layer that bubble up to ProgPanel via a shared "edit-target" state. WP drag uses MapLibre's built-in pointer capture on the marker. The "place WP on map" mode uses a single-click handler gated on a panel-side flag (`pickingWp`).

**Tech Stack:** TypeScript strict, React 19.2, MapLibre GL, Web Worker projection, vitest.

---

## File map

**Created:**
- (none new — all changes are extensions/refactors)

**Modified:**
- `packages/game-balance/game-balance.json` — add `programming.minWpDistanceNm: 3`
- `packages/game-balance/src/...` — add typed accessor (mirror existing patterns)
- `apps/web/public/data/game-balance.json` — duplicate value (the project keeps two copies — see CLAUDE.md note)
- `apps/web/src/lib/projection/types.ts` — extend `ProjectionInput` with optional draft segments
- `apps/web/src/workers/projection.worker.ts` — emit projections for both committed and draft when present
- `apps/web/src/hooks/useProjectionLine.ts` — feed both `prog.committed` and `prog.draft` segments; render two MapLibre layers
- `apps/web/src/components/play/MapCanvas.tsx` — new `prog-order-markers` source + 4 layers (per kind) + click + drag handlers
- `apps/web/src/components/play/ProgPanel.tsx` — surface `editingOrder` to global store so MapCanvas can react; surface `pickingWp` flag for WP-place mode
- `apps/web/src/lib/store/index.ts` (or progSlice) — add UI-coordination fields (`editingOrder`, `pickingWp`) accessible by both ProgPanel and MapCanvas
- `apps/web/src/components/play/prog/WpEditor.tsx` — un-restrict NEW path: provide click-on-map prompt + accept lat/lon from the picker + show "déplacer sur la carte" hint when editing existing
- `apps/web/src/lib/prog/safetyRadius.ts` (new) — pure helper `validateWpDistance(boatPos, wpPos, minNm): boolean`
- `apps/web/src/lib/prog/safetyRadius.test.ts` (new)

**Tech debt cleanup (final task):**
- Replace `deepEqDraft` JSON.stringify with structural compare
- Unify ProgPanel mutation access pattern (selectors at top, no inline `useGameStore.getState()`)
- Reformulate "Tout effacer" body
- Move `FinalCapEditor` inline styles into `Editor.module.css`
- Drop legacy `capScheduleToOrders` / `waypointsToOrders` from `applyRoute.ts` (no production consumers; keep only `*ToProgDraft` factories)

---

## Conventions

- All work on `feat/progpanel-phase-2b` branched from `main`.
- Commit messages: `feat(prog): …`, `feat(map): …`, `refactor(prog): …`, `chore(game-balance): …`.
- Run vitest with `pnpm --filter @nemo/web test`. Run game-balance tests with `pnpm --filter @nemo/game-balance test` if relevant.
- Manual smoke: many tasks need a real map + dev server. Implementer agents typically can't run a dev server — they should flag this and let the controller smoke before merge. Each task notes its smoke criteria.

---

## Pre-task: branch state

Before Task 1:

- `git status` clean (the controller's parallel work should be committed or stashed by now)
- `pnpm --filter @nemo/web test` reports 190/190
- `pnpm -r typecheck` clean
- A dev server can boot — the controller verifies once before Phase 2b starts

---

## Task 1: Game-balance config + safety-radius helper (TDD)

**Files:**
- Modify: `packages/game-balance/game-balance.json`
- Modify: `apps/web/public/data/game-balance.json` (duplicate — known divergence point per CLAUDE.md)
- Modify: `packages/game-balance/src/...` (typed accessor)
- Create: `apps/web/src/lib/prog/safetyRadius.ts` + test file

### Step 1: Read the current game-balance shape

Open `packages/game-balance/game-balance.json` to see how existing config sections are organized (e.g. `maneuvers`, `sails`). Decide where `programming` fits — likely a new top-level key:

```json
{
  // ... existing sections ...
  "programming": {
    "minWpDistanceNm": 3
  }
}
```

Add the same field to `apps/web/public/data/game-balance.json`. **Verify the two files stay in sync** — the project's CLAUDE.md flags a known pre-existing divergence on the `swell` block; do NOT touch swell, just add `programming`.

### Step 2: Add typed accessor in `@nemo/game-balance`

Mirror the existing pattern (e.g. how `maneuvers` is exposed). The `GameBalance` import (`@nemo/game-balance/browser`) is what the projection worker uses (lib/store consumers may use a different entry — check).

Likely TypeScript shape addition:
```ts
export interface GameBalanceConfig {
  // ... existing
  programming: {
    minWpDistanceNm: number;
  };
}
```

### Step 3: Create the safety-radius helper

Create `apps/web/src/lib/prog/safetyRadius.ts`:

```ts
import { haversinePosNM } from '@/lib/geo';

/**
 * True when the WP position is at least `minNm` nautical miles away from
 * the boat. Used by the WP editor (Phase 2b) to validate manual placement.
 *
 * Cf. spec docs/superpowers/specs/2026-04-28-progpanel-redesign-design.md
 * (Rayon de sécurité section).
 */
export function validateWpDistance(
  boat: { lat: number; lon: number },
  wp: { lat: number; lon: number },
  minNm: number,
): boolean {
  return haversinePosNM(boat, wp) >= minNm;
}
```

Create `apps/web/src/lib/prog/safetyRadius.test.ts` with 3-4 test cases (boat at origin + WP at varying distances, exactly at threshold, just under, just over).

### Step 4: Verify, commit

```bash
pnpm --filter @nemo/web test src/lib/prog/safetyRadius.test.ts
pnpm -r typecheck
git add packages/game-balance/game-balance.json apps/web/public/data/game-balance.json packages/game-balance/src/... apps/web/src/lib/prog/safetyRadius.ts apps/web/src/lib/prog/safetyRadius.test.ts
git commit -m "feat(game-balance): add programming.minWpDistanceNm + safety-radius helper"
```

---

## Task 2: Projection worker — accept ProgSnapshot, emit 2-layer projections

**Files:**
- Modify: `apps/web/src/lib/projection/types.ts` — extend `ProjectionInput`/`ProjectionResult`
- Modify: `apps/web/src/workers/projection.worker.ts` — emit both projections when present
- Modify: `apps/web/src/hooks/useProjectionLine.ts` — feed both, draw two layers

This task is the heart of Phase 2b: the live-draft projection.

### Step 1: Read the current projection worker types

Open `apps/web/src/lib/projection/types.ts` and trace how `ProjectionInput` flows into the worker. Key fields likely include `orderQueue` (or equivalent — Phase 2a Task 4 may have left a `segments` field).

### Step 2: Extend the input shape

Replace the single `segments` (or `orderQueue`) feed with:

```ts
export interface ProjectionInput {
  // ... existing fields (boat state, weather, wear, etc.)
  /** Committed order segments — server-known. Always rendered. */
  committedSegments: ProjectionSegment[];
  /** Draft order segments — user's in-progress edits. When omitted, only
   *  committed is rendered (treated as up-to-date). */
  draftSegments?: ProjectionSegment[];
}

export interface ProjectionResult {
  // ... existing fields
  committed: ProjectionPoint[];
  /** When `draftSegments` was provided AND differs from committed, the
   *  draft simulation. Consumer can render it as a separate (highlighted)
   *  layer. */
  draft?: ProjectionPoint[];
}
```

Adjust the worker's main loop to run the simulation twice when both are present (or once when only committed). The simulation is per-segment-list, so this is a straightforward duplication of the loop with different inputs.

**Performance note**: doubling the projection cost is acceptable per the spec ("when isDirty === false, only render one layer"). The hook (Step 3) gates the second simulation by checking if draft differs from committed.

### Step 3: Update `useProjectionLine` to feed both + draw two layers

In `apps/web/src/hooks/useProjectionLine.ts`:

1. Read both `prog.committed` and `prog.draft` from the store.
2. Compute committed segments (existing path).
3. If `prog.draft !== prog.committed` (referential check is enough — Zustand's clone in `markCommitted` creates new refs), also compute draft segments.
4. Send both to the worker.
5. On worker response, render two MapLibre layers:
   - `projection-line-committed` (existing, but renamed) — solid + opacity 0.4 when dirty, full when not
   - `projection-line-draft` (new) — solid + full opacity, only visible when dirty
6. Same for the time-markers and maneuver-markers (also two layers each).

Spec the new layer styling:
```js
// Committed: dimmed when dirty
'line-opacity': ['case', ['boolean', ['get', 'isDirty'], false], 0.4, 1.0],
```

Or set opacity programmatically based on `isDirty` state propagated as a layer property.

### Step 4: Verify

`pnpm --filter @nemo/web test` — should still pass (no new tests in this task).
`pnpm -r typecheck` — clean.

### Step 5: Manual smoke

The controller verifies:
- With idle prog (no draft changes) → only one projection line visible (committed) at full opacity, identical to Phase 2a behavior.
- After editing an order in ProgPanel without confirming → committed projection dims to ~40%, draft projection draws on top at full opacity.
- After Confirmer → both lines collapse back to one (committed + draft converge).
- On Annuler tout → back to one line.

### Step 6: Commit

```bash
git commit -m "feat(prog): projection worker emits 2-layer (committed + draft) snapshot"
```

---

## Task 3: Map order markers (cap/sail/wp/finalCap)

**Files:**
- Modify: `apps/web/src/components/play/MapCanvas.tsx`
- Modify: `apps/web/src/lib/store/index.ts` (or progSlice) — add UI state fields

### Step 1: Add UI coordination state in the store

In the progSlice, add:

```ts
interface ProgState {
  draft: ProgDraft;
  committed: ProgDraft;
  /** Currently-edited order — set by ProgPanel, observed by MapCanvas. */
  editingOrder: { kind: 'cap'|'sail'|'wp'|'finalCap'; id: string } | null;
  /** True when the WP editor is in "click on map to place" mode. */
  pickingWp: boolean;
}
```

Add mutations:
```ts
setEditingOrder: (e: ProgState['editingOrder']) => void;
setPickingWp: (b: boolean) => void;
```

Update `INITIAL_PROG` to include `editingOrder: null, pickingWp: false`.

### Step 2: Update ProgPanel to publish editingOrder

In `ProgPanel.tsx`, replace the local `editing` state with the store value. When the user opens an editor (click +, click ✎), call `setEditingOrder(...)`. When they close (Annuler/OK), call `setEditingOrder(null)`.

### Step 3: Add markers to MapCanvas

In `apps/web/src/components/play/MapCanvas.tsx`, after the existing projection-marker layers, add:

```ts
// New source for order markers
map.addSource('prog-order-markers', {
  type: 'geojson',
  data: { type: 'FeatureCollection', features: [] },
});

// One layer per kind (different icons + colors)
map.addLayer({
  id: 'prog-order-markers-cap',
  source: 'prog-order-markers',
  filter: ['==', ['get', 'kind'], 'cap'],
  type: 'symbol',
  layout: {
    'icon-image': 'compass-icon', // pre-loaded into map sprite
    'icon-size': 0.8,
    'icon-allow-overlap': true,
  },
});
// ... same for 'sail', 'wp', 'finalCap'
```

The icons need to be loaded into the map sprite. Use `map.loadImage(...)` with paths to PNG/SVG assets (or generate small inline data URIs from the lucide icons).

**Alternative**: skip MapLibre symbols and render markers as React-DOM via `maplibregl.Marker` instances synced to the order positions. This is heavier but gives lucide icons directly without sprite loading. Pick whichever is most consistent with existing markers in MapCanvas.

### Step 4: Click handlers

Add a click handler per layer that calls `setEditingOrder`:

```ts
map.on('click', 'prog-order-markers-cap', (e) => {
  const id = e.features?.[0]?.properties?.id;
  if (id) {
    useGameStore.getState().setEditingOrder({ kind: 'cap', id });
    useGameStore.getState().openPanel('programming'); // ensure panel is open
  }
});
// ... same for other kinds
```

### Step 5: Position prediction

Each marker's lat/lon comes from the projection. For AT_TIME orders, the marker sits at the predicted boat position when `time` is reached — read from the projection result. For AT_WAYPOINT orders, the marker sits next to the referenced WP.

In `useProjectionLine.ts`, post-process the projection result to compute marker positions:
- For each cap/sail order with AT_TIME trigger: find the projection point at `t === order.trigger.time`. Use that as the marker position.
- For WP order: use `wp.lat/lon` directly.
- For finalCap: position next to last WP.
- For sail with AT_WAYPOINT: offset by 12px from the referenced WP marker.

Update the GeoJSON source on each projection update.

### Step 6: Verify + commit

Manual smoke: open ProgPanel, apply a route → markers appear on the map. Click a cap marker → ProgPanel opens directly on that cap order's editor.

```bash
git commit -m "feat(map): order markers per kind + click-to-edit"
```

---

## Task 4: WP click-to-place + drag-on-map

**Files:**
- Modify: `apps/web/src/components/play/prog/WpEditor.tsx` — un-restrict NEW path, add click-to-place button
- Modify: `apps/web/src/components/play/MapCanvas.tsx` — handle map click in `pickingWp` mode + drag on WP markers

### Step 1: Update WpEditor

Remove the "Phase 2b coming" banner. NEW path:

```tsx
{isNew ? (
  <>
    <button
      type="button"
      className={wpStyles.pickBtn}
      onClick={() => useGameStore.getState().setPickingWp(true)}
    >
      Cliquer sur la carte pour positionner
    </button>
    {pickedLat !== null && (
      <div>...affiche la position picked...</div>
    )}
  </>
) : (
  // existing display-mode UI
)}
```

The editor receives `pickedLat`/`pickedLon` via the store: when `pickingWp === true` and the user clicks on the map, MapCanvas writes `{lat, lon}` to a store field (or directly creates the WP and exits picking mode). Read the store field via a selector in WpEditor.

Validate the position via `validateWpDistance` from Task 1. If too close, surface a toast or inline error.

### Step 2: Update MapCanvas click handler

Add a global map click handler (not tied to a layer):

```ts
map.on('click', (e) => {
  const state = useGameStore.getState();
  if (!state.pickingWp) return; // ignore unless we're picking
  const { lat, lng } = e.lngLat;
  const boat = { lat: state.hud.lat, lon: state.hud.lon };
  if (!validateWpDistance(boat, { lat, lon: lng }, minWpNm)) {
    // Toast: "WP trop proche du bateau (min N NM)"
    return;
  }
  // Add WP to the draft
  state.addWpOrder({
    id: makeId('wp'),
    trigger: state.prog.draft.wpOrders.length === 0
      ? { type: 'IMMEDIATE' }
      : { type: 'AT_WAYPOINT', waypointOrderId: state.prog.draft.wpOrders.at(-1)!.id },
    lat, lon: lng,
    captureRadiusNm: 0.5,
  });
  state.setPickingWp(false);
  state.setEditingOrder(null); // close the editor; the WP is now in the queue
});
```

### Step 3: Drag-on-map for WP markers

When a WP marker is the `editingOrder`, make it draggable. Use `maplibregl.Marker({draggable: true})` for that specific WP, and on `dragend` call `updateWpOrder(id, { lat, lon })`.

Validate the new position with `validateWpDistance` — reject if too close (snap back to previous).

### Step 4: Verify + commit

Manual smoke:
- Open WpEditor for a router-applied WP → pin is draggable, dragging updates the projection line live.
- Open + Ajouter un WP → editor shows "Cliquer sur la carte" button → click button → click on map → WP appears in the list.
- Try to place WP < 3NM from boat → rejected with toast.

```bash
git commit -m "feat(map): WP click-to-place + drag-on-map with safety-radius validation"
```

---

## Task 5: Tech debt cleanup

**Files:** various (see Phase 2a final review)

- Replace `deepEqDraft` JSON.stringify with structural compare in `ProgPanel.tsx`
- Unify ProgPanel mutation access (selectors at top of component, no `useGameStore.getState()`)
- Reformulate "Tout effacer" ConfirmDialog body to be less ambiguous
- Move `FinalCapEditor` inline styles into `Editor.module.css` (extract `.triggerReadout`)
- Drop legacy `capScheduleToOrders` / `waypointsToOrders` from `applyRoute.ts`; update `applyRoute.test.ts` to use the new factories

Each is a small focused change. Group into one commit:

```bash
git commit -m "chore(prog): tech debt cleanup from Phase 2a final review"
```

---

## Task 6: Repo verification + final review

- [ ] **Step 1: Full repo tests**
- [ ] **Step 2: Repo typecheck**
- [ ] **Step 3: Manual smoke (controller)**

Manual smoke covers:
- All Phase 2a flows still work
- Plus map markers appear on apply-route
- Plus click-marker opens editor
- Plus drag-WP updates projection
- Plus click-empty-map-while-picking creates a new WP
- Plus 3 NM safety radius rejects close placements

Final tag commit if all green:
```bash
git commit --allow-empty -m "chore: ProgPanel V2 redesign complete (all phases)"
```

---

## Self-review notes (for the implementer)

- **Two-layer projection** is the riskiest part: doubling the worker's CPU cost. Phase 2a's projection runs at ~50Hz during cursor drag (per the existing perf comment in MapCanvas). Profile after Task 2 to ensure no regression.
- **MapLibre marker sprites vs maplibregl.Marker**: pick one and stick with it. Mixing them creates inconsistent z-order and click semantics.
- **WP drag must use the store's `updateWpOrder`** (not direct GeoJSON mutation) — otherwise the projection won't update.
- **Picking-mode UX**: the user might click on the map by accident while not in picking mode. Make sure the click handler short-circuits unless `state.pickingWp === true`.
- **Marker icons**: the spec calls for lucide-react icons (Anchor / Wind / MapPin / AlertTriangle). MapLibre symbols require raster sprites — converting lucide to PNG is non-trivial. Easier path: use HTML markers (`maplibregl.Marker` with a DOM element containing the lucide React icon). Less performant for many markers but matches the design system trivially.
- **Click marker → switch mode**: if the user clicks a WP marker while ProgPanel is in `cap` mode, the panel needs to switch to `wp` mode first (with the existing confirm dialog). Don't bypass the confirm.
- **Game-balance JSON sync**: the project has TWO copies (engine source + web public). CLAUDE.md notes a known divergence on `swell` — don't touch that. Just add `programming.minWpDistanceNm` to both files.

## Phase 2c readiness (none planned)

After Phase 2b, the ProgPanel V2 redesign is functionally complete. No Phase 2c is planned in the spec. Future enhancements (i18n of hardcoded French strings, keyboard support, polar/forecast preview at trigger time, drag-and-drop WP reordering) are listed as "Ouvertures (post-V1)" in the spec and can be picked up as separate features.
