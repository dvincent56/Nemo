# Spec — Refonte écran Play (en course)

> **Date** : 2026-04-17
> **Statut** : Validé (brainstorming)
> **Mockup de référence** : `mockups/play-v1.html` (direction Nautical Luxury)

---

## 1. Contexte

L'écran `/play/[raceId]` est le cœur du jeu Nemo. Le moteur backend est complet (tick loop 30s, ordres, voiles, broadcast WebSocket MessagePack). Les composants frontend existent (Compass, HudBar, SailPanel, MapCanvas) mais doivent être refondus pour coller au design Nautical Luxury et intégrer les fonctionnalités manquantes.

**Approche retenue** : Store Zustand enrichi + layout global d'abord, puis composants branchés dessus (approche B).

---

## 2. Cibles et contraintes

| Contrainte | Valeur |
|---|---|
| Support principal | Desktop + tablette paysage (≥ 768px landscape) |
| Portrait mobile | Mode dégradé fonctionnel si possible, sinon message "tournez votre écran" |
| Palette | Nautical Luxury — navy (#1a2840), ivory (#f5f0e8), gold (#c9a227) |
| Typographie | Bebas Neue (display), Space Grotesk (body), Space Mono (mono) |
| Cardinalité | N/E/S/O (français) |
| Raccourcis clavier | Oui, avec tooltips au hover sur chaque élément interactif |
| Accessibilité | Targets tactiles ≥ 44px, aria-labels, keyboard navigable |

---

## 3. Layout global

Grille CSS 3 rangées fixes, identique au mockup `play-v1.html` :

```
┌──────────────────────────────────────────────────┐
│  HUD Top — 56px fixe                    z:30     │
├──────────────────────────────────────────────────┤
│                                                  │
│  Map Area — flex 1fr                    z:1      │
│                                                  │
│  ┌─────┐                         ┌────────────┐ │
│  │Rank │                         │ Right stack│ │
│  │Tab  │                         │ Btns+Comp. │ │
│  │z:20 │                         │ z:20       │ │
│  └─────┘                         └────────────┘ │
│                                                  │
│  ┌───────────┐   ┌──────────┐                    │
│  │WindLegend │   │ Coords   │                    │
│  │z:15       │   │ z:10     │                    │
│  ├───────────┤   └──────────┘                    │
│  │Layers     │                                   │
│  │z:15       │                                   │
│  └───────────┘                                   │
├──────────────────────────────────────────────────┤
│  Weather Timeline — 64px fixe           z:30     │
└──────────────────────────────────────────────────┘
```

### Éléments superposés (dans la Map Area)

| Élément | Position | z-index |
|---|---|---|
| WeatherOverlays (vent/houle) | Plein écran sur carte | 2-3 |
| BoatRenderer (bateaux) | Sur carte | 4-5 |
| TraceLayer (traces + projections) | Sur carte | 3-4 |
| CoordsDisplay | Top-gauche | 10 |
| WindLegend | Bas-gauche (au-dessus de Layers) | 15 |
| LayersWidget | Bas-gauche | 15 |
| Ranking tab | Milieu-gauche | 20 |
| Right stack (btns + compass) | Bas-droite | 20 |
| Slide-out panels | Gauche ou droite | 25-28 |
| BoatInfoOverlay | Près du bateau cliqué | 30 |

### Panneaux slide-out — un seul à la fois

| Panneau | Côté | Largeur | Hotkey |
|---|---|---|---|
| RankingPanel | Gauche | 320px | C |
| SailPanel | Droite | 420px | V |
| ProgPanel | Droite | 420px | P |

Ouvrir un panneau ferme automatiquement tout autre panneau ouvert. `Echap` ferme le panneau actif.

---

## 4. Architecture Store Zustand

Le store est découpé en slices indépendants.

### 4.1 hudSlice (enrichi depuis l'existant)

```typescript
tws: number;  twd: number;  twa: number;  hdg: number;
bsp: number;  vmg: number;  dtf: number;  overlapFactor: number;
twaColor: 'optimal' | 'overlap' | 'neutral' | 'deadzone';
rank: number;  totalParticipants: number;  rankTrend: number;
wearGlobal: number; // 0-100, moyenne des 4
wearDetail: { hull: number; rig: number; sails: number; electronics: number };
```

### 4.2 sailSlice (enrichi)

```typescript
currentSail: SailId;
sailPending: SailId | null;
transitionRemainingSec: number;
sailAuto: boolean;
sailAvailability: Record<SailId, 'active' | 'available' | 'disabled'>;
```

### 4.3 mapSlice (nouveau)

```typescript
center: [lon: number, lat: number];
zoom: number;
isFollowingBoat: boolean; // désactivé au pan manuel, réactivé via bouton Centrer
```

### 4.4 selectionSlice (nouveau)

```typescript
selectedBoatIds: Set<string>;
editMode: boolean; // activé par clic compass / édition prog
toggleBoat(id: string): void;
clearSelection(): void; // clic sur mon bateau = reset
setEditMode(active: boolean): void;
```

### 4.5 timelineSlice (nouveau)

```typescript
currentTime: Date;
isLive: boolean;
playbackSpeed: 1 | 6 | 24;
setTime(t: Date): void;
goLive(): void;
play(): void;  pause(): void;
stepForward(): void;  stepBack(): void;
```

Comportement :
- Passé : bateaux repositionnés + météo à l'instant T
- Futur : météo seule, bateaux figés à leur position actuelle
- Drag du scrubber → `isLive = false`
- Bouton Live ou hotkey `L` → `goLive()`

### 4.6 layersSlice (nouveau)

```typescript
wind: boolean;    // défaut true
swell: boolean;   // défaut false
opponents: boolean; // défaut true
zones: boolean;   // défaut true
toggleLayer(layer: 'wind' | 'swell' | 'opponents' | 'zones'): void;
```

Invariant : `wind && swell` ne peuvent pas être `true` simultanément. Activer l'un désactive l'autre.

### 4.7 panelSlice (nouveau)

```typescript
activePanel: 'ranking' | 'sails' | 'programming' | null;
openPanel(p: 'ranking' | 'sails' | 'programming'): void;
closePanel(): void;
```

`openPanel` ferme automatiquement le panneau précédent.

### 4.8 weatherSlice (nouveau)

```typescript
gridData: WeatherGrid | null;
gridExpiresAt: Date;
isLoading: boolean;
fetchGrid(bounds: BBox, horizon: string): Promise<void>;
interpolateAt(lat: number, lon: number, time: Date): {
  tws: number; twd: number; swellHeight: number; swellDir: number;
};
```

Cache valide 6h, refresh automatique.

### 4.9 connectionSlice (existant, inchangé)

```typescript
wsState: 'idle' | 'connecting' | 'open' | 'closed' | 'error';
connectRace(raceId: string, token?: string): void;
sendOrder(payload: OrderPayload): boolean;
```

### 4.10 progSlice (nouveau)

```typescript
orderQueue: OrderEntry[];  // file d'ordres en édition
serverQueue: OrderEntry[]; // file d'ordres validée côté serveur (pour projection de référence)
addOrder(order: OrderEntry): void;
removeOrder(id: string): void;
reorderQueue(from: number, to: number): void;
commitQueue(): void; // envoie au serveur, serverQueue = orderQueue
```

### Interactions critiques entre slices

- `panelSlice.openPanel('programming')` → `selectionSlice.editMode = true`
- Clic/drag compass → `selectionSlice.editMode = true`
- `editMode = true` → TraceLayer affiche double projection (serverQueue vs orderQueue)
- `editMode = false` → projections disparaissent
- `layersSlice.toggleLayer('swell')` → force `wind = false`
- `layersSlice.toggleLayer('wind')` → force `swell = false`
- `timelineSlice` futur → seul WeatherOverlay réagit (bateaux figés)
- `timelineSlice` passé → BoatRenderer repositionne mon bateau + sélectionnés

---

## 5. Composants — Spec détaillée

### 5.1 Compass (T1)

**Position** : bas-droite, dans le right-stack, ~280px.
**Rôle** : contrôle principal du cap.

**Éléments visuels :**
- Rose des vents avec graduations 10° + labels cardinaux (N/E/S/O)
- Silhouette du bateau (SVG vue de dessus, couleur principale du bateau) orientée selon le cap
- Flèche vent à l'extérieur du cercle indiquant d'où vient le vent (label "O" pour ouest, etc.)
- Hub central avec valeur du cap en degrés
- 4 readouts au-dessus : Vit. bateau (BSP), Vent local (TWS), Cap (HDG), TWA

**2 modes de lock :**
- **CAP** (défaut) : cap fixe absolu
- **LOCK TWA** : angle relatif au vent, le cap s'ajuste quand le vent tourne

**Boutons :**
- 🔒 TWA : toggle lock TWA (hotkey T)
- Appliquer : valide le cap (hotkey Entrée). Grisé tant que le cap n'est pas modifié.

**Mode édition (drag en cours) :**
- `editMode = true` dans le store → projection future sur la carte
- Ghost pointillé de l'ancienne position du bateau
- Silhouette gold au nouveau cap cible
- Readouts passent en mode "▸ CIBLE / ▸ ESTIMÉ"
- Si le nouveau cap implique un changement de voile (mode auto) → notification sous le compass : "Changement de voile auto : GEN → SPI"
- Bouton Appliquer devient gold actif avec la valeur "✓ Appliquer 243°"

**Feedback VMG :**
Quand le joueur navigue dans la zone VMG optimale → glow vert subtil autour du widget compass (box-shadow + bordure teintée). TWA passe en vert dans les readouts.

**Annulation :**
Echap ou clic hors compass avec un cap modifié non appliqué → modale de confirmation :
- Titre : "Cap non appliqué"
- Bouton primaire (gold) : "Continuer" (retour à l'édition)
- Bouton danger (rouge) : "Annuler" (perd les modifications)

**Technique :**
- SVG avec manipulation DOM directe pendant le drag (60fps, pas de re-render React)
- Pointer capture pour le drag rotatif
- Wheel event pour ±1° fine-tune

**Raccourcis :**
| Raccourci | Action |
|---|---|
| Drag | Modifier le cap |
| Molette | ±1° |
| T | Toggle Lock TWA |
| Entrée | Appliquer |
| Echap | Annuler (modale si modifié) |

### 5.2 SailPanel (T2)

**Position** : slide-out droit, 420px. Hotkey V.

**Structure :**
- Toggle Auto/Manuel en haut
- Bloc "Voile en cours" : SVG silhouette de la voile + nom + TWA range + durée d'utilisation
- Liste des 6 voiles (LW, JIB, GEN, C0, HG, SPI), chacune avec :
  - SVG silhouette de la voile (vue de profil)
  - Nom sous le SVG
  - Description courte
  - TWA range
  - État : active (gold) / disponible / hors plage (grisée) / en transition (timer)

**Feedback mauvaise voile (mode manuel) :**
Bandeau d'alerte en haut du panneau si le joueur navigue avec une voile non optimale pour son TWA. Indicateur aussi sur le bouton Voiles du right-stack.

**Interaction :**
- Clic sur une voile disponible → confirmation rapide "Changer pour GEN ?" → `sendOrder({ type: 'SAIL' })`
- Changement impossible pendant une transition en cours (timer bloquant)

### 5.3 ProgPanel (T2)

**Position** : slide-out droit, 420px. Hotkey P.

**Structure :**
- Tabs : Cap / Waypoints / Voiles
- Formulaire d'ajout selon le tab :
  - Cap : cap cible + trigger (immédiat / heure / waypoint / durée) + option Lock TWA
  - Waypoints : coordonnées lat/lon
  - Voiles : choix de voile + trigger
- Bouton "Ajouter à la file"
- File d'ordres : liste ordonnée, drag-to-reorder, bouton supprimer par ordre
- Footer : lien "Ouvrir le routeur" (Phase 4+)

**Mode édition + double projection :**
- Ouverture du panel → `editMode = true`
- **Projection de référence** (ordres serveur = `serverQueue`) : ligne pointillée ivoire semi-transparente
- **Projection de travail** (ordres en édition = `orderQueue`) : ligne pleine gold
- Chaque ajout/suppression/réordonnancement recalcule la projection de travail en temps réel
- Le joueur compare visuellement les deux routes
- Validation → `commitQueue()` : la projection de travail remplace la référence

**Fermeture :** `editMode = false`, projections disparaissent.

### 5.4 RankingPanel (T3)

**Position** : slide-out gauche, 320px. Hotkey C.

**Structure :**
- Barre de recherche en haut (rechercher par pseudo)
- Filtre dropdown : Général / Mes amis / Mon équipe / Ma ville / Département / Région / Pays
- Liste scrollable :
  - Position (numéro, gold pour podium top 3)
  - Pseudo + drapeau pays
  - DTF (distance to finish)
- Ma ligne : highlight gold, bordure gauche gold, épinglée en vue

**Interaction carte :**
- Clic sur un joueur → sélectionne son bateau sur la carte (trace passée visible)
- Recherche → sélectionne le bateau trouvé
- Sélection persiste même après fermeture du panel

**Mode spectateur :**
- Filtres réduits : Général + par pays uniquement
- Recherche disponible (même comportement : sélectionne le bateau sur la carte)
- Pas de toggle Adversaires

**Recherche :**
- Champ texte en haut du panel, recherche par pseudo (debounce 300ms)
- Résultats inline dans la liste (remplace temporairement le classement)
- Clic sur un résultat → sélectionne le bateau, ferme la recherche, revient au classement

### 5.5 WeatherTimeline (T3)

**Position** : barre fixe bas, 64px. Toujours visible.

**Structure :**
- Gauche : date/heure (J3 · 14h12 · 9 avr.)
- Centre : barre scrubber draggable, marqueurs 6h (majeurs) et 1h (mineurs)
- Droite : ◀ ▶ ▶▶ + vitesse (1× 6× 24×)

**Comportement directionnel :**
| Direction | Météo | Mon bateau | Bateaux sélectionnés |
|---|---|---|---|
| Passé | À l'instant T | Repositionné | Repositionnés |
| Futur | À l'instant T | Figé (position actuelle) | Figés |

**Plage :** début de course → horizon météo (7-10 jours futur).
**Marqueur "maintenant"** : trait gold distinctif sur la barre.
**Bouton Live / Hotkey L** : retour au temps réel.

### 5.6 LayersWidget (T3)

**Position** : flottant bas-gauche, ~180px.

**Toggles :**
| Layer | Défaut | Spectateur |
|---|---|---|
| Vent | ON | ON |
| Houle | OFF | OFF |
| Adversaires | ON | Non dispo (toujours ON) |
| Zones | ON | ON |

**Exclusion mutuelle** : Vent et Houle ne peuvent pas être actifs simultanément.

### 5.7 WindOverlay

- Particules animées WebGL (type Windy) suivant la direction du vent
- Couleur selon vitesse : vert (léger) → jaune → orange → rouge (fort)
- Librairie : `webgl-wind` ou équivalent compatible MapLibre
- Source : WeatherCache, interpolé au temps du scrubber timeline
- z-index : au-dessus de la carte, sous les bateaux

### 5.8 SwellOverlay

- Colormap (gradient) sur la grille selon la hauteur de houle
- Même source WeatherCache, même réactivité au scrubber
- z-index : même couche que WindOverlay (mutuellement exclusifs)

### 5.9 WindLegend

- Widget bas-gauche, au-dessus du LayersWidget
- Échelle de couleur gradient + valeurs min/max
- S'adapte : affiche "VENT 0·40 nds" ou "HOULE 0·6 m" selon le layer actif
- Masqué si vent et houle sont tous les deux OFF

### 5.10 BoatRenderer

**Mon bateau :**
- Silhouette SVG vue de dessus, couleur principale du bateau (customisation)
- 4 variantes : monocoque, monocoque+foils, multicoque, multicoque+foils
- Orienté selon le cap, plus gros que les adversaires, halo subtil
- Clic → reset toute la sélection (`clearSelection()`)

**Adversaires :**
- Même silhouettes SVG, couleur custom de chaque joueur, orientées selon leur cap
- Taille plus petite que mon bateau
- **Filtre côté serveur** : top X du classement + bateaux proches du joueur
- Filtre client via LayersWidget (toggle Adversaires)
- Clic → toggle sélection (multi-sélection possible)
- Clic → affiche BoatInfoOverlay

### 5.11 BoatInfoOverlay

- Card overlay positionnée près du bateau cliqué sur la carte
- Contenu : pseudo + drapeau, classe de bateau, cap, vitesse, rang, DTF
- Bouton "Voir le profil" → `/profile/[username]`
- Se ferme au clic ailleurs ou sur le X
- z-index : 30

### 5.12 TraceLayer

**Traces passées :**
- Ma trace : couleur principale de mon bateau, ligne pleine, toujours visible
- Traces des sélectionnés : couleur de chaque bateau, semi-transparente

**Projections (mode édition uniquement) :**
- Projection de référence (serverQueue) : ligne pointillée, couleur du bateau, semi-transparente
- Projection de travail (orderQueue) : ligne pleine gold
- Calculées localement : WeatherCache + polaires (polar-lib) + file d'ordres
- Recalculées en temps réel à chaque modification d'ordre

**Waypoints sur la route :**
- Points gold sur la route (portes, arrivée)
- Labels : "PORTE 1", "PORTE 2", "ARRIVÉE"

### 5.13 HudBar (T1)

**Position** : barre fixe top, 56px.

**Contenu gauche → droite :**
1. Brand NEMO
2. Nom de course + jour/heure
3. Rang hero (position/total + tendance ▲▼)
4. 7 stats : BSP, TWS, TWA, HDG, VMG, DTF, Factor (scroll horizontal si écran étroit)
5. Usure : icône + % global. Clic → tooltip avec 4 mini-jauges (hull/rig/sails/electronics)
6. Bouton Quitter → retour `/races` (confirmation si en course)

### 5.14 CoordsDisplay

- Widget top-gauche, fond semi-transparent
- Position GPS formatée : 47°23.41'N / 003°12.88'O
- Mise à jour en temps réel

### 5.15 SpectatorBanner

- Bandeau discret pour visiteurs non connectés
- "Vous êtes en mode spectateur — Connectez-vous pour participer"
- CTA vers `/login`

### 5.16 WeatherCache (service, non visuel)

- Télécharge la grille météo GRIB via `/api/v1/weather/grid?bounds=...&horizon=7d`
- Cache valide 6h, refresh automatique
- Expose `interpolateAt(lat, lon, time)` pour le WindOverlay, SwellOverlay et le calcul de projection
- Même données que le tick serveur → projection fidèle à la réalité

---

## 6. Raccourcis clavier globaux

| Raccourci | Action | Tooltip |
|---|---|---|
| V | Ouvrir/fermer Voiles | "Voiles — Gérer vos voiles (V)" |
| P | Ouvrir/fermer Programmation | "Programmation — Planifier vos ordres (P)" |
| C | Ouvrir/fermer Classement | "Classement (C)" |
| Espace | Recentrer carte sur mon bateau | "Recentrer (Espace)" |
| +/- | Zoom carte | "Zoom (+ / -)" |
| T | Toggle Lock TWA | "Verrouiller TWA (T)" |
| Entrée | Appliquer le cap | "Appliquer (Entrée)" |
| Echap | Fermer panneau / annuler édition | — |
| L | Revenir en mode Live (timeline) | "Live (L)" |

Chaque élément interactif affiche un tooltip au hover avec la description + le raccourci.

---

## 7. Mode spectateur

| Composant | Disponible | Restriction |
|---|---|---|
| MapCanvas | Oui | — |
| BoatRenderer | Oui | Top X uniquement |
| RankingPanel | Oui | Filtres réduits (Général + pays) |
| WeatherTimeline | Oui | — |
| Recherche bateau | Oui | — |
| WindOverlay / SwellOverlay | Oui | — |
| LayersWidget | Partiel | Pas de toggle Adversaires |
| SpectatorBanner | Oui | — |
| Compass | Non | — |
| SailPanel | Non | — |
| ProgPanel | Non | — |
| HudBar | Non | — |
| CoordsDisplay | Non | — |

---

## 8. Responsive

| Breakpoint | Comportement |
|---|---|
| ≥ 1100px | Layout complet, toutes les stats visibles |
| 860–1100px | Stats compactées, panels réduits (360px) |
| 768–860px (paysage) | HUD compact (brand + rang + stats scroll), panels plein largeur, compass centré |
| < 768px portrait | Message "Tournez votre écran" ou mode dégradé consultation |

---

## 9. Performance

- **Compass** : manipulation DOM directe SVG pendant le drag (60fps, pas de re-render React)
- **WindOverlay** : rendu WebGL (GPU), pas de DOM
- **BoatRenderer** : MapLibre symbols layer, pas de DOM par bateau
- **Projections** : calcul local via WeatherCache + polaires, recalcul à chaque modification
- **WebSocket** : binary MessagePack, singleton par course, reconnexion exponentielle
- **WeatherCache** : téléchargement unique ~quelques Mo, cache 6h
