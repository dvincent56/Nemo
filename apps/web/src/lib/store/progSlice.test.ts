import { describe, it, expect } from 'vitest';
import { create } from 'zustand';
import { createProgSlice, INITIAL_PROG } from './progSlice';
import type {
  ProgState,
  CapOrder,
  WpOrder,
  SailOrder,
  ProgDraft,
} from '@/lib/prog/types';

// Define the minimum store shape this slice's test needs.
interface TestStore {
  prog: ProgState;
  setProgMode: ReturnType<typeof createProgSlice>['setProgMode'];
  addCapOrder: ReturnType<typeof createProgSlice>['addCapOrder'];
  updateCapOrder: ReturnType<typeof createProgSlice>['updateCapOrder'];
  removeCapOrder: ReturnType<typeof createProgSlice>['removeCapOrder'];
  addWpOrder: ReturnType<typeof createProgSlice>['addWpOrder'];
  updateWpOrder: ReturnType<typeof createProgSlice>['updateWpOrder'];
  removeWpOrder: ReturnType<typeof createProgSlice>['removeWpOrder'];
  setFinalCap: ReturnType<typeof createProgSlice>['setFinalCap'];
  addSailOrder: ReturnType<typeof createProgSlice>['addSailOrder'];
  removeSailOrder: ReturnType<typeof createProgSlice>['removeSailOrder'];
  clearAllOrders: ReturnType<typeof createProgSlice>['clearAllOrders'];
  resetDraft: ReturnType<typeof createProgSlice>['resetDraft'];
  markCommitted: ReturnType<typeof createProgSlice>['markCommitted'];
  applyRouteAsCommitted: ReturnType<typeof createProgSlice>['applyRouteAsCommitted'];
  setEditingOrder: ReturnType<typeof createProgSlice>['setEditingOrder'];
  setPickingWp: ReturnType<typeof createProgSlice>['setPickingWp'];
  setPendingNewWpId: ReturnType<typeof createProgSlice>['setPendingNewWpId'];
  removeCapturedWps: ReturnType<typeof createProgSlice>['removeCapturedWps'];
}

function makeStore() {
  return create<TestStore>()((set) => ({
    ...createProgSlice(set as never),
  }));
}

const cap = (id: string, time: number, heading = 100): CapOrder => ({
  id,
  trigger: { type: 'AT_TIME', time },
  heading,
  twaLock: false,
});

const wp = (id: string, lat = 45, lon = -3, prevId: string | null = null): WpOrder => ({
  id,
  trigger: prevId
    ? { type: 'AT_WAYPOINT', waypointOrderId: prevId }
    : { type: 'IMMEDIATE' },
  lat,
  lon,
  captureRadiusNm: 0.5,
});

const sail = (id: string, time: number): SailOrder => ({
  id,
  trigger: { type: 'AT_TIME', time },
  action: { auto: true },
});

const sailAtWp = (id: string, wpId: string): SailOrder => ({
  id,
  trigger: { type: 'AT_WAYPOINT', waypointOrderId: wpId },
  action: { auto: false, sail: 'SPI' },
});

describe('progSlice INITIAL_PROG', () => {
  it('starts with empty draft and empty committed', () => {
    expect(INITIAL_PROG.draft.capOrders).toEqual([]);
    expect(INITIAL_PROG.draft.wpOrders).toEqual([]);
    expect(INITIAL_PROG.draft.sailOrders).toEqual([]);
    expect(INITIAL_PROG.draft.finalCap).toBeNull();
    expect(INITIAL_PROG.committed.capOrders).toEqual([]);
  });
});

describe('progSlice cap mutations', () => {
  it('addCapOrder mutates draft only, not committed', () => {
    const store = makeStore();
    store.getState().addCapOrder(cap('c1', 1000));
    expect(store.getState().prog.draft.capOrders).toHaveLength(1);
    expect(store.getState().prog.committed.capOrders).toHaveLength(0);
  });

  it('updateCapOrder applies a partial patch by id', () => {
    const store = makeStore();
    store.getState().addCapOrder(cap('c1', 1000, 100));
    store.getState().updateCapOrder('c1', { heading: 225 });
    expect(store.getState().prog.draft.capOrders[0]?.heading).toBe(225);
    expect(store.getState().prog.draft.capOrders[0]?.trigger.time).toBe(1000); // unchanged
  });

  it('removeCapOrder filters by id', () => {
    const store = makeStore();
    store.getState().addCapOrder(cap('c1', 1000));
    store.getState().addCapOrder(cap('c2', 2000));
    store.getState().removeCapOrder('c1');
    expect(store.getState().prog.draft.capOrders).toHaveLength(1);
    expect(store.getState().prog.draft.capOrders[0]?.id).toBe('c2');
  });
});

describe('progSlice wp mutations', () => {
  it('addWpOrder appends', () => {
    const store = makeStore();
    store.getState().addWpOrder(wp('w1'));
    expect(store.getState().prog.draft.wpOrders).toHaveLength(1);
  });

  it('removeWpOrder rebinds AT_WAYPOINT successors to the predecessor', () => {
    const store = makeStore();
    store.getState().addWpOrder(wp('w1'));
    store.getState().addWpOrder(wp('w2', 46, -2, 'w1'));
    store.getState().addWpOrder(wp('w3', 47, -1, 'w2'));
    store.getState().removeWpOrder('w2');
    const wps = store.getState().prog.draft.wpOrders;
    expect(wps).toHaveLength(2);
    const w3 = wps.find((x) => x.id === 'w3');
    expect(w3?.trigger).toEqual({ type: 'AT_WAYPOINT', waypointOrderId: 'w1' });
  });

  it('removeWpOrder makes the head IMMEDIATE if first WP is removed', () => {
    const store = makeStore();
    store.getState().addWpOrder(wp('w1'));
    store.getState().addWpOrder(wp('w2', 46, -2, 'w1'));
    store.getState().removeWpOrder('w1');
    const w2 = store.getState().prog.draft.wpOrders[0];
    expect(w2?.trigger).toEqual({ type: 'IMMEDIATE' });
  });

  it('removeWpOrder drops sail orders that referenced the removed WP', () => {
    const store = makeStore();
    store.getState().addWpOrder(wp('w1'));
    store.getState().addSailOrder(sailAtWp('s1', 'w1'));
    store.getState().removeWpOrder('w1');
    expect(store.getState().prog.draft.sailOrders).toEqual([]);
  });

  it('removeWpOrder drops finalCap if it referenced the removed WP', () => {
    const store = makeStore();
    store.getState().addWpOrder(wp('w1'));
    store.getState().setFinalCap({
      id: 'fc',
      trigger: { type: 'AT_WAYPOINT', waypointOrderId: 'w1' },
      heading: 45,
      twaLock: false,
    });
    store.getState().removeWpOrder('w1');
    expect(store.getState().prog.draft.finalCap).toBeNull();
  });
});

describe('progSlice mode switching', () => {
  it('setProgMode is a soft toggle — does not clear the other track', () => {
    const store = makeStore();
    store.getState().addCapOrder(cap('c1', 1000));
    store.getState().setProgMode('wp');
    expect(store.getState().prog.draft.mode).toBe('wp');
    expect(store.getState().prog.draft.capOrders).toHaveLength(1);
  });

  it('setProgMode preserves wpOrders / finalCap / sailOrders when toggling to cap', () => {
    const store = makeStore();
    store.getState().setProgMode('wp');
    store.getState().addWpOrder(wp('w1'));
    store.getState().setFinalCap({
      id: 'fc',
      trigger: { type: 'AT_WAYPOINT', waypointOrderId: 'w1' },
      heading: 45,
      twaLock: false,
    });
    store.getState().addSailOrder(sailAtWp('s1', 'w1'));
    store.getState().addSailOrder(sail('s2', 5000));
    store.getState().setProgMode('cap');
    // Nothing dropped — the user can switch back to 'wp' and recover their work.
    expect(store.getState().prog.draft.mode).toBe('cap');
    expect(store.getState().prog.draft.wpOrders).toHaveLength(1);
    expect(store.getState().prog.draft.finalCap).not.toBeNull();
    expect(store.getState().prog.draft.sailOrders).toHaveLength(2);
  });

  it('markCommitted drops the inactive track (cap mode → wpOrders cleared)', () => {
    const store = makeStore();
    store.getState().addWpOrder(wp('w1'));
    store.getState().setProgMode('cap');
    store.getState().addCapOrder(cap('c1', 1000));
    store.getState().markCommitted();
    expect(store.getState().prog.committed.mode).toBe('cap');
    expect(store.getState().prog.committed.capOrders).toHaveLength(1);
    expect(store.getState().prog.committed.wpOrders).toEqual([]);
    // Draft also cleaned, mirroring committed (so isDirty doesn't light up).
    expect(store.getState().prog.draft.wpOrders).toEqual([]);
  });

  it('markCommitted drops AT_WAYPOINT sail orders in cap mode', () => {
    const store = makeStore();
    store.getState().setProgMode('wp');
    store.getState().addWpOrder(wp('w1'));
    store.getState().addSailOrder(sailAtWp('s1', 'w1'));
    store.getState().addSailOrder(sail('s2', 5000));
    store.getState().setProgMode('cap');
    store.getState().markCommitted();
    expect(store.getState().prog.committed.sailOrders).toHaveLength(1);
    expect(store.getState().prog.committed.sailOrders[0]?.id).toBe('s2');
  });

  it('markCommitted drops capOrders when committing in wp mode', () => {
    const store = makeStore();
    store.getState().addCapOrder(cap('c1', 1000));
    store.getState().setProgMode('wp');
    store.getState().addWpOrder(wp('w1'));
    store.getState().markCommitted();
    expect(store.getState().prog.committed.mode).toBe('wp');
    expect(store.getState().prog.committed.capOrders).toEqual([]);
    expect(store.getState().prog.committed.wpOrders).toHaveLength(1);
  });
});

describe('progSlice clear / reset / commit', () => {
  it('clearAllOrders empties all 4 tracks', () => {
    const store = makeStore();
    store.getState().addCapOrder(cap('c1', 1000));
    store.getState().addSailOrder(sail('s1', 5000));
    store.getState().clearAllOrders();
    expect(store.getState().prog.draft.capOrders).toEqual([]);
    expect(store.getState().prog.draft.sailOrders).toEqual([]);
  });

  it('resetDraft copies committed back to draft', () => {
    const store = makeStore();
    store.getState().addCapOrder(cap('c1', 1000));
    store.getState().resetDraft();
    expect(store.getState().prog.draft.capOrders).toEqual([]);
    expect(store.getState().prog.committed.capOrders).toEqual([]);
  });

  it('markCommitted promotes draft to committed', () => {
    const store = makeStore();
    store.getState().addCapOrder(cap('c1', 1000));
    store.getState().markCommitted();
    expect(store.getState().prog.committed.capOrders).toHaveLength(1);
    expect(store.getState().prog.committed.capOrders[0]?.id).toBe('c1');
  });

  it('applyRouteAsCommitted overwrites both draft and committed', () => {
    const store = makeStore();
    const next: ProgDraft = {
      mode: 'wp',
      capOrders: [],
      wpOrders: [wp('w1')],
      finalCap: null,
      sailOrders: [],
    };
    store.getState().applyRouteAsCommitted(next);
    expect(store.getState().prog.draft.wpOrders).toHaveLength(1);
    expect(store.getState().prog.committed.wpOrders).toHaveLength(1);
    expect(store.getState().prog.draft.mode).toBe('wp');
  });

  it('applyRouteAsCommitted clones the input (no aliasing)', () => {
    const store = makeStore();
    const next: ProgDraft = {
      mode: 'wp',
      capOrders: [],
      wpOrders: [wp('w1')],
      finalCap: null,
      sailOrders: [],
    };
    store.getState().applyRouteAsCommitted(next);
    next.wpOrders.push(wp('w2'));
    expect(store.getState().prog.draft.wpOrders).toHaveLength(1);
    expect(store.getState().prog.committed.wpOrders).toHaveLength(1);
  });
});

describe('progSlice editingOrder', () => {
  it('starts with editingOrder = null', () => {
    const store = makeStore();
    expect(store.getState().prog.editingOrder).toBeNull();
  });

  it('setEditingOrder updates the editingOrder field', () => {
    const store = makeStore();
    store.getState().setEditingOrder({ kind: 'cap', id: 'c1' });
    expect(store.getState().prog.editingOrder).toEqual({ kind: 'cap', id: 'c1' });
    store.getState().setEditingOrder({ kind: 'wp', id: 'w1' });
    expect(store.getState().prog.editingOrder).toEqual({ kind: 'wp', id: 'w1' });
    store.getState().setEditingOrder(null);
    expect(store.getState().prog.editingOrder).toBeNull();
  });

  it('applyRouteAsCommitted preserves editingOrder', () => {
    const store = makeStore();
    store.getState().setEditingOrder({ kind: 'cap', id: 'c1' });
    const next: ProgDraft = {
      mode: 'wp',
      capOrders: [],
      wpOrders: [wp('w1')],
      finalCap: null,
      sailOrders: [],
    };
    store.getState().applyRouteAsCommitted(next);
    expect(store.getState().prog.editingOrder).toEqual({ kind: 'cap', id: 'c1' });
  });
});

describe('progSlice pickingWp', () => {
  it('starts with pickingWp = false', () => {
    const store = makeStore();
    expect(store.getState().prog.pickingWp).toBe(false);
  });

  it('setPickingWp toggles the picking flag', () => {
    const store = makeStore();
    expect(store.getState().prog.pickingWp).toBe(false);
    store.getState().setPickingWp(true);
    expect(store.getState().prog.pickingWp).toBe(true);
    store.getState().setPickingWp(false);
    expect(store.getState().prog.pickingWp).toBe(false);
  });

  it('applyRouteAsCommitted preserves pickingWp', () => {
    const store = makeStore();
    store.getState().setPickingWp(true);
    const next: ProgDraft = {
      mode: 'wp',
      capOrders: [],
      wpOrders: [wp('w1')],
      finalCap: null,
      sailOrders: [],
    };
    store.getState().applyRouteAsCommitted(next);
    expect(store.getState().prog.pickingWp).toBe(true);
  });
});

describe('progSlice pendingNewWpId', () => {
  it('starts with pendingNewWpId = null', () => {
    const store = makeStore();
    expect(store.getState().prog.pendingNewWpId).toBeNull();
  });

  it('setPendingNewWpId updates the field', () => {
    const store = makeStore();
    store.getState().setPendingNewWpId('w42');
    expect(store.getState().prog.pendingNewWpId).toBe('w42');
    store.getState().setPendingNewWpId(null);
    expect(store.getState().prog.pendingNewWpId).toBeNull();
  });

  it('applyRouteAsCommitted preserves pendingNewWpId', () => {
    const store = makeStore();
    store.getState().setPendingNewWpId('w7');
    const next: ProgDraft = {
      mode: 'wp',
      capOrders: [],
      wpOrders: [wp('w1')],
      finalCap: null,
      sailOrders: [],
    };
    store.getState().applyRouteAsCommitted(next);
    expect(store.getState().prog.pendingNewWpId).toBe('w7');
  });
});

describe('progSlice removeCapturedWps', () => {
  it('removes captured WPs from both committed and draft', () => {
    const store = makeStore();
    const next: ProgDraft = {
      mode: 'wp', capOrders: [],
      wpOrders: [
        wp('w1'),
        wp('w2', 46, -2, 'w1'),
        wp('w3', 47, -1, 'w2'),
      ],
      finalCap: null, sailOrders: [],
    };
    store.getState().applyRouteAsCommitted(next);
    // Simulate user edits w3
    store.getState().updateWpOrder('w3', { lat: 48 });

    store.getState().removeCapturedWps(['w1']);

    expect(store.getState().prog.committed.wpOrders.map((w) => w.id)).toEqual(['w2', 'w3']);
    expect(store.getState().prog.draft.wpOrders.map((w) => w.id)).toEqual(['w2', 'w3']);
    // w2 was AT_WAYPOINT(w1) — now IMMEDIATE since w1 is gone
    expect(store.getState().prog.committed.wpOrders[0]?.trigger).toEqual({ type: 'IMMEDIATE' });
  });

  it('cascades to sail orders + finalCap referencing the removed WPs', () => {
    const store = makeStore();
    const next: ProgDraft = {
      mode: 'wp', capOrders: [],
      wpOrders: [wp('w1'), wp('w2', 46, -2, 'w1')],
      finalCap: { id: 'fc', trigger: { type: 'AT_WAYPOINT', waypointOrderId: 'w1' }, heading: 45, twaLock: false },
      sailOrders: [{ id: 's1', trigger: { type: 'AT_WAYPOINT', waypointOrderId: 'w1' }, action: { auto: true } }],
    };
    store.getState().applyRouteAsCommitted(next);
    store.getState().removeCapturedWps(['w1']);

    expect(store.getState().prog.committed.finalCap).toBeNull();
    expect(store.getState().prog.committed.sailOrders).toEqual([]);
    // w2 rebinds to IMMEDIATE
    expect(store.getState().prog.committed.wpOrders[0]?.trigger.type).toBe('IMMEDIATE');
  });

  it('is a no-op when removedIds is empty', () => {
    const store = makeStore();
    store.getState().applyRouteAsCommitted({
      mode: 'wp', capOrders: [], wpOrders: [wp('w1')], finalCap: null, sailOrders: [],
    });
    const beforeCommitted = store.getState().prog.committed;
    store.getState().removeCapturedWps([]);
    expect(store.getState().prog.committed).toBe(beforeCommitted); // referential identity preserved
  });
});
