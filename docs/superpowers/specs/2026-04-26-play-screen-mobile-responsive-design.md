# Play screen — refonte responsive mobile

## Contexte

L'écran `/play/[raceId]` est aujourd'hui jouable sur desktop mais souffre de plusieurs régressions visuelles et ergonomiques sur tablette et smartphone (portrait + landscape). Ce spec décrit les correctifs ciblés à apporter aux composants existants — aucun nouveau composant métier, aucune dépendance ajoutée.

Périmètre :
- `apps/web/src/app/play/[raceId]/page.module.css`
- `apps/web/src/components/play/Compass.{tsx,module.css}`
- `apps/web/src/components/play/SlidePanel.{tsx,module.css}` (+ nouveau mode bottom sheet)
- `apps/web/src/components/play/timeline/{TimelineHeader,TimelineTrack,TimelineControls}.module.css`
- `apps/web/src/components/play/{ProgPanel,SailPanel,RouterPanel}.module.css`
- `apps/web/src/components/play/CoordsDisplay.module.css` (déjà à jour, vérifier seulement)
- `apps/web/src/components/play/ZoomCompact.tsx` (placement + variante horizontale)

Hors périmètre : refactor des panels métier, nouveaux contrôles, modifications du moteur, règles de gameplay.

## Problèmes corrigés

1. **Desktop** : le widget zoom `+ / −` est positionné à `top: 52px` au lieu de `top: 16px`, créant un déséquilibre visuel avec `CoordsDisplay` (haut-gauche, top: 16px).
2. **Compass mobile** : les readouts vitesse / cap / TWA sont masqués (`display: none` à `max-width: 600px` et `max-height: 420px`), perdant 3 informations critiques.
3. **Boutons d'action mobile** : la rangée d'actions déborde à gauche du compass et peut chevaucher le widget zoom en landscape étroit.
4. **Timeline cible accessibilité** : track 28px, boutons 28-30px → sous le seuil iOS HIG 44px.
5. **Timeline labels** : NOW / J+1 / J+2 / J+3 se chevauchent en landscape mobile lorsque le curseur s'approche d'un repère.
6. **Panels Sails / Prog / Router** : padding desktop conservé en mobile, contenu trop volumineux.
7. **Panel mobile portrait** : `width: 420px` capé à `calc(100vw - 48px)` cache toute la carte et empêche de voir la route proposée par le routeur ou la file d'ordres se déposer.

## Architecture des règles

Trois breakpoints sont ajoutés ou réutilisés :

| Breakpoint | Sémantique | Contenu |
|---|---|---|
| `≥ 768px` | Desktop / tablette | Layout actuel inchangé sauf placement zoom (point 1) |
| `≤ 600px` ou `(max-height: 500px)` | Mobile (portrait + landscape étroit) | Compactions ci-dessous |
| `≤ 600px` ET orientation portrait | Mobile portrait | Bottom sheet pour panels Sails / Prog / Router |

La détection portrait utilise `@media (max-width: 600px) and (orientation: portrait)`. Le pattern `(max-height: 500px)` capture les phones en landscape quel que soit la largeur.

## Détail des changements

### 1. Desktop — zoom aligné sur les coords

Le widget zoom passe de `top: 52px right: 16px` à `top: 16px right: 16px`. C'est le miroir exact de `CoordsDisplay` (`top: 16px left: 16px`). Aucun autre élément en haut-droite n'est affecté.

### 2. Mobile — zoom horizontal

Sur `≤ 600px` ou `max-height: 500px`, le widget zoom passe de colonne (vertical, ~56px de hauteur) à row (horizontal, 28px de hauteur, 64-72px de largeur). Position `top: 8px right: 8px`. Implémentation : ajouter une classe `.zoomCompactHorizontal` activée via media query, qui inverse `flex-direction: row` et change la bordure interne de `border-top` à `border-left`.

### 3. Compass mobile — readouts conservés et compactés

Les règles `.readouts { display: none }` à `max-width: 600px` et `max-height: 420px` sont retirées. À la place, les readouts passent en version compacte :

- Label : `font-size: 6.5px` (vs 9px desktop)
- Valeur : `font-size: 10px` (vs 14px desktop)
- Padding-bottom du grid : `4px` (vs 10px)

Le SVG compass-disc est plafonné via :

- `max-width: 100px` à `max-height: 600px`
- `max-width: 60px` à `max-height: 480px` (landscape mobile typique)
- `max-width: 48px` à `max-height: 360px` (iPhone SE landscape)

La largeur du wrapper passe à `clamp(120px, 38vw, 168px)` sur mobile.

### 4. Bord droit mobile — stack consolidé

Layout fixé pour landscape mobile et portrait :

```
┌─────────┐ ← Zoom horizontal  top:8 right:8 height:28
│ + │ − │
└─────────┘
       (gap libre, ≥ 16px garanti par calcul)
┌─────────┐ ← Action buttons row (4 × 36px height, gap 4px)
│⛵│📋│⊕│🗺│
└─────────┘
   gap 6px
┌─────────┐ ← Compass widget (readouts + disc 48-60px + actions)
│ VIT CAP TWA │
│   [disc]    │
│ TWA  ✓  ✕  │
└─────────┘
              ↑ bottom: 8px
```

Largeur du stack `right:8 bottom:8 width: 132px` (alignée sur la largeur du compass), le wrapper compass remplit toute la largeur du stack. Les 4 boutons de la row deviennent des cellules d'une grid `repeat(4, 1fr)` de hauteur 36px.

### 5. Bouton Centrer reste dans la row

Aucun changement structurel : Voiles / Programmation / Centrer / Routeur restent les 4 boutons. Pas d'ajout, pas de retrait.

### 6. Timeline — controls mobile drastiquement simplifiée

Sur mobile (`≤ 600px` ou `max-height: 500px`), `TimelineControls` masque tout sauf le bouton LIVE :

- `.btn` (`−6h`, `+6h`, play) → `display: none`
- `.speedGroup` (60×, 120×, 240×) → `display: none`
- `.live` est conservé, hauteur passe à `36px`, padding `0 16px`, font `10px`

Le drag du curseur sur le rail reste le moyen de naviguer dans le temps. Le bouton LIVE reste l'échappatoire pour rentrer au présent.

`TimelineHeader` simplifié sur mobile : le timestamp court (`21h27` sans `· 26 AVR`) sur portrait étroit (déjà partiellement géré par `@media (max-width: 480px) { .timestamp { display: none } }` — règle inversée pour conserver le timestamp court).

### 7. Timeline — labels en stagger

Le pattern `tickRowAbove` / `tickRowBelow` existe déjà dans `TimelineTrack.module.css`. Trois changements :

- **Past dates** (`12 AVR`, `18 AVR`) → `tickRowAbove` (au-dessus du rail)
- **Future J+** (`J+1`, `J+2`, ...) → `tickRowBelow` (en-dessous du rail)
- **Label NOW supprimé** : le curseur doré matérialise déjà le présent
- Sur mobile : formats courts pour past (`12/4` au lieu de `12 AVR`), futur inchangé

La règle actuelle `@media (max-width: 480px) { .tickRowBelow { display: none } }` est retirée — les J+ doivent rester visibles sur mobile.

### 8. Timeline — touch targets ≥ 44px

- Hit-area du track : passe de `height: 28px` (desktop) à `height: 44px` sur mobile, le rail visible reste 1px au centre, le halo touch invisible occupe 22px au-dessus et au-dessous.
- Curseur draggable : passe de `14×14px` à `18×18px` sur mobile.
- Bouton LIVE : passe à `36px` de hauteur (cible 44px atteinte avec padding interne du flex container).

### 9. Panels — compactions mobile

Côté `SlidePanel.module.css` (panel base partagé Sails / Prog / Router / Ranking) :

| Token | Desktop | Mobile (`≤ 600px` ou `max-h: 500px`) |
|---|---|---|
| `.head` padding | `18px 20px 12px` | `10px 14px` |
| `.title` font-size | `22px` | `18px` |
| `.body` padding | `18px 20px` | `12px 14px` |

Côté `ProgPanel.module.css` (et règles équivalentes pour `SailPanel`, `RouterPanel`) :

| Token | Desktop | Mobile |
|---|---|---|
| `.tabs` margin-bottom | 16px | 12px |
| `.tab` padding | `12px 8px` | `8px 6px` |
| `.tab` font-size | 10px | 9px |
| `.form` gap | 12px | 8px |
| `.form` margin-bottom | 22px | 12px |
| `.fieldLabel` font-size | 9px | 8.5px |
| `.fieldInput` padding | `10px 12px` | `8px 10px` |
| `.fieldInput` font-size | 14px | 13px |
| `.submit` padding | `12px 16px` | `10px 14px` |
| `.submit` font-size | 11px | 10px |
| `.queueTitle` font-size | 18px | 15px |

### 10. Largeur side panel landscape mobile

Sur landscape mobile (`(max-height: 500px)` ou `(max-width: 896px) and (orientation: landscape)`), la largeur passe de `420px` à `min(360px, calc(100vw - 48px))`. Le panel reste en side panel sur landscape : pas de bottom sheet en orientation landscape.

### 11. Bottom sheet — portrait mobile uniquement

Sur `(max-width: 600px) and (orientation: portrait)`, les panels Sails / Prog / Router / Ranking passent du side panel au pattern bottom sheet. La carte reste visible au-dessus de la feuille pour voir la route placée par le routeur ou la file d'ordres se déposer.

**Trois snap points** (hauteurs verticales du sheet) :
- **Peek** : 64px (header avec titre + chevron, contenu masqué)
- **Mid** : `min(50vh, 360px)` — usage standard formulaire
- **Full** : `min(90vh, 100vh - 56px)` — listes longues (file d'ordres)

**Composant** : extension de `SlidePanel`. Ajout d'un prop `mode?: 'side' | 'sheet'` (default `'side'`). Sur `'sheet'`, le rendu utilise une variante CSS où le panel est ancré en bas, occupe la largeur complète, applique `transform: translateY(...)` selon le snap point.

**Drag** : poignée 30×4px en haut du sheet, ergonomie pouce. Drag vertical pour passer entre les snap points. Tap sur la poignée cycle peek → mid → full → peek.

**Sélection mode** : le hook `useGameStore` ne change pas. PlayClient sélectionne le `mode` via une media query JS au mount :

```ts
const isPortraitPhone = useMediaQuery('(max-width: 600px) and (orientation: portrait)');
const panelMode = isPortraitPhone ? 'sheet' : 'side';
```

`useMediaQuery` n'existe pas encore dans `apps/web/src/hooks/`. À ajouter — implémentation triviale via `window.matchMedia` + `useEffect`, sans lib externe. Renvoie un boolean, gère le SSR (renvoie `false` au premier render serveur, ré-évalue au mount).

**Drag handler** : pointer events vanilla (`onPointerDown` / `onPointerMove` / `onPointerUp` sur la poignée). Pas de lib externe. La logique de snap consigne la position courante (un état `'peek' | 'mid' | 'full'`) et calcule la translateY correspondante.

**Fermeture** : tap sur la poignée en mode peek ferme le panel (revient au comportement actuel). Le bouton `×` du header est conservé en mid / full.

**Backdrop** : pas de backdrop opaque — on veut voir la carte. Le sheet a son propre fond `rgba(12, 20, 36, 0.97)` qui suffit visuellement.

## Tests

Tests visuels manuels à effectuer (pas de test unitaire ajouté — c'est du CSS de positionnement) :

1. **Desktop 1440×900** : zoom à top:16 right:16, action stack et compass intacts.
2. **Tablet 1024×768** : layout desktop conservé, breakpoint pas déclenché.
3. **iPhone 14 portrait 390×844** : compass disc 60px, readouts visibles, ouvrir Prog → bottom sheet, drag entre les 3 snap points.
4. **iPhone 14 landscape 844×390** : zoom horizontal top-droite, action row + compass bas-droite, gap zoom↔stack ≥ 16px, panel reste en side panel.
5. **iPhone SE landscape 568×320** : compass disc 48px, gap garanti, timeline simplifiée, drag du curseur fonctionne.
6. **iPad portrait 820×1180** : breakpoint `(max-width: 600px)` pas déclenché, layout desktop, bottom sheet inactif.

Cibles touch sur mobile vérifiées avec inspecteur :

- Action buttons : ≥ 36px visuel, hit-area effectif ≥ 44px (via padding interne ou wrapper).
- Compass action buttons : 20px visuel — déjà petits sur desktop, on accepte la régression mobile car le compass est secondaire au drag du disque (lequel, lui, occupe 48-60px).
- Timeline cursor : 18px visuel + halo, hit-area du track 44px.
- Bouton LIVE : 36px visuel, hit-area 44px via padding.

## Risques

- Le bottom sheet ajoute du JS (`useMediaQuery`, drag handler). Reste léger — pas de lib externe.
- Le repositionnement du zoom desktop (top: 52 → 16) peut surprendre des joueurs habitués. Acceptable, alignement esthétique meilleur.
- `display: none` sur les contrôles timeline mobile retire des fonctionnalités. C'est un choix produit assumé : drag + LIVE suffisent au scrubbing mobile.

## Décisions consignées

- Bottom sheet **uniquement** en mobile portrait. Landscape garde le side panel.
- Curseur du rail = NOW visuel sur mobile, pas de label texte NOW.
- Compass disc plafonné à 60px (48px sur très petit landscape) plutôt qu'agrandissement de la map area : préserve l'équilibre visuel zoom-vs-compass.
- Timeline ne perd pas le bouton LIVE — c'est l'échappatoire indispensable.
