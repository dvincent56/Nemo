# ProgPanel Phase 1b — Sail Icons & Defs Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the 7 sail SVG icons (`SAIL_ICONS`) and the sail metadata array (`SAILS` → `SAIL_DEFS`) from `apps/web/src/components/play/SailPanel.tsx` into a shared module `apps/web/src/lib/sails/icons.tsx`. The Phase 2 ProgPanel sail-order editor will import the same constants without duplicating the SVG paths.

**Architecture:** Pure data extraction — constants + JSX-fragment icons, no React state, no side effects, no store. Both `SailPanel.tsx` (live) and the future ProgPanel sail-editor consume from the new module.

**Tech Stack:** TypeScript strict, React 19.2 (the module exports `React.ReactElement` SVG fragments).

---

## File map

**Created:**
- `apps/web/src/lib/sails/icons.tsx` — exports `SAIL_DEFS`, `SAIL_ICONS`

**Modified:**
- `apps/web/src/components/play/SailPanel.tsx` — replaces the inline definitions with imports from the new module

**Optional (skipped — see Task 2 step 6 below):**
- A test file for `SAIL_ICONS` / `SAIL_DEFS`. Pure-data exports; the live `SailPanel.tsx` exercises them in production. Adding a unit test that asserts "the array has 7 entries" would be performative.

---

## Conventions used in this plan

- All work happens on a feature branch `feat/progpanel-phase-1b` created from `main`.
- Commit messages follow the project style (cf. `git log` recent: `refactor(scope): …`).
- Run `apps/web` typecheck with `pnpm --filter @nemo/web typecheck`. Pre-existing errors in `.next/dev/types/routes.d.ts` are not related — verify any new error you see is genuinely new before treating it as a blocker.

---

## Task 1: Create the shared module

**Files:**
- Create: `apps/web/src/lib/sails/icons.tsx`

This task creates the module with the two exports. No consumer change yet.

- [ ] **Step 1: Read the source**

Open `apps/web/src/components/play/SailPanel.tsx`. Locate:
- `SAIL_ICONS: Record<SailId, React.ReactElement>` constant (around lines 11-58 — 7 SVG entries: JIB, LJ, SS, C0, SPI, HG, LG, each ~6 lines of SVG)
- `SAILS: { id: SailId; name: string }[]` constant (around lines 80-88 — 7 entries with French names)

Note the existing import pattern at the top of `SailPanel.tsx`:
```ts
import type { Polar, SailId } from '@nemo/shared-types';
```

The `SailId` type is what we'll reuse in the new module.

- [ ] **Step 2: Create the new module**

Create `apps/web/src/lib/sails/icons.tsx`:

```tsx
/**
 * Shared sail metadata + SVG icons for the play screen UI.
 *
 * Used by `apps/web/src/components/play/SailPanel.tsx` (live sail picker)
 * and the future ProgPanel sail-order editor (Phase 2). Pure data — no
 * React state, no hooks, no store, no side effects.
 *
 * Each icon is a JSX SVG fragment intended to be consumed via the
 * `className` prop or wrapped by a sized container. The `viewBox` is
 * `0 0 32 40` (slightly taller than wide to give room for the mast +
 * sail silhouette).
 */

import type { ReactElement } from 'react';
import type { SailId } from '@nemo/shared-types';

/** Ordered list of sails with their French display names. */
export const SAIL_DEFS: { id: SailId; name: string }[] = [
  { id: 'JIB', name: 'Foc' },
  { id: 'LJ', name: 'Foc léger' },
  { id: 'SS', name: 'Trinquette' },
  { id: 'C0', name: 'Code 0' },
  { id: 'SPI', name: 'Spinnaker' },
  { id: 'HG', name: 'Gennaker lourd' },
  { id: 'LG', name: 'Gennaker léger' },
];

/**
 * SVG icon for each sail. Profile view, mast on the left.
 * Use `currentColor` for stroke / fill so consumers control the color
 * via CSS / parent class. The `className={styles.sailIcon}` from
 * SailPanel's CSS module is one example; ProgPanel will wrap it
 * differently.
 */
export const SAIL_ICONS: Record<SailId, ReactElement> = {
  JIB: <COPY_FROM_SAILPANEL>,
  LJ:  <COPY_FROM_SAILPANEL>,
  SS:  <COPY_FROM_SAILPANEL>,
  C0:  <COPY_FROM_SAILPANEL>,
  SPI: <COPY_FROM_SAILPANEL>,
  HG:  <COPY_FROM_SAILPANEL>,
  LG:  <COPY_FROM_SAILPANEL>,
};
```

**IMPORTANT**: replace each `<COPY_FROM_SAILPANEL>` placeholder with the **exact** JSX from `SailPanel.tsx`'s `SAIL_ICONS` definition. Do NOT type SVG paths manually — copy each entry verbatim, including the `<svg>` opening tag, all `<line>` / `<path>` children, and the `</svg>` closing tag.

**Important detail**: each icon in the source has `className={styles.sailIcon}` on the `<svg>` element. The new module **does not** import any CSS module. Decide:
- (a) Drop the `className={styles.sailIcon}` attribute — the consumer applies sizing via wrapping or its own class. Cleaner, but breaks SailPanel's existing styling.
- (b) Replace `className={styles.sailIcon}` with `className="sailIcon"` (a plain string, not a CSS module ref). Requires SailPanel to either define `.sailIcon` globally (it doesn't today) or wrap each icon in its own styled container.
- (c) **Preferred**: drop the className from the new module and have each consumer wrap the icon in a sized container. SailPanel already has a wrapper at line 241-243 (`<div className={styles.sailRowIcon}>{SAIL_ICONS[s.id]}</div>`), so the consumer-side wrapper handles sizing — the inner `className={styles.sailIcon}` was redundant for fixed-size cases.

**Use option (c)**: in the extracted SVGs, **remove** the `className={styles.sailIcon}` attribute from each `<svg>` element. Verify SailPanel still styles correctly via the surrounding `.sailRowIcon` class (a quick read of `SailPanel.module.css` to confirm `.sailRowIcon img, .sailRowIcon svg { ... }` or similar — adjust the migration if the inner `.sailIcon` was load-bearing).

If `.sailIcon` IS load-bearing (e.g., it sets the actual width/height inside the wrapper), then preserve the styling differently:
- Keep `.sailIcon` rule in `SailPanel.module.css` AND let SailPanel wrap each icon at the consume site: change `<div className={styles.sailRowIcon}>{SAIL_ICONS[s.id]}</div>` to `<div className={`${styles.sailRowIcon} ${styles.sailIcon}`}>{SAIL_ICONS[s.id]}</div>` (apply the size class on the wrapper instead of the SVG).
- Or have the new module export a tiny `<SailIcon>` wrapper component that takes `id: SailId` and a `className?: string`. Skip this for Phase 1b — out of scope.

**Read `apps/web/src/components/play/SailPanel.module.css`** to confirm `.sailIcon`'s actual rules before deciding the migration shape.

- [ ] **Step 3: Verify the new file typechecks in isolation**

Run: `pnpm --filter @nemo/web typecheck`
Expected: only pre-existing `.next/dev` errors (no consumer references the new module yet, so this just verifies the new file is syntactically valid).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/sails/icons.tsx
git commit -m "feat(sails): extract SAIL_DEFS + SAIL_ICONS into lib/sails/icons"
```

---

## Task 2: Migrate SailPanel.tsx to consume the shared module

**Files:**
- Modify: `apps/web/src/components/play/SailPanel.tsx`
- Modify (if needed per Task 1 Step 2 decision): `apps/web/src/components/play/SailPanel.module.css`

- [ ] **Step 1: Replace the inline `SAIL_ICONS`**

In `apps/web/src/components/play/SailPanel.tsx`:

1. Add `import { SAIL_ICONS, SAIL_DEFS } from '@/lib/sails/icons';` near the top (after existing imports).
2. Delete the in-file `const SAIL_ICONS: Record<SailId, React.ReactElement> = { ... };` block (around lines 11-58).
3. Delete the in-file `const SAILS: { id: SailId; name: string }[] = [ ... ];` block (around lines 80-88).
4. Find the call site `availableSails = SAILS;` (around line 113). Rename references from `SAILS` to `SAIL_DEFS` — ideally keep `availableSails` as the local variable (the iteration consumer doesn't change), but its source becomes `SAIL_DEFS`.

After: search for `SAILS` and `SAIL_ICONS` defined inline in `SailPanel.tsx` — should find ZERO matches (only the import line at the top and the consumer references).

- [ ] **Step 2: Apply the styling decision from Task 1 Step 2**

If you went with option (c) in Task 1 Step 2 (drop the inner `className={styles.sailIcon}` and rely on the surrounding `.sailRowIcon` wrapper):
- Read `apps/web/src/components/play/SailPanel.module.css`. Check what `.sailIcon` was doing.
- If `.sailIcon` was setting `width`, `height`, `display: block`, or similar sizing rules: move those rules to `.sailRowIcon img, .sailRowIcon svg { ... }` (or merge them into `.sailRowIcon` directly).
- If `.sailIcon` was unused (the wrapper already enforced sizing): remove the `.sailIcon` rule from `SailPanel.module.css`.
- Verify each icon still renders at the right size by reading the resulting CSS rule chain.

If you went with another option, follow it through and verify the same outcome (SailPanel's icon layout unchanged).

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @nemo/web typecheck`
Expected: clean (no new errors).

- [ ] **Step 4: Run all `apps/web` tests**

Run: `pnpm --filter @nemo/web test`
Expected: all tests pass (no test currently exercises SailPanel directly; the typecheck and the existing 133 tests all pass).

- [ ] **Step 5: Manual smoke (CONTROLLER will do this)**

You likely don't have a dev server in your sandbox. State this explicitly in your report. The controller will smoke-test in browser:
- Open the play screen → SailPanel
- Each of the 7 sails displays its SVG icon at the correct size
- The currently-active sail is highlighted (gold border)
- Clicking a sail still works (toggles candidate state, shows confirm strip)
- Mobile breakpoints: SailPanel renders correctly on small screens

If you DO have a dev server, run through the above checklist before committing.

- [ ] **Step 6: Skip writing a test for the shared module**

The shared module exports pure data (no logic, no rendering decisions). A unit test that asserts "the array has 7 entries" would not provide meaningful coverage — the live `SailPanel.tsx` already exercises every code path. Skipping this saves time and avoids over-testing inert constants.

If a future change introduces logic (e.g., a `getSailDefById(id)` lookup helper), THAT helper should be tested — but `SAIL_DEFS` and `SAIL_ICONS` themselves do not warrant tests.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/play/SailPanel.tsx apps/web/src/components/play/SailPanel.module.css
git commit -m "refactor(sail-panel): consume shared SAIL_DEFS / SAIL_ICONS from lib/sails"
```

---

## Task 3: Repo-wide verification

- [ ] **Step 1: Full repo tests**

Run: `pnpm -r test`
Expected: 254/254 passing, same as Phase 1a baseline (no new tests, no removed tests).

- [ ] **Step 2: Repo typecheck**

Run: `pnpm -r typecheck`
Expected: pre-existing errors only (`.next/dev/types/routes.d.ts`).

- [ ] **Step 3: Final tag commit (optional)**

```bash
git commit --allow-empty -m "chore: ProgPanel Phase 1b complete (sail icons module extracted)"
```

---

## Self-review notes (for the implementer)

- This is the smallest of the three Phase 1 extractions. If you find yourself adding new abstractions (a `<SailIcon>` wrapper, a `useSails()` hook, etc.) — STOP. Phase 1b is intentionally a pure data move.
- The `SAIL_ICONS` SVG fragments use `currentColor` for stroke/fill in some places. Don't change that — consumers control the color via CSS on the wrapper.
- If the `.sailIcon` CSS class turns out to be load-bearing in non-obvious ways (e.g., used by a media query for mobile sizing), the simpler migration is to KEEP `.sailIcon` in SailPanel.module.css and apply it on the wrapper at the consumer site rather than each SVG. Document the choice in the commit if you take that path.
- ProgPanel cap-editor (Phase 2) will consume `SAIL_DEFS` and `SAIL_ICONS` directly. The Phase 1b output is not visible to end users — there's no UI work, just a code reorganization for reuse.
