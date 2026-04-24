import type { Polar, SailId } from '@nemo/shared-types';
import { getPolarSpeed } from '@nemo/polar-lib/browser';
import { conditionSpeedPenalty, type ConditionState } from './wear';
import { bandFor } from './bands';

/**
 * Minimum loadout/upgrade shape read by the speed model. Both
 * AggregatedEffects (engine-core loadout) and ProjectionEffects
 * (browser projection) satisfy this structurally.
 */
export interface SpeedEffects {
  readonly speedByTwa: readonly number[];
  readonly speedByTws: readonly number[];
}

/**
 * Base speed model shared between the tick engine, the routing engine,
 * and the browser projection worker — single source of truth for the
 * polar × condition × TWA/TWS-band chain.
 *
 * Returns boat speed in knots. Tick-specific transient factors
 * (transition, overlap, manoeuvre, swell) are intentionally excluded
 * so the routing engine can evaluate candidate headings without
 * simulating tick state, and so the projection can layer its own
 * transients on top. Callers MUST NOT re-expand the formula.
 */
export function computeBsp(
  polar: Polar,
  sail: SailId,
  twa: number,
  tws: number,
  effects: SpeedEffects,
  condition: ConditionState,
): number {
  const twaAbs = Math.min(Math.abs(twa), 180);
  const base = getPolarSpeed(polar, sail, twaAbs, tws);
  const condMul = conditionSpeedPenalty(condition);
  const twaBand = bandFor(twaAbs, [60, 90, 120, 150]);
  const twsBand = bandFor(tws, [10, 20]);
  const twaMul = effects.speedByTwa[twaBand]!;
  const twsMul = effects.speedByTws[twsBand]!;
  return base * condMul * twaMul * twsMul;
}
