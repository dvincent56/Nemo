# Play Screen Redesign — Plan 2: Carte & Bateaux

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrichir MapCanvas (style nautique sombre, pan/zoom/recenter, follow boat), ajouter BoatRenderer (4 silhouettes SVG orientées), TraceLayer (traces passées couleur bateau), et CoordsDisplay (GPS).

**Architecture:** MapCanvas passe d'un composant fixé plein écran à un composant qui remplit `.mapArea` (row 2 du grid). Les bateaux et traces sont des layers MapLibre (GeoJSON sources). Les SVG silhouettes bateaux sont chargés comme images MapLibre pour le symbol layer. CoordsDisplay est un widget flottant CSS.

**Tech Stack:** MapLibre GL JS 5.x, SVG inline, CSS Modules, Zustand store (Plan 1)

**Spec de référence :** `docs/superpowers/specs/2026-04-17-play-screen-redesign.md` §5.10-5.14

---

## File Structure

### Fichiers à créer

| Fichier | Responsabilité |
|---|---|
| `apps/web/src/components/play/MapCanvas.module.css` | Styles du container carte |
| `apps/web/src/components/play/CoordsDisplay.tsx` | Widget GPS flottant top-gauche |
| `apps/web/src/components/play/CoordsDisplay.module.css` | Styles coords |
| `apps/web/public/images/boats/mono.svg` | Silhouette monocoque vue de dessus |
| `apps/web/public/images/boats/mono-foil.svg` | Silhouette monocoque + foils |
| `apps/web/public/images/boats/multi.svg` | Silhouette multicoque |
| `apps/web/public/images/boats/multi-foil.svg` | Silhouette multicoque + foils |

### Fichiers à modifier

| Fichier | Modification |
|---|---|
| `apps/web/src/components/play/MapCanvas.tsx` | Refonte complète : style sombre, follow boat, boat layer symbol, trail layer, click handlers |
| `apps/web/src/app/play/[raceId]/PlayClient.tsx` | Ajouter CoordsDisplay |

---

## Task 1: SVG silhouettes bateaux

**Files:**
- Create: `apps/web/public/images/boats/mono.svg`
- Create: `apps/web/public/images/boats/mono-foil.svg`
- Create: `apps/web/public/images/boats/multi.svg`
- Create: `apps/web/public/images/boats/multi-foil.svg`

- [ ] **Step 1: Créer les 4 silhouettes SVG**

Chaque SVG doit être un carré 64x64, pointe vers le haut (nord = 0°), rempli en blanc (#ffffff) pour pouvoir être teinté via MapLibre `icon-color`. La silhouette doit être vue de dessus.

`mono.svg` — monocoque classique :
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <path d="M32,4 C37,6 40,14 40,26 C40,38 37,50 35,56 L32,60 L29,56 C27,50 24,38 24,26 C24,14 27,6 32,4Z" fill="#ffffff"/>
  <line x1="32" y1="10" x2="32" y2="54" stroke="#000000" stroke-width="1" opacity="0.3"/>
  <circle cx="32" cy="22" r="2" fill="#000000" opacity="0.4"/>
</svg>
```

`mono-foil.svg` — monocoque avec foils (ailerons latéraux) :
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <path d="M32,4 C37,6 40,14 40,26 C40,38 37,50 35,56 L32,60 L29,56 C27,50 24,38 24,26 C24,14 27,6 32,4Z" fill="#ffffff"/>
  <line x1="32" y1="10" x2="32" y2="54" stroke="#000000" stroke-width="1" opacity="0.3"/>
  <circle cx="32" cy="22" r="2" fill="#000000" opacity="0.4"/>
  <line x1="22" y1="30" x2="14" y2="28" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>
  <line x1="42" y1="30" x2="50" y2="28" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>
</svg>
```

`multi.svg` — multicoque (deux coques parallèles) :
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <path d="M22,8 C24,6 26,10 26,22 C26,34 25,48 24,54 L22,58 L20,54 C19,48 18,34 18,22 C18,10 20,6 22,8Z" fill="#ffffff"/>
  <path d="M42,8 C44,6 46,10 46,22 C46,34 45,48 44,54 L42,58 L40,54 C39,48 38,34 38,22 C38,10 40,6 42,8Z" fill="#ffffff"/>
  <rect x="24" y="20" width="16" height="3" rx="1" fill="#ffffff" opacity="0.8"/>
  <rect x="24" y="34" width="16" height="3" rx="1" fill="#ffffff" opacity="0.8"/>
  <circle cx="32" cy="18" r="2" fill="#000000" opacity="0.4"/>
</svg>
```

`multi-foil.svg` — multicoque avec foils :
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <path d="M22,8 C24,6 26,10 26,22 C26,34 25,48 24,54 L22,58 L20,54 C19,48 18,34 18,22 C18,10 20,6 22,8Z" fill="#ffffff"/>
  <path d="M42,8 C44,6 46,10 46,22 C46,34 45,48 44,54 L42,58 L40,54 C39,48 38,34 38,22 C38,10 40,6 42,8Z" fill="#ffffff"/>
  <rect x="24" y="20" width="16" height="3" rx="1" fill="#ffffff" opacity="0.8"/>
  <rect x="24" y="34" width="16" height="3" rx="1" fill="#ffffff" opacity="0.8"/>
  <circle cx="32" cy="18" r="2" fill="#000000" opacity="0.4"/>
  <line x1="16" y1="28" x2="8" y2="26" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>
  <line x1="48" y1="28" x2="56" y2="26" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>
</svg>
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/public/images/boats/
git commit -m "feat(play): add 4 boat silhouette SVGs (mono, mono-foil, multi, multi-foil)"
```

---

## Task 2: CoordsDisplay component

**Files:**
- Create: `apps/web/src/components/play/CoordsDisplay.tsx`
- Create: `apps/web/src/components/play/CoordsDisplay.module.css`

- [ ] **Step 1: Créer le CSS**

```css
/* apps/web/src/components/play/CoordsDisplay.module.css */
.coords {
  position: absolute;
  top: 16px;
  left: 16px;
  font-family: var(--font-mono);
  font-weight: 700;
  font-size: 11px;
  letter-spacing: 0.06em;
  color: rgba(245, 240, 232, 0.72);
  background: rgba(12, 20, 36, 0.78);
  padding: 8px 12px;
  border: 1px solid rgba(245, 240, 232, 0.16);
  border-radius: 4px;
  z-index: 10;
  pointer-events: auto;
}

.row + .row { margin-top: 2px; }

.value {
  color: #f5f0e8;
  font-weight: 700;
}
```

- [ ] **Step 2: Créer le composant**

```tsx
// apps/web/src/components/play/CoordsDisplay.tsx
'use client';

import { useGameStore } from '@/lib/store';
import styles from './CoordsDisplay.module.css';

function formatDMS(decimal: number, isLat: boolean): string {
  const abs = Math.abs(decimal);
  const deg = Math.floor(abs);
  const minFull = (abs - deg) * 60;
  const min = minFull.toFixed(2);
  const dir = isLat
    ? (decimal >= 0 ? 'N' : 'S')
    : (decimal >= 0 ? 'E' : 'O');
  return `${deg}°${min}'${dir}`;
}

export default function CoordsDisplay(): React.ReactElement {
  const lat = useGameStore((s) => s.hud.lat);
  const lon = useGameStore((s) => s.hud.lon);

  return (
    <div className={styles.coords} aria-label="Position">
      <div className={styles.row}>
        <span className={styles.value}>{formatDMS(lat, true)}</span>
      </div>
      <div className={styles.row}>
        <span className={styles.value}>{formatDMS(lon, false)}</span>
      </div>
    </div>
  );
}
```

Note: La direction Ouest utilise "O" (français) au lieu de "W".

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/play/CoordsDisplay.tsx apps/web/src/components/play/CoordsDisplay.module.css
git commit -m "feat(play): add CoordsDisplay component — GPS position widget"
```

---

## Task 3: MapCanvas refonte complète

**Files:**
- Create: `apps/web/src/components/play/MapCanvas.module.css`
- Modify: `apps/web/src/components/play/MapCanvas.tsx`

Le MapCanvas actuel (91 lignes) utilise un style cyan et position fixed. Il doit être refondu pour :
- Remplir `.mapArea` (position relative, 100% width/height)
- Style nautique sombre (dark ocean)
- Follow boat via `mapSlice.isFollowingBoat`
- Trail layer avec la couleur du bateau (gold par défaut pour "mon bateau")
- Boat marker layer (symbol layer avec SVG silhouette orienté par heading)
- Pan/zoom fonctionnel (désactive follow boat au pan manuel)

- [ ] **Step 1: Créer MapCanvas.module.css**

```css
/* apps/web/src/components/play/MapCanvas.module.css */
.container {
  width: 100%;
  height: 100%;
  position: relative;
}
```

- [ ] **Step 2: Réécrire MapCanvas.tsx**

```tsx
// apps/web/src/components/play/MapCanvas.tsx
'use client';

import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useGameStore } from '@/lib/store';
import styles from './MapCanvas.module.css';

/**
 * MapLibre canvas — remplissant la zone carte (row 2 du grid).
 * Style nautique sombre, boat marker orienté, trail layer.
 */

const STYLE: maplibregl.StyleSpecification = {
  version: 8,
  name: 'Nemo Dark Ocean',
  sources: {
    'osm-tiles': {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [
    {
      id: 'ocean-background',
      type: 'background',
      paint: { 'background-color': '#060b18' },
    },
    {
      id: 'osm-layer',
      type: 'raster',
      source: 'osm-tiles',
      paint: {
        'raster-opacity': 0.25,
        'raster-saturation': -0.8,
        'raster-brightness-max': 0.3,
      },
    },
  ],
};

const BOAT_COLOR = '#c9a227'; // gold — couleur par défaut du joueur
const TRAIL_COORDS: [number, number][] = [];

export default function MapCanvas(): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE,
      center: [-3.0, 47.0],
      zoom: 5,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
    });
    mapRef.current = map;

    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

    map.once('load', () => {
      // Trail source + layer
      map.addSource('my-trail', {
        type: 'geojson',
        data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: {} },
      });
      map.addLayer({
        id: 'my-trail-line',
        type: 'line',
        source: 'my-trail',
        paint: {
          'line-color': BOAT_COLOR,
          'line-width': 2,
          'line-opacity': 0.85,
        },
      });

      // My boat source + layer (circle for now, symbol with SVG in future)
      map.addSource('my-boat', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'my-boat-point',
        type: 'circle',
        source: 'my-boat',
        paint: {
          'circle-radius': 7,
          'circle-color': BOAT_COLOR,
          'circle-stroke-color': '#1a2840',
          'circle-stroke-width': 2,
        },
      });
    });

    // Disable follow on user pan
    map.on('dragstart', () => {
      useGameStore.getState().setFollowBoat(false);
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Subscribe to store updates
  useEffect(() => {
    return useGameStore.subscribe((s) => {
      const map = mapRef.current;
      if (!map || !map.isStyleLoaded()) return;
      const { lat, lon, hdg } = s.hud;
      if (!lat && !lon) return;

      // Update boat position
      const boatSrc = map.getSource('my-boat') as maplibregl.GeoJSONSource | undefined;
      boatSrc?.setData({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [lon, lat] },
          properties: { hdg },
        }],
      });

      // Update trail
      TRAIL_COORDS.push([lon, lat]);
      if (TRAIL_COORDS.length > 1) {
        const trailSrc = map.getSource('my-trail') as maplibregl.GeoJSONSource | undefined;
        trailSrc?.setData({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [...TRAIL_COORDS] },
          properties: {},
        });
      }

      // Follow boat
      if (s.map.isFollowingBoat) {
        map.easeTo({ center: [lon, lat], duration: 500 });
      }
    });
  }, []);

  return <div ref={containerRef} className={styles.container} />;
}
```

- [ ] **Step 3: Vérifier la compilation**

Run: `cd apps/web && npx tsc --noEmit 2>&1 | grep -i "MapCanvas\|mapSlice"`
Expected: Aucune erreur

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/play/MapCanvas.tsx apps/web/src/components/play/MapCanvas.module.css
git commit -m "feat(play): refactor MapCanvas — dark ocean style, follow boat, trail layer"
```

---

## Task 4: Intégrer CoordsDisplay dans PlayClient

**Files:**
- Modify: `apps/web/src/app/play/[raceId]/PlayClient.tsx`

- [ ] **Step 1: Ajouter l'import et le composant**

Ajouter l'import de CoordsDisplay en haut du fichier :
```tsx
import CoordsDisplay from '@/components/play/CoordsDisplay';
```

Ajouter `<CoordsDisplay />` dans la `.mapArea`, juste après `<MapCanvas />` et avant le spectator banner. CoordsDisplay est affiché uniquement pour le joueur (pas le spectateur) :

```tsx
{canInteract && <CoordsDisplay />}
```

- [ ] **Step 2: Vérifier visuellement**

Run: `cd apps/web && pnpm dev`
Vérifier sur http://localhost:3000/play/vendee-express :
- La carte remplit la zone centrale avec un fond sombre
- Les coordonnées GPS s'affichent en haut à gauche
- Le trail gold apparaît si des positions sont émises
- Le pan sur la carte désactive le suivi du bateau
- Le bouton "Centrer" réactive le suivi

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/play/[raceId]/PlayClient.tsx
git commit -m "feat(play): integrate CoordsDisplay in play screen"
```

---

## Résumé des livrables

À la fin de ce plan :
- ✅ 4 silhouettes SVG bateaux (mono, mono-foil, multi, multi-foil)
- ✅ MapCanvas refondu (style dark ocean, follow boat, trail gold, pan désactive follow)
- ✅ CoordsDisplay widget GPS (format DMS, O pour Ouest)
- ✅ Intégration dans PlayClient
