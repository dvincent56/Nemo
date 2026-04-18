# Ligne de projection — Spec design

## Résumé

Afficher en permanence sur la carte une ligne de projection montrant la trajectoire prévue du bateau sur 7 jours, fidèle à la programmation du joueur, aux conditions météo prévues, aux upgrades, à l'usure progressive et aux pénalités de manoeuvre.

## Architecture de calcul

### Web Worker — pas adaptatif

Un Web Worker dédié (`projection.worker.ts`) calcule la trajectoire projetée avec un pas variable :

| Plage temporelle | Pas        | Itérations |
|------------------|------------|------------|
| 0 → 3h           | 30s        | ~360       |
| 3h → 24h         | 5min       | ~252       |
| 24h → 7j         | 15min      | ~576       |
| **Total**         |            | **~1 188** |

À chaque transition de segment programmé, le Worker force un calcul exact au point de transition (pas de skip).

### Entrées du Worker

Transmises via `postMessage` (ArrayBuffer Transferable pour les données volumineuses) :

- **Position actuelle** : lat, lon, hdg
- **Timestamp actuel**
- **Segments programmés** : liste ordonnée d'ordres (type CAP/TWA/SAIL/MODE, valeur, conditions)
- **Polaire(s)** : table(s) TWA×TWS→BSP du bateau (par voile quand disponible)
- **Upgrades agrégés** : `AggregatedEffects` (speedByTwa[5], speedByTws[3], maneuverMul, wearMul)
- **État d'usure actuel** : hull, rig, sails, electronics (0-100)
- **Voile active**
- **Grille vent GRIB** : ArrayBuffer des données météo couvrant les 7 jours
- **État de manoeuvre en cours** : si un tack/gybe/changement de voile est en cours au moment du calcul

### Chaîne de calcul par itération

À chaque pas, le Worker reproduit la logique de `tick.ts` :

1. **Interpolation vent** — bilinéaire spatiale + linéaire temporelle entre timesteps GRIB → TWS, TWD à la position/temps projeté
2. **Calcul TWA** — à partir du cap (ou TWA lock) et du TWD interpolé
3. **Lookup polaire** — TWA × TWS → BSP de base (polaire de la voile active)
4. **Multiplicateur upgrades** — `speedByTwa[band]` × `speedByTws[band]`
5. **Pénalité d'usure** — `conditionSpeedPenalty()` sur l'état d'usure courant (qui se dégrade au fil de la projection)
6. **Pénalité de manoeuvre** — si une transition de segment déclenche un tack/gybe ou un changement de voile, appliquer le facteur de vitesse réduit pendant la durée configurée (GameBalance.maneuvers × loadoutEffects.maneuverMul)
7. **BSP finale** = polaire × upgrades × usure × manoeuvre
8. **Avance position** — `advancePosition(lat, lon, hdg, bsp, dt)` via formule haversine/rhumb
9. **Usure progressive** — `computeWearDelta()` avec le vent/houle interpolés, soustraire du state d'usure courant

### Gestion des segments programmés

- Le Worker parcourt la liste des segments dans l'ordre
- À chaque pas, il vérifie si les conditions de transition du segment courant sont remplies (timestamp, position, etc.)
- Si transition → appliquer le nouvel ordre (nouveau cap, nouvelle voile, TWA lock on/off)
- Détecter tack/gybe (changement de signe du TWA) et déclencher la pénalité de manoeuvre
- Détecter changement de voile et déclencher la pénalité de transition voile
- Après le dernier segment programmé, prolonger en ligne droite (cap constant) jusqu'à la fin des 7 jours

### Sortie du Worker

Retournée via `postMessage` :

```typescript
interface ProjectionResult {
  // Points de la trajectoire
  points: Array<{
    lat: number;
    lon: number;
    timestamp: number;
    bsp: number;       // pour le gradient de couleur
    tws: number;
    twd: number;
  }>;
  // Indices dans points[] des marqueurs temporels
  timeMarkers: Array<{
    index: number;
    label: string;     // "1h", "2h", "3h", "6h", "12h", "24h", "48h", "72h", "96h", "120h", "144h", "168h"
  }>;
  // Indices dans points[] des marqueurs de manoeuvre
  maneuverMarkers: Array<{
    index: number;
    type: 'tack' | 'gybe' | 'sail_change' | 'cap_change' | 'twa_change';
    detail: string;    // ex: "CAP 270° → TWA -120°", "Voile: GEN → SPI"
  }>;
  // BSP max de la polaire (pour normaliser le gradient)
  bspMax: number;
}
```

### Déclencheurs de recalcul

| Événement                          | Debounce |
|------------------------------------|----------|
| Changement de cap (drag slider)    | 100ms    |
| Toggle TWA lock                    | immédiat |
| Changement de voile                | immédiat |
| Segment programmé ajouté/modifié/supprimé | immédiat |
| Tick serveur (nouvelles données)   | immédiat |
| Nouvelles données GRIB chargées    | immédiat |

### Transfert des données vent

- Au lancement du Worker : envoi de la grille GRIB complète via Transferable (ArrayBuffer)
- Quand de nouvelles données GRIB arrivent : renvoi au Worker + déclenchement recalcul
- La table polaire est envoyée une fois au init (ne change pas en cours de course)
- Les upgrades et l'état d'usure sont envoyés à chaque recalcul

## Rendu MapLibre

### 3 layers superposés

#### 1. `projection-line` — La ligne de trajectoire

- Source : GeoJSON LineString avec les ~1 188 points
- Style : `line` avec dasharray (pointillés) pour la différencier du trail passé (trait plein)
- Couleur : data-driven styling avec `interpolate` sur la propriété `bsp`
- Gradient continu normalisé sur le % de BSP max polaire :
  - 0-20% → Rouge `#c0392b` (pétole)
  - 20-50% → Orange `#e67e22` (vitesse faible)
  - 50-75% → Jaune `#f1c40f` (vitesse moyenne)
  - 75-100%+ → Vert `#27ae60` (bonne vitesse)
- Largeur : 2-3px
- Opacité : 0.8

#### 2. `projection-markers-time` — Marqueurs temporels

- Source : GeoJSON Points aux 12 positions temporelles
- Marqueurs à : 1h, 2h, 3h, 6h, 12h, 24h, 48h, 72h, 96h, 120h, 144h, 168h
- Style : cercle (radius 4-5px), couleur ivory `#f5f0e8` avec bordure navy `#1a2744`
- Label texte permanent (ex: "6h", "24h") au-dessus du marqueur
- Aucune interaction (pas de hover/clic)

#### 3. `projection-markers-maneuver` — Marqueurs de manoeuvre

- Source : GeoJSON Points à chaque transition de segment programmé
- Style : losange (rotation 45° d'un carré), couleur gold `#c9a84c` avec bordure blanche
- **Desktop** : tooltip au hover affichant le détail de la manoeuvre
- **Mobile** : tooltip toggle au clic/re-clic
- Contenu tooltip :
  - Type de manoeuvre (changement de cap, TWA lock, changement de voile)
  - Valeurs avant → après
  - Voile active à ce point

### Mise à jour des sources

Les 3 sources GeoJSON sont mises à jour via `source.setData()` à chaque recalcul du Worker. Pas de suppression/recréation de layers — les layers sont créés une fois au init de la carte.

## Intégration code

### Nouveaux fichiers

- `apps/web/src/workers/projection.worker.ts` — Web Worker avec la boucle de calcul
- `apps/web/src/hooks/useProjectionLine.ts` — hook React qui instancie le Worker, gère les inputs/outputs, met à jour les sources MapLibre

### Fichiers modifiés

- `apps/web/src/components/play/MapCanvas.tsx` — ajout des 3 layers/sources MapLibre au init, appel du hook `useProjectionLine`
- `apps/web/src/lib/store/` — exposer les segments programmés si pas déjà dans le store

### Pas de nouveau composant React visible

Tout le rendu passe par les layers MapLibre natifs. Le tooltip des marqueurs de manoeuvre utilise le Popup MapLibre.

## Visibilité

- La ligne de projection est **toujours visible** en jeu
- Affichée uniquement pour le bateau du joueur (pas les adversaires)

## Dépendances

- **Polaires par voile** : en cours d'implémentation en parallèle. La projection utilisera la polaire de la voile active. En attendant, elle utilise la polaire unique par classe de bateau.
- **Retrait driveMode** : le multiplicateur `driveModeMultipliers` dans `wear.ts` sera retiré (hors scope projection). La projection ne l'intègre pas.

## Limites connues

- La projection montre "si tu ne changes rien" — elle ne peut pas anticiper les actions futures du joueur
- La précision diminue au-delà de 3j car le pas passe à 15min et les prévisions météo sont elles-mêmes moins fiables
- Si les données GRIB ne couvrent pas les 7 jours complets, la projection s'arrête à la fin des données disponibles
