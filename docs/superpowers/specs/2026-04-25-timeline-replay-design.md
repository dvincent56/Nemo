# Timeline & replay sur l'écran de jeu — Design

**Date :** 2026-04-25
**Statut :** Brainstorming validé · prêt pour planification

## Contexte

Le composant `WeatherTimeline` existe sur l'écran de jeu sous forme de squelette : il offre un curseur scrubable, un sélecteur de vitesse de lecture, des boutons step et un bouton LIVE, mais aucune logique fonctionnelle n'est branchée derrière. Aujourd'hui, scruber n'a aucun effet visible sur la carte.

L'objectif de ce thread est de **transformer cette timeline en un véritable outil temporel** qui :

1. Permet de visualiser l'évolution météo (vent, houle) dans le futur jusqu'à `J+7`
2. Permet de visualiser la trajectoire estimée du joueur (fantôme) en fonction de sa programmation, son cap fixe ou son cap TWA-locked
3. Permet de revenir dans le passé jusqu'au départ de la course pour rejouer son tracé
4. Affiche l'évolution du classement dans le temps via un sparkline
5. Pose les fondations serveur (persistance + API) pour une Phase 2 où le joueur pourra sélectionner des bateaux adverses et comparer leurs traces

## Objectifs Phase 1

- Persister le tracé du joueur en base (1 point/heure, configurable 60-180 min)
- Exposer une API REST `GET /races/:raceId/participants/:participantId/track` réutilisable Phase 2
- Étendre `timelineSlice` et créer un `trackSlice` côté client
- Implémenter le scrubbing complet : passé (replay) ET futur (projection)
- Rendre le fantôme du joueur sur la carte au temps scrubé
- Rendre la trace passée persistée derrière le bateau
- Masquer la couche météo en mode replay arrière (choix UX validé)
- Ajouter un sparkline de l'évolution du classement (desktop/tablette uniquement)

## Hors-scope (Phase 2 et au-delà)

- **Sélection d'un bateau adverse** par clic sur la carte (UI dédiée, store opponents, replay multi-bateaux). L'API serveur de récupération de trace est **conçue dès Phase 1** pour servir ce cas, mais aucun consommateur UI n'est ajouté maintenant.
- **Météo rétrospective** (vraie prévi GFS du moment passé) — masquage simple en Phase 1, persistance des cycles GFS reportée si la demande émerge.
- **Mode boucle** sur le play (rebouclage automatique après `maxMs`).
- **Replay arrière en lecture auto** (Play ne fait qu'avancer vers le futur ; pour observer son passé en mouvement, le joueur scrub à T-N puis Play).
- **Cache HTTP / ETag** sur l'endpoint trace.

## Choix UX validés (récap)

| # | Sujet | Décision |
|---|---|---|
| 1 | Scope Phase 1 | Mon bateau seulement, persistance + API en place pour Phase 2 |
| 2 | Météo en mode replay arrière | Couches `wind-particles` et `swell-overlay` masquées (`visibility: none`) |
| 3 | Mode lecture | Drag manuel + bouton Play. Le drag stoppe le play. Vitesses 1x / 6x / 24x conservées |
| 4 | Layout timeline | Bar bicolore passé/futur + sparkline classement proportionnel. Mode mobile dégradé sans sparkline |
| 5 | Fantôme + trace | Fantôme = même icône que mon bateau à `opacity 0.4`. Trace passée = ligne bleue solide `#7e9fc3`. Projection future = ligne or pointillée (existante) |
| 6 | Bornes timeline | `BRIEFING` → range `now → J+7`. `LIVE` → range `raceStart → min(J+7, ...)`. `FINISHED` → range `raceStart → raceEnd`. Pas de range adaptatif log pour les sprints |

## Architecture d'ensemble

```
GAME ENGINE WORKER
  └─ tick → si elapsed >= TRACK_CHECKPOINT_INTERVAL → INSERT trackpoint
                                                       (lat, lon, rank, ts)
                                                          ▼
POSTGRES (Drizzle)
  └─ table boat_track_points (PK participant_id, ts) ON DELETE CASCADE
                                                          ▼
API REST (apps/api)
  └─ GET /races/:raceId/participants/:pid/track → JSON points[]
                                                          ▼
CLIENT WEB (apps/web)
  ├─ trackSlice (NEW)         : myPoints[]
  ├─ timelineSlice (EXTEND)   : isPlaying, raceStartMs, forecastEndMs, raceEndMs
  ├─ selectors                : ghostPosition, weatherVisible, pastTraceCoords, sparkline
  ├─ useTrackHydration        : fetch initial + WS subscribe
  ├─ useTimelinePlayback      : rAF loop pour Play
  ├─ WeatherTimeline (REWRITE): layout B + sparkline + responsive
  └─ MapCanvas (EXTEND)       : layers past-trace-line + ghost-boat-icon
```

## Persistance serveur

### Schéma DB

```sql
CREATE TABLE boat_track_points (
  participant_id UUID NOT NULL REFERENCES race_participants(id) ON DELETE CASCADE,
  ts             TIMESTAMPTZ NOT NULL,
  lat            DOUBLE PRECISION NOT NULL,
  lon            DOUBLE PRECISION NOT NULL,
  rank           INTEGER NOT NULL,
  PRIMARY KEY (participant_id, ts)
);
```

- PK composite naturellement indexée pour `WHERE participant_id = ? ORDER BY ts ASC`
- Pas de `race_id` (accessible via `participant.race_id`)
- `rank` au moment du checkpoint (sinon il faudrait re-trier toute la course pour le sparkline)
- `ON DELETE CASCADE` depuis `race_participants` : toute suppression d'un participant supprime ses traces

### Worker — checkpointing

- Ajout d'un champ `lastCheckpointTs: Date | null` dans `BoatRuntime` (déjà persisté en mémoire entre ticks)
- Dans le hook `onTickDone` (ou équivalent), à chaque tick :
  - Si `now - lastCheckpointTs >= TRACK_CHECKPOINT_INTERVAL_MS` → enqueue checkpoint
  - Force-checkpoint sur transitions clés : passage `BRIEFING → LIVE` (T=0), bateau qui finit la course, DNF/abandon
- Batch INSERT via Drizzle, une transaction par run du worker
- Volume estimé : ~50k participants × 1 row/h ≈ 14 inserts/s aggregate, batché trivial

### Configuration

```bash
TRACK_CHECKPOINT_INTERVAL_MIN=60   # défaut 1h, tunable 60-180
```

Décision : démarrer à 60 min en dev, monter à 120 min en prod si besoin selon les benchs.

### Cleanup à l'archivage

Fonction `cleanupRaceTrackPoints(raceId: string)` qui supprime les traces d'une course :

```sql
DELETE FROM boat_track_points
WHERE participant_id IN (SELECT id FROM race_participants WHERE race_id = ?)
```

Appelée explicitement depuis le hook qui fait passer une course en `ARCHIVED` (admin handler ou job).

Si `race_participants` est lui-même supprimé à l'archivage, `ON DELETE CASCADE` couvre déjà le cas — la fonction reste idempotente.

## API REST

```
GET /api/v1/races/:raceId/participants/:participantId/track
→ 200 application/json
{
  "participantId": "uuid",
  "points": [
    { "ts": "2026-04-25T14:32:00.000Z", "lat": 47.5, "lon": -3.2, "rank": 234 },
    ...
  ]
}
```

- **Auth** : tout utilisateur authentifié inscrit dans la course peut fetcher la trace de n'importe quel participant. Ouvert pour Phase 2 (sélection adversaires). Pas de fuite : la position courante est déjà broadcastée à tous les inscrits.
- **Pas de pagination** : volume borné (~2160 points max pour 90j, ~70 Ko gzipped)
- **Ordre** : ascendant chronologique
- **Pas de cache HTTP Phase 1** : on charge à chaque mount

## Événement WebSocket

Quand le worker écrit un checkpoint, il émet :

```ts
{
  type: 'trackPointAdded',
  participantId: string,
  point: { ts: string (ISO), lat: number, lon: number, rank: number }
}
```

Diffusé dans la room de la course (existante). Le client filtre :
- `participantId === myParticipantId` → append à `track.myPoints`
- Phase 2 : si `participantId in selectedOpponents` → append au store opponent

**Pas de hydration via WS au connect** : le client a déjà fetché l'historique via REST, le payload connect reste léger.

## State management & selectors (client)

### Slices

**NEW `trackSlice`**

```ts
interface TrackState {
  myPoints: TrackPoint[];          // trié ASC par ts
  isLoading: boolean;
  error: string | null;
}
interface TrackPoint { ts: number; lat: number; lon: number; rank: number; }

actions:
  setTrack(points: TrackPoint[]): void
  appendTrackPoint(p: TrackPoint): void  // dédupe par ts
  clearTrack(): void
```

**EXTEND `timelineSlice`**

```ts
interface TimelineState {
  // existant
  currentTime: Date;
  isLive: boolean;
  playbackSpeed: 1 | 6 | 24;
  // nouveau
  isPlaying: boolean;
  raceStartMs: number | null;
  raceEndMs: number | null;
  forecastEndMs: number | null;
}

actions ajoutées:
  setIsPlaying(b: boolean): void
  setRaceContext(ctx: { startMs, endMs?, forecastEndMs }): void
```

### Selectors dérivés (pure)

```ts
selectTimelineBounds(s) → { minMs, maxMs }
  // BRIEFING → minMs = now ; LIVE → minMs = raceStartMs
  // FINISHED → maxMs = raceEndMs ; LIVE → maxMs = forecastEndMs

selectGhostPosition(s) → { lat, lon, hdg } | null
  // isLive → null
  // currentTime < now → lerp dans track.myPoints + trailCoords volatile
  // currentTime > now → lerp dans projection worker output (par dtMs)
  // hdg = atan2(deltaLat, deltaLon) entre les 2 points encadrants

selectWeatherLayerVisible(s) → boolean
  // = currentTime >= now

selectPastTraceCoords(s) → [lat, lon][]
  // = track.myPoints + trailCoords[] volatile, fusionnés et triés
  // (pas de filtrage par currentTime — la trace complète reste visible)

selectRankSparklinePoints(s) → { ts, rank }[]
  // = track.myPoints normalisé en [0,1] sur min/max rank de la fenêtre
```

### Hooks

**`useTrackHydration(raceId, myParticipantId)`** — monté dans `PlayClient`
- Mount : `GET /participants/:pid/track` → `setTrack(...)`
- Subscribe WS `trackPointAdded` → `appendTrackPoint(...)` si `participantId === myParticipantId`
- Unmount : `clearTrack()`

**`useTimelinePlayback()`** — monté dans `WeatherTimeline`
- Si `isPlaying === true && !isLive` :
  - rAF loop : `currentTime += dt * playbackSpeed`
  - Clamp à `maxMs` ; à `maxMs` → `setIsPlaying(false)` + `goLive()`
- Si `isLive === true` :
  - Refresh `currentTime = new Date()` toutes les 5s

### Tableau d'interactions

| Action utilisateur | Effet store |
|---|---|
| Drag pastille | `setTime(t)` → `isLive=false`, `isPlaying=false` |
| Click LIVE | `goLive()` → `isLive=true`, `isPlaying=false`, `currentTime=now` |
| Click Play (si `!isLive`) | `setIsPlaying(true)` |
| Click Pause | `setIsPlaying(false)` |
| Click 1x/6x/24x | `setPlaybackSpeed(n)` |
| Click ◀/▶ 6h | `setTime(currentTime ± 6h)` clampé aux bornes |
| Reach `maxMs` en play | `setIsPlaying(false)` ; reste à `maxMs` |
| Click sur la track (non drag) | `setTime(t)` instantané |
| Click sur sparkline | `setTime(ts du point cliqué)` |

Note : Play n'avance que vers le futur. Pour observer son passé en mouvement, le joueur scrub à T-N puis lance Play à 24x.

## Composant `WeatherTimeline` — layout détaillé

### Structure desktop (≥ 1024px, hauteur ~96px)

```
┌────────────────────────────────────────────────────────────────────────┐
│  [14:32  J+22 · 22 mai]    [◀ 6h] [▶] [1x][6x][24x] [6h ▶] [● LIVE]    │ row 1
│  ╱╲   ╱╲                                                                │
│  ╱  ╲ ╱  ╲╱╲    ╱╲                                                       │ row 2 — sparkline (h=20)
│ ╱   ╲╱    ╲╱  ╲╱  ╲___                                                   │
├────────────────────────────────────────────────────────────────────────┤
│                       NOW                                                │
│ DÉPART [████████ passé bleu █████|░░░░ futur or ░░░░░░░░░░] J+7         │ row 3 — track (h=8)
│         1 mai      8 mai      15 mai   22 mai      29 mai                │ row 4 — ticks
└────────────────────────────────────────────────────────────────────────┘
```

### Sous-composants

```
<WeatherTimeline>
  <TimelineHeader>     row 1, time + boutons
  <RankSparkline>      row 2, SVG h=20 (caché mobile)
  <TimelineTrack>      row 3, bar interactive
    <TrackBackground>  dégradé passé/futur
    <NowLine>          verticale blanche 50% opacity
    <TimeCursor>       pastille or, draggable
    <TickMarks>        marqueurs adaptatifs
  <TickLabels>         row 4, dates
</WeatherTimeline>
```

### Sparkline rang

- SVG inline (pas de lib externe), `viewBox` `0 0 W 20`
- Données : `selectRankSparklinePoints(state)`
- Y normalisé sur `min/max rank` de la fenêtre visible (proportionnel)
- Polyline + zone fill légère sous la courbe (`opacity 0.15`, color `#7e9fc3`)
- Hover : tooltip `"J+12 · 14:00 · rang 234"`
- Click : scrub vers le `ts` cliqué

### Ticks adaptatifs

| Durée totale | Pas | Format |
|---|---|---|
| ≤ 12h | 1h | `14:00` |
| 12-72h | 6h | `14:00 · J+1` |
| 3-14j | 1 jour | `22 mai` |
| > 14j | 7 jours | `22 mai` |

Recalculés sur changement de bornes ou viewport.

### Interactions curseur

- Drag souris/touch : update `currentTime` continu
- Click sur la track : jump immédiat
- Hover : tooltip `"22 mai 14:32 · rang 234 · BSP 14,2 kn"` (BSP/rang interpolés depuis la trace)
- Clavier : `←/→` step 1h, `Shift+←/→` step 6h, `Home` raceStart, `End` LIVE
- Aria : `role="slider"`, `aria-valuemin/max/now` en timestamps lisibles

### Mode tablette (768-1024px)

- Sparkline conservé mais hauteur 16px
- Tous les contrôles présents

### Mode mobile (< 768px, hauteur ~64px)

```
┌──────────────────────────────────────────────┐
│ 14:32 J+22 · 22 mai          [▶] [LIVE]      │
│ DÉPART [██████|░░░░░░] J+7                   │
└──────────────────────────────────────────────┘
```

- Sparkline supprimé
- Step ◀/▶ supprimés (drag suffit)
- Sélecteur 1x/6x/24x dans un menu accessible via long-press sur Play

### Tokens CSS

À vérifier dans `apps/web/src/styles/globals.css` avant utilisation. Si absents ou nommés différemment, on s'aligne sur l'existant. Cibles attendues :

```
--nl-navy: #0a1929
--nl-gold: #d4b870
--nl-ivory: #e8e6dc
--nl-blue-trace: #7e9fc3
--nl-track-bg: #1a2a3f
```

## Intégration MapCanvas

### Sources MapLibre nouvelles

```
sources:
  past-trace      → GeoJSON LineString (selectPastTraceCoords)
  ghost-boat      → GeoJSON Point        (selectGhostPosition)
```

### Layers (z-order bas → haut)

| Layer | Type | Statut |
|---|---|---|
| `past-trace-line` | line | NEW · `#7e9fc3` solide, width 2.5 |
| `projection-line` | line | EXIST inchangé (opacity dynamique) |
| `projection-markers-time` | symbol | EXIST |
| `projection-markers-maneuver` | symbol | EXIST |
| `ghost-boat-icon` | symbol | NEW · même icône que mon bateau, `icon-opacity: 0.4` |
| `my-boat-icon` | symbol | EXIST · toujours visible, toujours au-dessus |

### Source de la trace passée

Combinaison de deux flux dans une seule LineString :

1. **Squelette persisté** (1 pt/h) — fetch API au mount
2. **Trail volatile** (`trailCoords[]` déjà accumulé dans `MapCanvas`) — couvre depuis le dernier checkpoint jusqu'à `now` à haute résolution

→ `[...persisted, ...volatile]`. Visuellement lisse au zoom courant ; à zoom max on perçoit potentiellement les segments de 1h, conforme au "lissé pas exact à la minute".

### Fantôme

- `isLive=true` → source vide, pas de marker
- `currentTime < now` → position interpolée linéairement entre les 2 points adjacents de `track.myPoints` ∪ `trailCoords[]`
- `currentTime > now` → position interpolée dans la sortie du projection worker (par `dtMs`)
- Heading du fantôme = atan2(Δlat, Δlon) entre les 2 points encadrants

### Couches météo

Conformément au choix #2 :
- `currentTime < now` → `wind-particles` + `swell-overlay` → `setLayoutProperty('visibility', 'none')`
- `currentTime >= now` → réactivés

### Projection line en mode scrub

| État | `projection-line` opacity |
|---|---|
| `isLive` (présent) | 1.0 (existant) |
| `currentTime > now` | 1.0 |
| `currentTime < now` | 0.4 (info de contexte, focus sur le passé) |

### Performance

- Updates layers debouncés à 50ms sur changement de `currentTime`
- `setData` MapLibre est cheap pour LineStrings < 5000 points
- rAF du Play loop touche directement les sources MapLibre via ref, pas de re-render React
- Selectors mémoizés (track partagé entre sparkline et past-trace)

### Anti-patterns à éviter

- ❌ Re-render React du composant Map à chaque frame de play
- ❌ Spline Catmull-Rom côté client (overkill, MapLibre lisse à zoom raisonnable)
- ❌ "Ghost trail" derrière le fantôme pendant le replay (visuellement bruité, non demandé)

## Edge cases & comportement aux bornes

| Situation | Comportement |
|---|---|
| `BRIEFING` (course pas commencée) | Range `now → J+7`. Pas de zone passée. Pas de sparkline (aucune trace) |
| `LIVE` | Range `raceStartMs → forecastEndMs`. Sparkline rendu si ≥ 2 points |
| `FINISHED` | Range `raceStartMs → raceEndMs`. Pas de projection future. Pastille à raceEndMs en LIVE |
| Course très courte (sprint < J+7) | Range fixe `raceStart → J+7`. Le passé apparaît compact, accepté |
| Drag avant `minMs` | Clamp à `minMs` |
| Drag après `maxMs` | Clamp à `maxMs` |
| Play atteint `maxMs` | `setIsPlaying(false)` + retour LIVE auto |
| Aucune trace persistée encore | Sparkline masqué, past-trace vide (juste `trailCoords[]` volatile) |
| Bateau abandonné (DNF) | Force-checkpoint au moment du DNF. Range = `raceStart → ts du DNF`. Pas de projection |

## Ordre de bataille (haut niveau)

À détailler dans le plan d'implémentation :

1. Migration DB + schéma Drizzle `boat_track_points`
2. Worker : checkpointing + force-checkpoint aux transitions
3. API REST `GET /races/:raceId/participants/:pid/track`
4. WS event `trackPointAdded`
5. Cleanup `cleanupRaceTrackPoints(raceId)` + intégration dans le flow d'archivage
6. Client : `trackSlice` + extension `timelineSlice` + selectors
7. Client : `useTrackHydration` + `useTimelinePlayback`
8. Client : refonte `WeatherTimeline` (layout B desktop / mobile)
9. Client : extension `MapCanvas` (sources + layers past-trace + ghost)
10. Tests : unitaires selectors, intégration scrub end-to-end, responsive

## Open questions / suivi

- Le hook précis d'archivage de course (où appeler `cleanupRaceTrackPoints`) à identifier dans le plan d'implémentation
- Vérifier les tokens CSS exacts dans `globals.css` avant de les référencer
- Bench réel à faire en charge : confirmer que `TRACK_CHECKPOINT_INTERVAL_MIN=60` tient la cible 1M joueurs sans saturer Postgres
