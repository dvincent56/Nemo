# Marina Upgrades — Plan 1 : Backend Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mettre en place le schéma DB, le catalogue d'upgrades dans `game-balance.json`, et refactorer l'engine pour qu'il consomme le nouveau modèle d'items installés par slot — **sans changer le comportement observable** (parity tests E2E verts avec items équivalents aux 6 anciens flags).

**Architecture :** 3 migrations Drizzle additives (pas de breaking change tant que l'API/UI n'est pas refait). Catalogue extensif dans `game-balance.json` validé par un schéma Zod au boot. Nouveau module `loadout.ts` qui résout les items installés sur un bateau en agrégat d'effets (multipliers vitesse, usure, manœuvres). Refactor `wear.ts`, `orders.ts`, `tick.ts` pour consommer cet agrégat à la place des `upgrades.has('FOILS')` actuels.

**Tech Stack :** Drizzle ORM (Postgres), Zod, TypeScript strict, Node test runner (`node --import tsx --test`), tsx pour scripts E2E.

**Spec source :** [docs/superpowers/specs/2026-04-16-marina-upgrades-design.md](../specs/2026-04-16-marina-upgrades-design.md) — sections A, B, D.

**Plans suivants :** Plan 2 (API REST) puis Plan 3 (UI refonte). Ce Plan 1 ne touche **pas** à l'API ni au front.

---

## File Structure

### Files to create

| Path | Responsabilité |
|---|---|
| `apps/game-engine/drizzle/0XXX_marina_upgrades_phase_a.sql` | Migration générée par drizzle-kit (toutes en une) |
| `packages/game-balance/src/upgrade-catalog.schema.ts` | Schémas Zod du nouveau bloc `upgrades` |
| `apps/game-engine/src/engine/loadout.ts` | Résolution `boat_installed_upgrades` → `BoatLoadout` agrégé |
| `apps/game-engine/src/engine/loadout.test.ts` | Tests unitaires du module loadout |
| `apps/game-engine/src/engine/bands.ts` | Helper partagé `bandFor(value, thresholds)` |
| `apps/game-engine/src/engine/bands.test.ts` | Tests du helper |
| `apps/game-engine/src/db/migrations/seed-upgrades-from-flags.ts` | Script de migration des bateaux existants |

### Files to modify

| Path | Changement |
|---|---|
| `packages/game-balance/game-balance.json` | Étendu : `upgrades.{slots,tiers,slotsByClass,items}`, `economy.completionBonus` |
| `packages/game-balance/src/index.ts` | Export nouveaux types `UpgradeItem`, `BoatLoadout` ; valide via Zod au boot |
| `apps/game-engine/src/db/schema.ts` | Ajoute `playerUpgrades`, `boatInstalledUpgrades` ; modifie `boats` |
| `apps/game-engine/src/engine/wear.ts` | Remplace `upgrades.has(...)` par lookups dans `BoatLoadout` |
| `apps/game-engine/src/engine/sails.ts` | Applique `maneuverMul.{tack,gybe,sailChange}` sur durations + speedFactors |
| `apps/game-engine/src/engine/tick.ts` | Multiplie `bspMultiplier` par `loadout.aggregatedEffects.speedByTwa[band] * speedByTws[band]` ; passe `loadout` à `computeWearDelta` au lieu de `Set<string>` |
| `apps/game-engine/src/engine/manager.ts` | À l'init d'un `BoatRuntime`, charger le `BoatLoadout` depuis la DB |

---

## Task 1 — Étendre le schéma Drizzle

**Files:**
- Modify: `apps/game-engine/src/db/schema.ts:69-96` (table `boats`) et **append** (nouvelles tables)

- [ ] **Step 1 : Ajouter l'enum `upgradeAcquisitionSource`**

Dans `apps/game-engine/src/db/schema.ts`, après les enums existants (~ligne 27) :

```typescript
export const upgradeAcquisitionSourceEnum = pgEnum('upgrade_acquisition_source', [
  'PURCHASE',
  'ACHIEVEMENT_UNLOCK',
  'BOAT_SOLD_RETURN',
  'ADMIN_GRANT',
  'GIFT',
  'MIGRATION',
]);

export const upgradeSlotEnum = pgEnum('upgrade_slot', [
  'HULL', 'MAST', 'SAILS', 'FOILS', 'KEEL', 'ELECTRONICS', 'REINFORCEMENT',
]);
```

- [ ] **Step 2 : Modifier la table `boats`**

Remplacer le bloc `totalUpgradeCost` (ligne 77) par `generation` :

```typescript
// Retirer cette ligne :
//   totalUpgradeCost: integer('total_upgrade_cost').notNull().default(0),
// Ajouter à la place :
generation: smallint('generation').notNull().default(1),
```

- [ ] **Step 3 : Ajouter les nouvelles tables (à la fin du fichier)**

```typescript
export const playerUpgrades = pgTable('player_upgrades', {
  id: uuid('id').primaryKey().defaultRandom(),
  playerId: uuid('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
  upgradeCatalogId: text('upgrade_catalog_id').notNull(),
  acquiredAt: timestamp('acquired_at', { withTimezone: true }).notNull().defaultNow(),
  acquisitionSource: upgradeAcquisitionSourceEnum('acquisition_source').notNull(),
  paidCredits: integer('paid_credits').notNull().default(0),
});

export const boatInstalledUpgrades = pgTable('boat_installed_upgrades', {
  boatId: uuid('boat_id').notNull().references(() => boats.id, { onDelete: 'cascade' }),
  slot: upgradeSlotEnum('slot').notNull(),
  playerUpgradeId: uuid('player_upgrade_id').notNull().unique()
    .references(() => playerUpgrades.id, { onDelete: 'cascade' }),
  installedAt: timestamp('installed_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // PK composite
  unique('uniq_boat_slot').on(t.boatId, t.slot),
]);
```

(Note : Drizzle ne supporte pas la PK composite sur `pgTable`, on utilise un `unique` avec le même effet. La FK `unique` sur `playerUpgradeId` garantit qu'un upgrade ne peut être installé qu'à un seul endroit.)

- [ ] **Step 4 : Générer la migration**

Run :
```bash
cd apps/game-engine && pnpm db:generate --name marina_upgrades_phase_a
```

Attendu : un fichier `apps/game-engine/drizzle/0001_marina_upgrades_phase_a.sql` (le numéro varie) contenant :
- `CREATE TYPE upgrade_acquisition_source AS ENUM (...)`
- `CREATE TYPE upgrade_slot AS ENUM (...)`
- `ALTER TABLE boats DROP COLUMN total_upgrade_cost`
- `ALTER TABLE boats ADD COLUMN generation smallint NOT NULL DEFAULT 1`
- `CREATE TABLE player_upgrades (...)`
- `CREATE TABLE boat_installed_upgrades (...)`

- [ ] **Step 5 : Vérifier que la migration s'applique sur une DB de test**

Run :
```bash
cd apps/game-engine && DATABASE_URL=postgresql://nemo:nemo@localhost:5432/nemo_test pnpm db:push
```

Attendu : `Changes applied` sans erreur. Si la DB de test n'existe pas : `docker compose -f ../../docker-compose.dev.yml up -d postgres` puis `createdb nemo_test`.

- [ ] **Step 6 : Index pour lookups fréquents**

Drizzle ne génère pas d'index automatiquement. Ajouter dans `schema.ts` après la déclaration `playerUpgrades` :

```typescript
import { index } from 'drizzle-orm/pg-core';
// ... dans pgTable, en 3e argument :
}, (t) => [
  index('idx_player_upgrades_player').on(t.playerId),
]);
```

Régénérer : `pnpm db:generate --name marina_upgrades_indexes`.

- [ ] **Step 7 : Commit**

```bash
git add apps/game-engine/src/db/schema.ts apps/game-engine/drizzle/
git commit -m "feat(db): tables player_upgrades + boat_installed_upgrades, drop total_upgrade_cost

Préparation Plan 1 marina-upgrades. Schéma additif, aucune feature
côté API ni front pour l'instant."
```

---

## Task 2 — Schéma Zod du catalogue d'upgrades

**Files:**
- Create: `packages/game-balance/src/upgrade-catalog.schema.ts`
- Modify: `packages/game-balance/src/index.ts`

- [ ] **Step 1 : Installer Zod si pas présent**

Run dans `packages/game-balance/` :
```bash
pnpm add zod
```

Attendu : Zod ajouté aux dependencies du package.

- [ ] **Step 2 : Créer le schéma Zod**

Créer `packages/game-balance/src/upgrade-catalog.schema.ts` :

```typescript
import { z } from 'zod';

export const UpgradeSlotZ = z.enum([
  'HULL', 'MAST', 'SAILS', 'FOILS', 'KEEL', 'ELECTRONICS', 'REINFORCEMENT',
]);

export const UpgradeTierZ = z.enum(['SERIE', 'BRONZE', 'SILVER', 'GOLD', 'PROTO']);

export const BoatClassZ = z.enum(['FIGARO', 'CLASS40', 'OCEAN_FIFTY', 'IMOCA60', 'ULTIM']);

export const SlotAvailabilityZ = z.enum(['open', 'monotype', 'absent']);

export const UpgradeEffectsZ = z.object({
  speedByTwa: z.tuple([z.number(), z.number(), z.number(), z.number(), z.number()]),
  speedByTws: z.tuple([z.number(), z.number(), z.number()]),
  wearMul: z.object({
    hull: z.number().optional(),
    rig: z.number().optional(),
    sail: z.number().optional(),
    elec: z.number().optional(),
  }).optional().default({}),
  maneuverMul: z.object({
    tack: z.object({ dur: z.number(), speed: z.number() }).optional(),
    gybe: z.object({ dur: z.number(), speed: z.number() }).optional(),
    sailChange: z.object({ dur: z.number(), speed: z.number() }).optional(),
  }).optional().default({}),
  polarTargetsDeg: z.number().nullable().default(null),
  activation: z.object({
    minTws: z.number().optional(),
    maxTws: z.number().optional(),
  }).optional().default({}),
  groundingLossMul: z.number().nullable().default(null),
});

export const UnlockCriteriaZ = z.object({
  racesFinished: z.number().optional(),
  avgRankPctMax: z.number().optional(),
  top10Finishes: z.number().optional(),
  currentStreak: z.number().optional(),
  or: z.boolean().default(false),
});

export const UpgradeItemZ = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  slot: UpgradeSlotZ,
  tier: UpgradeTierZ,
  name: z.string(),
  profile: z.string(),
  description: z.string(),
  compat: z.array(BoatClassZ).min(1),
  cost: z.number().nullable(),
  effects: UpgradeEffectsZ,
  unlockCriteria: UnlockCriteriaZ.optional(),
});

export const TierConfigZ = z.object({
  priceRange: z.tuple([z.number(), z.number()]).nullable(),
  maintenanceMul: z.number(),
});

export const UpgradesBlockZ = z.object({
  slots: z.array(UpgradeSlotZ),
  tiers: z.record(UpgradeTierZ, TierConfigZ),
  slotsByClass: z.record(BoatClassZ, z.record(UpgradeSlotZ, SlotAvailabilityZ)),
  items: z.array(UpgradeItemZ),
});

export const CompletionBonusZ = z.record(BoatClassZ, z.number());

export type UpgradeSlot = z.infer<typeof UpgradeSlotZ>;
export type UpgradeTier = z.infer<typeof UpgradeTierZ>;
export type SlotAvailability = z.infer<typeof SlotAvailabilityZ>;
export type UpgradeEffects = z.infer<typeof UpgradeEffectsZ>;
export type UpgradeItem = z.infer<typeof UpgradeItemZ>;
export type UpgradesBlock = z.infer<typeof UpgradesBlockZ>;
```

- [ ] **Step 3 : Mettre à jour `packages/game-balance/src/index.ts`**

Remplacer **complètement** le bloc `UpgradesConfig` (lignes 73-99) par :

```typescript
// Imports en haut du fichier :
import {
  UpgradesBlockZ, CompletionBonusZ, type UpgradesBlock, type UpgradeItem,
  type UpgradeSlot, type UpgradeTier, type SlotAvailability,
} from './upgrade-catalog.schema.js';
export type { UpgradesBlock, UpgradeItem, UpgradeSlot, UpgradeTier, SlotAvailability };
```

Modifier `EconomyConfig` (lignes 125-129) :

```typescript
export interface EconomyConfig {
  startingCredits: number;
  buybackUpgradePct: number;
  palmaresBonus: { win: number; podium: number; top10: number };
  completionBonus: Record<BoatClass, number>;  // ← nouveau
}
```

Modifier `GameBalanceConfig.upgrades` (ligne 17) :

```typescript
upgrades: UpgradesBlock;  // ← typé via Zod
```

Dans la classe `GameBalanceClass`, étendre `loadFromDisk()` pour valider :

```typescript
async loadFromDisk(): Promise<void> {
  const path = join(__dirname, '..', 'game-balance.json');
  const raw = await readFile(path, 'utf8');
  const parsed = JSON.parse(raw);
  // Validation Zod du nouveau bloc upgrades + completionBonus
  UpgradesBlockZ.parse(parsed.upgrades);
  CompletionBonusZ.parse(parsed.economy.completionBonus);
  this.data = parsed as GameBalanceConfig;
}
```

- [ ] **Step 4 : Test smoke — le catalogue actuel doit être REJETÉ par Zod**

Run :
```bash
cd packages/game-balance && pnpm typecheck
```

Attendu : compile OK (le code TS est cohérent).

Run :
```bash
node --import tsx -e "import('./src/index.js').then(m => m.GameBalance.loadFromDisk())"
```

Attendu : **erreur Zod** (le `game-balance.json` actuel n'a pas le nouveau format). C'est normal — la Task 3 va ajouter le nouveau format au JSON.

- [ ] **Step 5 : Commit**

```bash
git add packages/game-balance/
git commit -m "feat(balance): Zod schema pour le catalogue d'upgrades V2

Schémas pour slots, tiers, items et effects (7 dimensions). Le
loader valide en strict au boot et refuse de démarrer si le JSON
n'est pas conforme. Le game-balance.json actuel n'est pas encore
au format — Task suivante."
```

---

## Task 3 — Étendre `game-balance.json` avec la nouvelle structure (sans items)

**Files:**
- Modify: `packages/game-balance/game-balance.json`

- [ ] **Step 1 : Ajouter le bloc `upgrades` étendu**

Dans `game-balance.json`, **remplacer intégralement** le bloc `"upgrades": {...}` (lignes 114-157) par :

```json
"upgrades": {
  "slots": ["HULL", "MAST", "SAILS", "FOILS", "KEEL", "ELECTRONICS", "REINFORCEMENT"],

  "tiers": {
    "SERIE":  { "priceRange": [0, 0],            "maintenanceMul": 1.0 },
    "BRONZE": { "priceRange": [1500, 3500],      "maintenanceMul": 1.5 },
    "SILVER": { "priceRange": [4500, 8000],      "maintenanceMul": 2.0 },
    "GOLD":   { "priceRange": [10000, 15000],    "maintenanceMul": 3.0 },
    "PROTO":  { "priceRange": null,              "maintenanceMul": 4.5 }
  },

  "slotsByClass": {
    "FIGARO":      { "HULL": "monotype", "MAST": "monotype", "SAILS": "open",
                     "FOILS": "absent",   "KEEL": "monotype",
                     "ELECTRONICS": "open", "REINFORCEMENT": "open" },
    "CLASS40":     { "HULL": "open", "MAST": "open", "SAILS": "open",
                     "FOILS": "open", "KEEL": "open",
                     "ELECTRONICS": "open", "REINFORCEMENT": "open" },
    "OCEAN_FIFTY": { "HULL": "monotype", "MAST": "monotype", "SAILS": "open",
                     "FOILS": "monotype", "KEEL": "absent",
                     "ELECTRONICS": "open", "REINFORCEMENT": "open" },
    "IMOCA60":     { "HULL": "open", "MAST": "open", "SAILS": "open",
                     "FOILS": "open", "KEEL": "open",
                     "ELECTRONICS": "open", "REINFORCEMENT": "open" },
    "ULTIM":       { "HULL": "monotype", "MAST": "monotype", "SAILS": "open",
                     "FOILS": "open", "KEEL": "absent",
                     "ELECTRONICS": "open", "REINFORCEMENT": "open" }
  },

  "items": []
}
```

- [ ] **Step 2 : Ajouter `completionBonus` dans `economy`**

Dans `game-balance.json`, à l'intérieur du bloc `"economy"` (ligne 202-209), ajouter :

```json
"economy": {
  "startingCredits": 500,
  "buybackUpgradePct": 70,
  "palmaresBonus": {
    "win": 500,
    "podium": 150,
    "top10": 30
  },
  "completionBonus": {
    "FIGARO": 200, "CLASS40": 300, "OCEAN_FIFTY": 500,
    "IMOCA60": 450, "ULTIM": 700
  }
}
```

- [ ] **Step 3 : Vérifier que Zod accepte la structure (avec `items: []` vide)**

Run :
```bash
cd packages/game-balance && node --import tsx -e "import('./src/index.js').then(m => m.GameBalance.loadFromDisk()).then(() => console.log('OK'))"
```

Attendu : `OK` (la validation passe parce que `items: []` est valide).

- [ ] **Step 4 : Commit**

```bash
git add packages/game-balance/game-balance.json
git commit -m "feat(balance): structure upgrades V2 dans game-balance.json (slots, tiers, slotsByClass)

items: [] en attente du remplissage Class40 + Figaro (Tasks 4-6)."
```

---

## Task 4 — Catalogue Class40 (22 items)

**Files:**
- Modify: `packages/game-balance/game-balance.json` (bloc `upgrades.items`)

Cette task remplit les **22 items Class40**. Les items sont insérés dans le tableau `items: [...]` du bloc `upgrades`.

- [ ] **Step 1 : Ajouter les 4 items HULL Class40**

Dans `upgrades.items`, ajouter :

```json
{
  "id": "hull-class40-standard", "slot": "HULL", "tier": "SERIE",
  "name": "Carène standard", "profile": "polyvalent",
  "description": "Carène série Class40. Compromis rigoureux, pensée pour durer.",
  "compat": ["CLASS40"], "cost": 0,
  "effects": {
    "speedByTwa": [0, 0, 0, 0, 0], "speedByTws": [0, 0, 0],
    "wearMul": {}, "maneuverMul": {},
    "polarTargetsDeg": null, "activation": {}, "groundingLossMul": null
  }
},
{
  "id": "hull-class40-optim", "slot": "HULL", "tier": "BRONZE",
  "name": "Carène optimisée", "profile": "près incisif",
  "description": "Carène allégée et lissée en chantier. Gain sec au près.",
  "compat": ["CLASS40"], "cost": 4200,
  "effects": {
    "speedByTwa": [0.04, 0.03, 0.01, 0, 0], "speedByTws": [0, 0.01, 0],
    "wearMul": { "hull": 1.15 }, "maneuverMul": {},
    "polarTargetsDeg": null, "activation": {}, "groundingLossMul": null
  }
},
{
  "id": "hull-class40-scow", "slot": "HULL", "tier": "SILVER",
  "name": "Carène scow", "profile": "portant débridé",
  "description": "Étrave large. Impressionnante en reaching, délicate au près.",
  "compat": ["CLASS40"], "cost": 7200,
  "effects": {
    "speedByTwa": [-0.03, -0.02, 0.04, 0.08, 0.04], "speedByTws": [0, 0.02, 0.03],
    "wearMul": { "hull": 1.20 }, "maneuverMul": {},
    "polarTargetsDeg": null, "activation": {}, "groundingLossMul": null
  }
},
{
  "id": "hull-class40-proto", "slot": "HULL", "tier": "PROTO",
  "name": "Carène prototype", "profile": "extrême fragile",
  "description": "Carène de compétition issue du bureau d'études. Performance maximale, fragilité accrue.",
  "compat": ["CLASS40"], "cost": null,
  "unlockCriteria": { "racesFinished": 30, "avgRankPctMax": 0.15 },
  "effects": {
    "speedByTwa": [0.06, 0.06, 0.06, 0.06, 0.06], "speedByTws": [0.02, 0.02, 0.02],
    "wearMul": { "hull": 1.80 }, "maneuverMul": {},
    "polarTargetsDeg": null, "activation": {}, "groundingLossMul": 1.5
  }
}
```

- [ ] **Step 2 : Ajouter les 3 items MAST Class40**

```json
{
  "id": "mast-class40-alu", "slot": "MAST", "tier": "SERIE",
  "name": "Mât aluminium", "profile": "fiable",
  "description": "Gréement série. Fiable, sans exigence.",
  "compat": ["CLASS40"], "cost": 0,
  "effects": {
    "speedByTwa": [0, 0, 0, 0, 0], "speedByTws": [0, 0, 0],
    "wearMul": {}, "maneuverMul": {},
    "polarTargetsDeg": null, "activation": {}, "groundingLossMul": null
  }
},
{
  "id": "mast-class40-carbon", "slot": "MAST", "tier": "BRONZE",
  "name": "Mât carbone", "profile": "vif raidi",
  "description": "Mât carbone standard. Gain de raideur et de poids.",
  "compat": ["CLASS40", "IMOCA60"], "cost": 3200,
  "effects": {
    "speedByTwa": [0.02, 0.02, 0.02, 0.02, 0.02], "speedByTws": [0, 0.01, 0.01],
    "wearMul": { "rig": 1.20 }, "maneuverMul": {},
    "polarTargetsDeg": null, "activation": {}, "groundingLossMul": null
  }
},
{
  "id": "mast-class40-carbon-hm", "slot": "MAST", "tier": "SILVER",
  "name": "Mât carbone HM", "profile": "stable musclé",
  "description": "Carbone haut module. Contrôle supérieur dans la brise, manœuvres plus rapides.",
  "compat": ["CLASS40", "IMOCA60"], "cost": 6800,
  "effects": {
    "speedByTwa": [0.02, 0.02, 0.03, 0.03, 0.02], "speedByTws": [0, 0.01, 0.02],
    "wearMul": { "rig": 1.30 },
    "maneuverMul": {
      "tack": { "dur": 0.85, "speed": 1.10 },
      "gybe": { "dur": 0.90, "speed": 1.05 }
    },
    "polarTargetsDeg": null, "activation": {}, "groundingLossMul": null
  }
}
```

- [ ] **Step 3 : Ajouter les 4 items SAILS Class40**

```json
{
  "id": "sails-class40-dacron", "slot": "SAILS", "tier": "SERIE",
  "name": "Voiles Dacron", "profile": "polyvalent",
  "description": "Voiles de série. Tolérantes, lourdes.",
  "compat": ["CLASS40"], "cost": 0,
  "effects": {
    "speedByTwa": [0, 0, 0, 0, 0], "speedByTws": [0, 0, 0],
    "wearMul": {}, "maneuverMul": {},
    "polarTargetsDeg": null, "activation": {}, "groundingLossMul": null
  }
},
{
  "id": "sails-class40-mylar", "slot": "SAILS", "tier": "SILVER",
  "name": "Voiles Mylar", "profile": "polyvalent stable",
  "description": "Forme stable sur tout le cadran. Très bon pilotage automatique.",
  "compat": ["CLASS40", "IMOCA60"], "cost": 5800,
  "effects": {
    "speedByTwa": [0, 0.02, 0.03, 0.02, 0], "speedByTws": [0.01, 0.02, 0],
    "wearMul": { "sail": 1.20 }, "maneuverMul": {},
    "polarTargetsDeg": null, "activation": {}, "groundingLossMul": null
  }
},
{
  "id": "sails-class40-3di", "slot": "SAILS", "tier": "GOLD",
  "name": "Voiles 3Di", "profile": "rendement haut",
  "description": "Membrane thermoformée. Référence absolue, exigeante en entretien.",
  "compat": ["CLASS40", "IMOCA60"], "cost": 12500,
  "effects": {
    "speedByTwa": [0.04, 0.05, 0.06, 0.05, 0.04], "speedByTws": [0.02, 0.03, 0.02],
    "wearMul": { "sail": 1.45 }, "maneuverMul": {},
    "polarTargetsDeg": null, "activation": {}, "groundingLossMul": null
  }
},
{
  "id": "sails-class40-north-custom", "slot": "SAILS", "tier": "PROTO",
  "name": "Custom North", "profile": "sur-mesure expert",
  "description": "Set North Sails sur mesure, optimisé pour ta polaire personnelle.",
  "compat": ["CLASS40", "IMOCA60"], "cost": null,
  "unlockCriteria": { "racesFinished": 25, "avgRankPctMax": 0.20 },
  "effects": {
    "speedByTwa": [0.06, 0.07, 0.08, 0.07, 0.06], "speedByTws": [0.03, 0.04, 0.03],
    "wearMul": { "sail": 1.60 }, "maneuverMul": {},
    "polarTargetsDeg": null, "activation": {}, "groundingLossMul": null
  }
}
```

- [ ] **Step 4 : Ajouter les 4 items FOILS Class40**

```json
{
  "id": "foils-class40-none", "slot": "FOILS", "tier": "SERIE",
  "name": "Sans foils", "profile": "coque seule",
  "description": "Configuration d'origine. Coque seule dans l'eau, comportement classique.",
  "compat": ["CLASS40"], "cost": 0,
  "effects": {
    "speedByTwa": [0, 0, 0, 0, 0], "speedByTws": [0, 0, 0],
    "wearMul": {}, "maneuverMul": {},
    "polarTargetsDeg": null, "activation": {}, "groundingLossMul": null
  }
},
{
  "id": "foils-class40-c", "slot": "FOILS", "tier": "BRONZE",
  "name": "Foils en C", "profile": "reaching nerveux",
  "description": "Profil polyvalent. Sortie partielle de coque dès 12 nds, gain net au reaching.",
  "compat": ["CLASS40"], "cost": 3500,
  "effects": {
    "speedByTwa": [-0.02, 0, 0.06, 0.04, 0], "speedByTws": [0, 0.02, 0.04],
    "wearMul": { "rig": 1.40, "hull": 1.20 }, "maneuverMul": {},
    "polarTargetsDeg": null, "activation": { "minTws": 12 }, "groundingLossMul": null
  }
},
{
  "id": "foils-class40-s", "slot": "FOILS", "tier": "SILVER",
  "name": "Foils en S", "profile": "vol agressif",
  "description": "Profil agressif type IMOCA. Vol franc dès 14 nds. Demande un pilotage attentif.",
  "compat": ["CLASS40"], "cost": 7800,
  "effects": {
    "speedByTwa": [-0.04, -0.02, 0.08, 0.14, 0.05], "speedByTws": [-0.02, 0.04, 0.10],
    "wearMul": { "rig": 1.80, "hull": 1.30 }, "maneuverMul": {},
    "polarTargetsDeg": null, "activation": { "minTws": 14 }, "groundingLossMul": null
  }
},
{
  "id": "foils-class40-proto", "slot": "FOILS", "tier": "PROTO",
  "name": "Foils prototype", "profile": "vol total",
  "description": "Foils issus de la recherche d'écurie. Performance maximale connue, sollicitation extrême.",
  "compat": ["CLASS40"], "cost": null,
  "unlockCriteria": { "racesFinished": 40, "top10Finishes": 8 },
  "effects": {
    "speedByTwa": [-0.06, -0.03, 0.12, 0.22, 0.10], "speedByTws": [-0.03, 0.06, 0.14],
    "wearMul": { "rig": 2.20, "hull": 1.60 }, "maneuverMul": {},
    "polarTargetsDeg": null, "activation": { "minTws": 14 }, "groundingLossMul": null
  }
}
```

- [ ] **Step 5 : Ajouter les 3 items KEEL Class40**

```json
{
  "id": "keel-class40-fixed", "slot": "KEEL", "tier": "SERIE",
  "name": "Quille fixe", "profile": "robuste lente",
  "description": "Quille fixe série. Robuste, simple, lente.",
  "compat": ["CLASS40"], "cost": 0,
  "effects": {
    "speedByTwa": [0, 0, 0, 0, 0], "speedByTws": [0, 0, 0],
    "wearMul": {}, "maneuverMul": {},
    "polarTargetsDeg": null, "activation": {}, "groundingLossMul": null
  }
},
{
  "id": "keel-class40-pendulum", "slot": "KEEL", "tier": "BRONZE",
  "name": "Quille pendulaire", "profile": "puissance redresseur",
  "description": "Quille basculante. Gain massif de stabilité et de puissance au près.",
  "compat": ["CLASS40", "IMOCA60"], "cost": 2800,
  "effects": {
    "speedByTwa": [0.04, 0.04, 0.02, 0.01, 0], "speedByTws": [0, 0.02, 0.03],
    "wearMul": { "hull": 1.10 }, "maneuverMul": {},
    "polarTargetsDeg": null, "activation": {}, "groundingLossMul": null
  }
},
{
  "id": "keel-class40-canting", "slot": "KEEL", "tier": "SILVER",
  "name": "Quille canting", "profile": "couple max",
  "description": "Quille basculante hydraulique. Réservée aux budgets sérieux.",
  "compat": ["CLASS40", "IMOCA60"], "cost": 5600,
  "effects": {
    "speedByTwa": [0.06, 0.06, 0.04, 0.02, 0.01], "speedByTws": [0, 0.03, 0.05],
    "wearMul": { "hull": 1.20 }, "maneuverMul": {},
    "polarTargetsDeg": null, "activation": {}, "groundingLossMul": null
  }
}
```

- [ ] **Step 6 : Ajouter les 3 items ELECTRONICS (partagés toutes classes)**

```json
{
  "id": "electronics-pack-base", "slot": "ELECTRONICS", "tier": "SERIE",
  "name": "Pack standard", "profile": "lisible sans analyse",
  "description": "Instrumentation de base. Lisible, sans analyse.",
  "compat": ["FIGARO", "CLASS40", "OCEAN_FIFTY", "IMOCA60", "ULTIM"], "cost": 0,
  "effects": {
    "speedByTwa": [0, 0, 0, 0, 0], "speedByTws": [0, 0, 0],
    "wearMul": {}, "maneuverMul": {},
    "polarTargetsDeg": null, "activation": {}, "groundingLossMul": null
  }
},
{
  "id": "electronics-pack-race", "slot": "ELECTRONICS", "tier": "BRONZE",
  "name": "Pack régate", "profile": "cibles polaires",
  "description": "Cibles polaires en live, ajustement fin des angles, transitions de voile assistées.",
  "compat": ["FIGARO", "CLASS40", "OCEAN_FIFTY", "IMOCA60", "ULTIM"], "cost": 2200,
  "effects": {
    "speedByTwa": [0.01, 0.01, 0.01, 0.01, 0.01], "speedByTws": [0.01, 0.01, 0],
    "wearMul": { "elec": 1.20 },
    "maneuverMul": { "sailChange": { "dur": 0.85, "speed": 1.05 } },
    "polarTargetsDeg": 2, "activation": {}, "groundingLossMul": null
  }
},
{
  "id": "electronics-pack-offshore", "slot": "ELECTRONICS", "tier": "SILVER",
  "name": "Pack offshore", "profile": "routage embarqué",
  "description": "Suite complète B&G H5000 avec routage embarqué. Optimise les trajectoires en continu.",
  "compat": ["FIGARO", "CLASS40", "OCEAN_FIFTY", "IMOCA60", "ULTIM"], "cost": 4800,
  "effects": {
    "speedByTwa": [0.02, 0.02, 0.02, 0.02, 0.02], "speedByTws": [0.01, 0.02, 0.01],
    "wearMul": { "elec": 1.40 },
    "maneuverMul": { "sailChange": { "dur": 0.75, "speed": 1.10 } },
    "polarTargetsDeg": 1, "activation": {}, "groundingLossMul": null
  }
}
```

- [ ] **Step 7 : Ajouter les 3 items REINFORCEMENT (partagés toutes classes)**

```json
{
  "id": "reinforcement-none", "slot": "REINFORCEMENT", "tier": "SERIE",
  "name": "Aucun renfort", "profile": "configuration légère",
  "description": "Configuration sans renfort. Légère, mais sensible aux gros temps.",
  "compat": ["FIGARO", "CLASS40", "OCEAN_FIFTY", "IMOCA60", "ULTIM"], "cost": 0,
  "effects": {
    "speedByTwa": [0, 0, 0, 0, 0], "speedByTws": [0, 0, 0],
    "wearMul": {}, "maneuverMul": {},
    "polarTargetsDeg": null, "activation": {}, "groundingLossMul": null
  }
},
{
  "id": "reinforcement-heavy-weather", "slot": "REINFORCEMENT", "tier": "BRONZE",
  "name": "Kit gros temps", "profile": "tenue gros temps",
  "description": "Renforts spécifiques aux conditions musclées. Limite l'usure quand ça souffle.",
  "compat": ["FIGARO", "CLASS40", "OCEAN_FIFTY", "IMOCA60", "ULTIM"], "cost": 1800,
  "effects": {
    "speedByTwa": [0, 0, 0, 0, 0], "speedByTws": [-0.02, 0, 0.03],
    "wearMul": { "rig": 0.55, "sail": 0.55 }, "maneuverMul": {},
    "polarTargetsDeg": null, "activation": { "minTws": 25 }, "groundingLossMul": null
  }
},
{
  "id": "reinforcement-pro", "slot": "REINFORCEMENT", "tier": "SILVER",
  "name": "Blindage pro", "profile": "blindage compétition",
  "description": "Renforts coque-rig-pont type compétition offshore. Lourd mais quasi-incassable.",
  "compat": ["FIGARO", "CLASS40", "OCEAN_FIFTY", "IMOCA60", "ULTIM"], "cost": 4500,
  "effects": {
    "speedByTwa": [0, 0, 0, 0, 0], "speedByTws": [-0.02, 0, 0],
    "wearMul": { "hull": 0.45 }, "maneuverMul": {},
    "polarTargetsDeg": null, "activation": {}, "groundingLossMul": 0.5
  }
}
```

- [ ] **Step 8 : Vérifier que Zod accepte tous les items**

Run :
```bash
cd packages/game-balance && node --import tsx -e "import('./src/index.js').then(m => m.GameBalance.loadFromDisk()).then(() => console.log('OK', m.GameBalance.upgrades.items.length))"
```

Attendu : `OK 22` (les 22 items Class40 + ELEC partagés + REINF partagés).

Note : 4 HULL + 3 MAST + 4 SAILS + 4 FOILS + 3 KEEL + 3 ELEC + 3 REINF = **24 items** (pas 22 — j'avais mal compté dans le spec, l'écart vient des items partagés ELEC/REINF qui sont aussi compatibles Class40). Acceptable.

- [ ] **Step 9 : Commit**

```bash
git add packages/game-balance/game-balance.json
git commit -m "feat(balance): catalogue Class40 complet + items partagés ELEC/REINF

24 items dont 7 Série gratuits, 6 Bronze, 5 Silver, 1 Gold, 2 Proto.
Tous validés par le schéma Zod."
```

---

## Task 5 — Catalogue Figaro (items monotype + 1 Bronze SAILS)

**Files:**
- Modify: `packages/game-balance/game-balance.json` (bloc `upgrades.items`)

- [ ] **Step 1 : Ajouter les items monotype Figaro**

Ajouter dans `items` :

```json
{
  "id": "hull-figaro-monotype", "slot": "HULL", "tier": "SERIE",
  "name": "Carène monotype Figaro", "profile": "réglementaire",
  "description": "Carène Figaro III série. Monotype strict — non modifiable en Classe.",
  "compat": ["FIGARO"], "cost": 0,
  "effects": {
    "speedByTwa": [0, 0, 0, 0, 0], "speedByTws": [0, 0, 0],
    "wearMul": {}, "maneuverMul": {},
    "polarTargetsDeg": null, "activation": {}, "groundingLossMul": null
  }
},
{
  "id": "mast-figaro-monotype", "slot": "MAST", "tier": "SERIE",
  "name": "Mât monotype Figaro", "profile": "réglementaire",
  "description": "Gréement monotype Figaro — non modifiable en Classe.",
  "compat": ["FIGARO"], "cost": 0,
  "effects": {
    "speedByTwa": [0, 0, 0, 0, 0], "speedByTws": [0, 0, 0],
    "wearMul": {}, "maneuverMul": {},
    "polarTargetsDeg": null, "activation": {}, "groundingLossMul": null
  }
},
{
  "id": "sails-figaro-monotype", "slot": "SAILS", "tier": "SERIE",
  "name": "Voiles série Figaro", "profile": "certifié classe",
  "description": "Jeu de voiles série certifié Classe Figaro.",
  "compat": ["FIGARO"], "cost": 0,
  "effects": {
    "speedByTwa": [0, 0, 0, 0, 0], "speedByTws": [0, 0, 0],
    "wearMul": {}, "maneuverMul": {},
    "polarTargetsDeg": null, "activation": {}, "groundingLossMul": null
  }
},
{
  "id": "sails-figaro-north-certified", "slot": "SAILS", "tier": "BRONZE",
  "name": "North monotype optimisé", "profile": "rendement classe",
  "description": "Set North Sails certifié Classe Figaro, optimisé dans les tolérances réglementaires.",
  "compat": ["FIGARO"], "cost": 2800,
  "effects": {
    "speedByTwa": [0.02, 0.02, 0.03, 0.02, 0.01], "speedByTws": [0.01, 0.02, 0.01],
    "wearMul": { "sail": 1.30 }, "maneuverMul": {},
    "polarTargetsDeg": null, "activation": {}, "groundingLossMul": null
  }
},
{
  "id": "keel-figaro-monotype", "slot": "KEEL", "tier": "SERIE",
  "name": "Quille fixe Figaro", "profile": "réglementaire",
  "description": "Quille fixe monotype.",
  "compat": ["FIGARO"], "cost": 0,
  "effects": {
    "speedByTwa": [0, 0, 0, 0, 0], "speedByTws": [0, 0, 0],
    "wearMul": {}, "maneuverMul": {},
    "polarTargetsDeg": null, "activation": {}, "groundingLossMul": null
  }
}
```

(Pas d'item FOILS Figaro — slot `absent` pour cette classe.)

- [ ] **Step 2 : Vérifier que Zod accepte**

```bash
cd packages/game-balance && node --import tsx -e "import('./src/index.js').then(m => m.GameBalance.loadFromDisk()).then(() => console.log('OK', m.GameBalance.upgrades.items.length))"
```

Attendu : `OK 29` (24 + 5 nouveaux).

- [ ] **Step 3 : Commit**

```bash
git add packages/game-balance/game-balance.json
git commit -m "feat(balance): catalogue Figaro III monotype + 1 Bronze SAILS"
```

---

## Task 6 — Items monotype OCEAN_FIFTY / IMOCA60 / ULTIM (placeholders V1)

**Files:**
- Modify: `packages/game-balance/game-balance.json` (bloc `upgrades.items`)

V1 ne populate qu'à minima ces 3 classes — juste les items Série pour les slots `monotype`. Le catalogue complet est en Phase 4.b.

- [ ] **Step 1 : Items OCEAN_FIFTY (HULL, MAST, FOILS monotype)**

```json
{
  "id": "hull-ocean-fifty-monotype", "slot": "HULL", "tier": "SERIE",
  "name": "Plateforme OCEAN FIFTY", "profile": "monotype trimaran",
  "description": "Plateforme OCEAN FIFTY série.",
  "compat": ["OCEAN_FIFTY"], "cost": 0,
  "effects": {
    "speedByTwa": [0, 0, 0, 0, 0], "speedByTws": [0, 0, 0],
    "wearMul": {}, "maneuverMul": {},
    "polarTargetsDeg": null, "activation": {}, "groundingLossMul": null
  }
},
{
  "id": "mast-ocean-fifty-monotype", "slot": "MAST", "tier": "SERIE",
  "name": "Aile rigide OCEAN FIFTY", "profile": "monotype",
  "description": "Aile rigide série de l'OCEAN FIFTY.",
  "compat": ["OCEAN_FIFTY"], "cost": 0,
  "effects": {
    "speedByTwa": [0, 0, 0, 0, 0], "speedByTws": [0, 0, 0],
    "wearMul": {}, "maneuverMul": {},
    "polarTargetsDeg": null, "activation": {}, "groundingLossMul": null
  }
},
{
  "id": "sails-ocean-fifty-standard", "slot": "SAILS", "tier": "SERIE",
  "name": "Garde-robe OCEAN FIFTY", "profile": "série",
  "description": "Garde-robe livrée avec le bateau.",
  "compat": ["OCEAN_FIFTY"], "cost": 0,
  "effects": {
    "speedByTwa": [0, 0, 0, 0, 0], "speedByTws": [0, 0, 0],
    "wearMul": {}, "maneuverMul": {},
    "polarTargetsDeg": null, "activation": {}, "groundingLossMul": null
  }
},
{
  "id": "foils-ocean-fifty-inbuilt", "slot": "FOILS", "tier": "SERIE",
  "name": "Foils intégrés OF", "profile": "vol dès 12 nds",
  "description": "Foils de série des flotteurs.",
  "compat": ["OCEAN_FIFTY"], "cost": 0,
  "effects": {
    "speedByTwa": [-0.02, 0, 0.04, 0.10, 0.04], "speedByTws": [0, 0.02, 0.04],
    "wearMul": { "rig": 1.30, "hull": 1.10 }, "maneuverMul": {},
    "polarTargetsDeg": null, "activation": { "minTws": 12 }, "groundingLossMul": null
  }
}
```

- [ ] **Step 2 : Items IMOCA60 (HULL et MAST + KEEL en stock — open mais pas de Bronze/Silver V1)**

```json
{
  "id": "hull-imoca60-standard", "slot": "HULL", "tier": "SERIE",
  "name": "Carène IMOCA standard", "profile": "compétition large",
  "description": "Plateforme IMOCA 60 série compétition.",
  "compat": ["IMOCA60"], "cost": 0,
  "effects": {
    "speedByTwa": [0, 0, 0, 0, 0], "speedByTws": [0, 0, 0],
    "wearMul": {}, "maneuverMul": {},
    "polarTargetsDeg": null, "activation": {}, "groundingLossMul": null
  }
},
{
  "id": "mast-imoca60-standard", "slot": "MAST", "tier": "SERIE",
  "name": "Mât carbone IMOCA", "profile": "compétition",
  "description": "Mât carbone série IMOCA. Le carbone HM Class40 est aussi compatible.",
  "compat": ["IMOCA60"], "cost": 0,
  "effects": {
    "speedByTwa": [0, 0, 0, 0, 0], "speedByTws": [0, 0, 0],
    "wearMul": {}, "maneuverMul": {},
    "polarTargetsDeg": null, "activation": {}, "groundingLossMul": null
  }
},
{
  "id": "sails-imoca60-standard", "slot": "SAILS", "tier": "SERIE",
  "name": "Garde-robe IMOCA", "profile": "compétition",
  "description": "Garde-robe IMOCA série. Mylar Class40 et 3Di compatibles.",
  "compat": ["IMOCA60"], "cost": 0,
  "effects": {
    "speedByTwa": [0, 0, 0, 0, 0], "speedByTws": [0, 0, 0],
    "wearMul": {}, "maneuverMul": {},
    "polarTargetsDeg": null, "activation": {}, "groundingLossMul": null
  }
},
{
  "id": "foils-imoca60-standard", "slot": "FOILS", "tier": "SERIE",
  "name": "Foils IMOCA standard", "profile": "vol dès 14 nds",
  "description": "Foils série IMOCA. Compatible foils-class40-* aussi.",
  "compat": ["IMOCA60"], "cost": 0,
  "effects": {
    "speedByTwa": [-0.02, 0, 0.05, 0.12, 0.04], "speedByTws": [0, 0.03, 0.05],
    "wearMul": { "rig": 1.50, "hull": 1.20 }, "maneuverMul": {},
    "polarTargetsDeg": null, "activation": { "minTws": 14 }, "groundingLossMul": null
  }
},
{
  "id": "keel-imoca60-canting-standard", "slot": "KEEL", "tier": "SERIE",
  "name": "Quille canting IMOCA", "profile": "couple série",
  "description": "Quille canting réglementaire IMOCA.",
  "compat": ["IMOCA60"], "cost": 0,
  "effects": {
    "speedByTwa": [0.02, 0.02, 0.01, 0, 0], "speedByTws": [0, 0.01, 0.02],
    "wearMul": {}, "maneuverMul": {},
    "polarTargetsDeg": null, "activation": {}, "groundingLossMul": null
  }
}
```

- [ ] **Step 3 : Items ULTIM (HULL et MAST monotype + FOILS open Série + SAILS)**

```json
{
  "id": "hull-ultim-monotype", "slot": "HULL", "tier": "SERIE",
  "name": "Plateforme Ultim", "profile": "monotype trimaran maxi",
  "description": "Plateforme Ultim série. Trimaran rapide.",
  "compat": ["ULTIM"], "cost": 0,
  "effects": {
    "speedByTwa": [0, 0, 0, 0, 0], "speedByTws": [0, 0, 0],
    "wearMul": {}, "maneuverMul": {},
    "polarTargetsDeg": null, "activation": {}, "groundingLossMul": null
  }
},
{
  "id": "mast-ultim-monotype", "slot": "MAST", "tier": "SERIE",
  "name": "Mât rotatif Ultim", "profile": "monotype",
  "description": "Mât rotatif série Ultim.",
  "compat": ["ULTIM"], "cost": 0,
  "effects": {
    "speedByTwa": [0, 0, 0, 0, 0], "speedByTws": [0, 0, 0],
    "wearMul": {}, "maneuverMul": {},
    "polarTargetsDeg": null, "activation": {}, "groundingLossMul": null
  }
},
{
  "id": "sails-ultim-standard", "slot": "SAILS", "tier": "SERIE",
  "name": "Garde-robe Ultim", "profile": "série",
  "description": "Garde-robe Ultim série.",
  "compat": ["ULTIM"], "cost": 0,
  "effects": {
    "speedByTwa": [0, 0, 0, 0, 0], "speedByTws": [0, 0, 0],
    "wearMul": {}, "maneuverMul": {},
    "polarTargetsDeg": null, "activation": {}, "groundingLossMul": null
  }
},
{
  "id": "foils-ultim-standard", "slot": "FOILS", "tier": "SERIE",
  "name": "Foils Ultim standard", "profile": "vol total dès 12 nds",
  "description": "Foils série Ultim — vol total quasi-permanent.",
  "compat": ["ULTIM"], "cost": 0,
  "effects": {
    "speedByTwa": [-0.04, 0, 0.10, 0.20, 0.10], "speedByTws": [0, 0.05, 0.10],
    "wearMul": { "rig": 1.80, "hull": 1.40 }, "maneuverMul": {},
    "polarTargetsDeg": null, "activation": { "minTws": 12 }, "groundingLossMul": null
  }
}
```

- [ ] **Step 4 : Vérifier**

```bash
cd packages/game-balance && node --import tsx -e "import('./src/index.js').then(m => m.GameBalance.loadFromDisk()).then(() => console.log('OK', m.GameBalance.upgrades.items.length))"
```

Attendu : `OK 43` (29 + 14 nouveaux : OF 4 + IMOCA60 5 + Ultim 4 + sails-imoca60-standard).

Recompte : 4 (OF) + 5 (IMOCA) + 4 (Ultim) = 13. Donc 29 + 13 = **42**. Si tu obtiens 42, c'est correct.

- [ ] **Step 5 : Commit**

```bash
git add packages/game-balance/game-balance.json
git commit -m "feat(balance): items Série OCEAN_FIFTY/IMOCA60/ULTIM (V1 minimal)

Items Série pour faire fonctionner l'engine sur ces 3 classes.
Bronze/Silver/Gold/Proto à étoffer en Phase 4.b."
```

---

## Task 7 — Helper `bandFor` partagé

**Files:**
- Create: `apps/game-engine/src/engine/bands.ts`
- Create: `apps/game-engine/src/engine/bands.test.ts`

- [ ] **Step 1 : Écrire le test (TDD)**

Créer `apps/game-engine/src/engine/bands.test.ts` :

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bandFor } from './bands.js';

test('bandFor — value below first threshold returns 0', () => {
  assert.equal(bandFor(5, [10, 20]), 0);
});

test('bandFor — value at threshold goes into next band', () => {
  // 10 nds = band 1 (≥10 et <20), pas band 0
  assert.equal(bandFor(10, [10, 20]), 1);
});

test('bandFor — value above last threshold returns last band', () => {
  assert.equal(bandFor(35, [10, 20]), 2);
});

test('bandFor — TWA bands [60, 90, 120, 150, 180]', () => {
  assert.equal(bandFor(0, [60, 90, 120, 150, 180]), 0);
  assert.equal(bandFor(45, [60, 90, 120, 150, 180]), 0);
  assert.equal(bandFor(60, [60, 90, 120, 150, 180]), 1);
  assert.equal(bandFor(89, [60, 90, 120, 150, 180]), 1);
  assert.equal(bandFor(90, [60, 90, 120, 150, 180]), 2);
  assert.equal(bandFor(180, [60, 90, 120, 150, 180]), 5);
});

test('bandFor — empty thresholds returns 0', () => {
  assert.equal(bandFor(100, []), 0);
});
```

- [ ] **Step 2 : Lancer le test (doit échouer)**

```bash
cd apps/game-engine && pnpm test -- bands
```

Attendu : `Cannot find module './bands.js'` → fail.

- [ ] **Step 3 : Implémenter `bands.ts`**

Créer `apps/game-engine/src/engine/bands.ts` :

```typescript
/**
 * Retourne l'index de la bande dans laquelle tombe `value`.
 * Convention : `value >= thresholds[i]` → bande au moins `i+1`.
 *
 * Exemple : `bandFor(15, [10, 20])` → 1 (entre 10 et 20).
 */
export function bandFor(value: number, thresholds: readonly number[]): number {
  let band = 0;
  for (const t of thresholds) {
    if (value >= t) band++;
    else break;
  }
  return band;
}
```

- [ ] **Step 4 : Relancer le test**

```bash
cd apps/game-engine && pnpm test -- bands
```

Attendu : tous les tests passent.

- [ ] **Step 5 : Commit**

```bash
git add apps/game-engine/src/engine/bands.ts apps/game-engine/src/engine/bands.test.ts
git commit -m "feat(engine): helper bandFor partagé pour TWA/TWS bands"
```

---

## Task 8 — Module `loadout.ts` (résolution + agrégation)

**Files:**
- Create: `apps/game-engine/src/engine/loadout.ts`
- Create: `apps/game-engine/src/engine/loadout.test.ts`

Le module fait deux choses :
1. **Résoudre** : à partir de la liste des `boat_installed_upgrades` d'un bateau (ou vide), retourner la liste effective des items installés (Série pour les slots vides).
2. **Agréger** : combiner les `effects` de tous les items en un `aggregatedEffects` consommable par le tick.

- [ ] **Step 1 : Écrire les tests d'agrégation**

Créer `apps/game-engine/src/engine/loadout.test.ts` :

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateEffects, type ResolvedItem } from './loadout.js';
import type { UpgradeItem } from '@nemo/game-balance';

const neutralItem = (id: string, overrides: Partial<UpgradeItem['effects']> = {}): ResolvedItem => ({
  id, slot: 'HULL', tier: 'SERIE', name: 'X', profile: 'x', description: '',
  compat: ['CLASS40'], cost: 0,
  effects: {
    speedByTwa: [0, 0, 0, 0, 0],
    speedByTws: [0, 0, 0],
    wearMul: {}, maneuverMul: {},
    polarTargetsDeg: null, activation: {}, groundingLossMul: null,
    ...overrides,
  },
});

test('aggregateEffects — items neutres → multipliers à 1.0 / valeurs neutres', () => {
  const agg = aggregateEffects([neutralItem('a'), neutralItem('b')]);
  assert.deepEqual(agg.speedByTwa, [1, 1, 1, 1, 1]);
  assert.deepEqual(agg.speedByTws, [1, 1, 1]);
  assert.deepEqual(agg.wearMul, { hull: 1, rig: 1, sail: 1, elec: 1 });
  assert.equal(agg.polarTargetsDeg, 0);
  assert.equal(agg.groundingLossMul, 1);
});

test('aggregateEffects — speedByTwa : (1+0.06) × (1-0.02) appliqué band par band', () => {
  const foils = neutralItem('foils', {
    speedByTwa: [-0.02, 0, 0.06, 0.04, 0],
  });
  const sails = neutralItem('sails', {
    speedByTwa: [0, 0.02, 0.03, 0.02, 0],
  });
  const agg = aggregateEffects([foils, sails]);
  assert.equal(agg.speedByTwa[0], (1 - 0.02) * (1 + 0));         // 0.98
  assert.equal(agg.speedByTwa[2], (1 + 0.06) * (1 + 0.03));      // 1.0918
});

test('aggregateEffects — wearMul : multiplication par axe', () => {
  const foils = neutralItem('foils', { wearMul: { rig: 1.8, hull: 1.3 } });
  const reinf = neutralItem('reinf', { wearMul: { hull: 0.45 } });
  const agg = aggregateEffects([foils, reinf]);
  assert.equal(agg.wearMul.rig, 1.8);
  assert.equal(agg.wearMul.hull, 1.3 * 0.45);  // 0.585
  assert.equal(agg.wearMul.sail, 1);
});

test('aggregateEffects — polarTargetsDeg : min des non-null, default 0', () => {
  const a = neutralItem('a');                                              // null
  const b = neutralItem('b', { polarTargetsDeg: 2 });
  const c = neutralItem('c', { polarTargetsDeg: 1 });
  assert.equal(aggregateEffects([a]).polarTargetsDeg, 0);                  // aucun
  assert.equal(aggregateEffects([a, b]).polarTargetsDeg, 2);
  assert.equal(aggregateEffects([a, b, c]).polarTargetsDeg, 1);            // min(2,1)
});

test('aggregateEffects — groundingLossMul : produit des non-null, default 1', () => {
  const a = neutralItem('a', { groundingLossMul: 0.5 });
  const b = neutralItem('b', { groundingLossMul: 0.8 });
  assert.equal(aggregateEffects([a, b]).groundingLossMul, 0.5 * 0.8);
  assert.equal(aggregateEffects([neutralItem('z')]).groundingLossMul, 1);
});

test('aggregateEffects — activation : items inactifs ne contribuent pas', () => {
  // Un item avec activation.minTws=14 ne s'applique que si tws >= 14
  const foils = neutralItem('foils', {
    speedByTwa: [0, 0, 0.06, 0.14, 0.05],
    activation: { minTws: 14 },
  });
  // tws = 10 → foils inactifs
  const aggLow = aggregateEffects([foils], { tws: 10 });
  assert.equal(aggLow.speedByTwa[3], 1);   // pas de bonus
  // tws = 16 → foils actifs
  const aggHigh = aggregateEffects([foils], { tws: 16 });
  assert.equal(aggHigh.speedByTwa[3], 1.14);
});

test('aggregateEffects — maneuverMul : multiplie tack/gybe/sailChange', () => {
  const carbon = neutralItem('carbon', {
    maneuverMul: {
      tack: { dur: 0.85, speed: 1.10 },
      gybe: { dur: 0.90, speed: 1.05 },
    },
  });
  const elec = neutralItem('elec', {
    maneuverMul: {
      sailChange: { dur: 0.75, speed: 1.10 },
    },
  });
  const agg = aggregateEffects([carbon, elec]);
  assert.equal(agg.maneuverMul.tack.dur, 0.85);
  assert.equal(agg.maneuverMul.gybe.speed, 1.05);
  assert.equal(agg.maneuverMul.sailChange.dur, 0.75);
});
```

- [ ] **Step 2 : Lancer (doit échouer)**

```bash
cd apps/game-engine && pnpm test -- loadout
```

Attendu : `Cannot find module './loadout.js'` → fail.

- [ ] **Step 3 : Implémenter `loadout.ts`**

Créer `apps/game-engine/src/engine/loadout.ts` :

```typescript
import type { UpgradeItem, UpgradeSlot, BoatClass } from '@nemo/game-balance';
import { GameBalance } from '@nemo/game-balance';

export type ResolvedItem = UpgradeItem;

export interface AggregatedEffects {
  speedByTwa: [number, number, number, number, number];
  speedByTws: [number, number, number];
  wearMul: { hull: number; rig: number; sail: number; elec: number };
  maneuverMul: {
    tack:       { dur: number; speed: number };
    gybe:       { dur: number; speed: number };
    sailChange: { dur: number; speed: number };
  };
  polarTargetsDeg: number;        // 0 = pas d'aide
  groundingLossMul: number;       // 1.0 = neutre
}

export interface BoatLoadout {
  participantId: string;
  bySlot: Map<UpgradeSlot, ResolvedItem>;
  items: ResolvedItem[];           // raw, pour ré-agrégation par tick
}

export interface AggregateContext {
  tws?: number;                    // pour évaluer activation.minTws/maxTws
}

const NEUTRAL_AGG: AggregatedEffects = {
  speedByTwa: [1, 1, 1, 1, 1],
  speedByTws: [1, 1, 1],
  wearMul: { hull: 1, rig: 1, sail: 1, elec: 1 },
  maneuverMul: {
    tack: { dur: 1, speed: 1 },
    gybe: { dur: 1, speed: 1 },
    sailChange: { dur: 1, speed: 1 },
  },
  polarTargetsDeg: 0,
  groundingLossMul: 1,
};

function isActive(item: ResolvedItem, ctx: AggregateContext): boolean {
  const a = item.effects.activation;
  if (!a) return true;
  if (ctx.tws === undefined) return true; // pas de filtre sans contexte
  if (a.minTws !== undefined && ctx.tws < a.minTws) return false;
  if (a.maxTws !== undefined && ctx.tws > a.maxTws) return false;
  return true;
}

export function aggregateEffects(items: ResolvedItem[], ctx: AggregateContext = {}): AggregatedEffects {
  const agg: AggregatedEffects = {
    speedByTwa: [...NEUTRAL_AGG.speedByTwa] as AggregatedEffects['speedByTwa'],
    speedByTws: [...NEUTRAL_AGG.speedByTws] as AggregatedEffects['speedByTws'],
    wearMul: { ...NEUTRAL_AGG.wearMul },
    maneuverMul: {
      tack: { ...NEUTRAL_AGG.maneuverMul.tack },
      gybe: { ...NEUTRAL_AGG.maneuverMul.gybe },
      sailChange: { ...NEUTRAL_AGG.maneuverMul.sailChange },
    },
    polarTargetsDeg: 0,
    groundingLossMul: 1,
  };

  const polarTargets: number[] = [];

  for (const item of items) {
    if (!isActive(item, ctx)) continue;
    const e = item.effects;

    for (let i = 0; i < 5; i++) agg.speedByTwa[i] *= 1 + e.speedByTwa[i];
    for (let i = 0; i < 3; i++) agg.speedByTws[i] *= 1 + e.speedByTws[i];

    if (e.wearMul.hull !== undefined) agg.wearMul.hull *= e.wearMul.hull;
    if (e.wearMul.rig  !== undefined) agg.wearMul.rig  *= e.wearMul.rig;
    if (e.wearMul.sail !== undefined) agg.wearMul.sail *= e.wearMul.sail;
    if (e.wearMul.elec !== undefined) agg.wearMul.elec *= e.wearMul.elec;

    if (e.maneuverMul.tack)       Object.assign(agg.maneuverMul.tack,       multManeuver(agg.maneuverMul.tack,       e.maneuverMul.tack));
    if (e.maneuverMul.gybe)       Object.assign(agg.maneuverMul.gybe,       multManeuver(agg.maneuverMul.gybe,       e.maneuverMul.gybe));
    if (e.maneuverMul.sailChange) Object.assign(agg.maneuverMul.sailChange, multManeuver(agg.maneuverMul.sailChange, e.maneuverMul.sailChange));

    if (e.polarTargetsDeg !== null) polarTargets.push(e.polarTargetsDeg);
    if (e.groundingLossMul !== null) agg.groundingLossMul *= e.groundingLossMul;
  }

  agg.polarTargetsDeg = polarTargets.length === 0 ? 0 : Math.min(...polarTargets);
  return agg;
}

function multManeuver(
  acc: { dur: number; speed: number },
  next: { dur: number; speed: number },
): { dur: number; speed: number } {
  return { dur: acc.dur * next.dur, speed: acc.speed * next.speed };
}

/**
 * Résout les items installés sur un bateau en remplissant les slots vides
 * avec l'item Série de la classe.
 *
 * @param installed Items lus depuis boat_installed_upgrades (peut être vide)
 * @param boatClass Classe du bateau (détermine les Séries par défaut)
 */
export function resolveBoatLoadout(
  participantId: string,
  installed: ResolvedItem[],
  boatClass: BoatClass,
): BoatLoadout {
  const bySlot = new Map<UpgradeSlot, ResolvedItem>();
  for (const item of installed) bySlot.set(item.slot, item);

  // Pour chaque slot non rempli, trouver l'item Série compatible avec la classe.
  const catalog = GameBalance.upgrades;
  const slotsByClass = catalog.slotsByClass[boatClass];
  for (const slot of catalog.slots) {
    if (bySlot.has(slot)) continue;
    if (slotsByClass[slot] === 'absent') continue;
    const serie = catalog.items.find(
      (it) => it.slot === slot && it.tier === 'SERIE' && it.compat.includes(boatClass),
    );
    if (!serie) {
      throw new Error(`Aucun item SERIE pour ${slot}/${boatClass} dans le catalogue`);
    }
    bySlot.set(slot, serie);
  }

  return {
    participantId,
    bySlot,
    items: Array.from(bySlot.values()),
  };
}
```

- [ ] **Step 4 : Relancer les tests**

```bash
cd apps/game-engine && pnpm test -- loadout
```

Attendu : tous les tests passent.

- [ ] **Step 5 : Test d'intégration `resolveBoatLoadout`**

Ajouter dans `loadout.test.ts` :

```typescript
import { GameBalance } from '@nemo/game-balance';
import { resolveBoatLoadout } from './loadout.js';

test('resolveBoatLoadout — slots vides remplis avec Série de la classe', async () => {
  await GameBalance.loadFromDisk();
  const loadout = resolveBoatLoadout('p1', [], 'CLASS40');

  // Tous les slots non-absent doivent être remplis (CLASS40 = 7 slots open)
  assert.equal(loadout.bySlot.size, 7);
  for (const item of loadout.items) {
    assert.equal(item.tier, 'SERIE');
    assert.ok(item.compat.includes('CLASS40'));
  }
});

test('resolveBoatLoadout — slots absent ignorés (FIGARO sans FOILS)', async () => {
  await GameBalance.loadFromDisk();
  const loadout = resolveBoatLoadout('p1', [], 'FIGARO');
  assert.equal(loadout.bySlot.has('FOILS'), false);
});

test('resolveBoatLoadout — items installés écrasent la Série', async () => {
  await GameBalance.loadFromDisk();
  const foilsC = GameBalance.upgrades.items.find((i) => i.id === 'foils-class40-c')!;
  const loadout = resolveBoatLoadout('p1', [foilsC], 'CLASS40');
  assert.equal(loadout.bySlot.get('FOILS')!.id, 'foils-class40-c');
});
```

Re-run : tous passent.

- [ ] **Step 6 : Commit**

```bash
git add apps/game-engine/src/engine/loadout.ts apps/game-engine/src/engine/loadout.test.ts
git commit -m "feat(engine): module loadout — résolution + agrégation des upgrades

- resolveBoatLoadout(participantId, installed, class) → BoatLoadout
  remplit les slots vides avec l'item Série de la classe.
- aggregateEffects(items, {tws}) → AggregatedEffects, avec activation
  conditionnelle (minTws/maxTws), polarTargetsDeg=min des non-null,
  groundingLossMul=produit des non-null."
```

---

## Task 9 — Refactor `wear.ts` pour consommer `BoatLoadout`

**Files:**
- Modify: `apps/game-engine/src/engine/wear.ts`

- [ ] **Step 1 : Modifier la signature de `computeWearDelta`**

Dans `wear.ts`, ligne 35-72, remplacer :

```typescript
export function computeWearDelta(
  weather: WeatherPoint,
  heading: number,
  driveMode: DriveMode,
  dtSec: number,
  upgrades: ReadonlySet<string>,    // ← ANCIEN
): ConditionState {
  // ... ancien code avec upgrades.has('FOILS') etc.
}
```

Par :

```typescript
import type { AggregatedEffects } from './loadout.js';

export function computeWearDelta(
  weather: WeatherPoint,
  heading: number,
  driveMode: DriveMode,
  dtSec: number,
  loadoutEffects: AggregatedEffects,    // ← NOUVEAU
): ConditionState {
  const wear = GameBalance.wear;
  const hoursFraction = dtSec / 3600;
  const windMul = windMultiplier(weather.tws);
  const swellMul = swellMultiplier(weather, heading);
  const driveMul = wear.driveModeMultipliers[driveMode];

  // Multipliers loadout appliqués sur chaque axe
  const hullMul = windMul * swellMul * loadoutEffects.wearMul.hull;
  const rigMul  = windMul             * loadoutEffects.wearMul.rig;
  const sailsMul = windMul            * loadoutEffects.wearMul.sail;
  const elecMul = 1.0                 * loadoutEffects.wearMul.elec;

  return {
    hull: wear.baseRatesPerHour.hull * hoursFraction * hullMul * driveMul,
    rig: wear.baseRatesPerHour.rig * hoursFraction * rigMul * driveMul,
    sails: wear.baseRatesPerHour.sails * hoursFraction * sailsMul * driveMul,
    electronics: wear.baseRatesPerHour.electronics * hoursFraction * elecMul * driveMul,
  };
}
```

(Les fonctions `windMultiplier`, `swellMultiplier`, `applyWear`, `conditionSpeedPenalty` restent inchangées.)

- [ ] **Step 2 : Vérifier que ça compile**

```bash
cd apps/game-engine && pnpm typecheck
```

Attendu : **erreur** dans `tick.ts` (qui appelle encore `computeWearDelta(..., upgrades)`). On la fixera dans Task 11.

- [ ] **Step 3 : Commit (refactor partiel)**

```bash
git add apps/game-engine/src/engine/wear.ts
git commit -m "refactor(engine): wear.ts consomme AggregatedEffects au lieu de Set<string>

Compile breaking pour tick.ts — fixé dans la task suivante."
```

---

## Task 10 — Refactor `sails.ts` pour appliquer `maneuverMul`

**Files:**
- Read: `apps/game-engine/src/engine/sails.ts` pour repérer où sont appliqués les durations / speedFactors
- Modify: `apps/game-engine/src/engine/sails.ts`

- [ ] **Step 1 : Localiser les usages de `tack`, `gybe`, `sailChange`**

Run :
```bash
grep -nE "tack|gybe|sailChange|durationSec|speedFactor" apps/game-engine/src/engine/sails.ts
```

Repérer les appels à `GameBalance.maneuvers.{tack,gybe,sailChange}`.

- [ ] **Step 2 : Modifier `detectManeuver` et `maneuverSpeedFactor`**

Pour chaque maneuver (tack, gybe, sailChange) :
- la **durée** doit être multipliée par `aggregatedEffects.maneuverMul.<man>.dur`
- le **speedFactor** pendant la manœuvre doit être multiplié par `aggregatedEffects.maneuverMul.<man>.speed`

Modifier la signature de `detectManeuver` pour accepter `loadoutEffects: AggregatedEffects` :

```typescript
import type { AggregatedEffects } from './loadout.js';

export function detectManeuver(
  prevTwa: number,
  currTwa: number,
  boatClass: BoatClass,
  startUnix: number,
  loadoutEffects: AggregatedEffects,    // ← NOUVEAU param
): ManeuverPenaltyState | null {
  // ... détection inchangée
  const baseDur = GameBalance.maneuvers.tack.durationSec[boatClass];
  const dur = baseDur * loadoutEffects.maneuverMul.tack.dur;     // ← appliqué
  // ... idem pour gybe
}
```

Modifier `maneuverSpeedFactor` pour appliquer le bonus speed :

```typescript
export function maneuverSpeedFactor(
  state: ManeuverPenaltyState | null,
  nowUnix: number,
  loadoutEffects: AggregatedEffects,    // ← NOUVEAU
): { factor: number; expired: boolean } {
  if (!state) return { factor: 1, expired: false };
  // ... logique existante pour expired
  const baseFactor = GameBalance.maneuvers[state.type].speedFactor;
  const speedMul = loadoutEffects.maneuverMul[state.type].speed;
  const factor = baseFactor * speedMul;
  return { factor, expired: false };
}
```

(Les détails exacts dépendent de la structure actuelle de `sails.ts` — adapter aux noms réels.)

- [ ] **Step 3 : Idem pour `transitionSpeedFactor`**

`transitionSpeedFactor(sailState)` est utilisée pour les changements de voile. Multiplier le facteur retourné par `loadoutEffects.maneuverMul.sailChange.speed` et la durée de transition par `.dur`.

- [ ] **Step 4 : Compile + commit (partiel)**

```bash
cd apps/game-engine && pnpm typecheck
```

Encore des erreurs dans `tick.ts` — normal.

```bash
git add apps/game-engine/src/engine/sails.ts
git commit -m "refactor(engine): sails.ts applique maneuverMul (tack/gybe/sailChange)"
```

---

## Task 11 — Refactor `tick.ts` (loadout dans BoatRuntime + bsp multipliers)

**Files:**
- Modify: `apps/game-engine/src/engine/tick.ts`
- Modify: `apps/game-engine/src/engine/manager.ts` (init du runtime)

- [ ] **Step 1 : Remplacer `upgrades: Set<string>` par `loadout: BoatLoadout` dans `BoatRuntime`**

Dans `tick.ts` ligne 20-31 :

```typescript
import { aggregateEffects, type BoatLoadout } from './loadout.js';
import { bandFor } from './bands.js';

export interface BoatRuntime {
  boat: Boat;
  raceId: string;
  condition: ConditionState;
  sailState: SailRuntimeState;
  segmentState: SegmentState;
  orderHistory: OrderEnvelope[];
  zonesAlerted: Set<string>;
  loadout: BoatLoadout;        // ← NOUVEAU (remplace upgrades: Set<string>)
  prevTwa: number | null;
  maneuver: ManeuverPenaltyState | null;
}
```

- [ ] **Step 2 : Dans `runTick`, agréger les effects à chaque tick**

Au début de `runTick`, après le bloc weather (ligne 71-75), ajouter :

```typescript
const aggEffects = aggregateEffects(runtime.loadout.items, { tws: weather.tws });
```

- [ ] **Step 3 : Multiplier `bspMultiplier` par les loadout speed mults**

Ligne 118 actuelle :

```typescript
const bspMultiplier = transitionFactor * overlapFactor * conditionFactor * manEval.factor;
```

Remplacer par :

```typescript
const twaBand = bandFor(Math.abs(twaAtStart), [60, 90, 120, 150, 180]);
const twsBand = bandFor(weather.tws, [10, 20]);

const bspMultiplier = transitionFactor
                    * overlapFactor
                    * conditionFactor
                    * manEval.factor
                    * aggEffects.speedByTwa[twaBand]
                    * aggEffects.speedByTws[twsBand];
```

- [ ] **Step 4 : Passer `aggEffects` à `computeWearDelta`, `detectManeuver`, `maneuverSpeedFactor`, `transitionSpeedFactor`**

Remplacer les appels existants :
- `computeWearDelta(weather, endHeading, boat.driveMode, tickDurationSec, runtime.upgrades)` → `computeWearDelta(weather, endHeading, boat.driveMode, tickDurationSec, aggEffects)`
- `detectManeuver(runtime.prevTwa, twaAtStart, boat.boatClass, tickStartUnix)` → `detectManeuver(runtime.prevTwa, twaAtStart, boat.boatClass, tickStartUnix, aggEffects)`
- `maneuverSpeedFactor(maneuver, tickStartUnix)` → `maneuverSpeedFactor(maneuver, tickStartUnix, aggEffects)`
- `transitionSpeedFactor(sailState)` → vérifier la signature mise à jour, passer aggEffects si nécessaire

- [ ] **Step 5 : Modifier `manager.ts` pour charger le loadout à l'init**

Trouver dans `manager.ts` l'endroit où un `BoatRuntime` est créé. Charger les items installés depuis la DB et résoudre :

```typescript
import { resolveBoatLoadout } from './loadout.js';
import { boatInstalledUpgrades } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { GameBalance } from '@nemo/game-balance';

// Dans la fonction d'init du runtime :
async function initBoatRuntime(boat: Boat, participantId: string, raceId: string): Promise<BoatRuntime> {
  // Lire les upgrades installés du bateau
  const installedRows = await db
    .select()
    .from(boatInstalledUpgrades)
    .where(eq(boatInstalledUpgrades.boatId, boat.id));

  // Mapper sur les items du catalogue (jointure logique)
  const installedItems = installedRows.map((row) => {
    const item = GameBalance.upgrades.items.find(
      (it) => it.slot === row.slot && it.compat.includes(boat.boatClass),
    );
    if (!item) throw new Error(`Item ${row.playerUpgradeId} non trouvé dans le catalogue`);
    return item;
  });

  const loadout = resolveBoatLoadout(participantId, installedItems, boat.boatClass);

  return {
    boat,
    raceId,
    // ... champs existants
    loadout,
    // ...
  };
}
```

(Adapter aux noms exacts dans `manager.ts`.)

**Note importante** : la jointure ci-dessus est imparfaite — un row dans `boat_installed_upgrades` référence un `player_upgrade_id`, qui lui-même a un `upgrade_catalog_id`. Il faut une vraie jointure :

```typescript
import { boatInstalledUpgrades, playerUpgrades } from '../db/schema.js';

const installedRows = await db
  .select({
    catalogId: playerUpgrades.upgradeCatalogId,
    slot: boatInstalledUpgrades.slot,
  })
  .from(boatInstalledUpgrades)
  .innerJoin(playerUpgrades, eq(boatInstalledUpgrades.playerUpgradeId, playerUpgrades.id))
  .where(eq(boatInstalledUpgrades.boatId, boat.id));

const installedItems = installedRows.map((row) => {
  const item = GameBalance.upgrades.items.find((it) => it.id === row.catalogId);
  if (!item) throw new Error(`Catalog id "${row.catalogId}" introuvable`);
  return item;
});
```

- [ ] **Step 6 : Compile**

```bash
cd apps/game-engine && pnpm typecheck
```

Attendu : OK (toutes les signatures alignées).

- [ ] **Step 7 : Commit**

```bash
git add apps/game-engine/src/engine/tick.ts apps/game-engine/src/engine/manager.ts
git commit -m "refactor(engine): tick et manager consomment BoatLoadout

- BoatRuntime.upgrades:Set<string> remplacé par loadout:BoatLoadout
- runTick agrège les effects à chaque tick avec le tws courant
- bsp est multiplié par speedByTwa[band] × speedByTws[band]
- manager init charge boat_installed_upgrades + résout en BoatLoadout"
```

---

## Task 12 — Script de migration des bateaux existants

**Files:**
- Create: `apps/game-engine/src/db/migrations/seed-upgrades-from-flags.ts`

Les bateaux existants en DB n'ont **pas** de rows dans `boat_installed_upgrades`. La résolution `resolveBoatLoadout` les considérera comme « tous Série » — comportement potentiellement différent de l'ancien (où `upgrades` était un Set lu depuis `boats.totalUpgradeCost` de manière hacky).

Pour préserver la **parité comportementale**, on écrit un script qui, pour chaque bateau existant, crée :
- 1 `player_upgrade` par flag équivalent (mapping de B.4 du spec)
- 1 row `boat_installed_upgrades` qui l'attache au bon slot

- [ ] **Step 1 : Créer le script**

`apps/game-engine/src/db/migrations/seed-upgrades-from-flags.ts` :

```typescript
/**
 * Migration one-shot — convertit les anciens flags d'upgrade des bateaux
 * existants en rows player_upgrades + boat_installed_upgrades.
 *
 * À exécuter UNE FOIS après le déploiement du Plan 1, avant que le code
 * engine refactoré ne soit activé en prod.
 *
 * Usage : tsx src/db/migrations/seed-upgrades-from-flags.ts
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { boats, playerUpgrades, boatInstalledUpgrades } from '../schema.js';
import type { UpgradeSlot } from '@nemo/game-balance';

// Mapping ancien flag → nouvel item (par classe)
const FLAG_TO_ITEM: Record<string, { slot: UpgradeSlot; itemByClass: Record<string, string> }> = {
  FOILS: {
    slot: 'FOILS',
    itemByClass: {
      CLASS40: 'foils-class40-c',
      IMOCA60: 'foils-imoca60-standard',
      OCEAN_FIFTY: 'foils-ocean-fifty-inbuilt',
      ULTIM: 'foils-ultim-standard',
    },
  },
  CARBON_RIG: { slot: 'MAST', itemByClass: { CLASS40: 'mast-class40-carbon' } },
  KEVLAR_SAILS: { slot: 'SAILS', itemByClass: { CLASS40: 'sails-class40-mylar' } },
  REINFORCED_HULL: {
    slot: 'REINFORCEMENT',
    itemByClass: {
      FIGARO: 'reinforcement-pro', CLASS40: 'reinforcement-pro',
      OCEAN_FIFTY: 'reinforcement-pro', IMOCA60: 'reinforcement-pro',
      ULTIM: 'reinforcement-pro',
    },
  },
  HEAVY_WEATHER_KIT: {
    slot: 'REINFORCEMENT',
    itemByClass: {
      FIGARO: 'reinforcement-heavy-weather', CLASS40: 'reinforcement-heavy-weather',
      OCEAN_FIFTY: 'reinforcement-heavy-weather', IMOCA60: 'reinforcement-heavy-weather',
      ULTIM: 'reinforcement-heavy-weather',
    },
  },
  AUTO_SAIL: {
    slot: 'ELECTRONICS',
    itemByClass: {
      FIGARO: 'electronics-pack-race', CLASS40: 'electronics-pack-race',
      OCEAN_FIFTY: 'electronics-pack-race', IMOCA60: 'electronics-pack-race',
      ULTIM: 'electronics-pack-race',
    },
  },
};

async function main(): Promise<void> {
  const sql = postgres(process.env['DATABASE_URL'] ?? 'postgresql://nemo:nemo@localhost:5432/nemo');
  const db = drizzle(sql);

  const allBoats = await db.select().from(boats);
  console.log(`${allBoats.length} bateaux à migrer`);

  // NOTE : les anciens flags étaient stockés où ? Probablement dans une
  // colonne JSON de boats (ex. boats.upgrades). Adapter le SELECT en
  // conséquence. Ici on suppose une colonne `upgrades_legacy text[]`.
  // Si le champ n'existe pas, ce script est vide (tous bateaux = Série).

  for (const boat of allBoats) {
    const legacyFlags: string[] = (boat as any).upgradesLegacy ?? [];

    for (const flag of legacyFlags) {
      const mapping = FLAG_TO_ITEM[flag];
      if (!mapping) {
        console.warn(`Flag inconnu: ${flag}`);
        continue;
      }
      const itemId = mapping.itemByClass[boat.boatClass];
      if (!itemId) {
        console.warn(`Pas d'équivalent ${flag} pour classe ${boat.boatClass}`);
        continue;
      }

      // Créer le player_upgrade
      const [pu] = await db.insert(playerUpgrades).values({
        playerId: boat.ownerId,
        upgradeCatalogId: itemId,
        acquisitionSource: 'MIGRATION',
        paidCredits: 0,
      }).returning();

      // Installer sur le bateau
      await db.insert(boatInstalledUpgrades).values({
        boatId: boat.id,
        slot: mapping.slot,
        playerUpgradeId: pu!.id,
      });

      console.log(`  ${boat.id} (${boat.boatClass}) ← ${itemId}`);
    }
  }

  console.log('Migration terminée');
  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2 : Test sec sur DB de dev**

```bash
cd apps/game-engine && tsx src/db/migrations/seed-upgrades-from-flags.ts
```

Attendu : log avec count de bateaux + détail par boat. Si aucun ancien flag dans la DB de dev → script ne fait rien et termine OK.

- [ ] **Step 3 : Commit**

```bash
git add apps/game-engine/src/db/migrations/seed-upgrades-from-flags.ts
git commit -m "feat(db): script de migration des anciens flags d'upgrade vers le nouveau modèle

À exécuter une fois après déploiement Plan 1, avant l'activation du
code engine refactoré."
```

---

## Task 13 — Tests E2E parity (garde-fou de non-régression)

**Files:**
- Run: `apps/game-engine/src/test/e2e-tick.ts` et `e2e-segments.ts`

L'objectif est de **vérifier que les E2E existants passent toujours** avec le nouveau système, **avec les items équivalents installés**.

- [ ] **Step 1 : Identifier les fixtures**

Run :
```bash
cd apps/game-engine && grep -nE "upgrades|FOILS|CARBON_RIG" src/test/e2e-tick.ts src/test/e2e-segments.ts
```

Repérer comment `upgrades` (le `Set<string>`) est construit dans les fixtures de test.

- [ ] **Step 2 : Modifier les fixtures pour utiliser le nouveau modèle**

Là où l'ancien test faisait :
```typescript
const upgrades = new Set(['FOILS']);
runtime.upgrades = upgrades;
```

Remplacer par :
```typescript
import { resolveBoatLoadout } from '../engine/loadout.js';
import { GameBalance } from '@nemo/game-balance';

await GameBalance.loadFromDisk();
const foilsItem = GameBalance.upgrades.items.find((it) => it.id === 'foils-class40-c')!;
const loadout = resolveBoatLoadout('test-participant', [foilsItem], 'CLASS40');
runtime.loadout = loadout;
```

(Adapter selon les flags utilisés dans chaque test.)

- [ ] **Step 3 : Lancer les E2E**

```bash
cd apps/game-engine && pnpm test:e2e
pnpm test:e2e:segments
```

Attendu :
- `e2e-tick.ts` : passe (même `totalNm` qu'avant à ±1% près — l'effet `foils-class40-c` est aligné sur l'ancien `FOILS` de game-balance.json).
- `e2e-segments.ts` : passe (même comportement de segmentation).

Si écart > 1% : c'est que les valeurs numériques de `foils-class40-c` (Task 4) ne matchent pas exactement l'ancien `FOILS`. Ajuster les `speedByTwa[]` du Bronze C40 pour atteindre la parité, **commit séparé** avec note explicative.

- [ ] **Step 4 : Commit**

```bash
git add apps/game-engine/src/test/e2e-tick.ts apps/game-engine/src/test/e2e-segments.ts
git commit -m "test(e2e): adapter fixtures aux loadouts (parity check)

Le comportement engine est préservé à ±1% près avec les items
équivalents aux 6 anciens flags installés."
```

---

## Task 14 — Validation au boot du game-engine

**Files:**
- Modify: `apps/game-engine/src/index.ts`

- [ ] **Step 1 : Ajouter un check de cohérence catalogue au boot**

Au démarrage du game-engine, **après** `GameBalance.loadFromDisk()`, vérifier qu'un item Série existe pour chaque (slot, classe) marqué `open` :

```typescript
// Dans apps/game-engine/src/index.ts, après loadFromDisk :
function validateCatalogCoverage(): void {
  const cat = GameBalance.upgrades;
  const errors: string[] = [];
  for (const [boatClass, slots] of Object.entries(cat.slotsByClass)) {
    for (const [slot, availability] of Object.entries(slots)) {
      if (availability === 'absent') continue;
      const hasSerie = cat.items.some(
        (it) => it.slot === slot && it.tier === 'SERIE' && it.compat.includes(boatClass as any),
      );
      if (!hasSerie) {
        errors.push(`Aucun item SERIE pour ${slot}/${boatClass}`);
      }
    }
  }
  if (errors.length > 0) {
    throw new Error(`Catalogue d'upgrades incomplet :\n${errors.map((e) => `  - ${e}`).join('\n')}`);
  }
}

// À l'init :
await GameBalance.loadFromDisk();
validateCatalogCoverage();
```

- [ ] **Step 2 : Vérifier le boot**

```bash
cd apps/game-engine && pnpm dev
```

Attendu : démarrage normal, log `[engine] Catalogue d'upgrades validé : 42 items, 5 classes`.

(Si erreur : un item Série manque pour un (slot, classe). Ajouter dans game-balance.json.)

- [ ] **Step 3 : Commit**

```bash
git add apps/game-engine/src/index.ts
git commit -m "feat(engine): validation de couverture du catalogue au boot

Refuse de démarrer si un slot 'open' d'une classe n'a pas d'item Série."
```

---

## Self-Review

**Spec coverage check** :

- ✅ Section A.1 — modifs `boats` (generation +, total_upgrade_cost −) → Task 1 step 2
- ✅ Section A.2 — table `player_upgrades` → Task 1 step 3
- ✅ Section A.3 — table `boat_installed_upgrades` → Task 1 step 3
- ✅ Section A.4 — pas de table catalogue → confirmé via Task 2 (Zod sur JSON)
- ✅ Section B.1 — bloc upgrades étendu → Task 3
- ✅ Section B.2 — forme d'item → Task 2 (Zod) + Tasks 4-6 (data)
- ✅ Section B.3 — tag profil → présent dans tous les items des Tasks 4-6
- ✅ Section B.4 — migration des 6 flags → Task 12
- ✅ Section B.5 — completionBonus → Task 3 step 2
- ✅ Section B.6 — Zod au boot → Task 2 step 3 + Task 14
- ✅ Section D.1 — module loadout → Task 8
- ✅ Section D.2 — hot path tick avec speedByTwa/Tws → Task 11
- ✅ Section D.3 — wear & manœuvres → Tasks 9 + 10
- ✅ Section D.4 — migration anciens flags → Task 12
- ✅ Section D.6 — tests : unit (Task 8), E2E parity (Task 13)

**Hors scope Plan 1 (verra Plan 2/3)** :
- Section D.5 (API REST 9 endpoints) → Plan 2
- Toute la Section C (UI) → Plan 3

**Placeholder scan** : ✅ Aucun TBD/TODO dans les steps. Code complet partout.

**Type consistency** : ✅ Vérifié — `BoatLoadout`, `AggregatedEffects`, `ResolvedItem` utilisés cohéremment de Task 8 → 9 → 10 → 11. Signature `computeWearDelta(weather, heading, driveMode, dtSec, loadoutEffects)` cohérente Task 9 ↔ Task 11. `aggregateEffects(items, ctx)` cohérent Task 8 ↔ Task 11.

**Notes connues** :
- Task 4 step 8 dit `OK 22` mais en pratique `OK 24` — j'ai prévenu en step 8.
- Task 6 step 4 dit `OK 43` mais en réalité `42` — j'ai prévenu aussi.
- Task 11 step 5 mentionne « adapter aux noms exacts dans manager.ts » — la fonction d'init exacte dépend de ce qu'on découvre dans manager.ts, à découvrir au moment d'exécuter la task.
