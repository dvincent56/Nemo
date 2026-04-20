# Map Appearance Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter un bouton "Apparence" dans le LayersWidget de `/play/[raceId]` qui ouvre une modale permettant au joueur de choisir parmi 4 presets de couleur d'océan et 4 presets de style de terre, avec persistance localStorage.

**Architecture:** Un module `mapAppearance.ts` exporte deux catalogues figés (ocean/land). Un nouveau slice Zustand `mapAppearance` stocke les IDs sélectionnés, se ré-hydrate depuis localStorage au boot et écrit à chaque setter. `MapCanvas` lit le store au mount pour initialiser le style et souscrit pour appliquer les changements via `setPaintProperty` (ocean) et swap de `source` raster (terre). `LayersWidget` affiche une ligne cliquable qui monte `<MapAppearanceModal>`, laquelle lit/écrit le store directement (pas de props complexes).

**Tech Stack:** React 19, Next.js 16, Zustand 5, MapLibre GL 5, TypeScript strict. CSS Modules. Pas de framework de test dans `apps/web` → validation = strict TS + assertion runtime au chargement du catalogue + vérification manuelle dans le dev server.

**Spec source:** `docs/superpowers/specs/2026-04-20-map-appearance-presets-design.md`

---

## File Structure

| Fichier | Action | Rôle |
|---|---|---|
| `apps/web/src/lib/mapAppearance.ts` | create | Catalogues, types, constantes, validateur runtime |
| `apps/web/src/lib/store/types.ts` | modify | +`MapAppearanceState` dans `GameStore` |
| `apps/web/src/lib/store/mapAppearanceSlice.ts` | create | Slice + hydratation localStorage + setters |
| `apps/web/src/lib/store/index.ts` | modify | Enregistre le slice |
| `apps/web/src/components/play/MapCanvas.tsx` | modify | Init STYLE depuis store + 2 subscribers |
| `apps/web/src/components/play/MapAppearanceModal.tsx` | create | Modale UI |
| `apps/web/src/components/play/MapAppearanceModal.module.css` | create | Styles modale |
| `apps/web/src/components/play/LayersWidget.tsx` | modify | Ligne "Apparence" + flag local |
| `apps/web/src/components/play/LayersWidget.module.css` | modify | Styles ligne "Apparence" |

---

### Task 1 : Catalogue + validateur runtime

Définit les presets de façon immuable et vérifie à l'import qu'aucune erreur de saisie ne s'est glissée (IDs dupliqués, hex invalide, URL de tuile mal formée). L'assertion tape un `throw` explicite plutôt que laisser une erreur silencieuse.

**Files:**
- Create: `apps/web/src/lib/mapAppearance.ts`

- [ ] **Step 1 : Créer le fichier**

```ts
// apps/web/src/lib/mapAppearance.ts

export type OceanPreset = {
  id: string;
  label: string;
  color: string;
};

export type LandPreset = {
  id: string;
  label: string;
  tileUrl: string;
};

export const OCEAN_PRESETS: readonly OceanPreset[] = [
  { id: 'deep-night', label: 'Nuit profonde', color: '#0a2035' },
  { id: 'royal-blue', label: 'Bleu roi',      color: '#1a3a5c' },
  { id: 'glacier',    label: 'Bleu glacier',  color: '#c3d4e0' },
  { id: 'ivory',      label: 'Ivoire',        color: '#f5f0e8' },
] as const;

export const LAND_PRESETS: readonly LandPreset[] = [
  { id: 'dark',     label: 'Sombre',    tileUrl: 'https://basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}@2x.png' },
  { id: 'light',    label: 'Clair',     tileUrl: 'https://basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}@2x.png' },
  { id: 'pastel',   label: 'Pastel',    tileUrl: 'https://basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}@2x.png' },
  { id: 'contrast', label: 'Contraste', tileUrl: 'https://basemaps.cartocdn.com/rastertiles/voyager_labels_under/{z}/{x}/{y}@2x.png' },
] as const;

export const DEFAULT_OCEAN_ID = 'deep-night';
export const DEFAULT_LAND_ID = 'dark';
export const STORAGE_KEY = 'nemo.mapAppearance';

// ── Self-check at module load — catches catalog typos in dev ──
function validateCatalogs(): void {
  const oceanIds = new Set<string>();
  for (const p of OCEAN_PRESETS) {
    if (oceanIds.has(p.id)) throw new Error(`Duplicate ocean preset id: ${p.id}`);
    oceanIds.add(p.id);
    if (!/^#[0-9a-f]{6}$/i.test(p.color)) throw new Error(`Invalid hex for ${p.id}: ${p.color}`);
  }
  const landIds = new Set<string>();
  for (const p of LAND_PRESETS) {
    if (landIds.has(p.id)) throw new Error(`Duplicate land preset id: ${p.id}`);
    landIds.add(p.id);
    if (!/\{z\}/.test(p.tileUrl) || !/\{x\}/.test(p.tileUrl) || !/\{y\}/.test(p.tileUrl)) {
      throw new Error(`Invalid tileUrl for ${p.id}: ${p.tileUrl}`);
    }
  }
  if (!oceanIds.has(DEFAULT_OCEAN_ID)) throw new Error(`DEFAULT_OCEAN_ID not in catalog: ${DEFAULT_OCEAN_ID}`);
  if (!landIds.has(DEFAULT_LAND_ID)) throw new Error(`DEFAULT_LAND_ID not in catalog: ${DEFAULT_LAND_ID}`);
}
validateCatalogs();

export function findOceanPreset(id: string): OceanPreset | undefined {
  return OCEAN_PRESETS.find((p) => p.id === id);
}

export function findLandPreset(id: string): LandPreset | undefined {
  return LAND_PRESETS.find((p) => p.id === id);
}
```

- [ ] **Step 2 : Vérifier que le module compile**

Run: `pnpm --filter @nemo/web typecheck`
Expected: PASS — pas d'erreur TS.

- [ ] **Step 3 : Commit**

```bash
git add apps/web/src/lib/mapAppearance.ts
git commit -m "feat(map): map appearance catalogs — 4 ocean colors + 4 land tile styles"
```

---

### Task 2 : Types du store

Déclarer `MapAppearanceState` dans les types + ajouter les setters au `GameStore` interface.

**Files:**
- Modify: `apps/web/src/lib/store/types.ts`

- [ ] **Step 1 : Ajouter le type `MapAppearanceState`**

Insérer après le bloc `LayersState` (~ligne 74), avant le `PanelName` :

```ts
export interface MapAppearanceState {
  oceanPresetId: string;
  landPresetId: string;
}
```

- [ ] **Step 2 : Ajouter le champ dans `GameStore`**

Dans l'interface `GameStore`, après `layers: LayersState;`, ajouter :

```ts
  mapAppearance: MapAppearanceState;
```

Et dans la section setters (après `toggleLayer`), ajouter :

```ts
  setOceanPreset: (id: string) => void;
  setLandPreset: (id: string) => void;
```

- [ ] **Step 3 : Exporter le type depuis `store/index.ts`**

Dans `apps/web/src/lib/store/index.ts`, ajouter `MapAppearanceState` à la liste d'exports types (ligne ~19-20) :

```ts
export type { TimelineState, LayersState, PanelState, WeatherState, MapAppearanceState } from './types';
```

- [ ] **Step 4 : Vérifier que le type compile**

Run: `pnpm --filter @nemo/web typecheck`
Expected: FAIL avec une erreur indiquant que `mapAppearance` / `setOceanPreset` / `setLandPreset` ne sont pas implémentés dans le store factory de `index.ts`. C'est normal — on l'implémente à la tâche suivante.

- [ ] **Step 5 : Commit (WIP — types only)**

```bash
git add apps/web/src/lib/store/types.ts apps/web/src/lib/store/index.ts
git commit -m "feat(store): type MapAppearanceState + setters"
```

---

### Task 3 : Slice `mapAppearance` avec hydratation localStorage

Crée le slice Zustand qui lit localStorage au démarrage, valide les IDs contre le catalogue, persiste à chaque setter.

**Files:**
- Create: `apps/web/src/lib/store/mapAppearanceSlice.ts`
- Modify: `apps/web/src/lib/store/index.ts` (wire le slice)

- [ ] **Step 1 : Créer le slice**

```ts
// apps/web/src/lib/store/mapAppearanceSlice.ts
'use client';

import type { MapAppearanceState, GameStore } from './types';
import {
  DEFAULT_OCEAN_ID,
  DEFAULT_LAND_ID,
  STORAGE_KEY,
  findOceanPreset,
  findLandPreset,
} from '@/lib/mapAppearance';

function readFromStorage(): MapAppearanceState {
  const fallback: MapAppearanceState = {
    oceanPresetId: DEFAULT_OCEAN_ID,
    landPresetId: DEFAULT_LAND_ID,
  };
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return fallback;
    const rec = parsed as Record<string, unknown>;
    const oceanId = typeof rec['oceanPresetId'] === 'string' ? rec['oceanPresetId'] : '';
    const landId = typeof rec['landPresetId'] === 'string' ? rec['landPresetId'] : '';
    return {
      oceanPresetId: findOceanPreset(oceanId) ? oceanId : DEFAULT_OCEAN_ID,
      landPresetId: findLandPreset(landId) ? landId : DEFAULT_LAND_ID,
    };
  } catch {
    return fallback;
  }
}

function writeToStorage(state: MapAppearanceState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Quota exceeded or disabled — swallow silently.
  }
}

export function createMapAppearanceSlice(
  set: (fn: (s: GameStore) => Partial<GameStore>) => void,
) {
  return {
    mapAppearance: readFromStorage(),

    setOceanPreset: (id: string) => set((s) => {
      if (!findOceanPreset(id)) return {};
      const next = { ...s.mapAppearance, oceanPresetId: id };
      writeToStorage(next);
      return { mapAppearance: next };
    }),

    setLandPreset: (id: string) => set((s) => {
      if (!findLandPreset(id)) return {};
      const next = { ...s.mapAppearance, landPresetId: id };
      writeToStorage(next);
      return { mapAppearance: next };
    }),
  };
}
```

- [ ] **Step 2 : Wire le slice dans `store/index.ts`**

Ajouter l'import près des autres slice imports :

```ts
import { createMapAppearanceSlice } from './mapAppearanceSlice';
```

Puis dans le `create<GameStore>((set) => ({ ... }))` factory, ajouter la ligne (après `...createZonesSlice(set),`) :

```ts
    ...createMapAppearanceSlice(set),
```

- [ ] **Step 3 : Vérifier compile**

Run: `pnpm --filter @nemo/web typecheck`
Expected: PASS — plus d'erreur sur `mapAppearance`.

- [ ] **Step 4 : Commit**

```bash
git add apps/web/src/lib/store/mapAppearanceSlice.ts apps/web/src/lib/store/index.ts
git commit -m "feat(store): mapAppearance slice with localStorage hydration"
```

---

### Task 4 : Appliquer les presets dans MapCanvas

Init la constante `STYLE` avec les valeurs courantes du store (pas de flash), puis souscrire pour appliquer les changements live.

**Files:**
- Modify: `apps/web/src/components/play/MapCanvas.tsx`

- [ ] **Step 1 : Remplacer la constante `STYLE` figée par une factory**

Actuellement ([MapCanvas.tsx:42-76](apps/web/src/components/play/MapCanvas.tsx#L42-L76)), `STYLE` est une constante globale. On la transforme en factory qui lit l'état du store au moment de la création du Map.

Ajouter l'import en haut du fichier (à côté des autres imports `@/lib/`) :

```ts
import {
  findOceanPreset,
  findLandPreset,
  DEFAULT_OCEAN_ID,
  DEFAULT_LAND_ID,
} from '@/lib/mapAppearance';
```

Remplacer la déclaration `const STYLE: maplibregl.StyleSpecification = { … };` (lignes 42-76) par une factory :

```ts
function buildStyle(oceanColor: string, landTileUrl: string): maplibregl.StyleSpecification {
  return {
    version: 8,
    name: 'Nemo Ocean',
    sources: {
      'osm-tiles': {
        type: 'raster',
        tiles: [landTileUrl],
        tileSize: 256,
      },
      'country-labels': {
        type: 'geojson',
        data: COUNTRY_LABELS,
      },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': oceanColor } },
      { id: 'dark-tiles', type: 'raster', source: 'osm-tiles', paint: { 'raster-opacity': 0.6 } },
      {
        id: 'country-names',
        type: 'symbol',
        source: 'country-labels',
        layout: {
          'text-field': ['get', 'name'],
          'text-size': 13,
          'text-letter-spacing': 0.15,
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': 'rgba(180, 190, 210, 0.55)',
          'text-halo-color': 'rgba(10, 22, 40, 0.6)',
          'text-halo-width': 1,
        },
      },
    ],
  };
}
```

- [ ] **Step 2 : Utiliser la factory au mount**

Dans le `useEffect` qui crée le Map ([MapCanvas.tsx:100-112](apps/web/src/components/play/MapCanvas.tsx#L100-L112)), lire l'état courant du store avant de construire le style :

Remplacer :
```ts
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE,
      center: [-3.0, 47.0],
      ...
```

par :
```ts
    const initAppearance = useGameStore.getState().mapAppearance;
    const initOcean = findOceanPreset(initAppearance.oceanPresetId)?.color
      ?? findOceanPreset(DEFAULT_OCEAN_ID)!.color;
    const initLand = findLandPreset(initAppearance.landPresetId)?.tileUrl
      ?? findLandPreset(DEFAULT_LAND_ID)!.tileUrl;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: buildStyle(initOcean, initLand),
      center: [-3.0, 47.0],
      ...
```

- [ ] **Step 3 : Ajouter les deux subscribers après le `useEffect` principal du map**

Insérer ces deux `useEffect` après celui qui gère le boat sync ([MapCanvas.tsx:463-499](apps/web/src/components/play/MapCanvas.tsx#L463-L499)), avant l'effet des zones :

```ts
  /* ── Apparence : couleur d'océan ── */
  useEffect(() => {
    const apply = (oceanPresetId: string): void => {
      const map = mapRef.current;
      if (!map || !map.getLayer('background')) return;
      const preset = findOceanPreset(oceanPresetId);
      if (!preset) return;
      map.setPaintProperty('background', 'background-color', preset.color);
    };
    apply(useGameStore.getState().mapAppearance.oceanPresetId);
    let prev = useGameStore.getState().mapAppearance.oceanPresetId;
    return useGameStore.subscribe((s) => {
      if (s.mapAppearance.oceanPresetId !== prev) {
        prev = s.mapAppearance.oceanPresetId;
        apply(prev);
      }
    });
  }, []);

  /* ── Apparence : style de terre (swap source raster) ── */
  useEffect(() => {
    const apply = (landPresetId: string): void => {
      const map = mapRef.current;
      if (!map || !map.getSource('osm-tiles')) return;
      const preset = findLandPreset(landPresetId);
      if (!preset) return;
      map.removeLayer('dark-tiles');
      map.removeSource('osm-tiles');
      map.addSource('osm-tiles', {
        type: 'raster',
        tiles: [preset.tileUrl],
        tileSize: 256,
      });
      map.addLayer(
        {
          id: 'dark-tiles',
          type: 'raster',
          source: 'osm-tiles',
          paint: { 'raster-opacity': 0.6 },
        },
        'country-names',
      );
    };
    let prev = useGameStore.getState().mapAppearance.landPresetId;
    return useGameStore.subscribe((s) => {
      if (s.mapAppearance.landPresetId !== prev) {
        prev = s.mapAppearance.landPresetId;
        apply(prev);
      }
    });
  }, []);
```

Note : on n'appelle pas `apply()` au mount pour la terre — le style initial lu au `new Map({ style: … })` (step 2) contient déjà la bonne tuile, donc un `apply` immédiat ferait un swap inutile.

- [ ] **Step 4 : Vérifier compile**

Run: `pnpm --filter @nemo/web typecheck`
Expected: PASS.

- [ ] **Step 5 : Vérification visuelle rapide**

Run: `pnpm --filter @nemo/web dev` puis ouvrir `http://localhost:3000/play/[anyRaceId]`. La carte doit s'afficher normalement (pas de régression visuelle). Couper le dev server (Ctrl+C).

- [ ] **Step 6 : Commit**

```bash
git add apps/web/src/components/play/MapCanvas.tsx
git commit -m "feat(map): apply appearance presets live + init from store"
```

---

### Task 5 : Modale MapAppearanceModal

Composant autonome : pas de prop `onChange`, uniquement `open` + `onClose`. Lit/écrit directement le store.

**Files:**
- Create: `apps/web/src/components/play/MapAppearanceModal.tsx`
- Create: `apps/web/src/components/play/MapAppearanceModal.module.css`

- [ ] **Step 1 : Créer le composant**

```tsx
// apps/web/src/components/play/MapAppearanceModal.tsx
'use client';

import { useGameStore } from '@/lib/store';
import { OCEAN_PRESETS, LAND_PRESETS } from '@/lib/mapAppearance';
import styles from './MapAppearanceModal.module.css';

interface MapAppearanceModalProps {
  open: boolean;
  onClose: () => void;
}

export default function MapAppearanceModal({ open, onClose }: MapAppearanceModalProps): React.ReactElement | null {
  const oceanPresetId = useGameStore((s) => s.mapAppearance.oceanPresetId);
  const landPresetId = useGameStore((s) => s.mapAppearance.landPresetId);
  const setOceanPreset = useGameStore((s) => s.setOceanPreset);
  const setLandPreset = useGameStore((s) => s.setLandPreset);

  if (!open) return null;

  return (
    <div className={styles.veil} onClick={onClose} role="presentation">
      <div
        className={styles.modal}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Apparence de la carte"
      >
        <header className={styles.header}>
          <h2 className={styles.title}>Apparence</h2>
          <button className={styles.close} onClick={onClose} aria-label="Fermer">✕</button>
        </header>

        <section className={styles.section}>
          <p className={styles.sectionTitle}>Océan</p>
          <div className={styles.swatches}>
            {OCEAN_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`${styles.swatch} ${p.id === oceanPresetId ? styles.swatchActive : ''}`}
                style={{ background: p.color }}
                onClick={() => setOceanPreset(p.id)}
                aria-label={p.label}
                title={p.label}
              />
            ))}
          </div>
        </section>

        <section className={styles.section}>
          <p className={styles.sectionTitle}>Terre</p>
          <div className={styles.chips}>
            {LAND_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`${styles.chip} ${p.id === landPresetId ? styles.chipActive : ''}`}
                onClick={() => setLandPreset(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </section>

        <footer className={styles.footer}>
          <button type="button" className={styles.closeButton} onClick={onClose}>
            Fermer
          </button>
        </footer>
      </div>
    </div>
  );
}
```

- [ ] **Step 2 : Créer le CSS**

```css
/* apps/web/src/components/play/MapAppearanceModal.module.css */

.veil {
  position: fixed;
  inset: 0;
  background: rgba(6, 12, 24, 0.62);
  backdrop-filter: blur(2px);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: fadeIn 160ms ease-out;
}

.modal {
  background: rgba(12, 20, 36, 0.96);
  border: 1px solid rgba(201, 162, 39, 0.38);
  border-radius: 6px;
  padding: 18px 20px 16px;
  width: 320px;
  max-width: calc(100vw - 32px);
  color: #f5f0e8;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.45);
  animation: slideUp 180ms ease-out;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}

.title {
  margin: 0;
  font-family: var(--font-serif, 'Cormorant Garamond'), serif;
  font-size: 20px;
  font-weight: 500;
  letter-spacing: 0.02em;
  color: #f5f0e8;
}

.close {
  background: transparent;
  border: none;
  color: rgba(245, 240, 232, 0.6);
  font-size: 16px;
  cursor: pointer;
  padding: 4px 6px;
  line-height: 1;
  border-radius: 3px;
}
.close:hover { color: #f5f0e8; background: rgba(245, 240, 232, 0.08); }

.section { margin-bottom: 14px; }

.sectionTitle {
  font-family: var(--font-mono);
  font-weight: 700;
  font-size: 9px;
  letter-spacing: 0.16em;
  color: rgba(245, 240, 232, 0.45);
  text-transform: uppercase;
  margin: 0 0 8px;
}

.swatches {
  display: flex;
  gap: 10px;
}

.swatch {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: 2px solid rgba(245, 240, 232, 0.2);
  cursor: pointer;
  padding: 0;
  transition: transform 120ms, border-color 120ms;
}
.swatch:hover { transform: scale(1.06); }
.swatchActive {
  border-color: #c9a227;
  box-shadow: 0 0 0 2px rgba(201, 162, 39, 0.25);
}

.chips {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.chip {
  background: rgba(245, 240, 232, 0.06);
  border: 1px solid rgba(245, 240, 232, 0.14);
  border-radius: 3px;
  color: #f5f0e8;
  font-size: 13px;
  font-weight: 500;
  padding: 8px 12px;
  cursor: pointer;
  transition: background 120ms, border-color 120ms;
}
.chip:hover { background: rgba(245, 240, 232, 0.1); }
.chipActive {
  background: rgba(201, 162, 39, 0.15);
  border-color: #c9a227;
  color: #f5f0e8;
}

.footer {
  display: flex;
  justify-content: flex-end;
  margin-top: 4px;
}

.closeButton {
  background: transparent;
  border: 1px solid rgba(245, 240, 232, 0.22);
  color: #f5f0e8;
  padding: 7px 16px;
  border-radius: 3px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  cursor: pointer;
  transition: background 120ms, border-color 120ms;
}
.closeButton:hover {
  background: rgba(245, 240, 232, 0.08);
  border-color: rgba(245, 240, 232, 0.4);
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes slideUp {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

@media (max-width: 600px) {
  .modal { padding: 14px 16px 12px; }
  .title { font-size: 18px; }
  .swatch { width: 30px; height: 30px; }
}
```

- [ ] **Step 3 : Vérifier compile**

Run: `pnpm --filter @nemo/web typecheck`
Expected: PASS.

- [ ] **Step 4 : Commit**

```bash
git add apps/web/src/components/play/MapAppearanceModal.tsx apps/web/src/components/play/MapAppearanceModal.module.css
git commit -m "feat(play): MapAppearanceModal — swatches + chips + live preview"
```

---

### Task 6 : Brancher la modale dans LayersWidget

Ajouter une ligne cliquable "Apparence" en bas du widget + flag local pour ouvrir la modale.

**Files:**
- Modify: `apps/web/src/components/play/LayersWidget.tsx`
- Modify: `apps/web/src/components/play/LayersWidget.module.css`

- [ ] **Step 1 : Ajouter les imports et le state**

Dans [LayersWidget.tsx](apps/web/src/components/play/LayersWidget.tsx) :

Remplacer la ligne 1 :
```ts
'use client';
```
par :
```ts
'use client';

import { useState } from 'react';
import MapAppearanceModal from './MapAppearanceModal';
```
(et garder les autres imports existants).

Dans le corps du composant, après `const gfs = useGfsStatus();` (ligne 43), ajouter :

```ts
  const [appearanceOpen, setAppearanceOpen] = useState(false);
```

- [ ] **Step 2 : Ajouter la ligne "Apparence" dans le JSX**

À la fin du bloc retourné, après la boucle `{visibleLayers.map(...)}` (ligne 85) et avant le `</div>` de fermeture du widget, ajouter :

```tsx
      <div className={styles.separator} />
      <div
        className={styles.appearanceRow}
        onClick={() => setAppearanceOpen(true)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setAppearanceOpen(true); }}
      >
        <span className={styles.rowLabel}>
          <span className={styles.icon}>◐</span>
          Apparence
        </span>
        <span className={styles.chevron}>›</span>
      </div>

      <MapAppearanceModal open={appearanceOpen} onClose={() => setAppearanceOpen(false)} />
```

- [ ] **Step 3 : Ajouter les styles correspondants**

Dans [LayersWidget.module.css](apps/web/src/components/play/LayersWidget.module.css), append à la fin du fichier :

```css
.separator {
  height: 1px;
  background: rgba(245, 240, 232, 0.10);
  margin: 4px 0 2px;
}

.appearanceRow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  cursor: pointer;
  user-select: none;
  padding: 2px 0;
  outline: none;
}
.appearanceRow:hover .rowLabel,
.appearanceRow:focus-visible .rowLabel {
  color: #c9a227;
}
.appearanceRow:hover .icon,
.appearanceRow:focus-visible .icon {
  color: #c9a227;
}

.chevron {
  font-size: 16px;
  color: rgba(245, 240, 232, 0.45);
  line-height: 1;
}

@media (max-width: 600px) {
  .separator { margin: 2px 0 0; }
  .chevron { display: none; }
}
```

- [ ] **Step 4 : Vérifier compile**

Run: `pnpm --filter @nemo/web typecheck`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add apps/web/src/components/play/LayersWidget.tsx apps/web/src/components/play/LayersWidget.module.css
git commit -m "feat(play): Apparence entry point in LayersWidget"
```

---

### Task 7 : Vérification manuelle complète

Puisque `apps/web` n'a pas de framework de test, on valide la feature bout-en-bout dans le dev server.

**Files:** aucun code ici.

- [ ] **Step 1 : Lancer le dev server**

Run: `pnpm --filter @nemo/web dev`
Attendre que Next.js affiche `Ready` puis ouvrir `http://localhost:3000/play/[anyRaceId]` (ou la route de test habituelle).

- [ ] **Step 2 : Golden path**

- Localiser le LayersWidget (panneau couches dans le coin de l'écran).
- Cliquer sur la ligne "Apparence" → la modale s'ouvre par-dessus la carte.
- Tester les 4 swatches d'océan : la couleur de fond change instantanément à chaque tap, le swatch actif est entouré en or.
- Tester les 4 chips de terre : les tuiles se re-téléchargent et s'affichent avec le nouveau style (quelques centaines de ms pour les tuiles). Le chip actif est en or.
- Fermer la modale via (a) bouton "Fermer", (b) icône ✕, (c) clic sur le voile semi-transparent — les trois doivent marcher.

- [ ] **Step 3 : Persistance**

- Choisir une combinaison non-default (ex: ocean = Ivoire, terre = Clair).
- Recharger la page (F5).
- La modale reste fermée, mais la carte réapparaît directement avec les bons presets, sans flash à la couleur par défaut.

- [ ] **Step 4 : Ordre des couches**

- Avec preset ocean = Ivoire (fond clair), vérifier que : zones d'exclusion (zones toggle ON), ligne de projection, bateau, labels de pays, trait de côte — restent TOUS visibles et au-dessus des tuiles.
- Aucun disparaît ou passe sous les tuiles après un swap de terre.

- [ ] **Step 5 : Mobile / responsive**

- Ouvrir DevTools → mode responsive → iPhone 12 Pro ou équivalent (~390×844).
- Vérifier que :
  - Le widget Couches reste compact (icônes seules, pas de texte).
  - La ligne "Apparence" reste tapable.
  - La modale tient dans l'écran (pas de scroll horizontal, largeur ≤ viewport).
  - Les swatches et chips restent confortables à taper au doigt.

- [ ] **Step 6 : Mode spectateur**

- Ouvrir une URL en mode spectateur (route où `isSpectator` est vrai — cf. PlayClient).
- La ligne "Apparence" doit rester accessible et fonctionnelle.
- Les autres toggles spectateur-spécifiques ne sont pas affectés.

- [ ] **Step 7 : localStorage inspection**

- DevTools → Application → Local Storage → `http://localhost:3000`.
- Vérifier la clé `nemo.mapAppearance` = `{"oceanPresetId":"...","landPresetId":"..."}` avec les IDs courants.
- Manuellement éditer l'entrée pour mettre `oceanPresetId: "inexistant"` → reload → la carte retombe sur default sans crash, et la clé est écrite avec l'ID default au prochain setter.

- [ ] **Step 8 : Couper le dev server**

Ctrl+C dans le terminal.

- [ ] **Step 9 : Vérification typecheck + lint finale**

Run: `pnpm --filter @nemo/web typecheck && pnpm --filter @nemo/web lint`
Expected: PASS pour les deux.

- [ ] **Step 10 : Commit final (si des corrections ont été nécessaires)**

Si aucun code n'a bougé depuis la Task 6, cette étape est un no-op.
Sinon, commit les ajustements sous un message ciblé.

---

## Notes d'exécution

- **Aucun test automatisé** : `apps/web` n'a pas de harness Vitest/Jest. La self-validation du catalogue à l'import (Task 1) couvre les erreurs de saisie, la stricte TS couvre les contrats, la vérification manuelle (Task 7) couvre l'UX. Monter Vitest juste pour cette feature est hors scope.
- **Pas de flag feature** : le bouton est visible d'emblée pour tous. Si besoin d'un rollout progressif plus tard, c'est trivial à ajouter (une condition au rendu de la ligne dans LayersWidget).
- **Compatibilité SSR** : le slice lit `window.localStorage` côté client uniquement (guard `typeof window`). Next.js rendra le premier HTML côté serveur avec les defaults, puis l'hydratation côté client ré-rend avec la bonne valeur — pas de flash visible puisque MapCanvas s'initialise post-hydratation.
- **Conflits au merge** : `store/types.ts` et `store/index.ts` sont touchés ; si d'autres branches en cours modifient aussi le `GameStore` interface, attendre un merge soigné au moment du PR.
