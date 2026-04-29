import type { OrderEnvelope } from '@nemo/shared-types';
import { replaceUserQueue, type BoatRuntime } from '@nemo/game-engine-core';

export interface ReplaceUserQueueMsg {
  boatId: string;
  envelopes: OrderEnvelope[];
}

/**
 * Pure handler — replaces the target boat's order history (preserving
 * completed envelopes), no I/O, no logging. Returns a new runtimes array
 * with the affected entry rebuilt; other entries are returned by reference.
 *
 * Cf. spec 2026-04-28-progpanel-redesign-design.md Phase 0.
 */
export function handleReplaceUserQueue(
  runtimes: BoatRuntime[],
  msg: ReplaceUserQueueMsg,
): BoatRuntime[] {
  const idx = runtimes.findIndex((r) => r.boat.id === msg.boatId);
  if (idx < 0) return runtimes;
  const rt = runtimes[idx]!;
  const nextHistory = replaceUserQueue(rt.orderHistory, msg.envelopes);
  const next = runtimes.slice();
  next[idx] = { ...rt, orderHistory: nextHistory };
  return next;
}
