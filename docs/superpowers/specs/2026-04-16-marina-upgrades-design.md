# Design — Marina, multi-bateaux et système d'upgrades V1

**Date :** 2026-04-16
**Status :** Approved (pending implementation plan)
**Cible :** Phase 4 (mode carrière)
**Brainstorming source :** session terminal du 2026-04-16, validé section par section.

---

## 1. Contexte & motivation

La page `/marina/[boatId]` actuelle expose une « Configuration » avec des variantes par catégorie, mais le modèle de données sous-jacent est inconsistant :

- Le **front** ([apps/web/src/app/marina/data.ts](../../apps/web/src/app/marina/data.ts)) modélise 6 catégories × 2-4 variantes par bateau, mock 100% client, avec un `equippedVariantId` par catégorie. Aucune notion d'inventaire, de transferabilité, ou de coût explicite séparant achat et installation.
- Le **`game-balance.json`** ([packages/game-balance/game-balance.json](../../packages/game-balance/game-balance.json)) définit 6 upgrades (`AUTO_SAIL`, `FOILS`, `CARBON_RIG`, `KEVLAR_SAILS`, `REINFORCED_HULL`, `HEAVY_WEATHER_KIT`) traités comme **des flags** dans l'engine (`upgrades.has('FOILS')`).
- Le **schéma `boats`** ([apps/game-engine/src/db/schema.ts](../../apps/game-engine/src/db/schema.ts)) n'a ni table d'upgrades ni contrainte de multiplicité par classe — juste un agrégat `totalUpgradeCost int`.

Trois besoins gameplay se sont ajoutés :
1. Permettre à un joueur d'avoir **plusieurs bateaux de la même classe** (ex : 2 Class40), pour engager des courses parallèles avec des configurations distinctes.
2. Modéliser explicitement les **upgrades comme des items** que le joueur **achète** et **installe** (deux actions séparées), avec **transfert** d'un bateau à l'autre.
3. Spécifier **les effets concrets** de chaque upgrade dans l'engine (au-delà des 6 flags actuels).

Le présent document tranche le modèle (DB, catalogue, UI, engine) et liste les items V1.

## 2. Goals / Non-goals

### Goals
- Multi-bateau par classe, cap **5 par classe** (25 max par joueur).
- Inventaire d'upgrades **attaché au joueur** (transferable, conservé après vente d'un bateau).
- Catalogue extensible (game-balance.json) avec **5 tiers** et **7 slots**.
- Effets standardisés sur **7 dimensions** mécaniques.
- UI **drawer side** par slot pour configurer.
- **Hard lock** des modifications perf pendant qu'un bateau court ; **livrée libre**.
- Migration des 6 anciens flags engine vers items équivalents (parité comportementale via tests E2E).

### Non-goals (V1)
- Génération de bateaux **multiple** : tout est `generation = 1`. La structure DB le permet, l'UI ne l'expose pas.
- **Customisation visuelle** : pas de changement, la page `/customize` reste telle quelle.
- **Page d'inventaire dédiée** : reportée. Le drawer de slot couvre les besoins V1.
- **Catalogue complet pour OF / IMOCA60 / Ultim** : V1 ne populate intégralement que **Class40** + **Figaro**. Les 3 autres ont la structure mais catalogue minimal (items partagés ELEC + REINF).
- **Système batterie / hydrogénération** : reporté Phase 5+, demande un nouveau state machine.
- **Réparation avec durée d'indispo** : la réparation est instantanée ; le `durationHours` du game-balance existant devient cosmétique / ignoré.
- **Revente d'upgrades** : un upgrade en inventaire ne peut pas être converti en crédits. Il reste utilisable indéfiniment.

## 3. Décisions verrouillées (récap)

| Domaine | Décision |
|---|---|
| Modèle bateau | Multi-bateau par classe, cap 5/classe |
| Acquisition coque | 1ère = auto à l'inscription course ; suivantes = bouton « + Nouvelle <classe> », gratuit, 1 clic |
| Vente | Irréversible. Formule = `totalNm × 1 + wins × 500 + podiums × 150 + top10 × 30`. Coque vierge → 0 cr (anti-farm) |
| Upgrades pendant course | **Hard lock perf** (install / uninstall / vente / réparation) ; **livrée libre** |
| Modèle d'upgrades | **Slots fixes** (7 : HULL, MAST, SAILS, FOILS, KEEL, ELECTRONICS, REINFORCEMENT) |
| Inventaire | Attaché au **joueur** (table `player_upgrades`). Désinstallable, transférable. Conservé à la vente d'un bateau. |
| Achat ≠ installation | 2 actions distinctes (POST `/upgrades/purchase` puis `/boats/:id/install`) + endpoint combo (POST `/upgrades/buy-and-install`) |
| Tiers | Série (0) · Bronze (1.5-3.5k) · Silver (4.5-8k) · Gold (10-15k) · Proto (achievement-locked) |
| Maintenance multiplier par tier | Série 1.0 · Bronze 1.5 · Silver 2.0 · Gold 3.0 · Proto 4.5 |
| Restrictions par classe | Matrice `slotsByClass`, valeurs : `open` / `monotype` / `absent` |
| Effets | 7 dimensions : `speedByTwa[5]`, `speedByTws[3]`, `wearMul{4}`, `maneuverMul{3 manœuvres × {dur, speed}}`, `polarTargetsDeg`, `activation`, `groundingLossMul` |
| Affichage | Pills auto-dérivées + tag profil rédigé manuellement (1-3 mots) |
| Réparation | Instantanée. Coût = `(100 - condition)/10 × baseCost × tierMul` par axe |
| Ré-agrégation effets | À chaque tick (simple). Optim cache par bande TWS reportée. |
| Économie | Completion bonus ajouté : `{ FIGARO: 200, CLASS40: 300, OCEAN_FIFTY: 500, IMOCA60: 450, ULTIM: 700 }` cr / course finie |
| UI marina list | CTA toujours « Détail bateau ». États : « En course · X » ou « Au port » (suppression de « · neuf ») |

## 4. Section A — Schéma DB

### A.1 — Table `boats` (modifs)

```sql
ALTER TABLE boats
  ADD COLUMN generation smallint NOT NULL DEFAULT 1,
  DROP COLUMN total_upgrade_cost;
```

- `generation` : préparé pour les futures générations de bateaux. V1 = 1 partout, pas exposé en UI.
- `total_upgrade_cost` : retiré, remplacé par calcul à la volée si besoin.
- **Pas de contrainte d'unicité** sur `(owner_id, boat_class)` : le cap 5 par classe est validé en applicatif (cheaper que trigger DB).
- `activeRaceId` : **inchangé**, sert au hard lock.

### A.2 — Nouvelle table `player_upgrades`

```sql
CREATE TYPE upgrade_acquisition_source AS ENUM (
  'PURCHASE',
  'ACHIEVEMENT_UNLOCK',
  'BOAT_SOLD_RETURN',
  'ADMIN_GRANT',
  'GIFT',
  'MIGRATION'
);

CREATE TABLE player_upgrades (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id          uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  upgrade_catalog_id text NOT NULL,
  acquired_at        timestamptz NOT NULL DEFAULT now(),
  acquisition_source upgrade_acquisition_source NOT NULL,
  paid_credits       integer NOT NULL DEFAULT 0
);

CREATE INDEX idx_player_upgrades_player ON player_upgrades (player_id);
```

Un même `upgrade_catalog_id` peut apparaître plusieurs fois pour le même joueur (= il en possède 2 exemplaires). Unicité sur l'`id` UUID seul.

### A.3 — Nouvelle table `boat_installed_upgrades`

```sql
CREATE TYPE upgrade_slot AS ENUM (
  'HULL', 'MAST', 'SAILS', 'FOILS', 'KEEL', 'ELECTRONICS', 'REINFORCEMENT'
);

CREATE TABLE boat_installed_upgrades (
  boat_id            uuid NOT NULL REFERENCES boats(id) ON DELETE CASCADE,
  slot               upgrade_slot NOT NULL,
  player_upgrade_id  uuid NOT NULL UNIQUE REFERENCES player_upgrades(id) ON DELETE CASCADE,
  installed_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (boat_id, slot)
);
```

L'absence d'une ligne pour un slot = ce slot tient l'item Série par défaut (lu dans le catalogue à la résolution). Donc on n'écrit en DB **que** les upgrades non-Série.

### A.4 — Pas de table `upgrade_catalog`

Le catalogue (items, prix, effets, restrictions, unlock criteria) reste **dans `game-balance.json`**, lu au démarrage par l'engine et exposé via `GET /api/v1/upgrades/catalog`. Cohérent avec la règle existante « game-balance.json = source unique de vérité ».

## 5. Section B — Catalogue & game-balance.json

### B.1 — Bloc `upgrades` étendu

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
                     "FOILS": "monotype", "KEEL": "monotype",
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

  "items": [ /* voir Appendice */ ]
}
```

3 valeurs pour `slotsByClass` :
- **`open`** : tous les items du slot dont `compat[]` inclut cette classe sont achetables.
- **`monotype`** : seul l'item Série de cette classe (pas d'achat possible — l'UI cache le bouton).
- **`absent`** : slot inexistant pour la classe (l'UI cache le slot lui-même).

### B.2 — Forme d'un item

```json
{
  "id": "sails-class40-mylar",
  "slot": "SAILS",
  "tier": "SILVER",
  "name": "Voiles Mylar",
  "profile": "polyvalent stable",
  "description": "Forme stable sur tout le cadran. Très bon pilotage automatique. Demande un entretien régulier.",
  "compat": ["CLASS40", "IMOCA60"],
  "cost": 7800,
  "effects": {
    "speedByTwa": [0, 0.02, 0.03, 0.02, 0],
    "speedByTws": [0.01, 0.02, 0],
    "wearMul":    { "sail": 1.20 },
    "maneuverMul": {},
    "polarTargetsDeg": null,
    "activation":   {},
    "groundingLossMul": null
  }
}
```

Pour un item **Proto** : `cost: null` + bloc `unlockCriteria` :

```json
"unlockCriteria": {
  "racesFinished":   20,
  "avgRankPctMax":   0.20,
  "or":              false
}
```

Critères tirent dans `players.{racesFinished, avgRankPct, top10Finishes, currentStreak…}`. **Jamais podium-locking** (les podiums sont rares, on calibre sur percentile + commitment).

### B.3 — Tag profil

Libellé court (1-3 mots) écrit manuellement par item, affiché en mono-uppercase sur la card. Exemples canoniques :
- `polyvalent` (Série)
- `près incisif` (HULL optim)
- `portant débridé` (HULL scow)
- `vol agressif` (FOILS-S)
- `tenue gros temps` (REINF heavy)
- `routage embarqué` (ELEC pro)

### B.4 — Migration des 6 anciens items engine

| Ancien flag | Nouvel item slot-aware (V1) |
|---|---|
| `FOILS` | `foils-class40-c` (et équivalents IMOCA / Ultim) |
| `CARBON_RIG` | `mast-class40-carbon` |
| `KEVLAR_SAILS` | `sails-class40-mylar` |
| `REINFORCED_HULL` | `reinforcement-pro` |
| `HEAVY_WEATHER_KIT` | `reinforcement-heavy-weather` |
| `AUTO_SAIL` | absorbé dans `electronics-pack-race` (effet `maneuverMul.sailChange`) |

Les bateaux existants en DB reçoivent leurs items équivalents en `boat_installed_upgrades` lors du déploiement de la migration (`acquisition_source = MIGRATION`).

### B.5 — Économie : completion bonus

Ajouter dans `economy` :

```json
"economy": {
  ...
  "completionBonus": {
    "FIGARO": 200, "CLASS40": 300, "OCEAN_FIFTY": 500,
    "IMOCA60": 450, "ULTIM": 700
  }
}
```

Crédité à chaque course terminée (rank défini), en plus des `distanceRates × rankMultipliers + palmaresBonus` existants.

### B.6 — Validation Zod au boot

Au démarrage de l'engine :
1. Charger `game-balance.json` → parse via Zod schema strict.
2. Pour chaque item : vérifier `slot ∈ slots`, `tier ∈ tiers`, `compat ⊂ classes`, `cost ∈ tiers[tier].priceRange` (sauf Proto), `effects` bien formé.
3. Pour chaque classe avec slot `open` : vérifier qu'au moins 1 item Série existe pour ce (slot, classe).
4. Si vérif échoue → **boot refusé** (logique « catalogue cassé > catalogue silencieusement faux »).

## 6. Section C — UI flow

### C.1 — `/marina` (liste)

Layout par classe, 5 sections max :

```
┌─ FIGARO III · 1/5 coques ────────────────────────────┐
│ [Card Albatros]                                       │
└───────────────────────────────────────────────────────┘
┌─ CLASS40 · 2/5 coques ───────────────────────────────┐
│ [Card Mistral]   [Card Tornade]   [+ Nouvelle Class40]│
└───────────────────────────────────────────────────────┘
┌─ IMOCA 60 · Verrouillée ─────────────────────────────┐
│ [Card "Inscris-toi à une course IMOCA60"]             │
└───────────────────────────────────────────────────────┘
```

- Bouton **`+ Nouvelle <classe>`** : visible si classe débloquée ET `count < 5`. Click → POST `/api/v1/boats` → redirect vers `/marina/[newBoatId]/customize` (livrée).
- Card bateau : CTA toujours **« Détail bateau »**.
- État affiché : **« En course · X »** (avec lien vers `/play/X`) ou **« Au port »** uniquement.

### C.2 — `/marina/[boatId]` (refonte)

**Sections** :

1. **Hero** (inchangé) — render SVG + nom + state + tagline.
2. **Actions barre** :

| Action | Lock pendant course | Comportement |
|---|---|---|
| Personnaliser livrée | ❌ jamais | Lien `/marina/[id]/customize` |
| Réparer le bateau | ✅ si en course | Modale avec coût détaillé par axe |
| Vendre | ✅ si en course | Modale confirmation avec gain estimé |

Pendant course, les boutons lock sont disabled + tooltip « Revient le 23 avr. à 14:30 ».

3. **Stats band** — courses, palmarès, distance, condition (4 axes : hull / rig / sail / elec).
4. **Section « Équipement »** :
   - 7 cartes slot, chacune affiche : nom du slot, item équipé (nom + tag profil), pills d'effets, tier badge.
   - Card slot **`absent`** pour cette classe → masquée.
   - Card slot **`monotype`** → grisée, mention « Réglementation classe », pas de bouton.
   - Card slot **`open`** → bouton **« Changer »** ouvre un drawer side.
5. **Drawer « Changer le slot »** (slide-out latéral) :
   - Onglet **Installer** : items en inventaire compatibles avec ce slot (= `compat[]` inclut la classe ET pas déjà installé ailleurs), bouton « Installer » par item.
   - Onglet **Acheter** : items du catalogue compatibles, regroupés par tier, prix affiché. Bouton **« Acheter et installer »** = appel `POST /upgrades/buy-and-install` (combo transactionnel).
   - Item Série du slot toujours visible en bas comme « Revenir au stock » (gratuit, désinstalle l'actuel si non-Série). **Bouton masqué si le slot est déjà à l'item Série** (no-op).
6. **Historique** (inchangé) — palmarès paginé.

### C.3 — `/marina/[boatId]/customize` (existante, inchangée)

Reste fonctionnelle telle quelle. Accessible aussi pendant course.

### C.4 — Pas de page catalogue séparée

Le catalogue n'est consultable qu'au moment où on configure un slot d'un bateau précis. Économe en surface UI, et un nouveau joueur (inventaire vide) n'a pas de page vide à découvrir.

### C.5 — Modale réparation

```
RÉPARER ALBATROS

Hull (78%)         → 22 pts × 80 cr × 1.0 (Série)  =   176 cr
Rig  (62%)         → 38 pts × 50 cr × 1.5 (Bronze) =   285 cr
Sail (45%)         → 55 pts × 120 cr × 2.0 (Silver) = 1 320 cr
Elec (90%)         → 10 pts × 30 cr × 1.5 (Bronze) =    45 cr
                     ────────────────────────────────────────
Total à débiter    : 1 826 cr
Solde après        : 10 654 cr

[Annuler]   [Réparer (1 826 cr)]
```

Click confirmation → `POST /api/v1/boats/:id/repair` → débit immédiat, conditions à 100, toast.

### C.6 — Modale vente

```
VENDRE MISTRAL ?

Cette action est irréversible.

Palmarès du bateau    : 12 courses · 0 victoire · 2 podiums · 5 top10
Distance parcourue    : 3 482 NM
Crédits estimés       : 3 932 cr

Upgrades retournés en inventaire : 4
  ▸ Mât carbone HM (Silver)
  ▸ Voiles Mylar (Silver)
  ▸ Foils en C (Bronze)
  ▸ Pack régate (Bronze)

[Annuler]   [Vendre (+3 932 cr)]
```

Click confirmation → `DELETE /api/v1/boats/:id` → bateau supprimé, livrée perdue, upgrades migrés en `player_upgrades` (acquisition_source = `BOAT_SOLD_RETURN`), crédits crédités.

## 7. Section D — Engine, API, migration

### D.1 — Module `loadout.ts`

Pour chaque participant à une course, l'engine résout au démarrage (event `RACE_STARTED`) un `BoatLoadout` :

```ts
interface BoatLoadout {
  participantId: string;
  bySlot: Map<UpgradeSlot, ResolvedItem>;
  aggregatedEffects: {
    speedByTwa: [number, number, number, number, number];   // 5 bands, 1.0 = neutre
    speedByTws: [number, number, number];                    // 3 bands
    wearMul:    { hull: number; rig: number; sail: number; elec: number };
    maneuverMul:{
      tack:       { dur: number; speed: number };
      gybe:       { dur: number; speed: number };
      sailChange: { dur: number; speed: number };
    };
    polarTargetsDeg: number;
    groundingLossMul: number;
    activation: Array<{ minTws?: number; maxTws?: number; itemId: string }>;
  };
}
```

**Algorithme** :
1. Lire `boat_installed_upgrades` du bateau → liste `(slot, upgrade_catalog_id)`.
2. Pour chaque slot non listé → installer l'item Série de ce slot pour cette classe.
3. Pour chaque item : multiplier les effets dans l'agrégat (1.0 = neutre, donc multiplier par 1.0 si l'item n'a pas la dimension).
4. **Règle d'agrégation `polarTargetsDeg`** : item avec `polarTargetsDeg: null` n'apporte rien ; sinon on prend le **min** des valeurs non-null (meilleure précision gagne). Si aucun item ne fournit la dimension, valeur agrégée = `0` (= aucune assistance).
5. **Règle d'agrégation `groundingLossMul`** : multiplier des valeurs non-null. Si aucun item ne fournit, valeur agrégée = `1.0`.
6. Cacher dans la runtime du worker. Pas de DB read pendant la course (hard lock).

**Coût** : ~200 B/participant en mémoire, <1 ms init par bateau.

### D.2 — Hot path tick

```ts
const twaBand = bandFor(twa, [60, 90, 120, 150, 180]);
const twsBand = bandFor(tws, [10, 20]);

// Filtrer les items dont activation matche le tws actuel
const activeMul = computeActiveMultipliers(loadout, tws);

bsp = polarSpeed(twa, tws)
    * activeMul.speedByTwa[twaBand]
    * activeMul.speedByTws[twsBand]
    * conditionPenalty(boat)
    * zoneMultiplier(zone);
```

**Décision** : `computeActiveMultipliers` est appelé **à chaque tick** (simple, ~7 multiplications/bateau). L'optimisation cache-par-bande-TWS est documentée comme reportable mais non implémentée V1.

### D.3 — Wear et manœuvres

```ts
// wear.ts
rigMul  *= loadout.aggregatedEffects.wearMul.rig;
hullMul *= loadout.aggregatedEffects.wearMul.hull;
sailsMul *= loadout.aggregatedEffects.wearMul.sail;
elecMul  *= loadout.aggregatedEffects.wearMul.elec;
```

```ts
// orders.ts (manœuvres)
tackDuration   *= loadout.aggregatedEffects.maneuverMul.tack.dur;
tackSpeedFactor = baseSpeedFactor * loadout.aggregatedEffects.maneuverMul.tack.speed;
```

### D.4 — Migration des 6 anciens flags

Le code existant (`upgrades.has('FOILS')`, etc.) est remplacé par lookup dans `loadout`. La table de mapping (B.4) est appliquée au seed/migration : pour chaque bateau existant ayant l'ancien flag, on crée le `player_upgrade` correspondant + on l'installe sur le bon slot.

### D.5 — API REST nouvelle

Tous sous `/api/v1` :

| Méthode | Route | Rôle | Lock check |
|---|---|---|---|
| `GET` | `/upgrades/catalog` | Catalogue complet (filtre `?boatClass=` optionnel) | — |
| `GET` | `/players/me/upgrades` | Inventaire du joueur | — |
| `POST` | `/upgrades/purchase` | Achète un item, débite crédits, ajoute en inventaire | — |
| `POST` | `/upgrades/buy-and-install` | Combo transactionnel : achète + installe | `activeRaceId IS NULL` (sur le boat cible) |
| `POST` | `/boats` | Crée une coque vierge (cap 5/classe vérifié) | — |
| `POST` | `/boats/:id/install` | Installe un `player_upgrade_id` sur un slot | `activeRaceId IS NULL` |
| `POST` | `/boats/:id/uninstall` | Retire l'item d'un slot, retourne en inventaire | `activeRaceId IS NULL` |
| `POST` | `/boats/:id/repair` | Répare, débite crédits, conditions à 100 | `activeRaceId IS NULL` |
| `DELETE` | `/boats/:id` | Vend, débite la coque, retourne upgrades en inventaire, crédite vente | `activeRaceId IS NULL` |

Toutes les actions de modif renvoient **`409 Conflict`** avec body explicite si le lock check échoue. **`400 Bad Request`** pour incompat slot/classe ou solde insuffisant.

### D.6 — Tests

3 niveaux :
- **Unit** : `loadout.ts` (résolution d'items, agrégation, activation conditionnelle, polarTargetsDeg en min).
- **Integration** : seed bateau avec différents loadouts, assertions sur `bsp` calculé pour combinaisons (TWA × TWS × loadout).
- **E2E parity** : les tests existants `e2e-tick.ts` et `e2e-segments.ts` doivent passer **sans changement** quand on installe les items équivalents aux anciens flags. **Garde-fou de non-régression moteur** — pas de merge tant qu'ils ne passent pas.

## 8. Phasing V1 vs reporté

### Inclus V1 (ce spec)
- Migrations DB (`boats.generation`, `player_upgrades`, `boat_installed_upgrades`).
- Bloc `upgrades` étendu dans `game-balance.json` avec **Class40 et Figaro entièrement populés**, structure pour les 3 autres classes (items partagés ELEC/REINF + items monotype Série).
- Refactor engine (`loadout.ts`, hot path tick, wear, orders).
- 9 endpoints REST + lock checks.
- Refonte UI `/marina` (par classe, bouton + nouvelle, états restreints).
- Refonte UI `/marina/[boatId]` section Équipement + drawer side.
- Modales réparation / vente.
- Migration des 6 anciens flags + tests E2E parity.

### Reporté Phase 4.b ou plus
- Catalogue complet pour OCEAN_FIFTY, IMOCA60, ULTIM.
- Bandeau « Inventaire » sur `/marina` (si besoin émerge).
- Système batterie / hydrogénération.
- Réparation avec durée d'indispo.
- Système de générations multiples (UI + game-balance).
- Optim cache par bande TWS pour `computeActiveMultipliers`.
- Revente d'upgrades.

## 9. Appendice — items concrets V1

### Class40 (open partout, 22 items)

| Slot | Items |
|---|---|
| HULL | `hull-class40-standard` (Série, *polyvalent*) · `hull-class40-optim` (Bronze 4 200, *près incisif*) · `hull-class40-scow` (Silver 7 200, *portant débridé*) · `hull-class40-proto` (Proto, *extrême fragile*) |
| MAST | `mast-class40-alu` (Série, *série*) · `mast-class40-carbon` (Bronze 3 200, *vif raidi*) · `mast-class40-carbon-hm` (Silver 6 800, *stable musclé*) |
| SAILS | `sails-class40-dacron` (Série, *polyvalent*) · `sails-class40-mylar` (Silver 5 800, *polyvalent stable*) · `sails-class40-3di` (Gold 12 500, *rendement haut*) · `sails-class40-north-custom` (Proto, *sur-mesure expert*) |
| FOILS | `foils-class40-none` (Série, *coque seule*) · `foils-class40-c` (Bronze 3 500, *reaching nerveux*) · `foils-class40-s` (Silver 7 800, *vol agressif*) · `foils-class40-proto` (Proto, *vol total*) |
| KEEL | `keel-class40-fixed` (Série, *série*) · `keel-class40-pendulum` (Bronze 2 800, *puissance redresseur*) · `keel-class40-canting` (Silver 5 600, *couple max*) |
| ELECTRONICS | `electronics-pack-base` (Série, *standard*) · `electronics-pack-race` (Bronze 2 200, *cibles polaires*) · `electronics-pack-offshore` (Silver 4 800, *routage embarqué*) |
| REINFORCEMENT | `reinforcement-none` (Série, *aucun*) · `reinforcement-heavy-weather` (Bronze 1 800, *tenue gros temps*) · `reinforcement-pro` (Silver 4 500, *blindage compétition*) |

### Figaro III (monotype HULL/MAST/KEEL/FOILS, 9 items)

| Slot | Items |
|---|---|
| HULL | `hull-figaro-monotype` (Série, *réglementaire*) |
| MAST | `mast-figaro-monotype` (Série, *réglementaire*) |
| SAILS | `sails-figaro-monotype` (Série, *certifié classe*) · `sails-figaro-north-certified` (Bronze 2 800, *rendement classe*) |
| FOILS | `foils-figaro-monotype` (Série, *foils intégrés*) |
| KEEL | `keel-figaro-monotype` (Série, *réglementaire*) |
| ELECTRONICS | partagé : `electronics-pack-base` · `electronics-pack-race` · `electronics-pack-offshore` |
| REINFORCEMENT | partagé : `reinforcement-none` · `reinforcement-heavy-weather` |

### Effets exemple détaillés (3 items)

**`foils-class40-c`** (Bronze, *reaching nerveux*, 3 500 cr) :
```json
{
  "speedByTwa": [-0.02, 0, 0.06, 0.04, 0],
  "speedByTws": [0, 0.02, 0.04],
  "wearMul":    { "rig": 1.4, "hull": 1.2 },
  "maneuverMul": {},
  "polarTargetsDeg": null,
  "activation":   { "minTws": 12 },
  "groundingLossMul": null
}
```

**`mast-class40-carbon-hm`** (Silver, *stable musclé*, 6 800 cr) :
```json
{
  "speedByTwa": [0.02, 0.02, 0.03, 0.03, 0.02],
  "speedByTws": [0, 0.01, 0.02],
  "wearMul":    { "rig": 1.3 },
  "maneuverMul": {
    "tack":       { "dur": 0.85, "speed": 1.10 },
    "gybe":       { "dur": 0.90, "speed": 1.05 },
    "sailChange": { "dur": 1.0,  "speed": 1.0 }
  },
  "polarTargetsDeg": null,
  "activation":   {},
  "groundingLossMul": null
}
```

**`reinforcement-pro`** (Silver, *blindage compétition*, 4 500 cr) :
```json
{
  "speedByTwa": [0, 0, 0, 0, 0],
  "speedByTws": [-0.02, 0, 0],
  "wearMul":    { "hull": 0.45 },
  "maneuverMul": {},
  "polarTargetsDeg": null,
  "activation":   {},
  "groundingLossMul": 0.5
}
```

(Liste exhaustive des 22 items Class40 + 8 items Figaro à finaliser au plan d'implémentation. Chaque item suit le schéma B.2.)

---

## Référence rapide

- **Brainstorming source** : conversation du 2026-04-16, 9 questions Q1-Q9.
- **Memory associée** : [project_backend_schema_gaps.md](../../memory/project_backend_schema_gaps.md), [rules_gameplay.md](../../memory/rules_gameplay.md).
- **Code touché** : `apps/game-engine/src/db/schema.ts`, `apps/game-engine/src/engine/wear.ts`, `apps/game-engine/src/engine/orders.ts`, `packages/game-balance/game-balance.json`, `apps/web/src/app/marina/*`.
