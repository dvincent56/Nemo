import { describe, it, expect } from 'vitest';
import { capScheduleToOrders, waypointsToOrders } from './applyRoute';
import type { RoutePlan } from '@nemo/routing';

const baseTs = 1_000_000_000_000;

const fakePlan = (): RoutePlan => ({
  reachedGoal: true,
  polyline: [],
  waypoints: [
    { lat: 46, lon: -4 },
    { lat: 46.5, lon: -3.5 },
    { lat: 47, lon: -3 },
  ],
  capSchedule: [
    { triggerMs: 0, cap: 60, sail: 'JIB' },
    { triggerMs: 3_600_000, cap: 70, sail: 'JIB' },
    { triggerMs: 7_200_000, cap: 90, twaLock: 50, sail: 'C0' },
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

  it('emits SAIL orders when sail changes', () => {
    const orders = capScheduleToOrders(fakePlan(), baseTs);
    const sails = orders.filter((o) => o.type === 'SAIL');
    expect(sails.length).toBeGreaterThanOrEqual(2);
  });

  it('does not emit redundant SAIL orders for unchanged sail', () => {
    const orders = capScheduleToOrders(fakePlan(), baseTs);
    const sails = orders.filter((o) => o.type === 'SAIL');
    // First entry triggers M0, second keeps M0 (no SAIL emitted), third triggers C0
    expect(sails.length).toBe(2);
    expect(sails[0]?.value['sail']).toBe('JIB');
    expect(sails[1]?.value['sail']).toBe('C0');
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
});
