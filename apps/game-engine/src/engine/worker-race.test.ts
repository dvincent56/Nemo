import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Regression: the worker's message handler used to run the tick synchronously,
 * so if both 'tick' and 'ingestOrder' landed in the message queue in that
 * order, the tick would execute without seeing the order (processed next tick
 * only). The fix yields to the microtask / immediate queue so pending
 * ingestOrder messages are handled before the tick body runs.
 *
 * We don't spin up a real Worker here — instead we model the handler pattern
 * and verify the ordering guarantee.
 */

test('setImmediate drains pending ingest before tick processing', async () => {
  const events: string[] = [];

  // Simulate: 'tick' arrived first, then 'ingestOrder' right behind it.
  // Both are enqueued as microtasks (representing queued messages).
  const tickHandler = async (): Promise<void> => {
    // Fix: yield so queued ingestOrder runs first.
    await new Promise((r) => setImmediate(r));
    events.push('tick-body');
  };

  // Run tick handler (it will yield)
  const tickPromise = tickHandler();
  // Enqueue an ingestOrder handler as a regular microtask — it must run
  // before the tick body thanks to the setImmediate yield.
  Promise.resolve().then(() => events.push('ingest'));

  await tickPromise;

  assert.deepEqual(
    events,
    ['ingest', 'tick-body'],
    'ingest must execute before tick body after setImmediate yield',
  );
});

test('without drain, tick runs before queued ingest (documents prior bug)', async () => {
  const events: string[] = [];

  // Synchronous tick body — no yield. This is the old buggy behavior.
  const tickHandler = (): void => {
    events.push('tick-body');
  };

  tickHandler();
  // A microtask queued after the synchronous tick would run too late.
  Promise.resolve().then(() => events.push('ingest'));

  // Flush microtasks
  await Promise.resolve();

  assert.deepEqual(events, ['tick-body', 'ingest']);
});
