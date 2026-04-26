// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMediaQuery } from './useMediaQuery';

// jsdom does not implement matchMedia; define a stub so vi.spyOn can replace it.
if (typeof window !== 'undefined' && !window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (_query: string): MediaQueryList => ({
      matches: false,
      media: '',
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => true,
    } as unknown as MediaQueryList),
  });
}

type MqlListener = (e: MediaQueryListEvent) => void;
type MqlMock = MediaQueryList & { _trigger: (matches: boolean) => void };

function makeMqlMock(initial: boolean): MqlMock {
  let matches = initial;
  let listener: MqlListener | null = null;
  const mql = {
    matches,
    media: '',
    onchange: null,
    addEventListener: (_t: string, l: MqlListener) => { listener = l; },
    removeEventListener: () => { listener = null; },
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => true,
  } as unknown as MqlMock;
  Object.defineProperty(mql, 'matches', {
    get: () => matches,
    configurable: true,
  });
  mql._trigger = (next: boolean) => {
    matches = next;
    listener?.({ matches: next } as MediaQueryListEvent);
  };
  return mql;
}

describe('useMediaQuery', () => {
  let mql: MqlMock;
  beforeEach(() => {
    mql = makeMqlMock(false);
    vi.spyOn(window, 'matchMedia').mockImplementation(() => mql);
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('returns false on first render when matchMedia is not yet evaluated (SSR-safe default)', () => {
    const { result } = renderHook(() => useMediaQuery('(max-width: 600px)'));
    expect(result.current).toBe(false);
  });

  it('reflects matchMedia.matches after mount', () => {
    mql = makeMqlMock(true);
    vi.spyOn(window, 'matchMedia').mockImplementation(() => mql);
    const { result } = renderHook(() => useMediaQuery('(max-width: 600px)'));
    expect(result.current).toBe(true);
  });

  it('updates when matchMedia change event fires', () => {
    const { result } = renderHook(() => useMediaQuery('(max-width: 600px)'));
    expect(result.current).toBe(false);
    act(() => { mql._trigger(true); });
    expect(result.current).toBe(true);
  });
});
