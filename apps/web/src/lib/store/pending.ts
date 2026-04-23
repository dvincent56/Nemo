export interface PendingField<T> {
  expected: T;
  since: number;
}

const DEFAULT_TIMEOUT_MS = 60_000;

export function mergeField<T>(
  pending: PendingField<T> | undefined,
  serverValue: T,
  now: number,
  equals: (a: T, b: T) => boolean = (a, b) => a === b,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): { value: T; pending: PendingField<T> | undefined } {
  if (!pending) return { value: serverValue, pending: undefined };
  if (equals(pending.expected, serverValue)) return { value: serverValue, pending: undefined };
  if (now - pending.since > timeoutMs) return { value: serverValue, pending: undefined };
  return { value: pending.expected, pending };
}
