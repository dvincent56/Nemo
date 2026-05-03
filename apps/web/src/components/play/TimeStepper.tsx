/**
 * <TimeStepper> — pick a time for an order trigger via hold-to-accelerate
 * +/- buttons. Pure, prop-driven, no store.
 *
 * Used by the future ProgPanel order editors (Phase 2). Format: HH:MM
 * absolute + +Xh Ymin relative. Snapped to whole minutes by the consumer.
 * Floor enforced at `minValue`, ceiling at optional `maxValue`.
 *
 * Layout: 4 buttons + display.
 *   [ ─h ] [ −m ] [ display ] [ +m ] [ +h ]
 * - Minute buttons (smaller): 1 min/pulse with the existing accelerating
 *   delay curve (350 → 15 ms across the hold) — fine-grained tuning.
 * - Hour buttons (larger): 1 hour/pulse at a constant 400 ms delay — coarse
 *   stepping without acceleration so a long hold doesn't shoot past the
 *   J+5 ceiling instantly.
 *
 * Cf. spec `docs/superpowers/specs/2026-04-28-progpanel-redesign-design.md`.
 */

'use client';

import { useCallback, useEffect, useRef, type ReactElement } from 'react';
import { Minus, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { holdAccelerationCurve } from './TimeStepper.curve';
import styles from './TimeStepper.module.css';

export interface TimeStepperProps {
  value: number;
  onChange: (nextSec: number) => void;
  minValue: number;
  /** Optional ceiling — typically `nowSec + J5_HORIZON_SEC` because the
   *  projection has no GFS coverage past J+5. When `value >= maxValue`
   *  the `+` buttons lock and a "Plafond" warning is displayed. */
  maxValue?: number;
  nowSec: number;
  className?: string;
}

const HOUR_STEP_SEC = 3600;
const HOUR_DELAY_MS = 400;

function formatAbsolute(sec: number): string {
  // Display the player's wall-clock time, not UTC. `sec` is a Unix timestamp,
  // and `Date#getHours()` / `getMinutes()` return values in the local TZ —
  // so a French player in summer (CEST = UTC+2) sees 14:00 for a Unix epoch
  // representing 12:00 UTC instead of the previous misleading "12:00".
  const d = new Date(sec * 1000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatRelative(sec: number, nowSec: number): string {
  const dSec = sec - nowSec;
  const dMin = Math.floor(dSec / 60);
  if (dMin < 0) return `${dMin}min`;
  if (dMin < 60) return `+${dMin}min`;
  const h = Math.floor(dMin / 60);
  const m = dMin % 60;
  return m === 0 ? `+${h}h` : `+${h}h ${m}min`;
}

export default function TimeStepper({
  value,
  onChange,
  minValue,
  maxValue,
  nowSec,
  className,
}: TimeStepperProps): ReactElement {
  const t = useTranslations('play.timeStepper');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const valueRef = useRef(value);
  useEffect(() => { valueRef.current = value; }, [value]);

  const stop = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => () => stop(), [stop]);

  // Clamp the candidate to [minValue, maxValue]. Returns the actual next
  // value AND whether it differs from the current value. When clamped to a
  // boundary that we've already reached, the loop must stop (otherwise it
  // would tick forever at the same value).
  const clamp = useCallback((candidate: number, direction: 1 | -1): number => {
    if (direction === -1) return Math.max(candidate, minValue);
    return maxValue !== undefined ? Math.min(candidate, maxValue) : candidate;
  }, [minValue, maxValue]);

  // Minute loop — accelerating delay (350 → 15 ms) via holdAccelerationCurve.
  const startMinuteLoop = useCallback((direction: 1 | -1) => {
    let pulse = 1;
    const tick = () => {
      const { stepSec, delayMs } = holdAccelerationCurve(pulse);
      const next = clamp(valueRef.current + direction * stepSec, direction);
      if (next === valueRef.current) { stop(); return; }
      onChange(next);
      pulse += 1;
      timerRef.current = setTimeout(tick, delayMs);
    };
    tick();
  }, [clamp, onChange, stop]);

  // Hour loop — fixed 1h step, fixed 400 ms delay. No acceleration: a long
  // hold should not blow past the J+5 ceiling in a fraction of a second.
  const startHourLoop = useCallback((direction: 1 | -1) => {
    const tick = () => {
      const next = clamp(valueRef.current + direction * HOUR_STEP_SEC, direction);
      if (next === valueRef.current) { stop(); return; }
      onChange(next);
      timerRef.current = setTimeout(tick, HOUR_DELAY_MS);
    };
    tick();
  }, [clamp, onChange, stop]);

  const blockMinus = value <= minValue;
  const blockPlus = maxValue !== undefined && value >= maxValue;
  // Hour buttons block on the same boundaries as the minute buttons — once
  // value === minValue / maxValue, no direction has room to move regardless
  // of step size.

  // setPointerCapture may throw in JSDOM — wrap in try/catch defensively.
  const safeCapture = (target: HTMLElement, pointerId: number) => {
    try { target.setPointerCapture(pointerId); } catch { /* JSDOM */ }
  };

  return (
    <div className={`${styles.stepper} ${className ?? ''}`}>
      <button
        type="button"
        className={styles.btnHour}
        disabled={blockMinus}
        aria-label={t('back1h')}
        onPointerDown={(e) => {
          if (blockMinus) return;
          safeCapture(e.currentTarget, e.pointerId);
          startHourLoop(-1);
        }}
        onPointerUp={stop}
        onPointerLeave={stop}
        onPointerCancel={stop}
      >
        <Minus size={22} strokeWidth={2.5} />
        <span className={styles.btnUnit}>{t('unitH')}</span>
      </button>

      <button
        type="button"
        className={styles.btnMin}
        disabled={blockMinus}
        aria-label={t('back1m')}
        onPointerDown={(e) => {
          if (blockMinus) return;
          safeCapture(e.currentTarget, e.pointerId);
          startMinuteLoop(-1);
        }}
        onPointerUp={stop}
        onPointerLeave={stop}
        onPointerCancel={stop}
      >
        <Minus size={16} strokeWidth={2.5} />
        <span className={styles.btnUnit}>{t('unitM')}</span>
      </button>

      <div className={styles.display}>
        <div className={styles.absolute}>{formatAbsolute(value)}</div>
        <div className={styles.relative}>{formatRelative(value, nowSec)}</div>
      </div>

      <button
        type="button"
        className={styles.btnMin}
        disabled={blockPlus}
        aria-label={t('fwd1m')}
        onPointerDown={(e) => {
          if (blockPlus) return;
          safeCapture(e.currentTarget, e.pointerId);
          startMinuteLoop(1);
        }}
        onPointerUp={stop}
        onPointerLeave={stop}
        onPointerCancel={stop}
      >
        <Plus size={16} strokeWidth={2.5} />
        <span className={styles.btnUnit}>{t('unitM')}</span>
      </button>

      <button
        type="button"
        className={styles.btnHour}
        disabled={blockPlus}
        aria-label={t('fwd1h')}
        onPointerDown={(e) => {
          if (blockPlus) return;
          safeCapture(e.currentTarget, e.pointerId);
          startHourLoop(1);
        }}
        onPointerUp={stop}
        onPointerLeave={stop}
        onPointerCancel={stop}
      >
        <Plus size={22} strokeWidth={2.5} />
        <span className={styles.btnUnit}>{t('unitH')}</span>
      </button>

      {blockMinus && (
        <div className={styles.floorWarning}>
          {t('floorMin')}
        </div>
      )}
      {!blockMinus && blockPlus && (
        <div className={styles.floorWarning}>
          {t('floorMax')}
        </div>
      )}
    </div>
  );
}
