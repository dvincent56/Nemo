# Timeline & replay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the play-screen Timeline functional — DB-persisted track, scrub past/future, ghost boat, replay rendering, rank sparkline.

**Architecture:** Server persists 1 track point per hour per participant in `boat_track_points` (Drizzle/Postgres) with `ON DELETE CASCADE`. Next.js API endpoint `GET /api/v1/races/:raceId/participants/:pid/track` returns the chronological points. Client stores them in a new `trackSlice`, derives ghost position via selectors, and renders past trace + ghost on MapCanvas. WeatherTimeline gets a layout B refresh (bicolor bar + rank sparkline).

**Tech Stack:**
- Server: Drizzle ORM, Postgres, Fastify worker (apps/game-engine), msgpack/Redis pub-sub for WS, Next.js route handlers (apps/web/src/app/api/v1/...)
- Client: zustand store slices, MapLibre GL JS, React 19, Next.js app router
- Tests: `node:test` + `node:assert/strict` (no vitest), `tsx` runner

**Spec reference:** [docs/superpowers/specs/2026-04-25-timeline-replay-design.md](../specs/2026-04-25-timeline-replay-design.md)

---

## File Structure

### Created files
- `apps/game-engine/src/db/schema.ts` — append `boatTrackPoints` table
- `apps/game-engine/drizzle/<timestamp>_track_points.sql` — generated migration
- `apps/game-engine/src/engine/track-checkpoint.ts` — checkpoint enqueue + flush logic
- `apps/game-engine/src/engine/track-checkpoint.test.ts`
- `apps/game-engine/src/engine/rank.ts` — rank computation per race
- `apps/game-engine/src/engine/rank.test.ts`
- `apps/game-engine/src/engine/cleanup-track.ts` — `cleanupRaceTrackPoints(raceId)`
- `apps/game-engine/src/engine/cleanup-track.test.ts`
- `apps/game-engine/src/broadcast/track-event.ts` — `buildTrackPointAddedMsg`
- `apps/web/src/app/api/v1/races/[raceId]/participants/[participantId]/track/route.ts` — GET endpoint
- `apps/web/src/lib/store/trackSlice.ts`
- `apps/web/src/lib/store/timeline-selectors.ts` — pure selectors with tests
- `apps/web/src/lib/store/timeline-selectors.test.ts`
- `apps/web/src/hooks/useTrackHydration.ts`
- `apps/web/src/hooks/useTimelinePlayback.ts`
- `apps/web/src/components/play/timeline/TimelineHeader.tsx`
- `apps/web/src/components/play/timeline/TimelineHeader.module.css`
- `apps/web/src/components/play/timeline/RankSparkline.tsx`
- `apps/web/src/components/play/timeline/RankSparkline.module.css`
- `apps/web/src/components/play/timeline/TimelineTrack.tsx`
- `apps/web/src/components/play/timeline/TimelineTrack.module.css`
- `apps/web/src/components/play/timeline/ticks.ts` — tick scale calculation (pure)
- `apps/web/src/components/play/timeline/ticks.test.ts`
- `apps/web/src/components/play/timeline/lerp.ts` — position interpolation helpers (pure)
- `apps/web/src/components/play/timeline/lerp.test.ts`
- `apps/web/src/lib/api/track.ts` — `fetchTrack(raceId, participantId)`

### Modified files
- `apps/game-engine/src/engine/runtime.ts` — add `lastCheckpointTs` to `BoatRuntime`
- `apps/game-engine/src/engine/manager.ts` — wire checkpoint flush in `onTickDone`, emit WS event
- `apps/game-engine/src/broadcast/payload.ts` — add `TrackPointAdded` to `BroadcastMsg` union
- `apps/web/src/lib/store/types.ts` — add `TrackState`, extend `TimelineState`
- `apps/web/src/lib/store/timelineSlice.ts` — add new actions + initial fields
- `apps/web/src/lib/store/index.ts` — register `trackSlice`, dispatch `trackPointAdded` in `applyMessages`
- `apps/web/src/components/play/WeatherTimeline.tsx` — replace internals with new layout B (compose sub-components)
- `apps/web/src/components/play/MapCanvas.tsx` — add past-trace + ghost-boat sources/layers, dim weather layers when scrubbing back, dim projection line
- `apps/web/src/app/play/[raceId]/PlayClient.tsx` — wire race context + track hydration

---

## Phase A — Server foundation

### Task 1: Drizzle schema + migration for `boat_track_points`

**Files:**
- Modify: `apps/game-engine/src/db/schema.ts`
- Create: `apps/game-engine/drizzle/<auto>_track_points.sql` (via drizzle-kit)

- [ ] **Step 1: Add table definition to schema**

In `apps/game-engine/src/db/schema.ts`, append after `raceParticipants`:

```ts
import { pgTable, uuid, timestamp, doublePrecision, integer, primaryKey } from 'drizzle-orm/pg-core';

export const boatTrackPoints = pgTable(
  'boat_track_points',
  {
    participantId: uuid('participant_id')
      .notNull()
      .references(() => raceParticipants.id, { onDelete: 'cascade' }),
    ts: timestamp('ts', { withTimezone: true }).notNull(),
    lat: doublePrecision('lat').notNull(),
    lon: doublePrecision('lon').notNull(),
    rank: integer('rank').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.participantId, t.ts] }),
  }),
);
```

- [ ] **Step 2: Generate migration**

Run from `apps/game-engine/`:
```bash
pnpm drizzle-kit generate
```
Expected: a new file under `apps/game-engine/drizzle/` containing `CREATE TABLE "boat_track_points"` with the composite PK and FK.

- [ ] **Step 3: Apply migration locally**

```bash
pnpm drizzle-kit push
```
Expected: success message. Verify in psql:
```bash
psql $DATABASE_URL -c "\d boat_track_points"
```
Expected: 5 columns (`participant_id`, `ts`, `lat`, `lon`, `rank`), composite PK, FK to `race_participants(id) ON DELETE CASCADE`.

- [ ] **Step 4: Commit**

```bash
git add apps/game-engine/src/db/schema.ts apps/game-engine/drizzle/
git commit -m "feat(db): add boat_track_points table for timeline replay"
```

---

### Task 2: Pure rank computation helper

**Files:**
- Create: `apps/game-engine/src/engine/rank.ts`
- Create: `apps/game-engine/src/engine/rank.test.ts`

- [ ] **Step 1: Write failing test**

`apps/game-engine/src/engine/rank.test.ts`:
```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeRanks } from './rank.js';

describe('computeRanks', () => {
  it('ranks participants by ascending DTF (1 = closest to finish)', () => {
    const ranks = computeRanks([
      { participantId: 'a', dtfNm: 50 },
      { participantId: 'b', dtfNm: 10 },
      { participantId: 'c', dtfNm: 100 },
    ]);
    assert.equal(ranks.get('b'), 1);
    assert.equal(ranks.get('a'), 2);
    assert.equal(ranks.get('c'), 3);
  });

  it('handles a single participant', () => {
    const ranks = computeRanks([{ participantId: 'solo', dtfNm: 42 }]);
    assert.equal(ranks.get('solo'), 1);
  });

  it('handles ties deterministically by participantId asc', () => {
    const ranks = computeRanks([
      { participantId: 'b', dtfNm: 50 },
      { participantId: 'a', dtfNm: 50 },
    ]);
    assert.equal(ranks.get('a'), 1);
    assert.equal(ranks.get('b'), 2);
  });

  it('returns empty map on empty input', () => {
    const ranks = computeRanks([]);
    assert.equal(ranks.size, 0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/game-engine && pnpm test src/engine/rank.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`apps/game-engine/src/engine/rank.ts`:
```ts
export interface RankInput {
  participantId: string;
  dtfNm: number;
}

export function computeRanks(inputs: readonly RankInput[]): Map<string, number> {
  const sorted = [...inputs].sort((a, b) => {
    if (a.dtfNm !== b.dtfNm) return a.dtfNm - b.dtfNm;
    return a.participantId < b.participantId ? -1 : 1;
  });
  const ranks = new Map<string, number>();
  sorted.forEach((entry, idx) => {
    ranks.set(entry.participantId, idx + 1);
  });
  return ranks;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test src/engine/rank.test.ts
```
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/game-engine/src/engine/rank.ts apps/game-engine/src/engine/rank.test.ts
git commit -m "feat(engine): add pure rank computation helper"
```

---

### Task 3: Pure cleanup function

**Files:**
- Create: `apps/game-engine/src/engine/cleanup-track.ts`
- Create: `apps/game-engine/src/engine/cleanup-track.test.ts`

- [ ] **Step 1: Write failing test**

`apps/game-engine/src/engine/cleanup-track.test.ts`:
```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildCleanupTrackQuery } from './cleanup-track.js';

describe('buildCleanupTrackQuery', () => {
  it('returns SQL that deletes all track points for participants in a race', () => {
    const sql = buildCleanupTrackQuery('race-123');
    assert.match(sql.text, /DELETE FROM\s+boat_track_points/i);
    assert.match(sql.text, /participant_id IN \(SELECT id FROM race_participants WHERE race_id =/i);
    assert.deepEqual(sql.values, ['race-123']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test src/engine/cleanup-track.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement (pure SQL builder + executor)**

`apps/game-engine/src/engine/cleanup-track.ts`:
```ts
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

export function buildCleanupTrackQuery(raceId: string): { text: string; values: unknown[] } {
  return {
    text: 'DELETE FROM boat_track_points WHERE participant_id IN (SELECT id FROM race_participants WHERE race_id = $1)',
    values: [raceId],
  };
}

export async function cleanupRaceTrackPoints(
  db: NodePgDatabase<Record<string, never>>,
  raceId: string,
): Promise<number> {
  const q = buildCleanupTrackQuery(raceId);
  const result = await db.execute(sql.raw(q.text.replace('$1', `'${raceId.replace(/'/g, "''")}'`)));
  // result.rowCount is unreliable across drivers; return 0 as informational
  return result.rowCount ?? 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test src/engine/cleanup-track.test.ts
```
Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

```bash
git add apps/game-engine/src/engine/cleanup-track.ts apps/game-engine/src/engine/cleanup-track.test.ts
git commit -m "feat(engine): add cleanupRaceTrackPoints helper"
```

---

### Task 4: Add `lastCheckpointTs` to BoatRuntime

**Files:**
- Modify: `apps/game-engine/src/engine/runtime.ts`

- [ ] **Step 1: Locate `BoatRuntime` interface**

```bash
grep -n "interface BoatRuntime\|type BoatRuntime" apps/game-engine/src/engine/runtime.ts
```

- [ ] **Step 2: Add field**

In the `BoatRuntime` interface/type definition, add:
```ts
/** Timestamp (ms epoch) of last persisted track checkpoint. Null until first checkpoint. */
lastCheckpointTs: number | null;
```

- [ ] **Step 3: Update any factory / initial value**

Find places that build a fresh `BoatRuntime` (e.g., `createInitialRuntime`, demo seed). Set `lastCheckpointTs: null` everywhere a new runtime is constructed.

- [ ] **Step 4: Verify typecheck**

```bash
cd apps/game-engine && pnpm tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/game-engine/src/engine/runtime.ts
git commit -m "feat(engine): add lastCheckpointTs to BoatRuntime"
```

---

### Task 5: Track checkpoint enqueue + flush

**Files:**
- Create: `apps/game-engine/src/engine/track-checkpoint.ts`
- Create: `apps/game-engine/src/engine/track-checkpoint.test.ts`

- [ ] **Step 1: Write failing tests**

`apps/game-engine/src/engine/track-checkpoint.test.ts`:
```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shouldCheckpoint, enqueueCheckpoints } from './track-checkpoint.js';

describe('shouldCheckpoint', () => {
  const intervalMs = 60 * 60_000; // 1h

  it('returns true on first checkpoint (lastCheckpointTs null)', () => {
    assert.equal(shouldCheckpoint(null, Date.now(), intervalMs), true);
  });

  it('returns false when interval not elapsed', () => {
    const now = 100_000;
    assert.equal(shouldCheckpoint(now - 30 * 60_000, now, intervalMs), false);
  });

  it('returns true when interval elapsed', () => {
    const now = 100_000;
    assert.equal(shouldCheckpoint(now - 60 * 60_000, now, intervalMs), true);
  });
});

describe('enqueueCheckpoints', () => {
  it('emits one checkpoint per participant whose interval has elapsed', () => {
    const now = 100_000_000;
    const intervalMs = 60 * 60_000;
    const inputs = [
      { participantId: 'a', lat: 1, lon: 2, lastCheckpointTs: null },
      { participantId: 'b', lat: 3, lon: 4, lastCheckpointTs: now - 30 * 60_000 },
      { participantId: 'c', lat: 5, lon: 6, lastCheckpointTs: now - 60 * 60_000 },
    ];
    const ranks = new Map([['a', 2], ['b', 1], ['c', 3]]);
    const out = enqueueCheckpoints(inputs, ranks, now, intervalMs);
    assert.equal(out.length, 2);
    assert.deepEqual(out.map((p) => p.participantId).sort(), ['a', 'c']);
    const a = out.find((p) => p.participantId === 'a')!;
    assert.equal(a.lat, 1);
    assert.equal(a.lon, 2);
    assert.equal(a.rank, 2);
    assert.equal(a.tsMs, now);
  });

  it('forces a checkpoint when forceFor includes the participant id', () => {
    const now = 100_000_000;
    const intervalMs = 60 * 60_000;
    const inputs = [
      { participantId: 'a', lat: 1, lon: 2, lastCheckpointTs: now - 5_000 },
    ];
    const out = enqueueCheckpoints(inputs, new Map([['a', 1]]), now, intervalMs, new Set(['a']));
    assert.equal(out.length, 1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test src/engine/track-checkpoint.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`apps/game-engine/src/engine/track-checkpoint.ts`:
```ts
export function shouldCheckpoint(
  lastCheckpointTs: number | null,
  nowMs: number,
  intervalMs: number,
): boolean {
  if (lastCheckpointTs === null) return true;
  return nowMs - lastCheckpointTs >= intervalMs;
}

export interface CheckpointInput {
  participantId: string;
  lat: number;
  lon: number;
  lastCheckpointTs: number | null;
}

export interface CheckpointRow {
  participantId: string;
  tsMs: number;
  lat: number;
  lon: number;
  rank: number;
}

export function enqueueCheckpoints(
  inputs: readonly CheckpointInput[],
  ranks: ReadonlyMap<string, number>,
  nowMs: number,
  intervalMs: number,
  forceFor: ReadonlySet<string> = new Set(),
): CheckpointRow[] {
  const out: CheckpointRow[] = [];
  for (const input of inputs) {
    const force = forceFor.has(input.participantId);
    if (!force && !shouldCheckpoint(input.lastCheckpointTs, nowMs, intervalMs)) continue;
    const rank = ranks.get(input.participantId);
    if (rank === undefined) continue;
    out.push({
      participantId: input.participantId,
      tsMs: nowMs,
      lat: input.lat,
      lon: input.lon,
      rank,
    });
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test src/engine/track-checkpoint.test.ts
```
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/game-engine/src/engine/track-checkpoint.ts apps/game-engine/src/engine/track-checkpoint.test.ts
git commit -m "feat(engine): add track checkpoint enqueue/flush helpers"
```

---

### Task 6: Wire checkpointing into `onTickDone`

**Files:**
- Modify: `apps/game-engine/src/engine/manager.ts`

- [ ] **Step 1: Read existing `onTickDone`**

```bash
grep -n "onTickDone\|byRace" apps/game-engine/src/engine/manager.ts | head
```
Locate the per-race iteration block.

- [ ] **Step 2: Compute DTF per participant + ranks per race**

In `onTickDone`, inside the per-race iteration, before broadcasting:

```ts
import { computeRanks } from './rank.js';
import { enqueueCheckpoints, type CheckpointInput } from './track-checkpoint.js';
import { boatTrackPoints } from '../db/schema.js';

const TRACK_CHECKPOINT_INTERVAL_MS =
  Number(process.env['TRACK_CHECKPOINT_INTERVAL_MIN'] ?? 60) * 60_000;

// inside the race loop, after collecting `list: { runtime, outcome }[]`
const rankInputs = list.map(({ runtime, outcome }) => ({
  participantId: runtime.participantId,         // ensure this exists; otherwise fallback below
  dtfNm: outcome.dtfNm ?? Number(runtime.boat.dtfNm ?? 0),
}));
const ranks = computeRanks(rankInputs);

const nowMs = Date.now();
const checkpointInputs: CheckpointInput[] = list.map(({ runtime }) => ({
  participantId: runtime.participantId,
  lat: runtime.boat.position.lat,
  lon: runtime.boat.position.lon,
  lastCheckpointTs: runtime.lastCheckpointTs,
}));
const forceFor = new Set<string>();
for (const { runtime } of list) {
  // First tick of the race for this boat → force a checkpoint.
  if (runtime.lastCheckpointTs === null) forceFor.add(runtime.participantId);
  // DNF / finished transition → force a checkpoint.
  if (runtime.boat.finishedThisTick === true) forceFor.add(runtime.participantId);
  if (runtime.boat.dnfThisTick === true) forceFor.add(runtime.participantId);
}
const checkpoints = enqueueCheckpoints(
  checkpointInputs,
  ranks,
  nowMs,
  TRACK_CHECKPOINT_INTERVAL_MS,
  forceFor,
);

if (checkpoints.length > 0) {
  await this.db.insert(boatTrackPoints).values(
    checkpoints.map((c) => ({
      participantId: c.participantId,
      ts: new Date(c.tsMs),
      lat: c.lat,
      lon: c.lon,
      rank: c.rank,
    })),
  );
  // mutate runtimes in-place so the next tick sees the new checkpoint timestamp
  for (const c of checkpoints) {
    const entry = list.find((x) => x.runtime.participantId === c.participantId);
    if (entry) entry.runtime.lastCheckpointTs = c.tsMs;
  }
}

// keep the list of `checkpoints` for use in WS emit (Task 7).
```

> **Note for the implementer:** if the worker doesn't currently expose `participantId` on `BoatRuntime`, follow up by adding it (it's stable per boat in a race; can be looked up at runtime construction from `raceParticipants(raceId, boatId)`). The existing `boat.id` may map to the participant id directly — verify before coding.

- [ ] **Step 3: Typecheck**

```bash
cd apps/game-engine && pnpm tsc --noEmit
```
Expected: 0 errors. Fix any imports.

- [ ] **Step 4: Smoke test the worker locally**

```bash
pnpm dev
```
Trigger a race tick (or wait for the scheduled tick). Verify in psql:
```bash
psql $DATABASE_URL -c "SELECT count(*) FROM boat_track_points;"
```
Expected: at least one row after the first tick (forced checkpoint).

- [ ] **Step 5: Commit**

```bash
git add apps/game-engine/src/engine/manager.ts
git commit -m "feat(engine): persist hourly track checkpoints with rank"
```

---

### Task 7: WS broadcast for `trackPointAdded`

**Files:**
- Modify: `apps/game-engine/src/broadcast/payload.ts`
- Create: `apps/game-engine/src/broadcast/track-event.ts`
- Modify: `apps/game-engine/src/engine/manager.ts`

- [ ] **Step 1: Add type to payload union**

In `apps/game-engine/src/broadcast/payload.ts`:
```ts
export interface TrackPointAddedMsg {
  kind: 'trackPointAdded';
  participantId: string;
  ts: number; // ms epoch (encode as number; client converts)
  lat: number;
  lon: number;
  rank: number;
}

// extend the union
export type BroadcastMsg =
  | FullUpdate
  | DeltaUpdate
  | GoneUpdate
  | MyBoatFullUpdate
  | TrackPointAddedMsg;
```

- [ ] **Step 2: Builder helper**

`apps/game-engine/src/broadcast/track-event.ts`:
```ts
import type { TrackPointAddedMsg } from './payload.js';

export function buildTrackPointAddedMsg(input: {
  participantId: string;
  tsMs: number;
  lat: number;
  lon: number;
  rank: number;
}): TrackPointAddedMsg {
  return {
    kind: 'trackPointAdded',
    participantId: input.participantId,
    ts: input.tsMs,
    lat: input.lat,
    lon: input.lon,
    rank: input.rank,
  };
}
```

- [ ] **Step 3: Emit after DB insert**

In `manager.ts`, after the `db.insert(boatTrackPoints)` block from Task 6:
```ts
import { buildTrackPointAddedMsg } from '../broadcast/track-event.js';
import { encode } from '@msgpack/msgpack';

if (checkpoints.length > 0) {
  const events = checkpoints.map((c) =>
    buildTrackPointAddedMsg({
      participantId: c.participantId,
      tsMs: c.tsMs,
      lat: c.lat,
      lon: c.lon,
      rank: c.rank,
    }),
  );
  const buf = encode(events);
  await this.redis.pub.publish(CHANNELS.raceTick(raceId), Buffer.from(buf));
}
```

- [ ] **Step 4: Typecheck + smoke**

```bash
pnpm tsc --noEmit
```
Expected: 0 errors. Then run dev and inspect a WS frame in browser devtools after the first checkpoint — should contain a `trackPointAdded` message.

- [ ] **Step 5: Commit**

```bash
git add apps/game-engine/src/broadcast/payload.ts apps/game-engine/src/broadcast/track-event.ts apps/game-engine/src/engine/manager.ts
git commit -m "feat(broadcast): emit trackPointAdded WS event on checkpoint"
```

---

### Task 8: REST endpoint `GET /api/v1/races/:raceId/participants/:pid/track`

**Files:**
- Create: `apps/web/src/app/api/v1/races/[raceId]/participants/[participantId]/track/route.ts`

- [ ] **Step 1: Implement route**

```ts
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/server/db';                     // adjust to existing helper
import { boatTrackPoints, raceParticipants } from '@nemo/db'; // adjust to existing import path
import { and, eq, asc } from 'drizzle-orm';
import { enforceAuth } from '@/lib/server/auth';             // adjust to existing helper

export async function GET(
  request: Request,
  { params }: { params: Promise<{ raceId: string; participantId: string }> },
): Promise<NextResponse> {
  const auth = await enforceAuth(request);
  if (!auth.ok) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { raceId, participantId } = await params;
  const db = getDb();

  // Caller must be registered in this race (own boat OR opponent fetch).
  const callerParticipant = await db
    .select({ id: raceParticipants.id })
    .from(raceParticipants)
    .where(and(eq(raceParticipants.raceId, raceId), eq(raceParticipants.playerId, auth.userId)))
    .limit(1);
  if (callerParticipant.length === 0) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // Verify the requested participant belongs to this race.
  const target = await db
    .select({ id: raceParticipants.id })
    .from(raceParticipants)
    .where(and(eq(raceParticipants.id, participantId), eq(raceParticipants.raceId, raceId)))
    .limit(1);
  if (target.length === 0) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const points = await db
    .select({
      ts: boatTrackPoints.ts,
      lat: boatTrackPoints.lat,
      lon: boatTrackPoints.lon,
      rank: boatTrackPoints.rank,
    })
    .from(boatTrackPoints)
    .where(eq(boatTrackPoints.participantId, participantId))
    .orderBy(asc(boatTrackPoints.ts));

  return NextResponse.json({
    participantId,
    points: points.map((p) => ({
      ts: p.ts.toISOString(),
      lat: p.lat,
      lon: p.lon,
      rank: p.rank,
    })),
  });
}
```

> **Note:** `getDb()`, `enforceAuth()`, and the `@nemo/db` import path may differ — match the existing patterns in `apps/web/src/app/api/v1/races/[raceId]/zones/route.ts` or `apps/web/src/app/api/v1/races/[raceId]/my-boat/route.ts` (already deleted, see git log) and the marina routes for reference.

- [ ] **Step 2: Manual test with curl**

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/v1/races/$RACE_ID/participants/$PARTICIPANT_ID/track" \
  | jq
```
Expected: `{ "participantId": "...", "points": [...] }`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/api/v1/races/[raceId]/participants/[participantId]/track/route.ts
git commit -m "feat(api): GET /races/:raceId/participants/:pid/track endpoint"
```

---

## Phase B — Client foundation

### Task 9: `trackSlice` + types extension

**Files:**
- Modify: `apps/web/src/lib/store/types.ts`
- Create: `apps/web/src/lib/store/trackSlice.ts`

- [ ] **Step 1: Extend types**

In `apps/web/src/lib/store/types.ts`, add:

```ts
export interface TrackPoint {
  ts: number;     // ms epoch
  lat: number;
  lon: number;
  rank: number;
}

export interface TrackState {
  myPoints: TrackPoint[];      // sorted asc by ts
  isLoading: boolean;
  error: string | null;
  selfParticipantId: string | null;  // hydrated by PlayClient on mount
}
```

Extend `TimelineState`:
```ts
export interface TimelineState {
  currentTime: Date;
  isLive: boolean;
  playbackSpeed: 1 | 6 | 24;
  // new fields
  isPlaying: boolean;
  raceStartMs: number | null;
  raceEndMs: number | null;
  forecastEndMs: number | null;
}
```

Extend `GameStore` (add `track: TrackState` and the new action signatures).

- [ ] **Step 2: Implement slice**

`apps/web/src/lib/store/trackSlice.ts`:
```ts
'use client';
import type { GameStore, TrackPoint, TrackState } from './types';

export const INITIAL_TRACK: TrackState = {
  myPoints: [],
  isLoading: false,
  error: null,
  selfParticipantId: null,
};

export function createTrackSlice(set: (fn: (s: GameStore) => Partial<GameStore>) => void) {
  return {
    track: INITIAL_TRACK,

    setTrackLoading: (isLoading: boolean) =>
      set((s) => ({ track: { ...s.track, isLoading } })),

    setTrackError: (error: string | null) =>
      set((s) => ({ track: { ...s.track, error, isLoading: false } })),

    setTrack: (points: TrackPoint[]) =>
      set(() => ({
        track: {
          myPoints: [...points].sort((a, b) => a.ts - b.ts),
          isLoading: false,
          error: null,
        },
      })),

    appendTrackPoint: (p: TrackPoint) =>
      set((s) => {
        const existing = s.track.myPoints;
        if (existing.some((x) => x.ts === p.ts)) return { track: s.track };
        const next = [...existing, p].sort((a, b) => a.ts - b.ts);
        return { track: { ...s.track, myPoints: next } };
      }),

    clearTrack: () =>
      set((s) => ({
        // preserve selfParticipantId — only clear point data
        track: { ...INITIAL_TRACK, selfParticipantId: s.track.selfParticipantId },
      })),

    setSelfParticipantId: (participantId: string | null) =>
      set((s) => ({ track: { ...s.track, selfParticipantId: participantId } })),
  };
}
```

- [ ] **Step 3: Register slice in store**

In `apps/web/src/lib/store/index.ts`:
```ts
import { createTrackSlice } from './trackSlice';
// inside create<GameStore>((set) => ({...
  ...createTrackSlice(set),
```

- [ ] **Step 4: Typecheck**

```bash
cd apps/web && pnpm tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/store/types.ts apps/web/src/lib/store/trackSlice.ts apps/web/src/lib/store/index.ts
git commit -m "feat(store): add trackSlice and extend timeline types"
```

---

### Task 10: Extend `timelineSlice` with new actions

**Files:**
- Modify: `apps/web/src/lib/store/timelineSlice.ts`

- [ ] **Step 1: Add fields to initial state and actions**

```ts
'use client';
import type { GameStore, TimelineState } from './types';

export const INITIAL_TIMELINE: TimelineState = {
  currentTime: new Date(0),
  isLive: true,
  playbackSpeed: 1,
  isPlaying: false,
  raceStartMs: null,
  raceEndMs: null,
  forecastEndMs: null,
};

export function createTimelineSlice(set: (fn: (s: GameStore) => Partial<GameStore>) => void) {
  return {
    timeline: INITIAL_TIMELINE,

    setTime: (t: Date) =>
      set(() => ({ timeline: { ...INITIAL_TIMELINE, currentTime: t, isLive: false, playbackSpeed: 1 } })),

    goLive: () =>
      set((s) => ({
        timeline: {
          ...s.timeline,
          currentTime: new Date(),
          isLive: true,
          isPlaying: false,
          playbackSpeed: 1,
        },
      })),

    setPlaybackSpeed: (speed: 1 | 6 | 24) =>
      set((s) => ({ timeline: { ...s.timeline, playbackSpeed: speed } })),

    setIsPlaying: (b: boolean) =>
      set((s) => ({ timeline: { ...s.timeline, isPlaying: b } })),

    setRaceContext: (ctx: { startMs: number | null; endMs?: number | null; forecastEndMs: number | null }) =>
      set((s) => ({
        timeline: {
          ...s.timeline,
          raceStartMs: ctx.startMs,
          raceEndMs: ctx.endMs ?? null,
          forecastEndMs: ctx.forecastEndMs,
        },
      })),
  };
}
```

> **Note:** the `setTime` reset to `INITIAL_TIMELINE` defaults loses `raceStartMs/endMs/forecastEndMs` — fix by spreading current state instead:

```ts
    setTime: (t: Date) =>
      set((s) => ({
        timeline: { ...s.timeline, currentTime: t, isLive: false, isPlaying: false },
      })),
```

(Use the spread version, not the `INITIAL_TIMELINE` reset — the reset was a copy from old code.)

- [ ] **Step 2: Update GameStore action signatures in `types.ts`**

Add `setIsPlaying`, `setRaceContext` typed signatures to `GameStore`.

- [ ] **Step 3: Typecheck**

```bash
pnpm tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/store/timelineSlice.ts apps/web/src/lib/store/types.ts
git commit -m "feat(store): extend timelineSlice with isPlaying and race context"
```

---

### Task 11: Pure selectors (with tests)

**Files:**
- Create: `apps/web/src/lib/store/timeline-selectors.ts`
- Create: `apps/web/src/lib/store/timeline-selectors.test.ts`

- [ ] **Step 1: Write failing tests**

`apps/web/src/lib/store/timeline-selectors.test.ts`:
```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  selectTimelineBounds,
  selectGhostPosition,
  selectWeatherLayerVisible,
  selectRankSparklineNormalized,
} from './timeline-selectors.js';

const baseTrack = [
  { ts: 1000, lat: 47.0, lon: -3.0, rank: 100 },
  { ts: 2000, lat: 48.0, lon: -3.5, rank: 80 },
  { ts: 3000, lat: 49.0, lon: -4.0, rank: 60 },
];

describe('selectTimelineBounds', () => {
  it('LIVE: minMs = raceStartMs, maxMs = forecastEndMs', () => {
    const b = selectTimelineBounds({ raceStartMs: 1000, raceEndMs: null, forecastEndMs: 9999, status: 'LIVE' });
    assert.deepEqual(b, { minMs: 1000, maxMs: 9999 });
  });
  it('FINISHED: maxMs = raceEndMs', () => {
    const b = selectTimelineBounds({ raceStartMs: 1000, raceEndMs: 5000, forecastEndMs: 9999, status: 'FINISHED' });
    assert.deepEqual(b, { minMs: 1000, maxMs: 5000 });
  });
  it('BRIEFING: minMs = nowMs', () => {
    const b = selectTimelineBounds({ raceStartMs: 5000, raceEndMs: null, forecastEndMs: 9999, status: 'BRIEFING', nowMs: 100 });
    assert.deepEqual(b, { minMs: 100, maxMs: 9999 });
  });
});

describe('selectGhostPosition', () => {
  it('returns null when isLive', () => {
    assert.equal(selectGhostPosition({ currentTimeMs: 2000, isLive: true, nowMs: 5000, track: baseTrack, projection: null }), null);
  });

  it('lerps between two adjacent past points', () => {
    const g = selectGhostPosition({ currentTimeMs: 1500, isLive: false, nowMs: 5000, track: baseTrack, projection: null });
    assert.ok(g);
    assert.equal(g!.lat, 47.5);
    assert.equal(g!.lon, -3.25);
  });

  it('clamps to first track point if currentTime < earliest', () => {
    const g = selectGhostPosition({ currentTimeMs: 500, isLive: false, nowMs: 5000, track: baseTrack, projection: null });
    assert.equal(g!.lat, 47.0);
    assert.equal(g!.lon, -3.0);
  });

  it('uses projection points when currentTime > now', () => {
    const projection = [
      { dtMs: 0, lat: 50.0, lon: -5.0 },
      { dtMs: 1000, lat: 51.0, lon: -5.5 },
    ];
    const g = selectGhostPosition({ currentTimeMs: 5500, isLive: false, nowMs: 5000, track: baseTrack, projection });
    assert.equal(g!.lat, 50.5);
    assert.equal(g!.lon, -5.25);
  });
});

describe('selectWeatherLayerVisible', () => {
  it('true when currentTime >= now', () => {
    assert.equal(selectWeatherLayerVisible({ currentTimeMs: 5000, nowMs: 5000 }), true);
    assert.equal(selectWeatherLayerVisible({ currentTimeMs: 6000, nowMs: 5000 }), true);
  });
  it('false when currentTime < now', () => {
    assert.equal(selectWeatherLayerVisible({ currentTimeMs: 4000, nowMs: 5000 }), false);
  });
});

describe('selectRankSparklineNormalized', () => {
  it('normalizes Y to [0,1] over min/max rank', () => {
    const out = selectRankSparklineNormalized(baseTrack);
    // ranks 100,80,60 → min=60, max=100 → y = (rank - 60) / 40
    assert.equal(out[0]!.yNorm, 1);
    assert.equal(out[1]!.yNorm, 0.5);
    assert.equal(out[2]!.yNorm, 0);
  });
  it('returns empty when fewer than 2 points', () => {
    assert.deepEqual(selectRankSparklineNormalized([baseTrack[0]!]), []);
    assert.deepEqual(selectRankSparklineNormalized([]), []);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/web && pnpm exec node --import tsx --test src/lib/store/timeline-selectors.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`apps/web/src/lib/store/timeline-selectors.ts`:
```ts
import type { TrackPoint } from './types';

export type RaceStatus = 'BRIEFING' | 'LIVE' | 'FINISHED';

export interface BoundsInput {
  raceStartMs: number | null;
  raceEndMs: number | null;
  forecastEndMs: number | null;
  status: RaceStatus;
  nowMs?: number; // injected for tests; defaults to Date.now()
}

export function selectTimelineBounds(i: BoundsInput): { minMs: number; maxMs: number } {
  const now = i.nowMs ?? Date.now();
  const minMs = i.status === 'BRIEFING' ? now : (i.raceStartMs ?? now);
  const maxMs =
    i.status === 'FINISHED'
      ? (i.raceEndMs ?? i.forecastEndMs ?? now)
      : (i.forecastEndMs ?? now);
  return { minMs, maxMs };
}

export interface GhostInput {
  currentTimeMs: number;
  isLive: boolean;
  nowMs: number;
  track: readonly TrackPoint[];
  projection: ReadonlyArray<{ dtMs: number; lat: number; lon: number }> | null;
}

export interface GhostPosition {
  lat: number;
  lon: number;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

export function selectGhostPosition(i: GhostInput): GhostPosition | null {
  if (i.isLive) return null;
  if (i.currentTimeMs <= i.nowMs) {
    if (i.track.length === 0) return null;
    if (i.currentTimeMs <= i.track[0]!.ts) return { lat: i.track[0]!.lat, lon: i.track[0]!.lon };
    if (i.currentTimeMs >= i.track[i.track.length - 1]!.ts) {
      const last = i.track[i.track.length - 1]!;
      return { lat: last.lat, lon: last.lon };
    }
    for (let k = 0; k < i.track.length - 1; k++) {
      const a = i.track[k]!;
      const b = i.track[k + 1]!;
      if (i.currentTimeMs >= a.ts && i.currentTimeMs <= b.ts) {
        const t = (i.currentTimeMs - a.ts) / (b.ts - a.ts);
        return { lat: lerp(a.lat, b.lat, t), lon: lerp(a.lon, b.lon, t) };
      }
    }
    return null;
  } else {
    if (!i.projection || i.projection.length === 0) return null;
    const dt = i.currentTimeMs - i.nowMs;
    if (dt <= i.projection[0]!.dtMs) return { lat: i.projection[0]!.lat, lon: i.projection[0]!.lon };
    if (dt >= i.projection[i.projection.length - 1]!.dtMs) {
      const last = i.projection[i.projection.length - 1]!;
      return { lat: last.lat, lon: last.lon };
    }
    for (let k = 0; k < i.projection.length - 1; k++) {
      const a = i.projection[k]!;
      const b = i.projection[k + 1]!;
      if (dt >= a.dtMs && dt <= b.dtMs) {
        const t = (dt - a.dtMs) / (b.dtMs - a.dtMs);
        return { lat: lerp(a.lat, b.lat, t), lon: lerp(a.lon, b.lon, t) };
      }
    }
    return null;
  }
}

export function selectWeatherLayerVisible(i: { currentTimeMs: number; nowMs: number }): boolean {
  return i.currentTimeMs >= i.nowMs;
}

export interface SparklinePoint {
  ts: number;
  rank: number;
  yNorm: number; // 0..1, 1 = best (lowest rank), 0 = worst
}

export function selectRankSparklineNormalized(track: readonly TrackPoint[]): SparklinePoint[] {
  if (track.length < 2) return [];
  let min = Infinity;
  let max = -Infinity;
  for (const p of track) {
    if (p.rank < min) min = p.rank;
    if (p.rank > max) max = p.rank;
  }
  const span = max - min || 1;
  return track.map((p) => ({
    ts: p.ts,
    rank: p.rank,
    yNorm: 1 - (p.rank - min) / span, // invert so rank 1 = top
  }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm exec node --import tsx --test src/lib/store/timeline-selectors.test.ts
```
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/store/timeline-selectors.ts apps/web/src/lib/store/timeline-selectors.test.ts
git commit -m "feat(store): pure selectors for timeline ghost/bounds/sparkline"
```

---

### Task 12: WS dispatch — append `trackPointAdded`

**Files:**
- Modify: `apps/web/src/lib/store/index.ts`

- [ ] **Step 1: Locate `applyMessages`**

```bash
grep -n "applyMessages" apps/web/src/lib/store/index.ts
```

- [ ] **Step 2: Add a dispatch branch**

Inside the `for (const m of msgs)` loop:
```ts
if (m['kind'] === 'trackPointAdded') {
  const participantId = String(m['participantId']);
  if (participantId === ownParticipantId) {
    const tsRaw = m['ts'];
    const tsMs = typeof tsRaw === 'number' ? tsRaw : Date.parse(String(tsRaw));
    const newPoint = {
      ts: tsMs,
      lat: Number(m['lat']),
      lon: Number(m['lon']),
      rank: Number(m['rank']),
    };
    if (!s.track.myPoints.some((x) => x.ts === newPoint.ts)) {
      nextTrack = {
        ...s.track,
        myPoints: [...s.track.myPoints, newPoint].sort((a, b) => a.ts - b.ts),
      };
    }
  }
  continue;
}
```

> **Note:** read `ownParticipantId` from `s.track.selfParticipantId` (added in Task 9). Use it inside the `set((s) => { ... })` closure: `const ownParticipantId = s.track.selfParticipantId;`. The existing `applyMessages` already resolves `ownBoatId` from env var — keep that for the FullUpdate / MyBoatFullUpdate dispatch; only the `trackPointAdded` branch uses participant id.

- [ ] **Step 3: Typecheck**

```bash
pnpm tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/store/index.ts
git commit -m "feat(store): append trackPointAdded events to track slice"
```

---

### Task 13: `useTrackHydration` hook

**Files:**
- Create: `apps/web/src/lib/api/track.ts`
- Create: `apps/web/src/hooks/useTrackHydration.ts`

- [ ] **Step 1: API client**

`apps/web/src/lib/api/track.ts`:
```ts
import type { TrackPoint } from '@/lib/store/types';

export interface FetchTrackResponse {
  participantId: string;
  points: TrackPoint[];
}

export async function fetchTrack(raceId: string, participantId: string): Promise<FetchTrackResponse> {
  const res = await fetch(`/api/v1/races/${raceId}/participants/${participantId}/track`, {
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`fetchTrack failed: ${res.status}`);
  const json = (await res.json()) as { participantId: string; points: Array<{ ts: string; lat: number; lon: number; rank: number }> };
  return {
    participantId: json.participantId,
    points: json.points.map((p) => ({
      ts: Date.parse(p.ts),
      lat: p.lat,
      lon: p.lon,
      rank: p.rank,
    })),
  };
}
```

- [ ] **Step 2: Hook**

`apps/web/src/hooks/useTrackHydration.ts`:
```ts
'use client';
import { useEffect } from 'react';
import { useGameStore } from '@/lib/store';
import { fetchTrack } from '@/lib/api/track';

export function useTrackHydration(raceId: string, participantId: string | null): void {
  const setTrack = useGameStore((s) => s.setTrack);
  const setLoading = useGameStore((s) => s.setTrackLoading);
  const setError = useGameStore((s) => s.setTrackError);
  const clearTrack = useGameStore((s) => s.clearTrack);

  useEffect(() => {
    if (!participantId) return;
    let cancelled = false;
    setLoading(true);
    fetchTrack(raceId, participantId)
      .then((res) => {
        if (cancelled) return;
        setTrack(res.points);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'unknown error');
      });

    return () => {
      cancelled = true;
      clearTrack();
    };
  }, [raceId, participantId, setTrack, setLoading, setError, clearTrack]);
}
```

- [ ] **Step 3: Typecheck + commit**

```bash
pnpm tsc --noEmit
git add apps/web/src/lib/api/track.ts apps/web/src/hooks/useTrackHydration.ts
git commit -m "feat(hooks): useTrackHydration loads persisted track on mount"
```

---

### Task 14: `useTimelinePlayback` hook

**Files:**
- Create: `apps/web/src/hooks/useTimelinePlayback.ts`

- [ ] **Step 1: Implement**

```ts
'use client';
import { useEffect, useRef } from 'react';
import { useGameStore } from '@/lib/store';
import { selectTimelineBounds, type RaceStatus } from '@/lib/store/timeline-selectors';

export function useTimelinePlayback(raceStatus: RaceStatus): void {
  const isPlaying = useGameStore((s) => s.timeline.isPlaying);
  const isLive = useGameStore((s) => s.timeline.isLive);
  const playbackSpeed = useGameStore((s) => s.timeline.playbackSpeed);
  const raceStartMs = useGameStore((s) => s.timeline.raceStartMs);
  const raceEndMs = useGameStore((s) => s.timeline.raceEndMs);
  const forecastEndMs = useGameStore((s) => s.timeline.forecastEndMs);
  const setTime = useGameStore((s) => s.setTime);
  const setIsPlaying = useGameStore((s) => s.setIsPlaying);
  const goLive = useGameStore((s) => s.goLive);

  // Live tracking — refresh currentTime every 5s so bounds animate forward.
  useEffect(() => {
    if (!isLive) return;
    const id = window.setInterval(() => {
      goLive();
    }, 5_000);
    return () => window.clearInterval(id);
  }, [isLive, goLive]);

  // Play loop.
  const lastFrameRef = useRef<number>(0);
  useEffect(() => {
    if (!isPlaying || isLive) return;
    let raf = 0;
    const tick = (frameTime: number) => {
      const last = lastFrameRef.current || frameTime;
      const dtRealMs = frameTime - last;
      lastFrameRef.current = frameTime;

      const state = useGameStore.getState();
      const currentMs = state.timeline.currentTime.getTime();
      const next = currentMs + dtRealMs * playbackSpeed;

      const bounds = selectTimelineBounds({
        raceStartMs, raceEndMs, forecastEndMs, status: raceStatus,
      });
      if (next >= bounds.maxMs) {
        setIsPlaying(false);
        goLive();
        return;
      }
      setTime(new Date(next));
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(raf);
      lastFrameRef.current = 0;
    };
  }, [isPlaying, isLive, playbackSpeed, raceStartMs, raceEndMs, forecastEndMs, raceStatus, setTime, setIsPlaying, goLive]);
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm tsc --noEmit
git add apps/web/src/hooks/useTimelinePlayback.ts
git commit -m "feat(hooks): useTimelinePlayback drives the play loop"
```

---

## Phase C — UI Component

### Task 15: Pure tick scale helper + tests

**Files:**
- Create: `apps/web/src/components/play/timeline/ticks.ts`
- Create: `apps/web/src/components/play/timeline/ticks.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeTicks } from './ticks.js';

describe('computeTicks', () => {
  const HOUR = 3_600_000;
  const DAY = 24 * HOUR;

  it('uses 1h step when span <= 12h', () => {
    const t = computeTicks({ minMs: 0, maxMs: 12 * HOUR, nowMs: 0 });
    assert.equal(t.stepMs, HOUR);
    assert.equal(t.format, 'HH:00');
  });

  it('uses 6h step when span 12-72h', () => {
    const t = computeTicks({ minMs: 0, maxMs: 48 * HOUR, nowMs: 0 });
    assert.equal(t.stepMs, 6 * HOUR);
    assert.equal(t.format, 'HH:00 · J+N');
  });

  it('uses 1d step when span 3-14d', () => {
    const t = computeTicks({ minMs: 0, maxMs: 7 * DAY, nowMs: 0 });
    assert.equal(t.stepMs, DAY);
    assert.equal(t.format, 'DD MMM');
  });

  it('uses 7d step when span > 14d', () => {
    const t = computeTicks({ minMs: 0, maxMs: 30 * DAY, nowMs: 0 });
    assert.equal(t.stepMs, 7 * DAY);
    assert.equal(t.format, 'DD MMM');
  });
});
```

- [ ] **Step 2: Implement**

`apps/web/src/components/play/timeline/ticks.ts`:
```ts
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export type TickFormat = 'HH:00' | 'HH:00 · J+N' | 'DD MMM';

export interface TickScale {
  stepMs: number;
  format: TickFormat;
}

export function computeTicks(i: { minMs: number; maxMs: number; nowMs: number }): TickScale {
  const span = i.maxMs - i.minMs;
  if (span <= 12 * HOUR) return { stepMs: HOUR, format: 'HH:00' };
  if (span <= 72 * HOUR) return { stepMs: 6 * HOUR, format: 'HH:00 · J+N' };
  if (span <= 14 * DAY) return { stepMs: DAY, format: 'DD MMM' };
  return { stepMs: 7 * DAY, format: 'DD MMM' };
}

export interface TickPosition {
  ts: number;
  pctX: number; // 0..100
  label: string;
}

export function buildTickPositions(
  scale: TickScale,
  bounds: { minMs: number; maxMs: number; nowMs: number },
  formatLabel: (ts: number, scale: TickScale, nowMs: number) => string,
): TickPosition[] {
  const out: TickPosition[] = [];
  const span = bounds.maxMs - bounds.minMs;
  const start = Math.ceil(bounds.minMs / scale.stepMs) * scale.stepMs;
  for (let t = start; t <= bounds.maxMs; t += scale.stepMs) {
    out.push({
      ts: t,
      pctX: ((t - bounds.minMs) / span) * 100,
      label: formatLabel(t, scale, bounds.nowMs),
    });
  }
  return out;
}
```

- [ ] **Step 3: Run tests**

```bash
pnpm exec node --import tsx --test src/components/play/timeline/ticks.test.ts
```
Expected: PASS, 4 tests.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/play/timeline/ticks.ts apps/web/src/components/play/timeline/ticks.test.ts
git commit -m "feat(timeline): tick scale + position helpers"
```

---

### Task 16: `TimelineHeader` — controls row

**Files:**
- Create: `apps/web/src/components/play/timeline/TimelineHeader.tsx`
- Create: `apps/web/src/components/play/timeline/TimelineHeader.module.css`

- [ ] **Step 1: Component**

```tsx
'use client';
import { useGameStore } from '@/lib/store';
import styles from './TimelineHeader.module.css';

const HOUR = 3_600_000;

export function TimelineHeader(): JSX.Element {
  const currentTime = useGameStore((s) => s.timeline.currentTime);
  const isLive = useGameStore((s) => s.timeline.isLive);
  const isPlaying = useGameStore((s) => s.timeline.isPlaying);
  const playbackSpeed = useGameStore((s) => s.timeline.playbackSpeed);
  const raceStartMs = useGameStore((s) => s.timeline.raceStartMs);
  const setTime = useGameStore((s) => s.setTime);
  const goLive = useGameStore((s) => s.goLive);
  const setIsPlaying = useGameStore((s) => s.setIsPlaying);
  const setPlaybackSpeed = useGameStore((s) => s.setPlaybackSpeed);

  const dayOffset =
    raceStartMs !== null
      ? Math.floor((currentTime.getTime() - raceStartMs) / (24 * HOUR))
      : null;

  const timeStr = currentTime.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const dateStr = currentTime.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  const dayLabel = dayOffset === null ? '' : dayOffset === 0 ? 'Auj.' : dayOffset > 0 ? `J+${dayOffset}` : `J${dayOffset}`;

  return (
    <div className={styles.header}>
      <div className={styles.time}>
        <span className={styles.timeMain}>{timeStr}</span>
        <span className={styles.timeSub}>{dayLabel} · {dateStr}</span>
      </div>
      <div className={styles.spacer} />
      <button
        className={styles.btn}
        onClick={() => setTime(new Date(currentTime.getTime() - 6 * HOUR))}
        aria-label="reculer 6 heures"
      >◀ 6h</button>
      <button
        className={`${styles.btn} ${isPlaying ? styles.active : ''}`}
        onClick={() => setIsPlaying(!isPlaying)}
        disabled={isLive}
        aria-label={isPlaying ? 'pause' : 'lecture'}
      >{isPlaying ? '❚❚' : '▶'}</button>
      <button
        className={`${styles.btn} ${playbackSpeed === 1 ? styles.active : ''}`}
        onClick={() => setPlaybackSpeed(1)}
      >1x</button>
      <button
        className={`${styles.btn} ${playbackSpeed === 6 ? styles.active : ''}`}
        onClick={() => setPlaybackSpeed(6)}
      >6x</button>
      <button
        className={`${styles.btn} ${playbackSpeed === 24 ? styles.active : ''}`}
        onClick={() => setPlaybackSpeed(24)}
      >24x</button>
      <button
        className={styles.btn}
        onClick={() => setTime(new Date(currentTime.getTime() + 6 * HOUR))}
        aria-label="avancer 6 heures"
      >6h ▶</button>
      <button
        className={`${styles.live} ${isLive ? styles.liveActive : ''}`}
        onClick={() => goLive()}
      >● LIVE</button>
    </div>
  );
}
```

- [ ] **Step 2: CSS**

```css
.header {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-3) 0;
}
.time { display: flex; flex-direction: column; min-width: 140px; }
.timeMain { font-family: var(--font-display); font-size: 22px; color: var(--gold); letter-spacing: 1px; }
.timeSub { font-size: 11px; color: var(--t3); margin-top: 2px; }
.spacer { flex: 1; }
.btn {
  background: transparent;
  border: 1px solid var(--navy-line);
  color: var(--t1);
  padding: 4px 10px;
  border-radius: var(--r-md);
  font-size: 11px;
  cursor: pointer;
  font-family: var(--font-body);
}
.btn:hover:not(:disabled) { background: var(--navy-soft); }
.btn:disabled { opacity: 0.4; cursor: not-allowed; }
.btn.active { background: var(--gold); color: var(--ivory); border-color: var(--gold); }
.live {
  background: transparent;
  border: 1px solid var(--gold);
  color: var(--gold);
  padding: 4px 12px;
  border-radius: var(--r-md);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  font-family: var(--font-body);
}
.live.liveActive { background: var(--gold-soft); }
@media (max-width: 768px) {
  .btn:nth-of-type(1), .btn:nth-of-type(7) { display: none; } /* hide 6h step buttons */
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/play/timeline/TimelineHeader.tsx apps/web/src/components/play/timeline/TimelineHeader.module.css
git commit -m "feat(timeline): TimelineHeader sub-component"
```

---

### Task 17: `RankSparkline`

**Files:**
- Create: `apps/web/src/components/play/timeline/RankSparkline.tsx`
- Create: `apps/web/src/components/play/timeline/RankSparkline.module.css`

- [ ] **Step 1: Component**

```tsx
'use client';
import { useMemo } from 'react';
import { useGameStore } from '@/lib/store';
import { selectRankSparklineNormalized } from '@/lib/store/timeline-selectors';
import styles from './RankSparkline.module.css';

const SPARK_HEIGHT = 20;

export function RankSparkline({ widthPx }: { widthPx: number }): JSX.Element | null {
  const points = useGameStore((s) => s.track.myPoints);
  const setTime = useGameStore((s) => s.setTime);

  const normalized = useMemo(() => selectRankSparklineNormalized(points), [points]);
  if (normalized.length < 2 || widthPx <= 0) return null;

  const minTs = normalized[0]!.ts;
  const maxTs = normalized[normalized.length - 1]!.ts;
  const span = Math.max(1, maxTs - minTs);

  const polylinePoints = normalized
    .map((p) => `${((p.ts - minTs) / span) * widthPx},${(1 - p.yNorm) * SPARK_HEIGHT}`)
    .join(' ');

  return (
    <svg
      className={styles.spark}
      viewBox={`0 0 ${widthPx} ${SPARK_HEIGHT}`}
      width={widthPx}
      height={SPARK_HEIGHT}
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const ts = minTs + (x / widthPx) * span;
        setTime(new Date(ts));
      }}
      role="img"
      aria-label="évolution du classement"
    >
      <polyline points={polylinePoints} className={styles.line} />
    </svg>
  );
}
```

- [ ] **Step 2: CSS**

```css
.spark {
  display: block;
  cursor: pointer;
}
.line {
  fill: none;
  stroke: var(--open);
  stroke-width: 1.2;
  stroke-linejoin: round;
  stroke-linecap: round;
}
@media (max-width: 768px) {
  .spark { display: none; }
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/play/timeline/RankSparkline.tsx apps/web/src/components/play/timeline/RankSparkline.module.css
git commit -m "feat(timeline): RankSparkline sub-component"
```

---

### Task 18: `TimelineTrack` — bar + cursor + tick marks

**Files:**
- Create: `apps/web/src/components/play/timeline/TimelineTrack.tsx`
- Create: `apps/web/src/components/play/timeline/TimelineTrack.module.css`

- [ ] **Step 1: Component**

```tsx
'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useGameStore } from '@/lib/store';
import { selectTimelineBounds, type RaceStatus } from '@/lib/store/timeline-selectors';
import { computeTicks, buildTickPositions } from './ticks';
import styles from './TimelineTrack.module.css';

function formatLabel(ts: number, scale: { format: string }, nowMs: number): string {
  const d = new Date(ts);
  if (scale.format === 'HH:00') return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if (scale.format === 'DD MMM') return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  // 'HH:00 · J+N'
  const dayOffset = Math.floor((ts - nowMs) / 86400_000);
  const offsetLabel = dayOffset === 0 ? 'Auj.' : dayOffset > 0 ? `J+${dayOffset}` : `J${dayOffset}`;
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return `${time} · ${offsetLabel}`;
}

export function TimelineTrack({ raceStatus }: { raceStatus: RaceStatus }): JSX.Element {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const currentTime = useGameStore((s) => s.timeline.currentTime);
  const raceStartMs = useGameStore((s) => s.timeline.raceStartMs);
  const raceEndMs = useGameStore((s) => s.timeline.raceEndMs);
  const forecastEndMs = useGameStore((s) => s.timeline.forecastEndMs);
  const setTime = useGameStore((s) => s.setTime);

  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 5_000);
    return () => window.clearInterval(id);
  }, []);

  const bounds = selectTimelineBounds({ raceStartMs, raceEndMs, forecastEndMs, status: raceStatus, nowMs });
  const span = Math.max(1, bounds.maxMs - bounds.minMs);
  const cursorPct = ((currentTime.getTime() - bounds.minMs) / span) * 100;
  const nowPct = ((nowMs - bounds.minMs) / span) * 100;

  const tickScale = computeTicks({ ...bounds, nowMs });
  const ticks = buildTickPositions(tickScale, { ...bounds, nowMs }, formatLabel);

  const onPointerJump = useCallback((clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const ts = bounds.minMs + pct * span;
    setTime(new Date(ts));
  }, [bounds.minMs, span, setTime]);

  const draggingRef = useRef(false);
  const onPointerDown = (e: React.PointerEvent) => {
    draggingRef.current = true;
    (e.target as Element).setPointerCapture(e.pointerId);
    onPointerJump(e.clientX);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (draggingRef.current) onPointerJump(e.clientX);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    draggingRef.current = false;
    (e.target as Element).releasePointerCapture(e.pointerId);
  };

  return (
    <div
      ref={trackRef}
      className={styles.track}
      role="slider"
      aria-valuemin={bounds.minMs}
      aria-valuemax={bounds.maxMs}
      aria-valuenow={currentTime.getTime()}
      aria-label="position dans le temps de course"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onKeyDown={(e) => {
        const HOUR = 3_600_000;
        const step = e.shiftKey ? 6 * HOUR : HOUR;
        if (e.key === 'ArrowLeft') setTime(new Date(currentTime.getTime() - step));
        else if (e.key === 'ArrowRight') setTime(new Date(currentTime.getTime() + step));
      }}
    >
      <div className={styles.trackPast} style={{ width: `${nowPct}%` }} />
      <div className={styles.trackFuture} style={{ left: `${nowPct}%`, width: `${100 - nowPct}%` }} />
      <div className={styles.nowLine} style={{ left: `${nowPct}%` }}>
        <span className={styles.nowLabel}>NOW</span>
      </div>
      <div className={styles.cursor} style={{ left: `${cursorPct}%` }} />
      <div className={styles.tickLabels}>
        {ticks.map((t) => (
          <span key={t.ts} className={styles.tickLabel} style={{ left: `${t.pctX}%` }}>
            {t.label}
          </span>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: CSS**

```css
.track {
  position: relative;
  height: 24px;
  width: 100%;
  cursor: pointer;
  user-select: none;
}
.trackPast {
  position: absolute;
  top: 8px; height: 8px; left: 0;
  background: var(--open-soft);
  border-radius: var(--r-pill) 0 0 var(--r-pill);
}
.trackFuture {
  position: absolute;
  top: 8px; height: 8px;
  background: var(--gold-soft);
  border-radius: 0 var(--r-pill) var(--r-pill) 0;
}
.nowLine {
  position: absolute;
  top: 4px; bottom: 4px;
  width: 1px;
  background: var(--t1);
  opacity: 0.6;
  pointer-events: none;
}
.nowLabel {
  position: absolute;
  top: -16px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 9px;
  letter-spacing: 0.5px;
  color: var(--t3);
  text-transform: uppercase;
}
.cursor {
  position: absolute;
  top: 50%;
  width: 14px; height: 14px;
  background: var(--gold);
  border-radius: 50%;
  transform: translate(-50%, -50%);
  box-shadow: 0 0 0 3px var(--gold-soft);
  pointer-events: none;
}
.tickLabels {
  position: absolute;
  top: 24px;
  width: 100%;
  height: 14px;
  pointer-events: none;
}
.tickLabel {
  position: absolute;
  transform: translateX(-50%);
  font-size: 10px;
  color: var(--t3);
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/play/timeline/TimelineTrack.tsx apps/web/src/components/play/timeline/TimelineTrack.module.css
git commit -m "feat(timeline): TimelineTrack with bicolor bar + cursor + ticks"
```

---

### Task 19: Refactor `WeatherTimeline` to compose sub-components

**Files:**
- Modify: `apps/web/src/components/play/WeatherTimeline.tsx`

- [ ] **Step 1: Replace internals**

```tsx
'use client';
import { useEffect, useRef, useState } from 'react';
import type { RaceStatus } from '@/lib/store/timeline-selectors';
import { useTimelinePlayback } from '@/hooks/useTimelinePlayback';
import { TimelineHeader } from './timeline/TimelineHeader';
import { RankSparkline } from './timeline/RankSparkline';
import { TimelineTrack } from './timeline/TimelineTrack';
import styles from './WeatherTimeline.module.css';

export function WeatherTimeline({ raceStatus }: { raceStatus: RaceStatus }): JSX.Element {
  useTimelinePlayback(raceStatus);

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={wrapperRef} className={styles.wrapper}>
      <TimelineHeader />
      <RankSparkline widthPx={width} />
      <TimelineTrack raceStatus={raceStatus} />
    </div>
  );
}
```

- [ ] **Step 2: CSS** (existing `WeatherTimeline.module.css` — adjust `.wrapper`)

```css
.wrapper {
  background: var(--paper);
  padding: var(--sp-5) var(--sp-7);
  border-top: 1px solid var(--navy-rule);
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}
@media (max-width: 768px) {
  .wrapper { padding: var(--sp-3) var(--sp-4); gap: var(--sp-2); }
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/play/WeatherTimeline.tsx apps/web/src/components/play/WeatherTimeline.module.css
git commit -m "refactor(timeline): compose WeatherTimeline from sub-components"
```

---

## Phase D — Map integration

### Task 20: `past-trace-line` source + layer in MapCanvas

**Files:**
- Modify: `apps/web/src/components/play/MapCanvas.tsx`

- [ ] **Step 1: Add source + layer at map init**

In the map `load` handler, after existing source/layer setup:

```ts
map.addSource('past-trace', {
  type: 'geojson',
  data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: {} },
});
map.addLayer({
  id: 'past-trace-line',
  type: 'line',
  source: 'past-trace',
  paint: {
    'line-color': '#7e9fc3',
    'line-width': 2.5,
    'line-opacity': 0.9,
  },
}, 'projection-line'); // insert below projection-line
```

- [ ] **Step 2: Subscribe to track + trailCoords merger**

Add a store subscription that, on every change of `track.myPoints` or `currentTime`, recomputes the LineString coords:

```ts
useEffect(() => {
  const unsubscribe = useGameStore.subscribe((state, prev) => {
    if (state.track.myPoints === prev.track.myPoints && state.timeline.currentTime === prev.timeline.currentTime) return;
    const map = mapRef.current;
    if (!map) return;
    const persisted = state.track.myPoints.map((p) => [p.lon, p.lat] as [number, number]);
    const merged = [...persisted, ...trailCoords];
    const src = map.getSource('past-trace') as maplibregl.GeoJSONSource | undefined;
    src?.setData({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: merged },
      properties: {},
    });
  });
  return unsubscribe;
}, []);
```

> **Note:** make sure `trailCoords` and `mapRef` are in scope. If they aren't, refactor to module-level (they already are per the exploration report).

- [ ] **Step 3: Manual test**

Run dev, join a race, wait for first checkpoint, refresh page. Expected: trace bleue continue derrière le bateau dès le mount (pas seulement après 1 heure de session).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/play/MapCanvas.tsx
git commit -m "feat(map): past-trace layer fed by persisted track + live trail"
```

---

### Task 21: `ghost-boat-icon` source + layer

**Files:**
- Modify: `apps/web/src/components/play/MapCanvas.tsx`

- [ ] **Step 1: Add source + layer (after `my-boat-icon` layer)**

```ts
map.addSource('ghost-boat', {
  type: 'geojson',
  data: { type: 'FeatureCollection', features: [] },
});
map.addLayer({
  id: 'ghost-boat-icon',
  type: 'symbol',
  source: 'ghost-boat',
  layout: {
    'icon-image': 'imoca', // reuse existing image
    'icon-size': 0.6,
    'icon-rotate': ['-', ['get', 'hdg'], 90],
    'icon-rotation-alignment': 'map',
    'icon-allow-overlap': true,
  },
  paint: {
    'icon-opacity': 0.4,
  },
});
```

- [ ] **Step 2: Subscribe to ghost position**

```ts
useEffect(() => {
  const unsubscribe = useGameStore.subscribe((state) => {
    const map = mapRef.current;
    if (!map) return;

    const ghost = computeGhostFromState(state); // see helper below
    const src = map.getSource('ghost-boat') as maplibregl.GeoJSONSource | undefined;
    if (!ghost) {
      src?.setData({ type: 'FeatureCollection', features: [] });
      return;
    }
    src?.setData({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [ghost.lon, ghost.lat] },
        properties: { hdg: ghost.hdg ?? 0 },
      }],
    });
  });
  return unsubscribe;
}, []);
```

Helper at top of file:
```ts
import { selectGhostPosition } from '@/lib/store/timeline-selectors';
import type { GameStore } from '@/lib/store/types';

function computeGhostFromState(s: GameStore): { lat: number; lon: number; hdg: number } | null {
  const projection: { dtMs: number; lat: number; lon: number }[] | null =
    s.projection?.points?.map((p) => ({ dtMs: p.dtMs, lat: p.lat, lon: p.lon })) ?? null;
  const pos = selectGhostPosition({
    currentTimeMs: s.timeline.currentTime.getTime(),
    isLive: s.timeline.isLive,
    nowMs: Date.now(),
    track: s.track.myPoints,
    projection,
  });
  if (!pos) return null;
  return { ...pos, hdg: 0 }; // heading derivation TODO in next task
}
```

> **Note:** the projection data shape (`s.projection?.points`) depends on how the existing projection worker exposes results. Adapt to the real path — see `useProjectionLine.ts` for the source.

- [ ] **Step 3: Add heading derivation to `selectGhostPosition`**

Extend the selector return type and lerp logic (Task 11 file `timeline-selectors.ts`):

```ts
export interface GhostPosition { lat: number; lon: number; hdg: number; }

function bearingDeg(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const Δλ = ((b.lon - a.lon) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const θ = Math.atan2(y, x);
  return ((θ * 180) / Math.PI + 360) % 360;
}
```

In every branch of `selectGhostPosition` that returns a position, also compute `hdg`:

```ts
// past branch — between track points a and b
const hdg = bearingDeg(a, b);
return { lat: lerp(a.lat, b.lat, t), lon: lerp(a.lon, b.lon, t), hdg };

// past branch — clamp to first/last
return { lat: first.lat, lon: first.lon, hdg: 0 };  // no neighbour to derive from

// future branch — between projection points a and b
const hdg = bearingDeg(a, b);
return { lat: lerp(a.lat, b.lat, t), lon: lerp(a.lon, b.lon, t), hdg };
```

Add a test:
```ts
it('derives heading via great-circle bearing between adjacent points', () => {
  const g = selectGhostPosition({ currentTimeMs: 1500, isLive: false, nowMs: 5000, track: baseTrack, projection: null });
  // baseTrack[0] = (47.0, -3.0), baseTrack[1] = (48.0, -3.5) → bearing roughly NW (~340°)
  assert.ok(g);
  assert.ok(g!.hdg >= 330 && g!.hdg <= 360, `expected ~340°, got ${g!.hdg}`);
});
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/play/MapCanvas.tsx apps/web/src/lib/store/timeline-selectors.ts apps/web/src/lib/store/timeline-selectors.test.ts
git commit -m "feat(map): ghost boat layer with heading derivation"
```

---

### Task 22: Toggle weather layers + dim projection on scrub-back

**Files:**
- Modify: `apps/web/src/components/play/MapCanvas.tsx`

- [ ] **Step 1: Subscribe to currentTime + isLive**

```ts
useEffect(() => {
  const unsubscribe = useGameStore.subscribe((state) => {
    const map = mapRef.current;
    if (!map) return;
    const visible = state.timeline.isLive || state.timeline.currentTime.getTime() >= Date.now();
    const visibility: 'visible' | 'none' = visible ? 'visible' : 'none';

    // Weather layers — adjust IDs to match existing layers in this file:
    for (const layerId of ['wind-particles', 'swell-overlay']) {
      if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', visibility);
    }

    // Projection line — dim when scrubbing into the past, full otherwise.
    if (map.getLayer('projection-line')) {
      const op = state.timeline.isLive
        ? 1
        : state.timeline.currentTime.getTime() < Date.now() ? 0.4 : 1;
      map.setPaintProperty('projection-line', 'line-opacity', op);
    }
  });
  return unsubscribe;
}, []);
```

> **Note:** the actual layer IDs for wind/swell may differ — verify by reading `MapCanvas.tsx` and the swell overlay component (`SwellOverlay.tsx`). Add the correct IDs.

- [ ] **Step 2: Manual test**

Drag the cursor backward. Expected: wind+swell disappear, projection line dims to 40% opacity. Scrub forward past now or click LIVE → all return.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/play/MapCanvas.tsx
git commit -m "feat(map): toggle weather + dim projection on scrub-back"
```

---

## Phase E — Integration

### Task 23: Wire `useTrackHydration` and race context in `PlayClient`

**Files:**
- Modify: `apps/web/src/app/play/[raceId]/PlayClient.tsx`

- [ ] **Step 1: Resolve `participantId` and seed race context**

After existing `fetchMyBoat(raceId)` call, also fetch the race summary if not already available. From the response:
```ts
const myParticipantId: string = boatState.participantId; // adjust to the actual field
const raceStartMs = Date.parse(race.startsAt);
const forecastEndMs = Date.now() + 7 * 24 * 3_600_000;
const raceEndMs = race.status === 'FINISHED' ? Date.parse(race.finishedAt!) : null;

useGameStore.getState().setRaceContext({ startMs: raceStartMs, endMs: raceEndMs, forecastEndMs });
useGameStore.getState().setSelfParticipantId(myParticipantId); // see Task 12 note
```

- [ ] **Step 2: Use the hydration hook**

```tsx
useTrackHydration(raceId, myParticipantId);
```

- [ ] **Step 3: Pass race status to WeatherTimeline**

```tsx
<WeatherTimeline raceStatus={race.status} />
```

- [ ] **Step 4: Refresh `forecastEndMs` periodically**

```tsx
useEffect(() => {
  const id = window.setInterval(() => {
    useGameStore.getState().setRaceContext({
      startMs: raceStartMs,
      endMs: raceEndMs,
      forecastEndMs: Date.now() + 7 * 24 * 3_600_000,
    });
  }, 5 * 60_000);
  return () => window.clearInterval(id);
}, [raceStartMs, raceEndMs]);
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/play/[raceId]/PlayClient.tsx
git commit -m "feat(play): wire race context + track hydration into PlayClient"
```

---

### Task 24: Manual QA + tightening

**Files:** any as needed.

- [ ] **Step 1: Manual QA scenarios**

Run `pnpm dev` and verify:

- ✅ Mount play screen during a LIVE race → trace bleue apparaît instantanément derrière le bateau (provient de l'API).
- ✅ Drag pastille en arrière → wind + swell disparaissent ; fantôme apparaît au point passé ; projection s'estompe.
- ✅ Click LIVE → fantôme disparaît, météo réapparaît, pastille revient à `now`.
- ✅ Drag pastille en avant → fantôme glisse sur la projection ; météo continue.
- ✅ Click Play à 24x → pastille avance, fantôme suit ; à `J+7` ça stoppe et revient en LIVE.
- ✅ Sparkline cliquable → scrub vers ce ts.
- ✅ Mode mobile (DevTools 375px) → sparkline caché, contrôles condensés.
- ✅ Onglet inactif → pas de fuite mémoire (rAF cancelled).
- ✅ Refresh page après 2h de course → sparkline correctement renormalisé.
- ✅ Course en BRIEFING (pas démarrée) → range `now → J+7`, pas de zone passée, pas de sparkline.

- [ ] **Step 2: Fix any regression**

Pour chaque échec, investigue, corrige, et committe avec un message clair.

- [ ] **Step 3: Final commit if needed**

```bash
git add -A
git commit -m "fix(timeline): manual QA tightening"
```

---

### Task 25: Cleanup hook integration on race archival

**Files:**
- Identify the place where race status transitions to `ARCHIVED` (search `'ARCHIVED'` across the codebase). Likely in `apps/game-engine/src/api/admin.ts` or similar.

- [ ] **Step 1: Find the transition site**

```bash
grep -rn "ARCHIVED" apps/game-engine/src apps/web/src
```

- [ ] **Step 2: Wire `cleanupRaceTrackPoints`**

In the handler that writes `status = 'ARCHIVED'` to `races`, after the update succeeds:
```ts
import { cleanupRaceTrackPoints } from '../engine/cleanup-track.js';
// ...
await cleanupRaceTrackPoints(db, raceId);
```

If no archival handler exists yet (because archival is a future feature), skip this task and leave a TODO comment in `cleanup-track.ts` with a pointer to its callers.

- [ ] **Step 3: Commit**

```bash
git add apps/game-engine/src/...
git commit -m "feat(engine): cleanup track points on race archival"
```

---

## Validation

After all tasks complete, run:

```bash
# Server-side tests
cd apps/game-engine && pnpm test

# Client-side selectors / helpers
cd apps/web && pnpm exec node --import tsx --test src/lib/store/timeline-selectors.test.ts src/components/play/timeline/ticks.test.ts

# Type checks
cd apps/game-engine && pnpm tsc --noEmit
cd apps/web && pnpm tsc --noEmit
```

All should pass with 0 errors.

---

## Out of scope reminders

- Click-to-select opponent UI (Phase 2 — uses the same API)
- Historical weather replay (Phase 3 — would persist GFS cycles)
- Loop mode on Play
- Reverse Play (drag back, then play from there forward — already supported by current design)
- HTTP cache / ETag on track endpoint
