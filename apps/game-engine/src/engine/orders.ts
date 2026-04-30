import { randomUUID } from 'node:crypto';
import type { Order, OrderTrigger, OrderType, Position, SailId } from '@nemo/shared-types';
import { haversineNM } from '@nemo/polar-lib';

export interface OrderContext {
  boatId: string;
  position: Position;
  heading: number;
  activeWaypoint: Position | null;
  nowUnix: number;
}

export interface OrderRuntime extends Order {
  activatedAt?: number;
  completed?: boolean;
}

export type OrderQueue = OrderRuntime[];

// Meter-level WP capture (~1.85m). Matches packages/game-engine-core/src/geo.ts
// WPT_DEFAULT_CAPTURE_NM and Virtual Regatta tactical precision.
const WPT_REACHED_NM = 0.001;

/**
 * Test de déclenchement d'un ordre en file d'attente.
 * Règles (addendum V3 §4.2) :
 *   - IMMEDIATE         : toujours vrai (slot 0 dès insertion).
 *   - SEQUENTIAL        : vrai dès que le slot précédent est actif.
 *   - AT_TIME(t)        : vrai si now >= t.
 *   - AT_WAYPOINT(id)   : vrai quand l'ordre WPT référencé est complété.
 *   - AFTER_DURATION(d) : vrai si now >= current.activatedAt + d.
 */
export function shouldTrigger(
  trigger: OrderTrigger,
  current: OrderRuntime | undefined,
  queue: OrderQueue,
  ctx: OrderContext,
): boolean {
  switch (trigger.type) {
    case 'IMMEDIATE': return true;
    case 'SEQUENTIAL': return current?.activatedAt !== undefined;
    case 'AT_TIME': return ctx.nowUnix >= trigger.time;
    case 'AT_WAYPOINT': {
      const ref = queue.find((o) => o.id === trigger.waypointOrderId);
      return ref?.completed === true;
    }
    case 'AFTER_DURATION': {
      if (!current?.activatedAt) return false;
      return ctx.nowUnix >= current.activatedAt + trigger.duration;
    }
  }
}

/**
 * Insertion d'un ordre direct en tête : si l'ordre actif est du même type,
 * il est remplacé ; sinon, insertion en position 0 (addendum V3 §4.3).
 */
export function insertDirectOrder(order: OrderRuntime, queue: OrderQueue): OrderQueue {
  if (queue.length > 0 && queue[0]!.type === order.type) {
    const copy = queue.slice();
    copy[0] = order;
    return copy;
  }
  return [order, ...queue];
}

export function createOrder(type: OrderType, value: Record<string, unknown>, trigger: OrderTrigger): OrderRuntime {
  return { id: randomUUID(), type, value, trigger };
}

export interface OrderResolution {
  queue: OrderQueue;
  activeHeading?: number;
  activeTwa?: number;
  activeSailId?: SailId;
  sailModeToggle?: boolean;
  vmgDir?: 'UPWIND' | 'DOWNWIND';
  waypoint?: Position | null;
}

/**
 * Avance la file d'ordres d'un tick : active le suivant si son trigger est prêt,
 * marque les WPT complétés quand le bateau arrive, puis renvoie les effets à
 * appliquer par le tick principal.
 */
export function tickOrderQueue(queue: OrderQueue, ctx: OrderContext): OrderResolution {
  let q: OrderQueue = queue.map((o) => ({ ...o }));

  // Complétion du WPT actif si le bateau y est arrivé.
  const active = q[0];
  if (active?.type === 'WPT' && !active.completed) {
    const wpt = active.value as { lat: number; lon: number };
    if (haversineNM(ctx.position, wpt) < WPT_REACHED_NM) {
      active.completed = true;
      q = q.slice(1).concat(active);
    }
  }

  // Activation du slot courant.
  if (q.length > 0 && q[0]!.activatedAt === undefined) {
    const slot = q[0]!;
    if (shouldTrigger(slot.trigger, undefined, q, ctx)) {
      slot.activatedAt = ctx.nowUnix;
    }
  }

  // Promotion du slot suivant si son trigger est déclenché par le slot courant.
  if (q.length > 1) {
    const next = q[1]!;
    if (shouldTrigger(next.trigger, q[0], q, ctx)) {
      if (q[0]!.type !== 'WPT') q.shift();
      if (q[0] && q[0].activatedAt === undefined) q[0].activatedAt = ctx.nowUnix;
    }
  }

  const res: OrderResolution = { queue: q };
  const current = q[0];
  if (!current || current.activatedAt === undefined) return res;

  switch (current.type) {
    case 'CAP':
      res.activeHeading = current.value['heading'] as number;
      break;
    case 'TWA':
      res.activeTwa = current.value['twa'] as number;
      break;
    case 'WPT':
      res.waypoint = current.value as unknown as Position;
      break;
    case 'SAIL':
      res.activeSailId = current.value['sail'] as SailId;
      break;
    case 'MODE':
      res.sailModeToggle = current.value['auto'] === true;
      break;
    case 'VMG':
      res.vmgDir = current.value['dir'] as 'UPWIND' | 'DOWNWIND';
      break;
  }
  return res;
}
