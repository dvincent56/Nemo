import { describe, it, expect } from 'vitest';
import { holdAccelerationCurve } from './TimeStepper.curve';

describe('holdAccelerationCurve', () => {
  it('returns 60s/350ms for pulses 1-3', () => {
    for (const n of [1, 2, 3]) {
      expect(holdAccelerationCurve(n)).toEqual({ stepSec: 60, delayMs: 350 });
    }
  });

  it('returns 300s/140ms for pulses 4-7', () => {
    for (const n of [4, 5, 6, 7]) {
      expect(holdAccelerationCurve(n)).toEqual({ stepSec: 300, delayMs: 140 });
    }
  });

  it('returns 900s/90ms for pulses 8-14', () => {
    for (const n of [8, 9, 10, 14]) {
      expect(holdAccelerationCurve(n)).toEqual({ stepSec: 900, delayMs: 90 });
    }
  });

  it('returns 3600s/60ms for pulses 15+ (max speed)', () => {
    for (const n of [15, 16, 100, 1000]) {
      expect(holdAccelerationCurve(n)).toEqual({ stepSec: 3600, delayMs: 60 });
    }
  });

  it('handles pulse 0 as the first slow tick (defensive)', () => {
    expect(holdAccelerationCurve(0)).toEqual({ stepSec: 60, delayMs: 350 });
  });
});
