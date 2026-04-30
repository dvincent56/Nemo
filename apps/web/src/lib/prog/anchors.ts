import type { ProgDraft } from './types';

/** Floor offset — orders with trigger.time < now + 5min are obsolete. */
export const FLOOR_OFFSET_SEC = 5 * 60;

/** Default offset from the reference (latest order, or now). Always +10min. */
export const DEFAULT_OFFSET_SEC = 10 * 60;

/**
 * Default trigger time for a NEW cap order. Always returns
 * `reference + 10min`, where reference is the latest cap order's time
 * if any, else `nowSec`.
 *
 * Cf. spec `docs/superpowers/specs/2026-04-28-progpanel-redesign-design.md`
 * (Time logic — Heure par défaut section).
 */
export function defaultCapAnchor(draft: ProgDraft, nowSec: number): number {
  if (draft.capOrders.length === 0) return nowSec + DEFAULT_OFFSET_SEC;
  const latest = draft.capOrders.reduce((max, o) => Math.max(max, o.trigger.time), 0);
  return latest + DEFAULT_OFFSET_SEC;
}

/**
 * Default trigger time for a NEW AT_TIME sail order. AT_WAYPOINT sail orders
 * are ignored when computing the "latest" (they don't have a comparable time).
 * Always returns `reference + 10min`, where reference is the latest AT_TIME
 * sail order's time if any, else `nowSec`.
 */
export function defaultSailAnchor(draft: ProgDraft, nowSec: number): number {
  let latest = 0;
  for (const o of draft.sailOrders) {
    if (o.trigger.type === 'AT_TIME' && o.trigger.time > latest) {
      latest = o.trigger.time;
    }
  }
  if (latest === 0) return nowSec + DEFAULT_OFFSET_SEC;
  return latest + DEFAULT_OFFSET_SEC;
}

/**
 * True when an AT_TIME trigger is below the floor (now + 5min).
 * AT_WAYPOINT and IMMEDIATE triggers are never obsolete by this definition.
 */
export function isObsoleteAtTime(
  trigger:
    | { type: 'AT_TIME'; time: number }
    | { type: 'AT_WAYPOINT'; waypointOrderId: string }
    | { type: 'IMMEDIATE' },
  nowSec: number,
): boolean {
  if (trigger.type !== 'AT_TIME') return false;
  return trigger.time < nowSec + FLOOR_OFFSET_SEC;
}

/**
 * Floor for the TimeStepper minValue prop — the absolute earliest time
 * an order can trigger.
 */
export function floorForNow(nowSec: number): number {
  return nowSec + FLOOR_OFFSET_SEC;
}
