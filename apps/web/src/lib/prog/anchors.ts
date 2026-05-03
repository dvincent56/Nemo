import type { ProgDraft } from './types';

/** Floor offset — orders with trigger.time < now + 5min are obsolete. */
export const FLOOR_OFFSET_SEC = 5 * 60;

/** Default offset from the reference (latest order, or now). Always +10min. */
export const DEFAULT_OFFSET_SEC = 10 * 60;

/**
 * Programming horizon — players cannot schedule orders past now + J+5.
 * The projection has no GFS coverage past day 5 (cf. PlayClient's
 * `forecastEndMs` which already caps at 5 days for the timeline), so any
 * AT_TIME order past this window would land on a guessed wind.
 */
export const J5_HORIZON_SEC = 5 * 24 * 3600;

/**
 * Ceiling for the TimeStepper maxValue prop — the absolute latest time an
 * order can trigger.
 */
export function ceilingForNow(nowSec: number): number {
  return nowSec + J5_HORIZON_SEC;
}

/**
 * Default trigger time for a NEW cap order. Always returns
 * `reference + 10min`, where reference is the latest cap order's time
 * if any, else `nowSec`.
 *
 * Cf. spec `docs/superpowers/specs/2026-04-28-progpanel-redesign-design.md`
 * (Time logic — Heure par défaut section).
 */
export function defaultCapAnchor(draft: ProgDraft, nowSec: number): number {
  const ceiling = ceilingForNow(nowSec);
  if (draft.capOrders.length === 0) {
    return Math.min(nowSec + DEFAULT_OFFSET_SEC, ceiling);
  }
  const latest = draft.capOrders.reduce((max, o) => Math.max(max, o.trigger.time), 0);
  return Math.min(latest + DEFAULT_OFFSET_SEC, ceiling);
}

/**
 * Default trigger time for a NEW AT_TIME sail order. AT_WAYPOINT sail orders
 * are ignored when computing the "latest" (they don't have a comparable time).
 * Always returns `reference + 10min`, where reference is the latest AT_TIME
 * sail order's time if any, else `nowSec`.
 */
export function defaultSailAnchor(draft: ProgDraft, nowSec: number): number {
  const ceiling = ceilingForNow(nowSec);
  let latest = 0;
  for (const o of draft.sailOrders) {
    if (o.trigger.type === 'AT_TIME' && o.trigger.time > latest) {
      latest = o.trigger.time;
    }
  }
  if (latest === 0) return Math.min(nowSec + DEFAULT_OFFSET_SEC, ceiling);
  return Math.min(latest + DEFAULT_OFFSET_SEC, ceiling);
}

/**
 * True when an AT_TIME trigger is in the past (already fired by the engine).
 * AT_WAYPOINT and IMMEDIATE triggers are never obsolete by this definition.
 *
 * The 5-min floor (`FLOOR_OFFSET_SEC`) only applies to *creating* new orders
 * (cf. `floorForNow`). Existing orders within now..now+5min are imminent but
 * still going to fire normally — they are NOT obsolete. Past orders are
 * pruned automatically by PlayClient's prog tick so they don't linger in
 * the queue/projection.
 */
export function isObsoleteAtTime(
  trigger:
    | { type: 'AT_TIME'; time: number }
    | { type: 'AT_WAYPOINT'; waypointOrderId: string }
    | { type: 'IMMEDIATE' },
  nowSec: number,
): boolean {
  if (trigger.type !== 'AT_TIME') return false;
  return trigger.time < nowSec;
}

/**
 * Floor for the TimeStepper minValue prop — the absolute earliest time
 * an order can trigger.
 */
export function floorForNow(nowSec: number): number {
  return nowSec + FLOOR_OFFSET_SEC;
}
