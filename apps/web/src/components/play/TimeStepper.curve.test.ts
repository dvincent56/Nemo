import { describe, it, expect } from 'vitest';
import { holdAccelerationCurve } from './TimeStepper.curve';

describe('holdAccelerationCurve', () => {
  it('always advances by 60 seconds (1 minute) per pulse', () => {
    for (const n of [0, 1, 5, 10, 50, 100, 1000]) {
      expect(holdAccelerationCurve(n).stepSec).toBe(60);
    }
  });

  it('returns 350ms delay for the first 3 pulses (slow phase)', () => {
    expect(holdAccelerationCurve(1).delayMs).toBe(350);
    expect(holdAccelerationCurve(2).delayMs).toBe(350);
    expect(holdAccelerationCurve(3).delayMs).toBe(350);
  });

  it('accelerates to 200ms by pulse 4', () => {
    expect(holdAccelerationCurve(4).delayMs).toBe(200);
    expect(holdAccelerationCurve(7).delayMs).toBe(200);
  });

  it('reaches max speed (15ms) at pulse 30+', () => {
    expect(holdAccelerationCurve(30).delayMs).toBe(15);
    expect(holdAccelerationCurve(100).delayMs).toBe(15);
  });

  it('delay is monotonically non-increasing as pulse grows', () => {
    let prev = Infinity;
    for (const n of [1, 4, 8, 14, 22, 30, 100]) {
      const { delayMs } = holdAccelerationCurve(n);
      expect(delayMs).toBeLessThanOrEqual(prev);
      prev = delayMs;
    }
  });

  it('handles pulse 0 as the first slow tick (defensive)', () => {
    expect(holdAccelerationCurve(0)).toEqual({ stepSec: 60, delayMs: 350 });
  });
});
