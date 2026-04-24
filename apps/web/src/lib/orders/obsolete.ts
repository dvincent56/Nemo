/**
 * Helpers for detecting and rejecting obsolete scheduled orders in the
 * ProgPanel. An order is "obsolete" when its trigger is no longer reachable:
 * - AT_TIME: the target timestamp is in the past
 * - AT_WAYPOINT: the waypoint has already been crossed
 * - AFTER_DURATION: never obsolete (relative to its activation moment)
 *
 * `validateLeadTime` is the UI-side form validation, enforced at the
 * "Ajouter à la file" step so no order enters the local queue unless it
 * has at least 5 min of runway.
 */

import type { OrderTrigger } from '@nemo/shared-types';

export const MIN_LEAD_TIME_MS = 5 * 60 * 1000;

/** Local re-export so tests and consumers don't need to reach into shared-types. */
export type Trigger = OrderTrigger;

export interface OrderLike {
  trigger: OrderTrigger;
}

export function isObsolete(
  order: OrderLike,
  nowMs: number,
  passedWaypoints: Set<string>,
): boolean {
  switch (order.trigger.type) {
    case 'AT_TIME':
      return order.trigger.time * 1000 <= nowMs;
    case 'AT_WAYPOINT':
      return passedWaypoints.has(order.trigger.waypointOrderId);
    case 'AFTER_DURATION':
    case 'IMMEDIATE':
    case 'SEQUENTIAL':
      return false;
  }
}

export function validateLeadTime(
  trigger: OrderTrigger,
  nowMs: number,
): { ok: boolean; error?: string } {
  switch (trigger.type) {
    case 'AT_TIME': {
      const leadMs = trigger.time * 1000 - nowMs;
      if (leadMs < MIN_LEAD_TIME_MS) {
        return { ok: false, error: 'Minimum 5 min dans le futur' };
      }
      return { ok: true };
    }
    case 'AFTER_DURATION': {
      if (trigger.duration * 1000 < MIN_LEAD_TIME_MS) {
        return { ok: false, error: 'Minimum 5 min' };
      }
      return { ok: true };
    }
    case 'AT_WAYPOINT':
      return { ok: true };
    // IMMEDIATE / SEQUENTIAL shouldn't flow through form validation (ProgPanel
    // restricts the UI to the three scheduled kinds), but stay safe.
    case 'IMMEDIATE':
    case 'SEQUENTIAL':
      return { ok: true };
  }
}
