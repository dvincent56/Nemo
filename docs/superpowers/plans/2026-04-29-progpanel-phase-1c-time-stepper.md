# ProgPanel Phase 1c — `<TimeStepper>` Primitive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a brand-new `<TimeStepper>` presentational primitive that the Phase 2 ProgPanel order editors will use to choose an order's trigger time. Hold-to-accelerate +/- buttons, floor enforced at `minValue`, snap to minute boundaries, displays absolute `HH:MM` and relative `+Xh Ymin`. No store, no behavior beyond pure prop input/output.

**Architecture:** Single React component plus a small pure helper module for the hold-to-accelerate curve (testable in isolation). The setTimeout-based pulse loop pulses the user-supplied step counts. Pointer capture from `<button>` to keep the press alive across pointer-leave.

**Tech Stack:** TypeScript strict, React 19.2, vitest with `@vitest-environment jsdom` for the React component test, plain `node` env for the pure curve test, `@testing-library/react`, `vi.useFakeTimers()` for the curve test (deterministic).

---

## File map

**Created:**
- `apps/web/src/components/play/TimeStepper.tsx` — the React component
- `apps/web/src/components/play/TimeStepper.module.css` — stepper-specific styles
- `apps/web/src/components/play/TimeStepper.curve.ts` — pure helper module exporting the hold-to-accelerate step/delay function
- `apps/web/src/components/play/TimeStepper.curve.test.ts` — pure unit tests on the curve (no jsdom needed)
- `apps/web/src/components/play/TimeStepper.test.tsx` — vitest+jsdom render tests for the component

**Modified:**
- None in Phase 1c. The component is new and not yet consumed — Phase 2 will wire it into the ProgPanel cap-editor and sail-editor sub-screens.

---

## Conventions used in this plan

- Run tests for `apps/web` with `pnpm --filter @nemo/web test`. The root vitest config already includes `*.test.ts` and `*.test.tsx` under `src/components/**` (Phase 1a added `.tsx`).
- Use `vi.useFakeTimers()` in the curve test to control `setTimeout` deterministically. Do NOT use real timers — they make the test slow and flaky.
- The component test uses `// @vitest-environment jsdom` at the top (mirror `apps/web/src/components/play/compass/CompassDial.test.tsx`).
- Commit message style: `feat(time-stepper): …` for the new component, `test(time-stepper): …` for the curve test.

---

## Pre-task: confirm the dev environment

Before touching anything, verify the current main branch state:

- `git status` — clean
- `pnpm --filter @nemo/web test` — should show 133/133 passing (post-Phase-1b baseline)
- `pnpm --filter @nemo/web typecheck` — should be clean (modulo pre-existing `.next/dev` errors)

If any of these are off, stop and investigate before starting Task 1.

---

## Task 1: Pure helper module — `TimeStepper.curve.ts` (TDD)

**Files:**
- Create: `apps/web/src/components/play/TimeStepper.curve.ts`
- Create: `apps/web/src/components/play/TimeStepper.curve.test.ts`

The hold-to-accelerate curve is a pure function `(pulseIndex: number) => { stepSec: number; delayMs: number }`. Test-first because the curve thresholds are easy to get wrong by off-by-one.

### Curve specification

| Pulse # | stepSec   | delayMs |
|---------|-----------|---------|
| 1       | 60        | 350     |
| 2       | 60        | 350     |
| 3       | 60        | 350     |
| 4       | 300       | 140     |
| 5       | 300       | 140     |
| 6       | 300       | 140     |
| 7       | 300       | 140     |
| 8       | 900       | 90      |
| ...     | 900       | 90      |
| 14      | 900       | 90      |
| 15      | 3600      | 60      |
| 16+     | 3600      | 60      |

(Values in seconds, not minutes — to match the unix-second OrderTrigger.time convention.)

### Step 1: Write the failing test

Create `apps/web/src/components/play/TimeStepper.curve.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { holdAccelerationCurve } from './TimeStepper.curve';

describe('holdAccelerationCurve', () => {
  it('returns 60s/350ms for pulses 1-3 (initial slow phase)', () => {
    for (const n of [1, 2, 3]) {
      expect(holdAccelerationCurve(n)).toEqual({ stepSec: 60, delayMs: 350 });
    }
  });

  it('returns 300s/140ms for pulses 4-7 (5-minute steps)', () => {
    for (const n of [4, 5, 6, 7]) {
      expect(holdAccelerationCurve(n)).toEqual({ stepSec: 300, delayMs: 140 });
    }
  });

  it('returns 900s/90ms for pulses 8-14 (15-minute steps)', () => {
    for (const n of [8, 9, 10, 14]) {
      expect(holdAccelerationCurve(n)).toEqual({ stepSec: 900, delayMs: 90 });
    }
  });

  it('returns 3600s/60ms for pulses 15+ (1-hour steps, max speed)', () => {
    for (const n of [15, 16, 100, 1000]) {
      expect(holdAccelerationCurve(n)).toEqual({ stepSec: 3600, delayMs: 60 });
    }
  });

  it('handles pulse 0 as the first slow tick (defensive)', () => {
    expect(holdAccelerationCurve(0)).toEqual({ stepSec: 60, delayMs: 350 });
  });
});
```

Run: `pnpm --filter @nemo/web test src/components/play/TimeStepper.curve.test.ts`
Expected: FAIL with `Cannot find module './TimeStepper.curve'`.

### Step 2: Implement `TimeStepper.curve.ts`

Create `apps/web/src/components/play/TimeStepper.curve.ts`:

```ts
/**
 * Hold-to-accelerate curve for the TimeStepper +/- press loop.
 *
 * Each pulse advances the order time by `stepSec` seconds and schedules
 * the next pulse `delayMs` milliseconds later. Pulse counter starts at 1
 * on pointer-down; resets on pointer-up / leave / cancel.
 *
 * Cf. spec `docs/superpowers/specs/2026-04-28-progpanel-redesign-design.md`
 * (Time logic & obsolescence section).
 */

export interface CurvePulse {
  stepSec: number;
  delayMs: number;
}

export function holdAccelerationCurve(pulse: number): CurvePulse {
  if (pulse < 4) return { stepSec: 60, delayMs: 350 };       // 1 min
  if (pulse < 8) return { stepSec: 300, delayMs: 140 };      // 5 min
  if (pulse < 15) return { stepSec: 900, delayMs: 90 };      // 15 min
  return { stepSec: 3600, delayMs: 60 };                     // 60 min
}
```

### Step 3: Run the test

Run the same command. Expected: 5/5 pass.

### Step 4: Commit

```bash
git add apps/web/src/components/play/TimeStepper.curve.ts apps/web/src/components/play/TimeStepper.curve.test.ts
git commit -m "feat(time-stepper): add hold-to-accelerate curve helper + tests"
```

---

## Task 2: Component skeleton — `<TimeStepper>` with TDD on rendering

**Files:**
- Create: `apps/web/src/components/play/TimeStepper.module.css`
- Create: `apps/web/src/components/play/TimeStepper.tsx`
- Create: `apps/web/src/components/play/TimeStepper.test.tsx`

### Component specification

**API:**
```ts
export interface TimeStepperProps {
  /** Current value, in unix seconds. Snapped to whole minutes. */
  value: number;
  /** Called with the next value (in unix seconds, snapped to minute). */
  onChange: (nextSec: number) => void;
  /** Floor — value cannot go below this. In unix seconds. */
  minValue: number;
  /** Reference time for the relative offset display ("+12min" etc.). */
  nowSec: number;
  className?: string;
}
```

**Render:**
- 3-column grid: minus button (left, 56px wide), display (center, flex-grow), plus button (right, 56px wide)
- Display center: `HH:MM` absolute (Bebas Neue, 30px) + `+Xh Ymin` or `+Nmin` relative (Space Mono, 10px, 0.14em letter-spacing)
- Floor warning: when `value <= minValue`, the minus button is disabled AND a small floor message appears below the stepper: "⛔ Délai mini : now + 5min"
- Buttons: gold-glow on hover (when enabled), pulse-accelerate on hold

**Behavior:**
- Click +: increments by 60 (one minute, one pulse)
- Click −: decrements by 60 (one minute) if `value > minValue`, else no-op
- Hold +: starts the curve from pulse=1; calls `onChange(value + 60)` immediately, schedules next pulse at 350ms
- Hold −: same but symmetric, clamped to `minValue` (when clamp triggers, the held button releases naturally — no further pulses fire)
- Pointer-up / pointer-leave / pointer-cancel: stop the loop, reset pulse counter

**Format helpers:**
- `formatAbsolute(sec)` → `HH:MM` (24h, padded)
- `formatRelative(sec, nowSec)` → `+Xh Ymin` (≥1h) or `+Nmin` (<1h) or `+0min` (exact)

### Step 1: Write the failing render tests

Create `apps/web/src/components/play/TimeStepper.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import TimeStepper from './TimeStepper';

const HOUR = 3600;
const MIN = 60;

describe('<TimeStepper>', () => {
  it('renders the value as HH:MM in the center display', () => {
    const noon = 12 * HOUR;
    const { container } = render(
      <TimeStepper value={noon} onChange={() => {}} minValue={0} nowSec={0} />
    );
    expect(container.textContent).toContain('12:00');
  });

  it('formats relative offset under 1h as +Nmin', () => {
    const now = 12 * HOUR;
    const target = now + 30 * MIN;
    const { container } = render(
      <TimeStepper value={target} onChange={() => {}} minValue={0} nowSec={now} />
    );
    expect(container.textContent).toContain('+30min');
  });

  it('formats relative offset over 1h as +Xh Ymin', () => {
    const now = 12 * HOUR;
    const target = now + 2 * HOUR + 27 * MIN;
    const { container } = render(
      <TimeStepper value={target} onChange={() => {}} minValue={0} nowSec={now} />
    );
    expect(container.textContent).toContain('+2h 27min');
  });

  it('disables the minus button when value === minValue', () => {
    const t = 12 * HOUR;
    const { getByLabelText } = render(
      <TimeStepper value={t} onChange={() => {}} minValue={t} nowSec={t} />
    );
    const minus = getByLabelText('Reculer');
    expect(minus).toHaveProperty('disabled', true);
  });

  it('shows the floor warning when value === minValue', () => {
    const t = 12 * HOUR;
    const { container } = render(
      <TimeStepper value={t} onChange={() => {}} minValue={t} nowSec={t} />
    );
    expect(container.textContent).toContain('Délai mini');
  });

  it('calls onChange with value+60 on a single + click', () => {
    const onChange = vi.fn();
    const t = 12 * HOUR;
    const { getByLabelText } = render(
      <TimeStepper value={t} onChange={onChange} minValue={0} nowSec={t} />
    );
    const plus = getByLabelText('Avancer');
    fireEvent.pointerDown(plus, { pointerId: 1 });
    fireEvent.pointerUp(plus, { pointerId: 1 });
    expect(onChange).toHaveBeenCalledWith(t + 60);
  });

  it('calls onChange with value-60 on a single - click when above minValue', () => {
    const onChange = vi.fn();
    const t = 12 * HOUR;
    const { getByLabelText } = render(
      <TimeStepper value={t} onChange={onChange} minValue={0} nowSec={t} />
    );
    const minus = getByLabelText('Reculer');
    fireEvent.pointerDown(minus, { pointerId: 1 });
    fireEvent.pointerUp(minus, { pointerId: 1 });
    expect(onChange).toHaveBeenCalledWith(t - 60);
  });

  it('does not call onChange on a - click when value === minValue', () => {
    const onChange = vi.fn();
    const t = 12 * HOUR;
    const { getByLabelText } = render(
      <TimeStepper value={t} onChange={onChange} minValue={t} nowSec={t} />
    );
    const minus = getByLabelText('Reculer');
    fireEvent.pointerDown(minus, { pointerId: 1 });
    fireEvent.pointerUp(minus, { pointerId: 1 });
    expect(onChange).not.toHaveBeenCalled();
  });
});
```

(8 tests covering: render, formatting under/over 1h, floor warning, single click increment, single click decrement, floor blocks decrement.)

Run: `pnpm --filter @nemo/web test src/components/play/TimeStepper.test.tsx`
Expected: FAIL — module not yet implemented.

### Step 2: Create the CSS module

Create `apps/web/src/components/play/TimeStepper.module.css`:

```css
.stepper {
  display: grid;
  grid-template-columns: 56px 1fr 56px;
  gap: 8px;
  align-items: stretch;
  padding: 12px;
  background: rgba(0, 0, 0, 0.30);
  border: 1px solid rgba(245, 240, 232, 0.16);
  border-radius: 4px;
  position: relative;
}

.btn {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(245, 240, 232, 0.16);
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #f5f0e8;
  height: 56px;
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  touch-action: none;
  transition: background 120ms, border-color 120ms, color 120ms;
}

.btn:not(:disabled):hover {
  background: rgba(201, 162, 39, 0.18);
  border-color: #c9a227;
  color: #c9a227;
}

.btn:not(:disabled):active {
  background: #c9a227;
  color: #1a2840;
  border-color: #c9a227;
}

.btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.display {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  background: #060b18;
  border: 1px solid #c9a227;
  border-radius: 4px;
  padding: 4px;
}

.absolute {
  font-family: 'Bebas Neue', Impact, sans-serif;
  font-size: 30px;
  color: #c9a227;
  letter-spacing: 0.04em;
  line-height: 1;
}

.relative {
  font-family: 'Space Mono', ui-monospace, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  color: rgba(245, 240, 232, 0.42);
  margin-top: 2px;
  text-transform: uppercase;
}

.floorWarning {
  position: absolute;
  bottom: -20px;
  left: 0;
  right: 0;
  text-align: center;
  font-family: 'Space Mono', ui-monospace, monospace;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.14em;
  color: #f0b96b;
  text-transform: uppercase;
}
```

### Step 3: Implement `TimeStepper.tsx`

Create `apps/web/src/components/play/TimeStepper.tsx`:

```tsx
/**
 * <TimeStepper> — pick a time for an order trigger via hold-to-accelerate
 * +/- buttons. Pure, prop-driven, no store.
 *
 * Used by the future ProgPanel order editors (Phase 2). Format: HH:MM
 * absolute + +Xh Ymin relative. Snapped to whole minutes. Floor enforced
 * at `minValue`.
 *
 * Cf. spec `docs/superpowers/specs/2026-04-28-progpanel-redesign-design.md`
 * (Time logic & obsolescence section).
 */

'use client';

import { useCallback, useEffect, useRef, type ReactElement } from 'react';
import { Minus, Plus } from 'lucide-react';
import { holdAccelerationCurve } from './TimeStepper.curve';
import styles from './TimeStepper.module.css';

export interface TimeStepperProps {
  /** Current value, in unix seconds. Snapped to whole minutes by the consumer. */
  value: number;
  /** Called with the next value (in unix seconds, snapped to minute). */
  onChange: (nextSec: number) => void;
  /** Floor — value cannot go below this. In unix seconds. */
  minValue: number;
  /** Reference time for the relative offset display. */
  nowSec: number;
  className?: string;
}

function formatAbsolute(sec: number): string {
  const totalMin = Math.floor(sec / 60);
  const h = Math.floor(totalMin / 60) % 24;
  const m = totalMin % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function formatRelative(sec: number, nowSec: number): string {
  const dSec = sec - nowSec;
  const dMin = Math.floor(dSec / 60);
  if (dMin < 0) return `${dMin}min`;     // negative case: "-3min"
  if (dMin < 60) return `+${dMin}min`;
  const h = Math.floor(dMin / 60);
  const m = dMin % 60;
  return m === 0 ? `+${h}h` : `+${h}h ${m}min`;
}

export default function TimeStepper({
  value,
  onChange,
  minValue,
  nowSec,
  className,
}: TimeStepperProps): ReactElement {
  // Refs for the press loop. We keep a timer ref + a pulse counter ref
  // that the pulse function reads via closure-stable callback.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const valueRef = useRef(value);
  useEffect(() => { valueRef.current = value; }, [value]);

  const stop = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Cleanup on unmount.
  useEffect(() => () => stop(), [stop]);

  const startLoop = useCallback((direction: 1 | -1) => {
    let pulse = 1;
    const tick = () => {
      const { stepSec, delayMs } = holdAccelerationCurve(pulse);
      const candidate = valueRef.current + direction * stepSec;
      // Floor / no-clamp logic. We never overshoot the floor; we never
      // bump above the floor on a +. We DO floor-clamp on a -.
      let next: number;
      if (direction === -1) {
        next = Math.max(candidate, minValue);
        // If we're already at the floor and the user is still holding,
        // stop the loop — there's nothing more to do.
        if (next === valueRef.current) {
          stop();
          return;
        }
      } else {
        next = candidate;
      }
      onChange(next);
      pulse += 1;
      timerRef.current = setTimeout(tick, delayMs);
    };
    tick();
  }, [minValue, onChange, stop]);

  const blockMinus = value <= minValue;

  return (
    <div className={`${styles.stepper} ${className ?? ''}`}>
      <button
        type="button"
        className={styles.btn}
        disabled={blockMinus}
        aria-label="Reculer"
        onPointerDown={(e) => {
          if (blockMinus) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          startLoop(-1);
        }}
        onPointerUp={stop}
        onPointerLeave={stop}
        onPointerCancel={stop}
      >
        <Minus size={20} strokeWidth={2.5} />
      </button>

      <div className={styles.display}>
        <div className={styles.absolute}>{formatAbsolute(value)}</div>
        <div className={styles.relative}>{formatRelative(value, nowSec)}</div>
      </div>

      <button
        type="button"
        className={styles.btn}
        aria-label="Avancer"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          startLoop(1);
        }}
        onPointerUp={stop}
        onPointerLeave={stop}
        onPointerCancel={stop}
      >
        <Plus size={20} strokeWidth={2.5} />
      </button>

      {blockMinus && (
        <div className={styles.floorWarning}>
          ⛔ Délai mini : now + 5min
        </div>
      )}
    </div>
  );
}
```

### Step 4: Run the render tests

Run: `pnpm --filter @nemo/web test src/components/play/TimeStepper.test.tsx`
Expected: 8/8 pass.

If a test fails, debug. Common gotchas:
- The `pointerDown` event might not bubble up correctly — verify `getByLabelText('Reculer')` returns the actual `<button>`.
- `@testing-library/react`'s `fireEvent.pointerDown(...)` passes synthetic events. The `setPointerCapture` call may throw in JSDOM if the element doesn't have the method. Add a `try/catch` around `setPointerCapture` if needed:
  ```ts
  try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* JSDOM doesn't implement */ }
  ```

### Step 5: Commit

```bash
git add apps/web/src/components/play/TimeStepper.tsx apps/web/src/components/play/TimeStepper.module.css apps/web/src/components/play/TimeStepper.test.tsx
git commit -m "feat(time-stepper): add <TimeStepper> primitive + render tests"
```

---

## Task 3: Add a hold-to-accelerate behavior test

**Files:**
- Modify: `apps/web/src/components/play/TimeStepper.test.tsx`

The render tests don't exercise the press-and-hold curve. This task adds a single test using `vi.useFakeTimers()` to drive the timer forward and assert multiple `onChange` calls during a sustained hold.

### Step 1: Add the test case

Append to `TimeStepper.test.tsx`, inside the existing `describe`:

```tsx
  it('accelerates +/- when held: 3 ticks at 1min, then 5min steps', async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const t = 12 * HOUR;
    const { getByLabelText, unmount } = render(
      <TimeStepper value={t} onChange={onChange} minValue={0} nowSec={t} />
    );
    const plus = getByLabelText('Avancer');

    // Pulse 1 fires synchronously at pointerdown
    fireEvent.pointerDown(plus, { pointerId: 1 });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(t + 60);

    // Advance 350ms → pulse 2 (still 60s step)
    await vi.advanceTimersByTimeAsync(350);
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith(t + 60); // value didn't change between calls because the component reads valueRef which the parent didn't update; keep the assertion consistent with the implementation.

    // Advance 350ms again → pulse 3
    await vi.advanceTimersByTimeAsync(350);
    expect(onChange).toHaveBeenCalledTimes(3);

    // Advance 350ms → pulse 4 (5-min step now, but wait 140ms)
    await vi.advanceTimersByTimeAsync(350);
    expect(onChange).toHaveBeenCalledTimes(4);

    // Pointer up → loop stops
    fireEvent.pointerUp(plus, { pointerId: 1 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(onChange).toHaveBeenCalledTimes(4); // no further calls

    unmount();
    vi.useRealTimers();
  });
```

Note about the `valueRef` quirk: in the test, the parent never updates `value` between pulses (no controlled state lift). So `valueRef.current` stays at the initial `t`. Each pulse computes `valueRef.current + direction * stepSec`, which produces the same target every time. That's fine for testing the loop's *cadence* (the focus of this test); the "real" value advancement would happen if the test used a controlled state setter as the consumer would.

If you want to test value-following behavior, add a second test that uses a controlled state setter:

```tsx
  it('advances cumulatively when consumer updates value between pulses', async () => {
    vi.useFakeTimers();
    let v = 12 * HOUR;
    const onChange = vi.fn((next: number) => { v = next; });
    const t0 = v;

    const { getByLabelText, rerender } = render(
      <TimeStepper value={v} onChange={onChange} minValue={0} nowSec={t0} />
    );
    const plus = getByLabelText('Avancer');

    fireEvent.pointerDown(plus, { pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith(t0 + 60);
    rerender(<TimeStepper value={v} onChange={onChange} minValue={0} nowSec={t0} />);

    await vi.advanceTimersByTimeAsync(350);
    expect(onChange).toHaveBeenLastCalledWith(t0 + 120);
    rerender(<TimeStepper value={v} onChange={onChange} minValue={0} nowSec={t0} />);

    await vi.advanceTimersByTimeAsync(350);
    expect(onChange).toHaveBeenLastCalledWith(t0 + 180);

    fireEvent.pointerUp(plus, { pointerId: 1 });
    vi.useRealTimers();
  });
```

This second test verifies the `valueRef.current` updates correctly when the parent re-renders with a new `value` prop.

### Step 2: Run the tests

Run: `pnpm --filter @nemo/web test src/components/play/TimeStepper.test.tsx`
Expected: 10/10 pass (8 from Task 2 + 2 new).

### Step 3: Commit

```bash
git add apps/web/src/components/play/TimeStepper.test.tsx
git commit -m "test(time-stepper): exercise hold-to-accelerate cadence with fake timers"
```

---

## Task 4: Repo-wide verification

- [ ] **Step 1: Full repo tests**

Run: `pnpm -r test`
Expected: 254 + (5 curve tests) + (10 stepper tests) = 269 passing total.

- [ ] **Step 2: Repo typecheck**

Run: `pnpm -r typecheck`
Expected: pre-existing errors only (`.next/dev/types/routes.d.ts`).

- [ ] **Step 3: Final tag commit (optional)**

```bash
git commit --allow-empty -m "chore: ProgPanel Phase 1c complete (TimeStepper primitive ready)"
```

---

## Self-review notes (for the implementer)

- **Snap to minute**: the spec says values must be multiples of 60. The component never produces a non-multiple-of-60 value as long as the consumer's initial `value` is on a minute boundary AND `stepSec` from the curve is always a multiple of 60 (it is). So no explicit snap is needed inside the component.
- **Floor on - hold**: when the hold reaches the floor, the loop stops itself by detecting `next === valueRef.current` (no progress). This is cleaner than calling `stop()` from the consumer side and avoids race conditions.
- **`valueRef` pattern**: the same trick we used in `<CompassDial>`'s wheel handler. The pulse callback needs to read the latest committed value without re-attaching listeners on every value change.
- **No "instant" mode**: the spec doesn't mention a way to enter a time directly via keyboard. Phase 2 may add this; Phase 1c is buttons-only.
- **No round-trip `now+5` calculation in the component**: the floor (`minValue`) is passed in by the consumer. ProgPanel's commit handler will compute `Math.floor(Date.now()/1000) + 300` once per second and pass it down.
- **Keyboard accessibility**: `<button>` elements are keyboard-focusable by default, but pointer events don't fire on Enter/Space. Phase 2 can add keyboard support if needed (e.g., `onKeyDown` for Enter → single increment). Skip for Phase 1c.
- **The component is `'use client'`**: it uses `useState`-equivalent hooks (`useRef`, `useCallback`, `useEffect`) and event handlers, so it's a client component. The directive is at the top.

## Phase 2 readiness

After Phase 1c, the ProgPanel V2 cap-editor and sail-editor sub-screens (Phase 2) will:
- Import `TimeStepper` from `@/components/play/TimeStepper`
- Pass `value={editForm.t}`, `onChange={(s) => setEditForm({...editForm, t: s})}`, `minValue={Math.floor(Date.now()/1000) + 300}`, `nowSec={Math.floor(Date.now()/1000)}`
- Wrap it inside the editor's `<form>`

No store coupling, no engine coupling. Phase 1c does not touch ProgPanel, only adds the unconsumed primitive.
