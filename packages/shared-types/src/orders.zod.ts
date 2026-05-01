import { z } from 'zod';

export const OrderTypeZ = z.enum(['CAP', 'TWA', 'WPT', 'SAIL', 'MODE', 'VMG']);

export const OrderTriggerZ = z.discriminatedUnion('type', [
  z.object({ type: z.literal('IMMEDIATE') }),
  z.object({ type: z.literal('SEQUENTIAL') }),
  z.object({ type: z.literal('AT_TIME'), time: z.number().finite() }),
  z.object({ type: z.literal('AT_WAYPOINT'), waypointOrderId: z.string().min(1).max(128) }),
  z.object({ type: z.literal('AFTER_DURATION'), duration: z.number().finite().nonnegative() }),
]);

// `value` is intentionally permissive (different OrderType need different shapes,
// the engine refines per-type), but capped to 2KB JSON to bound damage.
const ValueZ = z.record(z.unknown()).superRefine((val, ctx) => {
  const size = JSON.stringify(val).length;
  if (size > 2048) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `value blob too large (${size}B > 2048B)` });
  }
});

export const OrderZ = z.object({
  id: z.string().min(1).max(128),
  type: OrderTypeZ,
  trigger: OrderTriggerZ,
  value: ValueZ,
  activatedAt: z.number().optional(),
  completed: z.boolean().optional(),
});

export const OrderEnvelopeInputZ = z.object({
  // Subset of OrderEnvelope that the client actually controls. The gateway
  // adds connectionId, trustedTs, effectiveTs, receivedAt server-side.
  order: OrderZ,
  clientTs: z.number().finite(),
  clientSeq: z.number().int().nonnegative(),
});
