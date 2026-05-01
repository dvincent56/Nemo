import { describe, it, expect } from 'vitest';
import { serializeDraft } from './serialize';
import type { ProgDraft, CapOrder } from './types';

const empty: ProgDraft = {
  mode: 'cap',
  capOrders: [],
  wpOrders: [],
  finalCap: null,
  sailOrders: [],
};

describe('serializeDraft', () => {
  it('serializes an empty draft to an empty array', () => {
    expect(serializeDraft(empty)).toEqual([]);
  });

  it('serializes CAP with twaLock=false → CAP order', () => {
    const cap: CapOrder = { id: 'c1', trigger: { type: 'AT_TIME', time: 1000 }, heading: 225, twaLock: false };
    const out = serializeDraft({ ...empty, capOrders: [cap] });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: 'c1',
      type: 'CAP',
      value: { heading: 225 },
      trigger: { type: 'AT_TIME', time: 1000 },
    });
  });

  it('serializes CAP with twaLock=true → TWA order with twa value', () => {
    const cap: CapOrder = { id: 't1', trigger: { type: 'AT_TIME', time: 2000 }, heading: 100, twaLock: true };
    const out = serializeDraft({ ...empty, capOrders: [cap] });
    expect(out[0]).toMatchObject({
      id: 't1',
      type: 'TWA',
      value: { twa: 100 },
      trigger: { type: 'AT_TIME', time: 2000 },
    });
  });

  it('serializes WP orders with their trigger chain', () => {
    const draft: ProgDraft = {
      ...empty, mode: 'wp',
      wpOrders: [
        { id: 'w1', trigger: { type: 'IMMEDIATE' }, lat: 45, lon: -3, captureRadiusNm: 0.5 },
        { id: 'w2', trigger: { type: 'AT_WAYPOINT', waypointOrderId: 'w1' }, lat: 46, lon: -2, captureRadiusNm: 0.5 },
      ],
    };
    const out = serializeDraft(draft);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ id: 'w1', type: 'WPT', value: { lat: 45, lon: -3, captureRadiusNm: 0.5 }, trigger: { type: 'IMMEDIATE' } });
    expect(out[1]).toMatchObject({ id: 'w2', type: 'WPT', trigger: { type: 'AT_WAYPOINT', waypointOrderId: 'w1' } });
  });

  it('serializes FinalCap (twaLock=false) as CAP/AT_WAYPOINT', () => {
    const draft: ProgDraft = {
      ...empty, mode: 'wp',
      wpOrders: [{ id: 'w1', trigger: { type: 'IMMEDIATE' }, lat: 45, lon: -3, captureRadiusNm: 0.5 }],
      finalCap: { id: 'fc', trigger: { type: 'AT_WAYPOINT', waypointOrderId: 'w1' }, heading: 45, twaLock: false },
    };
    const out = serializeDraft(draft);
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({
      id: 'fc',
      type: 'CAP',
      value: { heading: 45 },
      trigger: { type: 'AT_WAYPOINT', waypointOrderId: 'w1' },
    });
  });

  it('serializes FinalCap (twaLock=true) as TWA/AT_WAYPOINT', () => {
    const draft: ProgDraft = {
      ...empty, mode: 'wp',
      wpOrders: [{ id: 'w1', trigger: { type: 'IMMEDIATE' }, lat: 45, lon: -3, captureRadiusNm: 0.5 }],
      finalCap: { id: 'fc', trigger: { type: 'AT_WAYPOINT', waypointOrderId: 'w1' }, heading: -30, twaLock: true },
    };
    const out = serializeDraft(draft);
    expect(out[1]).toMatchObject({
      id: 'fc',
      type: 'TWA',
      value: { twa: -30 },
      trigger: { type: 'AT_WAYPOINT', waypointOrderId: 'w1' },
    });
  });

  it('serializes SailOrder action.auto=true → MODE order', () => {
    const draft: ProgDraft = {
      ...empty,
      sailOrders: [{ id: 's1', trigger: { type: 'AT_TIME', time: 5000 }, action: { auto: true } }],
    };
    const out = serializeDraft(draft);
    expect(out[0]).toMatchObject({
      id: 's1', type: 'MODE', value: { auto: true }, trigger: { type: 'AT_TIME', time: 5000 },
    });
  });

  it('serializes SailOrder action.auto=false → SAIL order with sail value', () => {
    const draft: ProgDraft = {
      ...empty,
      sailOrders: [{ id: 's2', trigger: { type: 'AT_TIME', time: 5000 }, action: { auto: false, sail: 'SPI' } }],
    };
    const out = serializeDraft(draft);
    expect(out[0]).toMatchObject({
      id: 's2', type: 'SAIL', value: { sail: 'SPI' }, trigger: { type: 'AT_TIME', time: 5000 },
    });
  });

  it('serializes SailOrder with AT_WAYPOINT trigger', () => {
    const draft: ProgDraft = {
      ...empty, mode: 'wp',
      wpOrders: [{ id: 'w1', trigger: { type: 'IMMEDIATE' }, lat: 45, lon: -3, captureRadiusNm: 0.5 }],
      sailOrders: [{ id: 's1', trigger: { type: 'AT_WAYPOINT', waypointOrderId: 'w1' }, action: { auto: false, sail: 'C0' } }],
    };
    const out = serializeDraft(draft);
    // Output should contain the WP first, then the sail order
    const sail = out.find((o) => o.id === 's1');
    expect(sail).toMatchObject({
      type: 'SAIL', value: { sail: 'C0' }, trigger: { type: 'AT_WAYPOINT', waypointOrderId: 'w1' },
    });
  });

  it('produces orders in track order: caps + wps + finalCap, then sails', () => {
    const draft: ProgDraft = {
      mode: 'cap',
      capOrders: [
        { id: 'c1', trigger: { type: 'AT_TIME', time: 1000 }, heading: 100, twaLock: false },
        { id: 'c2', trigger: { type: 'AT_TIME', time: 2000 }, heading: 200, twaLock: false },
      ],
      wpOrders: [],
      finalCap: null,
      sailOrders: [
        { id: 's1', trigger: { type: 'AT_TIME', time: 1500 }, action: { auto: true } },
      ],
    };
    const out = serializeDraft(draft);
    expect(out.map((o) => o.id)).toEqual(['c1', 'c2', 's1']);
  });

  describe('mode filtering (soft toggle semantics)', () => {
    it('cap mode drops wpOrders / finalCap from the wire', () => {
      const draft: ProgDraft = {
        mode: 'cap',
        capOrders: [
          { id: 'c1', trigger: { type: 'AT_TIME', time: 1000 }, heading: 100, twaLock: false },
        ],
        wpOrders: [
          { id: 'w1', trigger: { type: 'IMMEDIATE' }, lat: 45, lon: -3, captureRadiusNm: 0.5 },
        ],
        finalCap: { id: 'fc', trigger: { type: 'AT_WAYPOINT', waypointOrderId: 'w1' }, heading: 90, twaLock: false },
        sailOrders: [],
      };
      const out = serializeDraft(draft);
      expect(out.map((o) => o.id)).toEqual(['c1']);
    });

    it('cap mode drops AT_WAYPOINT sail orders but keeps AT_TIME ones', () => {
      const draft: ProgDraft = {
        mode: 'cap',
        capOrders: [],
        wpOrders: [
          { id: 'w1', trigger: { type: 'IMMEDIATE' }, lat: 45, lon: -3, captureRadiusNm: 0.5 },
        ],
        finalCap: null,
        sailOrders: [
          { id: 's1', trigger: { type: 'AT_TIME', time: 5000 }, action: { auto: true } },
          { id: 's2', trigger: { type: 'AT_WAYPOINT', waypointOrderId: 'w1' }, action: { auto: false, sail: 'SPI' } },
        ],
      };
      const out = serializeDraft(draft);
      expect(out.map((o) => o.id)).toEqual(['s1']);
    });

    it('wp mode drops capOrders from the wire', () => {
      const draft: ProgDraft = {
        mode: 'wp',
        capOrders: [
          { id: 'c1', trigger: { type: 'AT_TIME', time: 1000 }, heading: 100, twaLock: false },
        ],
        wpOrders: [
          { id: 'w1', trigger: { type: 'IMMEDIATE' }, lat: 45, lon: -3, captureRadiusNm: 0.5 },
        ],
        finalCap: null,
        sailOrders: [],
      };
      const out = serializeDraft(draft);
      expect(out.map((o) => o.id)).toEqual(['w1']);
    });

    it('wp mode keeps both AT_TIME and AT_WAYPOINT sail orders', () => {
      const draft: ProgDraft = {
        mode: 'wp',
        capOrders: [],
        wpOrders: [
          { id: 'w1', trigger: { type: 'IMMEDIATE' }, lat: 45, lon: -3, captureRadiusNm: 0.5 },
        ],
        finalCap: null,
        sailOrders: [
          { id: 's1', trigger: { type: 'AT_TIME', time: 5000 }, action: { auto: true } },
          { id: 's2', trigger: { type: 'AT_WAYPOINT', waypointOrderId: 'w1' }, action: { auto: false, sail: 'SPI' } },
        ],
      };
      const out = serializeDraft(draft);
      expect(out.map((o) => o.id)).toEqual(['w1', 's1', 's2']);
    });
  });
});
