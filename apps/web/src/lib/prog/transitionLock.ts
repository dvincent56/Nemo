import { GameBalance } from '@nemo/game-balance/browser';
import type { SailId } from '@nemo/shared-types';
import type { ProgDraft } from './types';

/** Default transition duration (seconds) when no specific pair is configured. */
const DEFAULT_TRANSITION_SEC = 180;

/**
 * Look up the transition duration (seconds) for a sail change `from → to`
 * from `game-balance.json` (`sails.transitionTimes`). Falls back to
 * {@link DEFAULT_TRANSITION_SEC} when the pair is missing. Same-sail returns 0.
 *
 * Mirrors `getTransitionDuration` in `SailPanel.tsx` and the engine's polar
 * lib — sourcing from `GameBalance` keeps a single source of truth.
 */
export function getTransitionDurationSec(from: SailId, to: SailId): number {
  if (from === to) return 0;
  const tt = (GameBalance.sails as { transitionTimes?: Record<string, number> } | undefined)
    ?.transitionTimes;
  if (!tt) return DEFAULT_TRANSITION_SEC;
  const key = `${from}_${to}`;
  return tt[key] ?? DEFAULT_TRANSITION_SEC;
}

/**
 * Compute the earliest time (unix seconds) at which a NEW sail order can fire
 * without overlapping the transition of a prior AT_TIME sail order in the
 * same draft.
 *
 * The constraint is: each previous sail order at time `T` with transition
 * duration `D` occupies the interval `[T, T + D]`. Another sail order can
 * only fire at time `>= T + D`.
 *
 * Walks AT_TIME sail orders in chronological order, simulating the boat's
 * sail through each transition to compute the running busy floor.
 *
 * - `auto: true` orders: the engine picks the optimal sail dynamically; we
 *   optimistically assume the active sail stays the same so no extra
 *   transition cost is added. The lockout's main use case is back-to-back
 *   manual changes; auto chains are rare in practice.
 * - Orders that already overlap the previous transition are skipped (the
 *   user is expected to fix them — the slot floor is computed only from
 *   non-overlapping orders).
 *
 * @param draft Current draft.
 * @param currentSail The boat's sail right now (live from `sailSlice.currentSail`).
 * @param excludeId Order ID to ignore (when editing an existing one).
 * @param nowSec Current unix time in seconds (also acts as the lower floor).
 */
export function earliestSailSlot(
  draft: ProgDraft,
  currentSail: SailId,
  excludeId: string | null,
  nowSec: number,
): number {
  const sortedAtTime = draft.sailOrders
    .filter((s) => s.id !== excludeId && s.trigger.type === 'AT_TIME')
    .sort(
      (a, b) =>
        (a.trigger as { time: number }).time - (b.trigger as { time: number }).time,
    );

  if (sortedAtTime.length === 0) return nowSec;

  let activeSail: SailId = currentSail;
  let busyUntil = nowSec;

  for (const order of sortedAtTime) {
    const trigger = order.trigger as { time: number };
    if (trigger.time < busyUntil) {
      // This order overlaps the previous transition — already a violation.
      // Skip it for slot computation; the user is expected to fix it.
      continue;
    }
    const targetSail = order.action.auto ? activeSail : order.action.sail;
    const dur = getTransitionDurationSec(activeSail, targetSail);
    busyUntil = trigger.time + dur;
    activeSail = targetSail;
  }

  return busyUntil;
}
