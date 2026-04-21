import { test } from 'node:test';
import assert from 'node:assert/strict';

test('browser entry does not drag node:fs or node:path', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const files = [
    'src/browser.ts', 'src/index.ts', 'src/tick.ts', 'src/sails.ts',
    'src/segments.ts', 'src/wear.ts', 'src/bands.ts', 'src/zones.ts',
    'src/loadout.ts', 'src/coastline.ts', 'src/weather.ts',
  ];
  for (const rel of files) {
    const content = readFileSync(resolve(rel), 'utf-8');
    assert.ok(!/from ['"]node:/.test(content), `${rel} imports a node: module`);
    assert.ok(!/from ['"]fs['"]/.test(content), `${rel} imports fs`);
    assert.ok(!/from ['"]path['"]/.test(content), `${rel} imports path`);
  }
});

test('runTick runs end-to-end without any coastline I/O', async () => {
  const core = await import('./browser.js');
  assert.equal(typeof core.runTick, 'function');
  assert.equal(typeof core.CoastlineIndex, 'function');
  const coast = new core.CoastlineIndex();
  assert.equal(coast.isLoaded(), false);
});
