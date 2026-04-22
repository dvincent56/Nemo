// packages/routing/src/schedule.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RoutePolylinePoint } from './types';
import type { SailId } from '@nemo/shared-types';
import { buildCapSchedule } from './schedule';

function pp(ms: number, lat: number, lon: number, sail: SailId): RoutePolylinePoint {
  return { lat, lon, timeMs: ms, twa: 0, tws: 12, bsp: 8, sail };
}

test('buildCapSchedule emits on heading change above threshold', () => {
  const line: RoutePolylinePoint[] = [
    pp(0, 0, 0, 'JIB'),
    pp(3600_000, 0, 0.5, 'JIB'),
    pp(7200_000, 0, 1.0, 'JIB'),
    pp(10800_000, 0.5, 1.0, 'JIB'),
  ];
  const sched = buildCapSchedule(line, 5);
  assert.equal(sched.length, 2, 'initial + one turn');
  assert.ok(Math.abs(sched[0]!.cap - 90) < 1, `initial cap ~east, got ${sched[0]!.cap}`);
  assert.ok(Math.abs(sched[1]!.cap) < 1 || Math.abs(sched[1]!.cap - 360) < 1, `turn to ~north, got ${sched[1]!.cap}`);
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
