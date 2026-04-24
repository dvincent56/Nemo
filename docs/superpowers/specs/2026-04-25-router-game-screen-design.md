# Routeur sur l'écran de jeu — Design

**Date :** 2026-04-25
**Statut :** Brainstorming validé · prêt pour planification

## Contexte

Le projet possède déjà un routeur isochrone complet et validé en utilisation simulateur (`packages/routing` + `apps/web/src/app/dev/simulator`). L'objectif de ce thread est d'**intégrer le routeur dans l'écran de jeu** (`/play/[raceId]`), en réutilisant au maximum les briques existantes.

Le moteur de routing lui-même n'est pas modifié.

## Objectifs

- Permettre au joueur de calculer une route optimale depuis sa position vers un point d'arrivée qu'il choisit sur la carte
- Afficher la route + isochrones avec le même rendu que le simulateur
- Permettre d'appliquer la route comme programmation (waypoints ou CAP schedule, voile auto)
- Outil non bloquant : le joueur peut relancer un routage à volonté pour comparer

## Hors-scope

- Refonte du `ProgPanel` (chantier séparé, à brainstormer plus tard)
- Modification du moteur de routing (`packages/routing`)
- Sauvegarde / partage de routes entre sessions
- Routes multi-segments avec waypoints intermédiaires posés à la main avant calcul

## Architecture & réutilisation

### Composants réutilisés tels quels (pas de modification)

- `packages/routing` — moteur isochrone (`RouteInput → RoutePlan`)
- `apps/web/src/workers/routing.worker.ts` — worker persistant (mutualisé entre simulateur et écran de jeu)
- Algorithme et types : `RoutePlan`, `CapScheduleEntry`, `RoutePolylinePoint`, presets `FAST/BALANCED/HIGHRES`

### Composants déplacés vers un emplacement partagé

De `apps/web/src/app/dev/simulator/` vers `apps/web/src/components/map/routing/` :

- `RouteLayer.tsx` — rendu polyline dorée (avec split fresh/stale GFS)
- `IsochroneLayer.tsx` — rendu isochrones lissés translucides

Le `DevSimulatorClient` importe désormais ces composants depuis le nouveau chemin.

### Composants nouveaux

Sous `apps/web/src/components/play/` :

- `RouterPanel.tsx` — slide-out 420px (côté droit), gère les 4 états (idle / placing / calculating / results) et leur rendu
- `RouterControls.tsx` — sous-composant : preset (FAST/BAL/HIRES), toggle côtes, slider cône (style HUD du jeu, pas le style simu)
- `RouterDestinationMarker.tsx` — cercle rouge + label "Arrivée" sur la carte
- `ConfirmReplaceProgModal.tsx` — modal "Vous avez X ordres en cours, remplacer ?"

Sous `apps/web/src/components/play/zoom/` (ou inline dans page.module.css) :

- `ZoomCompact.tsx` — petit groupe +/− réduit, position top-right sous HUD

### Composants modifiés

- `PlayClient.tsx`
  - Ajout du bouton "Route" dans `actionButtons` (entre Centrer et le compas)
  - Suppression du `zoomGroup` du `rightStack`
  - Insertion du `<ZoomCompact />` en haut-droite sous HUD
  - Ajout du `<SlidePanel side="right" title="Routeur">` enrobant `<RouterPanel>`
  - Ajout des couches `<IsochroneLayer>` + `<RouteLayer>` + `<RouterDestinationMarker>` conditionnés par l'état du routeur
- `MapCanvas.tsx` — interception des clics quand `routerPhase === 'placing'`, avec changement de curseur (CSS crosshair desktop, indicateur en haut de carte sur mobile)
- `page.module.css` — styles `.zoomCompact`, `.mapPlacing`, suppression des règles obsolètes du zoom dans rightStack

### Store Zustand

Nouvelle slice `apps/web/src/lib/store/routerSlice.ts` :

```ts
type RouterPhase = 'idle' | 'placing' | 'calculating' | 'results';

interface RouterState {
  phase: RouterPhase;
  destination: { lat: number; lon: number } | null;
  preset: 'FAST' | 'BALANCED' | 'HIGHRES';
  coastDetection: boolean;
  coneHalfDeg: number;
  computedRoute: RoutePlan | null;
  error: string | null;

  // Génération counter pour invalider les calculs annulés
  calcGenId: number;
}

interface RouterActions {
  openRouter(): void;
  closeRouter(): void;
  enterPlacingMode(): void;
  exitPlacingMode(): void;
  setDestination(lat: number, lon: number): void;
  setPreset(p: RoutingPreset): void;
  setCoastDetection(v: boolean): void;
  setConeHalfDeg(deg: number): void;
  startCalculation(): number; // retourne calcGenId courant
  setRouteResult(plan: RoutePlan, genId: number): void;
  setRouteError(msg: string, genId: number): void;
  clearRoute(): void;
}
```

**Defaults :** `phase='idle'`, `destination=null`, `preset='FAST'`, `coastDetection=false`, `coneHalfDeg=60`, `computedRoute=null`, `error=null`, `calcGenId=0`.

**Persistance :** non. Volatile session, recalcul à la demande (météo change).

**Couplage panel store :** `openRouter()` ferme le panel actif courant ; ouvrir un autre panel via `openPanel()` ferme le routeur et appelle `clearRoute()` + `closeRouter()`.

## Layout & UI

### Modifications du `rightStack`

Ordre vertical : Voiles → Prog. → Centrer → **Route (nouveau)** → Compas
Suppression : `zoomGroup` (à la fin de la pile actuelle)

Style du bouton Route : identique aux autres `actionBtn` (52×52 px, label "Route", icône `MapPinned` ou équivalent Lucide).

### Zoom compact (top-right)

Position absolue : `top: 52px` (juste sous HUD), `right: 16px`.
Forme : groupe vertical 34px de large, deux boutons +/− de 28px chacun, séparés par 1px.
Style : même fond/border que les `actionBtn` mais réduit.

### Hotkey

`R` ouvre/ferme le routeur (cohérent avec V/P pour Voiles/Prog).

### Spectateur

Le bouton Route et le panel sont gardés derrière `canInteract` (comme Voiles/Prog actuellement). Pas de routeur en mode spectateur.

## États du panel (state machine)

```
idle (no dest) ──┬─ "Définir l'arrivée"  → placing
                 └─ close                 → panel fermé

placing ─────────┬─ clic carte            → idle (with dest)
                 ├─ ESC / "Annuler"       → idle (dest inchangée)
                 └─ close                 → panel fermé + sortie placing

idle (with dest)─┬─ "Router"              → calculating
                 ├─ "Définir l'arrivée"   → placing
                 ├─ change config         → idle (impacte prochain calcul)
                 └─ close                 → panel fermé + clearRoute

calculating ─────┬─ worker success        → results
                 ├─ worker error          → idle + error
                 └─ close panel           → annule calcul (genId invalidé)
                                            + clearRoute + panel fermé

results ─────────┬─ "Waypoints" / "CAP"   → confirm modal → apply → close
                 ├─ "Recalculer"          → calculating (mêmes params)
                 ├─ change dest / config  → idle (with dest) + clearRoute
                 └─ close                 → panel fermé + clearRoute
```

### Mode placing — interactions

- Desktop : curseur `crosshair` sur la carte
- Mobile : indicateur en haut de carte "Tap pour placer l'arrivée"
- Clic gauche / tap = pose de la destination, retour `idle`
- ESC (desktop) / bouton "Annuler" du panel = sortie placing
- Le bouton "✕" du panel ferme tout (sortie placing + close panel)

### Mode calculating — UX

- **Carte interactive** : zoom/pan/voiles/prog autorisés en parallèle du calcul
- **Panel reste fermable** : la fermeture annule le calcul (incrément `calcGenId`, le résultat retourné par le worker est jeté)
- Spinner + texte "Calcul en cours…" + estimation de durée (1-30s selon preset)

### Mode results — affichage

Encart "✓ Route calculée" :
- Distance totale (nm)
- ETA (durée estimée)
- Nombre de manœuvres
- Temps de calcul (debug-friendly)

Si route partielle (horizon météo dépassé) : warning jaune "Route incomplète : météo limitée à J+7".

Deux boutons d'application :
- **"→ Waypoints (auto-voile)"** — primary (doré)
- **"→ CAP schedule (auto-voile)"** — secondary (outline doré)

Bouton "↺ Recalculer" en bas (relance avec mêmes params).

## Affichage carte

Couches ajoutées (au-dessus des couches existantes : zones, trail, projection 7j) :

| Condition | Couches |
|-----------|---------|
| `phase === 'placing'` ou `'idle'` (panel ouvert, dest définie) | `<RouterDestinationMarker>` |
| `phase === 'results'` | `<IsochroneLayer>` + `<RouteLayer>` + `<RouterDestinationMarker>` |
| Autres cas (panel fermé, etc.) | Aucune |

Le marqueur de destination utilise les conventions visuelles du jeu (cercle rouge bordé blanc, label "Arrivée" en monospace).

`RouteLayer` et `IsochroneLayer` sont copiés du simulateur sans modification fonctionnelle (juste déplacés vers `components/map/routing/`).

## Worker — protocole

Réutilisation de `apps/web/src/workers/routing.worker.ts`. Pattern d'invocation :

```ts
const genId = useGameStore.getState().router.calcGenId; // après startCalculation()
worker.postMessage({ type: 'route', genId, input });

worker.onmessage = (e) => {
  const { genId: returnedGenId, plan, error } = e.data;
  const currentGenId = useGameStore.getState().router.calcGenId;
  if (returnedGenId !== currentGenId) return; // résultat périmé, jeter
  if (error) useGameStore.getState().setRouteError(error, returnedGenId);
  else useGameStore.getState().setRouteResult(plan, returnedGenId);
};
```

Annulation = simple incrément du `calcGenId` côté UI ; le worker continue son travail mais son résultat est jeté.

## Application comme programmation

### Modal de confirmation

Affiché si la prog actuelle a au moins un ordre futur. Sinon, application directe.

```
Vous avez N ordres en cours.
Appliquer la route va remplacer :
  • Tous les ordres futurs
  • L'état "voile auto" sera activé

Les ordres déjà déclenchés sont conservés.

[Annuler]  [Remplacer]
```

### Mode CAP schedule

`RoutePlan.capSchedule: CapScheduleEntry[]` →

Pour chaque entrée :
- Si `twaLock !== null` → ordre `TWA` avec `triggerTime = now + triggerMs`, `twa = twaLock`
- Sinon → ordre `CAP` avec `cap = entry.cap`
- Si `sail` change vs ordre précédent → ordre `SAIL` avec ce voilier

Plus un ordre global `MODE` pour `sailAuto = true` au début.

Persistance via l'API ProgPanel existante (POST des nouveaux ordres après suppression des futurs).

### Mode Waypoints

**Travail parallèle requis (inclus dans ce plan d'implémentation) :**

- Nouveau type d'ordre `WAYPOINT` côté moteur (`packages/game-engine-core` + `apps/game-engine`)
  - Schéma : `{ kind: 'WAYPOINT', lat: number, lon: number, captureRadiusNm: number }`
  - Capture radius par défaut : 0.5 nm
- Handling moteur :
  - Quand un ordre `WAYPOINT` est actif : le moteur calcule le bearing grand-cercle de la position courante vers le point à chaque tick et l'utilise comme cap consigne (équivalent à un ordre `CAP` recalculé en continu)
  - Quand la distance bateau→point passe sous `captureRadiusNm` : l'ordre est marqué consommé, le suivant devient actif
  - Si voile auto activée, le moteur sélectionne la voile optimale via polaire (logique existante)
- Côté API et store : extension du discriminated union `Order` pour inclure `WAYPOINT`
- Côté UI ProgPanel : pas de refonte ici, juste afficher la liste des waypoints comme une liste d'ordres (rendu minimal pour validation visuelle, look final dans le chantier ProgPanel)

Application :
- `RoutePlan.waypoints` (positions GPS extraites des inflexions de la polyline) → suite d'ordres `WAYPOINT`
- Plus un ordre `MODE` pour `sailAuto = true`

### Après application (les deux modes)

1. Appel API pour persister la nouvelle prog
2. `closeRouter()` (panel fermé + `clearRoute()`)
3. ProgPanel reflète les nouveaux ordres au prochain refresh

## Edge cases

| Cas | Comportement |
|-----|--------------|
| Polar pas chargé | Impossible en pratique (bootstrap au boot) |
| Coastline pas chargée (coast detection ON) | Worker la charge ; spinner reste affiché |
| GFS grid pas chargée | Bouton "Router" disabled, message "météo en chargement" |
| Worker exception | `phase: 'idle'`, error: "Erreur de calcul, réessayez" |
| Route impossible (no path) | `phase: 'idle'`, error: "Aucune route trouvée. Élargissez le cône ou désactivez la détection des côtes" |
| Route partielle (horizon météo) | `phase: 'results'` + warning "Route incomplète" ; iso s'arrêtent là où la météo s'arrête |
| Destination sur la terre | Autorisé ; le bateau s'échouera ; pas de warning préventif |
| Spectateur | Bouton routeur masqué |
| Mobile portrait | Panel pleine largeur (comportement SlidePanel existant) |

## Test plan minimal

**Unit tests :**
- `routerSlice` — toutes les transitions de phase
- Conversion `RoutePlan → orderQueue` (CAP mode)
- Conversion `RoutePlan → orderQueue` (waypoints mode)
- `calcGenId` invalidation : un résultat retourné avec un id périmé est jeté

**Integration tests (browser/playwright si dispo) :**
- Flux complet idle → placing → results → apply (CAP)
- Flux complet idle → placing → results → apply (Waypoints)
- Annulation pendant calcul (close panel pendant calculating → reset propre)
- Recalcul après changement de config

**Tests manuels :**
- Desktop (clic souris en mode placing)
- Mobile (tap au doigt en mode placing)
- Spectateur (bouton routeur invisible)

## Critères d'acceptation

- [ ] Bouton "Route" visible dans `rightStack` à côté de Voiles/Prog/Centrer
- [ ] Zoom compact +/− visible en haut-droite sous HUD
- [ ] Anciens boutons +/− du `rightStack` supprimés
- [ ] Le routeur s'ouvre via clic du bouton ou hotkey `R`
- [ ] Le clic "Définir l'arrivée" passe en mode placing
- [ ] Un clic / tap sur la carte pose la destination
- [ ] Le bouton "Router" lance le calcul (worker)
- [ ] Spinner affiché pendant calcul, panel restant fermable
- [ ] Fermer le panel pendant calculating annule le résultat
- [ ] Route + isochrones affichées en phase results
- [ ] Modal de confirmation si prog non vide
- [ ] Application CAP : ordres créés, voile auto activée
- [ ] Application Waypoints : ordres `WAYPOINT` créés, moteur navigue vers chaque point, voile auto activée
- [ ] Fermeture panel = route effacée
- [ ] Recalculer fonctionne avec mêmes ou nouveaux paramètres
- [ ] Mode spectateur : bouton invisible
- [ ] Tests unitaires verts
