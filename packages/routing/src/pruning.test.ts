// packages/routing/src/pruning.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { IsochronePoint } from './types';
import { pruneBySector, bearingDeg } from './pruning';

function pt(lat: number, lon: number, dist: number): IsochronePoint {
  return {
    lat, lon, hdg: 0, bsp: 0, tws: 0, twd: 0, twa: 0, sail: 'JIB',
    timeMs: 0, distFromStartNm: dist, parentIdx: -1,
  };
}

test('bearingDeg is east = 90', () => {
  const b = bearingDeg({ lat: 0, lon: 0 }, { lat: 0, lon: 1 });
  assert.ok(Math.abs(b - 90) < 0.1, `expected ~90, got ${b}`);
});

test('bearingDeg is north = 0', () => {
  const b = bearingDeg({ lat: 0, lon: 0 }, { lat: 1, lon: 0 });
  assert.ok(Math.abs(b) < 0.1 || Math.abs(b - 360) < 0.1, `expected ~0, got ${b}`);
});

test('pruneBySector keeps furthest per sector', () => {
  const origin = { lat: 0, lon: 0 };
  const pts: IsochronePoint[] = [
    pt(0, 0.1, 1),
    pt(0, 0.2, 2),
    pt(0, 0.05, 0.5),
    pt(1, 0, 10),
  ];
  const out = pruneBySector(pts, origin, 4);
  assert.ok(out.length <= 4);
  assert.ok(out.some(p => Math.abs(p.lon - 0.2) < 1e-6), 'furthest east survives');
  assert.ok(out.some(p => Math.abs(p.lat - 1) < 1e-6), 'furthest north survives');
  assert.ok(!out.some(p => Math.abs(p.lon - 0.1) < 1e-6), 'nearer east pruned');
});

test('pruneBySector bounds output by sectorCount', () => {
  const origin = { lat: 0, lon: 0 };
  const pts: IsochronePoint[] = [];
  for (let i = 0; i < 10000; i++) {
    const brg = (i * 360) / 10000;
    const rad = brg * Math.PI / 180;
    pts.push(pt(Math.cos(rad) * 0.1, Math.sin(rad) * 0.1, Math.random() * 5));
  }
  const out = pruneBySector(pts, origin, 360);
  assert.ok(out.length <= 360, `expected <= 360, got ${out.length}`);
});
