# Wear System Rework — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refonte du système d'usure : moyenne pondérée des composants pour la vitesse, courbe d'usure conditionnelle (zéro en mer calme), suppression de la réparation payante, réparation auto au départ de course.

**Architecture:**
- Moteur : remplacer `conditionSpeedPenalty` (min → moyenne pondérée) et `computeWearDelta` (nouveaux taux de base + nouveaux multiplicateurs vent/houle additifs) dans `packages/game-engine-core/src/wear.ts`.
- Balance : réviser la section `wear` de `game-balance.json` (deux fichiers miroir), supprimer la section `maintenance` et son type `MaintenanceEntry`.
- API : supprimer `POST /api/v1/boats/:id/repair` et les helpers de coût de réparation.
- UI : retirer `RepairModal` et le bouton « Réparer » de Marina, ajouter une info-card d'explication, afficher la pénalité de vitesse en temps réel dans le HUD.
- Reset course : exposer `INITIAL_CONDITIONS` depuis `wear.ts`, consommé partout où un `BoatRuntime` démarre une course (aujourd'hui : demo seed dans `apps/game-engine/src/index.ts`, futur inscription Phase 4).

**Tech Stack:** TypeScript strict, `node:test` + `tsx` (pas de vitest dans `game-engine-core`), React 19, Fastify, Drizzle ORM, turborepo+pnpm.

---

## Fichiers touchés

**Créer :**
- `packages/game-engine-core/src/wear.test.ts` — tests TDD pour la nouvelle formule de pénalité et la nouvelle courbe d'usure

**Modifier :**
- `packages/game-balance/game-balance.json` — section `wear` (nouveaux chiffres), suppression section `maintenance`
- `apps/web/public/data/game-balance.json` — mêmes modifs (mirror)
- `packages/game-balance/src/types.ts` — mise à jour `WearConfig`, suppression `MaintenanceEntry` et champ `maintenance` de `GameBalanceConfig`
- `packages/game-engine-core/src/wear.ts` — réécriture `conditionSpeedPenalty`, réécriture `computeWearDelta`, export `INITIAL_CONDITIONS`
- `apps/game-engine/src/api/marina.ts` — suppression route `/repair` (lignes 579–663), imports inutiles
- `apps/game-engine/src/api/marina.helpers.ts` — suppression `computeRepairCost`, `repairAxisCost`, `conditionAxisToSlot`, `RepairBreakdown`, `AXIS_TO_SLOT`
- `apps/game-engine/src/test/e2e-marina-api.ts` — suppression du Test 9 (repair), renumérotation
- `apps/game-engine/src/index.ts` — utiliser `INITIAL_CONDITIONS` au lieu de valeurs inline
- `apps/web/src/app/marina/[boatId]/BoatDetailView.tsx` — suppression import+état+bouton « Réparer » + rendu `<RepairModal>`, ajout info-card
- `apps/web/src/app/marina/[boatId]/page.module.css` — styles info-card (ou réutiliser existants)
- `apps/game-engine/src/api/runtime.ts` — ajout `speedPenaltyPct` dans `BoatSnapshotDTO`, calcul via `conditionSpeedPenalty`
- `apps/web/src/lib/api.ts` — ajout `speedPenaltyPct` dans l'interface miroir
- `apps/web/src/app/play/[raceId]/PlayClient.tsx` — propagation `speedPenaltyPct` vers le store
- `apps/web/src/lib/store.ts` (ou équivalent) — ajout `speedPenaltyPct` au type HUD
- `apps/web/src/app/api/v1/races/[raceId]/my-boat/route.ts` — ajout champ dans le stub mock
- `apps/web/src/components/play/HudBar.tsx` — tooltip explicatif + affichage pénalité vitesse

**Supprimer :**
- `apps/web/src/app/marina/[boatId]/RepairModal.tsx`
- `apps/web/src/app/marina/[boatId]/RepairModal.module.css`

---

## Task 1: Mettre à jour la config `wear` dans le JSON de balance engine

**Files:**
- Modify: `packages/game-balance/game-balance.json:5-43`

- [ ] **Step 1 : remplacer la section `wear` par les nouvelles valeurs**

Modifier `packages/game-balance/game-balance.json`. Remplacer le bloc actuel (lignes 5–43) par :

```json
  "wear": {
    "minCondition": 35,
    "maxSpeedPenalty": 8,
    "penaltyCurve": {
      "thresholdNone": 85,
      "thresholdMax": 50,
      "slopePerPoint": 0.2286
    },
    "componentWeights": {
      "hull": 0.2,
      "rig": 0.3,
      "sails": 0.5
    },
    "baseRatesPerHour": {
      "hull": 0.003,
      "rig": 0.006,
      "sails": 0.010,
      "electronics": 0.002
    },
    "windMultipliers": {
      "zeroBelowKnots": 15,
      "rampEndKnots": 25,
      "midFactor": 1.0,
      "midEndKnots": 35,
      "highFactor": 2.5,
      "stormEndKnots": 45,
      "stormFactor": 5.0
    },
    "swellMultipliers": {
      "zeroBelowMeters": 1.5,
      "rampEndMeters": 4.0,
      "midFactor": 1.0,
      "midEndMeters": 7.0,
      "highFactor": 2.5,
      "shortPeriodThresholdSec": 8,
      "shortPeriodBonus": 0.3,
      "dirFaceFactor": 1.5,
      "dirBeamFactor": 1.0,
      "dirBackFactor": 0.5
    },
    "upgradeMultipliers": {
      "foils_rig": 1.8,
      "foils_hull": 1.3,
      "reinforced_hull": 0.45,
      "carbon_rig_normal": 1.0,
      "carbon_rig_strong": 1.6,
      "carbon_threshold_kts": 35,
      "kevlar_sails": 0.35,
      "heavy_weather_rig": 0.55,
      "heavy_weather_sails": 0.55
    }
  },
```

Note : `slopePerPoint = 8 / (85 - 50) = 0.2286` (pente linéaire de la nouvelle pénalité).

- [ ] **Step 2 : supprimer la section `maintenance`**

Dans le même fichier, supprimer les lignes 149–166 (tout le bloc `"maintenance": { ... }`) et la virgule trailing qui le précède. Vérifier que le JSON reste valide (pas de virgule orpheline entre `rewards` et `upgrades`).

- [ ] **Step 3 : vérifier validité JSON**

Run:
```bash
node -e "JSON.parse(require('fs').readFileSync('packages/game-balance/game-balance.json', 'utf8')); console.log('OK');"
```
Expected: `OK`

- [ ] **Step 4 : commit**

```bash
git add packages/game-balance/game-balance.json
git commit -m "balance(wear): new rates, weighted average penalty, drop maintenance"
```

---

## Task 2: Mirror sur la copie web du JSON

**Files:**
- Modify: `apps/web/public/data/game-balance.json`

- [ ] **Step 1 : appliquer les mêmes modifications qu'en Task 1**

Remplacer la section `wear` et supprimer la section `maintenance` à l'identique. **Ne pas toucher** la section `swell` — elle diverge volontairement entre les deux fichiers (cf CLAUDE.md : « They have a known pre-existing divergence on the `swell` block — do not sync without explicit scope approval »).

- [ ] **Step 2 : vérifier validité JSON**

Run:
```bash
node -e "JSON.parse(require('fs').readFileSync('apps/web/public/data/game-balance.json', 'utf8')); console.log('OK');"
```
Expected: `OK`

- [ ] **Step 3 : commit**

```bash
git add apps/web/public/data/game-balance.json
git commit -m "balance(wear): sync web-served copy with engine balance"
```

---

## Task 3: Mettre à jour les types TypeScript de balance

**Files:**
- Modify: `packages/game-balance/src/types.ts`

- [ ] **Step 1 : remplacer `WearConfig`**

Dans `packages/game-balance/src/types.ts`, remplacer `WearConfig` (lignes 24–39) par :

```typescript
export interface WearConfig {
  minCondition: number;
  maxSpeedPenalty: number;
  penaltyCurve: { thresholdNone: number; thresholdMax: number; slopePerPoint: number };
  componentWeights: { hull: number; rig: number; sails: number };
  baseRatesPerHour: Record<'hull' | 'rig' | 'sails' | 'electronics', number>;
  windMultipliers: {
    zeroBelowKnots: number;
    rampEndKnots: number;
    midFactor: number;
    midEndKnots: number;
    highFactor: number;
    stormEndKnots: number;
    stormFactor: number;
  };
  swellMultipliers: {
    zeroBelowMeters: number;
    rampEndMeters: number;
    midFactor: number;
    midEndMeters: number;
    highFactor: number;
    shortPeriodThresholdSec: number;
    shortPeriodBonus: number;
    dirFaceFactor: number;
    dirBeamFactor: number;
    dirBackFactor: number;
  };
  upgradeMultipliers: Record<string, number>;
}
```

- [ ] **Step 2 : retirer `maintenance` de `GameBalanceConfig`**

Dans le même fichier, dans `GameBalanceConfig` (lignes 7–22), supprimer la ligne `maintenance: Record<'hull' | 'rig' | 'sails' | 'electronics', MaintenanceEntry>;`.

- [ ] **Step 3 : supprimer `MaintenanceEntry`**

Toujours dans `types.ts`, supprimer l'interface `MaintenanceEntry` (lignes 72–75) :

```typescript
// supprimer ce bloc :
export interface MaintenanceEntry {
  costPer10pts: number;
  durationHours: number;
}
```

- [ ] **Step 4 : typecheck isolé pour détecter les consommateurs cassés**

Run:
```bash
pnpm --filter @nemo/game-balance typecheck
```
Expected: PASS. Si échec, c'est attendu : les consommateurs (marina.ts, marina.helpers.ts) seront fixés dans les tâches suivantes.

Run également :
```bash
pnpm typecheck
```
Expected: ÉCHEC sur `marina.ts` et `marina.helpers.ts` qui référencent `GameBalance.maintenance` et `MaintenanceEntry`. **C'est attendu** — on fixe aux Tasks 7 et 8.

- [ ] **Step 5 : commit**

```bash
git add packages/game-balance/src/types.ts
git commit -m "types(wear): weighted-avg config, drop MaintenanceEntry"
```

---

## Task 4: Écrire les tests TDD pour `conditionSpeedPenalty` (nouvelle formule)

**Files:**
- Create: `packages/game-engine-core/src/wear.test.ts`

- [ ] **Step 1 : créer le fichier de test avec la suite pénalité**

Créer `packages/game-engine-core/src/wear.test.ts` avec :

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { conditionSpeedPenalty, computeWearDelta, INITIAL_CONDITIONS } from './wear.js';
import type { ConditionState } from './wear.js';
import type { WeatherPoint } from '@nemo/shared-types';
import type { AggregatedEffects } from './loadout.js';

const neutralLoadout: AggregatedEffects = {
  speedByTwa: [1, 1, 1, 1, 1],
  speedByTws: [1, 1, 1],
  wearMul: { hull: 1, rig: 1, sail: 1, elec: 1 },
};

function mkCondition(partial: Partial<ConditionState>): ConditionState {
  return { hull: 100, rig: 100, sails: 100, electronics: 100, ...partial };
}

describe('conditionSpeedPenalty — weighted average', () => {
  it('returns 1.0 when weighted average is above 85', () => {
    // avg = 0.5*95 + 0.3*90 + 0.2*88 = 47.5 + 27 + 17.6 = 92.1
    const factor = conditionSpeedPenalty(mkCondition({ hull: 88, rig: 90, sails: 95 }));
    assert.equal(factor, 1.0);
  });

  it('returns maximum penalty (0.92 = -8%) when weighted average is at or below 50', () => {
    // avg = 0.5*40 + 0.3*50 + 0.2*70 = 20 + 15 + 14 = 49 → clamped at 50
    const factor = conditionSpeedPenalty(mkCondition({ hull: 70, rig: 50, sails: 40 }));
    assert.ok(Math.abs(factor - 0.92) < 1e-6, `expected ~0.92, got ${factor}`);
  });

  it('returns linear mid-penalty (~0.977) at weighted average ~75', () => {
    // avg = 0.5*75 + 0.3*75 + 0.2*75 = 75 → points lost = 10 → pct = 10*0.2286 = 2.286 → factor 0.97714
    const factor = conditionSpeedPenalty(mkCondition({ hull: 75, rig: 75, sails: 75 }));
    assert.ok(Math.abs(factor - 0.97714) < 1e-3, `expected ~0.977, got ${factor}`);
  });

  it('weights sails heaviest, hull lightest', () => {
    // Sails à 50, tout le reste à 100 → avg = 0.5*50 + 0.3*100 + 0.2*100 = 25 + 30 + 20 = 75
    const sailsDown = conditionSpeedPenalty(mkCondition({ sails: 50 }));
    // Hull à 50, tout le reste à 100 → avg = 0.5*100 + 0.3*100 + 0.2*50 = 50 + 30 + 10 = 90
    const hullDown = conditionSpeedPenalty(mkCondition({ hull: 50 }));
    // sailsDown plus pénalisant que hullDown
    assert.ok(sailsDown < hullDown, `sails weight should be heavier: sailsDown=${sailsDown} hullDown=${hullDown}`);
  });

  it('ignores electronics in the weighted average', () => {
    const full = conditionSpeedPenalty(mkCondition({}));
    const elecDown = conditionSpeedPenalty(mkCondition({ electronics: 0 }));
    assert.equal(elecDown, full, 'electronics must not affect speed penalty');
  });
});
```

- [ ] **Step 2 : lancer les tests pour vérifier qu'ils échouent**

Run:
```bash
pnpm --filter @nemo/game-engine-core test
```
Expected: FAIL. Les tests vont échouer soit parce que `INITIAL_CONDITIONS` n'existe pas encore, soit parce que la formule `min()` actuelle produit des valeurs différentes. Message attendu : assertions `conditionSpeedPenalty` qui retournent des valeurs incompatibles avec les assertions.

- [ ] **Step 3 : ne pas committer encore** — on implémente à la Task 6.

---

## Task 5: Écrire les tests TDD pour `computeWearDelta` (nouvelles courbes)

**Files:**
- Modify: `packages/game-engine-core/src/wear.test.ts`

- [ ] **Step 1 : ajouter la suite `computeWearDelta` au fichier de test**

Ajouter à la fin de `packages/game-engine-core/src/wear.test.ts` :

```typescript
function mkWeather(partial: Partial<WeatherPoint>): WeatherPoint {
  return { tws: 10, twd: 0, swh: 0, mwd: 0, mwp: 10, ...partial };
}

describe('computeWearDelta — conditional on weather', () => {
  const ONE_HOUR = 3600;

  it('applies zero wear below wind threshold (TWS < 15) and calm sea (Hs < 1.5)', () => {
    const d = computeWearDelta(mkWeather({ tws: 10, swh: 1 }), 0, ONE_HOUR, neutralLoadout);
    assert.equal(d.hull, 0);
    assert.equal(d.rig, 0);
    assert.equal(d.sails, 0);
    // electronics has its own tiny base rate independent of weather (design)
  });

  it('applies base rate × 1.0 multiplier at TWS 25, calm sea', () => {
    // windMul at tws=25 (rampEnd) = 1.0, swellMul=0, combined=1.0
    const d = computeWearDelta(mkWeather({ tws: 25, swh: 0 }), 0, ONE_HOUR, neutralLoadout);
    // sails base rate = 0.010, 1 hour, mult 1.0 → delta 0.010
    assert.ok(Math.abs(d.sails - 0.010) < 1e-6, `expected 0.010, got ${d.sails}`);
    assert.ok(Math.abs(d.rig - 0.006) < 1e-6, `expected 0.006, got ${d.rig}`);
    assert.ok(Math.abs(d.hull - 0.003) < 1e-6, `expected 0.003, got ${d.hull}`);
  });

  it('applies storm multiplier (5.0) at TWS 45+, calm sea', () => {
    // windMul at tws=45 = 5.0, swellMul=0, combined (additive) = 5.0
    const d = computeWearDelta(mkWeather({ tws: 45, swh: 0 }), 0, ONE_HOUR, neutralLoadout);
    assert.ok(Math.abs(d.sails - 0.010 * 5.0) < 1e-6, `expected 0.050, got ${d.sails}`);
  });

  it('adds wind and swell multipliers (not multiplicative)', () => {
    // tws=45 → windMul=5.0, swh=7 → swellMul=2.5, additive = 7.5
    const d = computeWearDelta(mkWeather({ tws: 45, swh: 7, mwp: 10, mwd: 180 }), 0, ONE_HOUR, neutralLoadout);
    // Assert not multiplicative: sails would be 0.010 × (5 × 2.5) = 0.125, but additive is 0.010 × 7.5 = 0.075
    // Note: swell also includes direction factor; with heading=0 and mwd=180, vagues en poupe, factor = dirBack = 0.5
    // So swellMul = 2.5 × 0.5 = 1.25 → combined = 5.0 + 1.25 = 6.25 → sails = 0.010 × 6.25 = 0.0625
    assert.ok(d.sails < 0.010 * 5.0 * 2.5, `should be additive not multiplicative, got ${d.sails}`);
    assert.ok(d.sails > 0.010 * 5.0, `should add swell contribution, got ${d.sails}`);
  });

  it('applies short-period bonus (+30%) to swell multiplier', () => {
    const longPeriod = computeWearDelta(mkWeather({ tws: 0, swh: 7, mwp: 10, mwd: 0 }), 0, ONE_HOUR, neutralLoadout);
    const shortPeriod = computeWearDelta(mkWeather({ tws: 0, swh: 7, mwp: 6, mwd: 0 }), 0, ONE_HOUR, neutralLoadout);
    assert.ok(shortPeriod.sails > longPeriod.sails, `short period should wear more: short=${shortPeriod.sails} long=${longPeriod.sails}`);
    assert.ok(Math.abs(shortPeriod.sails / longPeriod.sails - 1.3) < 0.05, `expected ~1.3× ratio, got ${shortPeriod.sails / longPeriod.sails}`);
  });

  it('applies direction factors: face > beam > back', () => {
    // wind-free, big swell, vary heading vs mwd
    // mwd = direction FROM which waves come. encounter = angle between heading and mwd.
    // encounter ~0 = vagues en poupe (back), ~180 = face
    const faceSea = computeWearDelta(mkWeather({ tws: 0, swh: 7, mwp: 10, mwd: 180 }), 0, ONE_HOUR, neutralLoadout);
    const backSea = computeWearDelta(mkWeather({ tws: 0, swh: 7, mwp: 10, mwd: 0 }), 0, ONE_HOUR, neutralLoadout);
    assert.ok(faceSea.sails > backSea.sails, `face sea must wear more than back sea: face=${faceSea.sails} back=${backSea.sails}`);
  });

  it('applies loadout wearMul on top of weather', () => {
    const lightLoadout: AggregatedEffects = {
      ...neutralLoadout,
      wearMul: { hull: 0.5, rig: 1, sail: 1, elec: 1 },
    };
    const standard = computeWearDelta(mkWeather({ tws: 45 }), 0, ONE_HOUR, neutralLoadout);
    const reinforced = computeWearDelta(mkWeather({ tws: 45 }), 0, ONE_HOUR, lightLoadout);
    assert.ok(Math.abs(reinforced.hull - standard.hull * 0.5) < 1e-6, `reinforced hull should wear half as fast`);
  });
});

describe('INITIAL_CONDITIONS', () => {
  it('is 100 on every axis', () => {
    assert.deepEqual(INITIAL_CONDITIONS, { hull: 100, rig: 100, sails: 100, electronics: 100 });
  });

  it('is a fresh object (not a shared reference)', () => {
    const a = { ...INITIAL_CONDITIONS };
    a.hull = 50;
    assert.equal(INITIAL_CONDITIONS.hull, 100, 'INITIAL_CONDITIONS must not be mutable via spread');
  });
});
```

- [ ] **Step 2 : lancer les tests pour vérifier qu'ils échouent**

Run:
```bash
pnpm --filter @nemo/game-engine-core test
```
Expected: FAIL. `INITIAL_CONDITIONS` n'existe pas, les nouvelles courbes n'existent pas. Nombreuses assertions qui échouent.

- [ ] **Step 3 : commit (tests en rouge, doc du contrat à venir)**

```bash
git add packages/game-engine-core/src/wear.test.ts
git commit -m "test(wear): add failing tests for weighted-avg penalty and conditional wear"
```

---

## Task 6: Implémenter la nouvelle `conditionSpeedPenalty` (moyenne pondérée) + `INITIAL_CONDITIONS`

**Files:**
- Modify: `packages/game-engine-core/src/wear.ts:112-120`

- [ ] **Step 1 : remplacer `conditionSpeedPenalty` et ajouter `INITIAL_CONDITIONS`**

Remplacer les lignes 107–120 de `packages/game-engine-core/src/wear.ts` par :

```typescript
/**
 * Pénalité de vitesse basée sur une moyenne pondérée des composants vitesse-critiques.
 * conditionAvg = 0.5 × sails + 0.3 × rig + 0.2 × hull
 * Au-dessus de thresholdNone (85) : 0% de pénalité.
 * À thresholdMax (50) ou en dessous : maxSpeedPenalty (8%).
 * Linéaire entre les deux.
 * Electronics n'entre pas dans le calcul vitesse.
 */
export function conditionSpeedPenalty(c: ConditionState): number {
  const { thresholdNone, thresholdMax, slopePerPoint } = GameBalance.wear.penaltyCurve;
  const w = GameBalance.wear.componentWeights;
  const avg = w.sails * c.sails + w.rig * c.rig + w.hull * c.hull;
  if (avg >= thresholdNone) return 1.0;
  const pointsLost = thresholdNone - avg;
  const pct = Math.min(GameBalance.wear.maxSpeedPenalty, pointsLost * slopePerPoint);
  const clampedPct = avg <= thresholdMax ? GameBalance.wear.maxSpeedPenalty : pct;
  return 1 - clampedPct / 100;
}

/**
 * Conditions de départ d'une course : tous composants à 100.
 * À utiliser partout où un BoatRuntime démarre (inscription, hydratation, dev simulator).
 */
export const INITIAL_CONDITIONS: Readonly<ConditionState> = Object.freeze({
  hull: 100,
  rig: 100,
  sails: 100,
  electronics: 100,
});
```

- [ ] **Step 2 : relancer les tests de pénalité**

Run:
```bash
pnpm --filter @nemo/game-engine-core test -- --test-name-pattern="conditionSpeedPenalty|INITIAL_CONDITIONS"
```
Expected: tous les tests `conditionSpeedPenalty` et `INITIAL_CONDITIONS` passent. Les tests `computeWearDelta` échouent encore (sera fait à la Task 7).

- [ ] **Step 3 : ne pas committer** — on enchaîne avec la Task 7 pour un commit unique « nouvelle logique wear ».

---

## Task 7: Implémenter le nouveau `computeWearDelta` (courbes conditionnelles additives)

**Files:**
- Modify: `packages/game-engine-core/src/wear.ts:14-95`

- [ ] **Step 1 : remplacer `windMultiplier`, `swellMultiplier`, et `computeWearDelta`**

Remplacer les lignes 14–95 de `packages/game-engine-core/src/wear.ts` par :

```typescript
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

function lerp(x: number, x0: number, x1: number, y0: number, y1: number): number {
  if (x1 === x0) return y0;
  const t = clamp01((x - x0) / (x1 - x0));
  return y0 + t * (y1 - y0);
}

/**
 * Courbe d'usure vent :
 *  - TWS < zeroBelow : 0
 *  - TWS zeroBelow → rampEnd : 0 → midFactor
 *  - TWS rampEnd → midEnd : midFactor → highFactor
 *  - TWS midEnd → stormEnd : highFactor → stormFactor
 *  - TWS > stormEnd : stormFactor (plafond)
 */
function windWearMultiplier(tws: number): number {
  const cfg = GameBalance.wear.windMultipliers;
  if (tws <= cfg.zeroBelowKnots) return 0;
  if (tws <= cfg.rampEndKnots) return lerp(tws, cfg.zeroBelowKnots, cfg.rampEndKnots, 0, cfg.midFactor);
  if (tws <= cfg.midEndKnots) return lerp(tws, cfg.rampEndKnots, cfg.midEndKnots, cfg.midFactor, cfg.highFactor);
  if (tws <= cfg.stormEndKnots) return lerp(tws, cfg.midEndKnots, cfg.stormEndKnots, cfg.highFactor, cfg.stormFactor);
  return cfg.stormFactor;
}

/**
 * Courbe d'usure houle :
 *  - Hs < zeroBelow : 0
 *  - Hs zeroBelow → rampEnd : 0 → midFactor
 *  - Hs rampEnd → midEnd : midFactor → highFactor
 *  - Hs > midEnd : highFactor (plafond)
 * Modulation :
 *  - Période courte (Tp < thresholdSec) : +shortPeriodBonus (multiplicatif)
 *  - Direction : face ×1.5, travers ×1.0, arrière ×0.5
 *  - mwd = direction FROM which waves come (WW3 convention). Encounter angle
 *    = |((heading − mwd + 540) % 360) − 180|. 0° = waves at bow, 180° = waves astern.
 */
function swellWearMultiplier(w: WeatherPoint, heading: number): number {
  const cfg = GameBalance.wear.swellMultipliers;
  if (w.swh <= cfg.zeroBelowMeters) return 0;

  let heightMul: number;
  if (w.swh <= cfg.rampEndMeters) {
    heightMul = lerp(w.swh, cfg.zeroBelowMeters, cfg.rampEndMeters, 0, cfg.midFactor);
  } else if (w.swh <= cfg.midEndMeters) {
    heightMul = lerp(w.swh, cfg.rampEndMeters, cfg.midEndMeters, cfg.midFactor, cfg.highFactor);
  } else {
    heightMul = cfg.highFactor;
  }

  const encounter = Math.abs(((heading - w.mwd + 540) % 360) - 180);
  // encounter 0 = vagues en poupe (arrière), 180 = face
  let dirFactor: number;
  if (encounter <= 60) dirFactor = cfg.dirBackFactor;
  else if (encounter >= 120) dirFactor = cfg.dirFaceFactor;
  else dirFactor = cfg.dirBeamFactor;

  const periodFactor = w.mwp > 0 && w.mwp < cfg.shortPeriodThresholdSec
    ? (1 + cfg.shortPeriodBonus)
    : 1.0;

  return heightMul * dirFactor * periodFactor;
}

/**
 * BSP modulation by swell (speed factor, not wear).
 * Déplacé ici inchangé — même signature, même logique que l'ancienne version.
 */
export function swellSpeedFactor(swh: number, mwd: number, heading: number): number {
  const cfg = GameBalance.swell;
  if (swh <= cfg.thresholdMeters) return 1.0;
  const span = cfg.maxHeightMeters - cfg.thresholdMeters;
  const h = span > 0 ? Math.min(1, Math.max(0, (swh - cfg.thresholdMeters) / span)) : 1;
  const rel = Math.abs(((heading - mwd + 540) % 360) - 180);

  if (rel < cfg.headSectorDeg) {
    const coef = 1 - rel / cfg.headSectorDeg;
    return 1 - (cfg.maxSpeedMalus / 100) * h * coef;
  }
  if (rel > 180 - cfg.followingSectorDeg) {
    const coef = 1 - (180 - rel) / cfg.followingSectorDeg;
    return 1 + (cfg.maxSpeedBonus / 100) * h * coef;
  }
  const zoneLow = cfg.headSectorDeg;
  const zoneHigh = 180 - cfg.followingSectorDeg;
  const zoneCentre = (zoneLow + zoneHigh) / 2;
  const zoneHalf = (zoneHigh - zoneLow) / 2;
  const coef = zoneHalf > 0 ? 1 - Math.abs(rel - zoneCentre) / zoneHalf : 0;
  return 1 - (cfg.sideMaxMalus / 100) * h * coef;
}

/**
 * Calcule la perte de condition (points par composant) pour un tick.
 * Les multiplicateurs vent et houle sont ADDITIFS (pas multiplicatifs) pour éviter
 * l'explosion combinée : mer 8m sous 50 kt = 5 + 2.5 = 7.5×, pas 12.5×.
 * En mer calme (TWS < 15, Hs < 1.5) l'usure structurelle est exactement 0 ;
 * seule l'électronique a un taux de base indépendant de la météo.
 */
export function computeWearDelta(
  weather: WeatherPoint,
  heading: number,
  dtSec: number,
  loadoutEffects: AggregatedEffects,
): ConditionState {
  const wear = GameBalance.wear;
  const hoursFraction = dtSec / 3600;
  const weatherMul = windWearMultiplier(weather.tws) + swellWearMultiplier(weather, heading);

  const hullMul  = weatherMul * loadoutEffects.wearMul.hull;
  const rigMul   = weatherMul * loadoutEffects.wearMul.rig;
  const sailsMul = weatherMul * loadoutEffects.wearMul.sail;
  const elecMul  = loadoutEffects.wearMul.elec; // électronique : pas de lien météo, taux de base constant

  return {
    hull:        wear.baseRatesPerHour.hull        * hoursFraction * hullMul,
    rig:         wear.baseRatesPerHour.rig         * hoursFraction * rigMul,
    sails:       wear.baseRatesPerHour.sails       * hoursFraction * sailsMul,
    electronics: wear.baseRatesPerHour.electronics * hoursFraction * elecMul,
  };
}
```

Note : le `clamp` local à l'ancienne version n'est plus nécessaire (remplacé par `clamp01` et `lerp`). Supprimer l'ancien `const clamp = (v, lo, hi) => ...` à la ligne 12.

- [ ] **Step 2 : relancer toute la suite de tests**

Run:
```bash
pnpm --filter @nemo/game-engine-core test
```
Expected: tous les tests de `wear.test.ts` passent.

- [ ] **Step 3 : typecheck du package**

Run:
```bash
pnpm --filter @nemo/game-engine-core typecheck
```
Expected: PASS.

- [ ] **Step 4 : commit**

```bash
git add packages/game-engine-core/src/wear.ts
git commit -m "feat(wear): weighted-avg penalty + conditional wear curves (additive)"
```

---

## Task 8: Supprimer les helpers de réparation

**Files:**
- Modify: `apps/game-engine/src/api/marina.helpers.ts`

- [ ] **Step 1 : supprimer le bloc repair complet**

Dans `apps/game-engine/src/api/marina.helpers.ts`, supprimer :
- la ligne 1 `import type { UpgradeTier } from '@nemo/game-balance';` **uniquement si** le type n'est plus utilisé ailleurs (il ne l'est pas dans ce fichier une fois le repair supprimé — vérifier)
- tout le bloc lignes 16–67 (de `// Repair cost` jusqu'à la fin de `computeRepairCost` incluse)

Le fichier résultant garde uniquement `computeSellPrice`, `meetsUnlockCriteria` + son type `UnlockCriteria`, et `isValidUuid` + la regex `UUID_RE`.

- [ ] **Step 2 : typecheck du package game-engine**

Run:
```bash
pnpm --filter @nemo/game-engine typecheck
```
Expected: ÉCHEC sur `marina.ts` qui importe encore `computeRepairCost`. **C'est attendu** — on fixe à la Task 9.

- [ ] **Step 3 : ne pas committer encore** — commit groupé à la Task 9.

---

## Task 9: Supprimer la route `POST /repair` et nettoyer les imports

**Files:**
- Modify: `apps/game-engine/src/api/marina.ts:579-663`

- [ ] **Step 1 : supprimer la route `/repair`**

Dans `apps/game-engine/src/api/marina.ts`, supprimer intégralement le bloc lignes 579–663 (depuis le commentaire-séparateur `// =========================================================================` + `// POST /api/v1/boats/:id/repair` jusqu'à la fin de la route `app.post<...>('/api/v1/boats/:id/repair', ...)` incluse, crochet fermant compris).

- [ ] **Step 2 : nettoyer les imports inutiles**

En haut de `marina.ts`, retirer de la liste d'imports de `./marina.helpers` la fonction `computeRepairCost` (et `conditionAxisToSlot`, `RepairBreakdown` si présents). Retirer aussi `GameBalance.maintenance` et `GameBalance.upgrades.tiers` s'ils ne sont plus référencés ailleurs (laisser si d'autres routes les utilisent). Un typecheck dira la vérité.

Vérifier spécifiquement que `tierForSlot` et `loadInstalledWithCatalog` restent utilisés par d'autres routes — **ne les retirer que si le typecheck les signale `unused`**.

- [ ] **Step 3 : typecheck du package**

Run:
```bash
pnpm --filter @nemo/game-engine typecheck
```
Expected: PASS.

- [ ] **Step 4 : typecheck global**

Run:
```bash
pnpm typecheck
```
Expected: PASS (tout le monorepo propre).

- [ ] **Step 5 : commit**

```bash
git add apps/game-engine/src/api/marina.ts apps/game-engine/src/api/marina.helpers.ts
git commit -m "feat(marina): remove paid repair endpoint and helpers"
```

---

## Task 10: Supprimer le test e2e du repair

**Files:**
- Modify: `apps/game-engine/src/test/e2e-marina-api.ts:151-160`

- [ ] **Step 1 : supprimer le bloc Test 9**

Dans `apps/game-engine/src/test/e2e-marina-api.ts`, supprimer intégralement les lignes 151–160 (tout le bloc `// --- Test 9: POST /boats/:id/repair ...`).

Renuméroter les tests suivants (Test 10 → Test 9, Test 11 → Test 10, etc.) dans les commentaires pour cohérence visuelle. Ne pas renommer de variables.

- [ ] **Step 2 : lancer les e2e marina (si infra dispo)**

Si Docker tourne avec Postgres :

```bash
pnpm infra:up
pnpm --filter @nemo/game-engine test:e2e:marina
```
Expected: PASS (si l'infra est up). Si infra down, sauter ce step et laisser pour le CI.

Si l'infra n'est pas disponible localement, valider uniquement :

```bash
pnpm --filter @nemo/game-engine typecheck
```
Expected: PASS.

- [ ] **Step 3 : commit**

```bash
git add apps/game-engine/src/test/e2e-marina-api.ts
git commit -m "test(marina): drop repair endpoint e2e test"
```

---

## Task 11: Utiliser `INITIAL_CONDITIONS` dans le seed de démo

**Files:**
- Modify: `apps/game-engine/src/index.ts:41,46`

- [ ] **Step 1 : importer `INITIAL_CONDITIONS`**

Dans `apps/game-engine/src/index.ts`, ajouter à l'import existant de `@nemo/game-engine-core` (ou créer l'import si absent) :

```typescript
import { INITIAL_CONDITIONS } from '@nemo/game-engine-core';
```

- [ ] **Step 2 : remplacer les initialisations inline**

Remplacer ligne 41 (dans l'objet `Boat`) :
```typescript
    hullCondition: 100, rigCondition: 100, sailCondition: 100, elecCondition: 100,
```
par :
```typescript
    hullCondition: INITIAL_CONDITIONS.hull,
    rigCondition: INITIAL_CONDITIONS.rig,
    sailCondition: INITIAL_CONDITIONS.sails,
    elecCondition: INITIAL_CONDITIONS.electronics,
```

Remplacer ligne 46 (dans le `BoatRuntime`) :
```typescript
    condition: { hull: 100, rig: 100, sails: 100, electronics: 100 },
```
par :
```typescript
    condition: { ...INITIAL_CONDITIONS },
```

- [ ] **Step 3 : typecheck**

Run:
```bash
pnpm --filter @nemo/game-engine typecheck
```
Expected: PASS.

- [ ] **Step 4 : commit**

```bash
git add apps/game-engine/src/index.ts
git commit -m "refactor(engine): use INITIAL_CONDITIONS constant for demo seed"
```

---

## Task 12: Exposer la pénalité de vitesse dans le snapshot runtime

**Files:**
- Modify: `apps/game-engine/src/api/runtime.ts`

- [ ] **Step 1 : ajouter le champ au DTO**

Dans `apps/game-engine/src/api/runtime.ts`, dans l'interface `BoatSnapshotDTO` (lignes 15–41), ajouter après `wearDetail` :

```typescript
  /** Pénalité de vitesse courante en % (0 = pas de pénalité, 8 = max). */
  speedPenaltyPct: number;
```

- [ ] **Step 2 : calculer et populer le champ**

Dans la route `GET /api/v1/races/:raceId/runtime/:boatId` (autour de la ligne 56 où `wearGlobal` est calculé), ajouter :

```typescript
      const speedFactor = conditionSpeedPenalty(condition);
      const speedPenaltyPct = Math.round((1 - speedFactor) * 1000) / 10; // 1 décimale
```

Puis dans la construction du `dto` (autour de la ligne 60–92), ajouter juste après `wearDetail` :

```typescript
        speedPenaltyPct,
```

Et ajouter l'import en tête de fichier :

```typescript
import { conditionSpeedPenalty } from '@nemo/game-engine-core';
```

- [ ] **Step 3 : typecheck**

Run:
```bash
pnpm --filter @nemo/game-engine typecheck
```
Expected: PASS.

- [ ] **Step 4 : ne pas committer encore** — commit groupé avec le reste du pipeline front au Task 16.

---

## Task 13: Mettre à jour le type miroir côté web + propagation store

**Files:**
- Modify: `apps/web/src/lib/api.ts:59-60`
- Modify: `apps/web/src/app/play/[raceId]/PlayClient.tsx:67-68`
- Modify: `apps/web/src/app/api/v1/races/[raceId]/my-boat/route.ts:37-38`
- Modify: store HUD (à localiser — probablement `apps/web/src/lib/store.ts`)

- [ ] **Step 1 : localiser le type HUD dans le store**

Run:
```bash
grep -rn "wearGlobal:" apps/web/src/lib apps/web/src/types 2>/dev/null
```

Identifier le fichier contenant le type `HudState` (ou nom équivalent) avec `wearGlobal`.

- [ ] **Step 2 : ajouter `speedPenaltyPct` au type côté `lib/api.ts`**

Dans `apps/web/src/lib/api.ts`, dans l'interface qui miroite `BoatSnapshotDTO`, ajouter :

```typescript
  speedPenaltyPct: number;
```
juste après `wearDetail`.

- [ ] **Step 3 : ajouter `speedPenaltyPct` au type HUD du store**

Dans le fichier store identifié au Step 1, ajouter la propriété :

```typescript
  speedPenaltyPct: number;
```

Dans les valeurs initiales (chercher `wearGlobal: 100` dans le store), ajouter :

```typescript
  speedPenaltyPct: 0,
```

- [ ] **Step 4 : propager dans `PlayClient.tsx`**

Dans `apps/web/src/app/play/[raceId]/PlayClient.tsx`, lignes 67–68, après `wearDetail: boat.wearDetail,` ajouter :

```typescript
        speedPenaltyPct: boat.speedPenaltyPct,
```

- [ ] **Step 5 : ajouter au mock my-boat**

Dans `apps/web/src/app/api/v1/races/[raceId]/my-boat/route.ts`, lignes 37–38, après `wearDetail: ...` ajouter :

```typescript
    speedPenaltyPct: 0,
```

- [ ] **Step 6 : typecheck web**

Run:
```bash
pnpm --filter @nemo/web typecheck
```
Expected: PASS.

- [ ] **Step 7 : ne pas committer encore** — commit groupé Task 16.

---

## Task 14: Retirer `RepairModal` et le bouton « Réparer » de `BoatDetailView`

**Files:**
- Modify: `apps/web/src/app/marina/[boatId]/BoatDetailView.tsx`

- [ ] **Step 1 : retirer l'import**

Dans `BoatDetailView.tsx`, supprimer la ligne 17 :
```typescript
import { RepairModal } from './RepairModal';
```

- [ ] **Step 2 : retirer l'état `showRepair`**

Supprimer la ligne 43 :
```typescript
  const [showRepair, setShowRepair] = useState(false);
```

- [ ] **Step 3 : retirer `needsRepair`**

Supprimer la ligne 93 :
```typescript
  const needsRepair = avgCondition < 100;
```
**Attention** : `avgCondition` reste utile pour l'affichage. Le retrait concerne uniquement la variable dérivée `needsRepair`.

- [ ] **Step 4 : retirer le bouton « Réparer » et son Tooltip**

Supprimer le bloc lignes 152–164 (de `<Tooltip text={inRace ? ...` jusqu'à `</Tooltip>` fermant du bouton Réparer inclus) :

```tsx
            <Tooltip
              text={inRace ? 'Impossible pendant la course' : !needsRepair ? 'Bateau en parfait état' : 'Réparer'}
              position="bottom"
            >
              <button
                type="button"
                className={`${styles.btn} ${styles.btnSecondary}`}
                onClick={() => setShowRepair(true)}
                disabled={inRace || !needsRepair}
              >
                Réparer
              </button>
            </Tooltip>
```

Le bouton « Vendre » qui suit (lignes 165–177) est conservé.

- [ ] **Step 5 : retirer le rendu `<RepairModal>`**

Supprimer le bloc lignes 323–328 (environ) :

```tsx
      <RepairModal
        open={showRepair}
        boat={...}
        credits={...}
        onClose={() => setShowRepair(false)}
        onRepaired={...}
      />
```

Lire le code autour avant de supprimer pour bien capter le bloc complet (peut faire 5 à 10 lignes selon le formatage actuel).

- [ ] **Step 6 : typecheck**

Run:
```bash
pnpm --filter @nemo/web typecheck
```
Expected: PASS.

- [ ] **Step 7 : ne pas committer encore** — commit groupé Task 16.

---

## Task 15: Ajouter l'info-card « Réparation automatique » dans BoatDetailView

**Files:**
- Modify: `apps/web/src/app/marina/[boatId]/BoatDetailView.tsx`
- Modify: `apps/web/src/app/marina/[boatId]/page.module.css`

- [ ] **Step 1 : ajouter l'info-card avant la grille de slots**

Dans `BoatDetailView.tsx`, identifier l'endroit où commence la section "slots" (typiquement après le hero, avant la grille SlotCard). Insérer juste avant cette grille :

```tsx
      <aside className={styles.autoRepairNotice} aria-label="Réparation automatique">
        <span className={styles.autoRepairIcon} aria-hidden>✦</span>
        <p className={styles.autoRepairText}>
          Votre bateau est <strong>automatiquement remis en état</strong> au départ de
          chaque course. L'usure accumulée en mer est effacée à l'arrivée — concentrez-vous
          sur votre stratégie, pas sur la maintenance.
        </p>
      </aside>
```

- [ ] **Step 2 : ajouter les styles CSS**

Dans `apps/web/src/app/marina/[boatId]/page.module.css`, ajouter à la fin :

```css
.autoRepairNotice {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin: 1.5rem 0;
  padding: 0.875rem 1.25rem;
  border: 1px solid color-mix(in srgb, var(--color-gold) 40%, transparent);
  border-radius: 6px;
  background: color-mix(in srgb, var(--color-gold) 6%, var(--color-ivory-deep));
}

.autoRepairIcon {
  flex-shrink: 0;
  font-size: 1.25rem;
  color: var(--color-gold);
}

.autoRepairText {
  margin: 0;
  font-size: 0.9375rem;
  line-height: 1.5;
  color: var(--color-navy);
}
```

**Avant d'écrire les tokens** (`var(--color-gold)`, `var(--color-navy)`, `var(--color-ivory-deep)`), **vérifier qu'ils existent** dans `apps/web/src/app/globals.css` (contrainte CLAUDE.md : « Vérifier tokens CSS avant référence »). Si l'un manque, utiliser un token équivalent qui existe ou coder en dur avec la palette Nautical Luxury (ivory/navy/gold).

Run pour vérifier :
```bash
grep -E "color-gold|color-navy|color-ivory" apps/web/src/app/globals.css | head -20
```

Si un token référencé n'existe pas, remplacer par un token présent ou une valeur hex cohérente avec le design (ivory `#f5f0e8`, navy `#1a2840`, gold `#b8964b`).

- [ ] **Step 3 : typecheck + lint web**

Run:
```bash
pnpm --filter @nemo/web typecheck
pnpm --filter @nemo/web lint
```
Expected: PASS.

- [ ] **Step 4 : ne pas committer encore** — commit groupé Task 16.

---

## Task 16: Supprimer les fichiers `RepairModal.*`

**Files:**
- Delete: `apps/web/src/app/marina/[boatId]/RepairModal.tsx`
- Delete: `apps/web/src/app/marina/[boatId]/RepairModal.module.css`

- [ ] **Step 1 : vérifier qu'aucun autre fichier n'importe `RepairModal`**

Run:
```bash
grep -rn "RepairModal" apps/web/src 2>/dev/null
```
Expected: aucun résultat (seul `BoatDetailView.tsx` aurait pu l'importer et ça a été retiré à la Task 14).

- [ ] **Step 2 : supprimer les deux fichiers**

Run:
```bash
rm apps/web/src/app/marina/[boatId]/RepairModal.tsx
rm apps/web/src/app/marina/[boatId]/RepairModal.module.css
```

- [ ] **Step 3 : typecheck + lint + build**

Run:
```bash
pnpm typecheck
pnpm lint
```
Expected: PASS.

- [ ] **Step 4 : commit groupé Marina UI + backend snapshot + store**

Rassemble les changements des Tasks 12, 13, 14, 15, 16 en un commit :

```bash
git add apps/game-engine/src/api/runtime.ts \
        apps/web/src/lib/api.ts \
        apps/web/src/lib/store.ts \
        apps/web/src/app/play/[raceId]/PlayClient.tsx \
        apps/web/src/app/api/v1/races/[raceId]/my-boat/route.ts \
        apps/web/src/app/marina/[boatId]/BoatDetailView.tsx \
        apps/web/src/app/marina/[boatId]/page.module.css \
        apps/web/src/app/marina/[boatId]/RepairModal.tsx \
        apps/web/src/app/marina/[boatId]/RepairModal.module.css
git commit -m "feat(marina): drop repair UI, expose speed penalty to HUD"
```

(Remplacer `store.ts` par le fichier réel localisé au Task 13 Step 1.)

---

## Task 17: Afficher la pénalité de vitesse et le tooltip explicatif dans le HUD

**Files:**
- Modify: `apps/web/src/components/play/HudBar.tsx`
- Modify: `apps/web/src/components/play/HudBar.module.css` (si styles ajoutés)

- [ ] **Step 1 : enrichir le tooltip d'usure existant**

Dans `HudBar.tsx`, lignes 103–131 (le `<Tooltip ... content={...}>` de l'usure), enrichir le `content` pour inclure le texte explicatif et la pénalité en temps réel :

```tsx
        <Tooltip
          position="bottom"
          delay={200}
          content={
            <div className={styles.wearBreakdown}>
              <p className={styles.wearExplain}>
                Un bateau usé navigue plus lentement. Évitez les conditions extrêmes
                pour préserver vos performances.
              </p>
              {(['hull', 'rig', 'sails', 'electronics'] as const).map((part) => (
                <div key={part} className={styles.wearRow}>
                  <span>{part === 'hull' ? 'Coque' : part === 'rig' ? 'Gréement' : part === 'sails' ? 'Voiles' : 'Électronique'}</span>
                  <div className={styles.wearBarBg}>
                    <div
                      className={styles.wearBarFill}
                      style={{
                        width: `${hud.wearDetail[part]}%`,
                        background: wearColor(hud.wearDetail[part]),
                      }}
                    />
                  </div>
                </div>
              ))}
              <p className={styles.wearPenalty}>
                Pénalité de vitesse : <strong>−{hud.speedPenaltyPct.toFixed(1)}%</strong>
              </p>
            </div>
          }
        >
```

- [ ] **Step 2 : ajouter les styles si absents**

Dans `apps/web/src/components/play/HudBar.module.css`, ajouter si ces classes n'existent pas déjà :

```css
.wearExplain {
  margin: 0 0 0.5rem;
  font-size: 0.75rem;
  line-height: 1.4;
  opacity: 0.85;
}

.wearPenalty {
  margin: 0.5rem 0 0;
  padding-top: 0.5rem;
  border-top: 1px solid rgba(255, 255, 255, 0.15);
  font-size: 0.8125rem;
}
```

Même précaution CSS tokens : **grep dans `HudBar.module.css` et `globals.css` avant d'ajouter** pour vérifier les conventions locales (couleurs, spacing).

- [ ] **Step 3 : typecheck + lint web**

Run:
```bash
pnpm --filter @nemo/web typecheck
pnpm --filter @nemo/web lint
```
Expected: PASS.

- [ ] **Step 4 : test visuel rapide**

Démarrer `pnpm dev`, ouvrir `/play/<raceId>` avec le stub dev (raceId de démo), survoler la zone `⚓ Usure` du HUD et vérifier :
- l'explication apparaît
- les barres d'usure par composant s'affichent
- la ligne « Pénalité de vitesse : −X.X% » apparaît en bas du tooltip

Si les données sont à 100 partout (stub), la pénalité s'affiche `−0.0%`. C'est le comportement attendu.

- [ ] **Step 5 : commit**

```bash
git add apps/web/src/components/play/HudBar.tsx apps/web/src/components/play/HudBar.module.css
git commit -m "feat(play-hud): show wear explanation and live speed penalty"
```

---

## Task 18: Validation finale complète

**Files:** (aucun)

- [ ] **Step 1 : typecheck monorepo**

Run:
```bash
pnpm typecheck
```
Expected: PASS intégral.

- [ ] **Step 2 : lint monorepo**

Run:
```bash
pnpm lint
```
Expected: PASS.

- [ ] **Step 3 : tests unitaires**

Run:
```bash
pnpm test
```
Expected: PASS. Les tests `wear.test.ts` passent, rien d'autre n'est cassé.

- [ ] **Step 4 : e2e tick (si stub runtime OK)**

Run:
```bash
pnpm e2e:tick
```
Expected: PASS. Valide que le moteur tick avec les nouvelles formules ne crashe pas sur des scénarios standards.

- [ ] **Step 5 : vérification spec coverage manuelle**

Relire le spec `docs/superpowers/specs/2026-04-22-wear-system-rework-design.md` section « Critères de succès » et valider par oeil :

1. ✅ Lisibilité : tooltip HUD affiche explication + pénalité
2. ✅ Différenciation : les tests `computeWearDelta` prouvent que conditions dures → usure ×5 vs calme (0×)
3. ✅ Zéro usure en mer calme : test `applies zero wear below wind threshold ... and calm sea`
4. ✅ Suppression du sink crédits : route `/repair` supprimée, tests e2e nettoyés
5. ✅ Couverture tests : nouvelle suite `wear.test.ts` couvre pénalité pondérée, courbes conditionnelles, `INITIAL_CONDITIONS`

- [ ] **Step 6 : commit éventuel si changements finaux**

Si la validation a révélé des ajustements, les committer séparément avec un message descriptif. Sinon, aucun commit ici.

---

## Notes de reprise

- **Task 7 Step 1** : si la typologie `WeatherPoint` exige un champ obligatoire que les tests n'en fournissent pas, vérifier son interface dans `packages/shared-types/src/index.ts` et compléter le helper `mkWeather` en conséquence. Les champs attendus sont (d'après l'usage dans le moteur) : `tws, twd, swh, mwd, mwp`. Ne pas ajouter de mocks pour des champs non référencés par le code sous test.
- **Task 13 Step 1** : si le store utilise Zustand/Jotai/Redux, respecter la convention existante du fichier pour ajouter une propriété. Ne pas réécrire le store — ajout minimal uniquement.
- **Task 15 Step 2** : si le design existant de Marina utilise une autre manière d'afficher des notices (badge, callout, etc.), réutiliser le composant existant plutôt que créer un nouveau style. Chercher d'abord `grep -rn "notice\|callout\|info-card" apps/web/src/app/marina/` avant de trancher.
- **Hors scope respecté** : pas de migration DB, pas d'axe `foils` séparé, pas de refonte des multiplicateurs d'upgrades, pas de rééquilibrage des prix d'upgrades (cf spec section « Hors scope »).
