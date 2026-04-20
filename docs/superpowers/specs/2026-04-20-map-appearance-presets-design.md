# Map Appearance Presets — Design Spec

**Date**: 2026-04-20
**Scope**: Écran `/play/[raceId]` — permettre au joueur de changer l'apparence visuelle de la carte (couleur d'océan + style de terre) via des presets.

## Contexte

Un panel de test avec des color pickers bruts avait été ajouté la veille pour valider le concept, puis retiré (non committé). L'idée s'est révélée utile : les joueurs aiment avoir la main sur le visuel, et une version "claire" aide la lisibilité selon l'environnement (soleil sur mobile notamment).

Cette nouvelle version remplace les color pickers libres par des **presets curés** : plus simple, toujours cohérent avec la direction Nautical Luxury, plus adapté au mobile.

## Objectif utilisateur

> En tant que joueur sur `/play`, je veux pouvoir choisir un fond de mer et un style de terre qui me conviennent, sans compromettre la lisibilité du jeu, et retrouver ma préférence au prochain chargement.

## Décisions validées

| # | Décision | Retenu |
|---|---|---|
| Q1 | Couplage ocean/terre | **Séparé** (une liste pour chaque) |
| Q2 | Mécanisme terre | **Swap de source de tuiles** (pas de filtres colorimétriques) |
| Q3 | Catalogue | 4 presets ocean + 4 presets terre |
| Q4 | Emplacement UI | Bouton dans **LayersWidget** qui ouvre une **modale** (compact sur mobile) |
| Q5 | Persistance | **localStorage** uniquement |
| Approche | État + render | Zustand store + `setPaintProperty` / swap source impératif |

## Architecture

### Modèle de données

Nouveau fichier `apps/web/src/lib/mapAppearance.ts` :

```ts
export type OceanPreset = {
  id: string;
  label: string;
  color: string; // hex
};

export type LandPreset = {
  id: string;
  label: string;
  tileUrl: string; // MapLibre tiles template
};

export const OCEAN_PRESETS: readonly OceanPreset[] = [
  { id: 'deep-night',  label: 'Nuit profonde', color: '#0a2035' },
  { id: 'royal-blue',  label: 'Bleu roi',      color: '#1a3a5c' },
  { id: 'glacier',     label: 'Bleu glacier',  color: '#c3d4e0' },
  { id: 'ivory',       label: 'Ivoire',        color: '#f5f0e8' },
] as const;

export const LAND_PRESETS: readonly LandPreset[] = [
  { id: 'dark',      label: 'Sombre',    tileUrl: 'https://basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}@2x.png' },
  { id: 'light',     label: 'Clair',     tileUrl: 'https://basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}@2x.png' },
  { id: 'pastel',    label: 'Pastel',    tileUrl: 'https://basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}@2x.png' },
  { id: 'contrast',  label: 'Contraste', tileUrl: 'https://basemaps.cartocdn.com/rastertiles/voyager_labels_under/{z}/{x}/{y}@2x.png' },
] as const;

export const DEFAULT_OCEAN_ID = 'deep-night';
export const DEFAULT_LAND_ID  = 'dark';
export const STORAGE_KEY      = 'nemo.mapAppearance';
```

### Store slice

Extension de `apps/web/src/lib/store.ts` :

```ts
mapAppearance: {
  oceanPresetId: string;
  landPresetId: string;
},
setOceanPreset: (id: string) => void,
setLandPreset:  (id: string) => void,
```

**Hydratation** : au moment de créer le store, lire `localStorage[STORAGE_KEY]` et valider les IDs contre les catalogues. ID invalide ou absent → fallback sur les defaults. Chaque setter écrit la nouvelle valeur dans localStorage (via `JSON.stringify`).

### Rendering (MapCanvas.tsx)

Deux `useEffect` indépendants s'abonnent au store.

**Ocean** (trivial) :

```ts
useEffect(() => useGameStore.subscribe((s) => {
  const map = mapRef.current;
  if (!map?.getLayer('background')) return;
  const preset = OCEAN_PRESETS.find(p => p.id === s.mapAppearance.oceanPresetId);
  if (preset) map.setPaintProperty('background', 'background-color', preset.color);
}), []);
```

**Terre** (swap de source raster) :

```ts
useEffect(() => useGameStore.subscribe((s) => {
  const map = mapRef.current;
  if (!map?.getSource('osm-tiles')) return;
  const preset = LAND_PRESETS.find(p => p.id === s.mapAppearance.landPresetId);
  if (!preset) return;
  map.removeLayer('dark-tiles');
  map.removeSource('osm-tiles');
  map.addSource('osm-tiles', { type: 'raster', tiles: [preset.tileUrl], tileSize: 256 });
  map.addLayer(
    { id: 'dark-tiles', type: 'raster', source: 'osm-tiles', paint: { 'raster-opacity': 0.6 } },
    'country-names',
  );
}), []);
```

Le `beforeId: 'country-names'` préserve l'ordre : les labels pays, trait de côte, zones, projection et bateau restent au-dessus des tuiles.

**Application initiale** : la constante `STYLE` dans `MapCanvas.tsx` doit lire les presets courants du store (oceanBg + landTileUrl) au moment de l'init du `Map`, pour éviter un flash entre le mount et le premier `useEffect`.

**Cas limites** :
- Map pas encore chargée → les effets vérifient `getSource('osm-tiles')` et `getLayer('background')` avant d'agir.
- Preset supprimé (après un déploiement qui retire un ID) → fallback default via la validation à l'hydratation.

### UI

#### 1. LayersWidget (modifié)

Sous la liste des couches existantes, une ligne cliquable compacte :

```
┌─────────────────────────┐
│ Couches                 │
│ ≋ Vent           [on]  │
│ ∿ Houle          [off] │
│ ⌇ Trait de côte  [off] │
│ ⊘ Zones          [on]  │
├─────────────────────────┤
│ 🎨 Apparence        ›   │
└─────────────────────────┘
```

Le clic pose un flag local `appearanceModalOpen` (useState dans LayersWidget) qui monte `<MapAppearanceModal />`.

#### 2. MapAppearanceModal (nouveau)

Modale centrée avec fond voilé (semi-transparent) :

```
┌──────────────────────────┐
│  Apparence           ✕   │
├──────────────────────────┤
│  Océan                   │
│   ●  ●  ●  ●             │  ← swatches 22px, border ivory/or si actif
│                          │
│  Terre                   │
│   [Sombre]  [Clair]      │  ← chips 2 colonnes
│   [Pastel]  [Contraste]  │
├──────────────────────────┤
│          [ Fermer ]      │
└──────────────────────────┘
```

**Comportement** :
- Chaque tap sur swatch/chip = appel immédiat du setter store (live preview).
- Fermeture : bouton **Fermer**, icône `✕`, ou clic sur le voile.
- Aucun bouton "Valider" — les choix sont déjà appliqués et persistés au moment du tap.

**Dimensions** :
- Desktop : largeur fixe ~320px, centrée.
- Mobile : `calc(100vw - 32px)`, padding réduit.
- Pas de scroll vertical — 4 + 4 presets tiennent largement.

**Style** : réutilise le pattern des confirm dialogs marina (voile, border ivoire/or, typo Cormorant pour le titre).

## Fichiers

| Fichier | Action | Rôle |
|---|---|---|
| `apps/web/src/lib/mapAppearance.ts` | nouveau | Catalogues + types + constantes |
| `apps/web/src/lib/store.ts` | modifié | Slice `mapAppearance` + setters + hydratation localStorage |
| `apps/web/src/components/play/LayersWidget.tsx` | modifié | +1 ligne "Apparence" + flag local modal |
| `apps/web/src/components/play/MapAppearanceModal.tsx` | nouveau | UI modale |
| `apps/web/src/components/play/MapAppearanceModal.module.css` | nouveau | Styles modale |
| `apps/web/src/components/play/MapCanvas.tsx` | modifié | 2 `useEffect` + init `STYLE` lisant le store |

**Contrats** :
- `mapAppearance.ts` : constantes figées, lu depuis n'importe où, pas de dépendance entrante.
- Modale : pas de props complexes (pas de `onChange`/`onClose` piped) — lit/écrit directement dans le store. LayersWidget contrôle seulement l'ouverture/fermeture.
- MapCanvas : ignore la modale, souscrit au store. Découplage total.

## Tests

### Unitaires (Vitest)

- `mapAppearance.spec.ts` :
  - IDs ocean uniques, IDs terre uniques.
  - Toutes les `color` matchent `/^#[0-9a-f]{6}$/i`.
  - Toutes les `tileUrl` matchent `/\{z\}.*\{x\}.*\{y\}/`.
  - `DEFAULT_OCEAN_ID` existe dans `OCEAN_PRESETS`, idem pour `DEFAULT_LAND_ID`.

- Store slice :
  - `setOceanPreset('royal-blue')` met à jour l'état ET écrit dans localStorage.
  - `setLandPreset('light')` idem.
  - Hydratation avec `localStorage[STORAGE_KEY]` valide → état correspondant.
  - Hydratation avec ID inconnu → fallback sur defaults, sans crash, sans écrasement immédiat du localStorage.

### Intégration

Non couverts automatiquement — MapLibre nécessite un canvas WebGL, difficile en jsdom.

### Vérification manuelle avant merge

- [ ] Ouvrir `/play/[raceId]` → ouvrir la modale → tester les 4×4 combinaisons.
- [ ] Aucun flash entre init et état persisté.
- [ ] Ordre des couches préservé : zones, projection, bateau toujours visibles au-dessus.
- [ ] Reload page → combinaison sélectionnée restaurée.
- [ ] Mode spectateur → bouton "Apparence" accessible.
- [ ] Mobile (DevTools responsive) → modale tient largeur écran, pas de scroll horizontal.

## Hors scope

- Pas de synchronisation backend (table `user_settings` — report Phase 4 selon mémoire projet).
- Pas de presets personnalisés (création de thèmes par l'utilisateur).
- Pas d'impact sur la mini-map (aucune mini-map à ce stade).
- Pas de rendu dynamique des labels pays selon le preset (ils restent en `rgba(180,190,210,0.55)` — lisible sur les 4 thèmes, même si contraste moyen sur "Ivoire" ; à ajuster seulement si retour utilisateur négatif).
