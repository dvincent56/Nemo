# ProgPanel redesign — design

**Date** : 2026-04-28
**Statut** : Validé en brainstorm, prêt à passer en plan d'implémentation
**Portée** : `apps/web` (ProgPanel, Compass, SailPanel, MapCanvas, store, projection worker, routing apply) + `packages/game-engine-core` + `packages/shared-types` (Phase 0 protocole)

## Problème

Le ProgPanel actuel est trop complexe à prendre en main : trois onglets (Cap / Waypoints / Voiles) dont deux non implémentés, un `<input type="datetime-local">` en saisie clavier, des triggers internes (AT_TIME / AT_WAYPOINT / AFTER_DURATION) tous mélangés, pas de distinction draft/committed, et aucune intégration avec la carte. Le router-apply pousse ses ordres directement dans la queue avec `committed: true`, mais l'utilisateur n'a pas de modèle clair pour comprendre ce qu'il modifie ni quand ça part au serveur.

Côté gameplay, on s'éloigne de la simplicité de Virtual Regatta : trois types d'ordres (cap / voile / waypoint) à un trigger précis, c'est tout ce qu'il faut.

## Objectifs

1. Réduire le panneau à un modèle mental clair : deux modes mutex (Cap ⊕ Waypoints) + une track parallèle Voiles.
2. Garantir un cycle draft → confirm explicite : aucun effet serveur tant que l'utilisateur n'a pas cliqué `Confirmer`.
3. Réutiliser les composants existants (`Compass`, `SailPanel` icons, `Button`, `ConfirmDialog`, `SlidePanel`) plutôt que de dupliquer.
4. Permettre une édition graphique : compass drag pour le cap, click-on-map pour les WPs, drag-on-map pour repositionner un WP.
5. Distinguer visuellement projection committed (en place) vs projection draft (en cours d'édition) sur la carte.
6. Poser les bases protocole pour une queue serveur "remplaçable" (`ORDER_REPLACE_QUEUE`).

## Hors scope

- Refonte du moteur d'ordres au-delà de l'ajout du remplaçage (pas de recodage de `tick.ts` ni du chaining WPT existant).
- Refonte du router (le router-apply reste auto-commit, c'est un cas particulier — Section "Router").
- Édition multi-utilisateur (pas de partage de prog entre joueurs).
- Polar/forecast au moment du trigger (les readouts du compass dans le panneau utilisent le vent courant, comme le compass live aujourd'hui).

## Modèle mental

Une **programmation** est l'état persisté côté serveur. Elle a un **mode** (`'cap' | 'wp'`) et trois listes :

- En mode Cap : une suite de **CapOrder** AT_TIME.
- En mode WP : une chaîne de **WpOrder** AT_WAYPOINT (premier IMMEDIATE), optionnellement suivie d'un **FinalCapOrder** AT_WAYPOINT(lastWP).
- Dans les deux modes : une liste de **SailOrder** parallèles (AT_TIME en mode Cap ; AT_TIME ou AT_WAYPOINT en mode WP, max 1 par WP).

Le ProgPanel travaille sur un **draft** local : copie modifiable de la programmation committed. Quand l'utilisateur clique `Confirmer` en pied de panneau, le draft remplace intégralement la programmation côté serveur via une enveloppe `ORDER_REPLACE_QUEUE`. Fermer le panneau sans confirmer revert silencieusement le draft.

Cas particulier : le **router-apply** (depuis RouterPanel) génère et commit une programmation en mode WP en un seul mouvement, sans passer par le draft. C'est conscient et conservé. Une fois posée, l'utilisateur peut l'éditer dans le ProgPanel comme une programmation manuelle (les modifs deviendront draft jusqu'à `Confirmer`).

## Phase 0 — Prérequis protocole moteur

Le moteur n'a aujourd'hui aucun mécanisme pour annuler ou remplacer un ordre. Cette phase, indépendante de l'UI, doit être livrée avant la réécriture du panneau.

### Wire — nouvelle enveloppe

```ts
// packages/shared-types/src/index.ts (ou /protocol)
type ClientToServerMessage =
  | { type: 'ORDER'; payload: { order: OrderEntry; clientTs: number; clientSeq: number } }
  | { type: 'ORDER_REPLACE_QUEUE'; payload: { orders: OrderEntry[]; clientTs: number; clientSeq: number } };
```

### Comportement moteur

À la réception de `ORDER_REPLACE_QUEUE` :

1. Conserver `runtime.orderHistory` des ordres déjà **consommés** (CAP/TWA fired, WP atteint) — historique read-only pour debug et replay.
2. Drop intégralement la liste user-modifiable des ordres encore actifs (futurs et in-flight).
3. Installer la liste reçue (chaque ordre ré-ingéré comme un nouveau ORDER).
4. Émettre un broadcast confirmant l'état de la queue (la prochaine snapshot tick suffit).

### Signal `WP_REACHED`

Aujourd'hui le client détecte la capture WP via `haversinePosNM` côté UI et marque visuellement `capturedIds` (cf. ProgPanel.tsx:101-138). C'est une heuristique côté client, pas un signal serveur explicite. Pour le ProgPanel V2, deux pistes acceptables, à trancher au moment de l'implémentation :

1. **Conserver l'heuristique client** : le client retire un WP de `committed.wpOrders` dès qu'il détecte capture local. Le moteur, à la prochaine `ORDER_REPLACE_QUEUE`, ne verra pas le WP retiré et ne fera rien de spécial. Simple, mais le client peut désaligner le moteur quelques secondes.
2. **Ajouter un champ `consumedOrderIds: string[]`** au snapshot tick existant. Le moteur indique explicitement quels ordres ont été consommés depuis la dernière snapshot. Le client retire les WPs en conséquence. Plus propre mais demande un mini-changement de protocole.

Le choix est laissé au plan d'implémentation Phase 0. Recommandation : option 2 si le coût est marginal, option 1 sinon.

### Tests

Tests unitaires sur `tick.ts` : `ORDER_REPLACE_QUEUE` (a) drop des CAP futurs (b) drop d'un WP actif et installe le nouveau (c) préserve l'historique des WPs déjà atteints (d) le bateau perd sa cible si tous les WPs sont supprimés.

## Modèle de données client

```ts
// apps/web/src/lib/store/types.ts (extension)

type ProgMode = 'cap' | 'wp';

interface CapOrder {
  id: string;
  trigger: { type: 'AT_TIME'; time: number }; // unix sec
  heading: number;     // 0..359
  twaLock: boolean;
}

interface WpOrder {
  id: string;
  trigger: { type: 'IMMEDIATE' } | { type: 'AT_WAYPOINT'; waypointOrderId: string };
  lat: number;
  lon: number;
  captureRadiusNm: number;  // 0.5 par défaut, valeur de game-balance
}

interface FinalCapOrder {
  id: string;
  trigger: { type: 'AT_WAYPOINT'; waypointOrderId: string }; // = id du dernier WP
  heading: number;
  twaLock: boolean;
}

interface SailOrder {
  id: string;
  trigger:
    | { type: 'AT_TIME'; time: number }
    | { type: 'AT_WAYPOINT'; waypointOrderId: string }; // mode WP only, max 1 par WP
  action: { auto: false; sail: SailId } | { auto: true };
}

interface ProgDraft {
  mode: ProgMode;
  capOrders: CapOrder[];        // non-vide ⇔ mode === 'cap'
  wpOrders: WpOrder[];          // non-vide ⇔ mode === 'wp'
  finalCap: FinalCapOrder | null;
  sailOrders: SailOrder[];
}

interface ProgState {
  draft: ProgDraft;     // ce que l'utilisateur édite
  committed: ProgDraft; // dernier état envoyé et acknowledgé par le serveur
  // dérivé : isDirty = !deepEq(draft, committed)
  // dérivé : currentEditing = { kind, id } | null
}
```

### Sérialisation wire

Le format `OrderEntry` actuel (avec `type: 'CAP' | 'TWA' | 'WPT' | 'SAIL' | 'MODE'`, `value` opaque, `trigger`) est conservé pour le wire. Les types client typés (`CapOrder`, `WpOrder`, etc.) sérialisent vers ce format dans la couche envoi. Les `FinalCapOrder` deviennent des `OrderEntry { type: 'CAP' | 'TWA', trigger: AT_WAYPOINT }` à l'envoi.

### Mutations store

```ts
interface ProgSlice {
  prog: ProgState;
  // Mutations draft (ne touchent pas au serveur)
  setProgMode: (m: ProgMode) => void;
  addCapOrder: (o: CapOrder) => void;
  updateCapOrder: (id: string, patch: Partial<CapOrder>) => void;
  removeCapOrder: (id: string) => void;
  addWpOrder: (o: WpOrder) => void;
  updateWpOrder: (id: string, patch: Partial<WpOrder>) => void;
  removeWpOrder: (id: string) => void;  // gère le rebind des AT_WAYPOINT successeurs
  setFinalCap: (o: FinalCapOrder | null) => void;
  addSailOrder: (o: SailOrder) => void;
  updateSailOrder: (id: string, patch: Partial<SailOrder>) => void;
  removeSailOrder: (id: string) => void;
  clearAllOrders: () => void;
  resetDraft: () => void;            // draft = clone(committed)
  // Commit
  commitDraft: () => Promise<void>;  // serialize → ORDER_REPLACE_QUEUE → on ack: committed = clone(draft)
  // Application directe par le router (pas de draft)
  applyRouteAsCommitted: (plan: RoutePlan, sailAutoAlready: boolean) => void;
}
```

`removeCapOrder` re-trie après suppression (ordre relatif inchangé). `removeWpOrder` rebind les successeurs : si on supprime WP2 dans WP1 → WP2 → WP3, alors WP3 voit son trigger devenir `AT_WAYPOINT(WP1)`. Si la suppression laisse un sail order orphelin (AT_WAYPOINT pointant vers le supprimé), c'est bloqué via la modale "ce WP est référencé par 1 ordre voile" décrite plus bas.

## Primitives à extraire

Trois extractions, indépendantes les unes des autres, à livrer en PRs séparées avant la réécriture du panneau.

### Phase 1a — `<CompassDial>` + `<CompassReadouts>` + `<CompassLockToggle>`

**Localisation** : `apps/web/src/components/play/CompassDial.tsx` (et fichiers frères).

Les trois composants sont extraits du `Compass.tsx` actuel. Le wrapper `Compass.tsx` les compose et **garde en plus** son propre Valider/Annuler (logique live `sendOrder` + raccourcis Entrée/Échap), parce que ces deux actions n'ont pas de sens dans le ProgPanel.

```ts
interface CompassDialProps {
  value: number;                       // 0..359
  onChange?: (next: number) => void;   // omis = read-only
  windDir: number;                     // TWD pour le tick vent
  size?: number;                       // 220 par défaut
  showBoat?: boolean;                  // true par défaut
  showWindWaves?: boolean;             // true par défaut (false pour le panneau)
  vmgGlow?: boolean;                   // calculé par le consommateur via polar
}

interface CompassReadoutsProps {
  headingDeg: number;
  twaDeg: number;
  bspKn?: number;                      // optionnel (panneau d'édition n'affiche pas)
  twaLocked?: boolean;
  vmgGlow?: boolean;
  bspColorClass?: 'live' | 'warn' | 'danger';
  pendingHint?: { kind: 'gybe' | 'tack' | 'sail'; label: string; className: string };
}

interface CompassLockToggleProps {
  locked: boolean;
  onToggle: () => void;
  disabled?: boolean;
}
```

Aucun de ces trois composants ne lit le store ni n'appelle `sendOrder`. Tout passe par les props.

**Tests** : viewport screenshots avant/après refacto sur `Compass.tsx` pour valider zéro régression visuelle.

### Phase 1b — Module `lib/sails/icons.tsx`

**Localisation** : `apps/web/src/lib/sails/icons.tsx`.

Extraction pure des constantes :

```ts
export const SAIL_DEFS: { id: SailId; name: string }[] = [
  { id: 'JIB', name: 'Foc' },
  { id: 'LJ', name: 'Foc léger' },
  { id: 'SS', name: 'Trinquette' },
  { id: 'C0', name: 'Code 0' },
  { id: 'SPI', name: 'Spinnaker' },
  { id: 'HG', name: 'Gennaker lourd' },
  { id: 'LG', name: 'Gennaker léger' },
];

export const SAIL_ICONS: Record<SailId, React.ReactElement> = {
  JIB: ( <svg viewBox="0 0 32 40" ...>...</svg> ),
  // ... 7 SVG vue de profil mât-à-gauche
};
```

`SailPanel.tsx` et le futur `ProgPanel` importent depuis ce module. Pas de composant `<SailGrid>` partagé : SailPanel garde sa liste verticale (avec vitesse polaire), ProgPanel utilise sa grille 4+3.

### Phase 1c — `<TimeStepper>`

**Localisation** : `apps/web/src/components/play/TimeStepper.tsx`.

```ts
interface TimeStepperProps {
  value: number;          // unix seconds
  onChange: (next: number) => void;
  minValue: number;       // floor unix sec
  nowSec: number;         // pour rendu du delta relatif "+12min"
  className?: string;
}
```

**Comportement** :
- Affichage central 56px de haut : `HH:MM` absolue (Bebas Neue) + `+Xh Ymin` relative (Space Mono).
- Boutons − / + carrés 56px sur les côtés, icônes `Minus` / `Plus` lucide.
- Pointer-down déclenche un `setTimeout` récursif qui pulse selon la courbe :

| Pulse # | Pas        | Délai (ms) |
|---------|-----------|-----------|
| 1-3     | ±1 min    | 350       |
| 4-7     | ±5 min    | 140       |
| 8-14    | ±15 min   | 90        |
| 15+     | ±60 min   | 60        |

- Reset des pulses à pointer-up / pointer-leave / pointer-cancel.
- Snap explicite à la minute : `value` est toujours multiple de 60.
- `value <= minValue` désactive le `-` ; affiche un message floor doré sous le widget : "Délai mini : now + 5min".

**Tests** : unitaires sur la courbe d'accélération (mock setTimeout), snap minute, blocage floor.

## Structure du panneau & UX

### Composition

Le panneau s'instancie inchangé dans `<SlidePanel side="right" width={420} title="Programmation" mode={panelMode}>` à `apps/web/src/app/play/[raceId]/PlayClient.tsx`. SlidePanel fournit le titre + croix + comportement bottom-sheet mobile.

### Trois états

- **Idle** : `draft == committed`. Pied affiche `✓ Programmation à jour`, boutons grisés.
- **Dirty** : `draft != committed` et pas d'éditeur ouvert. Pied doré pulsant `● Modifications non enregistrées`, `Annuler` (revert draft) et `Confirmer` (envoi serveur) actifs.
- **Editing(kind, id)** : un sous-écran d'édition occupe le body. Pied affiche `Annuler` / `OK`.

### Vue queue (états Idle / Dirty)

```
[ Onglets : ⚓ Cap | 📍 Waypoints ]   ← reflète draft.mode

Cap programmé · 2 ordres
  01  14:30  +12min   Cap → 225°               [Pencil] [Trash2]
  02  16:45  +2h27    Cap → 180° · TWA         [Pencil] [Trash2]
  [ + Ajouter un cap ]

Voiles · 1 ordre
  —   15:00  +42min   Voile → SPI              [Pencil] [Trash2]
  [ + Ajouter un changement de voile ]

  [ 🗑 Tout effacer ]   (discret, sous les sections)
```

En mode WP, la première section devient `Waypoints · N points` avec ordres listés `Au départ` / `Après WP n` / `Après WP n (final)` pour le FinalCap. Bouton additionnel `+ Cap final` apparaît seulement si `wpOrders.length ≥ 1` et `finalCap === null`.

### Sous-écran éditeur (état Editing)

L'éditeur **remplace** le body de la queue (pas de modale qui s'empile). Header avec bouton retour et titre `Modifier · Cap n°1` ou `Nouvel ordre cap`.

**Éditeur Cap / Cap final** :

```
[CompassReadouts : Vitesse / Cap / TWA]
[CompassDial 180px (drag)]
[CompassLockToggle]
─────────────────
[TimeStepper] (omis pour Cap final — trigger = AT_WAYPOINT(lastWP) implicite)
```

**Éditeur Voile** :

```
[Auto | Manuel]   ← segmented
(si Manuel) :
  [Grille 4 voiles : JIB · LJ · SS · C0]
  [Grille 3 voiles : SPI · HG · LG]
─────────────────
Déclencheur :
  [À une heure | À un waypoint]   ← segmented (en mode Cap, AT_TIME forcé, segment unique)
  (si AT_TIME) [TimeStepper]
  (si AT_WAYPOINT) [Liste des WPs : ceux déjà référencés par un autre sail order sont
                    affichés mais désactivés avec l'icône de la voile existante en aperçu]
```

**Éditeur WP** :

```
[Bloc "Cliquer sur la carte" — active le mode pick côté MapCanvas]
Coordonnées : 39°10'N · 27°50'W   (live update au drag du marker)
Rayon de capture : 0.5 NM   (input number)
─────────────────
Déclencheur : Après WP 1   (lecture seule, position = chain order)
```

Footer de l'éditeur : `[Annuler]` (revert form, retour queue) `[OK]` (sauve dans le draft, retour queue).

### Flux

1. **Add new** : click `+ Ajouter un cap` → éditeur ouvre avec defaults (cf. Section "Time logic"). User édite → `OK` → ajout à `draft.capOrders`, retour queue, état Dirty si réelle modif.
2. **Edit existing** : click ligne ou icône Pencil → éditeur pré-rempli. `OK` → update + re-tri AT_TIME (cap et sail uniquement) + retour queue.
3. **Cancel editor** : `Annuler` ou bouton retour → form jeté, draft inchangé.
4. **Delete order** : click Trash2 → `<ConfirmDialog tone="danger">` "Supprimer cet ordre ?". Cas spécial WP référencé : "Ce WP est référencé par un ordre voile. Supprimer les deux ?".
5. **Switch mode** : click onglet inactif. Si la track de l'autre mode est non vide, `<ConfirmDialog>` "Changer de mode supprimera les N ordres CAP/WP. Les voiles compatibles seront conservées."
6. **Tout effacer** : bouton discret en bas de la queue, `<ConfirmDialog tone="danger">`.
7. **Close panel** : silencieux. `draft = clone(committed)`. Aucune confirmation.
8. **Confirmer** (footer) : drop des AT_TIME obsolètes → sérialisation → `ORDER_REPLACE_QUEUE` → sur ack `committed = clone(draft)`.

### Composants UI réutilisés

- `<SlidePanel>` : chrome fourni
- `<ConfirmDialog>` : toutes les confirmations (delete, clear, switch-mode)
- `<Button variant="primary">` pour OK / Confirmer ; `variant="ghost"` pour Annuler ; `variant="danger"` dans le ConfirmDialog
- `<CompassDial>` + `<CompassReadouts>` + `<CompassLockToggle>` (Phase 1a)
- `<TimeStepper>` (Phase 1c)
- `SAIL_ICONS` + `SAIL_DEFS` (Phase 1b)
- Icons : `lucide-react` (`Pencil`, `Trash2`, `Plus`, `Minus`, `Check`, `X`, `Compass`, `Anchor`, `MapPin`, `ArrowLeft`, `AlertTriangle`)

## Time logic & obsolescence

### Heure par défaut

| Track | Vide                | Non vide                                    |
|-------|---------------------|---------------------------------------------|
| Cap   | `now + 1h`          | `max(latestCapOrder.time, now + 10min)`     |
| Sails (AT_TIME) | `now + 1h` | `max(latestSailATTime.time, now + 10min)` |

Le **floor** (limite dure non-modifiable, sliding) reste à `now + 5min` partout.

### Floor sliding

- Tick 1Hz au niveau de ProgPanel : `nowSec = Math.floor(Date.now()/1000)`, `floor = nowSec + 300`.
- Propagé en prop aux TimeSteppers ouverts.
- TimeStepper bloque `-` à `value <= floor`. Aucun auto-bump : la valeur reste figée si le floor la dépasse.

### Auto-reorder

Au `OK` de l'éditeur, on trie :

```ts
draft.capOrders.sort((a, b) => a.trigger.time - b.trigger.time);
draft.sailOrders.sort((a, b) => sortKey(a) - sortKey(b));
// pour sailOrders : AT_TIME triés par time, AT_WAYPOINT triés par index du WP référencé dans wpOrders
```

L'utilisateur revient à la queue, voit l'index ré-attribué. Pas d'effort UI live pendant l'édition (l'éditeur masque la queue).

WP : pas de re-tri (chaîne séquentielle imposée par AT_WAYPOINT).

### Bannière obsolète

Affichée en haut du body si `draft.capOrders.some(o => o.trigger.time < floor) || draft.sailOrders.some(o => o.trigger.type === 'AT_TIME' && o.trigger.time < floor)`.

```
⚠ 1 ordre obsolète (heure < now + 5min)
   Il sera retiré automatiquement à la confirmation.    [X]
```

L'ordre obsolète est aussi marqué dans la queue (bordure warn + label `OBSOLÈTE` dans la cellule "when").

À `Confirmer`, les obsolètes sont silencieusement filtrés du draft avant sérialisation. Toast en pied : "1 ordre obsolète retiré".

### Cohérence WP ↔ sail orders

- Un WP ne peut être référencé que par **un seul** sail order AT_WAYPOINT (uniqueness enforcée à l'ajout dans le sail editor : les WPs déjà référencés sont désactivés dans le picker).
- Suppression d'un WP référencé : modale `<ConfirmDialog>` "Ce WP est référencé par 1 ordre voile. Supprimer les deux ?". Si OK, suppression couplée.

## Projection carte & interactions

### Deux couches

Le worker de projection (`apps/web/src/lib/projection/worker.ts` ou équivalent) accepte un `ProgSnapshot { committed, draft }` au lieu d'une simple liste `orderQueue`. Il rend deux trajectoires :

- **Couche committed** : exactement la projection actuelle (style et trait inchangés), mais avec une **opacité réduite** (~40%) dès que `isDirty === true`. Sert de fond/contexte pour comparer.
- **Couche draft** : même style que la projection actuelle, **opacité pleine**, mise en avant. C'est la couche que l'utilisateur édite et regarde en priorité.
- Quand `isDirty === false`, les deux sont identiques : on rend une seule couche à opacité pleine (rendu identique à aujourd'hui, aucun changement visuel).

### Markers

Un marker par ordre, sur la couche correspondante (committed ou draft selon état). Tous via `lucide-react` :

- **Cap order (AT_TIME)** : `<Anchor>` doré 16px à la lat/lon prédite à `trigger.time`. Tooltip : "Cap → 225° · 14:30 +12min".
- **Sail order (AT_TIME)** : icône silhouette voile (réutilise `SAIL_ICONS` ou un picto générique `<Wind>` si l'icône voile complète est trop chargée à 16px). À la lat/lon prédite à l'heure. Tooltip : "Voile → SPI · 15:00 +42min".
- **Sail order (AT_WAYPOINT)** : même icône, à côté du marker WP référencé (offset 12px). Tooltip : "Voile → SPI · à WP 2".
- **WP order** : `<MapPin>` doré 18px à la lat/lon. Tooltip : "WP 2 · 39°10'N 27°50'W · capture 0.5 NM".
- **Final cap** : combinaison `<MapPin>` + `<Anchor>` au dernier WP. Tooltip : "Cap final → 045° après WP 2".
- **Obsolète** : teinte warn + `<AlertTriangle>` superposé.

Sur la couche committed, markers à opacité réduite (~40%) quand `isDirty === true` ; pleins quand `isDirty === false`. Sur la couche draft, markers toujours à opacité pleine.

### Click marker → édition

État global `editingOrder: { kind, id } | null` (déjà présent dans le panneau, surfacé jusqu'au composant carte).

- **Click marker** alors que `editingOrder === null` :
  - Ouvre le panneau (s'il est fermé)
  - Switch mode du panneau si nécessaire (pour un marker WP en mode Cap, switch + confirmation usuelle si la track Cap est non vide)
  - Place le panneau en `Editing({ kind, id })`, ouvrant directement le sous-éditeur correspondant
- **Click marker** alors que `editingOrder !== null` (autre ordre en cours d'édition) :
  - `<ConfirmDialog>` "Abandonner les modifications en cours sur l'ordre X ?". Si OK, cancel l'éditeur courant (revert form), puis ouvre l'éditeur du nouveau marker.

### Drag marker WP

Activé uniquement quand l'éditeur du WP correspondant est ouvert :

- Pointer-down sur le marker → début drag (capture pointer)
- Pointer-move → update `editForm.lat/lon` en live, projection redessinée
- Pointer-up → fin du drag, valeurs gardées dans `editForm` (mais pas committées dans `draft` tant que `OK` non cliqué)

Pour un marker non-en-édition, pas de drag (cliquer ouvre l'éditeur).

### Click sur la carte (mode pick WP)

Quand l'éditeur d'un WP est ouvert et que `editForm.lat/lon` est encore non défini (cas "Nouveau WP" dont la position n'a pas été placée), un click vide sur la carte place le WP. Une fois placé, le drag prend le relais pour les ajustements.

### Rayon de sécurité (placement WP)

À la pose ou au drag, si la position résultante est à moins de **3 NM** du bateau (boatLat/boatLon courants) :
- Le marker reste à sa position précédente (rejet silencieux du delta)
- Toast en pied de carte : "WP trop proche du bateau (min 3 NM)"

Le seuil est paramétrable dans `packages/game-balance/game-balance.json` (nouveau champ `programming.minWpDistanceNm`, valeur par défaut `3`).

## Sémantique du Confirmer

```
1. Pré-traitement local du draft :
   - Drop des CapOrder/SailOrder AT_TIME avec time < now + 5min
2. Sérialisation typed → OrderEntry[] format wire :
   - CapOrder    → { type: 'CAP' | 'TWA', value: { heading | twa }, trigger: AT_TIME }
   - WpOrder     → { type: 'WPT', value: { lat, lon, captureRadiusNm }, trigger: IMMEDIATE | AT_WAYPOINT }
   - FinalCap    → { type: 'CAP' | 'TWA', value: { heading | twa }, trigger: AT_WAYPOINT }
   - SailOrder   → soit { type: 'MODE', value: { auto: true } } pour auto:true,
                   soit { type: 'SAIL', value: { sail } } pour le manuel
                   trigger préservé
3. Envoi : nouvelle enveloppe ORDER_REPLACE_QUEUE { orders, clientTs, clientSeq }
4. Réponse :
   - ack OK : committed = clone(draft), retour état Idle, toast succès
   - erreur réseau : draft inchangé, footer reste Dirty, toast erreur, retry sur le prochain Confirmer
5. Maintenance vie courante (hors Confirmer) :
   - À chaque indication serveur "WP atteint" (cf. Phase 0, signal explicite ou heuristique client) :
     - retirer le WP de `committed.wpOrders` ET de `draft.wpOrders`
     - retirer silencieusement tout sail order AT_WAYPOINT(supprimé) — pas de modale, le serveur a tranché
```

## Router-apply (cas particulier)

Le routeur garde son flow actuel : `applyRoute(plan)` génère une chaîne `WPT` + `MODE(auto:true)`, les envoie via `sendOrder` (un par un, à terme via `ORDER_REPLACE_QUEUE` aussi mais pour l'instant compatible) ET met à jour `committed` directement (pas de draft intermédiaire).

```ts
// apps/web/src/lib/store/progSlice.ts
applyRouteAsCommitted: (plan, sailAutoAlready) => {
  const wpOrders: WpOrder[] = plan.waypoints.slice(1).map(/* ... */);
  const sailOrders: SailOrder[] = sailAutoAlready ? [] : [{ id: uid(), trigger: ..., action: { auto: true } }];
  const next: ProgDraft = {
    mode: 'wp', capOrders: [], wpOrders, finalCap: null, sailOrders,
  };
  set({ prog: { committed: next, draft: clone(next) } });
  // dispatch sur le wire (ORDER_REPLACE_QUEUE de préférence, sinon sendOrder par ordre comme actuel)
}
```

Si une programmation manuelle existe au moment où le routeur est appliqué, on conserve la modale `<ConfirmReplaceProgModal>` actuelle ("Remplacer la programmation existante ?").

## Plan de phasage (rollout)

À livrer en PRs séparées, dans cet ordre. Les phases 0 / 1a / 1b / 1c sont indépendantes et peuvent être parallélisées entre elles ; la Phase 2 dépend de toutes les précédentes. **Chaque phase aura son propre plan d'implémentation détaillé** (writing-plans), ce design n'est qu'un cadre commun.

| Phase | Contenu                                                                 | Bloquant pour |
|-------|-------------------------------------------------------------------------|---------------|
| 0     | `ORDER_REPLACE_QUEUE` côté wire + moteur + tests + signal WP_REACHED    | Phase 2       |
| 1a    | Extraction `<CompassDial>` / `<CompassReadouts>` / `<CompassLockToggle>`, refacto `Compass.tsx`, tests visuels | Phase 2 |
| 1b    | Extraction `lib/sails/icons.tsx`, refacto `SailPanel.tsx`              | Phase 2       |
| 1c    | Création `<TimeStepper>` + tests unitaires courbe d'accélération        | Phase 2       |
| 2     | Refonte `ProgPanel.tsx` + extension `progSlice` + intégration MapCanvas (markers, click, drag) + projection 2-couches + bannière obsolète + champ `programming.minWpDistanceNm` dans `game-balance.json` | livraison |

## Risques

- **Phase 0 moteur** : la migration `orderHistory` du tick.ts pour préserver l'historique consommé tout en remplaçant les ordres futurs demande des tests rigoureux sur les chaînes WPT déjà partiellement traversées. Risque de WPs "ressuscités" si mal codé.
- **Compass extraction** : le `Compass.tsx` actuel est complexe (600 lignes, polar-aware, optimistic mirroring). Une régression visuelle ou comportementale pendant l'extraction casserait le compass live en prod. Mitigation : tests visuels (Playwright screenshots) avant/après chaque PR.
- **Projection draft + committed** : doubler la couche projection a un coût CPU. Le worker actuel décode déjà à 50Hz côté curseur — il faut benchmarker que la deuxième couche tient le même budget. Optimisation possible : quand `isDirty === false`, on ne calcule qu'une couche.
- **Rayon de sécurité 3 NM** : si trop strict, peut empêcher de placer un WP juste devant le bateau dans des situations valides (passage de cap proche). Valeur à valider en playtest, ajustable via game-balance.json.
- **Click marker en cours d'édition** : le ConfirmDialog peut frustrer si l'utilisateur clique souvent ailleurs par erreur. À surveiller en usage ; possible alternative : ignorer silencieusement le click si le draft du current editor est intact (== valeurs initiales).

## Ouvertures (post-V1)

- Drag-and-drop pour réordonner manuellement les WPs (aujourd'hui : ordre figé par la chaîne)
- Aperçu polar/forecast au moment du trigger (TWS/TWA prédit, BSP estimé) dans le compass de l'éditeur
- Templates de programmation réutilisables ("ma route gauche", "mode nuit")
- Synchro multi-device (édition continuée sur un autre appareil)
