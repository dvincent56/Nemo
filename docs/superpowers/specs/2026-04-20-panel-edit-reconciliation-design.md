# Panel edit reconciliation — design

**Date** : 2026-04-20
**Statut** : Validé
**Portée** : `apps/web` (Compass, SailPanel, ProgPanel, store) + `apps/game-engine` (worker drain-ingest)

## Problème

Les broadcasts serveur (un tick toutes les 30s) écrasent systématiquement l'état local du client. Conséquences observées :

- **SailPanel** : toggle "Auto/Manuel" bascule visuellement au bon état, puis revient à l'état précédent au tick suivant si l'ordre `MODE` n'a pas encore été traité par le serveur (race ingest/tick).
- **Compass** : après "Apply" d'un changement de cap, le bateau revient à l'ancienne direction 30s plus tard pour la même raison, puis repart au tick suivant.
- **ProgPanel** : pas de stomp direct (formulaire en React local), mais ordres programmés peuvent devenir obsolètes pendant la saisie (heure dépassée, waypoint franchi).
- **Compass — cancel** : pas de bouton visible pour annuler un cap en cours d'édition. Seul Échap ouvre un modal (overkill).
- **Layout** : boutons Voiles/Programmation poussés hors écran par la boussole sur petits écrans.

Cause racine client : [`applyMessages` dans `store/index.ts`](../../apps/web/src/lib/store/index.ts) écrase sans condition les champs comme `sailAuto`, `hdg`, `currentSail` à chaque broadcast.

Cause racine serveur : la file de messages du worker mélange `tick` et `ingestOrder`. Si un `tick` est dépilé avant un `ingestOrder` fraîchement arrivé, le tick s'exécute sans voir l'ordre.

## Objectifs

1. Une action utilisateur optimiste sur un panel n'est **jamais** visuellement annulée par un broadcast serveur tant que le serveur n'a pas confirmé ou infirmé l'intention.
2. Les ordres de programmation obsolètes sont filtrés proprement au commit, avec retour utilisateur.
3. L'annulation d'une édition Compass est triviale et non destructive.
4. Les boutons d'action (Voiles, Programmation, Centrer, Zoom) sont toujours visibles quelle que soit la taille d'écran.
5. Le bug de race ingest/tick côté serveur est corrigé.

## Pattern central — "optimistic + reconciliation"

### State

Chaque slice concerné (`sail`, `hud`) gagne un sous-état `pending` qui mémorise les valeurs optimistes en attente de confirmation :

```ts
interface SailState {
  currentSail: SailId;
  sailAuto: boolean;
  transitionStartMs: number;
  transitionEndMs: number;
  // ... existant
  pending: {
    sailAuto?: { expected: boolean; since: number };
    sailChange?: {
      expected: { currentSail: SailId; transitionStartMs: number; transitionEndMs: number };
      since: number;
    };
  };
}

interface HudState {
  hdg: number;
  twa: number;
  // ... existant
  pending: {
    hdg?: { expected: number; since: number };
  };
}
```

Les champs couplés (`currentSail` + `transitionStartMs` + `transitionEndMs`) partagent un pending englobant pour rester cohérents.

### API

Deux actions par slice :

- `setOptimistic(field, value)` : écrit la valeur dans le state **et** pose le pending correspondant avec `since: Date.now()`.
- `setOptimisticSailChange({ currentSail, transitionStartMs, transitionEndMs })` : variante pour le pending englobant des 3 champs couplés.

Pas de `clearPending` explicite. La libération se fait automatiquement dans le merge broadcast.

### Logique de merge

Dans [`applyMessages`](../../apps/web/src/lib/store/index.ts), pour chaque champ sous pending, on passe par un helper pur :

```ts
function mergeField<T>(
  pending: { expected: T; since: number } | undefined,
  serverValue: T,
  now: number,
  equals: (a: T, b: T) => boolean = (a, b) => a === b,
): { value: T; pending: typeof pending } {
  if (!pending) return { value: serverValue, pending: undefined };
  if (equals(pending.expected, serverValue)) return { value: serverValue, pending: undefined };
  if (now - pending.since > 60_000) return { value: serverValue, pending: undefined };
  return { value: pending.expected, pending };
}
```

Pour les champs primitifs (`sailAuto`, `hdg`), le défaut `===` suffit. Pour le pending englobant `sailChange`, la comparaison se fait uniquement sur `currentSail` : dès que le serveur annonce `currentSail === expected.currentSail`, le lock libère les 3 champs couplés et on accepte les valeurs serveur pour `transitionStartMs/EndMs` (plus fiables car timés serveur).

Les champs sans pending mergent comme aujourd'hui.

### Timeout

2 ticks (60 000 ms) sans confirmation → lock libéré, on accepte le serveur. Évite les locks orphelins en cas d'ordre perdu ou rejeté.

### Le flag existant `editMode`

[`selectionSlice.editMode`](../../apps/web/src/lib/store/selectionSlice.ts) n'est lu nulle part. Il est supprimé : le pattern pending rend l'edit-mode global inutile.

## Composants

### Compass — cancel UX

**Cancel par croix sur la cible** : pendant l'édition (`targetHdg !== null`), un badge rond apparaît à la position du cap-cible sur le cercle externe, affichant la valeur (ex: "225°") et une croix ×. Clic sur × → `cancelEdit()`.

**Tap-outside** : listener `pointerdown` sur `document` qui vérifie que la cible est hors du SVG Compass ET hors des boutons d'action ET `applyActive === true` → `cancelEdit()`.

**Keyboard** : Échap → `cancelEdit()` direct (suppression du modal actuel).

**`cancelEdit()` réinitialise** :
- `targetHdg = null`
- `preview.hdg = null` (projection revient au heading courant)
- `pendingSailChange = null`

### Compass — layout responsive

Hook `useCompassLayout()` qui mesure la viewport via `ResizeObserver` et décide un palier :

| Palier | Condition | Layout |
|---|---|---|
| 1 (défaut) | `availableHeight >= 480px` | Boutons verticaux au-dessus, Compass en dessous |
| 2 | `availableHeight >= 360px` && `availableWidth >= 720px` | Boutons horizontaux au-dessus, Compass en dessous |
| 3 | sinon | Boutons verticaux à gauche, Compass à droite |

Le SVG Compass est contraint par `max-height: calc(100vh - buttonsHeight - 2*gap)` pour garder le ratio et ne jamais pousser les boutons hors écran. `width: auto` maintient le ratio.

Un seul container `.rightStack` avec trois classes modifier : `.layout-stack-vertical`, `.layout-bar-horizontal`, `.layout-side-by-side`. Breakpoints à affiner en testant sur devices réels (tablette, mobile paysage).

### SailPanel

**Toggle Auto/Manuel** — envoi immédiat + optimistique :

```ts
const toggleAuto = () => {
  const next = !sailAuto;
  sendOrder({ type: 'MODE', value: { auto: next } });
  useGameStore.getState().sail.setOptimistic('sailAuto', next);
};
```

**Confirmation voile** (`confirmSail`) — deux optimistes atomiques :

```ts
const confirmSail = () => {
  if (!candidateSail) return;
  const duration = getTransitionDuration(currentSail, candidateSail);
  const startMs = Date.now();

  if (wasAuto) {
    sendOrder({ type: 'MODE', value: { auto: false } });
    useGameStore.getState().sail.setOptimistic('sailAuto', false);
  }
  sendOrder({ type: 'SAIL', value: { sail: candidateSail } });
  useGameStore.getState().sail.setOptimisticSailChange({
    currentSail: candidateSail,
    transitionStartMs: startMs,
    transitionEndMs: startMs + duration * 1000,
  });

  setCandidateSail(null);
  useGameStore.getState().setPreview({ sail: null });
};
```

La logique `wasAuto` est conservée : un changement manuel pendant auto DOIT désactiver auto explicitement, sinon le tick suivant re-switche vers la voile optimale. C'est une intention métier, pas un hack UI.

Le countdown "Manœuvre en cours · Xs" bénéficie automatiquement du lock : `transitionEndMs` reste stable pendant toute la durée optimiste.

### ProgPanel

**Retrait du trigger `immediate`** : supprimé de la liste d'options ([ProgPanel.tsx:61-66](../../apps/web/src/components/play/ProgPanel.tsx#L61-L66)). Les ordres immédiats passent par Compass/SailPanel.

**Lead time minimum** : constante `MIN_LEAD_TIME_MS = 5 * 60 * 1000` (helper UI dédié, pas dans `game-balance`).

- `at_time` : heure saisie ≥ `now + 5min`, sinon champ en état erreur + bouton "Ajouter" disabled.
- `after_duration` : durée saisie ≥ 5 min, même comportement.
- `at_waypoint` : pas de check à la saisie, géré au commit.

**Re-validation en live dans la queue** : toutes les 1s, re-check des timestamps des ordres déjà ajoutés. Ordre devenant < `now + 5min` → badge "⚠ bientôt obsolète" dans la liste. Le joueur peut retirer ou modifier avant commit.

**Commit — filtrage automatique** :

```ts
function isObsolete(order: OrderEntry, now: number, boatState: BoatState): boolean {
  switch (order.trigger.type) {
    case 'AT_TIME':
      return order.trigger.time * 1000 <= now;
    case 'AFTER_DURATION':
      return false;
    case 'AT_WAYPOINT':
      return boatState.passedWaypoints.has(order.trigger.waypointId);
  }
}
```

Les ordres valides sont envoyés via `sendOrder` dans l'ordre de la queue. Les obsolètes sont filtrés. Le câblage `commitQueue → sendOrder` n'existe pas aujourd'hui (copy local → local) : il est à implémenter.

**Retour utilisateur après commit** : toast éphémère (5s) au-dessus du panel :
- `N ordres envoyés`
- `M ordres ignorés (obsolètes)` — si M > 0, lien "détails" qui expand la liste.

## Fix race condition serveur

Dans [`worker.ts`](../../apps/game-engine/src/engine/worker.ts), au moment de traiter le message `tick`, on yield au micro-task loop pour laisser les `ingestOrder` déjà en file être traités :

```ts
if (msg.kind === 'tick') {
  await new Promise((r) => setImmediate(r));
  // ... runTick comme avant
}
```

Impact : délai ≤ 1 ms ajouté au tick, négligeable devant les 30s d'intervalle. Fix bundled dans la même PR.

**Limite restante** : un ordre envoyé à T=29.95s (5ms avant tick) peut arriver au worker après le tick. L'edit-lock côté client (Section pattern central) masque cette divergence : le broadcast de tick N est ignoré (pending actif), le broadcast de tick N+1 confirme et libère le lock.

## Tests

### Unitaires (store)
- `mergeField` : pas de pending / match / divergent / timeout dépassé
- `setOptimistic` pose valeur + pending
- `setOptimisticSailChange` pose pending englobant sur 3 champs

### Intégration store + applyMessages
- Toggle Auto puis broadcast divergent → state reste optimiste
- Toggle Auto puis broadcast match → lock libéré
- 3 broadcasts divergents espacés de 25s → libération à 60s
- Mêmes scénarios sur `hud.hdg` et `sail.currentSail`

### Composants (React Testing Library)
- Compass : drag + × → cancel
- Compass : drag + click hors SVG → cancel
- Compass : Échap → cancel direct (plus de modal)
- Compass layout : mock `useCompassLayout` par palier → classe CSS + ordre DOM vérifiés
- SailPanel : click Auto + broadcast divergent → toggle reste sur Auto
- ProgPanel : `at_time` < 5min → erreur + bouton disabled
- ProgPanel : commit avec ordres obsolètes → toast affiché

### E2E engine (backend)
- Worker : file `[tick, ingestOrder(MODE true)]` → après setImmediate, MODE traité dans le tick courant
- Régression : sans le fix, MODE arrive au tick suivant ; avec le fix, dès le tick courant

## Hors scope

- Tests visuels (pas de Playwright dans le projet).
- Refonte générale des slices (on ajoute `pending` aux slices existants sans restructurer).
- Extension du pattern à d'autres futurs panels : l'API `setOptimistic` sera réutilisable telle quelle.
