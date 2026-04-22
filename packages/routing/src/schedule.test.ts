// packages/routing/src/schedule.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RoutePolylinePoint } from './types';
import type { SailId } from '@nemo/shared-types';
import { buildCapSchedule } from './schedule';

function pp(ms: number, lat: number, lon: number, sail: SailId, twa = 0): RoutePolylinePoint {
  return { lat, lon, timeMs: ms, twa, tws: 12, bsp: 8, sail };
}

test('buildCapSchedule emits on heading change above threshold', () => {
  // East, east, then hard turn north — TWA shift across the turn prevents
  // the twa-lock detector from collapsing this into a single entry.
  const line: RoutePolylinePoint[] = [
    pp(0, 0, 0, 'JIB', 90),
    pp(3600_000, 0, 0.5, 'JIB', 90),
    pp(7200_000, 0, 1.0, 'JIB', 180),
    pp(10800_000, 0.5, 1.0, 'JIB', 180),
  ];
  const sched = buildCapSchedule(line, 5);
  assert.equal(sched.length, 2, 'initial + one turn');
  assert.ok(Math.abs(sched[0]!.cap - 90) < 1, `initial cap ~east, got ${sched[0]!.cap}`);
  assert.ok(Math.abs(sched[1]!.cap) < 1 || Math.abs(sched[1]!.cap - 360) < 1, `turn to ~north, got ${sched[1]!.cap}`);
  assert.ok(sched.every((e) => e.twaLock === undefined), 'no twa-lock for short, heading-change-dominated runs');
});

test('buildCapSchedule emits twa-lock when TWA is stable while CAP rotates', () => {
  // 4 segments with TWA held at 60° and heading rotating gradually from
  // ~90° to ~128° — classic "wind shift, hold TWA" scenario.
  const line: RoutePolylinePoint[] = [
    pp(0,          0.00,  0.00, 'JIB', 60),
    pp(3600_000,   0.00,  0.50, 'JIB', 60),  // cap ~90
    pp(7200_000,  -0.10,  0.95, 'JIB', 60),  // cap ~102
    pp(10800_000, -0.25,  1.35, 'JIB', 60),  // cap ~115
    pp(14400_000, -0.45,  1.70, 'JIB', 60),  // cap ~128
  ];
  const sched = buildCapSchedule(line, 5);
  const lockEntry = sched.find((e) => e.twaLock !== undefined);
  assert.ok(lockEntry, 'schedule contains a twa-lock entry');
  assert.ok(Math.abs(lockEntry!.twaLock! - 60) < 1, `twaLock ≈ 60, got ${lockEntry!.twaLock}`);
});

test('buildCapSchedule emits sail change on next segment', () => {
  const line: RoutePolylinePoint[] = [
    pp(0, 0, 0, 'JIB'),
    pp(3600_000, 0, 0.5, 'JIB'),
    pp(7200_000, 0, 1.0, 'SPI'),
  ];
  const sched = buildCapSchedule(line, 5);
  const withSail = sched.find((e) => e.sail === 'SPI');
  assert.ok(withSail, 'schedule contains a SPI entry');
});
