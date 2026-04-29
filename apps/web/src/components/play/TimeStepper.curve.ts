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
