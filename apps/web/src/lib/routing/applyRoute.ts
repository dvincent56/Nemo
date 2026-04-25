// Pure conversion helpers turning a RoutePlan into the OrderEntry[] shape
// expected by progSlice.replaceOrderQueue. Two output flavors:
//   - capScheduleToOrders: time-triggered CAP/TWA/SAIL sequence (autopilot mode)
//   - waypointsToOrders:   AT_WAYPOINT-chained WPT sequence
// Both prepend a MODE(auto:true) order so the boat is in sail-auto when the
// schedule starts. No I/O, no side effects — easy to unit-test.

import type { RoutePlan } from '@nemo/routing';
import type { OrderEntry } from '@/lib/store/types';

let counter = 0;
function uid(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}`;
}

export function capScheduleToOrders(plan: RoutePlan, baseTs: number): OrderEntry[] {
  const orders: OrderEntry[] = [];
  // Always force sailAuto on first
  orders.push({
    id: uid('mode'),
    type: 'MODE',
    value: { auto: true },
    trigger: { type: 'IMMEDIATE' },
    label: 'Voile auto ON',
  });

  let prevSail: string | null = null;
  for (const entry of plan.capSchedule) {
    const triggerTimeSec = (baseTs + entry.triggerMs) / 1000;
    if (entry.sail && entry.sail !== prevSail) {
      orders.push({
        id: uid('sail'),
        type: 'SAIL',
        value: { sail: entry.sail },
        trigger: { type: 'AT_TIME', time: triggerTimeSec },
        label: `Voile ${entry.sail}`,
      });
      prevSail = entry.sail;
    }
    if (entry.twaLock !== undefined && entry.twaLock !== null) {
      orders.push({
        id: uid('twa'),
        type: 'TWA',
        value: { twa: entry.twaLock },
        trigger: { type: 'AT_TIME', time: triggerTimeSec },
        label: `TWA ${entry.twaLock}°`,
      });
    } else {
      orders.push({
        id: uid('cap'),
        type: 'CAP',
        value: { cap: entry.cap },
        trigger: { type: 'AT_TIME', time: triggerTimeSec },
        label: `CAP ${Math.round(entry.cap)}°`,
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
    });
    prevId = id;
  }
  return orders;
}
