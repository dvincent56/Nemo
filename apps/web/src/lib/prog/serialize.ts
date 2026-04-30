import type { ProgDraft } from './types';

/**
 * Wire-format order shape. Mirrors `OrderEntry` from `lib/store/types`
 * and the `ReplaceQueueOrderInput` from `lib/store/index.ts:sendOrderReplaceQueue`.
 *
 * The serializer produces objects of this shape ready for sendOrderReplaceQueue.
 */
export interface WireOrder {
  id: string;
  type: 'CAP' | 'TWA' | 'WPT' | 'SAIL' | 'MODE' | 'VMG';
  value: Record<string, unknown>;
  trigger:
    | { type: 'IMMEDIATE' }
    | { type: 'AT_TIME'; time: number }
    | { type: 'AT_WAYPOINT'; waypointOrderId: string };
}

/**
 * Serializes a typed ProgDraft to the wire-format OrderEntry array used by
 * the ws-gateway's ORDER_REPLACE_QUEUE message (Phase 0).
 *
 * Mode-aware filtering: only the active mode's track is sent. In `'cap'`
 * mode, `wpOrders`/`finalCap` and AT_WAYPOINT-triggered sail orders are
 * dropped (they reference WPs that aren't being committed). In `'wp'` mode,
 * `capOrders` are dropped. AT_TIME sail orders survive in either mode.
 * This lets `setProgMode` be a soft toggle in the UI: both tracks coexist
 * in the draft, only the active one reaches the wire / committed.
 *
 * Output ordering: capOrders → wpOrders → finalCap → sailOrders. The engine
 * does not require a specific order (it dedups + applies based on triggers),
 * but consistent ordering helps debug logs.
 *
 * Cf. spec `docs/superpowers/specs/2026-04-28-progpanel-redesign-design.md`
 * (Sérialisation wire section).
 */
export function serializeDraft(draft: ProgDraft): WireOrder[] {
  const out: WireOrder[] = [];

  if (draft.mode === 'cap') {
    for (const cap of draft.capOrders) {
      out.push({
        id: cap.id,
        type: cap.twaLock ? 'TWA' : 'CAP',
        value: cap.twaLock ? { twa: cap.heading } : { heading: cap.heading },
        trigger: cap.trigger,
      });
    }
  } else {
    for (const wp of draft.wpOrders) {
      out.push({
        id: wp.id,
        type: 'WPT',
        value: { lat: wp.lat, lon: wp.lon, captureRadiusNm: wp.captureRadiusNm },
        trigger: wp.trigger,
      });
    }

    if (draft.finalCap) {
      const fc = draft.finalCap;
      out.push({
        id: fc.id,
        type: fc.twaLock ? 'TWA' : 'CAP',
        value: fc.twaLock ? { twa: fc.heading } : { heading: fc.heading },
        trigger: fc.trigger,
      });
    }
  }

  for (const sail of draft.sailOrders) {
    // AT_WAYPOINT sails reference a WP that won't exist on the wire in cap
    // mode — drop them. AT_TIME sails are independent and survive either way.
    if (draft.mode === 'cap' && sail.trigger.type === 'AT_WAYPOINT') continue;
    out.push({
      id: sail.id,
      type: sail.action.auto ? 'MODE' : 'SAIL',
      value: sail.action.auto ? { auto: true } : { sail: sail.action.sail },
      trigger: sail.trigger,
    });
  }

  return out;
}
