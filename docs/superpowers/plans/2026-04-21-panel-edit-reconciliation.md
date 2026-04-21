# Panel Edit Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implémenter le pattern "optimistic + reconciliation" pour que les broadcasts serveur n'écrasent plus les éditions utilisateur dans SailPanel/Compass/ProgPanel, ajouter le Cancel UX + layout responsive à Compass, les règles d'obsolescence à ProgPanel, et fixer la race condition ingest/tick côté worker.

**Architecture:** Chaque slice concerné (`sail`, `hud`) gagne un sous-état `pending` qui stocke les valeurs optimistes en attente. Un helper pur `mergeField` réconcilie le broadcast serveur avec le pending (match → release, divergent → keep, timeout 60s → release). Les composants remplacent leurs écritures directes par des actions `setOptimistic` / `setOptimisticSailChange`. Côté worker, un `setImmediate` avant le tick permet au drain des `ingestOrder` en file d'être traités en priorité.

**Tech Stack:** React 19, Next.js 16, Zustand 5, TypeScript strict. Tests unitaires via `node --test` (convention existante dans `apps/game-engine`). Pas de tests composants automatisés (pas d'infra RTL — manual test steps fournis).

**Spec de référence:** [docs/superpowers/specs/2026-04-20-panel-edit-reconciliation-design.md](../specs/2026-04-20-panel-edit-reconciliation-design.md)

---

## Phase 1 — Pattern central (store foundation)

### Task 1: Helper `mergeField` et types partagés

**Files:**
- Create: `apps/web/src/lib/store/pending.ts`
- Create: `apps/web/src/lib/store/pending.test.ts`

**Contexte:** Le cœur du pattern. Fonction pure, aucune dépendance React/Zustand, donc testable directement avec `node:test`.

- [ ] **Step 1: Write pending.test.ts**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeField } from './pending.js';

test('mergeField — no pending → use server value', () => {
  const r = mergeField(undefined, 42, 1000);
  assert.deepEqual(r, { value: 42, pending: undefined });
});

test('mergeField — pending matches server → release, use server', () => {
  const pending = { expected: 42, since: 100 };
  const r = mergeField(pending, 42, 1000);
  assert.deepEqual(r, { value: 42, pending: undefined });
});

test('mergeField — pending divergent, within timeout → keep optimistic', () => {
  const pending = { expected: 42, since: 1000 };
  const r = mergeField(pending, 0, 30_000);
  assert.equal(r.value, 42);
  assert.deepEqual(r.pending, pending);
});

test('mergeField — pending divergent, past timeout → release, use server', () => {
  const pending = { expected: 42, since: 1000 };
  const r = mergeField(pending, 0, 62_000);
  assert.deepEqual(r, { value: 0, pending: undefined });
});

test('mergeField — custom equals (object compare)', () => {
  const equals = (a: { id: string }, b: { id: string }) => a.id === b.id;
  const pending = { expected: { id: 'JIB', extra: 1 }, since: 100 };
  const r = mergeField(pending, { id: 'JIB', extra: 2 }, 1000, equals);
  assert.equal(r.value.id, 'JIB');
  assert.equal(r.value.extra, 2); // prefers server
  assert.equal(r.pending, undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && node --import tsx --test src/lib/store/pending.test.ts`
Expected: FAIL with "Cannot find module './pending.js'"

- [ ] **Step 3: Write pending.ts**

```ts
export interface PendingField<T> {
  expected: T;
  since: number;
}

const DEFAULT_TIMEOUT_MS = 60_000;

export function mergeField<T>(
  pending: PendingField<T> | undefined,
  serverValue: T,
  now: number,
  equals: (a: T, b: T) => boolean = (a, b) => a === b,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): { value: T; pending: PendingField<T> | undefined } {
  if (!pending) return { value: serverValue, pending: undefined };
  if (equals(pending.expected, serverValue)) return { value: serverValue, pending: undefined };
  if (now - pending.since > timeoutMs) return { value: serverValue, pending: undefined };
  return { value: pending.expected, pending };
}
```

- [ ] **Step 4: Add test script to apps/web/package.json**

Modify `apps/web/package.json` — add to scripts:

```json
"test": "node --import tsx --test src/lib/store/*.test.ts src/lib/orders/*.test.ts src/components/play/hooks/*.test.ts"
```

And add `tsx` to devDependencies (check root package.json — might already be hoisted; if not, `pnpm add -D tsx --filter @nemo/web`).

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/web && pnpm test`
Expected: 5 tests passing.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/store/pending.ts apps/web/src/lib/store/pending.test.ts apps/web/package.json
git commit -m "feat(store): add mergeField helper for optimistic reconciliation"
```

---

### Task 2: Types `pending` dans SailSliceState et HudState

**Files:**
- Modify: `apps/web/src/lib/store/types.ts:17-25` (HudState) and `types.ts:29-39` (SailSliceState)

**Contexte:** On ajoute le champ `pending` aux deux interfaces. Pas de test pour des types seuls — la compilation TS fait foi.

- [ ] **Step 1: Import PendingField in types.ts**

Add to the top of `apps/web/src/lib/store/types.ts` (after existing imports):

```ts
import type { PendingField } from './pending';
```

- [ ] **Step 2: Extend HudState**

Modify the `HudState` interface in [types.ts:17-25](apps/web/src/lib/store/types.ts#L17-L25) — add field:

```ts
export interface HudState {
  // ... champs existants
  twaLock: number | null;
  pending: {
    hdg?: PendingField<number>;
  };
}
```

- [ ] **Step 3: Extend SailSliceState**

Modify `SailSliceState` interface — add field:

```ts
export interface SailSliceState {
  // ... champs existants
  maneuverEndMs: number;
  pending: {
    sailAuto?: PendingField<boolean>;
    sailChange?: PendingField<{
      currentSail: SailId;
      transitionStartMs: number;
      transitionEndMs: number;
    }>;
  };
}
```

- [ ] **Step 4: Update INITIAL_HUD and INITIAL_SAIL to include empty pending**

Modify `apps/web/src/lib/store/hudSlice.ts:6-14` — add `pending: {}` to `INITIAL_HUD`.

Modify `apps/web/src/lib/store/sailSlice.ts:11-16` — add `pending: {}` to `INITIAL_SAIL`.

- [ ] **Step 5: Verify typecheck passes**

Run: `cd apps/web && pnpm typecheck`
Expected: no errors (initial empty pending is valid for both interfaces because all fields are optional).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/store/types.ts apps/web/src/lib/store/hudSlice.ts apps/web/src/lib/store/sailSlice.ts
git commit -m "feat(store): add pending field to hud and sail slices"
```

---

### Task 3: Action `setOptimistic` sur sailSlice (pour sailAuto)

**Files:**
- Modify: `apps/web/src/lib/store/sailSlice.ts`
- Modify: `apps/web/src/lib/store/types.ts` (SailActions interface)

**Contexte:** Une seule action générique indexée par nom de champ. Pour commencer, on ne supporte que `sailAuto` (le reste — `sailChange` — vient dans Task 4).

- [ ] **Step 1: Add action signature to SailActions interface**

Modify `apps/web/src/lib/store/types.ts` — in the actions section (around line 160+ — check current structure), add to the sail actions:

```ts
export interface SailActions {
  // ... existant
  setSailOptimistic: (field: 'sailAuto', value: boolean) => void;
}
```

(Si `SailActions` n'existe pas en tant qu'interface séparée, ajouter dans le composite actions type.)

- [ ] **Step 2: Implement action in sailSlice.ts**

Modify `apps/web/src/lib/store/sailSlice.ts:18-24` — extend `createSailSlice`:

```ts
export function createSailSlice(set: (fn: (s: GameStore) => Partial<GameStore>) => void) {
  return {
    sail: INITIAL_SAIL,
    setSail: (patch: Partial<SailSliceState>) => set((s) => ({ sail: { ...s.sail, ...patch } })),
    toggleSailAuto: () => set((s) => ({ sail: { ...s.sail, sailAuto: !s.sail.sailAuto } })),
    setSailOptimistic: (field: 'sailAuto', value: boolean) =>
      set((s) => ({
        sail: {
          ...s.sail,
          [field]: value,
          pending: {
            ...s.sail.pending,
            [field]: { expected: value, since: Date.now() },
          },
        },
      })),
  };
}
```

- [ ] **Step 3: Verify typecheck passes**

Run: `cd apps/web && pnpm typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/store/sailSlice.ts apps/web/src/lib/store/types.ts
git commit -m "feat(store): add setSailOptimistic action for sailAuto"
```

---

### Task 4: Action `setOptimisticSailChange` (pending englobant)

**Files:**
- Modify: `apps/web/src/lib/store/sailSlice.ts`
- Modify: `apps/web/src/lib/store/types.ts` (SailActions interface)

**Contexte:** Pending englobant : pose un seul pending sur les 3 champs couplés.

- [ ] **Step 1: Add action signature**

Modify `apps/web/src/lib/store/types.ts` — add to SailActions:

```ts
setOptimisticSailChange: (patch: {
  currentSail: SailId;
  transitionStartMs: number;
  transitionEndMs: number;
}) => void;
```

- [ ] **Step 2: Implement action**

Modify `apps/web/src/lib/store/sailSlice.ts` — add to `createSailSlice` return:

```ts
setOptimisticSailChange: (patch: {
  currentSail: SailId;
  transitionStartMs: number;
  transitionEndMs: number;
}) => set((s) => ({
  sail: {
    ...s.sail,
    currentSail: patch.currentSail,
    transitionStartMs: patch.transitionStartMs,
    transitionEndMs: patch.transitionEndMs,
    pending: {
      ...s.sail.pending,
      sailChange: { expected: patch, since: Date.now() },
    },
  },
})),
```

- [ ] **Step 3: Verify typecheck**

Run: `cd apps/web && pnpm typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/store/sailSlice.ts apps/web/src/lib/store/types.ts
git commit -m "feat(store): add setOptimisticSailChange for coupled sail fields"
```

---

### Task 5: Action `setHudOptimistic` (pour hdg)

**Files:**
- Modify: `apps/web/src/lib/store/hudSlice.ts`
- Modify: `apps/web/src/lib/store/types.ts`

- [ ] **Step 1: Add action signature in types.ts**

Add to HUD actions (similar section as SailActions):

```ts
setHudOptimistic: (field: 'hdg', value: number) => void;
```

- [ ] **Step 2: Implement in hudSlice.ts**

Modify `createHudSlice` return:

```ts
setHudOptimistic: (field: 'hdg', value: number) =>
  set((s) => ({
    hud: {
      ...s.hud,
      [field]: value,
      pending: {
        ...s.hud.pending,
        [field]: { expected: value, since: Date.now() },
      },
    },
  })),
```

- [ ] **Step 3: Verify typecheck**

Run: `cd apps/web && pnpm typecheck`

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/store/hudSlice.ts apps/web/src/lib/store/types.ts
git commit -m "feat(store): add setHudOptimistic action for hdg"
```

---

### Task 6: Reconciliation dans `applyMessages` (sailAuto)

**Files:**
- Modify: `apps/web/src/lib/store/index.ts:96-107` (nextSail construction)

**Contexte:** On remplace l'écrasement direct de `sailAuto` par un passage via `mergeField`. Les autres champs de `nextSail` restent écrasés pour l'instant.

- [ ] **Step 1: Import mergeField in store/index.ts**

Add import:

```ts
import { mergeField } from './pending';
```

- [ ] **Step 2: Replace sailAuto write with mergeField**

Modify `apps/web/src/lib/store/index.ts:96-107` — remplacer le bloc :

```ts
const sailAutoServer = m['sailAuto'] === true;
const now = Date.now();
const sailAutoMerged = mergeField(s.sail.pending.sailAuto, sailAutoServer, now);

nextSail = {
  ...s.sail,
  currentSail,
  sailPending: null,
  transitionStartMs: Number(m['transitionStartMs'] ?? 0),
  transitionEndMs: Number(m['transitionEndMs'] ?? 0),
  sailAuto: sailAutoMerged.value,
  maneuverKind: (Number(m['maneuverKind'] ?? 0)) as 0 | 1 | 2,
  maneuverStartMs: Number(m['maneuverStartMs'] ?? 0),
  maneuverEndMs: Number(m['maneuverEndMs'] ?? 0),
  pending: {
    ...s.sail.pending,
    sailAuto: sailAutoMerged.pending,
  },
};
```

- [ ] **Step 3: Verify typecheck**

Run: `cd apps/web && pnpm typecheck`

- [ ] **Step 4: Manual sanity check**

Ouvre la page play, vérifie que le sail toggle fonctionne toujours "à l'ancienne" (pas de régression). Le pattern n'est pas encore câblé depuis SailPanel — c'est normal qu'il n'y ait pas d'effet visible.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/store/index.ts
git commit -m "feat(store): reconcile sailAuto via mergeField in applyMessages"
```

---

### Task 7: Reconciliation dans `applyMessages` (currentSail + transitions englobant)

**Files:**
- Modify: `apps/web/src/lib/store/index.ts` (nextSail construction)

**Contexte:** Les 3 champs couplés (`currentSail`, `transitionStartMs`, `transitionEndMs`) sont réconciliés via un seul pending englobant. La comparaison se fait sur `currentSail` uniquement — dès qu'il match, on accepte les 3 valeurs serveur (plus fiables).

- [ ] **Step 1: Add englobant merge logic before building nextSail**

Modify `apps/web/src/lib/store/index.ts` — dans la branche `if (boatId === ownBoatId)`, juste avant la construction de `nextSail`:

```ts
const sailChangeServer = {
  currentSail,
  transitionStartMs: Number(m['transitionStartMs'] ?? 0),
  transitionEndMs: Number(m['transitionEndMs'] ?? 0),
};
const sailChangeMerged = mergeField(
  s.sail.pending.sailChange,
  sailChangeServer,
  now,
  (a, b) => a.currentSail === b.currentSail,
);
```

- [ ] **Step 2: Use merged values in nextSail**

Modify the nextSail assignment :

```ts
nextSail = {
  ...s.sail,
  currentSail: sailChangeMerged.value.currentSail,
  sailPending: null,
  transitionStartMs: sailChangeMerged.value.transitionStartMs,
  transitionEndMs: sailChangeMerged.value.transitionEndMs,
  sailAuto: sailAutoMerged.value,
  maneuverKind: (Number(m['maneuverKind'] ?? 0)) as 0 | 1 | 2,
  maneuverStartMs: Number(m['maneuverStartMs'] ?? 0),
  maneuverEndMs: Number(m['maneuverEndMs'] ?? 0),
  pending: {
    sailAuto: sailAutoMerged.pending,
    sailChange: sailChangeMerged.pending,
  },
};
```

- [ ] **Step 3: Verify typecheck**

Run: `cd apps/web && pnpm typecheck`

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/store/index.ts
git commit -m "feat(store): reconcile currentSail + transitions via englobant pending"
```

---

### Task 8: Reconciliation dans `applyMessages` (hdg)

**Files:**
- Modify: `apps/web/src/lib/store/index.ts:83-95` (nextHud construction)

- [ ] **Step 1: Replace hdg write with mergeField**

Modify `apps/web/src/lib/store/index.ts:83-95` — remplacer le bloc nextHud :

```ts
const hdgMerged = mergeField(s.hud.pending.hdg, hdgFromMsg, now);
const derivedTwa = ((hdgMerged.value - twdFromMsg + 540) % 360) - 180;

nextHud = {
  ...s.hud,
  lat: Number(m['lat'] ?? s.hud.lat),
  lon: Number(m['lon'] ?? s.hud.lon),
  hdg: hdgMerged.value,
  bsp: Number(m['bsp'] ?? s.hud.bsp),
  twd: twdFromMsg,
  tws: twsFromMsg,
  twa: typeof serverTwaLock === 'number' ? serverTwaLock : derivedTwa,
  twaLock: typeof serverTwaLock === 'number' ? serverTwaLock : null,
  overlapFactor: Number(m['overlapFactor'] ?? s.hud.overlapFactor),
  twaColor: twaColorFromCode(twaColorCode),
  pending: {
    hdg: hdgMerged.pending,
  },
};
```

Attention : le TWA dérivé utilise maintenant `hdgMerged.value` (valeur reconciliée) pour rester cohérent avec ce que le joueur voit.

- [ ] **Step 2: Verify typecheck**

Run: `cd apps/web && pnpm typecheck`

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/store/index.ts
git commit -m "feat(store): reconcile hdg via mergeField in applyMessages"
```

---

### Task 9: Supprimer le flag `editMode` mort

**Files:**
- Modify: `apps/web/src/lib/store/selectionSlice.ts`
- Modify: `apps/web/src/lib/store/types.ts:55-58` (SelectionState)
- Modify: `apps/web/src/lib/store/types.ts:163` (SelectionActions)
- Modify: `apps/web/src/components/play/Compass.tsx` (remove setEditMode calls)
- Modify: `apps/web/src/components/play/ProgPanel.tsx:18-21` (remove setEditMode)

**Contexte:** Le pattern pending rend `editMode` inutile. Nettoyage avant d'ajouter la nouvelle UX.

- [ ] **Step 1: Remove editMode from SelectionState**

Modify `apps/web/src/lib/store/types.ts:55-58`:

```ts
export interface SelectionState {
  selectedBoatIds: Set<string>;
}
```

Et retirer `setEditMode` de SelectionActions à la ligne 163.

- [ ] **Step 2: Remove from selectionSlice.ts**

Modify `apps/web/src/lib/store/selectionSlice.ts` :

```ts
'use client';
import type { SelectionState, GameStore } from './types';

export const INITIAL_SELECTION: SelectionState = { selectedBoatIds: new Set() };

export function createSelectionSlice(set: (fn: (s: GameStore) => Partial<GameStore>) => void) {
  return {
    selection: INITIAL_SELECTION,
    selectBoat: (id: string) =>
      set((s) => {
        const next = new Set(s.selection.selectedBoatIds);
        next.add(id);
        return { selection: { ...s.selection, selectedBoatIds: next } };
      }),
    clearSelection: () =>
      set((s) => ({ selection: { ...s.selection, selectedBoatIds: new Set() } })),
  };
}
```

(Garder les autres actions si elles existent — juste retirer `setEditMode`.)

- [ ] **Step 3: Remove calls from Compass.tsx**

Modify `apps/web/src/components/play/Compass.tsx` — retirer toutes les occurrences de `useGameStore.getState().setEditMode(true)` et `setEditMode(false)`. Lignes affectées (indicatif) : 232, 258, 311, 319.

- [ ] **Step 4: Remove calls from ProgPanel.tsx**

Modify `apps/web/src/components/play/ProgPanel.tsx:18-21` — retirer :

```ts
useEffect(() => {
  useGameStore.getState().setEditMode(true);
  return () => { useGameStore.getState().setEditMode(false); };
}, []);
```

- [ ] **Step 5: Verify typecheck**

Run: `cd apps/web && pnpm typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/store/selectionSlice.ts apps/web/src/lib/store/types.ts apps/web/src/components/play/Compass.tsx apps/web/src/components/play/ProgPanel.tsx
git commit -m "refactor(store): remove dead editMode flag, superseded by pending pattern"
```

---

## Phase 2 — SailPanel wired to pending

### Task 10: SailPanel — `toggleAuto` utilise `setSailOptimistic`

**Files:**
- Modify: `apps/web/src/components/play/SailPanel.tsx:157-160` (toggleAuto)

- [ ] **Step 1: Replace toggleAuto implementation**

Modify `apps/web/src/components/play/SailPanel.tsx:157-160`:

```ts
const toggleAuto = () => {
  const next = !sailAuto;
  sendOrder({ type: 'MODE', value: { auto: next } });
  useGameStore.getState().setSailOptimistic('sailAuto', next);
};
```

- [ ] **Step 2: Remove now-dead `toggleSailAuto` from sailSlice**

Modify `apps/web/src/lib/store/sailSlice.ts` — retirer `toggleSailAuto` de `createSailSlice` (ligne 22). Retirer aussi la signature de SailActions dans types.ts.

- [ ] **Step 3: Verify no other callers**

Run: `cd apps/web && grep -rn "toggleSailAuto" src/`
Expected: aucune occurrence.

- [ ] **Step 4: Verify typecheck**

Run: `cd apps/web && pnpm typecheck`

- [ ] **Step 5: Manual test**

Lance `pnpm dev`, ouvre une course, ouvre SailPanel. Toggle Auto/Manuel plusieurs fois rapidement. Vérifie :
- Le toggle reste stable entre les ticks
- Au tick qui traite l'ordre côté serveur, le lock est libéré (pas de visible régression)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/play/SailPanel.tsx apps/web/src/lib/store/sailSlice.ts apps/web/src/lib/store/types.ts
git commit -m "feat(sail-panel): toggleAuto uses optimistic reconciliation"
```

---

### Task 11: SailPanel — `confirmSail` utilise `setOptimisticSailChange`

**Files:**
- Modify: `apps/web/src/components/play/SailPanel.tsx:131-150` (confirmSail)

- [ ] **Step 1: Rewrite confirmSail**

Modify `apps/web/src/components/play/SailPanel.tsx:131-150`:

```ts
const confirmSail = () => {
  if (!candidateSail) return;
  const duration = getTransitionDuration(currentSail, candidateSail);
  const startMs = Date.now();

  if (wasAuto) {
    sendOrder({ type: 'MODE', value: { auto: false } });
    useGameStore.getState().setSailOptimistic('sailAuto', false);
  }
  sendOrder({ type: 'SAIL', value: { sail: candidateSail } });
  useGameStore.getState().setOptimisticSailChange({
    currentSail: candidateSail,
    transitionStartMs: startMs,
    transitionEndMs: startMs + duration * 1000,
  });

  setNow(startMs);
  setCandidateSail(null);
  useGameStore.getState().setPreview({ sail: null });
};
```

(Le `setSail({...})` ad-hoc est remplacé par l'action englobante. `setWasAuto(false)` n'est plus nécessaire — l'état `wasAuto` ne sert qu'à savoir s'il faut envoyer MODE false.)

- [ ] **Step 2: Verify typecheck**

Run: `cd apps/web && pnpm typecheck`

- [ ] **Step 3: Manual test**

Scénario de régression utilisateur :
1. Ouvre SailPanel en mode Auto
2. Clique sur une voile spécifique (ex. JIB) → candidate strip apparaît
3. Clique "Confirmer"
4. Vérifie que le toggle passe à "Manuel" immédiatement et **reste** sur Manuel au tick suivant
5. Vérifie que le countdown "Manœuvre en cours · Xs" apparaît sur JIB et décompte sans glitch

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/play/SailPanel.tsx
git commit -m "feat(sail-panel): confirmSail uses optimistic sail-change reconciliation"
```

---

## Phase 3 — Compass Cancel UX

### Task 12: Compass — `apply()` utilise `setHudOptimistic`

**Files:**
- Modify: `apps/web/src/components/play/Compass.tsx:320-345` (apply function — indicatif, à vérifier après les modifs utilisateur)

**Contexte:** L'utilisateur a déjà unifié Apply pour CAP + TWA lock. On remplace les `setHud({ hdg })` par `setHudOptimistic('hdg', ...)`.

- [ ] **Step 1: Read current apply()**

Lis la fonction `apply` dans `Compass.tsx` (chercher `const apply = () =>`). Note les 2 endroits où `setHud({ hdg: targetHdg })` ou équivalent est appelé.

- [ ] **Step 2: Replace with setHudOptimistic**

Dans la branche `twaLocked` et dans la branche `else`, remplacer :

```ts
// Avant :
useGameStore.getState().setHud({ hdg: targetHdg });
// Après :
useGameStore.getState().setHudOptimistic('hdg', Math.round(targetHdg));
```

Pour la branche TWA lock, l'appel existant est `setHud({ hdg: targetHdg })` après le sendOrder TWA — même remplacement.

- [ ] **Step 3: Verify typecheck**

Run: `cd apps/web && pnpm typecheck`

- [ ] **Step 4: Manual test**

1. Ouvre Compass
2. Tourne à 180° (drag)
3. Clique "Valider"
4. Vérifie que le cap reste à 180° même si le prochain broadcast arrive avant que l'ordre soit traité par le serveur (pas de snap en arrière)
5. Au tick où le serveur confirme, le lock se libère silencieusement

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/play/Compass.tsx
git commit -m "feat(compass): apply uses optimistic hdg reconciliation"
```

---

### Task 13: Compass — Badge × pour cancel direct sur la cible

**Files:**
- Modify: `apps/web/src/components/play/Compass.tsx` (SVG rendering — trouver la section qui rend le cap-cible)
- Modify: `apps/web/src/components/play/Compass.module.css` (styles du badge)

**Contexte:** Ajouter un petit badge rond à la position du cap-cible quand `applyActive`, contenant la valeur "225°" et une croix × cliquable.

- [ ] **Step 1: Locate target heading indicator in SVG**

Grep dans `Compass.tsx` pour trouver où le marker du cap-cible est rendu (chercher `targetHdg` dans le JSX). Probablement une ligne ou un triangle qui pointe à `targetHdg` sur le cercle externe.

- [ ] **Step 2: Add cancel badge JSX**

À côté (ou à la place) de l'indicateur existant, ajouter un `<g>` qui se positionne à la cible :

```tsx
{applyActive && targetHdg !== null && (() => {
  const pos = pt(R_OUTER + 18, targetHdg); // 18px outside the ring
  return (
    <g
      className={styles.cancelBadge}
      transform={`translate(${pos.x}, ${pos.y})`}
      onPointerDown={(e) => { e.stopPropagation(); cancelEdit(); }}
    >
      <circle r="14" className={styles.cancelBadgeBg} />
      <text textAnchor="middle" dy="-2" className={styles.cancelBadgeValue}>
        {Math.round(targetHdg)}°
      </text>
      <text textAnchor="middle" dy="10" className={styles.cancelBadgeX}>×</text>
    </g>
  );
})()}
```

(Si la fonction `pt` n'est pas en scope du JSX, la déplacer au top-level ou l'inliner.)

- [ ] **Step 3: Add CSS for badge**

Modify `apps/web/src/components/play/Compass.module.css` — ajouter :

```css
.cancelBadge {
  cursor: pointer;
  pointer-events: all;
}
.cancelBadgeBg {
  fill: rgba(26, 42, 59, 0.95);
  stroke: #c9a227;
  stroke-width: 1.5;
}
.cancelBadgeValue {
  fill: #f5f0e8;
  font-size: 8px;
  font-weight: 600;
}
.cancelBadgeX {
  fill: #d97b5a;
  font-size: 12px;
  font-weight: 700;
}
.cancelBadge:hover .cancelBadgeBg {
  fill: rgba(217, 123, 90, 0.25);
}
```

- [ ] **Step 4: Manual test**

1. Drag le compass à 225°
2. Un badge "225° ×" apparaît près du cercle externe
3. Clique sur le badge → cap revient à la valeur actuelle, preview clear, pas d'ordre envoyé

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/play/Compass.tsx apps/web/src/components/play/Compass.module.css
git commit -m "feat(compass): add cancel badge on target heading"
```

---

### Task 14: Compass — Tap-outside pour cancel

**Files:**
- Modify: `apps/web/src/components/play/Compass.tsx`

**Contexte:** Listener `pointerdown` global qui annule si clic hors du SVG Compass et hors des boutons d'action.

- [ ] **Step 1: Add data-compass-zone attributes**

Dans `Compass.tsx`, ajouter `data-compass-zone="true"` sur le container racine du compass (le `<div>` qui contient le SVG + les boutons CAP/TWA/Valider). Idem dans `PlayClient.tsx` sur `.actionButtons` (le bloc Voiles/Prog/Centrer/Zoom).

- [ ] **Step 2: Add global pointerdown listener in Compass**

Ajouter dans `Compass.tsx`, juste après le useEffect du drag handling :

```tsx
useEffect(() => {
  if (!applyActive) return;
  const onPointerDown = (e: PointerEvent) => {
    const target = e.target as Element | null;
    if (target?.closest('[data-compass-zone="true"]')) return;
    cancelEdit();
  };
  document.addEventListener('pointerdown', onPointerDown);
  return () => document.removeEventListener('pointerdown', onPointerDown);
}, [applyActive]);
```

- [ ] **Step 3: Manual test**

1. Drag le compass à 225°
2. Clique sur la carte (n'importe où hors compass/boutons d'action) → cap annulé
3. Drag à nouveau, clique sur un bouton d'action (Voiles) → cap PAS annulé (on reste en édition)
4. Drag à nouveau, clique sur une autre zone du SVG Compass → cap PAS annulé

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/play/Compass.tsx apps/web/src/app/play/[raceId]/PlayClient.tsx
git commit -m "feat(compass): tap outside to cancel target heading"
```

---

## Phase 4 — Compass Responsive Layout

### Task 15: Hook `useCompassLayout` + tests

**Files:**
- Create: `apps/web/src/components/play/hooks/useCompassLayout.ts`
- Create: `apps/web/src/components/play/hooks/useCompassLayout.test.ts`

**Contexte:** Décide un palier (`stack-vertical`, `bar-horizontal`, `side-by-side`) en fonction de la taille du viewport.

- [ ] **Step 1: Write test for palier logic (pure function)**

Create `apps/web/src/components/play/hooks/useCompassLayout.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickCompassLayout } from './useCompassLayout.js';

test('pickCompassLayout — large → stack-vertical', () => {
  assert.equal(pickCompassLayout(1080, 1920), 'stack-vertical');
});

test('pickCompassLayout — tablet portrait → stack-vertical', () => {
  assert.equal(pickCompassLayout(1024, 768), 'stack-vertical');
});

test('pickCompassLayout — tablet landscape short → bar-horizontal', () => {
  assert.equal(pickCompassLayout(400, 1024), 'bar-horizontal');
});

test('pickCompassLayout — mobile landscape → side-by-side', () => {
  assert.equal(pickCompassLayout(350, 800), 'side-by-side');
});

test('pickCompassLayout — very small → side-by-side', () => {
  assert.equal(pickCompassLayout(300, 600), 'side-by-side');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm test`
Expected: FAIL with "Cannot find module './useCompassLayout.js'"

- [ ] **Step 3: Implement pickCompassLayout + useCompassLayout hook**

Create `apps/web/src/components/play/hooks/useCompassLayout.ts`:

```ts
import { useEffect, useState } from 'react';

export type CompassLayout = 'stack-vertical' | 'bar-horizontal' | 'side-by-side';

export function pickCompassLayout(height: number, width: number): CompassLayout {
  if (height >= 480) return 'stack-vertical';
  if (height >= 360 && width >= 720) return 'bar-horizontal';
  return 'side-by-side';
}

export function useCompassLayout(): CompassLayout {
  const [layout, setLayout] = useState<CompassLayout>('stack-vertical');

  useEffect(() => {
    const compute = () => {
      setLayout(pickCompassLayout(window.innerHeight, window.innerWidth));
    };
    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, []);

  return layout;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && pnpm test`
Expected: 5 tests passing (+ previous mergeField tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/play/hooks/useCompassLayout.ts apps/web/src/components/play/hooks/useCompassLayout.test.ts
git commit -m "feat(compass): add useCompassLayout hook with 3 responsive paliers"
```

---

### Task 16: Appliquer les paliers layout dans PlayClient

**Files:**
- Modify: `apps/web/src/app/play/[raceId]/PlayClient.tsx` (rightStack section, around line 245-304)
- Modify: `apps/web/src/app/play/[raceId]/PlayClient.module.css` (or wherever rightStack styles live)

- [ ] **Step 1: Import and call hook**

Modify `apps/web/src/app/play/[raceId]/PlayClient.tsx` — add at top of component:

```tsx
import { useCompassLayout } from '@/components/play/hooks/useCompassLayout';
// ...
const compassLayout = useCompassLayout();
```

- [ ] **Step 2: Apply class modifier to rightStack**

Modify the existing `.rightStack` div at line 247:

```tsx
<div className={`${styles.rightStack} ${styles[`layout_${compassLayout.replace('-', '_')}`]}`}>
```

(Ex: `layout_stack_vertical`, `layout_bar_horizontal`, `layout_side_by_side`.)

- [ ] **Step 3: Add CSS modifiers**

Modify `apps/web/src/app/play/[raceId]/PlayClient.module.css` (or wherever `.rightStack` / `.actionButtons` live) — ajouter :

```css
.rightStack.layout_stack_vertical {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.rightStack.layout_stack_vertical .actionButtons {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.rightStack.layout_bar_horizontal {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.rightStack.layout_bar_horizontal .actionButtons {
  display: flex;
  flex-direction: row;
  gap: 6px;
  flex-wrap: wrap;
}

.rightStack.layout_side_by_side {
  display: flex;
  flex-direction: row-reverse;
  gap: 8px;
  align-items: center;
}
.rightStack.layout_side_by_side .actionButtons {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
```

- [ ] **Step 4: Constrain Compass height**

Modify `.rightStack .compass` (ou sélecteur équivalent) :

```css
.rightStack :global(svg[viewBox="0 0 220 220"]) {
  max-height: calc(100vh - 200px);
  max-width: min(220px, 40vh);
  width: auto;
  height: auto;
}
```

(Le sélecteur `:global(...)` cible le SVG du Compass sans avoir à modifier son fichier si le module CSS ne le gère pas directement.)

- [ ] **Step 5: Manual test — chaque palier**

1. Desktop 1080×1920 : palier 1, colonne verticale
2. DevTools → redimensionner fenêtre à ~1200×400 (tablette paysage étroite) : palier 2, boutons horizontaux
3. DevTools → redimensionner à ~800×350 (mobile paysage) : palier 3, boutons à gauche du compass
4. Dans tous les cas, les boutons Voiles/Prog/Centrer doivent être visibles

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/play/[raceId]/PlayClient.tsx apps/web/src/app/play/[raceId]/PlayClient.module.css
git commit -m "feat(play): responsive compass layout with 3 paliers"
```

---

## Phase 5 — ProgPanel

### Task 17: Helper `obsolete.ts` + tests

**Files:**
- Create: `apps/web/src/lib/orders/obsolete.ts`
- Create: `apps/web/src/lib/orders/obsolete.test.ts`

- [ ] **Step 1: Write obsolete.test.ts**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isObsolete, MIN_LEAD_TIME_MS, validateLeadTime } from './obsolete.js';

test('MIN_LEAD_TIME_MS is 5 minutes', () => {
  assert.equal(MIN_LEAD_TIME_MS, 5 * 60 * 1000);
});

test('isObsolete — AT_TIME in past is obsolete', () => {
  const order = { trigger: { type: 'AT_TIME' as const, time: 900 } };
  assert.equal(isObsolete(order, 1_000_000, new Set()), true);
});

test('isObsolete — AT_TIME in future not obsolete', () => {
  const order = { trigger: { type: 'AT_TIME' as const, time: 2000 } };
  assert.equal(isObsolete(order, 1_000_000, new Set()), false);
});

test('isObsolete — AFTER_DURATION never obsolete', () => {
  const order = { trigger: { type: 'AFTER_DURATION' as const, duration: 120 } };
  assert.equal(isObsolete(order, 1_000_000, new Set()), false);
});

test('isObsolete — AT_WAYPOINT passed is obsolete', () => {
  const order = { trigger: { type: 'AT_WAYPOINT' as const, waypointOrderId: 'wp1' } };
  assert.equal(isObsolete(order, 1_000_000, new Set(['wp1'])), true);
});

test('isObsolete — AT_WAYPOINT not yet passed', () => {
  const order = { trigger: { type: 'AT_WAYPOINT' as const, waypointOrderId: 'wp1' } };
  assert.equal(isObsolete(order, 1_000_000, new Set(['wp2'])), false);
});

test('validateLeadTime — AT_TIME with >5min lead is valid', () => {
  const r = validateLeadTime({ type: 'AT_TIME', time: (1_000_000 / 1000) + 360 }, 1_000_000);
  assert.equal(r.ok, true);
});

test('validateLeadTime — AT_TIME with <5min lead is invalid', () => {
  const r = validateLeadTime({ type: 'AT_TIME', time: (1_000_000 / 1000) + 120 }, 1_000_000);
  assert.equal(r.ok, false);
  assert.match(r.error ?? '', /5 min/);
});

test('validateLeadTime — AFTER_DURATION with >5min is valid', () => {
  const r = validateLeadTime({ type: 'AFTER_DURATION', duration: 400 }, 1_000_000);
  assert.equal(r.ok, true);
});

test('validateLeadTime — AFTER_DURATION with <5min is invalid', () => {
  const r = validateLeadTime({ type: 'AFTER_DURATION', duration: 120 }, 1_000_000);
  assert.equal(r.ok, false);
});

test('validateLeadTime — AT_WAYPOINT is always valid (checked elsewhere)', () => {
  const r = validateLeadTime({ type: 'AT_WAYPOINT', waypointOrderId: 'wp1' }, 1_000_000);
  assert.equal(r.ok, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement obsolete.ts**

Create `apps/web/src/lib/orders/obsolete.ts`:

```ts
export const MIN_LEAD_TIME_MS = 5 * 60 * 1000;

export type Trigger =
  | { type: 'AT_TIME'; time: number }           // time in seconds Unix
  | { type: 'AT_WAYPOINT'; waypointOrderId: string }
  | { type: 'AFTER_DURATION'; duration: number };

export interface OrderLike {
  trigger: Trigger;
}

export function isObsolete(order: OrderLike, nowMs: number, passedWaypoints: Set<string>): boolean {
  switch (order.trigger.type) {
    case 'AT_TIME':
      return order.trigger.time * 1000 <= nowMs;
    case 'AFTER_DURATION':
      return false;
    case 'AT_WAYPOINT':
      return passedWaypoints.has(order.trigger.waypointOrderId);
  }
}

export function validateLeadTime(trigger: Trigger, nowMs: number): { ok: boolean; error?: string } {
  switch (trigger.type) {
    case 'AT_TIME': {
      const lead = trigger.time * 1000 - nowMs;
      if (lead < MIN_LEAD_TIME_MS) return { ok: false, error: 'Minimum 5 min dans le futur' };
      return { ok: true };
    }
    case 'AFTER_DURATION': {
      if (trigger.duration * 1000 < MIN_LEAD_TIME_MS) return { ok: false, error: 'Minimum 5 min' };
      return { ok: true };
    }
    case 'AT_WAYPOINT':
      return { ok: true };
  }
}
```

- [ ] **Step 4: Run tests**

Run: `cd apps/web && pnpm test`
Expected: all 11 tests passing.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/orders/obsolete.ts apps/web/src/lib/orders/obsolete.test.ts
git commit -m "feat(orders): add obsolete-order helper and lead-time validation"
```

---

### Task 18: ProgPanel — retirer `immediate`, ajouter validation lead-time

**Files:**
- Modify: `apps/web/src/components/play/ProgPanel.tsx`

- [ ] **Step 1: Remove `immediate` from trigger options**

Modify `apps/web/src/components/play/ProgPanel.tsx:61-66`:

```tsx
<select className={styles.fieldInput} value={trigger} onChange={(e) => setTrigger(e.target.value)}>
  <option value="at_time">À une heure précise</option>
  <option value="at_waypoint">À un waypoint</option>
  <option value="after_duration">Après une durée</option>
</select>
```

Change default state:

```tsx
const [trigger, setTrigger] = useState('at_time');
```

- [ ] **Step 2: Add lead-time state fields**

Au top de `ProgPanel`, ajouter les states pour les valeurs des triggers :

```tsx
const [atTimeValue, setAtTimeValue] = useState(''); // ISO string
const [afterDurationMin, setAfterDurationMin] = useState(30);
const [atWaypointId, setAtWaypointId] = useState('');
```

- [ ] **Step 3: Add trigger-specific input fields**

Remplacer la section du formulaire après le `select` trigger par :

```tsx
{trigger === 'at_time' && (
  <div className={styles.field}>
    <label className={styles.fieldLabel}>Heure cible</label>
    <input
      type="datetime-local"
      className={`${styles.fieldInput} ${leadError ? styles.fieldInputError : ''}`}
      value={atTimeValue}
      onChange={(e) => setAtTimeValue(e.target.value)}
    />
    {leadError && <span className={styles.fieldError}>{leadError}</span>}
  </div>
)}
{trigger === 'after_duration' && (
  <div className={styles.field}>
    <label className={styles.fieldLabel}>Dans (minutes, min 5)</label>
    <input
      type="number"
      min={5}
      className={`${styles.fieldInput} ${leadError ? styles.fieldInputError : ''}`}
      value={afterDurationMin}
      onChange={(e) => setAfterDurationMin(Number(e.target.value))}
    />
    {leadError && <span className={styles.fieldError}>{leadError}</span>}
  </div>
)}
{trigger === 'at_waypoint' && (
  <div className={styles.field}>
    <label className={styles.fieldLabel}>Waypoint</label>
    <select className={styles.fieldInput} value={atWaypointId} onChange={(e) => setAtWaypointId(e.target.value)}>
      <option value="">— Choisir —</option>
      {/* waypoints à lister depuis le store quand dispo ; pour l'instant stub */}
    </select>
  </div>
)}
```

- [ ] **Step 4: Compute `leadError` via `validateLeadTime`**

Ajouter avant le JSX :

```tsx
import { validateLeadTime } from '@/lib/orders/obsolete';

// ... dans le composant :
const now = Date.now();
let currentTrigger = null;
if (trigger === 'at_time' && atTimeValue) {
  currentTrigger = { type: 'AT_TIME' as const, time: Math.floor(new Date(atTimeValue).getTime() / 1000) };
} else if (trigger === 'after_duration') {
  currentTrigger = { type: 'AFTER_DURATION' as const, duration: afterDurationMin * 60 };
} else if (trigger === 'at_waypoint' && atWaypointId) {
  currentTrigger = { type: 'AT_WAYPOINT' as const, waypointOrderId: atWaypointId };
}
const validation = currentTrigger ? validateLeadTime(currentTrigger, now) : { ok: false };
const leadError = !validation.ok && currentTrigger?.type !== 'AT_WAYPOINT' ? validation.error : null;
const canAdd = validation.ok && (trigger !== 'at_waypoint' || atWaypointId !== '');
```

- [ ] **Step 5: Disable Add button**

Modify the submit button:

```tsx
<button
  type="button"
  className={styles.submit}
  onClick={handleAddOrder}
  disabled={!canAdd}
>
  Ajouter à la file
</button>
```

- [ ] **Step 6: Update `handleAddOrder` to build order from current trigger**

Remplacer :

```tsx
const handleAddOrder = () => {
  if (!canAdd || !currentTrigger) return;
  const id = `order-${Date.now()}`;
  addOrder({
    id,
    type: 'CAP',
    trigger: currentTrigger,
    value: { heading: Number(capValue) },
    label: `Cap → ${capValue}°`,
  });
};
```

- [ ] **Step 7: Add CSS for error state**

Modify `apps/web/src/components/play/ProgPanel.module.css` — ajouter :

```css
.fieldInputError {
  border-color: #d97b5a !important;
  outline-color: #d97b5a;
}
.fieldError {
  color: #d97b5a;
  font-size: 11px;
  margin-top: 2px;
}
```

- [ ] **Step 8: Verify typecheck**

Run: `cd apps/web && pnpm typecheck`

- [ ] **Step 9: Manual test**

1. Ouvre ProgPanel
2. Sélectionne "Après une durée", saisi 3 (min) → champ rouge, bouton Ajouter disabled
3. Saisi 10 → champ normal, bouton enabled
4. Clique Ajouter → ordre ajouté à la queue
5. Sélectionne "À une heure précise", saisi heure dans 2 min → erreur
6. Saisi heure dans 30 min → OK

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/components/play/ProgPanel.tsx apps/web/src/components/play/ProgPanel.module.css
git commit -m "feat(prog-panel): remove immediate trigger, enforce 5min min lead time"
```

---

### Task 19: ProgPanel — Re-validation live des ordres dans la queue

**Files:**
- Modify: `apps/web/src/components/play/ProgPanel.tsx`

**Contexte:** Chaque seconde, re-vérifier les triggers des ordres affichés. Marquer "bientôt obsolète" si < 5 min de lead time restant.

- [ ] **Step 1: Add a ticking `now` state**

Ajouter en haut de `ProgPanel` :

```tsx
const [now, setNow] = useState(Date.now());
useEffect(() => {
  const id = setInterval(() => setNow(Date.now()), 1000);
  return () => clearInterval(id);
}, []);
```

- [ ] **Step 2: Compute staleness per order**

Dans la render de la queue (ligne ~103-116), pour chaque ordre, calcule :

```tsx
{orderQueue.map((o) => {
  const stale = isOrderStale(o, now);
  return (
    <div key={o.id} className={`${styles.order} ${stale ? styles.orderStale : ''}`}>
      <span className={styles.orderWhen}>
        {formatTrigger(o.trigger, now)}
      </span>
      <span className={styles.orderWhat}>{o.label}</span>
      {stale && <span className={styles.orderStaleBadge}>⚠ bientôt obsolète</span>}
      <button type="button" className={styles.orderDel} onClick={() => removeOrder(o.id)} aria-label="Supprimer">✕</button>
    </div>
  );
})}
```

Helpers (à définir en haut du fichier ou dans un helper séparé) :

```tsx
function isOrderStale(order: OrderEntry, now: number): boolean {
  if (order.trigger.type === 'AT_TIME') {
    return order.trigger.time * 1000 - now < 5 * 60 * 1000;
  }
  return false;
}

function formatTrigger(trigger: OrderEntry['trigger'], now: number): string {
  if (trigger.type === 'AT_TIME') {
    return new Date(trigger.time * 1000).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }
  if (trigger.type === 'AFTER_DURATION') {
    return `Dans ${Math.round(trigger.duration / 60)} min`;
  }
  if (trigger.type === 'AT_WAYPOINT') {
    return `Au waypoint ${trigger.waypointOrderId}`;
  }
  return 'Inconnu';
}
```

- [ ] **Step 3: Add CSS for stale state**

Modify `apps/web/src/components/play/ProgPanel.module.css` :

```css
.orderStale {
  border-color: rgba(217, 123, 90, 0.4);
}
.orderStaleBadge {
  color: #d97b5a;
  font-size: 10px;
  margin-left: 4px;
}
```

- [ ] **Step 4: Manual test**

1. Ajoute un ordre "À une heure précise" pour dans 7 min
2. Attends 2-3 min, le badge "⚠ bientôt obsolète" apparaît quand le lead time passe sous 5 min
3. Ordre non-stale continue à afficher normalement

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/play/ProgPanel.tsx apps/web/src/components/play/ProgPanel.module.css
git commit -m "feat(prog-panel): live re-validation badge for stale scheduled orders"
```

---

### Task 20: ProgPanel — Commit queue → sendOrder + toast résultat

**Files:**
- Modify: `apps/web/src/components/play/ProgPanel.tsx`
- Create: `apps/web/src/components/ui/Toast.tsx`
- Create: `apps/web/src/components/ui/Toast.module.css`

**Contexte:** Le bouton "Valider la file" envoie tous les ordres valides via sendOrder (filtrant les obsolètes), puis affiche un toast "N envoyés, M ignorés".

- [ ] **Step 1: Create Toast component**

Create `apps/web/src/components/ui/Toast.tsx`:

```tsx
'use client';
import { useEffect } from 'react';
import styles from './Toast.module.css';

export interface ToastProps {
  message: string;
  type?: 'info' | 'success' | 'warning';
  duration?: number;
  onClose: () => void;
}

export default function Toast({ message, type = 'info', duration = 5000, onClose }: ToastProps): React.ReactElement {
  useEffect(() => {
    const id = setTimeout(onClose, duration);
    return () => clearTimeout(id);
  }, [duration, onClose]);

  return (
    <div className={`${styles.toast} ${styles[type]}`}>
      <span>{message}</span>
      <button type="button" onClick={onClose} aria-label="Fermer">×</button>
    </div>
  );
}
```

Create `apps/web/src/components/ui/Toast.module.css`:

```css
.toast {
  position: fixed;
  top: 24px;
  right: 24px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: rgba(26, 42, 59, 0.98);
  border: 1px solid #c9a227;
  border-radius: 6px;
  color: #f5f0e8;
  font-size: 13px;
  z-index: 1000;
  animation: toastIn 0.2s ease-out;
}
.toast button {
  background: transparent;
  border: none;
  color: #f5f0e8;
  cursor: pointer;
  font-size: 16px;
}
.info { border-color: #c9a227; }
.success { border-color: #7aa874; }
.warning { border-color: #d97b5a; }

@keyframes toastIn {
  from { opacity: 0; transform: translateY(-8px); }
  to { opacity: 1; transform: translateY(0); }
}
```

- [ ] **Step 2: Add commit logic to ProgPanel**

Modify `apps/web/src/components/play/ProgPanel.tsx` — ajouter en haut :

```tsx
import { sendOrder } from '@/lib/store';
import { isObsolete } from '@/lib/orders/obsolete';
import Toast from '@/components/ui/Toast';

// ... dans le composant :
const [toast, setToast] = useState<{ message: string; type: 'success' | 'warning' } | null>(null);

const handleCommit = () => {
  const nowMs = Date.now();
  const passedWaypoints = new Set<string>(); // TODO: plug real waypoints state when available
  const sent: string[] = [];
  const skipped: string[] = [];
  for (const order of orderQueue) {
    if (isObsolete(order, nowMs, passedWaypoints)) {
      skipped.push(order.label);
      continue;
    }
    sendOrder({ type: order.type, value: order.value, trigger: order.trigger });
    sent.push(order.id);
  }
  // Purge sent orders from local queue
  for (const id of sent) removeOrder(id);

  if (skipped.length > 0) {
    setToast({ message: `${sent.length} ordres envoyés, ${skipped.length} ignorés (obsolètes)`, type: 'warning' });
  } else if (sent.length > 0) {
    setToast({ message: `${sent.length} ordres envoyés`, type: 'success' });
  }
};
```

- [ ] **Step 3: Add commit button + toast render**

Dans le JSX, après la queue, ajouter :

```tsx
{orderQueue.length > 0 && (
  <button type="button" className={styles.commitBtn} onClick={handleCommit}>
    Valider la file ({orderQueue.length})
  </button>
)}

{toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
```

- [ ] **Step 4: Add CSS for commit button**

Modify `ProgPanel.module.css` :

```css
.commitBtn {
  margin-top: 16px;
  width: 100%;
  padding: 10px;
  background: #c9a227;
  color: #0a0a0f;
  border: none;
  border-radius: 6px;
  font-weight: 600;
  cursor: pointer;
}
.commitBtn:hover {
  background: #d4b03a;
}
```

- [ ] **Step 5: Manual test**

1. Ajoute 2 ordres "at_time" dans 30 min chacun
2. Clique "Valider la file" → toast vert "2 ordres envoyés"
3. Ajoute 1 ordre at_time dans 6 min, attends 2 min (ordre devient obsolète)
4. Clique "Valider la file" → toast orange "0 envoyés, 1 ignoré"

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/ui/Toast.tsx apps/web/src/components/ui/Toast.module.css apps/web/src/components/play/ProgPanel.tsx apps/web/src/components/play/ProgPanel.module.css
git commit -m "feat(prog-panel): commit queue with obsolete filter and toast feedback"
```

---

## Phase 6 — Serveur race fix

### Task 21: Worker — drain ingest avant tick

**Files:**
- Modify: `apps/game-engine/src/engine/worker.ts:95-119`
- Create: `apps/game-engine/src/engine/worker-race.test.ts`

**Contexte:** Avant de traiter un message `tick`, yield au micro-task loop pour laisser `ingestOrder` déjà en file être dépilé.

- [ ] **Step 1: Write regression test**

Create `apps/game-engine/src/engine/worker-race.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

// This test documents the expected behavior: when both a 'tick' and an
// 'ingestOrder' message arrive at the worker in quick succession, the
// ingestOrder must be processed BEFORE the tick's runTick() even if the
// tick message was received first.
//
// We can't easily unit-test worker message ordering without spinning up a
// real Worker thread. Instead, we verify the intent via a minimal helper
// that simulates the drain behavior.

test('drainThenTick — micro-tasks flush before tick processing', async () => {
  const events: string[] = [];
  // Simulate: tick message arrives first, then an ingestOrder is queued
  // as a micro-task before we process the tick.
  const simulateWorker = async () => {
    // Pretend we received 'tick'
    const tickMsg = Promise.resolve().then(() => events.push('tick-handled'));
    // Simulate an ingest that also arrived (but as a later micro-task)
    Promise.resolve().then(() => events.push('ingest-handled'));

    // The fix: yield before handling tick so pending micro-tasks drain
    await new Promise((r) => setImmediate(r));
    await tickMsg;
  };

  await simulateWorker();

  assert.deepEqual(events, ['ingest-handled', 'tick-handled'],
    'ingest must be processed before tick after setImmediate yield');
});
```

- [ ] **Step 2: Run test to verify it fails (or check current behavior)**

Run: `cd apps/game-engine && pnpm test src/engine/worker-race.test.ts`
Expected: PASS if the test itself is correctly structured. This test documents the intent; the actual fix in worker.ts follows.

- [ ] **Step 3: Apply drain in worker.ts**

Modify `apps/game-engine/src/engine/worker.ts:95-119` — wrap the tick handler body in an async IIFE with setImmediate yield:

```ts
if (msg.kind === 'tick') {
  // Drain any pending ingestOrder messages already on the event loop before
  // running the tick. Without this, a 'tick' dequeued before a same-batch
  // 'ingestOrder' leads to that order being processed only on the NEXT tick.
  void (async () => {
    await new Promise((r) => setImmediate(r));
    seq += 1;
    const tickStartMs = lastTickEnd;
    const tickEndMs = tickStartMs + TICK_MS;
    lastTickEnd = tickEndMs;
    const outcomes: TickOutcome[] = runtimes.map(
      (r) => runTick(r, { polar, weather, zones }, tickStartMs, tickEndMs),
    );
    runtimes = outcomes.map((o) => o.runtime);
    for (const o of outcomes) {
      log.info({
        tick: seq,
        boat: o.runtime.boat.id,
        lat: o.runtime.boat.position.lat.toFixed(6),
        lon: o.runtime.boat.position.lon.toFixed(6),
        hdg: o.runtime.boat.heading,
        twa: o.twa.toFixed(2),
        tws: o.tws,
        bsp: o.bsp.toFixed(3),
        sail: o.runtime.boat.sail,
        segments: o.segments.length,
      }, 'tick');
    }
    parentPort!.postMessage({ kind: 'tick:done', seq, runtimes, outcomes });
  })();
  return;
}
```

- [ ] **Step 4: Verify existing e2e tests still pass**

Run: `cd apps/game-engine && pnpm test:e2e`
Expected: tick e2e passes as before (no regression).

- [ ] **Step 5: Manual integration test**

1. Lance le backend (`pnpm dev` à la racine ou uniquement game-engine)
2. Ouvre le client, toggle Auto/Manuel rapidement (plusieurs fois en moins de 30s)
3. Vérifie dans les logs du worker que les `ingestOrder` sont loggés AVANT le `tick` du batch suivant
4. UI : pas de régression visible (toggle reste stable)

- [ ] **Step 6: Commit**

```bash
git add apps/game-engine/src/engine/worker.ts apps/game-engine/src/engine/worker-race.test.ts
git commit -m "fix(worker): drain ingest queue before running tick to close race"
```

---

## Phase 7 — Vérification globale

### Task 22: Smoke test manuel de non-régression

**Files:** aucun — test manuel.

- [ ] **Step 1: Scénario A — SailPanel toggle**

1. Ouvre play, SailPanel ouvert en mode Manuel
2. Toggle Auto
3. Observe pendant 60s+ (2 ticks) : le toggle reste sur Auto
4. Toggle Manuel rapidement (avant tick confirmation d'Auto)
5. Observe : reste sur Manuel, pas de flicker

- [ ] **Step 2: Scénario B — SailPanel changement de voile en Auto**

1. Mode Auto, voile courante quelconque
2. Clique sur JIB → candidate strip
3. Confirme
4. Observe immédiatement : toggle passe à Manuel, countdown "Manœuvre en cours · 180s" affiché
5. Observe 30s+ : pas de snap arrière, countdown décrémente

- [ ] **Step 3: Scénario C — Compass apply avec race**

1. Compass, drag à 180°
2. Clique Valider juste avant le tick (chrono mental à ~29s depuis dernier broadcast)
3. Observe : cap reste à 180°, pas de snap en arrière
4. Au tick suivant : reste à 180°
5. Au surtick (où l'ordre est traité) : reste à 180° (match serveur)

- [ ] **Step 4: Scénario D — Compass cancel (3 modes)**

1. Drag à 200° → badge × visible
2. Clique × → cap revient, projection revert
3. Drag à 200° → clique sur la carte (hors compass/boutons) → cap revient
4. Drag à 200° → Échap → cap revient

- [ ] **Step 5: Scénario E — Compass layout responsive**

1. Desktop plein écran : palier 1, colonne verticale
2. DevTools → redimensionner à ~1200×400 : palier 2, boutons horizontaux
3. DevTools → redimensionner à ~800×350 : palier 3, boutons à gauche
4. Dans tous les cas, Voiles/Prog/Centrer visibles

- [ ] **Step 6: Scénario F — ProgPanel lead time**

1. ProgPanel, trigger "Après une durée", 3 min → champ rouge, bouton disabled
2. 10 min → bouton enabled, ajoute à la queue
3. trigger "À une heure précise", heure dans 2 min → erreur
4. Heure dans 1h → OK, ajoute
5. Attends que le premier ordre passe < 5 min de lead : badge "⚠ bientôt obsolète" dans la queue

- [ ] **Step 7: Scénario G — ProgPanel commit mixte**

1. Ajoute 2 ordres valides + 1 ordre qui va devenir obsolète (at_time dans 6 min)
2. Attends 2 min
3. Clique Valider la file → toast "2 envoyés, 1 ignoré"
4. Queue vide

- [ ] **Step 8: Check typecheck + existing tests**

Run (à la racine) : `pnpm -r typecheck && pnpm --filter @nemo/web test && pnpm --filter @nemo/game-engine test`
Expected: tout vert.

- [ ] **Step 9: Commit final si tout OK**

Si des ajustements finaux nécessaires après smoke test, les committer. Sinon pas de commit supplémentaire.

---

## Notes pour l'implémenteur

- **Ordre strict** : les phases sont dépendantes. Phase 1 → Phase 2 → Phase 3 → etc. Pas de parallélisation.
- **Pas de Vitest** : tous les tests unitaires utilisent `node:test` pour rester cohérents avec la convention du repo (voir `apps/game-engine/src/engine/bands.test.ts`).
- **Modifs utilisateur existantes dans Compass** : l'utilisateur a déjà supprimé le modal Échap, unifié Apply, et synced serverTwaLock. **Ne pas casser ces modifs** — les tasks Phase 3 complètent sans retirer cette logique.
- **Pas de ConfirmDialog pour cancel** : on vire l'ancien modal au profit du × direct (plus aligné avec la spec).
- **`sailPending` existant** : ne pas confondre avec le nouveau `pending`. `sailPending` est un champ null-or-SailId pour une autre logique (non utilisée activement). On n'y touche pas.
- **Waypoints réels** : la notion `passedWaypoints` dans ProgPanel est un stub (Set vide) — à plugger quand le state waypoints sera réel côté client. La fonction `isObsolete` gère déjà ce cas.
