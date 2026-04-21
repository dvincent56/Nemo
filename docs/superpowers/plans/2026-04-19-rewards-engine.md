# Rewards Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implémenter le système de récompenses de course — échantillonnage du rang toutes les ~5 min, calcul des crédits gagnés à partir de la médiane du rang + rang final, crédit effectif sur `players.credits` à la fin de la course, et traçabilité via `activity_events` + `credit_transactions`.

**Architecture:** Trois nouvelles tables Drizzle (`race_rank_samples`, `activity_events`, `credit_transactions`). Un helper pur `rewards.ts` qui calcule les crédits à partir d'un échantillon de rangs + palmarès. Le `TickManager` (main thread) échantillonne le rang tous les 10 ticks (5 min @ tick=30s). À la détection d'arrivée (`TickOutcome.participantFinished`), le manager déclenche `finalizeRewards()` qui écrit en transaction : ligne `credit_transactions`, ligne `activity_events`, mise à jour `players.credits`, `race_participants.{finalRank,finishedAt}`.

**Tech Stack:** Drizzle ORM, TypeScript strict, Node test runner (`node --import tsx --test`), `@nemo/game-balance` (config).

**Décisions produit** (du brainstorming 2026-04-19) :
- Sampling option **C** : snapshot toutes les ~5 min (toutes les 10 ticks)
- Pondération **0.6 médian + 0.4 final**
- Table séparée `race_rank_samples` (pas de mélange avec `gate_passages`)
- `activity_events` loggué pour chaque course finie

**Dépendance :** Plans 1/2/3 marina (mergés) + seed dev player.

---

## File Structure

### Files to create

| Path | Responsabilité |
|---|---|
| `apps/game-engine/src/engine/rewards.ts` | Helpers purs : `computeMedianRank`, `computeRankScore`, `computeRaceRewards` |
| `apps/game-engine/src/engine/rewards.test.ts` | Tests unitaires de la formule de récompense |
| `apps/game-engine/src/engine/finalization.ts` | Hook de fin de course : calcule le payout, écrit credit_transactions + activity_events + met à jour credits |
| `apps/game-engine/src/engine/rank-sampler.ts` | Ordonne les participants par distance et produit un snapshot de rang |
| `apps/game-engine/src/engine/rank-sampler.test.ts` | Tests unitaires du sampler |

### Files to modify

| Path | Changement |
|---|---|
| `apps/game-engine/src/db/schema.ts` | Ajouter 3 tables : `race_rank_samples`, `activity_events`, `credit_transactions` |
| `packages/game-balance/game-balance.json` | Ajouter `rewards.medianWeight: 0.6`, `rewards.rankSampleIntervalMin: 5` |
| `packages/game-balance/src/index.ts` | Exposer `medianWeight` et `rankSampleIntervalMin` dans `RewardsConfig` |
| `apps/game-engine/src/engine/manager.ts` | Hook de sampling tous les 10 ticks + dispatch `finalizeRewards` à la détection d'arrivée |
| `apps/game-engine/src/api/marina.ts` | Nouvel endpoint `GET /api/v1/players/me/activity` |
| `apps/web/src/lib/marina-api.ts` | Ajouter `fetchMyActivity()` |

---

## Task 1 — Schema : 3 nouvelles tables

**Files:**
- Modify: `apps/game-engine/src/db/schema.ts`

- [ ] **Step 1: Ajouter les enums**

Dans `apps/game-engine/src/db/schema.ts`, après `upgradeSlotEnum` :

```typescript
export const activityEventTypeEnum = pgEnum('activity_event_type', [
  'RACE_FINISHED',
  'RACE_WIN',
  'RACE_PODIUM',
  'UPGRADE_PURCHASED',
  'UPGRADE_SOLD',
  'BOAT_SOLD',
]);

export const creditReasonEnum = pgEnum('credit_reason', [
  'RACE_REWARD',
  'GATE_BONUS',
  'UPGRADE_PURCHASE',
  'UPGRADE_RESALE',
  'BOAT_SALE',
  'REPAIR',
  'ADMIN_ADJUST',
]);
```

- [ ] **Step 2: Ajouter la table `race_rank_samples`**

À la fin du fichier :

```typescript
export const raceRankSamples = pgTable('race_rank_samples', {
  id: uuid('id').primaryKey().defaultRandom(),
  participantId: uuid('participant_id').notNull().references(() => raceParticipants.id, { onDelete: 'cascade' }),
  sampledAt: timestamp('sampled_at', { withTimezone: true }).notNull().defaultNow(),
  rankAtSample: integer('rank_at_sample').notNull(),
  distanceNm: doublePrecision('distance_nm').notNull(),
}, (t) => [
  index('idx_rank_samples_participant').on(t.participantId, t.sampledAt),
]);
```

- [ ] **Step 3: Ajouter la table `activity_events`**

Juste en dessous :

```typescript
export const activityEvents = pgTable('activity_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  playerId: uuid('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
  type: activityEventTypeEnum('type').notNull(),
  raceId: text('race_id').references(() => races.id, { onDelete: 'set null' }),
  payload: jsonb('payload').notNull().default({}),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('idx_activity_player_date').on(t.playerId, t.occurredAt),
]);
```

- [ ] **Step 4: Ajouter la table `credit_transactions`**

Juste en dessous :

```typescript
export const creditTransactions = pgTable('credit_transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  playerId: uuid('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
  amount: integer('amount').notNull(),
  reason: creditReasonEnum('reason').notNull(),
  raceId: text('race_id').references(() => races.id, { onDelete: 'set null' }),
  upgradeCatalogId: text('upgrade_catalog_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('idx_credit_tx_player_date').on(t.playerId, t.createdAt),
]);
```

- [ ] **Step 5: Vérifier la compilation TS**

Run: `cd apps/game-engine && npx tsc --noEmit 2>&1 | grep schema`
Expected: aucune erreur.

- [ ] **Step 6: Appliquer en DB via drizzle-kit push (local)**

Run: `cd apps/game-engine && npx drizzle-kit push`
Expected: les 3 tables créées avec les 2 enums.

- [ ] **Step 7: Commit**

```bash
git add apps/game-engine/src/db/schema.ts
git commit -m "feat(db): add race_rank_samples, activity_events, credit_transactions"
```

---

## Task 2 — Game balance : medianWeight + sample interval

**Files:**
- Modify: `packages/game-balance/game-balance.json`
- Modify: `packages/game-balance/src/index.ts`

- [ ] **Step 1: Ajouter les champs dans `game-balance.json`**

Dans `packages/game-balance/game-balance.json`, bloc `rewards` (~ligne 69) :

```json
"rewards": {
  "distanceRates": { ... },
  "rankMultipliers": [ ... ],
  "sponsorVisibilityRatio": 0.5,
  "leaderBonusRatio": 0.4,
  "streakBonus": 0.1,
  "streakMax": 2.0,
  "medianWeight": 0.6,
  "rankSampleIntervalMin": 5
}
```

- [ ] **Step 2: Étendre `RewardsConfig` dans `index.ts`**

Dans `packages/game-balance/src/index.ts` ou `packages/game-balance/src/types.ts`, interface `RewardsConfig` :

```typescript
export interface RewardsConfig {
  distanceRates: Record<BoatClass, number>;
  rankMultipliers: { threshold: number; multiplier: number }[];
  sponsorVisibilityRatio: number;
  leaderBonusRatio: number;
  streakBonus: number;
  streakMax: number;
  /** Poids de la médiane des rangs dans le calcul (0..1). Reste = rang final. */
  medianWeight: number;
  /** Fréquence de sampling du rang pendant la course, en minutes. */
  rankSampleIntervalMin: number;
}
```

- [ ] **Step 3: Vérifier la compilation du package**

Run: `cd packages/game-balance && npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 4: Vérifier que le chargement passe (boot engine)**

Run: `cd apps/game-engine && node --import tsx -e "import { GameBalance } from '@nemo/game-balance'; await GameBalance.loadFromDisk(); console.log(GameBalance.rewards.medianWeight, GameBalance.rewards.rankSampleIntervalMin);"`
Expected: `0.6 5`

- [ ] **Step 5: Commit**

```bash
git add packages/game-balance/game-balance.json packages/game-balance/src/
git commit -m "feat(balance): add medianWeight + rankSampleIntervalMin to rewards config"
```

---

## Task 3 — Rewards helpers (pures)

**Files:**
- Create: `apps/game-engine/src/engine/rewards.ts`
- Create: `apps/game-engine/src/engine/rewards.test.ts`

- [ ] **Step 1: Écrire les tests**

Créer `apps/game-engine/src/engine/rewards.test.ts` :

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeMedian,
  computeRankScore,
  rankMultiplierFor,
  computeRaceRewards,
} from './rewards.js';

describe('computeMedian', () => {
  it('returns the middle value for odd-length arrays', () => {
    assert.equal(computeMedian([3, 1, 2]), 2);
  });
  it('returns the average of the two middle values for even-length arrays', () => {
    assert.equal(computeMedian([1, 2, 3, 4]), 2.5);
  });
  it('returns NaN for empty arrays', () => {
    assert.ok(Number.isNaN(computeMedian([])));
  });
});

describe('computeRankScore', () => {
  it('weights median and final by alpha', () => {
    // medianPct 0.2, finalPct 0.1, alpha 0.6 → 0.6*0.2 + 0.4*0.1 = 0.16
    assert.equal(computeRankScore(0.2, 0.1, 0.6), 0.16);
  });
  it('falls back to final when median is NaN', () => {
    assert.equal(computeRankScore(NaN, 0.3, 0.6), 0.3);
  });
});

describe('rankMultiplierFor', () => {
  const tiers = [
    { threshold: 0.10, multiplier: 3.0 },
    { threshold: 0.25, multiplier: 2.0 },
    { threshold: 0.50, multiplier: 1.5 },
    { threshold: 0.75, multiplier: 1.1 },
    { threshold: 1.00, multiplier: 1.0 },
  ];
  it('picks the first tier whose threshold >= score', () => {
    assert.equal(rankMultiplierFor(0.05, tiers), 3.0);
    assert.equal(rankMultiplierFor(0.10, tiers), 3.0);
    assert.equal(rankMultiplierFor(0.20, tiers), 2.0);
    assert.equal(rankMultiplierFor(0.80, tiers), 1.0);
  });
});

describe('computeRaceRewards', () => {
  const cfg = {
    distanceRates: { CLASS40: 1.0, FIGARO: 0.8, OCEAN_FIFTY: 1.6, IMOCA60: 1.4, ULTIM: 2.0 },
    rankMultipliers: [
      { threshold: 0.10, multiplier: 3.0 },
      { threshold: 0.25, multiplier: 2.0 },
      { threshold: 0.50, multiplier: 1.5 },
      { threshold: 0.75, multiplier: 1.1 },
      { threshold: 1.00, multiplier: 1.0 },
    ],
    medianWeight: 0.6,
    streakBonus: 0.1,
    streakMax: 2.0,
  };
  const economy = {
    palmaresBonus: { win: 500, podium: 150, top10: 30 },
    completionBonus: { CLASS40: 600, FIGARO: 400, OCEAN_FIFTY: 1000, IMOCA60: 900, ULTIM: 1400 },
  };

  it('computes the spec example: Class40 mid-pack', () => {
    // 500 NM, median 15th/40, final 20th/40, streak 0
    // medianPct = 15/40 = 0.375 → tier 0.5 → 1.5
    // finalPct = 20/40 = 0.5 → tier 0.5 → 1.5
    // rankScore = 0.6*0.375 + 0.4*0.5 = 0.425 → tier 0.5 → 1.5
    // baseCredits = 500 * 1.0 * 1.5 = 750
    // completion = 600
    // palmares = 0 (rank 20 > 10)
    // streak = 0
    // total = 1350
    const r = computeRaceRewards({
      boatClass: 'CLASS40',
      distanceNm: 500,
      totalParticipants: 40,
      medianRank: 15,
      finalRank: 20,
      currentStreak: 0,
    }, { rewards: cfg, economy });
    assert.equal(r.baseCredits, 750);
    assert.equal(r.completionBonus, 600);
    assert.equal(r.palmaresBonus, 0);
    assert.equal(r.streakBonus, 0);
    assert.equal(r.total, 1350);
  });

  it('adds palmares bonus on podium', () => {
    const r = computeRaceRewards({
      boatClass: 'CLASS40',
      distanceNm: 500,
      totalParticipants: 40,
      medianRank: 3,
      finalRank: 2,
      currentStreak: 0,
    }, { rewards: cfg, economy });
    // finalRank 2/40 = 0.05 → tier 0.10 → 3.0
    // podium 150 + top10 30 = 180
    assert.equal(r.palmaresBonus, 180);
    assert.ok(r.total > r.baseCredits + r.completionBonus);
  });

  it('scales streak bonus with cap', () => {
    const r = computeRaceRewards({
      boatClass: 'CLASS40',
      distanceNm: 500,
      totalParticipants: 40,
      medianRank: 15,
      finalRank: 20,
      currentStreak: 25, // way over cap
    }, { rewards: cfg, economy });
    // Cap at streakMax=2.0, streakBonus=0.1 → min(2.0, 25 * 0.1) = 2.0
    // baseCredits × 2.0 = 750 × 2.0 = 1500
    assert.equal(r.streakBonus, 1500);
  });
});
```

- [ ] **Step 2: Vérifier que les tests échouent (module absent)**

Run: `cd apps/game-engine && node --import tsx --test src/engine/rewards.test.ts`
Expected: FAIL — module `./rewards.js` not found.

- [ ] **Step 3: Implémenter `rewards.ts`**

Créer `apps/game-engine/src/engine/rewards.ts` :

```typescript
import type { BoatClass } from '@nemo/shared-types';

export interface RewardsConfigShape {
  distanceRates: Record<BoatClass, number>;
  rankMultipliers: { threshold: number; multiplier: number }[];
  medianWeight: number;
  streakBonus: number;
  streakMax: number;
}

export interface EconomyConfigShape {
  palmaresBonus: { win: number; podium: number; top10: number };
  completionBonus: Record<BoatClass, number>;
}

export interface RewardsInput {
  boatClass: BoatClass;
  distanceNm: number;
  totalParticipants: number;
  medianRank: number;
  finalRank: number;
  currentStreak: number;
}

export interface RewardsBreakdown {
  baseCredits: number;
  completionBonus: number;
  palmaresBonus: number;
  streakBonus: number;
  total: number;
  medianPct: number;
  finalPct: number;
  rankScore: number;
  multiplier: number;
}

export function computeMedian(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function computeRankScore(medianPct: number, finalPct: number, alpha: number): number {
  if (Number.isNaN(medianPct)) return finalPct;
  return alpha * medianPct + (1 - alpha) * finalPct;
}

export function rankMultiplierFor(
  score: number,
  tiers: { threshold: number; multiplier: number }[],
): number {
  for (const tier of tiers) {
    if (score <= tier.threshold) return tier.multiplier;
  }
  return tiers[tiers.length - 1]?.multiplier ?? 1.0;
}

export function computeRaceRewards(
  input: RewardsInput,
  cfg: { rewards: RewardsConfigShape; economy: EconomyConfigShape },
): RewardsBreakdown {
  const { boatClass, distanceNm, totalParticipants, medianRank, finalRank, currentStreak } = input;
  const { rewards, economy } = cfg;

  const medianPct = totalParticipants > 0 ? medianRank / totalParticipants : NaN;
  const finalPct = totalParticipants > 0 ? finalRank / totalParticipants : 1;
  const rankScore = computeRankScore(medianPct, finalPct, rewards.medianWeight);
  const multiplier = rankMultiplierFor(rankScore, rewards.rankMultipliers);

  const baseCredits = Math.floor(distanceNm * (rewards.distanceRates[boatClass] ?? 1) * multiplier);
  const completionBonus = economy.completionBonus[boatClass] ?? 0;

  let palmaresBonus = 0;
  if (finalRank === 1) palmaresBonus += economy.palmaresBonus.win;
  if (finalRank >= 1 && finalRank <= 3) palmaresBonus += economy.palmaresBonus.podium;
  if (finalRank >= 1 && finalRank <= 10) palmaresBonus += economy.palmaresBonus.top10;

  const streakMul = Math.min(rewards.streakMax, currentStreak * rewards.streakBonus);
  const streakBonus = Math.floor(baseCredits * streakMul);

  const total = baseCredits + completionBonus + palmaresBonus + streakBonus;

  return {
    baseCredits, completionBonus, palmaresBonus, streakBonus,
    total, medianPct, finalPct, rankScore, multiplier,
  };
}
```

- [ ] **Step 4: Lancer les tests**

Run: `cd apps/game-engine && node --import tsx --test src/engine/rewards.test.ts`
Expected: tous PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/game-engine/src/engine/rewards.ts apps/game-engine/src/engine/rewards.test.ts
git commit -m "feat(engine): pure rewards formula — median × final rank multiplier"
```

---

## Task 4 — Rank sampler (pure helper)

**Files:**
- Create: `apps/game-engine/src/engine/rank-sampler.ts`
- Create: `apps/game-engine/src/engine/rank-sampler.test.ts`

- [ ] **Step 1: Écrire les tests**

Créer `apps/game-engine/src/engine/rank-sampler.test.ts` :

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rankParticipants } from './rank-sampler.js';

describe('rankParticipants', () => {
  it('ranks by descending distance (highest = rank 1)', () => {
    const input = [
      { participantId: 'a', distanceNm: 100 },
      { participantId: 'b', distanceNm: 250 },
      { participantId: 'c', distanceNm: 180 },
    ];
    const out = rankParticipants(input);
    assert.deepEqual(out.map((r) => r.participantId), ['b', 'c', 'a']);
    assert.deepEqual(out.map((r) => r.rank), [1, 2, 3]);
  });

  it('gives the same rank on ties (competition ranking)', () => {
    const input = [
      { participantId: 'a', distanceNm: 200 },
      { participantId: 'b', distanceNm: 200 },
      { participantId: 'c', distanceNm: 100 },
    ];
    const out = rankParticipants(input);
    // a and b tie for rank 1, c is rank 3 (1224 ranking)
    const byId = new Map(out.map((r) => [r.participantId, r.rank]));
    assert.equal(byId.get('a'), 1);
    assert.equal(byId.get('b'), 1);
    assert.equal(byId.get('c'), 3);
  });

  it('returns empty array for empty input', () => {
    assert.deepEqual(rankParticipants([]), []);
  });
});
```

- [ ] **Step 2: Vérifier que ça échoue**

Run: `cd apps/game-engine && node --import tsx --test src/engine/rank-sampler.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implémenter**

Créer `apps/game-engine/src/engine/rank-sampler.ts` :

```typescript
export interface ParticipantDistance {
  participantId: string;
  distanceNm: number;
}

export interface RankedParticipant extends ParticipantDistance {
  rank: number;
}

/**
 * Assigns ranks to participants by descending distanceNm.
 * Uses competition ranking (1224) — ties get the same rank and the
 * next rank skips the tied positions, so the max rank always equals
 * the participant count.
 */
export function rankParticipants(entries: ParticipantDistance[]): RankedParticipant[] {
  if (entries.length === 0) return [];
  const sorted = [...entries].sort((a, b) => b.distanceNm - a.distanceNm);
  const out: RankedParticipant[] = [];
  let currentRank = 1;
  let lastDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < sorted.length; i++) {
    const entry = sorted[i]!;
    if (entry.distanceNm < lastDistance) {
      currentRank = i + 1;
      lastDistance = entry.distanceNm;
    }
    out.push({ ...entry, rank: currentRank });
  }
  return out;
}
```

- [ ] **Step 4: Lancer les tests**

Run: `cd apps/game-engine && node --import tsx --test src/engine/rank-sampler.test.ts`
Expected: tous PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/game-engine/src/engine/rank-sampler.ts apps/game-engine/src/engine/rank-sampler.test.ts
git commit -m "feat(engine): rank-sampler — compute ranks from distance snapshots"
```

---

## Task 5 — Finalization : crédit + activity + transaction

**Files:**
- Create: `apps/game-engine/src/engine/finalization.ts`

- [ ] **Step 1: Implémenter `finalizeParticipantRewards`**

Créer `apps/game-engine/src/engine/finalization.ts` :

```typescript
import { and, eq, sql } from 'drizzle-orm';
import pino from 'pino';
import { GameBalance } from '@nemo/game-balance';
import type { BoatClass } from '@nemo/shared-types';
import type { DbClient } from '../db/client.js';
import {
  activityEvents,
  boats,
  creditTransactions,
  players,
  raceParticipants,
  raceRankSamples,
} from '../db/schema.js';
import { computeMedian, computeRaceRewards, type RewardsBreakdown } from './rewards.js';

const log = pino({ name: 'engine.finalization' });

export interface FinalizationResult {
  participantId: string;
  playerId: string;
  raceId: string;
  finalRank: number;
  breakdown: RewardsBreakdown;
}

/**
 * Called when a participant crosses the finish line. Reads its rank
 * samples, computes rewards, and writes everything in a single tx :
 *   - race_participants.finalRank + finishedAt
 *   - credit_transactions row (RACE_REWARD)
 *   - activity_events row (RACE_FINISHED, RACE_PODIUM, RACE_WIN as applicable)
 *   - players.credits += total
 *
 * Idempotent: if the participant already has finishedAt set, returns null.
 */
export async function finalizeParticipantRewards(
  db: DbClient,
  participantId: string,
  finalRank: number,
  totalParticipants: number,
): Promise<FinalizationResult | null> {
  const [participant] = await db.select().from(raceParticipants)
    .where(eq(raceParticipants.id, participantId));
  if (!participant) {
    log.warn({ participantId }, 'finalize: participant not found');
    return null;
  }
  if (participant.finishedAt) {
    log.info({ participantId }, 'finalize: already finalized, skipping');
    return null;
  }

  const [boat] = await db.select().from(boats).where(eq(boats.id, participant.boatId));
  if (!boat) { log.warn({ participantId }, 'finalize: boat not found'); return null; }

  const [player] = await db.select().from(players).where(eq(players.id, participant.playerId));
  if (!player) { log.warn({ participantId }, 'finalize: player not found'); return null; }

  const samples = await db.select().from(raceRankSamples)
    .where(eq(raceRankSamples.participantId, participantId));
  const medianRank = computeMedian(samples.map((s) => s.rankAtSample));

  const breakdown = computeRaceRewards(
    {
      boatClass: boat.boatClass as BoatClass,
      distanceNm: participant.distanceNm,
      totalParticipants,
      medianRank: Number.isNaN(medianRank) ? finalRank : medianRank,
      finalRank,
      currentStreak: player.currentStreak,
    },
    { rewards: GameBalance.rewards, economy: GameBalance.economy },
  );

  await db.transaction(async (tx) => {
    await tx.update(raceParticipants)
      .set({ finalRank, finishedAt: new Date() })
      .where(eq(raceParticipants.id, participantId));

    if (breakdown.total > 0) {
      await tx.insert(creditTransactions).values({
        playerId: player.id,
        amount: breakdown.total,
        reason: 'RACE_REWARD',
        raceId: participant.raceId,
      });
      await tx.update(players)
        .set({ credits: sql`${players.credits} + ${breakdown.total}` })
        .where(eq(players.id, player.id));
    }

    await tx.insert(activityEvents).values({
      playerId: player.id,
      type: finalRank === 1 ? 'RACE_WIN' : finalRank <= 3 ? 'RACE_PODIUM' : 'RACE_FINISHED',
      raceId: participant.raceId,
      payload: {
        finalRank,
        totalParticipants,
        distanceNm: participant.distanceNm,
        creditsEarned: breakdown.total,
        medianPct: breakdown.medianPct,
        finalPct: breakdown.finalPct,
        rankScore: breakdown.rankScore,
        breakdown: {
          base: breakdown.baseCredits,
          completion: breakdown.completionBonus,
          palmares: breakdown.palmaresBonus,
          streak: breakdown.streakBonus,
        },
      },
    });

    // Update player aggregate stats (finals, streak, etc.)
    const wins = finalRank === 1 ? 1 : 0;
    const podiums = finalRank >= 1 && finalRank <= 3 ? 1 : 0;
    const top10 = finalRank >= 1 && finalRank <= 10 ? 1 : 0;
    const newStreak = finalRank <= 3 ? (player.currentStreak + 1) : 0;

    await tx.update(players).set({
      racesFinished: sql`${players.racesFinished} + 1`,
      wins: sql`${players.wins} + ${wins}`,
      podiums: sql`${players.podiums} + ${podiums}`,
      top10Finishes: sql`${players.top10Finishes} + ${top10}`,
      currentStreak: newStreak,
      totalNm: sql`${players.totalNm} + ${participant.distanceNm}`,
    }).where(eq(players.id, player.id));

    // Also bump the boat's palmares counters
    await tx.update(boats).set({
      racesCount: sql`${boats.racesCount} + 1`,
      wins: sql`${boats.wins} + ${wins}`,
      podiums: sql`${boats.podiums} + ${podiums}`,
      top10Finishes: sql`${boats.top10Finishes} + ${top10}`,
      activeRaceId: null,
    }).where(eq(boats.id, boat.id));
  });

  log.info({ participantId, finalRank, credits: breakdown.total }, 'participant finalized');

  return {
    participantId,
    playerId: player.id,
    raceId: participant.raceId,
    finalRank,
    breakdown,
  };
}
```

- [ ] **Step 2: Vérifier la compilation**

Run: `cd apps/game-engine && npx tsc --noEmit 2>&1 | grep finalization`
Expected: aucune erreur.

- [ ] **Step 3: Commit**

```bash
git add apps/game-engine/src/engine/finalization.ts
git commit -m "feat(engine): finalizeParticipantRewards — pay credits + log activity"
```

---

## Task 6 — Tick manager : rank sampling + finalization dispatch

**Files:**
- Modify: `apps/game-engine/src/engine/manager.ts`

- [ ] **Step 1: Importer les helpers**

Dans `apps/game-engine/src/engine/manager.ts`, après les imports existants :

```typescript
import { sql } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { raceRankSamples } from '../db/schema.js';
import { rankParticipants } from './rank-sampler.js';
import { finalizeParticipantRewards } from './finalization.js';
```

- [ ] **Step 2: Ajouter un état de sampling dans la classe TickManager**

Dans la classe `TickManager` (haut du fichier, après le champ `redis`) :

```typescript
  /** Tick seq of the last rank sample. Used to avoid sampling on every tick. */
  private lastSampleSeq = 0;
  /** Computed from game-balance: how many ticks between samples. */
  private sampleEveryNTicks = 10; // 10 * 30s = 5 min (updated at boot)
```

- [ ] **Step 3: Initialiser `sampleEveryNTicks` au démarrage**

Dans la méthode `start()`, avant `this.worker = new Worker(...)` :

```typescript
    const tickSec = GameBalance.tickIntervalSeconds;
    const sampleMin = GameBalance.rewards.rankSampleIntervalMin;
    this.sampleEveryNTicks = Math.max(1, Math.round((sampleMin * 60) / tickSec));
    log.info({ sampleEveryNTicks: this.sampleEveryNTicks }, 'rank sampling configured');
```

- [ ] **Step 4: Ajouter la logique de sampling + finalization après chaque tick**

Dans le handler de `TickDoneMsg` (là où `runtimes` et `outcomes` sont reçus du worker), ajouter avant le return ou à la fin du handler :

```typescript
    // Rank sampling — every N ticks, group runtimes by raceId and snapshot ranks
    if (seq - this.lastSampleSeq >= this.sampleEveryNTicks) {
      this.lastSampleSeq = seq;
      void this.sampleRanks(runtimes).catch((err) =>
        log.error({ err }, 'rank sample failed'),
      );
    }

    // Finalization — if a tick reported a participant crossing the finish line,
    // the outcome carries `participantFinished: true` with finalRank.
    for (const outcome of outcomes) {
      if (outcome.participantFinished && outcome.participantId && outcome.finalRank) {
        void this.finalize(outcome.participantId, outcome.finalRank).catch((err) =>
          log.error({ err, participantId: outcome.participantId }, 'finalize failed'),
        );
      }
    }
```

- [ ] **Step 5: Implémenter `sampleRanks` et `finalize` comme méthodes de TickManager**

À la fin de la classe `TickManager`, ajouter :

```typescript
  private async sampleRanks(runtimes: BoatRuntime[]): Promise<void> {
    const db = getDb();
    if (!db) return;

    // Group runtimes by race
    const byRace = new Map<string, { participantId: string; distanceNm: number }[]>();
    for (const rt of runtimes) {
      const participantId = (rt as { participantId?: string }).participantId;
      if (!participantId) continue;
      const distanceNm = (rt as { distanceNm?: number }).distanceNm ?? 0;
      const entry = byRace.get(rt.raceId) ?? [];
      entry.push({ participantId, distanceNm });
      byRace.set(rt.raceId, entry);
    }

    const now = new Date();
    for (const [, entries] of byRace) {
      const ranked = rankParticipants(entries);
      for (const r of ranked) {
        await db.insert(raceRankSamples).values({
          participantId: r.participantId,
          sampledAt: now,
          rankAtSample: r.rank,
          distanceNm: r.distanceNm,
        });
      }
    }
  }

  private async finalize(participantId: string, finalRank: number): Promise<void> {
    const db = getDb();
    if (!db) return;

    // Compute totalParticipants for this race (same raceId, finished or still active)
    const [{ count }] = await db.execute<{ count: number }>(
      sql`SELECT COUNT(*)::int AS count FROM race_participants WHERE race_id = (
        SELECT race_id FROM race_participants WHERE id = ${participantId}
      )`,
    );
    const totalParticipants = Number(count);

    await finalizeParticipantRewards(db, participantId, finalRank, totalParticipants);
  }
```

- [ ] **Step 6: Note — `BoatRuntime` doit exposer `participantId` et `distanceNm`**

Si `BoatRuntime` n'a pas `participantId` (actuellement le demo runtime utilise `raceId` uniquement), deux options :
- Enrichir `BoatRuntime` avec `{ participantId: string; distanceNm: number }` optionnels
- Skip le sampling pour les runtimes qui n'en ont pas (fallback safe)

Step 5 fait le skip gracieux (`if (!participantId) continue;`) donc l'engine reste fonctionnel avec des runtimes incomplets. Ajouter `participantId` à `BoatRuntime` quand l'hydratation DB de Phase 4 sera faite.

- [ ] **Step 7: Vérifier la compilation**

Run: `cd apps/game-engine && npx tsc --noEmit 2>&1 | grep -E "(manager|finalization|rank-sampler)"`
Expected: aucune erreur (sauf pré-existantes non liées).

- [ ] **Step 8: Commit**

```bash
git add apps/game-engine/src/engine/manager.ts
git commit -m "feat(engine): TickManager samples ranks every 5min + dispatches finalization"
```

---

## Task 7 — API : endpoint activity feed

**Files:**
- Modify: `apps/game-engine/src/api/marina.ts`

- [ ] **Step 1: Ajouter l'import**

Dans `apps/game-engine/src/api/marina.ts`, ajouter aux imports `schema` :

```typescript
import {
  players,
  boats,
  playerUpgrades,
  boatInstalledUpgrades,
  raceParticipants,
  activityEvents,
} from '../db/schema.js';
```

Et ajouter `desc` à l'import Drizzle :

```typescript
import { eq, and, sql, inArray, desc } from 'drizzle-orm';
```

- [ ] **Step 2: Ajouter l'endpoint dans `registerMarinaRoutes`**

Ajouter, après le GET /boats/:id existant :

```typescript
  // =========================================================================
  // GET /api/v1/players/me/activity — recent events (finished races, buys, sales)
  // =========================================================================

  app.get('/api/v1/players/me/activity', { preHandler: [enforceAuth] }, async (req, reply) => {
    const auth = req.auth!;
    const db = getDb();
    if (!db) { reply.code(503); return { error: 'database unavailable' }; }

    const player = await findPlayerBySub(db, auth.sub);
    if (!player) { reply.code(404); return { error: 'player not found' }; }

    const q = req.query as { limit?: string };
    const limitRaw = Number(q.limit ?? 50);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, limitRaw), 200) : 50;

    const events = await db.select().from(activityEvents)
      .where(eq(activityEvents.playerId, player.id))
      .orderBy(desc(activityEvents.occurredAt))
      .limit(limit);

    return {
      events: events.map((e) => ({
        id: e.id,
        type: e.type,
        raceId: e.raceId,
        payload: e.payload,
        occurredAt: e.occurredAt.toISOString(),
      })),
    };
  });
```

- [ ] **Step 3: Vérifier la compilation**

Run: `cd apps/game-engine && npx tsc --noEmit 2>&1 | grep marina`
Expected: aucune erreur.

- [ ] **Step 4: Commit**

```bash
git add apps/game-engine/src/api/marina.ts
git commit -m "feat(marina): GET /players/me/activity — paginated feed of recent events"
```

---

## Task 8 — Frontend API client + types

**Files:**
- Modify: `apps/web/src/lib/marina-api.ts`

- [ ] **Step 1: Ajouter types + fetch**

Dans `apps/web/src/lib/marina-api.ts`, après les autres types :

```typescript
export type ActivityEventType =
  | 'RACE_FINISHED' | 'RACE_WIN' | 'RACE_PODIUM'
  | 'UPGRADE_PURCHASED' | 'UPGRADE_SOLD' | 'BOAT_SOLD';

export interface ActivityEvent {
  id: string;
  type: ActivityEventType;
  raceId: string | null;
  payload: Record<string, unknown>;
  occurredAt: string;
}

export async function fetchMyActivity(limit = 50): Promise<{ events: ActivityEvent[] }> {
  return apiFetch(`/api/v1/players/me/activity?limit=${limit}`);
}
```

- [ ] **Step 2: Vérifier la compilation**

Run: `cd apps/web && npx tsc --noEmit 2>&1 | grep marina-api`
Expected: aucune erreur.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/marina-api.ts
git commit -m "feat(web): add ActivityEvent type + fetchMyActivity API call"
```

---

## Task 9 — Frontend : replace mock history with real activity

**Files:**
- Modify: `apps/web/src/app/marina/[boatId]/BoatDetailView.tsx`

- [ ] **Step 1: Remplacer la mock history par le flux d'events**

Dans `BoatDetailView.tsx`, remplacer l'import :

```typescript
import {
  fetchBoatDetail, fetchCatalog, fetchMyActivity,
  type BoatRecord, type InstalledUpgrade, type UpgradeSlot, type SlotAvailability,
  type ActivityEvent,
} from '@/lib/marina-api';
```

Ensuite, retirer l'usage de `BoatRaceHistoryEntry` et `MOCK_HISTORY`. Dans le `load` callback, remplacer la ligne `setHistory(MOCK_HISTORY[boatId] ?? []);` par :

```typescript
      const activityData = await fetchMyActivity(100);
      const boatRaceIds = new Set<string>();
      // Filter to races this boat participated in — we can't cheaply join DB
      // here, so the payload includes boatId when finalization logs an event.
      // Accept events where payload.boatId matches, or all race events if the
      // payload doesn't carry it yet (backward compatible).
      const boatHistory = activityData.events.filter((e) => {
        if (!e.raceId) return false;
        if (e.type !== 'RACE_FINISHED' && e.type !== 'RACE_PODIUM' && e.type !== 'RACE_WIN') return false;
        const payloadBoatId = (e.payload as { boatId?: string }).boatId;
        return payloadBoatId === undefined || payloadBoatId === boatId;
      });
      setHistory(boatHistory);
```

Et remplacer le type du state `history` :

```typescript
  const [history, setHistory] = useState<ActivityEvent[]>([]);
```

Remplacer le rendering de `visibleHistory.map((h) => ...)` :

```typescript
              {visibleHistory.map((e) => {
                const p = e.payload as {
                  finalRank?: number;
                  creditsEarned?: number;
                  distanceNm?: number;
                };
                const rank = p.finalRank ?? 0;
                const date = new Date(e.occurredAt).toLocaleDateString('fr-FR', {
                  day: '2-digit', month: 'short', year: 'numeric',
                });
                return (
                  <Link
                    key={e.id}
                    href={`/ranking/${e.raceId}` as Parameters<typeof Link>[0]['href']}
                    className={styles.historyRow}
                  >
                    <span className={`${styles.historyPos} ${rank > 0 && rank <= 3 ? styles.historyPosPodium : ''}`}>
                      {rank > 0 ? (
                        <>{String(rank).padStart(2, '0')}<sup>{rank === 1 ? 'er' : 'e'}</sup></>
                      ) : '—'}
                    </span>
                    <div className={styles.historyCell}>
                      <p className={styles.historyName}>{e.raceId}</p>
                      <p className={styles.historyMeta}>
                        {classLabel} · {date} · {(p.distanceNm ?? 0).toLocaleString('fr-FR')} NM
                      </p>
                    </div>
                    <span className={styles.historyTime}>—</span>
                    <span className={styles.historyCredits}>
                      {p.creditsEarned && p.creditsEarned > 0
                        ? `+ ${p.creditsEarned.toLocaleString('fr-FR')} cr.`
                        : '—'}
                    </span>
                  </Link>
                );
              })}
```

Retirer l'import `BoatRaceHistoryEntry` s'il n'est plus utilisé ailleurs dans le fichier.

- [ ] **Step 2: Mettre à jour finalization pour stocker boatId dans le payload**

Revenir sur `apps/game-engine/src/engine/finalization.ts` — dans le `activityEvents.payload`, ajouter `boatId: boat.id` :

```typescript
      payload: {
        boatId: boat.id,
        finalRank,
        totalParticipants,
        distanceNm: participant.distanceNm,
        creditsEarned: breakdown.total,
        medianPct: breakdown.medianPct,
        finalPct: breakdown.finalPct,
        rankScore: breakdown.rankScore,
        breakdown: {
          base: breakdown.baseCredits,
          completion: breakdown.completionBonus,
          palmares: breakdown.palmaresBonus,
          streak: breakdown.streakBonus,
        },
      },
```

- [ ] **Step 3: Vérifier la compilation**

Run: `cd apps/web && npx tsc --noEmit 2>&1 | grep BoatDetailView`
Expected: aucune erreur.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/marina/\[boatId\]/BoatDetailView.tsx apps/game-engine/src/engine/finalization.ts
git commit -m "feat(marina): wire boat history to real activity_events feed"
```

---

## Récapitulatif

| # | Task | Fichiers |
|---|------|----------|
| 1 | Schema : 3 tables + 2 enums | `schema.ts` |
| 2 | game-balance : medianWeight + interval | `game-balance.json`, `types.ts` |
| 3 | Pure rewards helpers + tests | `rewards.ts`, `rewards.test.ts` |
| 4 | Rank sampler + tests | `rank-sampler.ts`, `rank-sampler.test.ts` |
| 5 | Finalization (tx complète) | `finalization.ts` |
| 6 | TickManager : sample + dispatch | `manager.ts` |
| 7 | API : GET /players/me/activity | `marina.ts` |
| 8 | Frontend API client | `marina-api.ts` |
| 9 | Frontend history → real events | `BoatDetailView.tsx`, `finalization.ts` (payload.boatId) |

## Décisions couvertes du brainstorming

| Décision | Task(s) |
|---|---|
| Sampling option C (toutes les 5 min) | 2, 6 |
| Pondération 0.6 médian / 0.4 final | 3 |
| Table séparée `race_rank_samples` | 1 |
| Activity events tracés | 1, 5, 7, 8, 9 |
| Crédits pay-out sur fin de course | 5, 6 |
| Paiement en transaction | 5 |

## Notes d'intégration

- Les tâches 6 fait une hypothèse : `BoatRuntime` doit exposer `participantId` et `distanceNm`. Si ce n'est pas encore le cas, le sampler skip gracieusement. À enrichir quand l'hydratation DB Phase 4 atterrira.
- La détection de fin de course (`outcome.participantFinished`) est supposée implémentée dans le tick. Si ce n'est pas le cas, ajouter une tâche pré-requise qui detect le passage de la ligne d'arrivée dans `tick.ts` et set le flag.
- L'endpoint `/activity` retourne le flux brut ; un endpoint dédié `/api/v1/boats/:id/history` pourrait matérialiser le filtre côté serveur en Phase 5 quand l'usage sera plus mature.
