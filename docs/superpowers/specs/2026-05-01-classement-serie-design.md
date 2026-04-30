# Classement Série — Design

**Date :** 2026-05-01
**Statut :** Spec validée, prêt pour plan d'implémentation

## Contexte et motivation

Project Nemo applique une règle anti-P2W stricte : les abonnés Carrière débloquent des upgrades de bateau (foils, voiles, quille…), et un joueur non-payant court avec la config de base. Pour préserver l'intérêt sportif côté joueurs gratuits et offrir aux abonnés Carrière un mode de jeu "à armes égales", on introduit un **classement Série** : un classement parallèle qui ne prend en compte que les performances réalisées avec un bateau strictement au défaut (zéro option).

Référence sport réel : équivalent du classement "Monotype" / "Stock" en voile compétitive, où le bateau doit être tel que livré.

## Définitions

- **Config Série** : un bateau dont **tous** les slots `seriesRelevantSlots` (définis dans `game-balance.json`) sont équipés du upgrade par défaut — exactement le bateau dont dispose un joueur non-payant à la création de compte.
- **Résultat Série** : un résultat de course finie où le bateau du joueur était en config Série au start ET au finish.
- **Score Open** : score ELO calculé sur l'ensemble des résultats de course du joueur, toutes configs confondues. C'est le score principal (existant aujourd'hui).
- **Score Série** : score ELO calculé selon la **même formule** que le score Open, mais uniquement sur les résultats Série du joueur.

## Modèle de données

### `game-balance.json`

Ajouter une clé racine :

```json
{
  "seriesRelevantSlots": ["sails", "foils", "keel", "hull", "electronics"]
}
```

La liste des slots considérés "gameplay" pour l'éligibilité Série vit dans `game-balance.json` (et son duplicat `apps/web/public/data/game-balance.json`). Les slots cosmétiques (livrée, nom, etc.) ne sont pas dans cette liste — un joueur peut avoir une livrée payante sans perdre son éligibilité Série.

Le upgrade "défaut" pour chaque slot est celui que possède un joueur non-payant à la création — déjà défini par le système d'upgrades existant.

### Table `users` — score global toutes classes confondues

Le classement général a un filtre Classe avec une option **"Toutes"** par défaut. Pour ce cas (toutes classes confondues), conserver un score global sur `users` :

- `rankingScore` (existant) — score Open global toutes classes confondues.
- `rankingScoreSeries` (à ajouter) — score Série global toutes classes confondues.
- `racesFinishedSeries` (à ajouter) — compteur de courses finies en config Série, toutes classes confondues. Utilisé pour filtrer "joueurs éligibles Série" dans le classement global.

### Table `player_class_stats` (à créer dans le scope de cette feature)

Cette table était déjà au backlog côté backend (gap schéma identifié). Elle stocke par couple `(player, boatClass)` les stats spécifiques à cette classe. Elle est créée ici avec les colonnes nécessaires au classement Série dès le départ :

```ts
{
  playerId: uuid,
  boatClass: BoatClass,
  score: integer,           // ELO Open pour cette classe
  scoreSeries: integer,     // ELO Série pour cette classe
  racesFinished: integer,
  racesFinishedSeries: integer,  // courses finies en config Série dans cette classe
  // … autres colonnes du scope player_class_stats si pertinent
}
```

Clé primaire composite `(playerId, boatClass)`. Index sur `(boatClass, score DESC)` et `(boatClass, scoreSeries DESC)` pour la pagination du classement par classe.

**Sélection de la source au classement** : le service de lecture choisit la source selon le filtre Classe :
- `class=all` → lit `users.rankingScore` ou `users.rankingScoreSeries`.
- `class=<BoatClass>` → lit `player_class_stats.score` ou `player_class_stats.scoreSeries` filtré sur cette classe.

### Table de résultats de course

Ajouter sur la table existante des résultats par course une colonne :

```ts
wasSeriesConfig: boolean    // false par défaut
```

Renseignée à la fin de la course pour chaque finisher (voir Logique de fin de course ci-dessous).

## Logique de fin de course

Côté `apps/game-engine`, lorsqu'un joueur passe la ligne d'arrivée :

1. **Snapshot config au start** — déjà disponible (ou à conserver) : la config du bateau au moment où la course a démarré pour ce joueur.
2. **Évaluation au finish** :
   - Charger la config courante du bateau du joueur.
   - Pour chaque slot listé dans `game-balance.seriesRelevantSlots`, vérifier qu'il est équipé du upgrade défaut.
   - Comparer aux mêmes slots dans le snapshot start.
   - `wasSeriesConfig = true` ssi **start ET finish** sont en config Série pour tous les slots concernés.
3. **Persistance du résultat** — écrire la ligne de résultat avec `wasSeriesConfig`.
4. **Mise à jour des scores** :
   - Dans `player_class_stats` pour la classe de la course :
     - `score` : toujours mis à jour (ELO Open recalculé pour tous les finishers).
     - `scoreSeries` : mis à jour **uniquement si** `wasSeriesConfig === true`. La même formule ELO est appliquée mais sur le pool restreint des adversaires Série.
   - Dans `users` (global toutes classes confondues) :
     - `rankingScore` : recalculé selon la même formule, sur le pool global toutes classes.
     - `rankingScoreSeries` : recalculé ssi `wasSeriesConfig === true`, sur le pool global Série toutes classes.
5. **Compteurs** : `racesFinished` (par classe et global) toujours incrémentés ; `racesFinishedSeries` (par classe et global) incrémentés ssi `wasSeriesConfig === true`.

Garde-fou anti-triche : la double vérification start/finish empêche un joueur d'équiper une option pendant la course pour gagner de la perf puis de la retirer juste avant le finish.

## Migration / Backfill

**Pas de backfill.** Au déploiement :
- `users.rankingScoreSeries` initialisé à la valeur ELO de placement neutre (ex. 1500) pour tous les joueurs ; `users.racesFinishedSeries` à 0.
- `player_class_stats.score`/`scoreSeries` partent également de la valeur de placement neutre lorsque la ligne est créée (création paresseuse à la première course finie dans la classe).
- Les résultats de course existants ne sont pas réévalués pour `wasSeriesConfig` (l'info de config peut ne pas avoir été conservée historiquement).
- Le classement Série démarre vide et se remplit au fil des courses post-déploiement.
- Annonce explicite aux joueurs : "Saison 1 du classement Série".

## API

### Endpoints classement général

Sur les endpoints de lecture du classement (à scoper précisément lors du plan d'implémentation), ajouter un query param :

```
GET /api/ranking?class={BoatClass|all}&scope={general|friends|team|city|...}&config={all|series}
```

- `config=all` (défaut) → tri par `score`.
- `config=series` → tri par `scoreSeries`, et filtrage des joueurs avec `racesFinishedSeries > 0`.

### Endpoint classement de course en jeu

Le `RankingPanel` côté play utilise déjà un endpoint (ou une alimentation temps réel) pour la liste des bateaux en course. Ajouter un query param ou un champ dérivé :

```
config: 'all' | 'series'
```

Quand `series`, le serveur renvoie uniquement les bateaux dont la config courante (à l'instant de la requête) est strictement en config Série. Si la config courante d'un bateau n'est pas accessible côté backend ranking, le filtrage peut se faire côté client à partir des données de bateau déjà transmises — décision technique à prendre lors du plan.

## UI

### Classement général (mockup `mockups/classement-v1.html`)

Ajouter un troisième groupe de filtres entre "Périmètre" et la liste, en suivant le pattern existant `.filter-group` / `.filter-tab` :

```html
<div class="filter-group">
  <p class="filter-label">Configuration</p>
  <button class="filter-tab active">Toutes</button>
  <button class="filter-tab">Série</button>
</div>
```

Combinable avec les deux groupes existants. Tous les classements (Toutes les classes × Toutes les zones × Toutes/Série) sont calculables.

Sous l'onglet **Série**, un sous-titre indique le nombre de skippers éligibles (≥ 1 résultat Série) :

> Classement Série · 1 247 skippers éligibles

### Classement de course en jeu (`apps/web/src/components/play/RankingPanel.tsx`)

Ajouter une option dans le `<select>` existant, après les options de périmètre, séparée par un séparateur visuel :

```tsx
<select>
  <option value="general">Général · {N} skippers</option>
  <option value="friends">Mes amis</option>
  <option value="team">Mon équipe</option>
  <option value="city">Ma ville</option>
  <option value="country">Mon pays</option>
  <option disabled>──────</option>
  <option value="series">Série · {N} skippers</option>
</select>
```

Comportement : quand `series` est sélectionné, la liste affiche uniquement les bateaux en config Série à l'instant courant. Mutuellement exclusif avec les autres options (un seul filtre actif — comportement actuel inchangé).

Pas de mockup HTML séparé pour le `RankingPanel` : le composant existe déjà en code, le changement se fait directement à l'intégration.

## Tests

Critères de succès (à détailler en cas tests dans le plan) :

- Un joueur qui finit une course en config 100 % stock voit son `wasSeriesConfig` passer à `true` et son `scoreSeries` mis à jour.
- Un joueur qui équipe une option en cours de course (start stock, finish non-stock) a `wasSeriesConfig = false`.
- Un joueur en config stock au finish mais qui avait une option au start a `wasSeriesConfig = false`.
- Le classement général filtré sur `config=series` n'inclut que les joueurs avec `racesFinishedSeries > 0` et trie par `scoreSeries` (sur `users` quand `class=all`, sur `player_class_stats` quand une classe est filtrée).
- Le classement de course filtré sur `series` n'affiche que les bateaux dont la config courante est strictement défaut sur tous les slots `seriesRelevantSlots`.
- Combinaison Classe × Périmètre × Configuration sur le classement général renvoie le sous-ensemble correct.

## Hors scope

- Modification de la formule ELO (la même formule s'applique au pool Open et au pool Série).
- Récompenses/badges dédiés au classement Série (peut faire l'objet d'une feature ultérieure).
- Mode de course "Série uniquement" où les options seraient interdites à l'inscription (correspondrait à l'option D du brainstorming initial — non retenue ici).
- Backfill historique des résultats existants.
