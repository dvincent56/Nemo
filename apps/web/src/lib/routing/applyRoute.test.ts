import { describe, it, expect } from 'vitest';
import { capScheduleToOrders, waypointsToOrders } from './applyRoute';
import type { RoutePlan } from '@nemo/routing';

const baseTs = 1_000_000_000_000;

// CapScheduleEntry.triggerMs is an ABSOLUTE Unix-ms timestamp (mirrors
// IsochronePoint.timeMs from the routing core). The fixture seeds entries at
// baseTs, baseTs+1h, baseTs+2h to reflect that.
const fakePlan = (): RoutePlan => ({
  reachedGoal: true,
  polyline: [],
  waypoints: [
    { lat: 46, lon: -4 },
    { lat: 46.5, lon: -3.5 },
    { lat: 47, lon: -3 },
  ],
  capSchedule: [
    { triggerMs: baseTs, cap: 60, sail: 'JIB' },
    { triggerMs: baseTs + 3_600_000, cap: 70, sail: 'JIB' },
    { triggerMs: baseTs + 7_200_000, cap: 90, twaLock: 50, sail: 'C0' },
  ],
  isochrones: [],
  totalDistanceNm: 100,
  eta: 7_200_000,
  preset: 'BALANCED',
  computeTimeMs: 1_200,
});

describe('capScheduleToOrders', () => {
  it('emits MODE(auto:true) first, then CAP/TWA/SAIL orders triggered by AT_TIME', () => {
    const orders = capScheduleToOrders(fakePlan(), baseTs);
    expect(orders[0]?.type).toBe('MODE');
    expect(orders[0]?.value).toEqual({ auto: true });
    expect(orders.some((o) => o.type === 'CAP' && o.value['cap'] === 60)).toBe(true);
    expect(orders.some((o) => o.type === 'TWA' && o.value['twa'] === 50)).toBe(true);
  });

  it('does not emit SAIL orders (auto-sail mode handles it)', () => {
    const orders = capScheduleToOrders(fakePlan(), baseTs);
    expect(orders.filter((o) => o.type === 'SAIL').length).toBe(0);
  });

  it('rounds TWA labels to integer degrees', () => {
    const planWithFractionalTwa: RoutePlan = {
      ...fakePlan(),
      capSchedule: [
        { triggerMs: 0, cap: 60, sail: 'JIB', twaLock: -99.92708293378843 },
      ],
    };
    const orders = capScheduleToOrders(planWithFractionalTwa, baseTs);
    const twa = orders.find((o) => o.type === 'TWA');
    expect(twa?.label).toBe('TWA -100°');
    // Engine still gets the full-precision value
    expect(twa?.value['twa']).toBe(-99.92708293378843);
  });

  it('AT_TIME trigger.time is in seconds (Unix epoch), not milliseconds', () => {
    const orders = capScheduleToOrders(fakePlan(), baseTs);
    const capOrder = orders.find((o) => o.type === 'CAP');
    expect(capOrder).toBeDefined();
    if (capOrder?.trigger.type === 'AT_TIME') {
      // Time should be in seconds — check it's much smaller than ms baseTs
      // baseTs (ms) = 1_000_000_000_000, so seconds = 1_000_000_000
      expect(capOrder.trigger.time).toBe(1_000_000_000); // exact
      // Sanity: less than current ms timestamp
      expect(capOrder.trigger.time).toBeLessThan(Date.now());
    }
  });
});

describe('waypointsToOrders', () => {
  it('emits MODE(auto:true) first then a WPT order per inflection waypoint (skipping first = boat pos)', () => {
    const orders = waypointsToOrders(fakePlan(), baseTs);
    expect(orders[0]?.type).toBe('MODE');
    const wpts = orders.filter((o) => o.type === 'WPT');
    expect(wpts.length).toBe(2); // 3 waypoints, skip first
    expect(wpts[0]?.value['lat']).toBe(46.5);
  });

  it('chains WPT orders via AT_WAYPOINT trigger', () => {
    const orders = waypointsToOrders(fakePlan(), baseTs);
    const wpts = orders.filter((o) => o.type === 'WPT');
    expect(wpts[0]?.trigger).toEqual({ type: 'IMMEDIATE' });
    expect(wpts[1]?.trigger.type).toBe('AT_WAYPOINT');
  });

  it('captureRadiusNm defaults to 0.5 nm in WPT value payload', () => {
    const orders = waypointsToOrders(fakePlan(), baseTs);
    const wpts = orders.filter((o) => o.type === 'WPT');
    expect(wpts[0]?.value['captureRadiusNm']).toBe(0.5);
  });

  it('labels WPT orders sequentially as "WP N" (not lat/lon coords or internal id)', () => {
    const orders = waypointsToOrders(fakePlan(), baseTs);
    const wpts = orders.filter((o) => o.type === 'WPT');
    expect(wpts[0]?.label).toBe('WP 1');
    expect(wpts[1]?.label).toBe('WP 2');
  });
});
