# Mini 6.50 — Nouvelle classe de bateau

**Date** : 2026-04-21
**Statut** : Spec validée, en attente de plan d'implémentation
**Auteur** : Claude (Opus 4.7) + Damien

---

## 1. Contexte & objectif

Ajouter le **Mini 6.50** comme nouvelle classe de bateau jouable, en plus des 6 classes
existantes (`CRUISER_RACER`, `FIGARO`, `CLASS40`, `OCEAN_FIFTY`, `IMOCA60`, `ULTIM`).

Polaires fournies par l'utilisateur dans [tmp/mini-6.50/](../../../tmp/mini-6.50/) :
7 fichiers CSV (un par voile : `jib`, `lightJib`, `stay`, `c0`, `spi`, `hg`, `lg`),
TWA 0–180° × TWS 0–70 kt, séparateur `;`. Alignés sur les 7 `SailId` du jeu.

**Positionnement gameplay** : bateau d'entrée offshore, entre `CRUISER_RACER` (aucun
upgrade) et `FIGARO` (monotype). Cohérent avec le Mini IRL — petit, léger, abordable,
peu modifiable hors catégorie Proto. La progression naturelle d'un nouveau joueur
devient : CRUISER_RACER → MINI650 → FIGARO → CLASS40 → ...

---

## 2. Polaires

### 2.1 Format source
Sept fichiers CSV semicolon-separated dans [tmp/mini-6.50/](../../../tmp/mini-6.50/) :

```
TWA\TWS;0;1;2;...;70
0;0;0;0;...;0
1;0;0.016;0.032;...;0
...
180;0;...
```

- 181 lignes de données (TWA 0–180° par 1°) + 1 header
- 71 colonnes de TWS (0–70 kt par 1 kt) + 1 colonne label TWA
- Valeurs en nœuds (BSP)

Mapping nom de fichier → `SailId` :

| Fichier | SailId |
|---|---|
| `jib` | `JIB` |
| `lightJib` | `LJ` |
| `stay` | `SS` |
| `c0` | `C0` |
| `spi` | `SPI` |
| `hg` | `HG` |
| `lg` | `LG` |

### 2.2 Format cible
Fichier unique `apps/web/public/data/polars/mini650.json`, conforme à l'interface
`Polar` de [packages/shared-types/src/index.ts](../../../packages/shared-types/src/index.ts) :

```ts
interface Polar {
  boatClass: BoatClass;          // "MINI650"
  tws: number[];                  // [0, 1, ..., 70]
  twa: number[];                  // [0, 1, ..., 180]
  speeds: Record<SailId, number[][]>; // speeds[sail][twaIdx][twsIdx]
}
```

### 2.3 Conversion
Script one-shot `scripts/convert-mini650-polars.ts` (à créer) :

1. Lit les 7 CSV de [tmp/mini-6.50/](../../../tmp/mini-6.50/)
2. Parse chacun en grille 181×71 (Number sur chaque cellule)
3. Construit l'objet `Polar` avec `tws=[0..70]`, `twa=[0..180]`, `speeds[SailId] = grid`
4. Écrit `apps/web/public/data/polars/mini650.json` (pretty-printed comme les autres)

Le script vit dans `scripts/` (pas dans `apps/`) car il s'exécute une fois et le
résultat est commité. Ne pas le lancer en runtime.

---

## 3. Modifications type system

### 3.1 BoatClass union
[packages/shared-types/src/index.ts:1](../../../packages/shared-types/src/index.ts#L1) :

```diff
- export type BoatClass = 'CRUISER_RACER' | 'FIGARO' | 'CLASS40' | 'OCEAN_FIFTY' | 'IMOCA60' | 'ULTIM';
+ export type BoatClass = 'CRUISER_RACER' | 'MINI650' | 'FIGARO' | 'CLASS40' | 'OCEAN_FIFTY' | 'IMOCA60' | 'ULTIM';
```

Ordre choisi pour suivre la progression gameplay (taille / difficulté croissante).

### 3.2 Polar registry
[apps/web/src/lib/polar.ts:11-18](../../../apps/web/src/lib/polar.ts#L11-L18) :

```diff
  const POLAR_FILES: Record<BoatClass, string> = {
    CRUISER_RACER: 'cruiser-racer.json',
+   MINI650: 'mini650.json',
    FIGARO: 'figaro.json',
    ...
  };
```

### 3.3 Propagation TypeScript
Tous les `Record<BoatClass, X>` casseront le typecheck tant que MINI650 n'est pas
ajouté. Lieux identifiés (à confirmer en exécutant `tsc` après modif §3.1) :

- `rewards.distanceRates` (game-balance.json)
- `economy.completionBonus` (game-balance.json)
- `maneuvers.sailChange.transitionTimeSec` (game-balance.json)
- `maneuvers.tack.durationSec` (game-balance.json)
- `maneuvers.gybe.durationSec` (game-balance.json)
- `upgrades.slotsByClass` (game-balance.json)

Le schéma zod éventuel de game-balance (à vérifier) doit aussi accepter MINI650.

---

## 4. game-balance.json — entrées MINI650

### 4.1 Économie & rewards
```jsonc
"rewards.distanceRates.MINI650": 0.6,    // entre CRUISER_RACER (0.5) et FIGARO (0.8)
"economy.completionBonus.MINI650": 300,  // entre CRUISER_RACER (200) et FIGARO (400)
```

### 4.2 Manœuvres
Mini = petit, léger, solo, manœuvres rapides. Plus rapide que Figaro :

```jsonc
"maneuvers.sailChange.transitionTimeSec.MINI650": 150,  // Figaro: 180
"maneuvers.tack.durationSec.MINI650":             45,   // Figaro: 60
"maneuvers.gybe.durationSec.MINI650":             70    // Figaro: 90
```

### 4.3 Slots d'upgrade

```jsonc
"upgrades.slotsByClass.MINI650": {
  "HULL":          "monotype",   // Mini Série = règles strictes
  "MAST":          "monotype",   // Idem
  "KEEL":          "monotype",   // Quille fixe à bulbe règlementaire
  "FOILS":         "open",       // Permet upgrade vers petits foils latéraux
  "SAILS":         "open",       // Dacron → certifiées Mini → Mylar
  "ELECTRONICS":   "open",       // Réutilise les packs existants
  "REINFORCEMENT": "absent"      // Coque trop petite pour blindage compétition
}
```

---

## 5. Items d'upgrade

### 5.1 Nouveaux items spécifiques MINI650

**Slots monotype** (1 item SERIE chacun, gratuit, par défaut) :

```jsonc
{ "id": "hull-mini650-monotype", "slot": "HULL", "tier": "SERIE",
  "name": "Coque Mini 6.50 Série", "profile": "réglementaire",
  "description": "Coque de série Mini 6.50, conforme aux règles de jauge Série.",
  "compat": ["MINI650"], "cost": 0,
  "effects": { "speedByTwa": [0,0,0,0,0], "speedByTws": [0,0,0],
               "wearMul": {}, "maneuverMul": {}, "polarTargetsDeg": null,
               "activation": {}, "groundingLossMul": null } }

{ "id": "mast-mini650-monotype", "slot": "MAST", "tier": "SERIE",
  "name": "Mât Mini 6.50 Série", "profile": "réglementaire",
  "description": "Mât aluminium de série Mini 6.50.",
  "compat": ["MINI650"], "cost": 0, "effects": { /* zéros */ } }

{ "id": "keel-mini650-monotype", "slot": "KEEL", "tier": "SERIE",
  "name": "Quille Mini 6.50 Série", "profile": "fixe à bulbe",
  "description": "Quille fixe à bulbe, conforme à la jauge Mini Série.",
  "compat": ["MINI650"], "cost": 0, "effects": { /* zéros */ } }
```

**Slot FOILS** (2 items : par défaut + 1 BRONZE) :

```jsonc
{ "id": "foils-mini650-none", "slot": "FOILS", "tier": "SERIE",
  "name": "Sans Foils Mini 6.50", "profile": "coque seule",
  "description": "Configuration sans foils, coque pure en mode déplacement.",
  "compat": ["MINI650"], "cost": 0, "effects": { /* zéros */ } }

{ "id": "foils-mini650-lateral", "slot": "FOILS", "tier": "BRONZE",
  "name": "Foils Latéraux Mini 6.50", "profile": "reaching modeste",
  "description": "Petits foils latéraux Mini Proto, gain léger au reaching dès 14 nds.",
  "compat": ["MINI650"], "cost": 3000,
  "effects": {
    "speedByTwa": [-0.01, 0, 0.04, 0.03, 0],
    "speedByTws": [0, 0.01, 0.02],
    "wearMul": { "hull": 1.30, "rig": 1.15 },
    "maneuverMul": {}, "polarTargetsDeg": null,
    "activation": { "minTws": 14 },
    "groundingLossMul": null,
    "passiveEffects": { "speedByTws": [-0.02, 0, 0] }
  } }
```

**Slot SAILS** (2 items spécifiques + 1 ouvert via §5.2) :

```jsonc
{ "id": "sails-mini650-dacron", "slot": "SAILS", "tier": "SERIE",
  "name": "Voiles Dacron Mini 6.50", "profile": "polyvalent",
  "description": "Jeu Dacron de série, polyvalent et durable.",
  "compat": ["MINI650"], "cost": 0, "effects": { /* zéros */ } }

{ "id": "sails-mini650-cert", "slot": "SAILS", "tier": "BRONZE",
  "name": "Voiles Certifiées Classe Mini", "profile": "rendement classe",
  "description": "Voiles certifiées classe Mini, meilleur rendement dans les limites du règlement.",
  "compat": ["MINI650"], "cost": 2200,
  "effects": {
    "speedByTwa": [0.02, 0.02, 0.03, 0.02, 0.01],
    "speedByTws": [0.01, 0.02, 0.01],
    "wearMul": { "sail": 1.20 },
    "maneuverMul": {}, "polarTargetsDeg": null,
    "activation": {}, "groundingLossMul": null
  } }
```

### 5.2 Items existants étendus via `compat`

Aucun nouvel item, juste ajout de `"MINI650"` dans le tableau `compat` :

| Item existant | Slot | Tier | Justification |
|---|---|---|---|
| `sails-class40-mylar` | SAILS | SILVER | Mylar = matériau standard cross-class |
| `electronics-pack-base` | ELECTRONICS | SERIE | Pack base réutilisé sur tous les bateaux |
| `electronics-pack-race` | ELECTRONICS | BRONZE | Idem |
| `electronics-pack-offshore` | ELECTRONICS | SILVER | Idem |

### 5.3 Récapitulatif
- **7 nouveaux items** spécifiques MINI650 (5 SERIE + 2 BRONZE)
- **4 items existants** étendus en `compat`
- **Aucun item GOLD, SILVER spécifique, ni PROTO** pour MINI650 — cohérent avec
  "petit bateau, peu d'updates"

---

## 6. Tests & vérifications

### 6.1 Tests automatisés
- `loadPolar('MINI650')` charge `mini650.json` sans erreur
- `getPolarSpeed(polar, 'JIB', 40, 12)` retourne une valeur > 0 et cohérente
  (~5–6 kt attendu pour Mini en 12 kt)
- `getPolarSpeed(polar, 'JIB', 0, 10)` retourne 0 (dead zone)
- Validation game-balance : tous les `Record<BoatClass, X>` contiennent MINI650

### 6.2 Vérifications manuelles
- `pnpm typecheck` passe (le union élargi force la complétion partout)
- Marina UI affiche la classe MINI650 si un boat de cette classe existe
- Aucun item d'upgrade orphelin (chaque slot non-`absent` a ≥1 item SERIE compatible)

---

## 7. Hors scope

- **Création de boats MINI650 en base** : c'est de la gameplay, traitée ailleurs
- **Course labellisée Mini 6.50** : la classe est juste disponible, aucune course
  ne la sélectionne d'office
- **Mockup UI marina spécifique** : l'écran marina existant doit rendre la classe
  automatiquement — sera vérifié à l'implémentation
- **Image / illustration du Mini 6.50** : à fournir séparément, pas bloquant
- **Catégorie Mini Proto distincte** : pas dans cette spec ; la version PROTO
  pourra être ajoutée plus tard via items `tier: "PROTO"` si besoin
