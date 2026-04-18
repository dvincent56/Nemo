# Marina Upgrades — Plan 3 : UI Refonte

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refondre les pages `/marina` et `/marina/[boatId]` pour consommer les 9 endpoints API (Plan 2), afficher les 7 slots d'upgrades avec drawer latéral, et ajouter les modales de réparation et de vente.

**Architecture:** La page liste passe d'un grid plat à un layout groupé par classe avec bouton "+ Nouvelle coque". La page détail remplace les 6 catégories de variantes par 7 cartes slot avec drawer slide-out (onglets Installer/Acheter). Deux modales (`<dialog>`) pour réparation et vente. Les données mockées dans `data.ts` sont remplacées par des appels API réels via un nouveau module `marina-api.ts`, avec fallback mock si la DB est absente.

**Tech Stack:** Next.js 16.2.3 (App Router, Server/Client Components), React 19.2, CSS Modules, `<dialog>` natif HTML.

**Spec source :** [docs/superpowers/specs/2026-04-16-marina-upgrades-design.md](../specs/2026-04-16-marina-upgrades-design.md) — sections C.1–C.6.

**Dépendance :** Plan 2 (API REST) mergé sur `main` — ✅ fait (2026-04-18).

---

## Pré-requis : 2 endpoints manquants

Le Plan 2 n'a pas implémenté les endpoints de lecture nécessaires à l'UI :
- **GET /players/me/boats** — liste la flotte du joueur (pour `/marina`)
- **GET /boats/:id** — détail d'un bateau avec upgrades installés (pour `/marina/[boatId]`)

Ces endpoints sont ajoutés en Task 1 de ce plan.

---

## File Structure

### Files to create

| Path | Responsabilité |
|---|---|
| `apps/web/src/lib/marina-api.ts` | Fonctions fetch/mutation vers les 11 endpoints marina |
| `apps/web/src/app/marina/[boatId]/SlotCard.tsx` | Carte d'un slot d'upgrade (équipé, monotype, absent) |
| `apps/web/src/app/marina/[boatId]/SlotCard.module.css` | Styles de SlotCard |
| `apps/web/src/app/marina/[boatId]/SlotDrawer.tsx` | Drawer latéral pour changer un slot (onglets Installer/Acheter) |
| `apps/web/src/app/marina/[boatId]/SlotDrawer.module.css` | Styles du drawer |
| `apps/web/src/app/marina/[boatId]/RepairModal.tsx` | Modale de réparation (coût par axe + confirmation) |
| `apps/web/src/app/marina/[boatId]/RepairModal.module.css` | Styles de la modale réparation |
| `apps/web/src/app/marina/[boatId]/SellModal.tsx` | Modale de vente (irréversible, palmarès, upgrades retournés) |
| `apps/web/src/app/marina/[boatId]/SellModal.module.css` | Styles de la modale vente |

### Files to modify

| Path | Changement |
|---|---|
| `apps/game-engine/src/api/marina.ts` | Ajouter GET /players/me/boats + GET /boats/:id |
| `apps/web/src/app/marina/data.ts` | Remplacer les types par les types API, mettre à jour le mock |
| `apps/web/src/app/marina/page.tsx` | Layout groupé par classe + bouton "+ Nouvelle" + API |
| `apps/web/src/app/marina/page.module.css` | Classes pour le layout par classe |
| `apps/web/src/app/marina/[boatId]/BoatDetailView.tsx` | Slot cards + action bar + lock states + modales |
| `apps/web/src/app/marina/[boatId]/page.module.css` | Styles refondus pour slots + action bar |

---

## Task 1 — Backend : 2 endpoints de lecture

**Files:**
- Modify: `apps/game-engine/src/api/marina.ts`

- [ ] **Step 1: Ajouter GET /players/me/boats dans `registerMarinaRoutes`**

Ajouter dans `apps/game-engine/src/api/marina.ts`, après le GET /players/me/upgrades :

```typescript
  // =========================================================================
  // GET /api/v1/players/me/boats — list player's fleet
  // =========================================================================

  app.get('/api/v1/players/me/boats', { preHandler: [enforceAuth] }, async (req, reply) => {
    const auth = req.auth!;
    const db = getDb();
    if (!db) { reply.code(503); return { error: 'database unavailable' }; }

    const player = await findPlayerBySub(db, auth.sub);
    if (!player) { reply.code(404); return { error: 'player not found' }; }

    const playerBoats = await db.select().from(boats)
      .where(and(eq(boats.ownerId, player.id), eq(boats.status, 'ACTIVE')));

    return { boats: playerBoats, credits: player.credits };
  });
```

- [ ] **Step 2: Ajouter GET /boats/:id dans `registerMarinaRoutes`**

```typescript
  // =========================================================================
  // GET /api/v1/boats/:id — boat detail with installed upgrades
  // =========================================================================

  app.get<{ Params: { id: string } }>(
    '/api/v1/boats/:id',
    { preHandler: [enforceAuth] },
    async (req, reply) => {
      const auth = req.auth!;
      const db = getDb();
      if (!db) { reply.code(503); return { error: 'database unavailable' }; }

      const boatId = req.params.id;
      if (!isValidUuid(boatId)) { reply.code(400); return { error: 'invalid boat id' }; }

      const player = await findPlayerBySub(db, auth.sub);
      if (!player) { reply.code(404); return { error: 'player not found' }; }

      const boat = await findOwnedBoat(db, boatId, player.id);
      if (!boat) { reply.code(404); return { error: 'boat not found' }; }

      const installedUpgrades = await loadInstalledWithCatalog(db, boatId);

      return {
        boat,
        installedUpgrades: installedUpgrades.map((u) => ({
          slot: u.slot,
          playerUpgradeId: u.playerUpgradeId,
          catalogId: u.catalogId,
          name: u.catalogItem?.name ?? u.catalogId,
          tier: u.catalogItem?.tier ?? 'SERIE',
          profile: u.catalogItem?.profile ?? '',
          effects: u.catalogItem?.effects ?? null,
        })),
        credits: player.credits,
      };
    },
  );
```

- [ ] **Step 3: Vérifier la compilation**

Run: `cd apps/game-engine && npx tsc --noEmit 2>&1 | grep marina`
Expected: aucune erreur

- [ ] **Step 4: Commit**

```bash
git add apps/game-engine/src/api/marina.ts
git commit -m "feat(marina): add GET /players/me/boats + GET /boats/:id endpoints"
```

---

## Task 2 — API client frontend

**Files:**
- Create: `apps/web/src/lib/marina-api.ts`

- [ ] **Step 1: Créer le module API client marina**

Créer `apps/web/src/lib/marina-api.ts` :

```typescript
import { API_BASE } from './api';

// ---------------------------------------------------------------------------
// Types — match the game-engine API responses
// ---------------------------------------------------------------------------

export type BoatClass = 'FIGARO' | 'CLASS40' | 'OCEAN_FIFTY' | 'IMOCA60' | 'ULTIM';
export type UpgradeSlot = 'HULL' | 'MAST' | 'SAILS' | 'FOILS' | 'KEEL' | 'ELECTRONICS' | 'REINFORCEMENT';
export type UpgradeTier = 'SERIE' | 'BRONZE' | 'SILVER' | 'GOLD' | 'PROTO';
export type SlotAvailability = 'open' | 'monotype' | 'absent';

export interface BoatRecord {
  id: string;
  name: string;
  boatClass: string;
  hullColor: string | null;
  deckColor?: string | null;
  generation: number;
  status: 'ACTIVE' | 'SOLD' | 'ARCHIVED';
  activeRaceId: string | null;
  racesCount: number;
  wins: number;
  podiums: number;
  top10Finishes: number;
  hullCondition: number;
  rigCondition: number;
  sailCondition: number;
  elecCondition: number;
  createdAt: string;
}

export interface InstalledUpgrade {
  slot: UpgradeSlot;
  playerUpgradeId: string;
  catalogId: string;
  name: string;
  tier: UpgradeTier;
  profile: string;
  effects: CatalogEffects | null;
}

export interface CatalogEffects {
  speedByTwa: [number, number, number, number, number];
  speedByTws: [number, number, number];
  wearMul?: { hull?: number; rig?: number; sail?: number; elec?: number };
  maneuverMul?: Record<string, { dur: number; speed: number }>;
  polarTargetsDeg: number | null;
  activation?: { minTws?: number; maxTws?: number };
  groundingLossMul: number | null;
}

export interface CatalogItem {
  id: string;
  slot: UpgradeSlot;
  tier: UpgradeTier;
  name: string;
  profile: string;
  description: string;
  compat: BoatClass[];
  cost: number | null;
  effects: CatalogEffects;
  unlockCriteria?: { racesFinished?: number; avgRankPctMax?: number; or?: boolean };
}

export interface InventoryItem {
  id: string;
  upgradeCatalogId: string;
  name: string;
  slot: UpgradeSlot | null;
  tier: UpgradeTier | null;
  acquiredAt: string;
  acquisitionSource: string;
  installedOn: { boatId: string; slot: UpgradeSlot } | null;
}

export interface RepairBreakdown {
  hull: number;
  rig: number;
  sail: number;
  elec: number;
  total: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function authHeaders(): HeadersInit {
  return { 'Content-Type': 'application/json' };
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(new URL(path, API_BASE), {
    credentials: 'include',
    ...init,
    headers: { ...authHeaders(), ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw Object.assign(new Error(body.error ?? `API ${res.status}`), { status: res.status, body });
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Read endpoints
// ---------------------------------------------------------------------------

export async function fetchMyBoats(): Promise<{ boats: BoatRecord[]; credits: number }> {
  return apiFetch('/api/v1/players/me/boats');
}

export async function fetchBoatDetail(boatId: string): Promise<{
  boat: BoatRecord;
  installedUpgrades: InstalledUpgrade[];
  credits: number;
}> {
  return apiFetch(`/api/v1/boats/${boatId}`);
}

export async function fetchCatalog(boatClass?: string): Promise<{
  items: CatalogItem[];
  slots: UpgradeSlot[];
  slotsByClass: Record<string, Record<UpgradeSlot, SlotAvailability>>;
  tiers: Record<UpgradeTier, { maintenanceMul: number }>;
}> {
  const q = boatClass ? `?boatClass=${boatClass}` : '';
  return apiFetch(`/api/v1/upgrades/catalog${q}`);
}

export async function fetchMyUpgrades(): Promise<{
  inventory: InventoryItem[];
  credits: number;
}> {
  return apiFetch('/api/v1/players/me/upgrades');
}

// ---------------------------------------------------------------------------
// Mutation endpoints
// ---------------------------------------------------------------------------

export async function createBoat(boatClass: string, name: string) {
  return apiFetch<{ id: string; name: string; boatClass: string }>('/api/v1/boats', {
    method: 'POST',
    body: JSON.stringify({ boatClass, name }),
  });
}

export async function purchaseUpgrade(itemId: string) {
  return apiFetch<{ upgrade: { id: string }; creditsRemaining: number }>('/api/v1/upgrades/purchase', {
    method: 'POST',
    body: JSON.stringify({ itemId }),
  });
}

export async function installUpgrade(boatId: string, playerUpgradeId: string) {
  return apiFetch<{ ok: boolean; slot: string }>(`/api/v1/boats/${boatId}/install`, {
    method: 'POST',
    body: JSON.stringify({ playerUpgradeId }),
  });
}

export async function uninstallUpgrade(boatId: string, slot: string) {
  return apiFetch<{ ok: boolean; returnedToInventory: string }>(`/api/v1/boats/${boatId}/uninstall`, {
    method: 'POST',
    body: JSON.stringify({ slot }),
  });
}

export async function buyAndInstall(itemId: string, boatId: string) {
  return apiFetch<{ upgrade: { id: string }; installedOn: { boatId: string; slot: string }; creditsRemaining: number }>(
    '/api/v1/upgrades/buy-and-install',
    { method: 'POST', body: JSON.stringify({ itemId, boatId }) },
  );
}

export async function repairBoat(boatId: string) {
  return apiFetch<{ repaired: boolean; cost: RepairBreakdown; creditsRemaining: number }>(
    `/api/v1/boats/${boatId}/repair`,
    { method: 'POST' },
  );
}

export async function sellBoat(boatId: string) {
  return apiFetch<{
    sold: boolean;
    sellPrice: number;
    creditsAfter: number;
    returnedUpgrades: { playerUpgradeId: string; catalogId: string; name: string; tier: string }[];
  }>(`/api/v1/boats/${boatId}`, { method: 'DELETE' });
}
```

- [ ] **Step 2: Vérifier la compilation**

Run: `cd apps/web && npx tsc --noEmit 2>&1 | grep marina-api`
Expected: aucune erreur

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/marina-api.ts
git commit -m "feat(web): add marina API client with all endpoint functions"
```

---

## Task 3 — Refonte data.ts (types + mock alignés API)

**Files:**
- Modify: `apps/web/src/app/marina/data.ts`

- [ ] **Step 1: Réécrire data.ts avec les types alignés sur l'API**

Remplacer entièrement `apps/web/src/app/marina/data.ts` par le contenu suivant. Les types principaux sont réexportés depuis `marina-api.ts`. Le mock `MARINA_SEED` est restructuré pour matcher la réponse de `GET /players/me/boats`. Le mock `BOAT_DETAILS` est restructuré pour matcher `GET /boats/:id`.

```typescript
/**
 * Marina — types et mock data.
 * Les types correspondent aux réponses API (Plan 2).
 * Le mock sert de fallback quand DATABASE_URL n'est pas configuré.
 */
import type { BoatRecord, InstalledUpgrade, UpgradeSlot, UpgradeTier, BoatClass } from '@/lib/marina-api';
export type { BoatRecord, InstalledUpgrade, UpgradeSlot, UpgradeTier, BoatClass };

export const CLASS_LABEL: Record<string, string> = {
  FIGARO: 'Figaro III',
  CLASS40: 'Class40',
  OCEAN_FIFTY: 'Ocean Fifty',
  IMOCA60: 'IMOCA 60',
  ULTIM: 'Ultim',
};

export const SLOT_LABEL: Record<UpgradeSlot, string> = {
  HULL: 'Coque',
  MAST: 'Mât',
  SAILS: 'Voiles',
  FOILS: 'Foils',
  KEEL: 'Quille',
  ELECTRONICS: 'Électronique',
  REINFORCEMENT: 'Renfort',
};

export const TIER_LABEL: Record<UpgradeTier, string> = {
  SERIE: 'Série',
  BRONZE: 'Bronze',
  SILVER: 'Silver',
  GOLD: 'Gold',
  PROTO: 'Proto',
};

export const ALL_CLASSES: BoatClass[] = ['FIGARO', 'CLASS40', 'OCEAN_FIFTY', 'IMOCA60', 'ULTIM'];
export const MAX_BOATS_PER_CLASS = 5;

// ---------------------------------------------------------------------------
// Race history (for boat detail)
// ---------------------------------------------------------------------------

export interface BoatRaceHistoryEntry {
  raceId: string;
  raceName: string;
  raceBoatClass: string;
  raceDate: string;
  finalRank: number;
  raceDistanceNm: number;
  durationLabel: string;
  creditsEarned: number;
}

// ---------------------------------------------------------------------------
// Mock data — fallback quand pas de DB
// ---------------------------------------------------------------------------

export const MOCK_BOATS: BoatRecord[] = [
  {
    id: 'b-albatros', name: 'Albatros', boatClass: 'CLASS40',
    hullColor: '#1a2840', deckColor: '#c9a227', generation: 1,
    status: 'ACTIVE', activeRaceId: 'r-fastnet-sprint',
    racesCount: 12, wins: 0, podiums: 2, top10Finishes: 5,
    hullCondition: 78, rigCondition: 92, sailCondition: 85, elecCondition: 100,
    createdAt: '2026-01-15T10:00:00Z',
  },
  {
    id: 'b-mistral', name: 'Mistral', boatClass: 'CLASS40',
    hullColor: '#2d4a6f', deckColor: '#e4ddd0', generation: 1,
    status: 'ACTIVE', activeRaceId: null,
    racesCount: 8, wins: 1, podiums: 1, top10Finishes: 3,
    hullCondition: 100, rigCondition: 100, sailCondition: 100, elecCondition: 100,
    createdAt: '2026-02-10T14:00:00Z',
  },
  {
    id: 'b-sirocco', name: 'Sirocco', boatClass: 'FIGARO',
    hullColor: '#8b0000', deckColor: null, generation: 1,
    status: 'ACTIVE', activeRaceId: null,
    racesCount: 22, wins: 3, podiums: 5, top10Finishes: 12,
    hullCondition: 65, rigCondition: 70, sailCondition: 50, elecCondition: 90,
    createdAt: '2026-01-05T08:00:00Z',
  },
];

export const MOCK_CREDITS = 12480;

export const MOCK_INSTALLED: Record<string, InstalledUpgrade[]> = {
  'b-albatros': [
    { slot: 'FOILS', playerUpgradeId: 'pu-1', catalogId: 'foils-class40-c', name: 'Foils en C', tier: 'BRONZE', profile: 'reaching nerveux', effects: null },
    { slot: 'ELECTRONICS', playerUpgradeId: 'pu-2', catalogId: 'electronics-pack-race', name: 'Pack régate', tier: 'BRONZE', profile: 'cibles polaires', effects: null },
  ],
  'b-mistral': [
    { slot: 'SAILS', playerUpgradeId: 'pu-3', catalogId: 'sails-class40-mylar', name: 'Voiles Mylar', tier: 'SILVER', profile: 'polyvalent stable', effects: null },
  ],
  'b-sirocco': [],
};

export const MOCK_HISTORY: Record<string, BoatRaceHistoryEntry[]> = {
  'b-albatros': [
    { raceId: 'r-fastnet-sprint', raceName: 'Fastnet Sprint', raceBoatClass: 'CLASS40', raceDate: '2026-04-10', finalRank: 3, raceDistanceNm: 615, durationLabel: '2j 18h', creditsEarned: 1850 },
    { raceId: 'r-tjv-1', raceName: 'Transat Jacques Vabre', raceBoatClass: 'CLASS40', raceDate: '2026-03-15', finalRank: 7, raceDistanceNm: 4350, durationLabel: '12j 06h', creditsEarned: 3200 },
  ],
  'b-mistral': [
    { raceId: 'r-channel-cup', raceName: 'Channel Cup', raceBoatClass: 'CLASS40', raceDate: '2026-04-05', finalRank: 1, raceDistanceNm: 280, durationLabel: '1j 04h', creditsEarned: 2400 },
  ],
  'b-sirocco': [],
};
```

- [ ] **Step 2: Vérifier la compilation**

Run: `cd apps/web && npx tsc --noEmit 2>&1 | head -20`
Expected: erreurs dans les fichiers qui importent les anciens types — c'est attendu, on les corrige dans les tasks suivantes.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/marina/data.ts
git commit -m "refactor(marina): align data types with API response format"
```

---

## Task 4 — Refonte page `/marina` (layout par classe)

**Files:**
- Modify: `apps/web/src/app/marina/page.tsx`
- Modify: `apps/web/src/app/marina/page.module.css`

- [ ] **Step 1: Réécrire page.tsx avec layout groupé par classe**

Remplacer `apps/web/src/app/marina/page.tsx` :

```typescript
'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Eyebrow, BoatSvg } from '@/components/ui';
import { SiteShell } from '@/components/ui/SiteShell';
import {
  fetchMyBoats, createBoat,
  type BoatRecord,
} from '@/lib/marina-api';
import {
  CLASS_LABEL, ALL_CLASSES, MAX_BOATS_PER_CLASS,
  MOCK_BOATS, MOCK_CREDITS,
} from './data';
import styles from './page.module.css';

function BoatCard({ boat }: { boat: BoatRecord }): React.ReactElement {
  const inRace = !!boat.activeRaceId;
  const stateLabel = inRace ? `En course · ${boat.activeRaceId}` : 'Au port';
  const stateCls = inRace ? styles.stateInRace : styles.stateIdle;
  const cardCls = `${styles.card} ${inRace ? styles.cardActive : ''}`;

  return (
    <Link href={`/marina/${boat.id}` as Parameters<typeof Link>[0]['href']} className={cardCls}>
      <header className={styles.head}>
        <span className={`${styles.state} ${stateCls}`}>{stateLabel}</span>
      </header>
      <h3 className={styles.name}>{boat.name}</h3>
      <div className={styles.render}>
        <BoatSvg className={styles.renderSvg} hullColor={boat.hullColor ?? '#1a2840'} deckColor={boat.deckColor ?? undefined} />
      </div>
      <div className={styles.stats}>
        <div>
          <p className={styles.statLabel}>Courses</p>
          <p className={styles.statValue}>{String(boat.racesCount).padStart(2, '0')}</p>
        </div>
        <div>
          <p className={styles.statLabel}>Podiums</p>
          <p className={`${styles.statValue} ${styles.statValueGold}`}>{boat.podiums}</p>
        </div>
        <div>
          <p className={styles.statLabel}>Condition</p>
          <p className={styles.statValue}>
            {Math.round((boat.hullCondition + boat.rigCondition + boat.sailCondition + boat.elecCondition) / 4)}%
          </p>
        </div>
      </div>
      <div className={styles.cta}>
        <span>Détail bateau</span>
        <span className={styles.ctaArrow}>→</span>
      </div>
    </Link>
  );
}

function NewBoatButton({ boatClass, onCreated }: {
  boatClass: string;
  onCreated: () => void;
}): React.ReactElement {
  const router = useRouter();
  const label = CLASS_LABEL[boatClass] ?? boatClass;
  const [busy, setBusy] = useState(false);

  const handleCreate = async () => {
    setBusy(true);
    try {
      const defaultName = `${label} ${Date.now() % 1000}`;
      const result = await createBoat(boatClass, defaultName);
      onCreated();
      router.push(`/marina/${result.id}/customize`);
    } catch (err) {
      console.error('create boat failed', err);
      setBusy(false);
    }
  };

  return (
    <button type="button" className={`${styles.card} ${styles.cardNew}`} onClick={handleCreate} disabled={busy}>
      <span className={styles.newIcon}>+</span>
      <span className={styles.newLabel}>Nouvelle {label}</span>
    </button>
  );
}

export default function MarinaPage(): React.ReactElement {
  const [boats, setBoats] = useState<BoatRecord[]>(MOCK_BOATS);
  const [credits, setCredits] = useState(MOCK_CREDITS);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await fetchMyBoats();
      setBoats(data.boats);
      setCredits(data.credits);
    } catch {
      // API unavailable — keep mock data
    }
    setLoaded(true);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Group boats by class
  const byClass = new Map<string, BoatRecord[]>();
  for (const cls of ALL_CLASSES) byClass.set(cls, []);
  for (const b of boats) {
    const list = byClass.get(b.boatClass);
    if (list) list.push(b);
  }

  // Classes with at least one boat = unlocked
  const totalBoats = boats.length;

  return (
    <SiteShell>
      <section className={styles.hero}>
        <div className={styles.heroMain}>
          <Eyebrow trailing="Ta carrière">Saison 2026</Eyebrow>
          <h1 className={styles.title}>Marina</h1>
        </div>
        <div>
          <p className={styles.heroMeta}>
            Ta flotte personnelle. Chaque bateau te suit de course en course,
            gagne en performance avec tes <strong>upgrades</strong> et porte tes couleurs.
          </p>
          <div className={styles.counters}>
            <div className={styles.counter}>
              <p className={styles.counterLabel}>Bateaux</p>
              <p className={styles.counterValue}>{String(totalBoats).padStart(2, '0')}</p>
            </div>
            <div className={styles.counter}>
              <p className={styles.counterLabel}>Crédits</p>
              <p className={styles.counterValue}>
                {credits.toLocaleString('fr-FR')}<small>cr.</small>
              </p>
            </div>
          </div>
        </div>
      </section>

      <main className={styles.fleet} aria-label="Flotte du skipper">
        {ALL_CLASSES.map((cls) => {
          const classBoats = byClass.get(cls) ?? [];
          const unlocked = classBoats.length > 0;
          const label = CLASS_LABEL[cls] ?? cls;

          return (
            <section key={cls} className={styles.classSection}>
              <header className={styles.classHeader}>
                <h2 className={styles.className}>{label}</h2>
                <span className={styles.classCount}>
                  {unlocked ? `${classBoats.length}/${MAX_BOATS_PER_CLASS} coques` : 'Verrouillée'}
                </span>
              </header>

              {unlocked ? (
                <div className={styles.classGrid}>
                  {classBoats.map((b) => <BoatCard key={b.id} boat={b} />)}
                  {classBoats.length < MAX_BOATS_PER_CLASS && (
                    <NewBoatButton boatClass={cls} onCreated={load} />
                  )}
                </div>
              ) : (
                <div className={styles.classLocked}>
                  <p className={styles.lockedText}>
                    Inscris-toi à une course <strong>{label}</strong> pour recevoir ta coque vierge.
                  </p>
                  <Link
                    href={`/races?class=${cls}` as Parameters<typeof Link>[0]['href']}
                    className={styles.lockedCta}
                  >
                    Voir les courses {label} →
                  </Link>
                </div>
              )}
            </section>
          );
        })}
      </main>
    </SiteShell>
  );
}
```

- [ ] **Step 2: Ajouter les classes CSS pour le layout par classe**

Ajouter dans `apps/web/src/app/marina/page.module.css` les nouvelles classes (conserver les classes existantes pour hero, counters, card qui sont réutilisées) :

```css
/* --- Class sections --- */
.classSection {
  padding: 0 var(--page-px, 1.5rem);
  margin-bottom: 2.5rem;
}
.classHeader {
  display: flex;
  align-items: baseline;
  gap: 1rem;
  margin-bottom: 1rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid var(--navy-line);
}
.className {
  font-family: var(--font-display);
  font-size: clamp(1.25rem, 2vw, 1.5rem);
  color: var(--navy);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.classCount {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  color: var(--t3);
  text-transform: uppercase;
}
.classGrid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 1rem;
}
.classLocked {
  padding: 2rem;
  text-align: center;
  border: 1px dashed var(--navy-line);
  border-radius: var(--r-md);
}
.lockedText {
  font-family: var(--font-body);
  font-size: 0.875rem;
  color: var(--t2);
  margin-bottom: 0.75rem;
}
.lockedCta {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  color: var(--navy);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.lockedCta:hover { color: var(--gold); }

/* --- New boat button --- */
.cardNew {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  min-height: 200px;
  border: 2px dashed var(--navy-line);
  border-radius: var(--r-md);
  cursor: pointer;
  background: transparent;
  transition: border-color 180ms;
}
.cardNew:hover { border-color: var(--gold); }
.cardNew:disabled { opacity: 0.4; cursor: not-allowed; }
.newIcon {
  font-family: var(--font-display);
  font-size: 2rem;
  color: var(--navy);
  line-height: 1;
}
.newLabel {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  color: var(--t2);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
```

- [ ] **Step 3: Vérifier visuellement**

Run: `cd apps/web && pnpm dev`
Navigate to `http://localhost:3000/marina`
Expected: page affiche les sections par classe avec les bateaux mockés

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/marina/page.tsx apps/web/src/app/marina/page.module.css
git commit -m "feat(marina): refonte list page — layout by class + new boat button"
```

---

## Task 5 — SlotCard component

**Files:**
- Create: `apps/web/src/app/marina/[boatId]/SlotCard.tsx`
- Create: `apps/web/src/app/marina/[boatId]/SlotCard.module.css`

- [ ] **Step 1: Créer SlotCard.tsx**

```typescript
import { SLOT_LABEL, TIER_LABEL, type UpgradeSlot, type InstalledUpgrade } from '../data';
import type { SlotAvailability } from '@/lib/marina-api';
import styles from './SlotCard.module.css';

interface SlotCardProps {
  slot: UpgradeSlot;
  availability: SlotAvailability;
  installed: InstalledUpgrade | undefined;
  locked: boolean; // boat is in a race
  onChangeSlot: (slot: UpgradeSlot) => void;
}

export function SlotCard({ slot, availability, installed, locked, onChangeSlot }: SlotCardProps): React.ReactElement | null {
  if (availability === 'absent') return null;

  const isMonotype = availability === 'monotype';
  const itemName = installed?.name ?? 'Série';
  const itemTier = installed?.tier ?? 'SERIE';
  const itemProfile = installed?.profile ?? '';
  const cardCls = `${styles.card} ${isMonotype ? styles.cardMonotype : ''} ${locked ? styles.cardLocked : ''}`;

  return (
    <article className={cardCls}>
      <div className={styles.head}>
        <h4 className={styles.slotName}>{SLOT_LABEL[slot]}</h4>
        <span className={`${styles.tier} ${styles[`tier${itemTier}`] ?? ''}`}>
          {TIER_LABEL[itemTier]}
        </span>
      </div>
      <p className={styles.itemName}>{itemName}</p>
      {itemProfile && <p className={styles.profile}>{itemProfile}</p>}

      {isMonotype ? (
        <p className={styles.monotype}>Réglementation classe</p>
      ) : (
        <button
          type="button"
          className={styles.changeBtn}
          onClick={() => onChangeSlot(slot)}
          disabled={locked}
          title={locked ? 'Modification impossible pendant la course' : `Changer ${SLOT_LABEL[slot]}`}
        >
          Changer →
        </button>
      )}
    </article>
  );
}
```

- [ ] **Step 2: Créer SlotCard.module.css**

```css
.card {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 1rem;
  border: 1px solid var(--navy-line);
  border-radius: var(--r-md);
  background: var(--paper);
  transition: border-color 180ms;
}
.card:hover { border-color: var(--navy-rule); }
.cardMonotype { opacity: 0.55; }
.cardLocked .changeBtn { opacity: 0.35; cursor: not-allowed; }

.head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.slotName {
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--t3);
}

.tier {
  font-family: var(--font-mono);
  font-size: 0.625rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0.125rem 0.375rem;
  border-radius: var(--r-sm);
  background: var(--navy-soft);
  color: var(--t2);
}
.tierBRONZE { background: #cd7f3220; color: #8b5e1a; }
.tierSILVER { background: #c0c0c020; color: #6b6b6b; }
.tierGOLD   { background: var(--gold-soft); color: var(--gold-dark); }
.tierPROTO  { background: #4a154b20; color: #7b2d8b; }

.itemName {
  font-family: var(--font-body);
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--t1);
}
.profile {
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  color: var(--t3);
  font-style: italic;
}
.monotype {
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  color: var(--t3);
  margin-top: 0.5rem;
}

.changeBtn {
  margin-top: auto;
  padding-top: 0.75rem;
  border: none;
  background: none;
  cursor: pointer;
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  color: var(--navy);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  text-align: left;
  transition: color 180ms;
}
.changeBtn:hover:not(:disabled) { color: var(--gold); }
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/marina/\[boatId\]/SlotCard.tsx apps/web/src/app/marina/\[boatId\]/SlotCard.module.css
git commit -m "feat(marina): SlotCard component — slot upgrade display"
```

---

## Task 6 — SlotDrawer component

**Files:**
- Create: `apps/web/src/app/marina/[boatId]/SlotDrawer.tsx`
- Create: `apps/web/src/app/marina/[boatId]/SlotDrawer.module.css`

- [ ] **Step 1: Créer SlotDrawer.tsx**

```typescript
'use client';

import { useState, useEffect } from 'react';
import {
  fetchMyUpgrades, fetchCatalog, installUpgrade, uninstallUpgrade, buyAndInstall,
  type CatalogItem, type InventoryItem, type UpgradeSlot, type BoatClass,
} from '@/lib/marina-api';
import { SLOT_LABEL, TIER_LABEL } from '../data';
import styles from './SlotDrawer.module.css';

interface SlotDrawerProps {
  open: boolean;
  slot: UpgradeSlot;
  boatId: string;
  boatClass: string;
  onClose: () => void;
  onChanged: () => void; // callback to refresh parent data
}

export function SlotDrawer({ open, slot, boatId, boatClass, onClose, onChanged }: SlotDrawerProps): React.ReactElement | null {
  const [tab, setTab] = useState<'install' | 'buy'>('install');
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    Promise.all([fetchMyUpgrades(), fetchCatalog(boatClass)])
      .then(([inv, cat]) => {
        // Filter inventory: items compatible with this slot, not installed elsewhere
        setInventory(inv.inventory.filter((i) =>
          i.slot === slot && !i.installedOn,
        ));
        // Filter catalog: items for this slot, compatible with class, not SERIE
        setCatalog(cat.items.filter((i) =>
          i.slot === slot && i.compat.includes(boatClass as BoatClass) && i.tier !== 'SERIE',
        ));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [open, slot, boatId, boatClass]);

  if (!open) return null;

  const handleInstall = async (playerUpgradeId: string) => {
    setBusy(playerUpgradeId);
    try {
      await installUpgrade(boatId, playerUpgradeId);
      onChanged();
      onClose();
    } catch (err) {
      console.error('install failed', err);
      setBusy(null);
    }
  };

  const handleBuyAndInstall = async (itemId: string) => {
    setBusy(itemId);
    try {
      await buyAndInstall(itemId, boatId);
      onChanged();
      onClose();
    } catch (err) {
      console.error('buy-and-install failed', err);
      setBusy(null);
    }
  };

  const handleRevertToSerie = async () => {
    setBusy('serie');
    try {
      await uninstallUpgrade(boatId, slot);
      onChanged();
      onClose();
    } catch (err) {
      console.error('uninstall failed', err);
      setBusy(null);
    }
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <aside className={styles.drawer} onClick={(e) => e.stopPropagation()}>
        <header className={styles.header}>
          <h3 className={styles.title}>Changer — {SLOT_LABEL[slot]}</h3>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Fermer">✕</button>
        </header>

        <nav className={styles.tabs}>
          <button
            type="button"
            className={`${styles.tab} ${tab === 'install' ? styles.tabActive : ''}`}
            onClick={() => setTab('install')}
          >
            Installer ({inventory.length})
          </button>
          <button
            type="button"
            className={`${styles.tab} ${tab === 'buy' ? styles.tabActive : ''}`}
            onClick={() => setTab('buy')}
          >
            Acheter
          </button>
        </nav>

        <div className={styles.content}>
          {loading ? (
            <p className={styles.loading}>Chargement…</p>
          ) : tab === 'install' ? (
            <>
              {inventory.length === 0 ? (
                <p className={styles.empty}>Aucun item compatible en inventaire.</p>
              ) : (
                inventory.map((item) => (
                  <div key={item.id} className={styles.item}>
                    <div className={styles.itemInfo}>
                      <p className={styles.itemName}>{item.name}</p>
                      <span className={styles.itemTier}>{TIER_LABEL[item.tier ?? 'SERIE']}</span>
                    </div>
                    <button
                      type="button"
                      className={styles.itemBtn}
                      onClick={() => handleInstall(item.id)}
                      disabled={busy !== null}
                    >
                      Installer
                    </button>
                  </div>
                ))
              )}
            </>
          ) : (
            <>
              {catalog.length === 0 ? (
                <p className={styles.empty}>Aucun item disponible à l'achat.</p>
              ) : (
                catalog.map((item) => (
                  <div key={item.id} className={styles.item}>
                    <div className={styles.itemInfo}>
                      <p className={styles.itemName}>{item.name}</p>
                      <p className={styles.itemDesc}>{item.profile}</p>
                      <span className={styles.itemTier}>{TIER_LABEL[item.tier]}</span>
                    </div>
                    <div className={styles.itemAction}>
                      <span className={styles.itemCost}>
                        {item.cost !== null ? `${item.cost.toLocaleString('fr-FR')} cr.` : 'Verrouillé'}
                      </span>
                      {item.cost !== null && (
                        <button
                          type="button"
                          className={styles.itemBtn}
                          onClick={() => handleBuyAndInstall(item.id)}
                          disabled={busy !== null}
                        >
                          Acheter et installer
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </>
          )}
        </div>

        <footer className={styles.footer}>
          <button
            type="button"
            className={styles.revertBtn}
            onClick={handleRevertToSerie}
            disabled={busy !== null}
          >
            Revenir au stock (Série)
          </button>
        </footer>
      </aside>
    </div>
  );
}
```

- [ ] **Step 2: Créer SlotDrawer.module.css**

```css
.overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(26, 40, 64, 0.4);
}
.drawer {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(420px, 90vw);
  background: var(--paper);
  display: flex;
  flex-direction: column;
  box-shadow: -4px 0 24px rgba(0, 0, 0, 0.12);
  animation: slideIn 200ms ease-out;
}
@keyframes slideIn {
  from { transform: translateX(100%); }
  to   { transform: translateX(0); }
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid var(--navy-line);
}
.title {
  font-family: var(--font-display);
  font-size: 1.25rem;
  color: var(--navy);
  text-transform: uppercase;
}
.close {
  border: none;
  background: none;
  cursor: pointer;
  font-size: 1.25rem;
  color: var(--t3);
  padding: 0.25rem;
}
.close:hover { color: var(--t1); }

.tabs {
  display: flex;
  border-bottom: 1px solid var(--navy-line);
}
.tab {
  flex: 1;
  padding: 0.75rem;
  border: none;
  background: none;
  cursor: pointer;
  font-family: var(--font-mono);
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--t3);
  border-bottom: 2px solid transparent;
  transition: color 150ms, border-color 150ms;
}
.tabActive {
  color: var(--navy);
  border-bottom-color: var(--gold);
}

.content {
  flex: 1;
  overflow-y: auto;
  padding: 1rem 1.5rem;
}
.loading, .empty {
  font-family: var(--font-body);
  font-size: 0.875rem;
  color: var(--t3);
  text-align: center;
  padding: 2rem 0;
}

.item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 0;
  border-bottom: 1px solid var(--navy-soft);
}
.itemInfo { flex: 1; }
.itemName {
  font-family: var(--font-body);
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--t1);
}
.itemDesc {
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  color: var(--t3);
  font-style: italic;
}
.itemTier {
  font-family: var(--font-mono);
  font-size: 0.625rem;
  text-transform: uppercase;
  color: var(--t3);
}
.itemAction {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.25rem;
}
.itemCost {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  color: var(--t2);
}
.itemBtn {
  padding: 0.375rem 0.75rem;
  border: 1px solid var(--navy);
  border-radius: var(--r-sm);
  background: none;
  cursor: pointer;
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--navy);
  transition: background 150ms, color 150ms;
}
.itemBtn:hover:not(:disabled) {
  background: var(--navy);
  color: var(--paper);
}
.itemBtn:disabled { opacity: 0.35; cursor: not-allowed; }

.footer {
  padding: 1rem 1.5rem;
  border-top: 1px solid var(--navy-line);
}
.revertBtn {
  width: 100%;
  padding: 0.625rem;
  border: 1px dashed var(--navy-line);
  border-radius: var(--r-sm);
  background: none;
  cursor: pointer;
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  text-transform: uppercase;
  color: var(--t3);
}
.revertBtn:hover:not(:disabled) { border-color: var(--navy); color: var(--t1); }
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/marina/\[boatId\]/SlotDrawer.tsx apps/web/src/app/marina/\[boatId\]/SlotDrawer.module.css
git commit -m "feat(marina): SlotDrawer — slide-out panel with Install/Buy tabs"
```

---

## Task 7 — RepairModal component

**Files:**
- Create: `apps/web/src/app/marina/[boatId]/RepairModal.tsx`
- Create: `apps/web/src/app/marina/[boatId]/RepairModal.module.css`

- [ ] **Step 1: Créer RepairModal.tsx**

```typescript
'use client';

import { useRef, useEffect, useState } from 'react';
import { repairBoat, type BoatRecord } from '@/lib/marina-api';
import styles from './RepairModal.module.css';

interface RepairModalProps {
  open: boolean;
  boat: BoatRecord;
  credits: number;
  onClose: () => void;
  onRepaired: () => void;
}

/** Approximate repair cost (matches server formula — cosmetic for UI preview). */
function estimateAxisCost(condition: number, costPer10: number, tierMul: number): number {
  if (condition >= 100) return 0;
  return (100 - condition) / 10 * costPer10 * tierMul;
}

export function RepairModal({ open, boat, credits, onClose, onRepaired }: RepairModalProps): React.ReactElement | null {
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) ref.current?.showModal();
    else ref.current?.close();
  }, [open]);

  // Simplified cost estimate (Série tier for all = 1.0 multiplier)
  // Real cost is computed server-side — this is for display only
  const axes = [
    { label: 'Coque', condition: boat.hullCondition, costPer10: 80 },
    { label: 'Gréement', condition: boat.rigCondition, costPer10: 50 },
    { label: 'Voiles', condition: boat.sailCondition, costPer10: 120 },
    { label: 'Électronique', condition: boat.elecCondition, costPer10: 30 },
  ];
  const total = axes.reduce((sum, a) => sum + estimateAxisCost(a.condition, a.costPer10, 1.0), 0);
  const canAfford = credits >= total;

  const handleRepair = async () => {
    setBusy(true);
    try {
      await repairBoat(boat.id);
      onRepaired();
      onClose();
    } catch (err) {
      console.error('repair failed', err);
      setBusy(false);
    }
  };

  return (
    <dialog ref={ref} className={styles.dialog} onClose={onClose}>
      <h2 className={styles.title}>Réparer {boat.name}</h2>

      <div className={styles.axes}>
        {axes.map((a) => {
          const cost = estimateAxisCost(a.condition, a.costPer10, 1.0);
          return (
            <div key={a.label} className={styles.axisRow}>
              <span className={styles.axisLabel}>{a.label} ({a.condition}%)</span>
              <span className={styles.axisCost}>
                {cost > 0 ? `${Math.round(cost).toLocaleString('fr-FR')} cr.` : '—'}
              </span>
            </div>
          );
        })}
      </div>

      <div className={styles.summary}>
        <div className={styles.summaryRow}>
          <span>Total à débiter</span>
          <span className={styles.summaryValue}>{Math.round(total).toLocaleString('fr-FR')} cr.</span>
        </div>
        <div className={styles.summaryRow}>
          <span>Solde après</span>
          <span className={styles.summaryValue}>{(credits - Math.round(total)).toLocaleString('fr-FR')} cr.</span>
        </div>
      </div>

      <div className={styles.actions}>
        <button type="button" className={styles.btnCancel} onClick={onClose}>Annuler</button>
        <button
          type="button"
          className={styles.btnRepair}
          onClick={handleRepair}
          disabled={busy || !canAfford || total === 0}
        >
          {total === 0 ? 'Déjà en parfait état' : `Réparer (${Math.round(total).toLocaleString('fr-FR')} cr.)`}
        </button>
      </div>
    </dialog>
  );
}
```

- [ ] **Step 2: Créer RepairModal.module.css**

```css
.dialog {
  max-width: 480px;
  width: 90vw;
  border: none;
  border-radius: var(--r-lg);
  padding: 2rem;
  background: var(--paper);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.16);
}
.dialog::backdrop {
  background: rgba(26, 40, 64, 0.4);
}
.title {
  font-family: var(--font-display);
  font-size: 1.375rem;
  color: var(--navy);
  text-transform: uppercase;
  margin-bottom: 1.5rem;
}

.axes { margin-bottom: 1.5rem; }
.axisRow {
  display: flex;
  justify-content: space-between;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--navy-soft);
}
.axisLabel {
  font-family: var(--font-body);
  font-size: 0.875rem;
  color: var(--t1);
}
.axisCost {
  font-family: var(--font-mono);
  font-size: 0.8125rem;
  color: var(--t2);
}

.summary {
  padding: 0.75rem 0;
  border-top: 2px solid var(--navy-line);
  margin-bottom: 1.5rem;
}
.summaryRow {
  display: flex;
  justify-content: space-between;
  padding: 0.25rem 0;
  font-family: var(--font-body);
  font-size: 0.875rem;
  color: var(--t1);
}
.summaryValue {
  font-family: var(--font-mono);
  font-weight: 600;
}

.actions {
  display: flex;
  gap: 0.75rem;
  justify-content: flex-end;
}
.btnCancel {
  padding: 0.625rem 1.25rem;
  border: 1px solid var(--navy-line);
  border-radius: var(--r-sm);
  background: none;
  cursor: pointer;
  font-family: var(--font-mono);
  font-size: 0.75rem;
  text-transform: uppercase;
  color: var(--t2);
}
.btnRepair {
  padding: 0.625rem 1.25rem;
  border: none;
  border-radius: var(--r-sm);
  background: var(--navy);
  color: var(--paper);
  cursor: pointer;
  font-family: var(--font-mono);
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.btnRepair:disabled { opacity: 0.4; cursor: not-allowed; }
.btnRepair:hover:not(:disabled) { background: var(--navy-2); }
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/marina/\[boatId\]/RepairModal.tsx apps/web/src/app/marina/\[boatId\]/RepairModal.module.css
git commit -m "feat(marina): RepairModal — per-axis cost breakdown + confirmation"
```

---

## Task 8 — SellModal component

**Files:**
- Create: `apps/web/src/app/marina/[boatId]/SellModal.tsx`
- Create: `apps/web/src/app/marina/[boatId]/SellModal.module.css`

- [ ] **Step 1: Créer SellModal.tsx**

```typescript
'use client';

import { useRef, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { sellBoat, type BoatRecord, type InstalledUpgrade } from '@/lib/marina-api';
import { TIER_LABEL } from '../data';
import styles from './SellModal.module.css';

interface SellModalProps {
  open: boolean;
  boat: BoatRecord;
  installedUpgrades: InstalledUpgrade[];
  onClose: () => void;
}

export function SellModal({ open, boat, installedUpgrades, onClose }: SellModalProps): React.ReactElement | null {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) ref.current?.showModal();
    else ref.current?.close();
  }, [open]);

  // Estimated sell price (server computes actual — this is display only)
  // Formula: totalNm * 1 + wins * 500 + podiums * 150 + top10 * 30
  // We don't have totalNm client-side, so we show palmares only
  const estimatedMin = boat.wins * 500 + boat.podiums * 150 + boat.top10Finishes * 30;

  const handleSell = async () => {
    setBusy(true);
    try {
      await sellBoat(boat.id);
      router.push('/marina');
    } catch (err) {
      console.error('sell failed', err);
      setBusy(false);
    }
  };

  return (
    <dialog ref={ref} className={styles.dialog} onClose={onClose}>
      <h2 className={styles.title}>Vendre {boat.name} ?</h2>
      <p className={styles.warning}>Cette action est irréversible.</p>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Palmarès du bateau</h3>
        <div className={styles.palmaresGrid}>
          <span>{boat.racesCount} courses</span>
          <span>{boat.wins} victoire{boat.wins !== 1 ? 's' : ''}</span>
          <span>{boat.podiums} podium{boat.podiums !== 1 ? 's' : ''}</span>
          <span>{boat.top10Finishes} top 10</span>
        </div>
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Crédits estimés</h3>
        <p className={styles.price}>{estimatedMin > 0 ? `≥ ${estimatedMin.toLocaleString('fr-FR')} cr.` : '0 cr.'}</p>
        {estimatedMin === 0 && <p className={styles.priceNote}>Aucun palmarès — pas de gain.</p>}
      </div>

      {installedUpgrades.length > 0 && (
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Upgrades retournés en inventaire ({installedUpgrades.length})</h3>
          <ul className={styles.upgradeList}>
            {installedUpgrades.map((u) => (
              <li key={u.playerUpgradeId} className={styles.upgradeItem}>
                ▸ {u.name} ({TIER_LABEL[u.tier]})
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className={styles.actions}>
        <button type="button" className={styles.btnCancel} onClick={onClose}>Annuler</button>
        <button
          type="button"
          className={styles.btnSell}
          onClick={handleSell}
          disabled={busy}
        >
          Vendre{estimatedMin > 0 ? ` (+${estimatedMin.toLocaleString('fr-FR')} cr.)` : ''}
        </button>
      </div>
    </dialog>
  );
}
```

- [ ] **Step 2: Créer SellModal.module.css**

```css
.dialog {
  max-width: 480px;
  width: 90vw;
  border: none;
  border-radius: var(--r-lg);
  padding: 2rem;
  background: var(--paper);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.16);
}
.dialog::backdrop {
  background: rgba(26, 40, 64, 0.4);
}
.title {
  font-family: var(--font-display);
  font-size: 1.375rem;
  color: var(--navy);
  text-transform: uppercase;
  margin-bottom: 0.5rem;
}
.warning {
  font-family: var(--font-body);
  font-size: 0.875rem;
  color: var(--danger);
  font-weight: 600;
  margin-bottom: 1.5rem;
}

.section { margin-bottom: 1.25rem; }
.sectionTitle {
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--t3);
  margin-bottom: 0.5rem;
}
.palmaresGrid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.25rem;
  font-family: var(--font-body);
  font-size: 0.875rem;
  color: var(--t1);
}
.price {
  font-family: var(--font-mono);
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--t1);
}
.priceNote {
  font-family: var(--font-body);
  font-size: 0.75rem;
  color: var(--t3);
}

.upgradeList {
  list-style: none;
  padding: 0;
}
.upgradeItem {
  font-family: var(--font-body);
  font-size: 0.8125rem;
  color: var(--t1);
  padding: 0.125rem 0;
}

.actions {
  display: flex;
  gap: 0.75rem;
  justify-content: flex-end;
  margin-top: 1.5rem;
  padding-top: 1rem;
  border-top: 1px solid var(--navy-line);
}
.btnCancel {
  padding: 0.625rem 1.25rem;
  border: 1px solid var(--navy-line);
  border-radius: var(--r-sm);
  background: none;
  cursor: pointer;
  font-family: var(--font-mono);
  font-size: 0.75rem;
  text-transform: uppercase;
  color: var(--t2);
}
.btnSell {
  padding: 0.625rem 1.25rem;
  border: none;
  border-radius: var(--r-sm);
  background: var(--danger);
  color: var(--paper);
  cursor: pointer;
  font-family: var(--font-mono);
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.btnSell:disabled { opacity: 0.4; cursor: not-allowed; }
.btnSell:hover:not(:disabled) { filter: brightness(1.1); }
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/marina/\[boatId\]/SellModal.tsx apps/web/src/app/marina/\[boatId\]/SellModal.module.css
git commit -m "feat(marina): SellModal — irréversible sell with palmares + upgrades returned"
```

---

## Task 9 — Refonte BoatDetailView

**Files:**
- Modify: `apps/web/src/app/marina/[boatId]/BoatDetailView.tsx`
- Modify: `apps/web/src/app/marina/[boatId]/page.tsx`

Cette task est la plus importante : elle remplace la section upgrade (6 catégories + variantes) par 7 slot cards avec drawer, ajoute la barre d'actions avec lock states, et intègre les modales.

- [ ] **Step 1: Réécrire BoatDetailView.tsx**

Remplacer entièrement `apps/web/src/app/marina/[boatId]/BoatDetailView.tsx`. Le nouveau composant :
- Charge les données via l'API (avec fallback mock)
- Affiche la barre d'actions (Personnaliser / Réparer / Vendre) avec lock states
- Affiche les 7 slot cards (via `SlotCard`)
- Ouvre le `SlotDrawer` quand on clique "Changer"
- Ouvre `RepairModal` et `SellModal`
- Conserve le hero, stats band et historique existants

```typescript
'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import Link from 'next/link';
import { Pagination, BoatSvg } from '@/components/ui';
import {
  fetchBoatDetail, fetchCatalog,
  type BoatRecord, type InstalledUpgrade, type UpgradeSlot, type SlotAvailability,
} from '@/lib/marina-api';
import {
  CLASS_LABEL, SLOT_LABEL, ALL_CLASSES,
  MOCK_BOATS, MOCK_CREDITS, MOCK_INSTALLED, MOCK_HISTORY,
  type BoatRaceHistoryEntry,
} from '../data';
import { SlotCard } from './SlotCard';
import { SlotDrawer } from './SlotDrawer';
import { RepairModal } from './RepairModal';
import { SellModal } from './SellModal';
import styles from './page.module.css';

const HISTORY_PAGE_SIZE = 5;
const ALL_SLOTS: UpgradeSlot[] = ['HULL', 'MAST', 'SAILS', 'FOILS', 'KEEL', 'ELECTRONICS', 'REINFORCEMENT'];

function formatRank(n: number): { main: string; suffix: string } {
  return { main: String(n).padStart(2, '0'), suffix: n === 1 ? 'er' : 'e' };
}

interface BoatDetailViewProps {
  boatId: string;
}

export default function BoatDetailView({ boatId }: BoatDetailViewProps): React.ReactElement {
  const [boat, setBoat] = useState<BoatRecord | null>(null);
  const [installed, setInstalled] = useState<InstalledUpgrade[]>([]);
  const [credits, setCredits] = useState(0);
  const [slotsByClass, setSlotsByClass] = useState<Record<UpgradeSlot, SlotAvailability> | null>(null);
  const [history, setHistory] = useState<BoatRaceHistoryEntry[]>([]);

  // UI state
  const [drawerSlot, setDrawerSlot] = useState<UpgradeSlot | null>(null);
  const [showRepair, setShowRepair] = useState(false);
  const [showSell, setShowSell] = useState(false);
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    try {
      const [detail, catalog] = await Promise.all([
        fetchBoatDetail(boatId),
        fetchCatalog(),
      ]);
      setBoat(detail.boat);
      setInstalled(detail.installedUpgrades);
      setCredits(detail.credits);
      const cls = detail.boat.boatClass as string;
      if (catalog.slotsByClass[cls]) {
        setSlotsByClass(catalog.slotsByClass[cls] as Record<UpgradeSlot, SlotAvailability>);
      }
      // History would come from a dedicated endpoint — use mock for now
      setHistory(MOCK_HISTORY[boatId] ?? []);
    } catch {
      // Fallback to mock
      const mock = MOCK_BOATS.find((b) => b.id === boatId);
      if (mock) {
        setBoat(mock);
        setInstalled(MOCK_INSTALLED[boatId] ?? []);
        setCredits(MOCK_CREDITS);
        setHistory(MOCK_HISTORY[boatId] ?? []);
      }
    }
  }, [boatId]);

  useEffect(() => { load(); }, [load]);

  if (!boat) {
    return <p className={styles.loading}>Chargement…</p>;
  }

  const inRace = !!boat.activeRaceId;
  const stateLabel = inRace ? `En course · ${boat.activeRaceId}` : 'Au port';
  const stateCls = inRace ? styles.stateInRace : styles.stateIdle;
  const classLabel = CLASS_LABEL[boat.boatClass] ?? boat.boatClass;

  // Stats
  const avgCondition = Math.round(
    (boat.hullCondition + boat.rigCondition + boat.sailCondition + boat.elecCondition) / 4,
  );
  const needsRepair = avgCondition < 100;

  // History pagination
  const totalPages = Math.max(1, Math.ceil(history.length / HISTORY_PAGE_SIZE));
  const visibleHistory = history.slice((page - 1) * HISTORY_PAGE_SIZE, page * HISTORY_PAGE_SIZE);

  // Installed lookup
  const installedBySlot = new Map(installed.map((u) => [u.slot, u]));

  return (
    <>
      {/* Breadcrumb */}
      <div className={styles.subhead}>
        <nav className={styles.breadcrumb} aria-label="Fil d'ariane">
          <Link href={'/marina' as Parameters<typeof Link>[0]['href']}>← Marina</Link>
          <span className={styles.breadcrumbSep}>/</span>
          <span>{boat.name}</span>
        </nav>
      </div>

      {/* Hero */}
      <section className={styles.hero}>
        <div className={styles.heroRender}>
          <BoatSvg
            className={styles.heroRenderSvg}
            hullColor={boat.hullColor ?? '#1a2840'}
            deckColor={boat.deckColor ?? undefined}
            name={boat.name}
            showText
          />
        </div>
        <div className={styles.heroSide}>
          <p className={styles.heroClass}>{classLabel}</p>
          <h1 className={styles.heroName}>{boat.name}</h1>
          <span className={`${styles.heroState} ${stateCls}`}>
            <span className={styles.heroStateDot} aria-hidden />
            {stateLabel}
          </span>

          {/* Action bar */}
          <div className={styles.heroActions}>
            <Link
              href={`/marina/${boat.id}/customize` as Parameters<typeof Link>[0]['href']}
              className={`${styles.btn} ${styles.btnPrimary}`}
            >
              Personnaliser →
            </Link>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnSecondary}`}
              onClick={() => setShowRepair(true)}
              disabled={inRace || !needsRepair}
              title={inRace ? 'Impossible pendant la course' : !needsRepair ? 'Bateau en parfait état' : 'Réparer'}
            >
              Réparer
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnDanger}`}
              onClick={() => setShowSell(true)}
              disabled={inRace}
              title={inRace ? 'Impossible pendant la course' : 'Vendre ce bateau'}
            >
              Vendre
            </button>
          </div>
        </div>
      </section>

      {/* Stats band — 4 cells: courses, palmarès, condition, upgrades */}
      <section className={styles.statsBand}>
        <div className={styles.statsGrid}>
          <div className={styles.statCell}>
            <p className={styles.statCellLabel}>Courses</p>
            <p className={styles.statCellValue}>{String(boat.racesCount).padStart(2, '0')}</p>
          </div>
          <div className={styles.statCell}>
            <p className={styles.statCellLabel}>Podiums</p>
            <p className={`${styles.statCellValue} ${styles.statCellValueGold}`}>{boat.podiums}</p>
          </div>
          <div className={styles.statCell}>
            <p className={styles.statCellLabel}>Condition moyenne</p>
            <p className={styles.statCellValue}>{avgCondition}%</p>
            <p className={styles.statCellSub}>
              C:{boat.hullCondition} G:{boat.rigCondition} V:{boat.sailCondition} E:{boat.elecCondition}
            </p>
          </div>
          <div className={styles.statCell}>
            <p className={styles.statCellLabel}>Upgrades installés</p>
            <p className={styles.statCellValue}>{installed.length}<small>/7</small></p>
          </div>
        </div>
      </section>

      {/* Slot section — 7 upgrade slots */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <div>
            <p className={styles.sectionEyebrow}>Performance</p>
            <h2 className={styles.sectionTitle}>Équipement</h2>
          </div>
          <p className={styles.sectionAside}>
            Sept emplacements à configurer. {inRace ? 'Modifications bloquées pendant la course.' : 'Clique « Changer » pour modifier un slot.'}
          </p>
        </div>

        <div className={styles.slotsGrid}>
          {ALL_SLOTS.map((slot) => {
            const availability = slotsByClass?.[slot] ?? 'open';
            return (
              <SlotCard
                key={slot}
                slot={slot}
                availability={availability}
                installed={installedBySlot.get(slot)}
                locked={inRace}
                onChangeSlot={(s) => setDrawerSlot(s)}
              />
            );
          })}
        </div>
      </section>

      {/* History section */}
      <section className={`${styles.section} ${styles.sectionTop0}`}>
        <div className={styles.sectionHead}>
          <div>
            <p className={styles.sectionEyebrow}>Palmarès</p>
            <h2 className={styles.sectionTitle}>Historique</h2>
          </div>
          <p className={styles.sectionAside}>
            {history.length > 0
              ? `${history.length} course${history.length > 1 ? 's' : ''} bouclée${history.length > 1 ? 's' : ''} avec ce bateau.`
              : 'Aucune course disputée avec ce bateau.'}
          </p>
        </div>
        {history.length === 0 ? (
          <p className={styles.historyEmpty}>
            Inscris-toi à une course <strong>{classLabel}</strong> pour démarrer son historique.
          </p>
        ) : (
          <>
            <div className={styles.history}>
              {visibleHistory.map((h) => (
                <Link
                  key={h.raceId}
                  href={`/ranking/${h.raceId}` as Parameters<typeof Link>[0]['href']}
                  className={styles.historyRow}
                >
                  <span className={`${styles.historyPos} ${h.finalRank <= 3 ? styles.historyPosPodium : ''}`}>
                    {formatRank(h.finalRank).main}<sup>{formatRank(h.finalRank).suffix}</sup>
                  </span>
                  <div className={styles.historyCell}>
                    <p className={styles.historyName}>{h.raceName}</p>
                    <p className={styles.historyMeta}>
                      {classLabel} · {new Date(h.raceDate).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })} · {h.raceDistanceNm.toLocaleString('fr-FR')} NM
                    </p>
                  </div>
                  <span className={styles.historyTime}>{h.durationLabel}</span>
                  <span className={styles.historyCredits}>
                    {h.creditsEarned > 0 ? `+ ${h.creditsEarned.toLocaleString('fr-FR')} cr.` : '—'}
                  </span>
                </Link>
              ))}
            </div>
            {totalPages > 1 && (
              <Pagination
                page={page}
                totalPages={totalPages}
                totalItems={history.length}
                pageSize={HISTORY_PAGE_SIZE}
                onChange={setPage}
                label="Pagination historique du bateau"
              />
            )}
          </>
        )}
      </section>

      {/* Drawer */}
      {drawerSlot && (
        <SlotDrawer
          open={!!drawerSlot}
          slot={drawerSlot}
          boatId={boat.id}
          boatClass={boat.boatClass}
          onClose={() => setDrawerSlot(null)}
          onChanged={load}
        />
      )}

      {/* Modals */}
      <RepairModal
        open={showRepair}
        boat={boat}
        credits={credits}
        onClose={() => setShowRepair(false)}
        onRepaired={load}
      />
      <SellModal
        open={showSell}
        boat={boat}
        installedUpgrades={installed}
        onClose={() => setShowSell(false)}
      />
    </>
  );
}
```

- [ ] **Step 2: Mettre à jour page.tsx pour passer boatId**

Modifier `apps/web/src/app/marina/[boatId]/page.tsx` pour passer juste le `boatId` au lieu de l'ancien `BoatDetail` :

```typescript
import { SiteShell } from '@/components/ui/SiteShell';
import BoatDetailView from './BoatDetailView';

export default async function BoatDetailPage({
  params,
}: {
  params: Promise<{ boatId: string }>;
}): Promise<React.ReactElement> {
  const { boatId } = await params;

  return (
    <SiteShell>
      <BoatDetailView boatId={boatId} />
    </SiteShell>
  );
}
```

- [ ] **Step 3: Ajouter la classe `.slotsGrid` dans page.module.css**

Ajouter dans `apps/web/src/app/marina/[boatId]/page.module.css` :

```css
/* --- Slot grid (replaces old .cats + .variants) --- */
.slotsGrid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 0.75rem;
  padding: 0 var(--page-px, 1.5rem);
}

.loading {
  font-family: var(--font-body);
  font-size: 0.875rem;
  color: var(--t3);
  text-align: center;
  padding: 4rem 0;
}
```

- [ ] **Step 4: Vérifier la compilation**

Run: `cd apps/web && npx tsc --noEmit 2>&1 | head -20`
Expected: aucune erreur (ou erreurs pré-existantes non liées)

- [ ] **Step 5: Vérifier visuellement**

Run: `pnpm dev`
Navigate to `http://localhost:3000/marina/b-albatros`
Expected: page affiche hero + action bar + 7 slot cards + historique

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/marina/\[boatId\]/BoatDetailView.tsx apps/web/src/app/marina/\[boatId\]/page.tsx apps/web/src/app/marina/\[boatId\]/page.module.css
git commit -m "feat(marina): refonte BoatDetailView — 7 slots, drawer, repair/sell modals, lock states"
```

---

## Récapitulatif

| # | Task | Fichiers principaux |
|---|------|-------------------|
| 1 | Backend: 2 endpoints lecture | `marina.ts` (game-engine) |
| 2 | API client frontend | `marina-api.ts` (web) |
| 3 | Types + mock data refactor | `data.ts` (web) |
| 4 | Refonte page `/marina` | `page.tsx`, `page.module.css` |
| 5 | SlotCard component | `SlotCard.tsx`, `.module.css` |
| 6 | SlotDrawer component | `SlotDrawer.tsx`, `.module.css` |
| 7 | RepairModal component | `RepairModal.tsx`, `.module.css` |
| 8 | SellModal component | `SellModal.tsx`, `.module.css` |
| 9 | Refonte BoatDetailView | `BoatDetailView.tsx`, `page.tsx` |

## Spec coverage

| Spec section | Task(s) | Status |
|---|---|---|
| C.1 — /marina layout par classe | 4 | Couvert |
| C.1 — Bouton "+ Nouvelle" | 4 | Couvert |
| C.1 — CTA "Détail bateau" | 4 | Couvert |
| C.1 — États "En course" / "Au port" uniquement | 4 | Couvert |
| C.2 — Hero (inchangé) | 9 | Conservé |
| C.2 — Actions barre + lock | 9 | Couvert |
| C.2 — Stats band avec condition | 9 | Couvert |
| C.2 — 7 slot cards | 5, 9 | Couvert |
| C.2 — Drawer "Changer le slot" | 6, 9 | Couvert |
| C.3 — /customize inchangée | — | Pas touché |
| C.5 — Modale réparation | 7 | Couvert |
| C.6 — Modale vente | 8 | Couvert |
| D.5 — GET /players/me/boats | 1 | Ajouté |
| D.5 — GET /boats/:id | 1 | Ajouté |
