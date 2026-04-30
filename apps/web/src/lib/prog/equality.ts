// Typed structural equality for ProgDraft.
//
// Replaces the legacy `JSON.stringify(a) === JSON.stringify(b)` shortcut whose
// equality semantics depend on object key insertion order. Two semantically
// equal drafts produced by different mutators could serialize to different
// strings if a future mutator adds keys in a different order — this module
// performs an explicit, key-by-key, order-sensitive compare on the typed
// schema.
//
// Order-sensitivity is intentional: within each track (capOrders, wpOrders,
// sailOrders) array order carries semantic meaning (chain order for WPs,
// sequence order for CAP/TWA scheduling, etc.). Reordering should be treated
// as a real change.

import type {
  ProgDraft,
  CapOrder,
  WpOrder,
  FinalCapOrder,
  SailOrder,
} from './types';

export function eqCap(a: CapOrder, b: CapOrder): boolean {
  return a.id === b.id
    && a.heading === b.heading
    && a.twaLock === b.twaLock
    && a.trigger.type === b.trigger.type
    && a.trigger.time === b.trigger.time;
}

export function eqWp(a: WpOrder, b: WpOrder): boolean {
  if (a.id !== b.id) return false;
  if (a.lat !== b.lat) return false;
  if (a.lon !== b.lon) return false;
  if (a.captureRadiusNm !== b.captureRadiusNm) return false;
  if (a.trigger.type !== b.trigger.type) return false;
  if (a.trigger.type === 'AT_WAYPOINT' && b.trigger.type === 'AT_WAYPOINT') {
    return a.trigger.waypointOrderId === b.trigger.waypointOrderId;
  }
  return true;
}

export function eqFinalCap(a: FinalCapOrder | null, b: FinalCapOrder | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.id === b.id
    && a.heading === b.heading
    && a.twaLock === b.twaLock
    && a.trigger.waypointOrderId === b.trigger.waypointOrderId;
}

export function eqSail(a: SailOrder, b: SailOrder): boolean {
  if (a.id !== b.id) return false;
  if (a.action.auto !== b.action.auto) return false;
  if (!a.action.auto && !b.action.auto && a.action.sail !== b.action.sail) return false;
  if (a.trigger.type !== b.trigger.type) return false;
  if (a.trigger.type === 'AT_TIME' && b.trigger.type === 'AT_TIME') {
    return a.trigger.time === b.trigger.time;
  }
  if (a.trigger.type === 'AT_WAYPOINT' && b.trigger.type === 'AT_WAYPOINT') {
    return a.trigger.waypointOrderId === b.trigger.waypointOrderId;
  }
  return true;
}

export function eqList<T>(a: T[], b: T[], cmp: (x: T, y: T) => boolean): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!cmp(a[i]!, b[i]!)) return false;
  }
  return true;
}

export function deepEqDraft(a: ProgDraft, b: ProgDraft): boolean {
  // If both drafts have no orders in any track, they're considered equal
  // regardless of mode — switching the mode tab on an empty programming
  // shouldn't mark the panel as dirty (the user hasn't actually authored
  // anything yet).
  const aEmpty = a.capOrders.length === 0
    && a.wpOrders.length === 0
    && a.finalCap === null
    && a.sailOrders.length === 0;
  const bEmpty = b.capOrders.length === 0
    && b.wpOrders.length === 0
    && b.finalCap === null
    && b.sailOrders.length === 0;
  if (aEmpty && bEmpty) return true;

  return a.mode === b.mode
    && eqList(a.capOrders, b.capOrders, eqCap)
    && eqList(a.wpOrders, b.wpOrders, eqWp)
    && eqFinalCap(a.finalCap, b.finalCap)
    && eqList(a.sailOrders, b.sailOrders, eqSail);
}
