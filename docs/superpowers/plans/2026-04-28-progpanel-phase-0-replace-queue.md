# ProgPanel Phase 0 — `ORDER_REPLACE_QUEUE` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add wire + engine support for atomically replacing a boat's user-modifiable order queue, preserving consumed history. Phase 0 prerequisite for the ProgPanel V2 redesign (cf. `docs/superpowers/specs/2026-04-28-progpanel-redesign-design.md`).

**Architecture:** New WS message `ORDER_REPLACE_QUEUE { orders: Order[], clientTs, clientSeq }` flows client → ws-gateway → Redis → engine manager → tick worker. Worker drops envelopes that are *not* `completed`, ingests the new ones via the existing path. Consumed history (orders with `completed: true`) is preserved unchanged.

**Tech Stack:** TypeScript strict, msgpack-lite over WebSocket, Redis pub/sub, Node `worker_threads`, `node:test` runtime, `tsx` for test execution.

---

## File map

**Modified:**
- `packages/shared-types/src/index.ts` — extend with `ReplaceQueuePayload`
- `packages/game-engine-core/src/orderHistory.ts` — new exported pure function `replaceUserQueue`
- `packages/game-engine-core/src/index.ts` — re-export `replaceUserQueue`
- `apps/game-engine/src/engine/worker.ts` — handle `replaceUserQueue` worker message
- `apps/game-engine/src/engine/manager.ts` — subscribe to new Redis channel `boat:{boatId}:replace-queue`
- `apps/ws-gateway/src/index.ts` — handle inbound `ORDER_REPLACE_QUEUE` WS message
- `apps/web/src/lib/store/index.ts` — new `sendOrderReplaceQueue` helper

**Created (tests):**
- `packages/game-engine-core/src/orderHistory.replaceUserQueue.test.ts`
- `apps/game-engine/src/engine/worker.replace-queue.test.ts`
- `apps/ws-gateway/src/order-replace-queue.test.ts` (if a test harness exists for the gateway — otherwise unit-test the validation/build helper extracted)

---

## Conventions used in this plan

- Run tests for a package with `pnpm --filter @nemo/<pkg> test` from repo root.
- Run a single test file with `pnpm --filter @nemo/<pkg> test path/to/file.test.ts`.
- All new code is TypeScript strict; no `any`, prefer `unknown` + explicit narrowing.
- Commit messages follow the project style (cf. `git log` recent: `feat(scope): …`, `fix(scope): …`).

---

## Task 1: Add wire payload type to `@nemo/shared-types`

**Files:**
- Modify: `packages/shared-types/src/index.ts` (after the `OrderEnvelope` block, around line 88)

- [ ] **Step 1: Add the payload interface**

Locate the `OrderEnvelope` block (around line 80-88). Append immediately after it:

```ts
/**
 * Payload for the ORDER_REPLACE_QUEUE WS message (cf. spec
 * 2026-04-28-progpanel-redesign-design.md, Phase 0).
 *
 * Sent by a client (typically the ProgPanel commit action) to atomically
 * replace its boat's user-modifiable orders. Consumed history (envelopes
 * with `completed: true`) is preserved engine-side.
 */
export interface ReplaceQueuePayload {
  orders: Order[];
  clientTs: number;
  clientSeq: number;
}
```

- [ ] **Step 2: Build the package to verify types compile**

Run: `pnpm --filter @nemo/shared-types build`
Expected: build succeeds, no errors. (If the package has no build, run `pnpm --filter @nemo/shared-types typecheck` instead.)

- [ ] **Step 3: Commit**

```bash
git add packages/shared-types/src/index.ts
git commit -m "feat(shared-types): add ReplaceQueuePayload for ORDER_REPLACE_QUEUE"
```

---

## Task 2: Pure function `replaceUserQueue` in `engine-core`

**Files:**
- Modify: `packages/game-engine-core/src/orderHistory.ts` (append at bottom)
- Modify: `packages/game-engine-core/src/index.ts` (re-export)
- Create: `packages/game-engine-core/src/orderHistory.replaceUserQueue.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/game-engine-core/src/orderHistory.replaceUserQueue.test.ts`:

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { OrderEnvelope } from '@nemo/shared-types';
import { replaceUserQueue } from './orderHistory';

function makeEnvelope(opts: {
  id: string;
  effectiveTs: number;
  type?: OrderEnvelope['order']['type'];
  completed?: boolean;
  trigger?: OrderEnvelope['order']['trigger'];
  connectionId?: string;
  clientSeq?: number;
}): OrderEnvelope {
  return {
    order: {
      id: opts.id,
      type: opts.type ?? 'CAP',
      trigger: opts.trigger ?? { type: 'AT_TIME', time: Math.floor(opts.effectiveTs / 1000) },
      value: { heading: 200 },
      ...(opts.completed !== undefined ? { completed: opts.completed } : {}),
    },
    clientTs: opts.effectiveTs,
    clientSeq: opts.clientSeq ?? 0,
    trustedTs: opts.effectiveTs,
    effectiveTs: opts.effectiveTs,
    receivedAt: opts.effectiveTs,
    connectionId: opts.connectionId ?? 'conn-A',
  };
}

describe('replaceUserQueue', () => {
  it('preserves envelopes marked completed, drops the others, then appends new envelopes sorted by effectiveTs', () => {
    const history: OrderEnvelope[] = [
      makeEnvelope({ id: 'old-completed', effectiveTs: 1000, completed: true }),
      makeEnvelope({ id: 'old-future-cap', effectiveTs: 5000 }),
      makeEnvelope({ id: 'old-active-wpt', effectiveTs: 2000, type: 'WPT' }),
    ];
    const incoming: OrderEnvelope[] = [
      makeEnvelope({ id: 'new-1', effectiveTs: 4000, clientSeq: 10 }),
      makeEnvelope({ id: 'new-2', effectiveTs: 3000, clientSeq: 11 }),
    ];

    const out = replaceUserQueue(history, incoming);

    assert.deepEqual(out.map((e) => e.order.id), ['old-completed', 'new-2', 'new-1']);
  });

  it('returns the new envelopes sorted by effectiveTs even if input is unsorted', () => {
    const incoming: OrderEnvelope[] = [
      makeEnvelope({ id: 'c', effectiveTs: 3000 }),
      makeEnvelope({ id: 'a', effectiveTs: 1000 }),
      makeEnvelope({ id: 'b', effectiveTs: 2000 }),
    ];

    const out = replaceUserQueue([], incoming);

    assert.deepEqual(out.map((e) => e.order.id), ['a', 'b', 'c']);
  });

  it('is a no-op on history when incoming is empty (still drops non-completed)', () => {
    const history: OrderEnvelope[] = [
      makeEnvelope({ id: 'kept', effectiveTs: 1000, completed: true }),
      makeEnvelope({ id: 'dropped', effectiveTs: 2000 }),
    ];

    const out = replaceUserQueue(history, []);

    assert.deepEqual(out.map((e) => e.order.id), ['kept']);
  });

  it('preserves completed history regardless of effectiveTs ordering vs incoming', () => {
    const history: OrderEnvelope[] = [
      makeEnvelope({ id: 'completed-future', effectiveTs: 9000, completed: true }),
    ];
    const incoming: OrderEnvelope[] = [
      makeEnvelope({ id: 'new', effectiveTs: 1000 }),
    ];

    const out = replaceUserQueue(history, incoming);

    assert.deepEqual(out.map((e) => e.order.id), ['completed-future', 'new']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @nemo/game-engine-core test src/orderHistory.replaceUserQueue.test.ts`
Expected: FAIL with `replaceUserQueue is not exported` or similar.

- [ ] **Step 3: Implement `replaceUserQueue`**

Append to the bottom of `packages/game-engine-core/src/orderHistory.ts`:

```ts
/**
 * Atomically replaces the user-modifiable portion of an envelope history.
 *
 * Envelopes with `order.completed === true` are kept (consumed history is
 * preserved for replay/debug and so the engine doesn't "resurrect" already-
 * crossed waypoints or already-fired CAP orders). All other envelopes are
 * dropped and replaced by `incoming`, which is appended after the kept
 * history, sorted ascending by `effectiveTs` (matches the existing insertion
 * invariant maintained by `onOrderReceived` and the worker `ingestOrder`).
 *
 * Pure function. Caller is expected to feed `incoming` envelopes already
 * built via the same shape as `onOrderReceived` (with trustedTs / effectiveTs
 * computed by the gateway) — this function does not derive timestamps.
 *
 * Cf. spec `docs/superpowers/specs/2026-04-28-progpanel-redesign-design.md`
 * Phase 0 ("ORDER_REPLACE_QUEUE").
 */
export function replaceUserQueue(
  history: OrderEnvelope[],
  incoming: OrderEnvelope[],
): OrderEnvelope[] {
  const completed = history.filter((e) => e.order.completed === true);
  const sortedIncoming = incoming.slice().sort((a, b) => a.effectiveTs - b.effectiveTs);
  return [...completed, ...sortedIncoming];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @nemo/game-engine-core test src/orderHistory.replaceUserQueue.test.ts`
Expected: PASS, all 4 cases green.

- [ ] **Step 5: Re-export from package index**

Modify `packages/game-engine-core/src/index.ts`. Find the existing export block from `./orderHistory` (search for `supersedeHeadingIntent` if needed) and add `replaceUserQueue`. If there is no existing export, add a fresh block:

```ts
export { supersedeHeadingIntent, replaceUserQueue } from './orderHistory';
```

If `supersedeHeadingIntent` is already re-exported elsewhere or via `*`, just add `replaceUserQueue` next to it.

- [ ] **Step 6: Verify the package still typechecks**

Run: `pnpm --filter @nemo/game-engine-core typecheck` (or `build`).
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/game-engine-core/src/orderHistory.ts packages/game-engine-core/src/orderHistory.replaceUserQueue.test.ts packages/game-engine-core/src/index.ts
git commit -m "feat(engine-core): add replaceUserQueue helper for ORDER_REPLACE_QUEUE"
```

---

## Task 3: Worker handles `replaceUserQueue` message

**Files:**
- Modify: `apps/game-engine/src/engine/worker.ts`
- Create: `apps/game-engine/src/engine/worker.replace-queue.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/game-engine/src/engine/worker.replace-queue.test.ts`. This test mirrors the style of `worker-race.test.ts` (in-process simulation of the worker's message handler logic, no actual `worker_threads` spawn — exercises the dispatch table directly).

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { OrderEnvelope } from '@nemo/shared-types';
import type { BoatRuntime } from '@nemo/game-engine-core';
// We import the pure handler so we can drive it without spawning a worker.
// The handler is extracted in step 3 below.
import { handleReplaceUserQueue } from './worker.handlers';

function makeRuntime(boatId: string, history: OrderEnvelope[] = []): BoatRuntime {
  // The handler only reads boat.id and orderHistory; the other fields are
  // not touched. Cast through unknown to bypass strict shape checking for
  // this test stub. If you need a fuller fixture, use the helper at
  // packages/game-engine-core/src/tick.transition.test.ts (search makeRuntime).
  return ({
    boat: { id: boatId },
    orderHistory: history,
  } as unknown) as BoatRuntime;
}

function envelope(opts: {
  id: string;
  effectiveTs: number;
  completed?: boolean;
  type?: 'CAP' | 'WPT' | 'TWA' | 'SAIL' | 'MODE' | 'VMG';
}): OrderEnvelope {
  return {
    order: {
      id: opts.id,
      type: opts.type ?? 'CAP',
      trigger: { type: 'AT_TIME', time: Math.floor(opts.effectiveTs / 1000) },
      value: {},
      ...(opts.completed !== undefined ? { completed: opts.completed } : {}),
    },
    clientTs: opts.effectiveTs,
    clientSeq: 0,
    trustedTs: opts.effectiveTs,
    effectiveTs: opts.effectiveTs,
    receivedAt: opts.effectiveTs,
    connectionId: 'c',
  };
}

describe('handleReplaceUserQueue', () => {
  it('replaces a target boat orderHistory while preserving completed history', () => {
    const runtimes: BoatRuntime[] = [
      makeRuntime('boat-A', [
        envelope({ id: 'old-done', effectiveTs: 100, completed: true }),
        envelope({ id: 'old-future', effectiveTs: 200 }),
      ]),
      makeRuntime('boat-B', [envelope({ id: 'b1', effectiveTs: 100 })]),
    ];

    const result = handleReplaceUserQueue(runtimes, {
      boatId: 'boat-A',
      envelopes: [envelope({ id: 'new-1', effectiveTs: 300 })],
    });

    assert.deepEqual(result.map((r) => r.boat.id), ['boat-A', 'boat-B']);
    assert.deepEqual(result[0]!.orderHistory.map((e) => e.order.id), ['old-done', 'new-1']);
    // Other boat untouched
    assert.deepEqual(result[1]!.orderHistory.map((e) => e.order.id), ['b1']);
  });

  it('returns runtimes unchanged when boatId does not match', () => {
    const runtimes: BoatRuntime[] = [makeRuntime('boat-A', [envelope({ id: 'x', effectiveTs: 1 })])];

    const result = handleReplaceUserQueue(runtimes, {
      boatId: 'boat-Z',
      envelopes: [envelope({ id: 'new', effectiveTs: 2 })],
    });

    assert.deepEqual(result, runtimes);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @nemo/game-engine test src/engine/worker.replace-queue.test.ts`
Expected: FAIL with `Cannot find module './worker.handlers'`.

- [ ] **Step 3: Extract a pure handler module**

The current `worker.ts` puts message dispatch logic inline in `parentPort.on('message', ...)`. To make the handler testable, extract it.

Create `apps/game-engine/src/engine/worker.handlers.ts`:

```ts
import type { OrderEnvelope } from '@nemo/shared-types';
import { replaceUserQueue, type BoatRuntime } from '@nemo/game-engine-core';

export interface ReplaceUserQueueMsg {
  boatId: string;
  envelopes: OrderEnvelope[];
}

/**
 * Pure handler — replaces the target boat's order history (preserving
 * completed envelopes), no I/O, no logging. Returns a new runtimes array
 * with the affected entry rebuilt; other entries are returned by reference.
 *
 * Cf. spec 2026-04-28-progpanel-redesign-design.md Phase 0.
 */
export function handleReplaceUserQueue(
  runtimes: BoatRuntime[],
  msg: ReplaceUserQueueMsg,
): BoatRuntime[] {
  const idx = runtimes.findIndex((r) => r.boat.id === msg.boatId);
  if (idx < 0) return runtimes;
  const rt = runtimes[idx]!;
  const nextHistory = replaceUserQueue(rt.orderHistory, msg.envelopes);
  const next = runtimes.slice();
  next[idx] = { ...rt, orderHistory: nextHistory };
  return next;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @nemo/game-engine test src/engine/worker.replace-queue.test.ts`
Expected: PASS, both cases green.

- [ ] **Step 5: Wire the handler into the worker**

Modify `apps/game-engine/src/engine/worker.ts`. At the top, add the import:

```ts
import { handleReplaceUserQueue } from './worker.handlers.js';
```

(Note the `.js` extension — required for ESM resolution in this project.)

Locate the `WorkerMsg` union (around line 20-24) and extend it:

```ts
type WorkerMsg =
  | { kind: 'tick' }
  | { kind: 'stop' }
  | { kind: 'setRuntimes'; runtimes: BoatRuntime[] }
  | { kind: 'ingestOrder'; boatId: string; envelope: OrderEnvelope }
  | { kind: 'replaceUserQueue'; boatId: string; envelopes: OrderEnvelope[] };
```

In the `parentPort.on('message', (msg: WorkerMsg) => { ... })` block, add a new branch immediately before the `if (msg.kind === 'tick')` branch:

```ts
    if (msg.kind === 'replaceUserQueue') {
      const before = runtimes.find((r) => r.boat.id === msg.boatId)?.orderHistory.length ?? 0;
      runtimes = handleReplaceUserQueue(runtimes, msg);
      const after = runtimes.find((r) => r.boat.id === msg.boatId)?.orderHistory.length ?? 0;
      log.info(
        { boatId: msg.boatId, before, after, incoming: msg.envelopes.length },
        'order queue replaced',
      );
      return;
    }
```

- [ ] **Step 6: Typecheck the worker package**

Run: `pnpm --filter @nemo/game-engine typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/game-engine/src/engine/worker.ts apps/game-engine/src/engine/worker.handlers.ts apps/game-engine/src/engine/worker.replace-queue.test.ts
git commit -m "feat(game-engine): worker handles replaceUserQueue message"
```

---

## Task 4: Manager subscribes to new Redis channel

**Files:**
- Modify: `apps/game-engine/src/engine/manager.ts`
- Modify: `apps/game-engine/src/infra/redis.ts` (where `CHANNELS` is defined, line 39)

- [ ] **Step 1: Add the new channel patterns**

Open `apps/game-engine/src/infra/redis.ts`, locate the `CHANNELS` const around line 39 (containing `boatOrderPattern`). Mirror the existing shape exactly when adding the two new entries below — if it's a plain object, append literally; if it's wrapped (e.g. `as const`), preserve the wrapping:

```ts
// Inside CHANNELS, alongside boatOrderPattern:
boatReplaceQueuePattern: 'boat:*:replace-queue',
boatReplaceQueue: (boatId: string) => `boat:${boatId}:replace-queue`,
```

- [ ] **Step 2: Subscribe in the manager**

In `apps/game-engine/src/engine/manager.ts`, locate `subscribeOrders` (around line 255). Duplicate the pattern as a new method `subscribeReplaceQueues`:

```ts
  private async subscribeReplaceQueues(): Promise<void> {
    if (!this.redis) return;
    await this.redis.sub.psubscribe(CHANNELS.boatReplaceQueuePattern);
    this.redis.sub.on('pmessageBuffer', (_pattern, channel, message) => {
      const channelStr = channel.toString();
      const m = /^boat:([^:]+):replace-queue$/.exec(channelStr);
      if (!m) return;
      const boatId = m[1]!;
      let envelopes: OrderEnvelope[];
      try {
        const decoded = decode(message) as { envelopes?: unknown };
        if (!Array.isArray(decoded.envelopes)) {
          log.warn({ channel: channelStr }, 'replace-queue payload missing envelopes array');
          return;
        }
        envelopes = decoded.envelopes as OrderEnvelope[];
      } catch (err) {
        log.warn({ err, channel: channelStr }, 'invalid replace-queue payload');
        return;
      }
      this.worker?.postMessage({ kind: 'replaceUserQueue', boatId, envelopes });
    });
  }
```

Find the place in the manager where `subscribeOrders()` is called (during start or init) and add a call to `subscribeReplaceQueues()` next to it.

**Important:** the existing `subscribeOrders` uses a single Redis subscriber instance and registers ONE `'pmessageBuffer'` handler. Two `psubscribe` calls on the same `sub` connection are valid, but two separate handlers means *both* handlers fire for *both* patterns and each must filter by channel name (which the regex-based filtering already does). Verify the handler chain works — if the existing handler returns early on regex miss, the new handler will still receive the message. This is fine but worth confirming.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @nemo/game-engine typecheck`
Expected: no errors.

- [ ] **Step 4: Manual smoke check (if a dev redis is reachable)**

Skipped if no local Redis. Otherwise:

```bash
# In one terminal — start the engine in dev mode
pnpm --filter @nemo/game-engine dev

# In another — publish a synthetic replace-queue message
redis-cli PUBLISH "boat:test-boat:replace-queue" "$(echo -n '{"envelopes":[]}' | xxd -p | tr -d '\n')"
```

Expected: the engine logs `order queue replaced` with `boatId: test-boat`. (The malformed binary will get rejected by msgpack decode but the regex match will fire — adjust the redis-cli payload to msgpack if you want full-path validation; otherwise this step just confirms the channel subscription is alive.)

- [ ] **Step 5: Commit**

```bash
git add apps/game-engine/src/engine/manager.ts apps/game-engine/src/infra/redis.ts
git commit -m "feat(game-engine): subscribe boat:*:replace-queue and forward to worker"
```

---

## Task 5: ws-gateway accepts `ORDER_REPLACE_QUEUE`

**Files:**
- Modify: `apps/ws-gateway/src/index.ts`

The gateway is the choke point that turns a wire message into a Redis publish. We extend the existing message handler.

- [ ] **Step 1: Read the existing ORDER handler shape**

Read `apps/ws-gateway/src/index.ts` around lines 143-193 (the `ws.on('message', ...)` block). Note the helper logic: msgpack decode → check `decoded['type']` → build envelope → publish.

- [ ] **Step 2: Extract the envelope-builder helper**

The existing handler builds an `OrderEnvelope` inline. Extract it so we can reuse it for the replace-queue path. Add this helper at the top of `apps/ws-gateway/src/index.ts` (after imports, before the function defining the WS server):

```ts
import type { Order, OrderEnvelope, OrderTrigger } from '@nemo/shared-types';

const CLIENT_TS_TOLERANCE_MS = 2000;

function computeEffectiveTs(trigger: OrderTrigger, trustedTs: number): number {
  if (trigger.type === 'AT_TIME' && typeof (trigger as { time: number }).time === 'number') {
    return (trigger as { time: number }).time * 1000;
  }
  return trustedTs;
}

function buildEnvelope(args: {
  rawOrder: Record<string, unknown>;
  clientTs: number;
  clientSeq: number;
  connectionId: string;
  serverNow: number;
}): OrderEnvelope | null {
  const { rawOrder, clientTs, clientSeq, connectionId, serverNow } = args;
  if (typeof rawOrder['type'] !== 'string') return null;
  const trustedTs = Math.abs(serverNow - clientTs) < CLIENT_TS_TOLERANCE_MS ? clientTs : serverNow;
  const trigger = (rawOrder['trigger'] as OrderTrigger) ?? { type: 'IMMEDIATE' };
  const effectiveTs = computeEffectiveTs(trigger, trustedTs);
  const order: Order = {
    id: (rawOrder['id'] as string) ?? `${connectionId}-${clientSeq}`,
    type: rawOrder['type'] as Order['type'],
    value: (rawOrder['value'] as Record<string, unknown>) ?? {},
    trigger,
  };
  return {
    order,
    clientTs,
    clientSeq,
    trustedTs,
    effectiveTs,
    receivedAt: serverNow,
    connectionId,
  };
}
```

Then **refactor** the existing ORDER branch (lines 153-192) to use `buildEnvelope`:

```ts
        if (decoded['type'] === 'ORDER') {
          const payload = (decoded['payload'] as Record<string, unknown>) ?? {};
          const clientTs = Number(payload['clientTs'] ?? payload['ts'] ?? Date.now());
          const clientSeq = Number(payload['clientSeq'] ?? 0);
          const rawOrder = payload['order'] as Record<string, unknown> | undefined;
          if (!rawOrder) {
            log.warn({ conn: ctx.connectionId }, 'malformed ORDER payload');
            return;
          }
          const envelope = buildEnvelope({
            rawOrder,
            clientTs,
            clientSeq,
            connectionId: ctx.connectionId,
            serverNow: Date.now(),
          });
          if (!envelope) {
            log.warn({ conn: ctx.connectionId }, 'malformed ORDER payload');
            return;
          }
          if (!ctx.boatId || !pub) {
            log.warn({ conn: ctx.connectionId, hasBoat: !!ctx.boatId, hasRedis: !!pub }, 'order dropped');
            return;
          }
          pub.publish(`boat:${ctx.boatId}:order`, Buffer.from(encode(envelope)))
            .catch((err) => log.error({ err, boatId: ctx.boatId }, 'publish order failed'));
          log.info({ conn: ctx.connectionId, boat: ctx.boatId, type: envelope.order.type, clientSeq }, 'order forwarded');
          return;
        }
```

- [ ] **Step 3: Add the ORDER_REPLACE_QUEUE branch**

Right after the refactored ORDER branch (still inside the `ws.on('message', ...)` callback):

```ts
        if (decoded['type'] === 'ORDER_REPLACE_QUEUE') {
          const payload = (decoded['payload'] as Record<string, unknown>) ?? {};
          const clientTs = Number(payload['clientTs'] ?? Date.now());
          const clientSeq = Number(payload['clientSeq'] ?? 0);
          const rawOrders = payload['orders'];
          if (!Array.isArray(rawOrders)) {
            log.warn({ conn: ctx.connectionId }, 'malformed ORDER_REPLACE_QUEUE payload');
            return;
          }
          if (!ctx.boatId || !pub) {
            log.warn({ conn: ctx.connectionId, hasBoat: !!ctx.boatId, hasRedis: !!pub }, 'replace-queue dropped');
            return;
          }
          const serverNow = Date.now();
          const envelopes: OrderEnvelope[] = [];
          for (let i = 0; i < rawOrders.length; i++) {
            const env = buildEnvelope({
              rawOrder: rawOrders[i] as Record<string, unknown>,
              clientTs,
              clientSeq: clientSeq + i, // unique per envelope inside the batch
              connectionId: ctx.connectionId,
              serverNow,
            });
            if (env) envelopes.push(env);
          }
          pub.publish(
            `boat:${ctx.boatId}:replace-queue`,
            Buffer.from(encode({ envelopes })),
          ).catch((err) => log.error({ err, boatId: ctx.boatId }, 'publish replace-queue failed'));
          log.info(
            { conn: ctx.connectionId, boat: ctx.boatId, count: envelopes.length, clientSeq },
            'replace-queue forwarded',
          );
          return;
        }
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @nemo/ws-gateway typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/ws-gateway/src/index.ts
git commit -m "feat(ws-gateway): accept ORDER_REPLACE_QUEUE and publish to boat:*:replace-queue"
```

---

## Task 6: Client `sendOrderReplaceQueue` helper

**Files:**
- Modify: `apps/web/src/lib/store/index.ts`

- [ ] **Step 1: Locate the existing `sendOrder`**

Read `apps/web/src/lib/store/index.ts` around line 282 (the `sendOrder` function).

- [ ] **Step 2: Add the new helper**

Immediately after the `sendOrder` function definition, add:

```ts
export interface ReplaceQueueOrderInput {
  type: 'CAP' | 'TWA' | 'WPT' | 'SAIL' | 'MODE' | 'VMG';
  value: Record<string, unknown>;
  trigger?: import('@nemo/shared-types').OrderTrigger;
}

/**
 * Atomically replaces the user-modifiable portion of the boat's order queue
 * on the server (cf. spec 2026-04-28-progpanel-redesign-design.md Phase 0).
 *
 * Returns true if the WS frame was sent, false if the connection is not
 * open. Does NOT update the local store — callers (typically the ProgPanel
 * commit handler) are responsible for the optimistic mirror.
 */
export function sendOrderReplaceQueue(orders: ReplaceQueueOrderInput[]): boolean {
  if (!activeConnection?.ws || activeConnection.ws.readyState !== WebSocket.OPEN) return false;
  activeConnection.clientSeq += 1;
  const baseSeq = activeConnection.clientSeq;
  const envelope = {
    type: 'ORDER_REPLACE_QUEUE',
    payload: {
      orders: orders.map((o, i) => ({
        id: `${activeConnection!.raceId}-${baseSeq}-${i}`,
        type: o.type,
        value: o.value,
        trigger: o.trigger ?? { type: 'IMMEDIATE' },
      })),
      clientTs: Date.now(),
      clientSeq: baseSeq,
    },
  };
  activeConnection.ws.send(encode(envelope));
  return true;
}
```

- [ ] **Step 3: Typecheck the web app**

Run: `pnpm --filter @nemo/web typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/store/index.ts
git commit -m "feat(web): add sendOrderReplaceQueue helper"
```

---

## Task 7: End-to-end smoke test

**Files:**
- Create: `apps/game-engine/src/engine/replace-queue.e2e.test.ts` (or place in an existing e2e folder if one exists; check `apps/game-engine/src/test/`)

- [ ] **Step 1: Inspect existing e2e style**

List `apps/game-engine/src/test/` and look for an existing test that wires `manager + worker + redis` together. If a redis mock is used (e.g., `ioredis-mock`), use the same setup.

If no e2e harness exists, **skip this task** and document in the commit message that e2e validation will rely on the unit tests of Tasks 2/3 + a manual smoke run.

- [ ] **Step 2: If a harness exists — write the test**

The test should:

1. Spin up a manager with one runtime for `boat-A`, including 1 order envelope `completed: true` and 1 order envelope `completed: false` in its history.
2. Publish a `replace-queue` message to `boat:boat-A:replace-queue` containing 2 new envelopes.
3. Wait for the worker to process the message (use the existing test helper, typically a `await tick()` or polling on `runtime.orderHistory.length`).
4. Assert `runtime.orderHistory` contains exactly: the completed envelope + the 2 new ones, in `effectiveTs` order.

If the harness uses real Redis, gate the test behind `process.env.NEMO_TEST_REDIS_URL` like the project's other Redis-touching tests do.

- [ ] **Step 3: Run the test**

Run: `pnpm --filter @nemo/game-engine test src/engine/replace-queue.e2e.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/game-engine/src/engine/replace-queue.e2e.test.ts
git commit -m "test(game-engine): e2e for ORDER_REPLACE_QUEUE wire path"
```

**STATUS:** Skipped per plan's escape hatch. Rationale: this monorepo has no Redis-mock harness and no precedent for spinning the manager + worker + Redis stack in tests. The pattern of every existing layer (subscribeOrders, the WS gateway ORDER handler, sendOrder) is to rely on unit tests at the handler level + manual smoke runs. The wire path `client → ws-gateway → Redis → manager → worker → engine` for ORDER_REPLACE_QUEUE follows the exact same pattern as the established ORDER path; if either path breaks at the integration level, both will surface together at first manual run of the new ProgPanel commit flow (Phase 2). Task 3 code review flagged this as Important #1 — that note remains valid and accepted.

---

## Task 8: Document WP_REACHED decision

**Files:**
- Modify: `docs/superpowers/specs/2026-04-28-progpanel-redesign-design.md`

This is a doc-only task that closes the open decision in the spec.

- [ ] **Step 1: Pick the option**

Re-read the spec section "Signal `WP_REACHED`". Decision: for V1, **keep the existing client heuristic** (`haversinePosNM` + boat lat/lon). Rationale: zero protocol change, the desync window is bounded by the tick rate (≤ 30s) and the user can't observably do anything with a "still there" WP that's already crossed (the boat is already past it on the next snapshot anyway). The protocol-level signal can be added later if a user-visible bug surfaces.

- [ ] **Step 2: Update the spec**

In `docs/superpowers/specs/2026-04-28-progpanel-redesign-design.md`, locate the `### Signal WP_REACHED` section (in Phase 0). Replace its body with:

```markdown
### Signal `WP_REACHED`

V1 décision : **on garde l'heuristique client existante** (cf. ProgPanel.tsx:101-138). Le client retire un WP de `committed.wpOrders` dès qu'il détecte capture local via `haversinePosNM`. Le moteur, à la prochaine `ORDER_REPLACE_QUEUE`, ne verra pas le WP retiré et ne fera rien de spécial.

Rationale : zéro changement de protocole, fenêtre de désync bornée par le tick rate (≤ 30s), le joueur ne peut rien observer d'incohérent (le bateau est déjà passé). Si un bug utilisateur apparaît plus tard, on ajoutera un champ `consumedOrderIds` au snapshot tick (option 2 du draft précédent).
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-04-28-progpanel-redesign-design.md
git commit -m "docs(specs): WP_REACHED v1 = client heuristic, defer protocol signal"
```

---

## Task 9: Run the full test suite

- [ ] **Step 1: Repo-wide test**

Run: `pnpm test` (or `pnpm -r test` if that's the project's incantation — check `package.json` root scripts).
Expected: all packages green, no regression in `Compass`, `tick.wpt`, or `applyRoute` paths.

- [ ] **Step 2: Repo-wide typecheck**

Run: `pnpm -r typecheck` (or `pnpm typecheck`).
Expected: no errors.

- [ ] **Step 3: If green — final tag commit (optional)**

```bash
git commit --allow-empty -m "chore: ProgPanel Phase 0 complete (ORDER_REPLACE_QUEUE wired end-to-end)"
```

---

## Self-review notes (for the implementer)

- The `clientSeq` strategy in Task 5 (incrementing per envelope inside the batch) means dedup is preserved — the same WS connection cannot replay an `ORDER_REPLACE_QUEUE` with the same `clientSeq` and have it accepted twice as fresh ORDERs. If you find that the engine `seenSeqs` dedup blocks the replace-queue path because it shares the same connectionId namespace, you may need to use a separate dedup namespace or skip dedup for replace-queue (the replace operation is idempotent at the queue level — the second one just produces the same result). Document the choice in the commit if you adjust it.
- Tasks 4 and 5 both depend on the `boat:*:replace-queue` channel naming. Keep the constant in sync.
- If `pnpm --filter @nemo/<pkg> test path/to/file` doesn't accept a path arg in this project, fall back to `pnpm --filter @nemo/<pkg> test` (runs all tests) or invoke `node --test` / `tsx --test` directly per the project's existing scripts.
