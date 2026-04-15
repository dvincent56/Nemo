# Nemo — Weather Engine

Pipeline NOAA GFS → Redis. Cron 6h.

## Flux

1. Téléchargement **GFS atmosphérique 0.25°** (variables U10, V10 en GRIB2) depuis `https://nomads.ncep.noaa.gov/pub/data/nccf/com/gfs/prod/gfs.YYYYMMDD/HH/atmos/`.
2. Téléchargement **GFS Wave 0.16°** (SWH, MWD, MWP) depuis `https://nomads.ncep.noaa.gov/pub/data/nccf/com/gfs/prod/gfs.YYYYMMDD/HH/wave/gridded/`.
3. Parsing `cfgrib` + `xarray` → conversion U/V → TWS/TWD.
4. Sérialisation en Float32Array par plan (TWS, TWD, SWH, MWD, MWP) + métadonnées grille.
5. Publication :
   - Fichier JSON `weather/grid-{runTs}.json` (consommé par fixture dev)
   - Clé Redis `weather:grid:{runTs}` (BYTES, ~50MB) + pub/sub `weather:grid:updated`
6. Les shards du Game Engine s'abonnent à `weather:grid:updated` et rechargent la grille en mémoire.

## Fréquence

4 runs NOAA/jour (00h, 06h, 12h, 18h UTC). Cron : `0 */6 * * *`.

## Format du grid JSON

```json
{
  "runTs": 1744588800,
  "bbox": { "latMin": -90, "latMax": 90, "lonMin": -180, "lonMax": 180 },
  "resolution": 0.25,
  "shape": { "rows": 721, "cols": 1440 },
  "forecastHours": [0, 3, 6, 12, 24, 48, 72, 120, 192, 240],
  "variables": {
    "tws": "<base64 Float32Array rows*cols*forecastHours>",
    "twd": "...",
    "swh": "...",
    "mwd": "...",
    "mwp": "..."
  }
}
```

## Fixture de développement

Pour le développement et les tests sans NOAA ni Redis, utiliser `fixtures/grid-fixture.json` (voir `packages/shared-types`). Le game-engine bascule automatiquement en fixture mode si `NEMO_WEATHER_MODE=fixture`.

## Dépendances système

- `libeccodes-dev` (parsing GRIB2 — installer via apt/homebrew)
- Python 3.11+

## Stub Phase 2

Le script `src/nemo_weather/ingest.py` est un squelette — la logique NOAA complète sera finalisée en Phase 2 sprint final. Pour le moment, le game-engine consomme soit Redis (si dispo), soit la fixture JSON.
