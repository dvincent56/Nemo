import { describe, it, expect } from 'vitest';
import { mergeField } from './pending';

describe('mergeField', () => {
  it('no pending → use server value', () => {
    const r = mergeField(undefined, 42, 1000);
    expect(r).toEqual({ value: 42, pending: undefined });
  });

  it('pending matches server → release, use server', () => {
    const pending = { expected: 42, since: 100 };
    const r = mergeField(pending, 42, 1000);
    expect(r).toEqual({ value: 42, pending: undefined });
  });

  it('pending divergent, within timeout → keep optimistic', () => {
    const pending = { expected: 42, since: 1000 };
    const r = mergeField(pending, 0, 30_000);
    expect(r.value).toBe(42);
    expect(r.pending).toEqual(pending);
  });

  it('pending divergent, past timeout → release, use server', () => {
    const pending = { expected: 42, since: 1000 };
    const r = mergeField(pending, 0, 62_000);
    expect(r).toEqual({ value: 0, pending: undefined });
  });

  it('custom equals (object compare)', () => {
    const equals = (a: { id: string }, b: { id: string }) => a.id === b.id;
    const pending = { expected: { id: 'JIB', extra: 1 }, since: 100 };
    const r = mergeField(pending, { id: 'JIB', extra: 2 }, 1000, equals);
    expect(r.value.id).toBe('JIB');
    expect(r.value.extra).toBe(2); // prefers server
    expect(r.pending).toBeUndefined();
  });
});
