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

export const MIN_LEAD_TIME_MS = 5 * 60 * 1000;

export type Trigger =
  | { type: 'AT_TIME'; time: number }            // seconds since Unix epoch
  | { type: 'AT_WAYPOINT'; waypointOrderId: string }
  | { type: 'AFTER_DURATION'; duration: number }; // duration in seconds

export interface OrderLike {
  trigger: Trigger;
}

export function isObsolete(
  order: OrderLike,
  nowMs: number,
  passedWaypoints: Set<string>,
): boolean {
  switch (order.trigger.type) {
    case 'AT_TIME':
      return order.trigger.time * 1000 <= nowMs;
    case 'AFTER_DURATION':
      return false;
    case 'AT_WAYPOINT':
      return passedWaypoints.has(order.trigger.waypointOrderId);
  }
}

export function validateLeadTime(
  trigger: Trigger,
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
  }
}
