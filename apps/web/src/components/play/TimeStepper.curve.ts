/**
 * Hold-to-accelerate curve for the TimeStepper +/- press loop.
 *
 * Each pulse advances the order time by `stepSec` seconds (always 60s = 1 min,
 * no jumps to 5/15/60-min steps) and schedules the next pulse `delayMs`
 * milliseconds later. The delay shrinks smoothly so a sustained hold goes
 * from "1 min/350ms" up to "1 min/15ms" (~67 minutes per second of hold).
 * Pulse counter starts at 1 on pointer-down; resets on pointer-up / leave /
 * cancel.
 *
 * Cf. spec `docs/superpowers/specs/2026-04-28-progpanel-redesign-design.md`
 * (Time logic & obsolescence section).
 */

export interface CurvePulse {
  stepSec: number;
  delayMs: number;
}

export function holdAccelerationCurve(pulse: number): CurvePulse {
  const stepSec = 60;
  if (pulse < 4) return { stepSec, delayMs: 350 };   // first 3 pulses ≈ 1 min/sec
  if (pulse < 8) return { stepSec, delayMs: 200 };
  if (pulse < 14) return { stepSec, delayMs: 100 };
  if (pulse < 22) return { stepSec, delayMs: 50 };
  if (pulse < 30) return { stepSec, delayMs: 25 };
  return { stepSec, delayMs: 15 };                    // ~67 min/sec at max
}
