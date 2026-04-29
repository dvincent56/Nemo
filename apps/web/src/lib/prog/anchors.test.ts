import { describe, it, expect } from 'vitest';
import {
  defaultCapAnchor,
  defaultSailAnchor,
  isObsoleteAtTime,
  floorForNow,
  FLOOR_OFFSET_SEC,
  DEFAULT_FAR_OFFSET_SEC,
  DEFAULT_LATEST_OFFSET_SEC,
} from './anchors';
import type { ProgDraft, CapOrder, SailOrder } from './types';

const NOW = 1700000000;
const empty: ProgDraft = { mode: 'cap', capOrders: [], wpOrders: [], finalCap: null, sailOrders: [] };

describe('FLOOR_OFFSET_SEC / DEFAULT_FAR_OFFSET_SEC / DEFAULT_LATEST_OFFSET_SEC constants', () => {
  it('floor is 5 minutes', () => {
    expect(FLOOR_OFFSET_SEC).toBe(300);
  });
  it('far default is 1 hour', () => {
    expect(DEFAULT_FAR_OFFSET_SEC).toBe(3600);
  });
  it('latest default is 10 minutes', () => {
    expect(DEFAULT_LATEST_OFFSET_SEC).toBe(600);
  });
});

describe('defaultCapAnchor', () => {
  it('returns now + 1h when capOrders is empty', () => {
    expect(defaultCapAnchor(empty, NOW)).toBe(NOW + DEFAULT_FAR_OFFSET_SEC);
  });

  it('returns latest.time when capOrders has one order > now+10min', () => {
    const cap: CapOrder = { id: 'c1', trigger: { type: 'AT_TIME', time: NOW + 3600 }, heading: 0, twaLock: false };
    expect(defaultCapAnchor({ ...empty, capOrders: [cap] }, NOW)).toBe(NOW + 3600);
  });

  it('clamps to now+10min if the latest order is closer than now+10min', () => {
    const cap: CapOrder = { id: 'c1', trigger: { type: 'AT_TIME', time: NOW + 60 }, heading: 0, twaLock: false };
    expect(defaultCapAnchor({ ...empty, capOrders: [cap] }, NOW)).toBe(NOW + DEFAULT_LATEST_OFFSET_SEC);
  });

  it('returns the maximum among multiple capOrders', () => {
    const c1: CapOrder = { id: 'c1', trigger: { type: 'AT_TIME', time: NOW + 1000 }, heading: 0, twaLock: false };
    const c2: CapOrder = { id: 'c2', trigger: { type: 'AT_TIME', time: NOW + 5000 }, heading: 0, twaLock: false };
    const c3: CapOrder = { id: 'c3', trigger: { type: 'AT_TIME', time: NOW + 2000 }, heading: 0, twaLock: false };
    expect(defaultCapAnchor({ ...empty, capOrders: [c1, c2, c3] }, NOW)).toBe(NOW + 5000);
  });
});

describe('defaultSailAnchor', () => {
  it('returns now + 1h when sailOrders is empty', () => {
    expect(defaultSailAnchor(empty, NOW)).toBe(NOW + DEFAULT_FAR_OFFSET_SEC);
  });

  it('returns latest AT_TIME sail order time when present', () => {
    const sail: SailOrder = { id: 's1', trigger: { type: 'AT_TIME', time: NOW + 1800 }, action: { auto: true } };
    expect(defaultSailAnchor({ ...empty, sailOrders: [sail] }, NOW)).toBe(NOW + 1800);
  });

  it('ignores AT_WAYPOINT sail orders when computing the latest', () => {
    const sail: SailOrder = {
      id: 's1', trigger: { type: 'AT_WAYPOINT', waypointOrderId: 'w1' }, action: { auto: true },
    };
    expect(defaultSailAnchor({ ...empty, sailOrders: [sail] }, NOW)).toBe(NOW + DEFAULT_FAR_OFFSET_SEC);
  });

  it('clamps to now+10min if the latest AT_TIME sail is closer than that', () => {
    const sail: SailOrder = { id: 's1', trigger: { type: 'AT_TIME', time: NOW + 60 }, action: { auto: true } };
    expect(defaultSailAnchor({ ...empty, sailOrders: [sail] }, NOW)).toBe(NOW + DEFAULT_LATEST_OFFSET_SEC);
  });

  it('mixes AT_TIME and AT_WAYPOINT correctly (only considers AT_TIME)', () => {
    const sail1: SailOrder = { id: 's1', trigger: { type: 'AT_WAYPOINT', waypointOrderId: 'w1' }, action: { auto: true } };
    const sail2: SailOrder = { id: 's2', trigger: { type: 'AT_TIME', time: NOW + 2000 }, action: { auto: true } };
    expect(defaultSailAnchor({ ...empty, sailOrders: [sail1, sail2] }, NOW)).toBe(NOW + 2000);
  });
});

describe('isObsoleteAtTime', () => {
  it('returns true when AT_TIME.time < now + 5min', () => {
    expect(isObsoleteAtTime({ type: 'AT_TIME', time: NOW + 60 }, NOW)).toBe(true);
  });

  it('returns false when AT_TIME.time === now + 5min (boundary)', () => {
    expect(isObsoleteAtTime({ type: 'AT_TIME', time: NOW + FLOOR_OFFSET_SEC }, NOW)).toBe(false);
  });

  it('returns false when AT_TIME.time > now + 5min', () => {
    expect(isObsoleteAtTime({ type: 'AT_TIME', time: NOW + FLOOR_OFFSET_SEC + 1 }, NOW)).toBe(false);
  });

  it('returns false for AT_WAYPOINT triggers', () => {
    expect(isObsoleteAtTime({ type: 'AT_WAYPOINT', waypointOrderId: 'w1' }, NOW)).toBe(false);
  });

  it('returns false for IMMEDIATE triggers', () => {
    expect(isObsoleteAtTime({ type: 'IMMEDIATE' }, NOW)).toBe(false);
  });
});

describe('floorForNow', () => {
  it('returns now + 5min', () => {
    expect(floorForNow(NOW)).toBe(NOW + FLOOR_OFFSET_SEC);
  });
});
