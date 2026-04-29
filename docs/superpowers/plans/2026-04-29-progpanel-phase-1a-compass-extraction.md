# ProgPanel Phase 1a — Compass Primitives Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract three reusable presentational primitives — `<CompassDial>`, `<CompassReadouts>`, `<CompassLockToggle>` — from the existing `apps/web/src/components/play/Compass.tsx`. The live `Compass` keeps every observable behavior (visual layout, drag/wheel interaction, optimistic updates, keyboard shortcuts, manoeuvre hints, VMG glow), but is rewritten as a thin wrapper composing the new primitives. The primitives are reusable by Phase 2's ProgPanel rewrite to render the same dial/readouts/lock-toggle when editing a draft Cap order.

**Architecture:** Pure prop-driven primitives, no store reads, no `sendOrder`. The wrapper `Compass.tsx` continues to read the Zustand store, manage local edit state (`targetHdg`, `twaLocked`, `committedTwaLock`), compute polar-derived values (`vmgGlow`, `displayBsp`, manoeuvre hints), and dispatch `apply`/`cancelEdit`/`toggleTwaLock`. The dial's internal drag handler still mutates `<g id="boat">` and `<g id="ghost">` SVG transforms directly for 60Hz preview, but it is now self-contained inside `<CompassDial>`.

**Tech Stack:** TypeScript strict, React 19.2, CSS Modules, no test runner change (vitest for `apps/web`).

---

## File map

**Created:**
- `apps/web/src/components/play/compass/CompassDial.tsx` — pure SVG dial primitive
- `apps/web/src/components/play/compass/CompassDial.module.css` — dial-specific styles (subset of current `Compass.module.css` lines 110-124, 270-272, plus the responsive overrides on `.stage` / `.cardinalLabel` / `.degreeLabel`)
- `apps/web/src/components/play/compass/CompassReadouts.tsx` — pure 3-column readout primitive
- `apps/web/src/components/play/compass/CompassReadouts.module.css` — readouts styles (subset, lines 56-108 of current CSS plus responsive overrides on readouts)
- `apps/web/src/components/play/compass/CompassLockToggle.tsx` — pure lock-toggle button primitive
- `apps/web/src/components/play/compass/compassGeometry.ts` — pure functions/constants (`pt`, `isInVmgZone`, IMOCA constants, `R_OUTER`, `R_INNER`, `VB`, `CX`, `CY`)
- `apps/web/src/components/play/compass/WindWaves.tsx` — animated wave component (extracted from current Compass.tsx lines 47-96)
- `apps/web/src/components/play/compass/CompassDial.test.tsx` — vitest unit tests for `<CompassDial>` (drag math, prop-driven rendering)
- `apps/web/src/components/play/compass/CompassReadouts.test.tsx` — vitest unit tests for `<CompassReadouts>` (formatting, vmgGlow class application)

**Modified:**
- `apps/web/src/components/play/Compass.tsx` — rewritten as a thin wrapper composing the 3 primitives + the `Compass.tsx`-only Lock/Valider/Cancel actions and the maneuver-hint overlay
- `apps/web/src/components/play/Compass.module.css` — trimmed to wrapper-only styles (`.wrapper`, `.floatingHint`, `.hintIcon`, `.hintGybe/Tack/Sail`, `.vmgGlow`, `.actions`, `.actionBtn`, `.locked`, `.applyActive`, `.applyInactive`, `.cancelActive`, `.cancelInactive`, `.cancelX`, modal styles, plus responsive overrides on `.wrapper` / `.actions` / `.actionBtn`)

**Removed (deleted at end of refactor):**
- The inline `WindWaves` function in `Compass.tsx`
- The inline geometry helpers (`pt`, `isInVmgZone`, IMOCA constants) in `Compass.tsx`

---

## Conventions used in this plan

- Run `apps/web` tests with `pnpm --filter @nemo/web test` (vitest).
- Run a single test file with `pnpm --filter @nemo/web test src/components/play/compass/CompassDial.test.tsx`.
- Run typecheck with `pnpm --filter @nemo/web typecheck` (note: pre-existing errors in `.next/dev/types/routes.d.ts` are not related — verify any new error you see is genuinely new before treating it as a blocker).
- Vitest config + setup live at `apps/web/vitest.config.ts` (verify path) — re-use the existing convention.
- Each task ends with a commit. Commit messages follow `feat(scope): …` / `refactor(scope): …` style as observed in recent `git log`.
- After each major commit, manually open the dev server and check the Compass live behavior by eye (the plan flags where).

---

## Pre-task: ensure the dev server starts

Before touching code, verify your local dev environment is healthy. From `apps/web`, `pnpm dev` should boot without surfacing pre-existing TypeScript errors that would mask regressions introduced during this work. **Skip this if you've already confirmed in this session.**

```bash
pnpm --filter @nemo/web dev
```

Expected: dev server boots, you can navigate to the play screen, and the Compass renders with: 3-column readouts (Vitesse / Cap / TWA), the cadran with cardinal labels (N E S O), animated wind waves outside the circle, the gold IMOCA silhouette pointing at current heading, and three action buttons at the bottom (TWA / Valider / ✕). Drag the cadran — the boat should follow the cursor smoothly and the Valider button should turn gold. Click ✕ — the boat snaps back. This is your "pre-extraction reference."

Stop the dev server before starting Task 1 (or keep it running and rebuild after each task).

---

## Task 1: Extract pure helpers — `compassGeometry.ts`

**Files:**
- Create: `apps/web/src/components/play/compass/compassGeometry.ts`

This is the lowest-risk, zero-behavior-change task. We move pure constants and pure helper functions to a sibling module. No JSX, no state.

- [ ] **Step 1: Read the current Compass.tsx top section**

Open `apps/web/src/components/play/Compass.tsx`. Identify the constants and helpers at lines 14-44 and 41-44:
- `VB = 220`
- `IMOCA_VB = { w: 611, h: 188 }`
- `IMOCA_PATH` (the long M89... string)
- `IMOCA_SCALE = 50 / IMOCA_VB.w`
- `CX = VB / 2`
- `CY = VB / 2`
- `R_OUTER = 96`
- `R_INNER = 82`
- `pt(r, deg)` function
- `isInVmgZone(twa)` function

Verify their definitions match before continuing.

- [ ] **Step 2: Create the new module**

Create `apps/web/src/components/play/compass/compassGeometry.ts` with these contents:

```ts
/**
 * Pure geometry helpers + constants for the Compass primitives.
 *
 * Extracted from `apps/web/src/components/play/Compass.tsx` so the
 * SVG-rendering primitive (`<CompassDial>`) and any future preview consumer
 * (Phase 2 ProgPanel cap-order editor) share the same coordinate system
 * and IMOCA silhouette.
 *
 * No React, no DOM, no store.
 */

/** SVG viewBox size (square). */
export const VB = 220;

/** Original viewBox of the IMOCA silhouette path (from a stock SVG asset). */
export const IMOCA_VB = { w: 611, h: 188 } as const;

/**
 * IMOCA silhouette path. Originally points RIGHT — consumers rotate -90° to
 * make it point UP, then rotate by heading.
 */
export const IMOCA_PATH = 'M89.62 0.00 L84.78 0.93 L68.78 0.94 L32.11 3.00 L18.73 3.26 L0.00 80.71 L0.00 103.30 L2.80 111.69 L14.24 153.84 L17.40 166.90 L18.32 175.45 L25.85 176.86 L51.53 178.03 L60.95 178.02 L73.13 179.02 L97.07 179.19 L98.62 179.34 L99.65 180.00 L210.37 180.00 L215.52 179.04 L233.38 179.06 L243.05 178.12 L264.43 177.00 L271.73 177.04 L283.24 175.39 L299.16 174.28 L302.12 174.51 L336.55 171.65 L382.22 166.14 L417.19 160.27 L444.90 154.36 L472.32 147.28 L499.36 138.92 L525.97 129.17 L553.80 117.15 L588.07 99.45 L603.00 89.93 L603.00 92.93 L603.00 89.26 L600.20 87.99 L577.71 74.58 L549.21 60.42 L520.01 48.24 L494.37 39.23 L468.48 31.48 L442.36 24.91 L407.19 17.75 L371.69 12.20 L326.93 7.11 L272.77 3.02 L236.84 0.99 L223.36 0.89 L219.33 0.00 L89.62 0.00 Z';

/** Scale factor that fits the IMOCA silhouette (~50 px tall) inside the cadran. */
export const IMOCA_SCALE = 50 / IMOCA_VB.w;

/** Cadran center coordinates (square viewBox). */
export const CX = VB / 2;
export const CY = VB / 2;

/** Outer / inner ring radii. */
export const R_OUTER = 96;
export const R_INNER = 82;

/**
 * Polar → cartesian, rounded to 0.01.
 * 0° = North (top), 90° = East (right). Matches the cadran layout.
 */
export function pt(r: number, deg: number): { x: number; y: number } {
  const rad = ((deg - 90) * Math.PI) / 180;
  return {
    x: Math.round((CX + r * Math.cos(rad)) * 100) / 100,
    y: Math.round((CY + r * Math.sin(rad)) * 100) / 100,
  };
}

/** True when |TWA| sits in either VMG-upwind (38..54°) or VMG-downwind (140..162°) bands. */
export function isInVmgZone(twa: number): boolean {
  const a = Math.abs(twa);
  return (a >= 38 && a <= 54) || (a >= 140 && a <= 162);
}
```

- [ ] **Step 3: Replace Compass.tsx imports**

In `apps/web/src/components/play/Compass.tsx`:

1. Find the `import` block at the top.
2. Add: `import { VB, IMOCA_VB, IMOCA_PATH, IMOCA_SCALE, CX, CY, R_OUTER, R_INNER, pt, isInVmgZone } from './compass/compassGeometry';`
3. Delete the in-file definitions of those same symbols (lines ~16-44 + the `pt` and `isInVmgZone` functions). Be careful: the `WindWaves` component uses `pt` indirectly via the inline math — verify there's no other consumer.

- [ ] **Step 4: Verify typecheck**

Run: `pnpm --filter @nemo/web typecheck`
Expected: only the pre-existing errors in `.next/dev/types/routes.d.ts`. If you see a new error referring to `Compass.tsx`, fix the import or restore the missing symbol.

- [ ] **Step 5: Verify visual smoke (optional but recommended)**

If your dev server is running, the Compass should render unchanged. (Pure refactor, no behavior change.) If not running, skip and rely on typecheck for this task.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/play/compass/compassGeometry.ts apps/web/src/components/play/Compass.tsx
git commit -m "refactor(compass): extract pure geometry helpers to compass/compassGeometry"
```

---

## Task 2: Extract `<WindWaves>` component

**Files:**
- Create: `apps/web/src/components/play/compass/WindWaves.tsx`

The `WindWaves` function is already defined as a separate function in Compass.tsx (lines ~47-96). Extracting it is mechanical.

- [ ] **Step 1: Create the new file**

Create `apps/web/src/components/play/compass/WindWaves.tsx`:

```tsx
/**
 * Animated wind indicators: 1 to 3 wavy radial lines flowing toward the
 * cadran center. Wave count scales with TWS.
 *
 * Extracted from `apps/web/src/components/play/Compass.tsx`.
 */

import type { ReactElement } from 'react';

interface WindWavesProps {
  /** True wind direction in degrees (0 = North, 90 = East). */
  twd: number;
  /** True wind speed in knots — controls the number of streams (1 / 2 / 3). */
  tws: number;
  /** Cadran center x coordinate. */
  cx: number;
  /** Cadran center y coordinate. */
  cy: number;
  /** Cadran outer ring radius. */
  r: number;
}

export default function WindWaves({ twd, tws, cx, cy, r }: WindWavesProps): ReactElement {
  const count = tws < 10 ? 1 : tws <= 25 ? 2 : 3;
  const spread = 8;
  const waves: ReactElement[] = [];
  for (let i = 0; i < count; i++) {
    const dx = count === 1 ? 0 : (i - (count - 1) / 2) * spread;
    const yStart = cy - r - 22;
    const yEnd = cy - r - 4;
    const yMid = (yStart + yEnd) / 2;
    const amp = 3;
    waves.push(
      <g key={i} transform={`rotate(${twd} ${cx} ${cy})`}>
        <path
          d={`M${cx + dx},${yStart} Q${cx + dx + amp},${yMid - 4} ${cx + dx},${yMid} Q${cx + dx - amp},${yMid + 4} ${cx + dx},${yEnd}`}
          fill="none"
          stroke="#f5f0e8"
          strokeWidth="1.5"
          strokeLinecap="round"
        >
          <animate
            attributeName="d"
            values={
              `M${cx + dx},${yStart} Q${cx + dx + amp},${yMid - 4} ${cx + dx},${yMid} Q${cx + dx - amp},${yMid + 4} ${cx + dx},${yEnd};` +
              `M${cx + dx},${yStart} Q${cx + dx - amp},${yMid - 4} ${cx + dx},${yMid} Q${cx + dx + amp},${yMid + 4} ${cx + dx},${yEnd};` +
              `M${cx + dx},${yStart} Q${cx + dx + amp},${yMid - 4} ${cx + dx},${yMid} Q${cx + dx - amp},${yMid + 4} ${cx + dx},${yEnd}`
            }
            dur={`${1.4 + i * 0.2}s`}
            repeatCount="indefinite"
          />
        </path>
        <path
          d={`M${cx + dx},${yEnd + 5} L${cx + dx - 3},${yEnd - 1} L${cx + dx + 3},${yEnd - 1} Z`}
          fill="#f5f0e8"
        >
          <animate
            attributeName="opacity"
            values="0.8;1;0.8"
            dur={`${1.4 + i * 0.2}s`}
            repeatCount="indefinite"
          />
        </path>
      </g>
    );
  }
  return <g>{waves}</g>;
}
```

- [ ] **Step 2: Replace Compass.tsx usage**

In `apps/web/src/components/play/Compass.tsx`:

1. Add `import WindWaves from './compass/WindWaves';` to the imports.
2. Delete the in-file `function WindWaves(...)` definition.
3. Verify the `<WindWaves twd={twd} tws={tws} cx={CX} cy={CY} r={R_OUTER} />` JSX call site still compiles.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @nemo/web typecheck`
Expected: same pre-existing errors as Task 1, no new errors in `Compass.tsx`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/play/compass/WindWaves.tsx apps/web/src/components/play/Compass.tsx
git commit -m "refactor(compass): extract WindWaves into compass/WindWaves"
```

---

## Task 3: Extract `<CompassReadouts>` component

**Files:**
- Create: `apps/web/src/components/play/compass/CompassReadouts.tsx`
- Create: `apps/web/src/components/play/compass/CompassReadouts.module.css`
- Create: `apps/web/src/components/play/compass/CompassReadouts.test.tsx`
- Modify: `apps/web/src/components/play/Compass.tsx` (replace inline JSX)
- Modify: `apps/web/src/components/play/Compass.module.css` (remove the readout-specific selectors)

The 3-column readout block (`Vitesse / Cap / TWA`) is the simplest visual primitive to lift. It takes pre-computed values, no derivation logic.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/play/compass/CompassReadouts.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import CompassReadouts from './CompassReadouts';

describe('<CompassReadouts>', () => {
  it('formats heading as 3-digit integer with degree sign', () => {
    const { container } = render(
      <CompassReadouts headingDeg={45} twaDeg={-12} bspKn={6.7} twaLocked={false} vmgGlow={false} />
    );
    expect(container.textContent).toContain('45°');
  });

  it('formats bsp with 2 decimals when provided', () => {
    const { container } = render(
      <CompassReadouts headingDeg={180} twaDeg={90} bspKn={9.123} twaLocked={false} vmgGlow={false} />
    );
    expect(container.textContent).toContain('9.12');
    expect(container.textContent).toContain('nds');
  });

  it('omits the BSP cell when bspKn is undefined', () => {
    const { container } = render(
      <CompassReadouts headingDeg={180} twaDeg={90} twaLocked={false} vmgGlow={false} />
    );
    expect(container.textContent).not.toContain('nds');
    expect(container.textContent).not.toContain('Vitesse');
  });

  it('renders the manoeuvre hint above the readouts when provided', () => {
    const { container } = render(
      <CompassReadouts
        headingDeg={45}
        twaDeg={-12}
        bspKn={6}
        twaLocked={false}
        vmgGlow={false}
        pendingHint={{ kind: 'tack', label: 'Virement — vitesse −40% (~90s)', className: 'hintTack' }}
      />
    );
    expect(container.textContent).toContain('Virement');
  });
});
```

- [ ] **Step 2: Create the module CSS**

Create `apps/web/src/components/play/compass/CompassReadouts.module.css`. Copy lines 56-108 from `apps/web/src/components/play/Compass.module.css` (the `.readouts`, `.readouts > div`, `.readoutLabel`, `.readoutValue`, `.readoutValue small`, `.gold`, `.live`, `.warn`, `.danger`, `.editTag` selectors). Also copy the responsive overrides that touch `.readouts` / `.readoutLabel` / `.readoutValue` from `Compass.module.css` (lines ~280-285, 300-303, 322-326).

The new file is the *only* place these selectors live; do NOT keep duplicates in `Compass.module.css`.

If you also want to lift the manoeuvre-hint visuals here so the test above can assert classes, copy the `.floatingHint`, `.hintIcon`, `.hintGybe`, `.hintTack`, `.hintSail` selectors (lines 14-45) — but they are tightly coupled to the wrapper's `position: relative` (see `.wrapper` rule line 1) and to its `box-shadow` (`.vmgGlow` line 47). **Decision:** keep the floating-hint visuals in `Compass.module.css` (live-only feature) and merely render the hint *inside* `<CompassReadouts>` via a `pendingHint` prop. The hint's positioning is handled by its consumer's wrapper having `position: relative` — the readouts component does NOT add a positioning context.

- [ ] **Step 3: Implement `<CompassReadouts>`**

Create `apps/web/src/components/play/compass/CompassReadouts.tsx`:

```tsx
/**
 * 3-column compass readouts: Vitesse · Cap · TWA. Pure, prop-driven, no store.
 *
 * Extracted from `apps/web/src/components/play/Compass.tsx`. Consumers
 * (live `Compass`, future ProgPanel cap-editor) compute the values and
 * styling classes (vmgGlow / bspColorClass) themselves and pass them down.
 *
 * The optional `pendingHint` is rendered as a floating bar above the
 * readouts. The consumer's wrapper is responsible for `position: relative`
 * so the absolute-positioned hint anchors correctly.
 */

import type { ReactElement } from 'react';
import { AlertTriangle } from 'lucide-react';
import styles from './CompassReadouts.module.css';
import compassStyles from '../Compass.module.css';

export interface CompassReadoutsProps {
  headingDeg: number;
  twaDeg: number;
  /** Boat speed in knots. Omit to hide the Vitesse cell entirely. */
  bspKn?: number;
  twaLocked: boolean;
  /** Apply a green tint to the TWA cell when in a VMG-optimal band. */
  vmgGlow: boolean;
  /** Optional CSS module class for the BSP cell color (live | warn | danger). */
  bspColorClass?: 'live' | 'warn' | 'danger';
  /** Optional manoeuvre hint rendered above the readouts. */
  pendingHint?: {
    kind: 'gybe' | 'tack' | 'sail';
    label: string;
    /** CSS module class name from `Compass.module.css` (e.g. 'hintGybe'). */
    className: string;
  };
}

export default function CompassReadouts({
  headingDeg,
  twaDeg,
  bspKn,
  twaLocked,
  vmgGlow,
  bspColorClass,
  pendingHint,
}: CompassReadoutsProps): ReactElement {
  const bspClass = bspColorClass ? styles[bspColorClass] : '';
  return (
    <>
      {pendingHint && (
        <div className={`${compassStyles.floatingHint} ${compassStyles[pendingHint.className] ?? ''}`}>
          <span className={compassStyles.hintIcon}>
            <AlertTriangle size={12} strokeWidth={2.5} />
          </span>
          <span>{pendingHint.label}</span>
        </div>
      )}
      <div className={styles.readouts}>
        {bspKn !== undefined && (
          <div>
            <p className={styles.readoutLabel}>Vitesse</p>
            <p className={`${styles.readoutValue} ${bspClass}`}>
              {bspKn.toFixed(2)} <small>nds</small>
            </p>
          </div>
        )}
        <div>
          <p className={styles.readoutLabel}>{twaLocked ? 'TWA' : 'Cap'}</p>
          <p className={`${styles.readoutValue} ${styles.gold}`}>{Math.round(headingDeg)}°</p>
        </div>
        <div>
          <p className={styles.readoutLabel}>TWA</p>
          <p className={`${styles.readoutValue} ${vmgGlow ? styles.live : ''}`}>
            {Math.round(twaDeg)}°
          </p>
        </div>
      </div>
    </>
  );
}
```

**Important detail**: the original `Compass.tsx` always shows "Cap" as the middle column label, regardless of TWA lock. The above swaps to "TWA" when locked — that's a *new* improvement aligned with the spec's clearer labelling intent. **If you want to preserve the exact pre-extraction visual**, keep the label as "Cap" always:

```tsx
<p className={styles.readoutLabel}>Cap</p>
```

**Decision for this task: preserve the original behavior (always "Cap")**. If the user wants the TWA-lock-sensitive label later, they can change it explicitly. Update the test accordingly:

```tsx
// In the test file, do NOT assert the label changes with twaLocked. Only assert numeric output.
```

- [ ] **Step 4: Run the failing test**

Run: `pnpm --filter @nemo/web test src/components/play/compass/CompassReadouts.test.tsx`
Expected: tests fail because `<CompassReadouts>` is not yet imported into `Compass.tsx` and possibly `import` paths in the test aren't resolved. Once the file is created (Step 3), tests should run.

If the test framework setup requires additional imports (e.g., `@testing-library/jest-dom`), check `apps/web/vitest.config.ts` and `apps/web/test-setup.ts` (or similar) for the existing convention.

- [ ] **Step 5: Replace usage in Compass.tsx**

In `apps/web/src/components/play/Compass.tsx`:

1. Add `import CompassReadouts from './compass/CompassReadouts';` to imports.
2. Locate the readouts JSX (around lines 461-481, the `<div className={styles.readouts}>` block including its 3 children + the `pendingHint` floating div above it at line 453-458).
3. Replace the entire readouts block (including the `{pendingHint && (...)}` part) with:

```tsx
<CompassReadouts
  headingDeg={displayHdg}
  twaDeg={displayTwa}
  bspKn={displayBsp}
  twaLocked={twaLocked}
  vmgGlow={vmgGlow}
  bspColorClass={
    bspColor === styles.live ? 'live'
      : bspColor === styles.warn ? 'warn'
      : bspColor === styles.danger ? 'danger'
      : undefined
  }
  pendingHint={pendingHint ?? undefined}
/>
```

Note: the existing `bspColor` is itself a CSS class string — we map it to the discriminator type the primitive expects.

- [ ] **Step 6: Trim Compass.module.css**

Delete from `apps/web/src/components/play/Compass.module.css`:
- Lines 56-108: the `.readouts`, `.readouts > div`, `.readoutLabel`, `.readoutValue`, `.readoutValue small`, `.gold`, `.live`, `.warn`, `.danger`, `.editTag` selectors.
- The matching responsive overrides on those classes inside the `@media (max-height: 500px)`, `@media (max-height: 480px)`, and `@media (max-width: 600px)` blocks (lines ~280-285, 300-303, 322-326). Keep the same `@media` block but remove only the selectors that targeted readouts.

KEEP in `Compass.module.css`:
- `.wrapper`, `.floatingHint`, `.hintIcon`, `.hintGybe`, `.hintTack`, `.hintSail`, `.vmgGlow`, `.stage`, `.svg`, `.actions`, `.actionBtn`, `.locked`, `.applyActive`, `.applyInactive`, `.cancelActive`, `.cancelInactive`, `.cancelX`, `.modal*`, `.cardinalLabel`, `.degreeLabel`, plus their responsive overrides that don't touch readouts.

- [ ] **Step 7: Verify tests pass**

Run: `pnpm --filter @nemo/web test src/components/play/compass/CompassReadouts.test.tsx`
Expected: 4/4 pass.

Run: `pnpm --filter @nemo/web test`
Expected: full app suite still 122/122 (or +4 new tests = 126/126).

Run: `pnpm --filter @nemo/web typecheck`
Expected: no new errors.

- [ ] **Step 8: Manual smoke**

If dev server is running, refresh the play screen. The readouts must look pixel-identical to before (Vitesse / Cap / TWA in 3 cells, same fonts, same colors, BSP color reflecting polar match). Drag the cadran — the readouts should still update live (Cap and TWA values).

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/components/play/compass/CompassReadouts.tsx apps/web/src/components/play/compass/CompassReadouts.module.css apps/web/src/components/play/compass/CompassReadouts.test.tsx apps/web/src/components/play/Compass.tsx apps/web/src/components/play/Compass.module.css
git commit -m "refactor(compass): extract <CompassReadouts> + tests"
```

---

## Task 4: Extract `<CompassLockToggle>` component

**Files:**
- Create: `apps/web/src/components/play/compass/CompassLockToggle.tsx`
- Modify: `apps/web/src/components/play/Compass.tsx`

The TWA lock button is the smallest of the three primitives — a single button with two visual states.

- [ ] **Step 1: Create the primitive**

Create `apps/web/src/components/play/compass/CompassLockToggle.tsx`:

```tsx
/**
 * TWA lock toggle button. Pure, prop-driven, no store.
 *
 * Extracted from `apps/web/src/components/play/Compass.tsx`. The wrapper
 * `Compass` (live use) wraps this in a `<Tooltip>` to show the keyboard
 * shortcut; the ProgPanel cap-editor (Phase 2) will use it without a
 * tooltip. Keep the styling here minimal — visual classes come from
 * `Compass.module.css` because this primitive intentionally piggybacks on
 * the action-button look (.actionBtn / .locked).
 */

import type { ReactElement } from 'react';
import { Lock, LockOpen } from 'lucide-react';
import styles from '../Compass.module.css';

export interface CompassLockToggleProps {
  locked: boolean;
  onToggle: () => void;
  disabled?: boolean;
  className?: string;
}

export default function CompassLockToggle({
  locked,
  onToggle,
  disabled = false,
  className,
}: CompassLockToggleProps): ReactElement {
  const cls = [styles.actionBtn, locked ? styles.locked : '', className ?? '']
    .filter(Boolean)
    .join(' ');
  return (
    <button type="button" className={cls} onClick={onToggle} disabled={disabled}>
      {locked ? <Lock size={14} strokeWidth={2.5} /> : <LockOpen size={14} strokeWidth={2.5} />}
      <span>TWA</span>
    </button>
  );
}
```

Note: the styles are intentionally imported from `../Compass.module.css` — this primitive shares the action-button visuals with Valider/Cancel (which stay live-only in `Compass.tsx`). Phase 2 may add a panel-specific class via the `className` prop if needed.

- [ ] **Step 2: Replace usage in Compass.tsx**

In `apps/web/src/components/play/Compass.tsx`:

1. Add `import CompassLockToggle from './compass/CompassLockToggle';` to imports.
2. Locate the TWA lock button (around lines 549-560 — wrapped in `<Tooltip text="..." shortcut="T" position="bottom">`).
3. Replace the inner `<button>` with `<CompassLockToggle locked={twaLocked} onToggle={toggleTwaLock} />`. Keep the surrounding `<Tooltip>` — that stays live-only.

Before:
```tsx
<Tooltip text={twaLocked ? "TWA verrouillé — le cap suit le vent" : "Verrouiller le TWA"} shortcut="T" position="bottom">
  <button
    type="button"
    className={`${styles.actionBtn} ${twaLocked ? styles.locked : ''}`}
    onClick={toggleTwaLock}
  >
    {twaLocked
      ? <Lock size={14} strokeWidth={2.5} />
      : <LockOpen size={14} strokeWidth={2.5} />}
    <span>TWA</span>
  </button>
</Tooltip>
```

After:
```tsx
<Tooltip text={twaLocked ? "TWA verrouillé — le cap suit le vent" : "Verrouiller le TWA"} shortcut="T" position="bottom">
  <CompassLockToggle locked={twaLocked} onToggle={toggleTwaLock} />
</Tooltip>
```

The `Lock` / `LockOpen` imports in `Compass.tsx` are no longer used directly; remove them from the `lucide-react` import line if no other consumer remains. **Caution:** `Lock` is also used in the manoeuvre-hint logic if any — search Compass.tsx for `Lock` to confirm no other usage before removing.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @nemo/web typecheck`
Expected: no new errors.

- [ ] **Step 4: Manual smoke (recommended)**

Refresh the play screen if dev server running. Verify the TWA button:
- Shows the open padlock icon when unlocked
- Shows the closed padlock icon + gold background when locked (click it, observe)
- Tooltip still appears on hover with the same text + the "T" shortcut hint
- Pressing `T` on the keyboard still toggles it (this is via the keyboard-shortcut effect in `Compass.tsx`, not via the button itself — should still work)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/play/compass/CompassLockToggle.tsx apps/web/src/components/play/Compass.tsx
git commit -m "refactor(compass): extract <CompassLockToggle>"
```

---

## Task 5: Extract `<CompassDial>` component (the big one)

**Files:**
- Create: `apps/web/src/components/play/compass/CompassDial.tsx`
- Create: `apps/web/src/components/play/compass/CompassDial.module.css`
- Create: `apps/web/src/components/play/compass/CompassDial.test.tsx`
- Modify: `apps/web/src/components/play/Compass.tsx`
- Modify: `apps/web/src/components/play/Compass.module.css`

This is the largest extraction. The dial encapsulates: SVG render (rings, ticks, cardinals, degree labels, wind waves, ghost, boat, center dot), drag-to-rotate, wheel-to-rotate, ref-based 60Hz preview writes, and the responsive `.stage` / `.cardinalLabel` / `.degreeLabel` styles.

**Goal of the API**: the wrapper passes `value` (heading to render the boat at) and `ghostValue` (heading of the ghost — typically the live `hud.hdg`); the dial calls `onChange(nextDeg)` during drag/wheel.

**60Hz preview**: when the user drags, the dial mutates its own `<g id="boat">` transform directly (bypassing React) for jank-free animation. On `pointerup`, the parent's React state catches up. We preserve this exactly — the dial still owns the ref and the mutation.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/components/play/compass/CompassDial.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import CompassDial from './CompassDial';

describe('<CompassDial>', () => {
  it('renders a square SVG with the configured viewBox', () => {
    const { container } = render(<CompassDial value={0} windDir={0} />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('viewBox')).toBe('0 0 220 220');
  });

  it('renders 4 cardinal labels', () => {
    const { container } = render(<CompassDial value={0} windDir={0} />);
    const texts = Array.from(container.querySelectorAll('text')).map((t) => t.textContent);
    // Cardinal labels are N E S O (French Ouest); degree labels are 030 060 etc.
    expect(texts.filter((t) => t === 'N' || t === 'E' || t === 'S' || t === 'O').sort()).toEqual(['E', 'N', 'O', 'S']);
  });

  it('rotates the boat group to the value prop', () => {
    const { container } = render(<CompassDial value={45} windDir={0} />);
    const boat = container.querySelector('#boat') as SVGGElement | null;
    expect(boat).not.toBeNull();
    expect(boat?.getAttribute('transform')).toContain('rotate(45');
  });

  it('renders the ghost group with opacity 0 by default (no edit in progress)', () => {
    const { container } = render(<CompassDial value={45} windDir={0} />);
    const ghost = container.querySelector('#ghost') as SVGGElement | null;
    expect(ghost).not.toBeNull();
    expect(ghost?.style.opacity).toBe('0');
  });

  it('shows the ghost when ghostValue differs from value', () => {
    const { container } = render(<CompassDial value={45} ghostValue={20} windDir={0} />);
    const ghost = container.querySelector('#ghost') as SVGGElement;
    // Ghost transform reflects the previous heading
    expect(ghost.getAttribute('transform')).toContain('rotate(20');
    // Opacity is bumped above 0 (we set 0.2 by default during edit)
    expect(parseFloat(ghost.style.opacity)).toBeGreaterThan(0);
  });

  it('does not render WindWaves when showWindWaves=false', () => {
    const { container } = render(<CompassDial value={0} windDir={0} showWindWaves={false} />);
    // WindWaves renders <g> with multiple <path d=...> animations.
    // Easiest signal: there's no <animate> child.
    const animates = container.querySelectorAll('animate');
    expect(animates.length).toBe(0);
  });

  it('omits the boat group when showBoat=false', () => {
    const { container } = render(<CompassDial value={45} windDir={0} showBoat={false} />);
    expect(container.querySelector('#boat')).toBeNull();
  });

  it('does not call onChange when readOnly (no drag handler attached)', () => {
    const onChange = vi.fn();
    const { container } = render(<CompassDial value={0} windDir={0} onChange={onChange} readOnly />);
    const svg = container.querySelector('svg')!;
    svg.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 200, clientY: 100 }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
```

Note: the drag test only verifies that `onChange` is NOT called when readOnly. Testing actual drag math via JSDOM is hard (no real geometry); deeper drag tests can come later if needed. The plan accepts this gap.

- [ ] **Step 2: Create the dial CSS**

Create `apps/web/src/components/play/compass/CompassDial.module.css`. Copy lines 110-124 (`.stage`, `.svg`) and lines 270-272 (`.cardinalLabel`, `.degreeLabel`) from `Compass.module.css`, plus the responsive overrides on these classes from the various `@media` blocks (lines ~291-292 max-height:600, ~304-305 max-height:480, ~307-308 cardinalLabel font-size, ~313-314 max-height:360, ~327-328 max-width:600, ~330-331 cardinalLabel font-size, ~336-337 max-width:360).

Removing them from `Compass.module.css` is part of Step 6.

- [ ] **Step 3: Implement `<CompassDial>`**

Create `apps/web/src/components/play/compass/CompassDial.tsx`:

```tsx
/**
 * Compass cadran — the SVG dial only. Pure, prop-driven, no store.
 *
 * Owns: ticks, cardinals, degree labels, optional wind waves, optional
 * IMOCA boat silhouette, ghost rendering, drag-to-rotate, wheel-to-rotate,
 * 60Hz preview via direct SVG transform mutation.
 *
 * Does NOT own: readouts (use `<CompassReadouts>`), TWA-lock toggle (use
 * `<CompassLockToggle>`), Valider/Cancel actions (live-only, stay in the
 * `Compass.tsx` wrapper), VMG glow halo (consumer applies a wrapper class
 * around all three primitives), polar awareness / manoeuvre hints.
 *
 * Extracted from `apps/web/src/components/play/Compass.tsx`.
 */

import { useCallback, useEffect, useRef, type ReactElement } from 'react';
import {
  VB,
  CX,
  CY,
  R_OUTER,
  R_INNER,
  IMOCA_PATH,
  IMOCA_SCALE,
  IMOCA_VB,
} from './compassGeometry';
import WindWaves from './WindWaves';
import styles from './CompassDial.module.css';

export interface CompassDialProps {
  /** Heading rendered as the boat orientation (0..359). */
  value: number;
  /** Called during drag and wheel. Omit to make the dial read-only. */
  onChange?: (nextDeg: number) => void;
  /** True wind direction in degrees — drives the wave overlay. */
  windDir: number;
  /**
   * Heading of the ghost silhouette. When undefined or === value, the ghost
   * is rendered at value with opacity 0 (effectively invisible). When
   * different from value, the ghost is rendered at ghostValue with low
   * opacity (visual "before vs. after" preview during drag).
   */
  ghostValue?: number;
  /** Render the IMOCA silhouette (default true). */
  showBoat?: boolean;
  /** Render the animated wind waves outside the cadran (default true). */
  showWindWaves?: boolean;
  /** Disable drag / wheel handlers (default false). */
  readOnly?: boolean;
}

export default function CompassDial({
  value,
  onChange,
  windDir,
  ghostValue,
  showBoat = true,
  showWindWaves = true,
  readOnly = false,
}: CompassDialProps): ReactElement {
  const svgRef = useRef<SVGSVGElement>(null);

  // 60Hz preview — write the boat / ghost transform attributes directly,
  // bypassing React's reconciler. The committed React `value` prop catches
  // up on pointer-up (parent calls onChange).
  const writeSvg = useCallback((target: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const boat = svg.querySelector<SVGGElement>('#boat');
    const ghost = svg.querySelector<SVGGElement>('#ghost');
    if (boat) boat.setAttribute('transform', `rotate(${target} ${CX} ${CY})`);
    if (ghost) ghost.style.opacity = ghostValue === undefined || target === ghostValue ? '0' : '0.2';
  }, [ghostValue]);

  // Sync SVG when value or ghostValue change from props (parent updates).
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const boat = svg.querySelector<SVGGElement>('#boat');
    const ghost = svg.querySelector<SVGGElement>('#ghost');
    if (boat) boat.setAttribute('transform', `rotate(${value} ${CX} ${CY})`);
    if (ghost) {
      ghost.setAttribute('transform', `rotate(${ghostValue ?? value} ${CX} ${CY})`);
      ghost.style.opacity = ghostValue === undefined || value === ghostValue ? '0' : '0.2';
    }
  }, [value, ghostValue]);

  // Drag handling
  const getHdgFromEvent = useCallback((e: PointerEvent): number | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    if (dx * dx + dy * dy < 400) return null; // dead zone in center
    let angle = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
    if (angle < 0) angle += 360;
    return Math.round(angle) % 360;
  }, []);

  useEffect(() => {
    if (readOnly || !onChange) return;
    const svg = svgRef.current;
    if (!svg) return;
    let dragging = false;

    const onDown = (e: PointerEvent) => {
      dragging = true;
      svg.setPointerCapture(e.pointerId);
      const h = getHdgFromEvent(e);
      if (h !== null) {
        writeSvg(h);
        onChange(h);
      }
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      const h = getHdgFromEvent(e);
      if (h !== null) {
        writeSvg(h);
        onChange(h);
      }
    };
    const onUp = (e: PointerEvent) => {
      dragging = false;
      svg.releasePointerCapture(e.pointerId);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? -1 : 1;
      const next = (value + delta + 360) % 360;
      writeSvg(next);
      onChange(next);
    };

    svg.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      svg.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      svg.removeEventListener('wheel', onWheel);
    };
  }, [readOnly, onChange, getHdgFromEvent, writeSvg, value]);

  // Tick generation
  const ticks: ReactElement[] = [];
  for (let i = 0; i < 36; i++) {
    const deg = i * 10;
    const isCardinal = deg % 90 === 0;
    const isIntercardinal = deg % 45 === 0 && !isCardinal;
    const len = isCardinal ? 12 : isIntercardinal ? 10 : 6;
    const opacity = isCardinal ? 0.4 : isIntercardinal ? 0.25 : 0.15;
    const width = isCardinal ? 1.2 : 0.5;
    const rad = ((deg - 90) * Math.PI) / 180;
    const x1 = CX + R_OUTER * Math.cos(rad);
    const y1 = CY + R_OUTER * Math.sin(rad);
    const x2 = CX + (R_OUTER - len) * Math.cos(rad);
    const y2 = CY + (R_OUTER - len) * Math.sin(rad);
    ticks.push(
      <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
        stroke={`rgba(245,240,232,${opacity})`} strokeWidth={width} />
    );
  }

  const cardinals: { label: string; deg: number }[] = [
    { label: 'N', deg: 0 }, { label: 'E', deg: 90 },
    { label: 'S', deg: 180 }, { label: 'O', deg: 270 },
  ];

  return (
    <div className={styles.stage}>
      <svg ref={svgRef} viewBox={`0 0 ${VB} ${VB}`} className={styles.svg}>
        <circle cx={CX} cy={CY} r={R_OUTER} fill="none"
          stroke="rgba(245,240,232,0.18)" strokeWidth="1" />
        <circle cx={CX} cy={CY} r={R_INNER} fill="none"
          stroke="rgba(245,240,232,0.08)" strokeWidth="0.5" />

        {ticks}

        {cardinals.map(({ label, deg }) => {
          const rad = ((deg - 90) * Math.PI) / 180;
          const x = CX + (R_OUTER - 20) * Math.cos(rad);
          const y = CY + (R_OUTER - 20) * Math.sin(rad);
          return (
            <text key={label} x={x} y={y} className={styles.cardinalLabel}
              fontFamily="Bebas Neue,sans-serif" fontSize="15"
              fill="rgba(245,240,232,0.85)"
              textAnchor="middle" dominantBaseline="central">{label}</text>
          );
        })}

        {[30, 60, 120, 150, 210, 240, 300, 330].map((deg) => {
          const rad = ((deg - 90) * Math.PI) / 180;
          const x = CX + (R_OUTER - 32) * Math.cos(rad);
          const y = CY + (R_OUTER - 32) * Math.sin(rad);
          return (
            <text key={`deg-${deg}`} x={x} y={y} className={styles.degreeLabel}
              fontFamily="Space Mono,monospace" fontSize="8" fontWeight="700"
              fill="rgba(245,240,232,0.35)"
              textAnchor="middle" dominantBaseline="central">
              {String(deg).padStart(3, '0')}
            </text>
          );
        })}

        {showWindWaves && <WindWaves twd={windDir} tws={1 /* default 1-stream */} cx={CX} cy={CY} r={R_OUTER} />}

        <g id="ghost" transform={`rotate(${ghostValue ?? value} ${CX} ${CY})`}
          style={{ opacity: ghostValue === undefined || value === ghostValue ? 0 : 0.2 }}>
          <g transform={`translate(${CX},${CY}) rotate(-90) scale(${IMOCA_SCALE}) translate(${-IMOCA_VB.w / 2},${-IMOCA_VB.h / 2})`}>
            <path d={IMOCA_PATH}
              fill="none" stroke="#f5f0e8" strokeWidth={8} strokeDasharray="12 8" />
          </g>
        </g>

        {showBoat && (
          <g id="boat" transform={`rotate(${value} ${CX} ${CY})`}>
            <line x1={CX} y1={CY - 26} x2={CX} y2={CY - 70}
              stroke="#f5f0e8" strokeWidth="1" opacity="0.5" strokeDasharray="4 3" />
            <g transform={`translate(${CX},${CY}) rotate(-90) scale(${IMOCA_SCALE}) translate(${-IMOCA_VB.w / 2},${-IMOCA_VB.h / 2})`}>
              <path d={IMOCA_PATH} fill="#c9a227" />
            </g>
          </g>
        )}

        <circle cx={CX} cy={CY} r={3} fill="rgba(245,240,232,0.25)" />
      </svg>
    </div>
  );
}
```

**Important: WindWaves TWS prop change.** The original `Compass.tsx` passed `tws={tws}` (live wind speed from store). The dial now defaults to `tws={1}` (1-stream) for simplicity in the primitive. **The wrapper `Compass.tsx` will not be able to convey live TWS to the dial after extraction unless we add a prop.**

Decision options:
- **(a)** Add `tws?: number` prop to `<CompassDial>` so the wrapper can pass `tws`. Default 1.
- **(b)** Keep dial TWS-agnostic (always 1-stream waves) — small visual regression in the live Compass (waves count is now constant instead of TWS-dependent).

**Use (a)** — the regression is small but real, and the prop is cheap. Update the dial to accept `tws?: number` and the WindWaves to receive it. The wrapper passes `tws={tws}` from store.

Replace `tws={1 /* default 1-stream */}` with `tws={tws ?? 1}` and add `tws?: number` to `CompassDialProps`.

- [ ] **Step 4: Run failing tests**

Run: `pnpm --filter @nemo/web test src/components/play/compass/CompassDial.test.tsx`
Expected: 8/8 pass after Step 3 implementation.

If pointer events fail in JSDOM, the `does not call onChange when readOnly` test might be flaky. If so, simplify it to assert the `pointerdown` listener is not attached (e.g., by checking that `setPointerCapture` is never called via vi.spyOn).

- [ ] **Step 5: Replace usage in Compass.tsx**

In `apps/web/src/components/play/Compass.tsx`:

1. Add `import CompassDial from './compass/CompassDial';` to imports.
2. Locate the SVG block (around lines 482-545 — the `<div className={styles.stage}>` containing all the SVG).
3. Replace the entire `<div className={styles.stage}>...</div>` block with:

```tsx
<CompassDial
  value={displayHdg}
  onChange={setTargetHdg}
  windDir={twd}
  ghostValue={hdg}
  tws={tws}
/>
```

The `setTargetHdg` callback was previously the local state setter — now it's wired through the dial's `onChange`. Note: the original Compass.tsx also called `useGameStore.getState().setPreview({ hdg: h })` from the drag handler. Preserve this side-effect by passing a wrapper:

```tsx
<CompassDial
  value={displayHdg}
  onChange={(h) => {
    setTargetHdg(h);
    useGameStore.getState().setPreview({ hdg: h });
  }}
  windDir={twd}
  ghostValue={hdg}
  tws={tws}
/>
```

4. **Delete** the `writeSvg` callback definition, the `getHdgFromEvent` function, the drag-effect hook, the wheel-effect hook, the sync-effect hook (the `useEffect(() => { ... boat.setAttribute(...) ... }, [hdg, twd]);` block) — all of these are now inside `<CompassDial>`. Be surgical: search for `svgRef`, `writeSvg`, `getHdgFromEvent`, `dragging` — all should disappear from `Compass.tsx`.

5. **Delete** the `svgRef` declaration. The dial owns its own ref.

- [ ] **Step 6: Trim Compass.module.css**

Delete the dial-specific selectors from `Compass.module.css`:
- `.stage` (lines 110-115)
- `.svg` (lines 117-124)
- `.cardinalLabel` (line 271)
- `.degreeLabel` (line 272)
- All responsive overrides on `.stage`, `.cardinalLabel`, `.degreeLabel` inside the `@media` blocks. Preserve the `@media` block structure but only delete the dial-specific selectors. Other selectors (`.wrapper`, `.actions`, `.actionBtn`, etc.) inside the same media blocks stay.

After Tasks 3 and 5, `Compass.module.css` should be roughly half its original size, containing only wrapper, hint, vmgGlow, actions, action button, lock, apply, cancel, and modal styles.

- [ ] **Step 7: Verify everything passes**

Run: `pnpm --filter @nemo/web test`
Expected: full app suite still passes (122 + 4 from CompassReadouts + 8 from CompassDial = 134/134 if no regressions).

Run: `pnpm --filter @nemo/web typecheck`
Expected: no new errors.

- [ ] **Step 8: Manual smoke (CRITICAL — Compass is the most-used live component)**

Refresh the play screen if dev server running. Verify by eye:
- Cadran renders with N E S O cardinals, degree labels every 30°, ticks every 10°, animated wind waves outside the circle (with stream count varying by TWS — 1, 2, or 3 streams)
- The IMOCA boat silhouette is gold and points at the current heading
- Dragging the cadran rotates the boat smoothly (60Hz, no jank)
- The ghost silhouette appears (dashed outline) only during drag, at the previous heading
- Wheel scrolling on the cadran also rotates by 1° per click
- Releasing the drag — Valider button turns gold (apply active)
- Clicking Valider — sends the order, ghost disappears
- Clicking ✕ — drag reverts to live heading
- Pressing `T` — toggles TWA lock (this is keyboard shortcut effect in `Compass.tsx`, should still work)
- Pressing Escape during edit — same as ✕
- Pressing Enter during edit — same as Valider

If anything visual or behavioral is broken, fix before committing.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/components/play/compass/CompassDial.tsx apps/web/src/components/play/compass/CompassDial.module.css apps/web/src/components/play/compass/CompassDial.test.tsx apps/web/src/components/play/Compass.tsx apps/web/src/components/play/Compass.module.css
git commit -m "refactor(compass): extract <CompassDial> + tests"
```

---

## Task 6: Final review of Compass.tsx wrapper

**Files:**
- Modify: `apps/web/src/components/play/Compass.tsx` (clean up, no behavior change)

After the previous tasks, `Compass.tsx` should now be:
- Imports of `CompassDial`, `CompassReadouts`, `CompassLockToggle`, plus store hooks, polar libs, lucide icons (Lock, LockOpen are no longer needed; only Check, AlertTriangle remain — verify)
- The store reads (hdg, twd, tws, twa, twaLock, boatClass, currentSail, sailAuto, etc.)
- Local state: targetHdg, twaLocked, lockedTwa, committedTwaLock, polarReady
- Computed values: lockStateChanged, applyActive, displayHdg, displayTwa, vmgGlow, displayBsp, bestPolarAtTwa, bspRatio, bspColor, pendingHint
- Effect: polar load, sync committedTwaLock from server, keyboard shortcuts
- Actions: apply, cancelEdit, toggleTwaLock
- Render: `<div className={`${styles.wrapper} ${vmgGlow ? styles.vmgGlow : ''}`}>` containing `<CompassReadouts>` (with pendingHint), `<CompassDial>`, and the action row (lock toggle + Valider + Cancel)

- [ ] **Step 1: Verify no orphan code**

Open `apps/web/src/components/play/Compass.tsx`. Search for:
- `svgRef`, `writeSvg`, `getHdgFromEvent`, `dragging`, `pointerdown`, `pointermove`, `wheel` — should all be absent (extracted to dial)
- `WindWaves` defined inline — should be absent (extracted)
- `pt(`, `isInVmgZone`, `IMOCA_PATH`, `R_OUTER`, `R_INNER` — should NOT appear except in import statement
- The 3-column readouts JSX — should be replaced by `<CompassReadouts>`
- The TWA lock button JSX — should be replaced by `<CompassLockToggle>`
- The full `<svg viewBox=...>` block — should be replaced by `<CompassDial>`

- [ ] **Step 2: Verify imports are minimal**

The lucide-react imports should now be: `import { Check, AlertTriangle } from 'lucide-react';` (no `Lock`, no `LockOpen` — those moved to `CompassLockToggle`).

- [ ] **Step 3: Final typecheck + tests**

```bash
pnpm --filter @nemo/web typecheck
pnpm --filter @nemo/web test
```

Both clean, no new errors.

- [ ] **Step 4: Final manual smoke (full live behavior pass)**

Open the play screen one more time. Walk through:
- Cadran renders, drag, wheel, ghost, boat silhouette ✓
- Readouts: Vitesse, Cap, TWA values update with drag ✓
- Vitesse color reflects polar match (gold/orange/red) ✓
- TWA cell turns green inside VMG bands ✓
- VMG glow halo (box-shadow on wrapper) lights up in VMG bands ✓
- Manoeuvre hint appears above the readouts during edit when applicable (gybe / tack / sail change) ✓
- Lock TWA button toggles padlock icon and gold background ✓
- Pressing `T` toggles lock ✓
- Pressing Escape cancels edit ✓
- Pressing Enter applies edit ✓
- Valider button is gold when edit pending, grey otherwise ✓
- ✕ cancel button is orange when edit pending, grey otherwise ✓
- Mobile / phone breakpoints — resize the browser to a phone width, the cadran should shrink and the readouts/buttons should compact down ✓

If any of these behaviors are degraded, identify the cause (likely a class/import miss in Compass.tsx) and fix before committing.

- [ ] **Step 5: Final commit (only if Steps 1-4 surfaced any cleanup)**

If you needed to fix orphan code or import issues:

```bash
git add apps/web/src/components/play/Compass.tsx
git commit -m "refactor(compass): clean up Compass.tsx wrapper after primitive extractions"
```

If everything was already clean from Tasks 1-5, no extra commit is needed.

---

## Task 7: Repo-wide test sweep

- [ ] **Step 1: Run all tests**

```bash
pnpm -r test
```

Expected: 243 + (4 readout tests) + (8 dial tests) = 255/255 pass. (Numbers approximate — confirm against your baseline.)

- [ ] **Step 2: Run typecheck**

```bash
pnpm -r typecheck
```

Expected: pre-existing errors only (`.next/dev/types/routes.d.ts`).

- [ ] **Step 3: Sanity-check with dev server one more time**

```bash
pnpm --filter @nemo/web dev
```

Open the play screen, exercise the Compass briefly. Confirm visual + behavioral parity vs your "pre-extraction reference" from the Pre-task step.

- [ ] **Step 4: Final tag commit (optional)**

```bash
git commit --allow-empty -m "chore: ProgPanel Phase 1a complete (Compass primitives extracted)"
```

---

## Self-review notes (for the implementer)

- **The IMOCA boat silhouette** appears in TWO places in the dial (boat group + ghost group, with different fills). Verify both render correctly post-extraction. The boat is gold-filled; the ghost is the same path but stroked dashed and white-ish.
- **The `setPreview({ hdg: h })` side-effect** during drag is preserved by wrapping the dial's `onChange` in `Compass.tsx`. Don't lose this — the projection worker uses `preview.hdg` to render the candidate trajectory line on the map. If the projection line stops following the cadran during drag, this is the bug.
- **The action button row spacing** in `Compass.module.css` (`.actions`) might need tuning if the `<CompassLockToggle>` introduces a width difference vs. the Lock-icon-with-text inline button. Visually compare side-by-side if anything looks off.
- **Naming of the middle readout label** ("Cap" always, vs. "Cap" / "TWA" depending on lock): this plan **preserves the original "Cap" always** behavior in Task 3. Don't introduce the lock-aware label — that's a deliberate Phase 2+ decision, not Phase 1a's job.
- **The `<Tooltip>` component wrapping the lock button** stays in `Compass.tsx`; the primitive itself doesn't know about tooltips. Phase 2 ProgPanel can wrap or not as it prefers.
