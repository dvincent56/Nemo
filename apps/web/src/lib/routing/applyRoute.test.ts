import { describe, it, expect } from 'vitest';
import { capScheduleToProgDraft, waypointsToProgDraft } from './applyRoute';
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

describe('capScheduleToProgDraft', () => {
  it('produces a draft in cap mode with empty WP track', () => {
    const draft = capScheduleToProgDraft(fakePlan(), false);
    expect(draft.mode).toBe('cap');
    expect(draft.wpOrders).toEqual([]);
    expect(draft.finalCap).toBeNull();
  });

  it('emits sailAuto:true bootstrap order when sailAutoAlready=false', () => {
    const draft = capScheduleToProgDraft(fakePlan(), false);
    expect(draft.sailOrders).toHaveLength(1);
    expect(draft.sailOrders[0]?.action).toEqual({ auto: true });
  });

  it('emits CAP and TWA cap orders mirroring the schedule', () => {
    const draft = capScheduleToProgDraft(fakePlan(), false);
    // 2 plain CAP entries + 1 TWA entry = 3 cap orders
    expect(draft.capOrders).toHaveLength(3);
    const headings = draft.capOrders.map((o) => o.heading);
    expect(headings).toContain(60);
    expect(headings).toContain(70);
    // The TWA-locked entry stores the locked TWA in `heading` (typed schema —
    // there's no separate `twa` field; the disambiguation is `twaLock: true`).
    expect(draft.capOrders.some((o) => o.twaLock && o.heading === 50)).toBe(true);
  });

  it('rounds TWA heading to integer degrees (matches Compass.tsx)', () => {
    const planWithFractionalTwa: RoutePlan = {
      ...fakePlan(),
      capSchedule: [
        { triggerMs: 0, cap: 60, sail: 'JIB', twaLock: -99.92708293378843 },
      ],
    };
    const draft = capScheduleToProgDraft(planWithFractionalTwa, false);
    const twa = draft.capOrders.find((o) => o.twaLock);
    expect(twa?.heading).toBe(-100);
  });

  it('rounds CAP heading to integer degrees', () => {
    const planWithFractionalCap: RoutePlan = {
      ...fakePlan(),
      capSchedule: [{ triggerMs: 0, cap: 247.2288638567262, sail: 'JIB' }],
    };
    const draft = capScheduleToProgDraft(planWithFractionalCap, false);
    const cap = draft.capOrders.find((o) => !o.twaLock);
    expect(cap?.heading).toBe(247);
    expect(cap?.twaLock).toBe(false);
  });

  it('AT_TIME trigger.time is in seconds (Unix epoch), not milliseconds', () => {
    const draft = capScheduleToProgDraft(fakePlan(), false);
    const capOrder = draft.capOrders[0];
    expect(capOrder).toBeDefined();
    expect(capOrder?.trigger.type).toBe('AT_TIME');
    // Time should be in seconds — baseTs (ms) = 1_000_000_000_000, so seconds = 1_000_000_000
    expect(capOrder?.trigger.time).toBe(1_000_000_000); // exact
    // Sanity: less than current ms timestamp
    expect(capOrder?.trigger.time).toBeLessThan(Date.now());
  });

  it('omits the leading sailAuto bootstrap when sailAutoAlready=true', () => {
    const draft = capScheduleToProgDraft(fakePlan(), true);
    expect(draft.sailOrders).toEqual([]);
    // CAP/TWA cap orders still emitted
    expect(draft.capOrders.length).toBeGreaterThan(0);
  });
});

describe('waypointsToProgDraft', () => {
  it('produces a draft in wp mode with empty CAP track', () => {
    const draft = waypointsToProgDraft(fakePlan(), false);
    expect(draft.mode).toBe('wp');
    expect(draft.capOrders).toEqual([]);
    expect(draft.finalCap).toBeNull();
  });

  it('emits sailAuto:true bootstrap order when sailAutoAlready=false', () => {
    const draft = waypointsToProgDraft(fakePlan(), false);
    expect(draft.sailOrders).toHaveLength(1);
    expect(draft.sailOrders[0]?.action).toEqual({ auto: true });
  });

  it('emits one WP order per inflection waypoint (skipping first = boat pos)', () => {
    const draft = waypointsToProgDraft(fakePlan(), false);
    expect(draft.wpOrders).toHaveLength(2); // 3 waypoints, skip first
    expect(draft.wpOrders[0]?.lat).toBe(46.5);
  });

  it('chains WP orders via AT_WAYPOINT trigger', () => {
    const draft = waypointsToProgDraft(fakePlan(), false);
    expect(draft.wpOrders[0]?.trigger).toEqual({ type: 'IMMEDIATE' });
    expect(draft.wpOrders[1]?.trigger.type).toBe('AT_WAYPOINT');
  });

  it('captureRadiusNm defaults to 0.001 nm (~1.85m, meter-level precision)', () => {
    const draft = waypointsToProgDraft(fakePlan(), false);
    expect(draft.wpOrders[0]?.captureRadiusNm).toBe(0.001);
  });

  it('omits the sailAuto bootstrap when sailAutoAlready=true; first WP trigger stays IMMEDIATE', () => {
    const draft = waypointsToProgDraft(fakePlan(), true);
    expect(draft.sailOrders).toEqual([]);
    // The first WP must remain the IMMEDIATE chain head — its trigger should
    // not have shifted to AT_WAYPOINT just because the bootstrap was skipped.
    expect(draft.wpOrders[0]?.trigger).toEqual({ type: 'IMMEDIATE' });
    expect(draft.wpOrders[1]?.trigger.type).toBe('AT_WAYPOINT');
  });

  it('skips waypoints within 1 nm of the boat start (avoids redundant "WP 1" near origin)', () => {
    // First inflection is ~0.3 nm from the start (lat delta ~0.005° ≈ 0.3 nm)
    // — should be filtered out. The next one (47, -3) stays.
    const planWithCloseFirstInflection: RoutePlan = {
      ...fakePlan(),
      waypoints: [
        { lat: 46, lon: -4 },
        { lat: 46.005, lon: -4.001 }, // ~0.3 nm — skip
        { lat: 47, lon: -3 },         // ~76 nm — keep
      ],
    };
    const draft = waypointsToProgDraft(planWithCloseFirstInflection, true);
    // Without the skip we'd have 2 WPs; with the proximity filter we have 1.
    expect(draft.wpOrders).toHaveLength(1);
    expect(draft.wpOrders[0]?.lat).toBe(47);
    // First (and only) WP remains the IMMEDIATE chain head.
    expect(draft.wpOrders[0]?.trigger).toEqual({ type: 'IMMEDIATE' });
  });
});
