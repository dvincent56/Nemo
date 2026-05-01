import type { Order, OrderEnvelope, OrderTrigger } from '@nemo/shared-types';
import { OrderZ } from '@nemo/shared-types';

// Tightened from 2000ms to 500ms per security audit: a 2s window let clients
// antedate orders to bypass server-side temporal guards.
export const CLIENT_TS_TOLERANCE_MS = 500;

function computeEffectiveTs(trigger: OrderTrigger, trustedTs: number): number {
  if (trigger.type === 'AT_TIME') {
    return trigger.time * 1000;
  }
  return trustedTs;
}

export function buildEnvelope(args: {
  rawOrder: unknown;
  clientTs: number;
  clientSeq: number;
  connectionId: string;
  serverNow: number;
}): OrderEnvelope | null {
  const { rawOrder, clientTs, clientSeq, connectionId, serverNow } = args;
  if (!Number.isFinite(clientTs) || !Number.isFinite(clientSeq)) return null;

  // Apply default id before validation if absent — matches old buildEnvelope behaviour.
  const candidate = (typeof rawOrder === 'object' && rawOrder !== null)
    ? { id: `${connectionId}-${clientSeq}`, ...(rawOrder as Record<string, unknown>) }
    : rawOrder;

  const parsed = OrderZ.safeParse(candidate);
  if (!parsed.success) return null;
  // Cast is safe: OrderZ is the Zod mirror of Order; the only divergence is
  // exactOptionalPropertyTypes treating `activatedAt?: number` vs
  // `activatedAt?: number | undefined` — runtime values are identical.
  const order = parsed.data as unknown as Order;

  const trustedTs = Math.abs(serverNow - clientTs) < CLIENT_TS_TOLERANCE_MS ? clientTs : serverNow;
  const effectiveTs = computeEffectiveTs(order.trigger, trustedTs);

  return {
    order,
    clientTs,
    clientSeq,
    trustedTs,
    effectiveTs,
    receivedAt: serverNow,
    connectionId,
  };
}
