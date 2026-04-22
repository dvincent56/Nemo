# Refonte du système d'usure — design

**Date** : 2026-04-22
**Statut** : À valider

## Contexte

Le système d'usure actuel présente trois problèmes :

1. **Pénalité de vitesse via `min(hull, rig, sails)`** : un seul composant usé plombe la performance entière, peu lisible et cliff-effect à 35.
2. **Dégradation trop rapide** : taux de base toujours actif (même en mer calme). En conditions moyennes, tous les composants plafonnent au seuil critique 35 avant la fin d'une course de 3 mois → plus de différenciation entre joueurs.
3. **Réparation payante en crédits** : sink majeur des crédits, incompatible avec le game design (les crédits doivent servir aux upgrades, pas à la maintenance forcée). Cohérent avec la règle anti-P2W.

## Objectifs

L'usure doit servir uniquement à :

- **A) Mécanique de risque météo** : un bateau qui fonce dans une dépression (stratégie "coupe") s'use plus qu'un bateau qui contourne (stratégie "prudent"). Le jeu ne simule ni casse ni abandon ; l'usure est le **proxy soft** de la fatigue matérielle réelle.
- **C) Différenciation des upgrades** : les setups optimisés pour la vitesse (PROTO, foils) s'usent plus vite que les setups durables (SERIE, coque renforcée), créant un arbitrage de configuration.

L'usure n'est PAS un sink économique.

## Design

### 1. Formule de pénalité de vitesse

Remplacer le `min(hull, rig, sails)` par une **moyenne pondérée**.

**Pour les boats non-foilers** :

```
conditionAvg = (0.5 × sails) + (0.3 × rig) + (0.2 × hull)
```

**Pour les boats foilers (IMOCA foiler, Ultim, Figaro 3 si foils présents)** :

```
conditionAvg = (0.4 × sails) + (0.3 × foils) + (0.2 × rig) + (0.1 × hull)
```

Les électroniques ne sont pas prises en compte dans la formule vitesse (elles restent utiles pour routage/visibilité et continuent à s'user pour cohérence).

**Courbe de pénalité** :

- `conditionAvg ≥ 85` → **0% de pénalité**
- `conditionAvg ≤ 50` → **8% de pénalité max**
- Entre les deux : linéaire → **~0.23% par point perdu**

La pénalité max passe de 15% à 8% parce qu'avec une moyenne pondérée, atteindre `conditionAvg = 50` signifie plusieurs composants bien entamés (scénario "agressif" sur 3 mois), là où le `min` capturait un seul composant critique.

### 2. Fonction d'usure conditionnelle

L'usure par heure d'un composant devient :

```
usureHeure = tauxBase × (multVent + multHoule) × multUpgrade
```

Les multiplicateurs vent et houle peuvent valoir **0** en conditions calmes → aucune usure en pétole méditerranéenne.

**Taux de base** (par heure, à multiplier par les conditions) :

| Composant | Taux actuel | Taux proposé | Ratio |
|-----------|-------------|--------------|-------|
| Voiles | 0.06 | **0.010** | ÷6 |
| Mât | 0.04 | **0.006** | ÷6.7 |
| Coque | 0.02 | **0.003** | ÷6.7 |
| Foils | variable (hériter des voiles) | **0.008** | — |
| Électroniques | 0.01 | **0.002** | ÷5 |

**Multiplicateur vent** (TWS = True Wind Speed en nœuds) :

```
TWS < 15       → 0.0   (mer calme, zéro usure)
TWS 15 → 25    → 0.0 → 1.0   (linéaire)
TWS 25 → 35    → 1.0 → 2.5   (linéaire)
TWS 35 → 45    → 2.5 → 5.0   (linéaire, zone "dépression")
TWS > 45       → 5.0   (plafond)
```

**Multiplicateur houle** (Hs = hauteur significative en mètres) :

```
Hs < 1.5       → 0.0
Hs 1.5 → 4     → 0.0 → 1.0
Hs 4 → 7       → 1.0 → 2.5
Hs > 7         → 2.5   (plafond)
```

Modulateurs additionnels à la houle :

- **Période courte** (`Tp < 8 s`) : +30% (mer hachée, tape plus)
- **Direction relative** :
  - Vagues de face (TWA mer 0-60°) : ×1.5
  - Vagues de travers (60-120°) : ×1.0
  - Vagues arrière (120-180°) : ×0.5

Les deux multiplicateurs (vent et houle) sont **additifs** et non multiplicatifs, pour éviter l'explosion combinée. Une mer de 8m sous 50 kt donne `mult = 5.0 + 2.5 = 7.5`, pas 12.5.

**Multiplicateurs d'upgrades** (conservés depuis le système actuel) :

- SERIE / stock → ×1.0
- BRONZE → ×1.1-1.3 selon pièce
- SILVER → ×1.3-1.6
- GOLD → ×1.6-2.0
- PROTO → ×2.0-2.5
- Coque renforcée → ×0.45
- Rig gros temps → ×0.55

Valeurs exactes par upgrade dans `game-balance.json`, inchangées sauf si l'équilibrage en aval le demande.

### 3. Simulation cible sur course de 3 mois (2160 h)

| Profil | Condition fin de course | Pénalité vitesse fin de course |
|--------|------------------------|--------------------------------|
| Prudent (route sud, TWS moyen 18 kt, Hs 2.5 m, mult ~1.2) | **~75%** | ~2.3% |
| Moyen (TWS 22 kt, Hs 3 m, mult ~1.8) | **~62%** | ~5.3% |
| Agressif (10% du temps en 40 kt / 6m, pics mult 7-8, moyenne ~2.8) | **~50%** | **~8%** |
| Méditerranée calme (TWS 8 kt, Hs < 1 m) | **~100%** | 0% |

L'écart prudent/agressif en fin de course atteint **~5-6% de vitesse**, soit plusieurs heures à l'arrivée sur une course longue — pénalité perceptible sans être écrasante.

### 4. Réparation automatique au départ

**Suppression de la réparation payante**

- Supprimer l'endpoint `POST /api/v1/boats/:id/repair` ([apps/game-engine/src/api/marina.ts:583-662](../../../apps/game-engine/src/api/marina.ts#L583-L662))
- Supprimer `computeRepairCost` ([apps/game-engine/src/api/marina.helpers.ts:47-66](../../../apps/game-engine/src/api/marina.helpers.ts#L47-L66))
- Supprimer la section `maintenance` (tarifs et multiplicateurs de réparation) de [packages/game-balance/game-balance.json:149-165](../../../packages/game-balance/game-balance.json#L149-L165)
- Synchroniser la suppression sur le duplicata [apps/web/public/data/game-balance.json](../../../apps/web/public/data/game-balance.json)

**Reset automatique au départ de course**

Au moment où un joueur s'inscrit à une course ET franchit le coup d'envoi (à préciser dans le plan selon le flow d'inscription actuel), réinitialiser :

```
boat.conditions = {
  hull: 100,
  rig: 100,
  sails: 100,
  foils: 100,         // si applicable
  electronics: 100
}
```

Pas de coût, pas de temps d'indispo, pas de dépendance aux crédits.

**Cap plancher**

Conserver le cap `condition >= 35` comme plancher physique (évite les valeurs négatives en cas de bug simulateur ou de conditions extrêmes prolongées). En pratique, avec la nouvelle courbe, seul un bateau **maximum PROTO restant 3 mois en zone cyclonique** pourrait s'en approcher. Aucune conséquence fonctionnelle au-delà de 35 — la pénalité reste à 8%.

### 5. UI

**Marina — inventaire**

- Retirer le bouton « Réparer » sur chaque composant
- Retirer l'affichage des coûts de réparation
- Ajouter une **info-card permanente** en haut de l'écran inventaire :

  > « Votre bateau est automatiquement remis en état au départ de chaque course. L'usure pendant une course est récupérée à l'arrivée. »

- Conserver l'affichage des barres de condition (utile pour visualiser l'effet des setups)

**En course — HUD / panneau bateau**

- Conserver l'affichage des barres d'usure par composant
- Ajouter un **tooltip ou encart explicatif** (premier survol OU aide contextuelle) :

  > « Un bateau usé navigue plus lentement. Évitez les conditions extrêmes (vent fort, grosse houle) pour préserver vos performances. »

- Afficher la **pénalité de vitesse actuelle** en temps réel, calculée depuis `conditionAvg` :

  > « Pénalité de vitesse : -2.3% »

  Placée à proximité des barres d'usure, pour que le joueur comprenne le coût immédiat de ses choix tactiques.

**Dev simulator**

- Adapter la visualisation existante des wear bars pour refléter la nouvelle formule (moyenne pondérée au lieu du min)
- Mettre à jour les presets/exemples si affectés par la nouvelle courbe de taux

## Impacts code

### Fichiers à modifier

- [packages/game-engine-core/src/wear.ts](../../../packages/game-engine-core/src/wear.ts)
  - `conditionSpeedPenalty()` : remplacer `min()` par moyenne pondérée
  - `computeWearDelta()` : nouveaux taux de base + nouveaux multiplicateurs vent/houle
  - Gestion du cas `foils` pour boats foilers
- [packages/game-balance/game-balance.json](../../../packages/game-balance/game-balance.json)
  - Section `wear` : nouveaux taux et courbes
  - Section `maintenance` : **suppression**
- [apps/web/public/data/game-balance.json](../../../apps/web/public/data/game-balance.json)
  - Même modifications (sauf le bloc `swell` qui reste divergent par décision antérieure)
- [apps/game-engine/src/api/marina.ts](../../../apps/game-engine/src/api/marina.ts)
  - Supprimer route `/repair`
  - Ajouter logique de reset conditions au départ de course (à localiser selon le flow d'inscription — peut vivre dans le handler d'inscription ou dans le tick engine au démarrage de course)
- [apps/game-engine/src/api/marina.helpers.ts](../../../apps/game-engine/src/api/marina.helpers.ts)
  - Supprimer `computeRepairCost`
- UI Marina inventaire : retirer les contrôles de réparation, ajouter l'info-card
- UI en course : ajouter tooltip et affichage de la pénalité en temps réel

### Fichiers à inspecter pour dépendances

- Tests du moteur de simulation qui asserttent les valeurs actuelles d'usure
- Composants Marina qui consomment `computeRepairCost` ou l'endpoint `/repair`
- Écran de fin de course / historique — vérifier que la "condition en fin de course" reste affichée (statistique intéressante pour le joueur) même si elle est reset juste après

## Hors scope

- **Reprise d'une course en cours** : pas de recalcul rétroactif de l'usure sur les courses en cours au moment du déploiement. À trancher au moment du plan : soit on laisse les courses existantes terminer avec l'ancienne formule, soit on force un reset au déploiement (recommandation : garder l'ancienne formule pour les courses en cours, appliquer la nouvelle aux courses démarrées après le déploiement).
- **Casse / abandon** : explicitement non-inclus. Le jeu conserve son principe "tout le monde finit".
- **Économie alternative** (consommables, services payants autres) : pas de remplacement du sink « réparation » par autre chose — les crédits gagnés doivent pouvoir servir entièrement aux upgrades.
- **Rééquilibrage des coûts d'upgrades** : hors scope de cette refonte. Si la suppression du sink réparation crée une inflation de crédits chez les joueurs, rééquilibrage à traiter dans une initiative dédiée.

## Critères de succès

1. **Lisibilité** : un joueur comprend pourquoi son bateau est pénalisé en regardant l'UI (tooltip + pénalité chiffrée en temps réel).
2. **Différenciation** : sur une course de 3 mois, deux profils de jeu (prudent vs agressif) finissent avec un écart mesurable de condition (~25 points) et de pénalité vitesse (~5-6%).
3. **Zéro usure en mer calme** : une simulation Méditerranée TWS < 10 kt, Hs < 1 m pendant 7 jours n'use le bateau d'aucun point.
4. **Suppression du sink crédits** : les crédits gagnés par le joueur ne sont plus consommés par la maintenance.
5. **Couverture tests** : tests unitaires sur la nouvelle formule de pénalité, sur la fonction d'usure conditionnelle, et sur le reset automatique au départ de course.
