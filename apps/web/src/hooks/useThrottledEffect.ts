'use client';
import { useEffect, useRef } from 'react';

/**
 * Throttled effect: runs `fn` on the first dependency change, then at most
 * once per `intervalMs` thereafter. Coalescing — when changes arrive faster
 * than `intervalMs`, only the LATEST state is fired (via the ref captured by
 * `fn`).
 *
 * Differs from a plain debounce in one critical way: during a continuous
 * stream of changes (e.g. a TimeStepper hold pulsing every 15 ms), a debounce
 * never fires because each new event cancels the prior timer. A throttle
 * fires immediately, then trails one update per window — the user sees live
 * feedback without the worker being flooded.
 *
 * Intended use: publish editor "ghost" state to the store at a sane rate so
 * the projection worker isn't asked to re-simulate dozens of times per
 * second during a TimeStepper hold.
 */
export function useThrottledEffect(
  fn: () => void,
  deps: unknown[],
  intervalMs: number,
): void {
  const lastFiredAtRef = useRef(0);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    const fire = (): void => {
      lastFiredAtRef.current = Date.now();
      pendingTimerRef.current = null;
      fnRef.current();
    };
    const elapsed = Date.now() - lastFiredAtRef.current;
    if (elapsed >= intervalMs) {
      fire();
    } else if (pendingTimerRef.current === null) {
      pendingTimerRef.current = setTimeout(fire, intervalMs - elapsed);
    }
    // No per-effect cleanup: a pending trailing fire MUST survive deps
    // changes within the throttle window — otherwise we re-create the
    // debounce bug where rapid changes cancel every scheduled fire.
    // The trailing call picks up the latest state via fnRef.current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  // Unmount: drop any in-flight trailing fire so it can't run after the
  // component is gone.
  useEffect(() => () => {
    if (pendingTimerRef.current) {
      clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
    }
  }, []);
}
