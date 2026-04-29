// Pure conversion helpers turning a RoutePlan into the typed `ProgDraft`
// shape consumed by progSlice / `applyRouteAsCommitted`. Two output flavors:
//   - capScheduleToProgDraft: time-triggered CAP/TWA sequence (auto-sail mode)
//   - waypointsToProgDraft:   AT_WAYPOINT-chained WP sequence
// Both prepend a sail order with `action: { auto: true }` so the boat is in
// sail-auto when the schedule starts — the engine then picks the optimal sail
// itself per polar, so no per-sail orders are emitted. The MODE order is
// omitted when the boat is already in sail-auto mode (sailAutoAlready=true)
// to avoid a redundant entry cluttering the order queue/ProgPanel.
//
// History: a previous revision exposed flat `OrderEntry[]` producers
// (`capScheduleToOrders` / `waypointsToOrders`). They were dropped in
// Phase 2b once production exclusively consumed the `*ToProgDraft` factories.

import type { RoutePlan } from '@nemo/routing';
import type { ProgDraft, CapOrder, WpOrder, SailOrder } from '@/lib/prog/types';
import { haversinePosNM } from '@/lib/geo';

/**
 * Minimum allowed distance (nautical miles) between an emitted WP and the
 * boat's current position. RoutePlan.waypoints are inflection points produced
 * by the router's polyline-to-waypoints reduction — when the very first
 * inflection is a tiny heading nudge right at the start, it lands within a
 * fraction of a nm of the boat. Emitting it as "WP 1" surfaces a useless
 * order (the boat is essentially already there) and pollutes the queue. This
 * threshold drops any such co-located waypoints up front.
 */
const MIN_WP_DISTANCE_NM = 1;

let counter = 0;
function uid(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}`;
}

// ---------------------------------------------------------------------------
// Typed ProgDraft factories (Phase 2a Task 4)
//
// These produce the typed ProgDraft shape consumed by progSlice
// (capOrders / wpOrders / finalCap / sailOrders).
// ---------------------------------------------------------------------------

export function capScheduleToProgDraft(
  plan: RoutePlan,
  sailAutoAlready: boolean,
): ProgDraft {
  const sailOrders: SailOrder[] = [];
  if (!sailAutoAlready) {
    sailOrders.push({
      id: uid('mode'),
      trigger: { type: 'AT_TIME', time: Math.floor(Date.now() / 1000) },
      action: { auto: true },
    });
  }

  const capOrders: CapOrder[] = [];
  for (const entry of plan.capSchedule) {
    // CapScheduleEntry.triggerMs is an absolute Unix-ms timestamp (it is
    // copied from RoutePolylinePoint.timeMs which inherits IsochronePoint
    // .timeMs, seeded with `input.startTimeMs = Date.now()` and advanced
    // by `timeStepSec * 1000`). OrderTrigger.time is Unix seconds, so we
    // floor-divide by 1000.
    const triggerTimeSec = Math.floor(entry.triggerMs / 1000);
    if (entry.twaLock !== undefined && entry.twaLock !== null) {
      // Round to integer degrees so engine computes on the same value the UI
      // displays. Same rationale as Compass.tsx — fractional TWA from grid
      // interpolation otherwise leaks into engine-side calculations.
      capOrders.push({
        id: uid('twa'),
        trigger: { type: 'AT_TIME', time: triggerTimeSec },
        heading: Math.round(entry.twaLock),
        twaLock: true,
      });
    } else {
      capOrders.push({
        id: uid('cap'),
        trigger: { type: 'AT_TIME', time: triggerTimeSec },
        heading: Math.round(entry.cap),
        twaLock: false,
      });
    }
  }

  return { mode: 'cap', capOrders, wpOrders: [], finalCap: null, sailOrders };
}

export function waypointsToProgDraft(
  plan: RoutePlan,
  sailAutoAlready: boolean,
): ProgDraft {
  const sailOrders: SailOrder[] = [];
  if (!sailAutoAlready) {
    sailOrders.push({
      id: uid('mode'),
      trigger: { type: 'AT_TIME', time: Math.floor(Date.now() / 1000) },
      action: { auto: true },
    });
  }

  const wpOrders: WpOrder[] = [];
  // Skip waypoints[0] — that's the boat's start position. Also drop any
  // following waypoint that lies within MIN_WP_DISTANCE_NM of the start
  // (router inflections occasionally produce a tiny heading nudge a few
  // hundred metres from the origin that's indistinguishable from the boat
  // position from the player's POV).
  const start = plan.waypoints[0];
  let prevId: string | null = null;
  for (let i = 1; i < plan.waypoints.length; i++) {
    const wp = plan.waypoints[i]!;
    if (start && haversinePosNM(start, wp) < MIN_WP_DISTANCE_NM) continue;
    const id = uid('wpt');
    wpOrders.push({
      id,
      trigger: prevId
        ? { type: 'AT_WAYPOINT', waypointOrderId: prevId }
        : { type: 'IMMEDIATE' },
      lat: wp.lat,
      lon: wp.lon,
      captureRadiusNm: 0.5,
    });
    prevId = id;
  }

  return { mode: 'wp', capOrders: [], wpOrders, finalCap: null, sailOrders };
}
