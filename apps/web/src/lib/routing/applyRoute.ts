// Pure conversion helpers turning a RoutePlan into the OrderEntry[] shape
// expected by progSlice.replaceOrderQueue. Two output flavors:
//   - capScheduleToOrders: time-triggered CAP/TWA sequence (auto-sail mode)
//   - waypointsToOrders:   AT_WAYPOINT-chained WPT sequence
// Both prepend a MODE(auto:true) order so the boat is in sail-auto when the
// schedule starts — the engine then picks the optimal sail itself per polar,
// so no SAIL orders are emitted. No I/O, no side effects — easy to unit-test.

import type { RoutePlan } from '@nemo/routing';
import type { OrderEntry } from '@/lib/store/types';

let counter = 0;
function uid(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}`;
}

export function capScheduleToOrders(plan: RoutePlan, _baseTs: number): OrderEntry[] {
  const orders: OrderEntry[] = [];
  // Always force sailAuto on first — auto-sail mode means the engine selects
  // the optimal sail from the polar; emitting SAIL orders alongside would be
  // contradictory (and clutter ProgPanel).
  orders.push({
    id: uid('mode'),
    type: 'MODE',
    value: { auto: true },
    trigger: { type: 'IMMEDIATE' },
    label: 'Voile auto ON',
    committed: true,
  });

  for (const entry of plan.capSchedule) {
    // CapScheduleEntry.triggerMs is an *absolute* Unix-ms timestamp (it is
    // copied from RoutePolylinePoint.timeMs which inherits IsochronePoint
    // .timeMs, seeded with `input.startTimeMs = Date.now()` and advanced
    // by `timeStepSec * 1000`). OrderTrigger.time is Unix seconds, so we
    // just divide. Adding `baseTs` here (a previous attempt to convert a
    // *relative* offset) doubled the timestamp into year ~4172, pushing
    // every CAP/TWA segment past the projection's 5-day horizon — the
    // worker never triggered them and the projection rendered as a
    // straight line at the initial heading.
    const triggerTimeSec = entry.triggerMs / 1000;
    if (entry.twaLock !== undefined && entry.twaLock !== null) {
      orders.push({
        id: uid('twa'),
        type: 'TWA',
        value: { twa: entry.twaLock },
        trigger: { type: 'AT_TIME', time: triggerTimeSec },
        label: `TWA ${Math.round(entry.twaLock)}°`,
        committed: true,
      });
    } else {
      orders.push({
        id: uid('cap'),
        type: 'CAP',
        value: { cap: entry.cap },
        trigger: { type: 'AT_TIME', time: triggerTimeSec },
        label: `CAP ${Math.round(entry.cap)}°`,
        committed: true,
      });
    }
  }
  return orders;
}

export function waypointsToOrders(plan: RoutePlan, _baseTs: number): OrderEntry[] {
  const orders: OrderEntry[] = [];
  orders.push({
    id: uid('mode'),
    type: 'MODE',
    value: { auto: true },
    trigger: { type: 'IMMEDIATE' },
    label: 'Voile auto ON',
    committed: true,
  });
  // Skip waypoints[0] — that's the boat's start position
  let prevId: string | null = null;
  for (let i = 1; i < plan.waypoints.length; i++) {
    const wp = plan.waypoints[i]!;
    const id = uid('wpt');
    orders.push({
      id,
      type: 'WPT',
      value: { lat: wp.lat, lon: wp.lon, captureRadiusNm: 0.5 },
      trigger: prevId ? { type: 'AT_WAYPOINT', waypointOrderId: prevId } : { type: 'IMMEDIATE' },
      label: `WPT ${wp.lat.toFixed(2)}°·${wp.lon.toFixed(2)}°`,
      committed: true,
    });
    prevId = id;
  }
  return orders;
}
