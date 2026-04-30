import { describe, it, expect } from 'vitest';
import { deepEqDraft } from './equality';
import type {
  ProgDraft,
  CapOrder,
  WpOrder,
  FinalCapOrder,
  SailOrder,
} from './types';

const empty = (): ProgDraft => ({
  mode: 'cap',
  capOrders: [],
  wpOrders: [],
  finalCap: null,
  sailOrders: [],
});

const cap = (over: Partial<CapOrder> = {}): CapOrder => ({
  id: 'c1',
  heading: 90,
  twaLock: false,
  trigger: { type: 'AT_TIME', time: 1_700_000_000 },
  ...over,
});

const wp = (over: Partial<WpOrder> = {}): WpOrder => ({
  id: 'w1',
  lat: 46.0,
  lon: -4.0,
  captureRadiusNm: 0.5,
  trigger: { type: 'IMMEDIATE' },
  ...over,
});

const finalCap = (over: Partial<FinalCapOrder> = {}): FinalCapOrder => ({
  id: 'fc1',
  heading: 180,
  twaLock: false,
  trigger: { type: 'AT_WAYPOINT', waypointOrderId: 'w1' },
  ...over,
});

const sail = (over: Partial<SailOrder> = {}): SailOrder => ({
  id: 's1',
  action: { auto: false, sail: 'JIB' },
  trigger: { type: 'AT_TIME', time: 1_700_000_000 },
  ...over,
});

describe('deepEqDraft', () => {
  it('returns true for two empty drafts', () => {
    expect(deepEqDraft(empty(), empty())).toBe(true);
  });

  it('treats two empty drafts with different modes as equal', () => {
    // Two drafts with no orders in any track are considered equal regardless
    // of `mode` — switching the cap/wp tab on a blank ProgPanel shouldn't
    // make `isDirty` flip true.
    const a = empty();
    const b: ProgDraft = { ...empty(), mode: 'wp' };
    expect(deepEqDraft(a, b)).toBe(true);
  });

  it('returns false when mode differs and at least one draft has orders', () => {
    // Once the user has authored an order on one side, a mode switch is a
    // real change (the other track's contents would be discarded on commit).
    const a: ProgDraft = { ...empty(), capOrders: [cap()] };
    const b: ProgDraft = { ...empty(), mode: 'wp', capOrders: [cap()] };
    expect(deepEqDraft(a, b)).toBe(false);
  });

  it('returns true for drafts with identical orders (deep value equality, not ref)', () => {
    const a: ProgDraft = { ...empty(), capOrders: [cap()] };
    const b: ProgDraft = { ...empty(), capOrders: [cap()] };
    expect(deepEqDraft(a, b)).toBe(true);
  });

  it('returns false when a CapOrder field differs (heading)', () => {
    const a: ProgDraft = { ...empty(), capOrders: [cap()] };
    const b: ProgDraft = { ...empty(), capOrders: [cap({ heading: 91 })] };
    expect(deepEqDraft(a, b)).toBe(false);
  });

  it('returns false when a CapOrder trigger time differs', () => {
    const a: ProgDraft = { ...empty(), capOrders: [cap()] };
    const b: ProgDraft = {
      ...empty(),
      capOrders: [cap({ trigger: { type: 'AT_TIME', time: 1_700_000_001 } })],
    };
    expect(deepEqDraft(a, b)).toBe(false);
  });

  it('returns false when array lengths differ', () => {
    const a: ProgDraft = { ...empty(), capOrders: [cap()] };
    const b: ProgDraft = { ...empty(), capOrders: [cap(), cap({ id: 'c2' })] };
    expect(deepEqDraft(a, b)).toBe(false);
  });

  it('is order-sensitive (reordering breaks equality)', () => {
    const c1 = cap({ id: 'c1' });
    const c2 = cap({ id: 'c2', heading: 180 });
    const a: ProgDraft = { ...empty(), capOrders: [c1, c2] };
    const b: ProgDraft = { ...empty(), capOrders: [c2, c1] };
    expect(deepEqDraft(a, b)).toBe(false);
  });

  it('handles WpOrder coordinate diffs', () => {
    const a: ProgDraft = { ...empty(), mode: 'wp', wpOrders: [wp()] };
    const b: ProgDraft = { ...empty(), mode: 'wp', wpOrders: [wp({ lat: 46.5 })] };
    expect(deepEqDraft(a, b)).toBe(false);
  });

  it('handles WpOrder AT_WAYPOINT trigger predecessor diffs', () => {
    const a: ProgDraft = {
      ...empty(),
      mode: 'wp',
      wpOrders: [wp({ trigger: { type: 'AT_WAYPOINT', waypointOrderId: 'w0' } })],
    };
    const b: ProgDraft = {
      ...empty(),
      mode: 'wp',
      wpOrders: [wp({ trigger: { type: 'AT_WAYPOINT', waypointOrderId: 'wOTHER' } })],
    };
    expect(deepEqDraft(a, b)).toBe(false);
  });

  it('treats null finalCap on both sides as equal', () => {
    expect(deepEqDraft(empty(), empty())).toBe(true);
  });

  it('returns false when finalCap is set on one side only', () => {
    const a: ProgDraft = { ...empty(), finalCap: null };
    const b: ProgDraft = { ...empty(), finalCap: finalCap() };
    expect(deepEqDraft(a, b)).toBe(false);
  });

  it('returns false when finalCap fields differ', () => {
    const a: ProgDraft = { ...empty(), finalCap: finalCap() };
    const b: ProgDraft = { ...empty(), finalCap: finalCap({ heading: 200 }) };
    expect(deepEqDraft(a, b)).toBe(false);
  });

  it('handles SailOrder action.auto vs explicit-sail diffs', () => {
    const a: ProgDraft = { ...empty(), sailOrders: [sail({ action: { auto: true } })] };
    const b: ProgDraft = { ...empty(), sailOrders: [sail({ action: { auto: false, sail: 'JIB' } })] };
    expect(deepEqDraft(a, b)).toBe(false);
  });

  it('handles SailOrder AT_WAYPOINT triggers', () => {
    const a: ProgDraft = {
      ...empty(),
      sailOrders: [sail({ trigger: { type: 'AT_WAYPOINT', waypointOrderId: 'w1' } })],
    };
    const b: ProgDraft = {
      ...empty(),
      sailOrders: [sail({ trigger: { type: 'AT_WAYPOINT', waypointOrderId: 'w2' } })],
    };
    expect(deepEqDraft(a, b)).toBe(false);
  });

  it('returns true for fully populated mirror drafts', () => {
    const a: ProgDraft = {
      mode: 'wp',
      capOrders: [cap()],
      wpOrders: [wp()],
      finalCap: finalCap(),
      sailOrders: [sail()],
    };
    const b: ProgDraft = {
      mode: 'wp',
      capOrders: [cap()],
      wpOrders: [wp()],
      finalCap: finalCap(),
      sailOrders: [sail()],
    };
    expect(deepEqDraft(a, b)).toBe(true);
  });
});
