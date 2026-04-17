# Pipeline Météo GFS — Design Spec

**Date :** 2026-04-17
**Statut :** En attente de validation

## Contexte

Project Nemo est un jeu de voile en ligne nécessitant des données météorologiques réalistes (vent + houle) issues du modèle GFS 0.25° de la NOAA. Les données GFS sont publiées toutes les 6h (runs 00z, 06z, 12z, 18z) avec un délai de publication de 3h30 à 5h. Le système doit gérer le téléchargement, le stockage, la transition fluide entre deux runs (blending), et la livraison au frontend.

## Décisions prises

| Sujet | Décision |
|---|---|
| Blending | Côté game-engine uniquement (source de vérité unique) |
| Durée de blend | 1h |
| Stockage Redis | Clés par run timestamp (`weather:grid:{runTs}`) |
| Forecast hours | f000–f072 pas de 3h, f078–f240 pas de 6h (53 fichiers) |
| Grille vagues | Ré-interpolée sur la grille vent 0.25° à l'ingestion |
| Stockage composantes | U/V uniquement (conversion TWS/TWD au vol côté game-engine) |
| Déploiement ingestion | Container Docker dans docker-compose |
| Format endpoint REST | ArrayBuffer binaire |
| UI indicateur GFS | Texte simple dans le LayersWidget |
| Livraison au frontend | Prefetch agressif en arrière-plan |

---

## Section 1 : Ingestion Python (weather-engine)

### Rôle

Télécharger les GRIB2 GFS depuis NOAA NOMADS, parser, sérialiser et pousser dans Redis.

### Cycle

- Le container tourne en continu, vérifie toutes les 5 min si une nouvelle run est disponible.
- Cible les 4 runs quotidiennes : 00z, 06z, 12z, 18z.
- Pour chaque run, télécharge les forecast hours :
  - **f000 à f072** : pas de 3h (25 fichiers)
  - **f078 à f240** : pas de 6h (28 fichiers)
  - Total : **53 forecast hours** par run
- Sources :
  - **Vent atmosphérique** : GFS 0.25° — variables U10/V10
  - **Vagues** : GFS Wave 0.16° — variables SWH, MWD, MWP
- Traitement :
  - Parsing GRIB2 via `cfgrib` + `xarray`
  - Ré-interpolation des vagues 0.16° sur la grille vent 0.25° (bilinéaire)
  - Stockage en composantes : U, V, SWH, MWD_x (`sin(MWD)`), MWD_y (`cos(MWD)`), MWP — soit **6 floats par point**
    - Note : MWD est pré-décomposé en composantes sin/cos à l'ingestion pour éviter le problème de wraparound 360°→0° lors du blending
  - Sérialisation en Float32Array base64
- Push Redis : clé `weather:grid:{runTimestamp}` avec TTL 24h (4 dernières runs conservées)
- Publication sur le channel Redis `weather:grid:updated` avec le timestamp de la run
- Persistance disque : la dernière run complète est écrite en `.bin` sur le filesystem (fallback)

### Estimation mémoire Redis

- Grille 0.25° : 1440 × 721 = 1 038 240 points
- × 6 floats × 4 bytes = ~25 Mo par forecast hour
- × 53 hours = ~1.3 Go par run
- × 4 runs (TTL 24h) = **~5.2 Go**

Note : ce volume est significatif. Optimisations possibles si nécessaire :
- Réduire la couverture géographique aux zones de course actives
- Compresser les Float32Array (zstd) avant stockage Redis
- Réduire le nombre de runs conservées à 2 (TTL 12h)

### Détection de disponibilité NOAA

- HEAD request sur le fichier f000 de la run attendue (`https://nomads.ncep.noaa.gov/pub/data/ncdcgrib/gfs.{YYYYMMDD}/{HH}/atmos/gfs.t{HH}z.pgrb2.0p25.f000`)
- Si 404 → retry dans 5 min
- Si 200 → lancer le download de tous les forecast hours
- Timeout : si après 6h la run n'est pas disponible, log une alerte et attendre la run suivante

### Gestion d'erreur

- Forecast hour en échec au download → 3 retries avec backoff exponentiel (5s, 15s, 45s)
- Toujours en échec → skip ce forecast hour, le game-engine interpolera temporellement entre les voisins
- Redis down → retry en boucle avec backoff, les données GRIB restent en mémoire
- NOAA down > 24h → la dernière run expire de Redis, le game-engine bascule sur le fichier `.bin` persisté

---

## Section 2 : Blending dans le Game Engine

### Rôle

Maintenir 2 grilles GFS en mémoire et interpoler entre elles pendant la transition de 1h.

### Modification de `WeatherProvider` (provider.ts)

3 modes :
- `fixture` — grille statique (dev/test, inchangé)
- `noaa-single` — une seule run active, pas de blend (état stable)
- `noaa-blending` — deux runs actives, blend en cours

### Cycle de vie

```
[démarrage]
   │
   ├── Charger la run la plus récente depuis Redis → currentRun
   ├── Si Redis vide → charger depuis le fichier .bin de fallback
   ├── S'abonner à weather:grid:updated
   │
   ▼
[noaa-single] ◄─────────────────────────────┐
   │                                          │
   ├── pub/sub: nouvelle run disponible       │
   ├── Charger depuis Redis → nextRun         │
   ├── blendStart = now()                     │
   │                                          │
   ▼                                          │
[noaa-blending]                               │
   │                                          │
   ├── alpha = (now - blendStart) / 3600s     │
   ├── Chaque tick: lerp(currentRun, nextRun) │
   │                                          │
   ├── alpha >= 1.0 ?                         │
   │   oui → currentRun = nextRun             │
   │         nextRun = null                   │
   │         ──────────────────────────────────┘
   │   non → continuer le blend
```

### Interpolation dans `getForecastAt(lat, lon, t)`

3 niveaux d'interpolation empilés :

1. **Spatiale** — bilinéaire sur la grille 0.25° (déjà implémenté dans grid.ts)
2. **Temporelle** — linéaire entre les deux forecast hours encadrant `t` (amélioration du nearest-neighbor actuel)
3. **Inter-run** (si en mode blending) — lerp entre les résultats des deux runs :

```
pointA = currentRun.interpolate(lat, lon, t)  // étapes 1+2
pointB = nextRun.interpolate(lat, lon, t)      // étapes 1+2
alpha = clamp((now - blendStart) / 3600, 0, 1)

// Vent — blend en composantes cartésiennes
u = lerp(pointA.u, pointB.u, alpha)
v = lerp(pointA.v, pointB.v, alpha)

// Vagues — SWH et MWP en linéaire, MWD en composantes
swh = lerp(pointA.swh, pointB.swh, alpha)
mwp = lerp(pointA.mwp, pointB.mwp, alpha)
mwd_x = lerp(pointA.mwd_x, pointB.mwd_x, alpha)
mwd_y = lerp(pointA.mwd_y, pointB.mwd_y, alpha)
```

Note : MWD est déjà stocké en composantes sin/cos depuis l'ingestion, donc pas de conversion trigonométrique ici.

### Edge cases

- **Nouvelle run pendant un blend en cours** — terminer le blend immédiatement (snap currentRun = nextRun), puis démarrer un nouveau blend vers la nouvelle run
- **Redis down au démarrage** — fallback sur le fichier `.bin` persisté sur disque
- **Game-engine restart pendant un blend** — au redémarrage, charger les deux runs les plus récentes depuis Redis, recalculer alpha depuis les timestamps. Le blend reprend sans interruption visible.

### Impact performance

- Mode `noaa-single` : zéro surcoût par rapport à aujourd'hui
- Mode `noaa-blending` : 1 interpolation supplémentaire par bateau par tick (7 lerps). Pour 500k bateaux à 1 tick/s → ~2ms de CPU. Négligeable.

---

## Section 3 : Endpoint REST pour la visualisation météo

### Rôle

Servir un subset de la grille météo au frontend pour les overlays visuels (particules vent, carte houle).

### Route

```
GET /api/v1/weather/grid?bounds=40,-10,50,0&hours=0,3,6,12,24,48
```

- `bounds` — lat min, lon min, lat max, lon max (zone visible de la carte)
- `hours` — forecast hours demandés (le front décide selon l'horizon temporel du joueur)
- Sans `hours` : seulement f000 (météo actuelle)

### Réponse : ArrayBuffer binaire

```
[Header: 40 bytes]
  - runTimestamp       (uint32)  — timestamp de la run GFS active
  - nextRunExpectedUtc (uint32)  — timestamp estimé de la prochaine run
  - weatherStatus      (uint8)   — 0=stable, 1=blending, 2=delayed
  - padding            (3 bytes) — alignement
  - blendAlpha         (float32) — 0.0 à 1.0, progression du blend
  - latMin, latMax     (float32 × 2)
  - lonMin, lonMax     (float32 × 2)
  - gridStepLat        (float32) — 0.25
  - gridStepLon        (float32) — 0.25
  - numLat, numLon     (uint16 × 2)
  - numHours           (uint16)
  - padding            (2 bytes)

[Body: Float32Array]
  Pour chaque forecast hour :
    Pour chaque point (lat × lon) :
      u, v, swh, mwd_x, mwd_y, mwp  (6 × float32)
```

Note : MWP ajouté pour permettre au frontend d'afficher la période de houle.

### Estimation taille

- Zone Atlantique Nord 40×20° = 80×160 points = 12 800 points
- × 6 floats × 4 bytes = ~307 Ko par forecast hour
- × 6 hours (horizon 48h typique) = ~1.8 Mo
- Acceptable pour un chargement en arrière-plan

### Les données sont déjà blendées

Le game-engine applique le blend inter-run avant de servir. Le frontend n'a jamais à gérer deux grilles — il reçoit toujours une grille unique, cohérente.

### Cache-Control

- **En mode stable** (pas de blend) : `max-age=300` (5 min)
- **Pendant un blend** : `max-age=60` (1 min) pour que le front voie la transition progresser

### Qui sert cet endpoint

Le game-engine Fastify. Il a déjà les grilles en mémoire, pas besoin d'un service séparé.

### Micro-endpoint de statut

```
GET /api/v1/weather/status
```

Réponse JSON légère (~50 bytes) :
```json
{
  "run": 1713340800,
  "next": 1713362400,
  "status": 0,
  "alpha": 0.0
}
```

Utilisé par le prefetch pour détecter un changement de run sans télécharger la grille complète.

---

## Section 4 : UI — Indicateur GFS dans le LayersWidget

### Rôle

Informer le joueur de l'état de la météo GFS via un texte simple.

### Emplacement

En haut du panneau LayersWidget, avant les toggles vent/houle.

### Affichage

3 états possibles, texte uniquement :

**Stable :**
```
Météo GFS : maj 12z (il y a 2h)
Prochaine mise à jour dans ~4h
```

**Blend en cours :**
```
Météo GFS : mise à jour en cours...
```

**NOAA en retard :**
```
Météo GFS : maj 06z (il y a 8h)
Prochaine mise à jour en attente
```

### Source des données

Le micro-endpoint `/api/v1/weather/status` fournit toutes les infos nécessaires (runTimestamp, nextRunExpectedUtc, weatherStatus). Le front calcule les durées relatives ("il y a 2h", "dans ~4h") côté client.

### i18n

Tous les textes passent par next-intl. Les heures sont affichées en UTC (convention météo marine).

---

## Section 5 : Livraison météo au frontend (prefetch en arrière-plan)

### Rôle

Le joueur ne télécharge pas 10 jours de forecast au chargement. Les données sont prefetchées intelligemment en arrière-plan pour que la navigation dans la timeline soit instantanée.

### Phase 1 — Dès l'authentification (hors /play)

- Un hook global (ou Service Worker) lance le chargement de **f000 à f048** en arrière-plan dès que le joueur est authentifié, quelle que soit la page (/marina, /races, /profile...)
- Bounds par défaut : zone de la course active du joueur (ou zone Atlantique Nord si pas de course)
- Stocké dans le WeatherSlice Zustand (persisté via `zustand/middleware` persist)
- Silencieux, aucun impact sur la navigation

### Phase 2 — Sur /play, prefetch du reste

- Dès le montage de la carte, lancement du chargement de **f048 à f240** en arrière-plan
- Le joueur voit immédiatement la météo actuelle + 48h (déjà en cache)
- Les forecast hours lointains arrivent en quelques secondes — transparent
- Les bounds sont ajustés à la vue réelle de la carte

### Invalidation

- Le hook global poll `/api/v1/weather/status` toutes les 5 min
- Si `runTimestamp` a changé → relancer le prefetch en arrière-plan
- Les anciennes données restent affichées jusqu'à ce que les nouvelles soient complètement chargées (pas de flash/spinner)
- Quand les nouvelles données arrivent → swap atomique dans le Zustand store

### Interaction avec la WeatherTimeline

- Quand le joueur glisse le curseur temporel, les données sont déjà en cache → affichage instantané
- Si le joueur demande un horizon pas encore chargé (rare, uniquement +10 jours sur les premières secondes) → chargement à la demande avec un indicateur subtil ("Chargement...")

### WebSocket (tick de jeu)

Indépendant de l'endpoint REST. Le game-engine envoie le `WeatherPoint` du bateau à chaque tick via WebSocket. Le joueur voit toujours le vent correct sur son bateau même si la grille visuelle n'est pas encore chargée.

---

## Résumé de l'architecture

```
NOAA NOMADS (GFS 0.25° + Wave 0.16°)
       │
       ▼
┌──────────────┐     ┌───────────┐
│ weather-     │────▶│   Redis   │
│ engine       │     │ weather:  │
│ (Python,     │     │ grid:     │
│  Docker)     │     │ {runTs}   │
│              │────▶│           │
│ poll 5min    │     └─────┬─────┘
│ retry 3x     │           │ pub/sub
│ persist .bin │           │ weather:grid:updated
└──────────────┘           │
                           ▼
                  ┌─────────────────┐
                  │  game-engine    │
                  │  (Fastify +     │
                  │   tick worker)  │
                  │                 │
                  │ ┌─────────────┐ │
                  │ │ Weather     │ │
                  │ │ Provider    │ │
                  │ │ - blend 1h  │ │
                  │ │ - 3 interp  │ │
                  │ └──────┬──────┘ │
                  │        │        │
                  │   ┌────┴────┐   │
                  │   │         │   │
                  │   ▼         ▼   │
                  │ tick()   REST   │
                  │ WS/boat  /grid  │
                  └───┬────────┬────┘
                      │        │
                      ▼        ▼
                  ┌─────────────────┐
                  │   Frontend      │
                  │                 │
                  │ - Prefetch f048 │
                  │   dès auth      │
                  │ - f240 sur /play│
                  │ - WindOverlay   │
                  │ - SwellOverlay  │
                  │ - LayersWidget  │
                  │   (GFS status)  │
                  └─────────────────┘
```
