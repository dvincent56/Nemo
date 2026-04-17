# Play Screen Redesign — Plan 1: Fondations (Store + Layout + PlayClient)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Poser le store Zustand enrichi (10 slices) et le layout CSS Grid (HUD + Map + Timeline) qui serviront de socle à tous les composants des plans suivants.

**Architecture:** Le store monolithique actuel (`store.ts`, 195 lignes) est découpé en slices Zustand composés via `create` + spread. Le layout passe d'un positionnement absolu ad-hoc à une CSS Grid 3 rangées (HUD 56px / Map 1fr / Timeline 64px) fidèle au mockup `play-v1.html`. Le PlayClient est refactorisé pour utiliser le nouveau layout et piloter les slices.

**Tech Stack:** Zustand 5.x (slices pattern), CSS Modules, React 19, Next.js 16, TypeScript strict

**Spec de référence :** `docs/superpowers/specs/2026-04-17-play-screen-redesign.md`

---

## File Structure

### Fichiers à créer

| Fichier | Responsabilité |
|---|---|
| `apps/web/src/lib/store/hudSlice.ts` | Slice HUD : stats vitales + rang + usure |
| `apps/web/src/lib/store/sailSlice.ts` | Slice voiles : voile active, pending, auto, disponibilité |
| `apps/web/src/lib/store/mapSlice.ts` | Slice carte : center, zoom, followBoat |
| `apps/web/src/lib/store/selectionSlice.ts` | Slice sélection : bateaux sélectionnés, editMode |
| `apps/web/src/lib/store/timelineSlice.ts` | Slice timeline : currentTime, isLive, playbackSpeed |
| `apps/web/src/lib/store/layersSlice.ts` | Slice couches : wind, swell, opponents, zones |
| `apps/web/src/lib/store/panelSlice.ts` | Slice panneaux : activePanel |
| `apps/web/src/lib/store/weatherSlice.ts` | Slice météo : gridData, expiresAt, isLoading |
| `apps/web/src/lib/store/connectionSlice.ts` | Slice WS : wsState, connectRace, sendOrder |
| `apps/web/src/lib/store/progSlice.ts` | Slice programmation : orderQueue, serverQueue |
| `apps/web/src/lib/store/index.ts` | Composition de tous les slices en un store unique |
| `apps/web/src/lib/store/types.ts` | Types partagés entre slices |

### Fichiers à modifier

| Fichier | Modification |
|---|---|
| `apps/web/src/app/play/[raceId]/page.module.css` | Réécriture complète : CSS Grid 3 rangées + zones flottantes |
| `apps/web/src/app/play/[raceId]/PlayClient.tsx` | Refonte : utilise le nouveau store + nouveau layout |
| `apps/web/src/components/play/HudBar.tsx` | Imports mis à jour vers le nouveau store |
| `apps/web/src/components/play/SailPanel.tsx` | Imports mis à jour vers le nouveau store |
| `apps/web/src/components/play/Compass.tsx` | Imports mis à jour vers le nouveau store |
| `apps/web/src/components/play/MapCanvas.tsx` | Imports mis à jour vers le nouveau store |

### Fichiers à supprimer

| Fichier | Raison |
|---|---|
| `apps/web/src/lib/store.ts` | Remplacé par `apps/web/src/lib/store/index.ts` + slices |

---

## Task 1: Types partagés du store

**Files:**
- Create: `apps/web/src/lib/store/types.ts`

- [ ] **Step 1: Créer le fichier de types**

```typescript
// apps/web/src/lib/store/types.ts
'use client';

import type { SailId, OrderTrigger } from '@nemo/shared-types';

// ─── HUD ───────────────────────────────────────────────
export type TwaColor = 'optimal' | 'overlap' | 'neutral' | 'deadzone';

export interface WearDetail {
  hull: number;
  rig: number;
  sails: number;
  electronics: number;
}

export interface HudState {
  tws: number;
  twd: number;
  twa: number;
  hdg: number;
  bsp: number;
  vmg: number;
  dtf: number;
  overlapFactor: number;
  twaColor: TwaColor;
  rank: number;
  totalParticipants: number;
  rankTrend: number;
  wearGlobal: number;
  wearDetail: WearDetail;
  lat: number;
  lon: number;
}

// ─── Sail ──────────────────────────────────────────────
export type SailAvailability = 'active' | 'available' | 'disabled';

export interface SailState {
  currentSail: SailId;
  sailPending: SailId | null;
  transitionRemainingSec: number;
  sailAuto: boolean;
  sailAvailability: Record<SailId, SailAvailability>;
}

// ─── Map ───────────────────────────────────────────────
export interface MapState {
  center: [lon: number, lat: number];
  zoom: number;
  isFollowingBoat: boolean;
}

// ─── Selection ─────────────────────────────────────────
export interface SelectionState {
  selectedBoatIds: Set<string>;
  editMode: boolean;
}

// ─── Timeline ──────────────────────────────────────────
export type PlaybackSpeed = 1 | 6 | 24;

export interface TimelineState {
  currentTime: Date;
  isLive: boolean;
  playbackSpeed: PlaybackSpeed;
}

// ─── Layers ────────────────────────────────────────────
export type LayerName = 'wind' | 'swell' | 'opponents' | 'zones';

export interface LayersState {
  wind: boolean;
  swell: boolean;
  opponents: boolean;
  zones: boolean;
}

// ─── Panel ─────────────────────────────────────────────
export type PanelName = 'ranking' | 'sails' | 'programming';

export interface PanelState {
  activePanel: PanelName | null;
}

// ─── Weather ───────────────────────────────────────────
export interface WeatherGridPoint {
  lat: number;
  lon: number;
  tws: number;
  twd: number;
  swellHeight: number;
  swellDir: number;
}

export interface WeatherGrid {
  points: WeatherGridPoint[];
  resolution: number;
  bounds: { north: number; south: number; east: number; west: number };
  timestamps: number[];
}

export interface WeatherState {
  gridData: WeatherGrid | null;
  gridExpiresAt: Date | null;
  isLoading: boolean;
}

// ─── Connection ────────────────────────────────────────
export type ConnState = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

export interface ConnectionState {
  wsState: ConnState;
}

// ─── Prog ──────────────────────────────────────────────
export interface OrderEntry {
  id: string;
  type: 'CAP' | 'TWA' | 'WPT' | 'SAIL' | 'MODE';
  trigger: OrderTrigger;
  value: Record<string, unknown>;
  label: string;
}

export interface ProgState {
  orderQueue: OrderEntry[];
  serverQueue: OrderEntry[];
}

// ─── Boats (live positions) ────────────────────────────
export interface BoatLive {
  id: string;
  lat: number;
  lon: number;
  hdg: number;
  bsp: number;
  sail: number;
  tickSeq: number;
}

// ─── Combined Store ────────────────────────────────────
export interface GameStore {
  // Data
  hud: HudState;
  sail: SailState;
  map: MapState;
  selection: SelectionState;
  timeline: TimelineState;
  layers: LayersState;
  panel: PanelState;
  weather: WeatherState;
  connection: ConnectionState;
  prog: ProgState;
  boats: Map<string, BoatLive>;
  lastTickUnix: number | null;

  // HUD actions
  setHud: (patch: Partial<HudState>) => void;

  // Sail actions
  setSail: (patch: Partial<SailState>) => void;
  toggleSailAuto: () => void;

  // Map actions
  setMapView: (center: [number, number], zoom: number) => void;
  setFollowBoat: (follow: boolean) => void;

  // Selection actions
  toggleBoat: (id: string) => void;
  clearSelection: () => void;
  setEditMode: (active: boolean) => void;

  // Timeline actions
  setTime: (t: Date) => void;
  goLive: () => void;
  setPlaybackSpeed: (speed: PlaybackSpeed) => void;

  // Layers actions
  toggleLayer: (layer: LayerName) => void;

  // Panel actions
  openPanel: (p: PanelName) => void;
  closePanel: () => void;

  // Weather actions
  setWeatherGrid: (grid: WeatherGrid, expiresAt: Date) => void;
  setWeatherLoading: (loading: boolean) => void;

  // Connection actions
  setConnection: (s: ConnState) => void;

  // Prog actions
  addOrder: (order: OrderEntry) => void;
  removeOrder: (id: string) => void;
  reorderQueue: (from: number, to: number) => void;
  commitQueue: () => void;

  // Boats/broadcast
  applyMessages: (msgs: Record<string, unknown>[]) => void;
}
```

- [ ] **Step 2: Vérifier que le fichier compile**

Run: `cd apps/web && npx tsc --noEmit 2>&1 | head -20`
Expected: Aucune erreur liée à `store/types.ts` (d'autres erreurs existantes sont OK)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/store/types.ts
git commit -m "feat(store): add shared types for 10-slice Zustand store"
```

---

## Task 2: hudSlice

**Files:**
- Create: `apps/web/src/lib/store/hudSlice.ts`

- [ ] **Step 1: Créer le slice HUD**

```typescript
// apps/web/src/lib/store/hudSlice.ts
'use client';

import type { HudState, WearDetail, GameStore } from './types';

const INITIAL_WEAR: WearDetail = { hull: 100, rig: 100, sails: 100, electronics: 100 };

export const INITIAL_HUD: HudState = {
  tws: 0, twd: 0, twa: 0, hdg: 0, bsp: 0, vmg: 0, dtf: 0,
  overlapFactor: 1.0, twaColor: 'neutral',
  rank: 0, totalParticipants: 0, rankTrend: 0,
  wearGlobal: 100, wearDetail: INITIAL_WEAR,
  lat: 0, lon: 0,
};

export function createHudSlice(
  set: (fn: (s: GameStore) => Partial<GameStore>) => void,
) {
  return {
    hud: INITIAL_HUD,
    setHud: (patch: Partial<HudState>) =>
      set((s) => ({ hud: { ...s.hud, ...patch } })),
  };
}
```

- [ ] **Step 2: Vérifier que le fichier compile**

Run: `cd apps/web && npx tsc --noEmit 2>&1 | grep "hudSlice"`
Expected: Aucune erreur

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/store/hudSlice.ts
git commit -m "feat(store): add hudSlice — stats, rank, wear"
```

---

## Task 3: sailSlice

**Files:**
- Create: `apps/web/src/lib/store/sailSlice.ts`

- [ ] **Step 1: Créer le slice voiles**

```typescript
// apps/web/src/lib/store/sailSlice.ts
'use client';

import type { SailId } from '@nemo/shared-types';
import type { SailState, SailAvailability, GameStore } from './types';

const ALL_SAILS: SailId[] = ['LW', 'JIB', 'GEN', 'C0', 'HG', 'SPI'];

function defaultAvailability(): Record<SailId, SailAvailability> {
  return Object.fromEntries(ALL_SAILS.map((s) => [s, 'available'])) as Record<SailId, SailAvailability>;
}

export const INITIAL_SAIL: SailState = {
  currentSail: 'GEN',
  sailPending: null,
  transitionRemainingSec: 0,
  sailAuto: false,
  sailAvailability: defaultAvailability(),
};

export function createSailSlice(
  set: (fn: (s: GameStore) => Partial<GameStore>) => void,
) {
  return {
    sail: INITIAL_SAIL,
    setSail: (patch: Partial<SailState>) =>
      set((s) => ({ sail: { ...s.sail, ...patch } })),
    toggleSailAuto: () =>
      set((s) => ({ sail: { ...s.sail, sailAuto: !s.sail.sailAuto } })),
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/lib/store/sailSlice.ts
git commit -m "feat(store): add sailSlice — current sail, auto mode, availability"
```

---

## Task 4: mapSlice

**Files:**
- Create: `apps/web/src/lib/store/mapSlice.ts`

- [ ] **Step 1: Créer le slice carte**

```typescript
// apps/web/src/lib/store/mapSlice.ts
'use client';

import type { MapState, GameStore } from './types';

export const INITIAL_MAP: MapState = {
  center: [0, 0],
  zoom: 6,
  isFollowingBoat: true,
};

export function createMapSlice(
  set: (fn: (s: GameStore) => Partial<GameStore>) => void,
) {
  return {
    map: INITIAL_MAP,
    setMapView: (center: [number, number], zoom: number) =>
      set((s) => ({ map: { ...s.map, center, zoom, isFollowingBoat: false } })),
    setFollowBoat: (follow: boolean) =>
      set((s) => ({ map: { ...s.map, isFollowingBoat: follow } })),
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/lib/store/mapSlice.ts
git commit -m "feat(store): add mapSlice — center, zoom, followBoat"
```

---

## Task 5: selectionSlice

**Files:**
- Create: `apps/web/src/lib/store/selectionSlice.ts`

- [ ] **Step 1: Créer le slice sélection**

```typescript
// apps/web/src/lib/store/selectionSlice.ts
'use client';

import type { SelectionState, GameStore } from './types';

export const INITIAL_SELECTION: SelectionState = {
  selectedBoatIds: new Set(),
  editMode: false,
};

export function createSelectionSlice(
  set: (fn: (s: GameStore) => Partial<GameStore>) => void,
) {
  return {
    selection: INITIAL_SELECTION,
    toggleBoat: (id: string) =>
      set((s) => {
        const next = new Set(s.selection.selectedBoatIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return { selection: { ...s.selection, selectedBoatIds: next } };
      }),
    clearSelection: () =>
      set((s) => ({ selection: { ...s.selection, selectedBoatIds: new Set() } })),
    setEditMode: (active: boolean) =>
      set((s) => ({ selection: { ...s.selection, editMode: active } })),
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/lib/store/selectionSlice.ts
git commit -m "feat(store): add selectionSlice — boat selection, editMode"
```

---

## Task 6: timelineSlice

**Files:**
- Create: `apps/web/src/lib/store/timelineSlice.ts`

- [ ] **Step 1: Créer le slice timeline**

```typescript
// apps/web/src/lib/store/timelineSlice.ts
'use client';

import type { TimelineState, PlaybackSpeed, GameStore } from './types';

export const INITIAL_TIMELINE: TimelineState = {
  currentTime: new Date(),
  isLive: true,
  playbackSpeed: 1,
};

export function createTimelineSlice(
  set: (fn: (s: GameStore) => Partial<GameStore>) => void,
) {
  return {
    timeline: INITIAL_TIMELINE,
    setTime: (t: Date) =>
      set(() => ({ timeline: { currentTime: t, isLive: false, playbackSpeed: 1 } })),
    goLive: () =>
      set(() => ({ timeline: { currentTime: new Date(), isLive: true, playbackSpeed: 1 } })),
    setPlaybackSpeed: (speed: PlaybackSpeed) =>
      set((s) => ({ timeline: { ...s.timeline, playbackSpeed: speed } })),
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/lib/store/timelineSlice.ts
git commit -m "feat(store): add timelineSlice — scrubber, live mode, playback speed"
```

---

## Task 7: layersSlice

**Files:**
- Create: `apps/web/src/lib/store/layersSlice.ts`

- [ ] **Step 1: Créer le slice couches avec exclusion mutuelle vent/houle**

```typescript
// apps/web/src/lib/store/layersSlice.ts
'use client';

import type { LayersState, LayerName, GameStore } from './types';

export const INITIAL_LAYERS: LayersState = {
  wind: true,
  swell: false,
  opponents: true,
  zones: true,
};

export function createLayersSlice(
  set: (fn: (s: GameStore) => Partial<GameStore>) => void,
) {
  return {
    layers: INITIAL_LAYERS,
    toggleLayer: (layer: LayerName) =>
      set((s) => {
        const next = { ...s.layers };
        next[layer] = !next[layer];
        // Exclusion mutuelle : vent et houle ne peuvent pas être actifs simultanément
        if (layer === 'wind' && next.wind) next.swell = false;
        if (layer === 'swell' && next.swell) next.wind = false;
        return { layers: next };
      }),
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/lib/store/layersSlice.ts
git commit -m "feat(store): add layersSlice — wind/swell mutual exclusion"
```

---

## Task 8: panelSlice

**Files:**
- Create: `apps/web/src/lib/store/panelSlice.ts`

- [ ] **Step 1: Créer le slice panneaux (un seul à la fois)**

```typescript
// apps/web/src/lib/store/panelSlice.ts
'use client';

import type { PanelState, PanelName, GameStore } from './types';

export const INITIAL_PANEL: PanelState = {
  activePanel: null,
};

export function createPanelSlice(
  set: (fn: (s: GameStore) => Partial<GameStore>) => void,
) {
  return {
    panel: INITIAL_PANEL,
    openPanel: (p: PanelName) =>
      set(() => ({ panel: { activePanel: p } })),
    closePanel: () =>
      set(() => ({ panel: { activePanel: null } })),
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/lib/store/panelSlice.ts
git commit -m "feat(store): add panelSlice — one panel at a time"
```

---

## Task 9: weatherSlice

**Files:**
- Create: `apps/web/src/lib/store/weatherSlice.ts`

- [ ] **Step 1: Créer le slice météo**

```typescript
// apps/web/src/lib/store/weatherSlice.ts
'use client';

import type { WeatherState, WeatherGrid, GameStore } from './types';

export const INITIAL_WEATHER: WeatherState = {
  gridData: null,
  gridExpiresAt: null,
  isLoading: false,
};

export function createWeatherSlice(
  set: (fn: (s: GameStore) => Partial<GameStore>) => void,
) {
  return {
    weather: INITIAL_WEATHER,
    setWeatherGrid: (grid: WeatherGrid, expiresAt: Date) =>
      set(() => ({ weather: { gridData: grid, gridExpiresAt: expiresAt, isLoading: false } })),
    setWeatherLoading: (loading: boolean) =>
      set((s) => ({ weather: { ...s.weather, isLoading: loading } })),
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/lib/store/weatherSlice.ts
git commit -m "feat(store): add weatherSlice — grid cache, loading state"
```

---

## Task 10: connectionSlice

**Files:**
- Create: `apps/web/src/lib/store/connectionSlice.ts`

- [ ] **Step 1: Créer le slice connexion**

```typescript
// apps/web/src/lib/store/connectionSlice.ts
'use client';

import type { ConnectionState, ConnState, GameStore } from './types';

export const INITIAL_CONNECTION: ConnectionState = {
  wsState: 'idle',
};

export function createConnectionSlice(
  set: (fn: (s: GameStore) => Partial<GameStore>) => void,
) {
  return {
    connection: INITIAL_CONNECTION,
    setConnection: (wsState: ConnState) =>
      set(() => ({ connection: { wsState } })),
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/lib/store/connectionSlice.ts
git commit -m "feat(store): add connectionSlice — WebSocket state"
```

---

## Task 11: progSlice

**Files:**
- Create: `apps/web/src/lib/store/progSlice.ts`

- [ ] **Step 1: Créer le slice programmation avec double queue**

```typescript
// apps/web/src/lib/store/progSlice.ts
'use client';

import type { ProgState, OrderEntry, GameStore } from './types';

export const INITIAL_PROG: ProgState = {
  orderQueue: [],
  serverQueue: [],
};

export function createProgSlice(
  set: (fn: (s: GameStore) => Partial<GameStore>) => void,
) {
  return {
    prog: INITIAL_PROG,
    addOrder: (order: OrderEntry) =>
      set((s) => ({ prog: { ...s.prog, orderQueue: [...s.prog.orderQueue, order] } })),
    removeOrder: (id: string) =>
      set((s) => ({
        prog: { ...s.prog, orderQueue: s.prog.orderQueue.filter((o) => o.id !== id) },
      })),
    reorderQueue: (from: number, to: number) =>
      set((s) => {
        const queue = [...s.prog.orderQueue];
        const [moved] = queue.splice(from, 1);
        queue.splice(to, 0, moved);
        return { prog: { ...s.prog, orderQueue: queue } };
      }),
    commitQueue: () =>
      set((s) => ({ prog: { ...s.prog, serverQueue: [...s.prog.orderQueue] } })),
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/lib/store/progSlice.ts
git commit -m "feat(store): add progSlice — order queue with server/work split"
```

---

## Task 12: Composition du store + migration des fonctions WS

**Files:**
- Create: `apps/web/src/lib/store/index.ts`
- Delete: `apps/web/src/lib/store.ts`

- [ ] **Step 1: Créer le store composé**

```typescript
// apps/web/src/lib/store/index.ts
'use client';

import { create } from 'zustand';
import { decode, encode } from '@msgpack/msgpack';
import type { GameStore, BoatLive, ConnState } from './types';
import { INITIAL_HUD, createHudSlice } from './hudSlice';
import { INITIAL_SAIL, createSailSlice } from './sailSlice';
import { INITIAL_MAP, createMapSlice } from './mapSlice';
import { INITIAL_SELECTION, createSelectionSlice } from './selectionSlice';
import { INITIAL_TIMELINE, createTimelineSlice } from './timelineSlice';
import { INITIAL_LAYERS, createLayersSlice } from './layersSlice';
import { INITIAL_PANEL, createPanelSlice } from './panelSlice';
import { INITIAL_WEATHER, createWeatherSlice } from './weatherSlice';
import { INITIAL_CONNECTION, createConnectionSlice } from './connectionSlice';
import { INITIAL_PROG, createProgSlice } from './progSlice';

// Re-export types for consumers
export type { GameStore, HudState, SailState, MapState, SelectionState } from './types';
export type { TimelineState, LayersState, PanelState, WeatherState } from './types';
export type { ConnectionState, ProgState, OrderEntry, BoatLive } from './types';
export type { ConnState, PanelName, LayerName, PlaybackSpeed, TwaColor } from './types';

const SAIL_CODES = ['LW', 'JIB', 'GEN', 'C0', 'HG', 'SPI'] as const;

function twaColorFromCode(code: number): 'optimal' | 'overlap' | 'neutral' | 'deadzone' {
  return code === 0 ? 'deadzone' : code === 2 ? 'optimal' : code === 3 ? 'overlap' : 'neutral';
}

export const useGameStore = create<GameStore>((set) => ({
  // Compose all slices
  ...createHudSlice(set),
  ...createSailSlice(set),
  ...createMapSlice(set),
  ...createSelectionSlice(set),
  ...createTimelineSlice(set),
  ...createLayersSlice(set),
  ...createPanelSlice(set),
  ...createWeatherSlice(set),
  ...createConnectionSlice(set),
  ...createProgSlice(set),

  // Shared state
  boats: new Map(),
  lastTickUnix: null,

  // Broadcast handler — decodes WS messages and updates hud + boats
  applyMessages: (msgs) =>
    set((s) => {
      const nextBoats = new Map(s.boats);
      let nextHud = s.hud;
      let nextSail = s.sail;
      const ownBoatId = process.env['NEXT_PUBLIC_DEMO_BOAT_ID'] ?? 'demo-boat-1';

      for (const m of msgs) {
        const boatId = String(m['boatId'] ?? '');
        if (!boatId) continue;
        nextBoats.set(boatId, {
          id: boatId,
          lat: Number(m['lat'] ?? 0),
          lon: Number(m['lon'] ?? 0),
          hdg: Number(m['hdg'] ?? 0),
          bsp: Number(m['bsp'] ?? 0),
          sail: Number(m['sail'] ?? 0),
          tickSeq: Number(m['tickSeq'] ?? 0),
        });

        if (boatId === ownBoatId) {
          const sailIdx = Number(m['sail'] ?? 2);
          const sail = SAIL_CODES[sailIdx] ?? 'GEN';
          const twaColorCode = Number(m['twaColor'] ?? 1);
          nextHud = {
            ...s.hud,
            lat: Number(m['lat'] ?? s.hud.lat),
            lon: Number(m['lon'] ?? s.hud.lon),
            hdg: Number(m['hdg'] ?? s.hud.hdg),
            bsp: Number(m['bsp'] ?? s.hud.bsp),
            overlapFactor: Number(m['overlapFactor'] ?? s.hud.overlapFactor),
            twaColor: twaColorFromCode(twaColorCode),
          };
          nextSail = { ...s.sail, currentSail: sail };
        }
      }

      return {
        boats: nextBoats,
        hud: nextHud,
        sail: nextSail,
        lastTickUnix: Math.floor(Date.now() / 1000),
      };
    }),
}));

// ---------------------------------------------------------------------------
// WebSocket connection — singleton per raceId
// ---------------------------------------------------------------------------

const WS_BASE = process.env['NEXT_PUBLIC_WS_BASE'] ?? 'ws://localhost:3002';
const WS_LIVE = process.env['NEXT_PUBLIC_WS_LIVE'] === '1';

interface RaceConnection {
  ws: WebSocket | null;
  raceId: string;
  clientSeq: number;
  closed: boolean;
  close(): void;
}

let activeConnection: RaceConnection | null = null;

function decodeFrame(buf: ArrayBufferLike): Record<string, unknown>[] {
  const decoded = decode(new Uint8Array(buf));
  if (Array.isArray(decoded)) return decoded as Record<string, unknown>[];
  return [decoded as Record<string, unknown>];
}

export function connectRace(raceId: string, accessToken?: string): RaceConnection {
  if (activeConnection && activeConnection.raceId === raceId && !activeConnection.closed) {
    return activeConnection;
  }
  if (activeConnection) activeConnection.close();

  const url = `${WS_BASE}/race/${encodeURIComponent(raceId)}`;
  const protocols = accessToken ? [`bearer.${accessToken}`] : undefined;
  useGameStore.getState().setConnection('connecting');

  const state: RaceConnection = {
    ws: null,
    raceId,
    clientSeq: 0,
    closed: false,
    close: () => {
      state.closed = true;
      state.ws?.close();
      if (activeConnection === state) activeConnection = null;
    },
  };
  activeConnection = state;

  let retry = 500;

  const open = (): void => {
    if (state.closed) return;
    const ws = protocols ? new WebSocket(url, protocols) : new WebSocket(url);
    state.ws = ws;
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      useGameStore.getState().setConnection('open');
      retry = 500;
    };
    ws.onmessage = (ev) => {
      if (!(ev.data instanceof ArrayBuffer)) return;
      try {
        const msgs = decodeFrame(ev.data);
        useGameStore.getState().applyMessages(msgs);
      } catch { /* ignore malformed */ }
    };
    ws.onerror = () => useGameStore.getState().setConnection('error');
    ws.onclose = () => {
      useGameStore.getState().setConnection('closed');
      if (!state.closed) {
        setTimeout(open, retry);
        retry = Math.min(retry * 2, 30_000);
      }
    };
  };

  open();
  return state;
}

export interface OrderPayload {
  type: 'CAP' | 'TWA' | 'WPT' | 'SAIL' | 'MODE' | 'VMG';
  value: Record<string, unknown>;
  trigger?: { type: 'IMMEDIATE' } | { type: 'AT_TIME'; time: number };
}

export function sendOrder(payload: OrderPayload): boolean {
  if (!activeConnection?.ws || activeConnection.ws.readyState !== WebSocket.OPEN) {
    return false;
  }
  activeConnection.clientSeq += 1;
  const envelope = {
    type: 'ORDER',
    payload: {
      order: {
        id: `${activeConnection.raceId}-${activeConnection.clientSeq}`,
        type: payload.type,
        value: payload.value,
        trigger: payload.trigger ?? { type: 'IMMEDIATE' },
      },
      clientTs: Date.now(),
      clientSeq: activeConnection.clientSeq,
    },
  };
  activeConnection.ws.send(encode(envelope));
  return true;
}

export function isLiveMode(): boolean {
  return WS_LIVE;
}
```

- [ ] **Step 2: Supprimer l'ancien store**

Run: `rm apps/web/src/lib/store.ts`

- [ ] **Step 3: Mettre à jour les imports dans les composants existants**

Les 4 composants existants importent depuis `@/lib/store`. Avec la nouvelle structure en dossier `store/index.ts`, les imports `from '@/lib/store'` continueront à fonctionner grâce à la résolution automatique de `index.ts`. Cependant, il faut adapter les noms de propriétés car le HUD a changé de forme.

Modifier `apps/web/src/components/play/HudBar.tsx` — remplacer `s.hud.sail` par `s.sail.currentSail` et `s.connection` par `s.connection.wsState` :

Lire le fichier d'abord, puis faire les remplacements nécessaires. Les imports `from '@/lib/store'` restent les mêmes.

Modifier `apps/web/src/components/play/SailPanel.tsx` — même type de changements pour `s.hud.sail` → `s.sail.currentSail`, `s.hud.sailAuto` → `s.sail.sailAuto`, etc.

Modifier `apps/web/src/components/play/Compass.tsx` — mêmes adaptations.

Modifier `apps/web/src/components/play/MapCanvas.tsx` — mêmes adaptations.

Note: Les détails exacts de ces modifications dépendent du contenu actuel de chaque fichier. L'agent d'exécution devra lire chaque fichier et adapter les accès au store. Le pattern est toujours le même : ce qui était `s.hud.sail` devient `s.sail.currentSail`, `s.hud.sailPending` → `s.sail.sailPending`, `s.hud.sailAuto` → `s.sail.sailAuto`, `s.connection` → `s.connection.wsState`.

- [ ] **Step 4: Vérifier la compilation**

Run: `cd apps/web && npx tsc --noEmit 2>&1 | head -30`
Expected: Aucune erreur dans les fichiers store/ et play/

- [ ] **Step 5: Commit**

```bash
git add -A apps/web/src/lib/store/
git add apps/web/src/components/play/HudBar.tsx
git add apps/web/src/components/play/SailPanel.tsx
git add apps/web/src/components/play/Compass.tsx
git add apps/web/src/components/play/MapCanvas.tsx
git rm apps/web/src/lib/store.ts
git commit -m "feat(store): compose 10 slices into unified GameStore, migrate components"
```

---

## Task 13: Nouveau layout CSS Grid

**Files:**
- Modify: `apps/web/src/app/play/[raceId]/page.module.css`

- [ ] **Step 1: Réécrire le CSS avec la grille 3 rangées**

Remplacer le contenu de `page.module.css`. Conserver les styles `blocked*` et `spectate*` existants. Remplacer les styles `.shell`, `.layout`, `.left`, `.right`, `.bottom`, `.actionRail`, `.railBtn`, `.infoCard`, `.raceName`, `.raceMeta` par la nouvelle grille.

```css
/* ── App shell : grille 3 rangées fixes ──────────────── */
.app {
  position: fixed;
  inset: 0;
  display: grid;
  grid-template-rows: var(--hud-h, 56px) 1fr var(--timeline-h, 64px);
  grid-template-columns: minmax(0, 1fr);
  overflow: hidden;
  background: var(--navy-deeper, #060b18);
}

.app > * { min-width: 0; }

/* ── HUD top placeholder (Plan 4 le redesignera) ────── */
.hudRow {
  grid-row: 1;
  z-index: 30;
}

/* ── Map area ────────────────────────────────────────── */
.mapArea {
  grid-row: 2;
  position: relative;
  overflow: hidden;
}

/* ── Timeline placeholder (Plans suivants) ───────────── */
.timelineRow {
  grid-row: 3;
  z-index: 30;
  background: var(--navy, #1a2840);
  border-top: 1px solid rgba(245, 240, 232, 0.16);
  display: flex;
  align-items: center;
  justify-content: center;
}

.timelinePlaceholder {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.16em;
  color: rgba(245, 240, 232, 0.42);
  text-transform: uppercase;
}

/* ── Floating elements in map area ───────────────────── */
.rightStack {
  position: absolute;
  bottom: 16px;
  right: 16px;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  z-index: 20;
  pointer-events: auto;
}

.mapOverlays {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 10;
}
.mapOverlays > * { pointer-events: auto; }

/* ── Action buttons (right stack) ────────────────────── */
.actionButtons {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.actionBtn {
  width: 52px;
  height: 52px;
  background: rgba(12, 20, 36, 0.92);
  border: 1px solid rgba(245, 240, 232, 0.16);
  color: var(--on-dark-1, #f5f0e8);
  border-radius: 4px;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  cursor: pointer;
  font-family: var(--font-mono);
  font-weight: 700;
  font-size: 9px;
  letter-spacing: 0.10em;
  text-transform: uppercase;
  transition: background 150ms, border-color 150ms;
}
.actionBtn:hover {
  background: var(--navy-deep, #0c1424);
  border-color: rgba(245, 240, 232, 0.28);
}
.actionBtn.active {
  background: var(--gold, #c9a227);
  color: var(--navy, #1a2840);
  border-color: var(--gold, #c9a227);
}
.actionBtnIcon { font-size: 18px; line-height: 1; }

.zoomGroup {
  display: flex;
  flex-direction: column;
  border-radius: 4px;
  overflow: hidden;
  border: 1px solid rgba(245, 240, 232, 0.16);
  background: rgba(12, 20, 36, 0.92);
}
.zoomBtn {
  width: 52px;
  height: 38px;
  background: transparent;
  border: none;
  color: var(--on-dark-1, #f5f0e8);
  font-size: 18px;
  cursor: pointer;
  transition: background 150ms;
}
.zoomBtn:hover { background: rgba(255, 255, 255, 0.06); }
.zoomBtn + .zoomBtn {
  border-top: 1px solid rgba(245, 240, 232, 0.16);
}

/* ── Ranking tab (left edge) ─────────────────────────── */
.rankingTab {
  position: absolute;
  top: 50%;
  left: 0;
  transform: translateY(-50%);
  background: rgba(12, 20, 36, 0.92);
  border: 1px solid rgba(245, 240, 232, 0.16);
  border-left: none;
  color: var(--on-dark-1, #f5f0e8);
  padding: 16px 10px;
  border-radius: 0 4px 4px 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  z-index: 20;
  transition: background 150ms;
}
.rankingTab:hover { background: var(--navy-deep, #0c1424); }
.rankingTabArrow {
  font-family: var(--font-mono);
  font-size: 14px;
  color: rgba(245, 240, 232, 0.72);
}
.rankingTabLabel {
  font-family: var(--font-display);
  font-size: 11px;
  letter-spacing: 0.18em;
  writing-mode: vertical-rl;
  transform: rotate(180deg);
}
.rankingTabRank {
  font-family: var(--font-display);
  font-size: 18px;
  color: var(--gold, #c9a227);
}
```

Note: conserver les styles `blocked*`, `spectate*`, `mapSkeleton`, et `skeletonLabel` existants tels quels — ne pas les supprimer.

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/play/[raceId]/page.module.css
git commit -m "feat(layout): CSS Grid 3-row layout for play screen"
```

---

## Task 14: Refonte PlayClient

**Files:**
- Modify: `apps/web/src/app/play/[raceId]/PlayClient.tsx`

- [ ] **Step 1: Réécrire PlayClient avec le nouveau layout**

```tsx
// apps/web/src/app/play/[raceId]/PlayClient.tsx
'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { RaceSummary } from '@/lib/api';
import { connectRace, useGameStore } from '@/lib/store';
import {
  ANONYMOUS, decideRaceAccess, readClientSession, spectateBanner,
  type SessionContext,
} from '@/lib/access';
import HudBar from '@/components/play/HudBar';
import Compass from '@/components/play/Compass';
import styles from './page.module.css';

const MapCanvas = dynamic(() => import('@/components/play/MapCanvas'), {
  ssr: false,
  loading: () => (
    <div className={styles.mapSkeleton}>
      <span className={styles.skeletonLabel}>Chargement de la carte nautique…</span>
    </div>
  ),
});

function useTicker(raceId: string): void {
  useEffect(() => {
    const live = process.env['NEXT_PUBLIC_WS_LIVE'] === '1';
    if (live) {
      const token = document.cookie
        .split(';')
        .map((c) => c.trim())
        .find((c) => c.startsWith('nemo_access_token='))
        ?.slice('nemo_access_token='.length);
      const conn = connectRace(raceId, token);
      return () => conn.close();
    }
    // Dev stub — seed HUD with mock data
    useGameStore.getState().setHud({
      lat: 47.0, lon: -3.0, twd: 270, tws: 18, hdg: 216,
      twa: 128, twaColor: 'optimal', bsp: 11.4, vmg: 9.8,
      dtf: 1642, overlapFactor: 0.94, rank: 12, totalParticipants: 428,
      rankTrend: 2, wearGlobal: 82,
      wearDetail: { hull: 88, rig: 79, sails: 75, electronics: 86 },
    });
    useGameStore.getState().setConnection('open');
    return undefined;
  }, [raceId]);
}

export default function PlayClient({ race }: { race: RaceSummary }): React.ReactElement {
  const [session, setSession] = useState<SessionContext>(ANONYMOUS);
  const [isRegistered, setIsRegistered] = useState(false);
  const activePanel = useGameStore((s) => s.panel.activePanel);
  const openPanel = useGameStore((s) => s.openPanel);
  const rank = useGameStore((s) => s.hud.rank);

  useEffect(() => {
    setSession(readClientSession());
    if (typeof document !== 'undefined' && document.cookie.includes('nemo_access_token=')) {
      setIsRegistered(true);
    }
  }, []);

  const access = useMemo(
    () => decideRaceAccess({ race, session, isRegistered }),
    [race, session, isRegistered],
  );
  const banner = spectateBanner(access);
  const canInteract = access.kind === 'play';

  useTicker(race.id);

  // Blocked state
  if (access.kind === 'blocked') {
    return (
      <div className={styles.blockedShell}>
        <div className={styles.blockedCard}>
          <p className={styles.blockedEyebrow}>Accès refusé</p>
          <h1 className={styles.blockedTitle}>
            {access.reason === 'draft' && 'Cette course n\'est pas encore publiée.'}
            {access.reason === 'archived' && 'Cette course a été archivée.'}
            {access.reason === 'admin-only' && 'Page réservée aux administrateurs.'}
          </h1>
          <Link href="/races" className={styles.blockedBack}>← Retour aux courses</Link>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.app}>
      {/* Row 1 — HUD */}
      <div className={styles.hudRow}>
        {canInteract && <HudBar />}
      </div>

      {/* Row 2 — Map + floating elements */}
      <div className={styles.mapArea}>
        <MapCanvas />

        {/* Spectator banner */}
        {banner && access.kind === 'spectate' && (
          <div className={styles.spectateBanner} role="status">
            <span className={styles.spectateTag}>Spectateur</span>
            <span className={styles.spectateText}>{banner}</span>
            {access.reason === 'visitor' && (
              <Link href="/login" className={styles.spectateCta}>Se connecter →</Link>
            )}
            {access.reason === 'not-registered' && (
              <Link href="/races" className={styles.spectateCta}>S'inscrire →</Link>
            )}
          </div>
        )}

        {/* Ranking tab (left edge) */}
        <button
          className={styles.rankingTab}
          onClick={() => openPanel(activePanel === 'ranking' ? null as never : 'ranking')}
          title="Classement (C)"
          type="button"
        >
          <span className={styles.rankingTabArrow}>
            {activePanel === 'ranking' ? '◀' : '▶'}
          </span>
          <span className={styles.rankingTabLabel}>CLASSEMENT</span>
          <span className={styles.rankingTabRank}>{rank}</span>
        </button>

        {/* Right stack — action buttons + compass */}
        {canInteract && (
          <div className={styles.rightStack}>
            <div className={styles.actionButtons}>
              <button
                className={`${styles.actionBtn} ${activePanel === 'sails' ? styles.active : ''}`}
                onClick={() => openPanel(activePanel === 'sails' ? null as never : 'sails')}
                title="Voiles (V)"
                type="button"
              >
                <span className={styles.actionBtnIcon}>⛵</span>
                <span>Voiles</span>
              </button>
              <button
                className={`${styles.actionBtn} ${activePanel === 'programming' ? styles.active : ''}`}
                onClick={() => openPanel(activePanel === 'programming' ? null as never : 'programming')}
                title="Programmation (P)"
                type="button"
              >
                <span className={styles.actionBtnIcon}>≡</span>
                <span>Prog.</span>
              </button>
              <button
                className={styles.actionBtn}
                onClick={() => useGameStore.getState().setFollowBoat(true)}
                title="Recentrer (Espace)"
                type="button"
              >
                <span className={styles.actionBtnIcon}>⊕</span>
                <span>Centrer</span>
              </button>
              <div className={styles.zoomGroup}>
                <button className={styles.zoomBtn} title="Zoom +" type="button">+</button>
                <button className={styles.zoomBtn} title="Zoom −" type="button">−</button>
              </div>
            </div>
            <Compass />
          </div>
        )}
      </div>

      {/* Row 3 — Timeline placeholder */}
      <div className={styles.timelineRow}>
        <span className={styles.timelinePlaceholder}>Timeline météo — Plan 8</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Vérifier la compilation**

Run: `cd apps/web && npx tsc --noEmit 2>&1 | head -30`
Expected: Pas d'erreur dans PlayClient.tsx

- [ ] **Step 3: Tester visuellement**

Run: `cd apps/web && pnpm dev`
Ouvrir http://localhost:3000/play/vendee-express (ou un ID de course existant).
Vérifier :
- La grille 3 rangées est visible (HUD en haut, carte au centre, timeline placeholder en bas)
- Le compass est en bas à droite
- Les boutons Voiles/Prog/Centrer/Zoom sont au-dessus du compass
- L'onglet Classement est à gauche
- La carte remplit l'espace central

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/play/[raceId]/PlayClient.tsx
git commit -m "feat(play): refactor PlayClient with CSS Grid layout + new store"
```

---

## Task 15: Nettoyage et vérification finale

- [ ] **Step 1: Vérifier qu'il n'y a plus d'import de l'ancien `@/lib/store.ts`**

Run: `grep -r "from '@/lib/store'" apps/web/src/ --include="*.ts" --include="*.tsx" | grep -v "store/index" | grep -v node_modules`

Tous les résultats doivent pointer vers des fichiers qui importent `from '@/lib/store'` — ce qui résout vers `store/index.ts`. Vérifier qu'aucun fichier n'importe des noms qui n'existent plus (par ex. l'ancienne interface `Store`, ou `HudState` directement depuis le vieux fichier).

- [ ] **Step 2: Typecheck complet**

Run: `cd apps/web && npx tsc --noEmit`
Expected: 0 erreurs

- [ ] **Step 3: Vérifier que le dev server démarre**

Run: `cd apps/web && pnpm dev`
Expected: compilation sans erreur, page /play accessible

- [ ] **Step 4: Commit final de nettoyage si nécessaire**

```bash
git add -A apps/web/
git commit -m "chore: cleanup old store imports, verify typecheck"
```

---

## Résumé des livrables

À la fin de ce plan :
- ✅ Store Zustand avec 10 slices typés et composés
- ✅ Layout CSS Grid 3 rangées (HUD / Map / Timeline)
- ✅ PlayClient refactorisé avec le nouveau layout
- ✅ Boutons action (Voiles, Prog, Centrer, Zoom) dans le right-stack
- ✅ Onglet Classement à gauche (placeholder, pas de panel encore)
- ✅ Timeline placeholder en bas
- ✅ Composants existants (HudBar, Compass, SailPanel, MapCanvas) migrés vers le nouveau store
- ✅ Typecheck clean
