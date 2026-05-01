/**
 * <TimeStepper> — pick a time for an order trigger via hold-to-accelerate
 * +/- buttons. Pure, prop-driven, no store.
 *
 * Used by the future ProgPanel order editors (Phase 2). Format: HH:MM
 * absolute + +Xh Ymin relative. Snapped to whole minutes by the consumer.
 * Floor enforced at `minValue`.
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
  value: number;
  onChange: (nextSec: number) => void;
  minValue: number;
  /** Optional ceiling — typically `nowSec + J5_HORIZON_SEC` because the
   *  projection has no GFS coverage past J+5. When `value >= maxValue`
   *  the `+` button locks and a "Plafond" warning is displayed. */
  maxValue?: number;
  nowSec: number;
  className?: string;
}

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

  const startLoop = useCallback((direction: 1 | -1) => {
    let pulse = 1;
    const tick = () => {
      const { stepSec, delayMs } = holdAccelerationCurve(pulse);
      const candidate = valueRef.current + direction * stepSec;
      let next: number;
      if (direction === -1) {
        next = Math.max(candidate, minValue);
        if (next === valueRef.current) {
          stop();
          return;
        }
      } else {
        next = maxValue !== undefined ? Math.min(candidate, maxValue) : candidate;
        if (next === valueRef.current) {
          stop();
          return;
        }
      }
      onChange(next);
      pulse += 1;
      timerRef.current = setTimeout(tick, delayMs);
    };
    tick();
  }, [minValue, maxValue, onChange, stop]);

  const blockMinus = value <= minValue;
  const blockPlus = maxValue !== undefined && value >= maxValue;

  // setPointerCapture may throw in JSDOM — wrap in try/catch defensively.
  const safeCapture = (target: HTMLElement, pointerId: number) => {
    try { target.setPointerCapture(pointerId); } catch { /* JSDOM */ }
  };

  return (
    <div className={`${styles.stepper} ${className ?? ''}`}>
      <button
        type="button"
        className={styles.btn}
        disabled={blockMinus}
        aria-label="Reculer"
        onPointerDown={(e) => {
          if (blockMinus) return;
          safeCapture(e.currentTarget, e.pointerId);
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
        disabled={blockPlus}
        aria-label="Avancer"
        onPointerDown={(e) => {
          if (blockPlus) return;
          safeCapture(e.currentTarget, e.pointerId);
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
      {!blockMinus && blockPlus && (
        <div className={styles.floorWarning}>
          ⛔ Plafond : J+5 (limite météo)
        </div>
      )}
    </div>
  );
}
