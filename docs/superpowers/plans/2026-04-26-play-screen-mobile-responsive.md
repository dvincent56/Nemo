# Play screen mobile responsive — Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/play/[raceId]` fully usable on mobile portrait, mobile landscape, and tablet — fix overlap on the right edge, simplify the timeline, compact panels, and replace the side panel with a bottom sheet on portrait phones so the map remains visible.

**Architecture:** CSS-first refactor across 13 stylesheets, plus one new utility hook (`useMediaQuery`), one new prop on `SlidePanel` (`mode: 'side' | 'sheet'`), and a small drag handler for the bottom sheet snap points. No engine changes, no new gameplay features, no new dependencies.

**Tech Stack:** TypeScript strict, Next.js 16.2.3, React 19.2, CSS Modules, Vitest for unit tests.

Reference spec: [docs/superpowers/specs/2026-04-26-play-screen-mobile-responsive-design.md](../specs/2026-04-26-play-screen-mobile-responsive-design.md)

---

## File structure

**New files**
- `apps/web/src/hooks/useMediaQuery.ts` — SSR-safe `matchMedia` wrapper
- `apps/web/src/hooks/useMediaQuery.test.ts` — unit tests

**Modified files**
- `apps/web/src/app/play/[raceId]/page.module.css` — desktop zoom alignment, mobile right-stack, mobile `--timeline-h` reduction
- `apps/web/src/app/play/[raceId]/PlayClient.tsx` — pass `mode` prop to SlidePanel based on portrait detection
- `apps/web/src/components/play/Compass.module.css` — keep readouts on mobile, disc plafonné
- `apps/web/src/components/play/ZoomCompact.tsx` — toggle horizontal class on mobile
- `apps/web/src/components/play/SlidePanel.tsx` — `mode` prop + sheet rendering
- `apps/web/src/components/play/SlidePanel.module.css` — sheet snap points + drag handle, landscape narrower
- `apps/web/src/components/play/timeline/TimelineTrack.tsx` — swap label rows, drop NOW label, pass `compactPast`
- `apps/web/src/components/play/timeline/TimelineTrack.module.css` — 44px hit-area, 18px cursor, swap row visibility
- `apps/web/src/components/play/timeline/TimelineHeader.module.css` — mobile compaction
- `apps/web/src/components/play/timeline/TimelineControls.module.css` — hide playback on mobile, LIVE 36px
- `apps/web/src/components/play/timeline/ticks.ts` — `compactPast` option
- `apps/web/src/components/play/timeline/ticks.test.ts` — test for compact format
- `apps/web/src/components/play/ProgPanel.module.css` — mobile compaction
- `apps/web/src/components/play/SailPanel.module.css` — mobile compaction
- `apps/web/src/components/play/RouterPanel.module.css` — mobile compaction

---

## Task 1: `useMediaQuery` utility hook

**Files:**
- Create: `apps/web/src/hooks/useMediaQuery.ts`
- Test: `apps/web/src/hooks/useMediaQuery.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/src/hooks/useMediaQuery.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMediaQuery } from './useMediaQuery';

type MqlListener = (e: MediaQueryListEvent) => void;
type MqlMock = MediaQueryList & { _trigger: (matches: boolean) => void };

function makeMqlMock(initial: boolean): MqlMock {
  let matches = initial;
  let listener: MqlListener | null = null;
  const mql = {
    matches,
    media: '',
    onchange: null,
    addEventListener: (_t: string, l: MqlListener) => { listener = l; },
    removeEventListener: () => { listener = null; },
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => true,
  } as unknown as MqlMock;
  Object.defineProperty(mql, 'matches', {
    get: () => matches,
    configurable: true,
  });
  mql._trigger = (next: boolean) => {
    matches = next;
    listener?.({ matches: next } as MediaQueryListEvent);
  };
  return mql;
}

describe('useMediaQuery', () => {
  let mql: MqlMock;
  beforeEach(() => {
    mql = makeMqlMock(false);
    vi.spyOn(window, 'matchMedia').mockImplementation(() => mql);
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('returns false on first render when matchMedia is not yet evaluated (SSR-safe default)', () => {
    const { result } = renderHook(() => useMediaQuery('(max-width: 600px)'));
    // After mount it reflects mql.matches (false here)
    expect(result.current).toBe(false);
  });

  it('reflects matchMedia.matches after mount', () => {
    mql = makeMqlMock(true);
    vi.spyOn(window, 'matchMedia').mockImplementation(() => mql);
    const { result } = renderHook(() => useMediaQuery('(max-width: 600px)'));
    expect(result.current).toBe(true);
  });

  it('updates when matchMedia change event fires', () => {
    const { result } = renderHook(() => useMediaQuery('(max-width: 600px)'));
    expect(result.current).toBe(false);
    act(() => { mql._trigger(true); });
    expect(result.current).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @nemo/web test apps/web/src/hooks/useMediaQuery.test.ts`
Expected: FAIL — `useMediaQuery` is not defined.

- [ ] **Step 3: Implement the hook**

```ts
// apps/web/src/hooks/useMediaQuery.ts
import { useEffect, useState } from 'react';

/**
 * SSR-safe matchMedia hook. Returns false on the first server render
 * (matchMedia is undefined on the server), then re-evaluates on mount
 * and subscribes to change events.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    setMatches(mql.matches);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);

  return matches;
}
```

- [ ] **Step 4: Run the tests — they should pass**

Run: `pnpm --filter @nemo/web test apps/web/src/hooks/useMediaQuery.test.ts`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/hooks/useMediaQuery.ts apps/web/src/hooks/useMediaQuery.test.ts
git commit -m "feat(web): add useMediaQuery SSR-safe hook"
```

---

## Task 2: Desktop zoom alignment with CoordsDisplay

**Files:**
- Modify: `apps/web/src/app/play/[raceId]/page.module.css:362-395`

- [ ] **Step 1: Update the `.zoomCompact` rule to align with `.coords` (top:16 left:16)**

Replace the current `.zoomCompact` block (around lines 362-374) with:

```css
.zoomCompact {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 20;
  display: flex;
  flex-direction: column;
  border-radius: 4px;
  overflow: hidden;
  border: 1px solid rgba(245, 240, 232, 0.16);
  background: rgba(12, 20, 36, 0.88);
}
```

The only change is `top: 52px` → `top: 16px`. Everything else stays.

- [ ] **Step 2: Verify visually**

```bash
pnpm --filter @nemo/web dev
```

Open `http://localhost:3000/play/<raceId>` at 1440×900 viewport. The zoom widget should sit at the same vertical level as the coords display in the opposite top corner, both 16px from their respective edges.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/play/[raceId]/page.module.css
git commit -m "style(play): align desktop zoom with coords (top:16 right:16)"
```

---

## Task 3: Mobile zoom — horizontal layout

**Files:**
- Modify: `apps/web/src/app/play/[raceId]/page.module.css` — add horizontal media query
- Modify: `apps/web/src/components/play/ZoomCompact.tsx` — apply class

- [ ] **Step 1: Add the horizontal CSS variant in page.module.css**

Append to the existing `@media (max-width: 600px)` block (around line 329-340), and the `@media (max-height: 500px)` block (around line 344-355):

For both blocks, insert these rules:

```css
.zoomCompact {
  top: 8px;
  right: 8px;
  flex-direction: row;
}
.zoomCompactBtn { width: 36px; height: 28px; }
.zoomCompactBtn + .zoomCompactBtn {
  border-top: none;
  border-left: 1px solid rgba(245, 240, 232, 0.16);
}
```

Find the existing `@media (max-width: 640px)` rule (around line 392-395) that targets `.zoomCompact { top: 50px; right: 8px; }` and **delete it** — the new rules above supersede it for mobile widths. Keep the rule under 640px **only** for tablet/landscape narrow if needed (otherwise remove cleanly).

After this edit, `.zoomCompact` is row at `≤ 600px` width and `≤ 500px` height; column otherwise.

- [ ] **Step 2: Verify ZoomCompact.tsx needs no change**

The component already imports the same `styles.zoomCompact` and `styles.zoomCompactBtn` classes. The CSS media query handles the swap automatically.

Open `apps/web/src/components/play/ZoomCompact.tsx` and confirm — no change needed.

- [ ] **Step 3: Verify visually at 390×844 portrait and 844×390 landscape**

Run dev server, use browser devtools responsive mode. Zoom should be horizontal in both cases, 28px tall, anchored top-right.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/play/[raceId]/page.module.css
git commit -m "style(play): switch zoom to horizontal layout on mobile"
```

---

## Task 4: Compass mobile — keep readouts, plafonner disc

**Files:**
- Modify: `apps/web/src/components/play/Compass.module.css`

- [ ] **Step 1: Remove the existing `.readouts { display: none }` rules and shrink readout typography on small viewports**

Locate the two existing media queries that hide readouts:

```css
@media (max-height: 420px) {
  .wrapper {
    width: clamp(160px, 24vw, 200px);
    padding: 8px;
    gap: 6px;
  }
  .readouts { display: none; }
}

@media (max-width: 600px) {
  .wrapper {
    width: clamp(160px, 42vw, 200px);
    padding: 8px;
    gap: 6px;
  }
  .readouts { display: none; }
  .actions { gap: 4px; padding-top: 6px; }
  .actionBtn { min-height: 30px; font-size: 8px; padding: 4px 3px; gap: 3px; }
}
```

Replace them with:

```css
@media (max-height: 480px) {
  .wrapper {
    width: clamp(120px, 24vw, 168px);
    padding: 6px 8px 7px;
    gap: 5px;
  }
  .readoutLabel { font-size: 6.5px; letter-spacing: 0.14em; }
  .readoutValue { font-size: 10px; }
  .readoutValue small { font-size: 7px; }
  .readouts { padding-bottom: 4px; }
  .stage { max-width: 60px; margin: 0 auto; }
  .actions { gap: 4px; padding-top: 4px; }
  .actionBtn { min-height: 20px; font-size: 7.5px; padding: 0 2px; gap: 3px; }
}

@media (max-height: 360px) {
  .stage { max-width: 48px; }
}

@media (max-width: 600px) {
  .wrapper {
    width: clamp(120px, 38vw, 168px);
    padding: 6px 8px 7px;
    gap: 5px;
  }
  .readoutLabel { font-size: 6.5px; letter-spacing: 0.14em; }
  .readoutValue { font-size: 10px; }
  .readoutValue small { font-size: 7px; }
  .readouts { padding-bottom: 4px; }
  .stage { max-width: 60px; margin: 0 auto; }
  .actions { gap: 4px; padding-top: 4px; }
  .actionBtn { min-height: 20px; font-size: 7.5px; padding: 0 2px; gap: 3px; }
}
```

The `.stage` rule plafonne the SVG width — since `aspect-ratio: 1` already governs height, capping width to 60px makes the disc 60×60.

- [ ] **Step 2: Visual sanity check**

Reload the dev page in mobile portrait (390×844) and landscape (844×390). The compass should show all 3 readouts (VITESSE / CAP / TWA) compactly above a smaller disc.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/play/Compass.module.css
git commit -m "style(compass): preserve readouts on mobile, cap disc at 60/48px"
```

---

## Task 5: Mobile right-stack consolidation + timeline-h reduction

**Files:**
- Modify: `apps/web/src/app/play/[raceId]/page.module.css`

- [ ] **Step 1: Update the `@media (max-width: 600px)` and `@media (max-height: 500px)` blocks to fix the right-stack and timeline height**

Replace the existing `@media (max-width: 600px)` block (around line 329-340) with:

```css
@media (max-width: 600px) {
  .app { --hud-h: 44px; --timeline-h: 96px; }
  .leftStack { left: 8px; bottom: 8px; gap: 4px; }
  .rightStack {
    bottom: 8px; right: 8px;
    width: 132px;
    gap: 6px;
    align-items: stretch;
  }
  .actionButtons {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    flex-direction: row;
    gap: 4px;
    height: 36px;
  }
  .actionBtn {
    width: auto;
    height: 36px;
    flex-direction: row;
    justify-content: center;
  }
  .actionBtn > span:not(.actionBtnIcon) { display: none; }
  .rankingTabWrap { display: none; }
  .rankingFab { display: flex; }
  /* zoom horizontal already handled in Task 3 */
}
```

Note on `--timeline-h`: portrait stacks header+LIVE on one row (~36px) and track on the next (~44px), total ~96px after padding. Landscape uses a single row, much shorter — set separately below.

Replace the existing `@media (max-height: 500px)` block (around line 344-355) with:

```css
@media (max-height: 500px) {
  .app { --hud-h: 44px; --timeline-h: 76px; }
  .leftStack { left: 8px; bottom: 8px; gap: 4px; }
  .rightStack {
    bottom: 8px; right: 8px;
    width: 132px;
    gap: 6px;
    align-items: stretch;
  }
  .actionButtons {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    flex-direction: row;
    gap: 4px;
    height: 36px;
  }
  .actionBtn {
    width: auto;
    height: 36px;
    flex-direction: row;
    justify-content: center;
  }
  .actionBtn > span:not(.actionBtnIcon) { display: none; }
  .rankingTabWrap { display: none; }
  .rankingFab { display: flex; }
}
```

Note: `--timeline-h: 88px` becomes `64px` — gain de 24px sur la map area mobile.

- [ ] **Step 2: Verify visually at 390×844 portrait, 844×390 landscape, and 568×320 small landscape**

The 4 action buttons should sit in a row above the compass on the right edge, the row width should match the compass width (132px), and the zoom should sit at top-right with a clear visible gap before the bottom stack.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/play/[raceId]/page.module.css
git commit -m "style(play): consolidate mobile right-stack, reduce timeline-h to 64px"
```

---

## Task 6: Timeline ticks — `compactPast` option

**Files:**
- Modify: `apps/web/src/components/play/timeline/ticks.ts`
- Modify: `apps/web/src/components/play/timeline/ticks.test.ts`

- [ ] **Step 1: Write the failing test for compact past format**

Append to `apps/web/src/components/play/timeline/ticks.test.ts`:

```ts
describe('buildTicks — compactPast', () => {
  it('formats past ticks as "DD/M" when compactPast is true', () => {
    const now = 7 * DAY; // a date in week 2 of January-ish
    const ticks = buildTicks({
      minMs: 0,
      maxMs: 14 * DAY,
      nowMs: now,
      compactPast: true,
    });
    const past = ticks.filter((t) => t.kind === 'past');
    expect(past.length).toBeGreaterThan(0);
    // Compact format: digit(s) + "/" + digit
    for (const p of past) {
      expect(p.label).toMatch(/^\d{1,2}\/\d{1,2}$/);
    }
  });

  it('uses long format ("12 jan") when compactPast is false or omitted', () => {
    const now = 7 * DAY;
    const ticks = buildTicks({ minMs: 0, maxMs: 14 * DAY, nowMs: now });
    const past = ticks.filter((t) => t.kind === 'past');
    expect(past.length).toBeGreaterThan(0);
    for (const p of past) {
      // "8 jan", "6 fév", "10 aoû" — accent characters in MONTHS_FR.
      expect(p.label).toMatch(/^\d{1,2}\s.{3}$/);
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @nemo/web test apps/web/src/components/play/timeline/ticks.test.ts`
Expected: the new compactPast test fails — `compactPast` is not a recognized option.

- [ ] **Step 3: Add the option to ticks.ts**

In `apps/web/src/components/play/timeline/ticks.ts`, update the input interface and `formatDate`:

```ts
interface BoundsInput {
  minMs: number;
  maxMs: number;
  nowMs: number;
  /** When true, past dates are formatted as "DD/M" instead of "DD mois". */
  compactPast?: boolean;
}

function formatDate(ts: number, compact: boolean): string {
  const d = new Date(ts);
  if (compact) return `${d.getDate()}/${d.getMonth() + 1}`;
  return `${d.getDate()} ${MONTHS_FR[d.getMonth()] ?? ''}`;
}
```

Then in `buildTicks`, replace the `formatDate(t)` call inside the past loop with `formatDate(t, b.compactPast === true)`.

- [ ] **Step 4: Run all timeline tests**

Run: `pnpm --filter @nemo/web test apps/web/src/components/play/timeline/ticks.test.ts`
Expected: all tests pass (existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/play/timeline/ticks.ts apps/web/src/components/play/timeline/ticks.test.ts
git commit -m "feat(timeline): add compactPast option for short date format"
```

---

## Task 7: Timeline track — stagger labels, drop NOW, mobile cursor + 44px hit-area

**Files:**
- Modify: `apps/web/src/components/play/timeline/TimelineTrack.tsx`
- Modify: `apps/web/src/components/play/timeline/TimelineTrack.module.css`

- [ ] **Step 1: Swap label rows in TimelineTrack.tsx and drop NOW from labels**

Open `apps/web/src/components/play/timeline/TimelineTrack.tsx`. Change:

```tsx
import { useMediaQuery } from '@/hooks/useMediaQuery';
```

at the top of the file alongside the other imports.

Inside the component, after the existing hooks, add:

```tsx
const isMobile = useMediaQuery('(max-width: 600px), (max-height: 500px)');
```

Then update the `buildTicks` call to pass `compactPast`:

```tsx
const ticks: Tick[] = buildTicks({ ...bounds, nowMs, compactPast: isMobile });
```

Now swap the rows. Replace the current `tickRowAbove` block (which renders `future` + `now`) and the `tickRowBelow` block (which renders `past`) with:

```tsx
{/* Past tick labels — above the rail */}
<div className={styles.tickRowAbove} aria-hidden>
  {ticks.filter((t) => t.kind === 'past').map((t) => (
    <span
      key={`a-${t.ts}`}
      className={`${styles.tickLabel} ${styles.tickPast}`}
      style={{ left: `${t.pctX}%` }}
    >
      {t.label}
    </span>
  ))}
</div>
```

…(rail block unchanged)…

```tsx
{/* Future tick labels — below the rail. NOW intentionally omitted: the
    gold cursor disc already materialises the present. */}
<div className={styles.tickRowBelow} aria-hidden>
  {ticks.filter((t) => t.kind === 'future').map((t) => (
    <span
      key={`b-${t.ts}`}
      className={`${styles.tickLabel} ${styles.tickFuture}`}
      style={{ left: `${t.pctX}%` }}
    >
      {t.label}
    </span>
  ))}
</div>
```

The NOW tick still gets a tick-mark on the rail (via the existing `ticks.map` that renders all marks), it just no longer has a text label.

- [ ] **Step 2: Update TimelineTrack.module.css — remove the "hide tickRowBelow on narrow" rule, add 44px hit-area and 18px cursor on mobile**

In `apps/web/src/components/play/timeline/TimelineTrack.module.css`:

Delete the block at lines 167-172:

```css
@media (max-width: 480px) {
  /* very narrow : drop the past row to save vertical space, future ticks
   * still tell the player what's ahead */
  .zone { grid-template-rows: 12px auto 0; }
  .tickRowBelow { display: none; }
}
```

Then update the existing `@media (max-width: 768px)` block (around lines 155-165) to enlarge cursor and hit-area:

```css
@media (max-width: 768px) {
  .track { height: 44px; }
  .cursorHandle {
    width: 18px;
    height: 18px;
    box-shadow: 0 0 0 1px #c9a227, 0 0 6px rgba(201, 162, 39, 0.35);
  }
  .tickLabel { font-size: 8px; }
  .zone { grid-template-rows: 14px 1fr 14px; }
}
```

Add a separate landscape-narrow rule (so phones in landscape get the same treatment):

```css
@media (max-height: 500px) {
  .track { height: 44px; }
  .cursorHandle {
    width: 18px;
    height: 18px;
    box-shadow: 0 0 0 1px #c9a227, 0 0 6px rgba(201, 162, 39, 0.35);
  }
  .tickLabel { font-size: 8px; }
  .zone { grid-template-rows: 14px 1fr 14px; }
}
```

- [ ] **Step 3: Verify the timeline at 390×844 (portrait) and 844×390 (landscape)**

The cursor should be 18×18 on mobile, the rail's clickable area extended to 44px, past dates should appear above the rail in compact "DD/M" format, future J+ markers below, no "NOW" text label.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/play/timeline/TimelineTrack.tsx apps/web/src/components/play/timeline/TimelineTrack.module.css
git commit -m "feat(timeline): stagger past↑/future↓ labels, drop NOW text, 44px hit-area mobile"
```

---

## Task 8: Timeline header — mobile compaction

**Files:**
- Modify: `apps/web/src/components/play/timeline/TimelineHeader.module.css`

- [ ] **Step 1: Update the `@media (max-width: 480px)` block to keep the timestamp visible (in short form) and tighten gaps**

Replace the existing rule:

```css
@media (max-width: 480px) {
  .timestamp { display: none; }
}
```

with:

```css
@media (max-width: 600px) {
  .header { flex-basis: auto; gap: 6px; }
  .offset { font-size: 9px; padding: 4px 8px; min-width: 0; gap: 4px; }
  .timestamp { font-size: 9px; }
  .sep { display: none; }
}

@media (max-height: 500px) {
  .header { flex-basis: auto; gap: 6px; }
  .offset { font-size: 9px; padding: 4px 8px; min-width: 0; gap: 4px; }
  .timestamp { font-size: 9px; }
}
```

Keep the existing `@media (max-width: 860px)` and `@media (max-width: 768px)` blocks untouched.

- [ ] **Step 2: Visual check at 390×844 and 844×390**

Header should show `LIVE · 21h27` compactly in the left of the timeline area without overlapping the rail.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/play/timeline/TimelineHeader.module.css
git commit -m "style(timeline-header): tighten layout on mobile, keep short timestamp"
```

---

## Task 9: Timeline controls — hide playback on mobile, LIVE 36px

**Files:**
- Modify: `apps/web/src/components/play/timeline/TimelineControls.module.css`

- [ ] **Step 1: Add a mobile rule that hides ±6h, play, speed group, and grows LIVE to 36px**

Append to the file (after the existing `@media (max-width: 480px)` block):

```css
@media (max-width: 600px), (max-height: 500px) {
  .btn,
  .speedGroup {
    display: none;
  }
  .live {
    height: 36px;
    padding: 0 16px;
    font-size: 10px;
  }
}
```

- [ ] **Step 2: Verify on mobile that only the LIVE button remains in the controls cluster**

At 390×844 portrait and 844×390 landscape, the right-hand cluster of the timeline shows only LIVE. Drag the rail's cursor — it still navigates correctly.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/play/timeline/TimelineControls.module.css
git commit -m "style(timeline-controls): hide playback controls on mobile, keep LIVE at 36px"
```

---

## Task 10: SlidePanel base — mobile compaction + landscape narrower

**Files:**
- Modify: `apps/web/src/components/play/SlidePanel.module.css`

- [ ] **Step 1: Update the `@media (max-width: 600px)` block and add a landscape narrow rule**

Replace the existing block (around lines 79-84):

```css
@media (max-width: 600px) {
  .panel { max-width: calc(100vw - 48px); }
  .head { padding: 12px 14px 10px; }
  .title { font-size: 18px; }
  .body { padding: 12px 14px; }
}
```

with:

```css
@media (max-width: 600px) {
  .panel { max-width: min(360px, calc(100vw - 48px)); }
  .head { padding: 10px 14px; }
  .title { font-size: 18px; }
  .body { padding: 12px 14px; }
}

@media (max-height: 500px) {
  .panel { max-width: min(360px, calc(100vw - 48px)); }
  .head { padding: 10px 14px; }
  .title { font-size: 18px; }
  .body { padding: 12px 14px; }
}
```

- [ ] **Step 2: Verify side panel width at 844×390 landscape**

Open Voiles, Programmation, or Routeur. The panel should be 360px wide max, leaving the map visible to the left.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/play/SlidePanel.module.css
git commit -m "style(slide-panel): tighten mobile and narrow landscape side panel to 360px"
```

---

## Task 11: ProgPanel / SailPanel / RouterPanel — mobile compaction

**Files:**
- Modify: `apps/web/src/components/play/ProgPanel.module.css`
- Modify: `apps/web/src/components/play/SailPanel.module.css`
- Modify: `apps/web/src/components/play/RouterPanel.module.css`

- [ ] **Step 1: Append the mobile compaction block to ProgPanel.module.css**

```css
@media (max-width: 600px), (max-height: 500px) {
  .tabs { margin-bottom: 12px; }
  .tab { padding: 8px 6px; font-size: 9px; letter-spacing: 0.12em; }
  .form { gap: 8px; margin-bottom: 12px; }
  .fieldLabel { font-size: 8.5px; }
  .fieldInput { padding: 8px 10px; font-size: 13px; }
  .submit { padding: 10px 14px; font-size: 10px; letter-spacing: 0.14em; }
  .queueTitle { font-size: 15px; margin-bottom: 6px; }
}
```

- [ ] **Step 2: Append the mobile compaction block to SailPanel.module.css**

```css
@media (max-width: 600px), (max-height: 500px) {
  .modeToggle { margin-bottom: 12px; padding: 3px; gap: 4px; }
  .modeBtn { padding: 8px 10px; font-size: 9px; letter-spacing: 0.12em; }
  .sailRow {
    grid-template-columns: 30px 1fr;
    padding: 8px 10px;
    gap: 8px;
  }
}
```

- [ ] **Step 3: Append the mobile compaction block to RouterPanel.module.css**

```css
@media (max-width: 600px), (max-height: 500px) {
  .section { margin-bottom: 12px; }
  .fieldLabel { font-size: 8.5px; margin-bottom: 6px; }
  .card { padding: 10px 12px; gap: 10px; }
  .cardTitle { font-size: 14px; }
  .cardMeta { font-size: 10px; }
}
```

All referenced classes exist in their respective files (verified during planning) — no need to skip any rule.

- [ ] **Step 4: Verify visually at 390×844 (portrait) by opening each panel**

Each panel should be more compact: smaller titles, less padding, smaller fonts but still readable.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/play/ProgPanel.module.css apps/web/src/components/play/SailPanel.module.css apps/web/src/components/play/RouterPanel.module.css
git commit -m "style(panels): mobile compactions for Prog/Sail/Router"
```

---

## Task 12: SlidePanel — `mode` prop + sheet snap-point CSS (no drag yet)

**Files:**
- Modify: `apps/web/src/components/play/SlidePanel.tsx`
- Modify: `apps/web/src/components/play/SlidePanel.module.css`

- [ ] **Step 1: Extend SlidePanelProps with a `mode` prop and render variant**

Replace `apps/web/src/components/play/SlidePanel.tsx` with:

```tsx
'use client';

import { useState, useCallback } from 'react';
import styles from './SlidePanel.module.css';

export type SlidePanelMode = 'side' | 'sheet';
export type SheetSnap = 'peek' | 'mid' | 'full';

interface SlidePanelProps {
  side: 'left' | 'right';
  width: number;
  title: string;
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /**
   * Layout mode. `side` (default) — slide-in from the side, full-height.
   * `sheet` — anchored to the bottom, three snap points (peek / mid / full).
   * Used for portrait phones so the map stays visible above the panel.
   */
  mode?: SlidePanelMode;
  panelClassName?: string;
}

export default function SlidePanel({
  side, width, title, isOpen, onClose, children,
  mode = 'side', panelClassName,
}: SlidePanelProps): React.ReactElement {
  const [snap, setSnap] = useState<SheetSnap>('mid');

  const cycleSnap = useCallback(() => {
    setSnap((s) => (s === 'peek' ? 'mid' : s === 'mid' ? 'full' : 'peek'));
  }, []);

  if (mode === 'sheet') {
    return (
      <div className={styles.overlay}>
        <aside
          className={`${styles.sheet} ${styles[`sheet_${snap}`]} ${isOpen ? styles.open : ''}${panelClassName ? ` ${panelClassName}` : ''}`}
          aria-label={title}
        >
          <button
            type="button"
            className={styles.sheetHandle}
            onClick={cycleSnap}
            aria-label="Cycle panel size"
          >
            <span className={styles.sheetHandleBar} />
          </button>
          <div className={styles.head}>
            <h3 className={styles.title}>{title}</h3>
            <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Fermer">✕</button>
          </div>
          <div className={styles.body}>{children}</div>
        </aside>
      </div>
    );
  }

  return (
    <div className={styles.overlay}>
      <aside
        className={`${styles.panel} ${styles[side]} ${isOpen ? styles.open : ''}${panelClassName ? ` ${panelClassName}` : ''}`}
        style={{ width }}
        aria-label={title}
      >
        <div className={styles.head}>
          <h3 className={styles.title}>{title}</h3>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Fermer">✕</button>
        </div>
        <div className={styles.body}>{children}</div>
      </aside>
    </div>
  );
}
```

- [ ] **Step 2: Add the sheet CSS to SlidePanel.module.css**

Append to `apps/web/src/components/play/SlidePanel.module.css`:

```css
/* ── Bottom sheet variant (mobile portrait only) ───────────── */
.sheet {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(12, 20, 36, 0.97);
  border-top: 1px solid rgba(245, 240, 232, 0.16);
  border-radius: 12px 12px 0 0;
  display: flex;
  flex-direction: column;
  pointer-events: auto;
  z-index: 28;
  transition: transform 220ms ease, height 220ms ease;
  /* default = peek so we can animate up to mid/full */
  transform: translateY(100%);
}
.sheet.open { transform: translateY(0); }

.sheet_peek { height: 64px; }
.sheet_mid { height: min(50vh, 360px); }
.sheet_full { height: min(90vh, calc(100vh - 56px)); }

.sheetHandle {
  background: transparent;
  border: none;
  width: 100%;
  height: 18px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
}
.sheetHandleBar {
  width: 36px;
  height: 4px;
  background: rgba(245, 240, 232, 0.35);
  border-radius: 2px;
  transition: background 150ms;
}
.sheetHandle:hover .sheetHandleBar { background: rgba(245, 240, 232, 0.55); }
```

- [ ] **Step 3: Build and run lint/types**

```bash
pnpm --filter @nemo/web typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/play/SlidePanel.tsx apps/web/src/components/play/SlidePanel.module.css
git commit -m "feat(slide-panel): add sheet mode with peek/mid/full snap points"
```

---

## Task 13: SlidePanel sheet — drag handler

**Files:**
- Modify: `apps/web/src/components/play/SlidePanel.tsx`

- [ ] **Step 1: Add pointer-event drag logic to the sheet handle**

In `SlidePanel.tsx`, replace the `cycleSnap` block and the `<button className={styles.sheetHandle}>` markup with a draggable variant. Final component shape:

```tsx
'use client';

import { useCallback, useRef, useState } from 'react';
import styles from './SlidePanel.module.css';

export type SlidePanelMode = 'side' | 'sheet';
export type SheetSnap = 'peek' | 'mid' | 'full';

interface SlidePanelProps {
  side: 'left' | 'right';
  width: number;
  title: string;
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  mode?: SlidePanelMode;
  panelClassName?: string;
}

const SNAP_PCT: Record<SheetSnap, number> = {
  peek: 0.10,
  mid: 0.50,
  full: 0.90,
};

function nearestSnap(viewportFrac: number): SheetSnap {
  // viewportFrac = sheet height as fraction of viewport.
  // Pick the snap whose target is closest.
  let best: SheetSnap = 'mid';
  let bestDist = Infinity;
  (Object.keys(SNAP_PCT) as SheetSnap[]).forEach((k) => {
    const d = Math.abs(SNAP_PCT[k] - viewportFrac);
    if (d < bestDist) { best = k; bestDist = d; }
  });
  return best;
}

export default function SlidePanel({
  side, width, title, isOpen, onClose, children,
  mode = 'side', panelClassName,
}: SlidePanelProps): React.ReactElement {
  const [snap, setSnap] = useState<SheetSnap>('mid');
  const dragStartRef = useRef<{ y: number; height: number } | null>(null);

  const cycleSnap = useCallback(() => {
    setSnap((s) => (s === 'peek' ? 'mid' : s === 'mid' ? 'full' : 'peek'));
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    const sheet = e.currentTarget.parentElement as HTMLElement | null;
    if (!sheet) return;
    dragStartRef.current = { y: e.clientY, height: sheet.getBoundingClientRect().height };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    // No live resizing — we wait for pointer-up and snap to nearest. Keep the
    // gesture simple to avoid heavy reflow during drag.
  };
  const onPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const start = dragStartRef.current;
    dragStartRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    if (!start) return;
    const dy = e.clientY - start.y;
    if (Math.abs(dy) < 8) {
      // Treat as tap — cycle.
      cycleSnap();
      return;
    }
    const newHeight = Math.max(0, start.height - dy);
    const frac = newHeight / window.innerHeight;
    setSnap(nearestSnap(frac));
  };

  if (mode === 'sheet') {
    return (
      <div className={styles.overlay}>
        <aside
          className={`${styles.sheet} ${styles[`sheet_${snap}`]} ${isOpen ? styles.open : ''}${panelClassName ? ` ${panelClassName}` : ''}`}
          aria-label={title}
        >
          <button
            type="button"
            className={styles.sheetHandle}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            aria-label="Redimensionner panneau"
          >
            <span className={styles.sheetHandleBar} />
          </button>
          <div className={styles.head}>
            <h3 className={styles.title}>{title}</h3>
            <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Fermer">✕</button>
          </div>
          <div className={styles.body}>{children}</div>
        </aside>
      </div>
    );
  }

  return (
    <div className={styles.overlay}>
      <aside
        className={`${styles.panel} ${styles[side]} ${isOpen ? styles.open : ''}${panelClassName ? ` ${panelClassName}` : ''}`}
        style={{ width }}
        aria-label={title}
      >
        <div className={styles.head}>
          <h3 className={styles.title}>{title}</h3>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Fermer">✕</button>
        </div>
        <div className={styles.body}>{children}</div>
      </aside>
    </div>
  );
}
```

The `nearestSnap` helper picks the snap closest to the dragged height fraction. Tap (dy < 8px) cycles `peek → mid → full → peek` like before.

- [ ] **Step 2: Run typecheck**

```bash
pnpm --filter @nemo/web typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/play/SlidePanel.tsx
git commit -m "feat(slide-panel): drag handle on sheet — release snaps to nearest size"
```

---

## Task 14: PlayClient — wire `useMediaQuery` + pass `mode`

**Files:**
- Modify: `apps/web/src/app/play/[raceId]/PlayClient.tsx`

- [ ] **Step 1: Import the hook and choose mode based on portrait phone detection**

Open `apps/web/src/app/play/[raceId]/PlayClient.tsx`. Add at the top of the imports:

```tsx
import { useMediaQuery } from '@/hooks/useMediaQuery';
```

Inside the component (after the existing hook calls, before the early returns), add:

```tsx
const isPortraitPhone = useMediaQuery('(max-width: 600px) and (orientation: portrait)');
const panelMode = isPortraitPhone ? 'sheet' : 'side';
```

- [ ] **Step 2: Pass `mode={panelMode}` on each `SlidePanel`**

Find the four `<SlidePanel ...>` invocations in the JSX (Ranking, Sails, Programmation, Routeur). Add the `mode={panelMode}` prop to each.

Example for Ranking:

```tsx
<SlidePanel
  side="left"
  width={320}
  title="Classement"
  isOpen={activePanel === 'ranking'}
  onClose={() => useGameStore.getState().closePanel()}
  mode={panelMode}
>
  <RankingPanel />
</SlidePanel>
```

Apply the same `mode={panelMode}` addition to Sails, Programmation, and Routeur.

- [ ] **Step 3: Verify on portrait mobile, landscape mobile, and desktop**

- 390×844 portrait → opening any panel should show a bottom sheet with handle, mid-snap default, draggable to peek/full.
- 844×390 landscape → opening any panel should still slide in from the side at 360px max width.
- 1440×900 desktop → opening any panel should slide in at the original width.

- [ ] **Step 4: Run typecheck and lint**

```bash
pnpm --filter @nemo/web typecheck
pnpm --filter @nemo/web lint
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/play/[raceId]/PlayClient.tsx
git commit -m "feat(play): wire mode prop — sheet on portrait phones, side panel elsewhere"
```

---

## Task 15: Cross-viewport visual sweep

**Files:** none (verification only)

- [ ] **Step 1: Run the dev server**

```bash
pnpm dev
```

- [ ] **Step 2: Walk through the matrix below in browser devtools (responsive mode)**

For each viewport, verify the listed checks:

| Viewport | Checks |
|---|---|
| 1440×900 | Zoom at top:16 right:16, action stack and compass intact, panels open from side at original width |
| 1024×768 | Layout same as desktop, breakpoints not triggered |
| 844×390 (iPhone 14 landscape) | Zoom horizontal top-right, action row + compass bottom-right with visible gap, timeline shows only LIVE button + drag rail, panel opens as side at ≤ 360px |
| 568×320 (iPhone SE landscape) | Compass disc at 48×48, no overflow, drag works |
| 390×844 (iPhone 14 portrait) | Compass with readouts, action row width-matched to compass, opening any panel shows bottom sheet at mid snap, drag handle to cycle/snap to peek and full |
| 820×1180 (iPad portrait) | Layout still desktop-style, no bottom sheet (breakpoint 600px not crossed) |

- [ ] **Step 3: Note any regressions**

If something visibly regresses, file a follow-up task here rather than patching ad hoc — keep this plan focused.

- [ ] **Step 4: Commit (if any nits caught)**

(Only if step 3 surfaced a tiny CSS nit that's clearly part of the intended scope.)

---

## Final commit hygiene

Each task produces one commit with the standard format. After Task 14, the branch should have ~14 atomic commits, each scoped to one concern. Open the PR with:

```bash
gh pr create --title "play: mobile responsive refonte" --body "$(cat <<'EOF'
## Summary
- Bottom sheet for portrait phones so the map stays visible
- Mobile right-edge stack consolidated (zoom horiz top, actions+compass bottom, gap garanti)
- Compass keeps readouts on mobile, disc plafonné 60/48px
- Timeline mobile drastically simplified (only header + rail + LIVE), labels staggered, 44px hit-area
- Panels Sails/Prog/Router compaction tokens
- Desktop zoom aligned with coords (top:16)
- New useMediaQuery hook (SSR-safe)

Spec: docs/superpowers/specs/2026-04-26-play-screen-mobile-responsive-design.md
Plan: docs/superpowers/plans/2026-04-26-play-screen-mobile-responsive.md

## Test plan
- [ ] 1440×900 desktop — zoom alignment, panels intact
- [ ] iPhone 14 portrait 390×844 — bottom sheet drag, compass readouts, action row width-matched
- [ ] iPhone 14 landscape 844×390 — right-edge stack no overlap, panel side at 360px
- [ ] iPhone SE landscape 568×320 — compass 48px, no overflow
- [ ] iPad portrait 820×1180 — layout still desktop
- [ ] Vitest: useMediaQuery + ticks compactPast pass

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
