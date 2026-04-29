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
 * Output ordering: capOrders → wpOrders → finalCap → sailOrders. The engine
 * does not require a specific order (it dedups + applies based on triggers),
 * but consistent ordering helps debug logs.
 *
 * Cf. spec `docs/superpowers/specs/2026-04-28-progpanel-redesign-design.md`
 * (Sérialisation wire section).
 */
export function serializeDraft(draft: ProgDraft): WireOrder[] {
  const out: WireOrder[] = [];

  for (const cap of draft.capOrders) {
    out.push({
      id: cap.id,
      type: cap.twaLock ? 'TWA' : 'CAP',
      value: cap.twaLock ? { twa: cap.heading } : { heading: cap.heading },
      trigger: cap.trigger,
    });
  }

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

  for (const sail of draft.sailOrders) {
    out.push({
      id: sail.id,
      type: sail.action.auto ? 'MODE' : 'SAIL',
      value: sail.action.auto ? { auto: true } : { sail: sail.action.sail },
      trigger: sail.trigger,
    });
  }

  return out;
}
