# Nemo — Weather Engine

Continuous NOAA GFS ingestion pipeline. Polls every 5 min, downloads GRIB2,
pushes U/V + wave grids to Redis.

## Architecture

1. Poll NOAA NOMADS for latest GFS run availability (HEAD on f000)
2. Download **53 forecast hours** per run:
   - f000–f072: every 3h (atmospheric 0.25° + wave 0.16°)
   - f078–f240: every 6h
3. Parse GRIB2 via `cfgrib` + `xarray`
4. Re-interpolate wave data (0.16°) to atmospheric grid (0.25°)
5. Store as 6 Float32Array planes: **U, V, SWH, MWD_sin, MWD_cos, MWP**
6. Push to Redis key `weather:grid:{runTs}` (TTL 24h) + pub/sub notification
7. Write latest run to disk as fallback

## Redis Key Format

```json
{
  "runTs": 1713340800,
  "bbox": { "latMin": -90, "latMax": 90, "lonMin": -180, "lonMax": 180 },
  "resolution": 0.25,
  "shape": { "rows": 721, "cols": 1440 },
  "forecastHours": [0, 3, 6, ..., 240],
  "variables": {
    "u": "<base64 Float32Array>",
    "v": "<base64>",
    "swh": "<base64>",
    "mwdSin": "<base64>",
    "mwdCos": "<base64>",
    "mwp": "<base64>"
  }
}
```

## Running

```bash
# Docker (recommended)
docker compose -f docker-compose.dev.yml up weather-engine

# Local
pip install -e .
REDIS_URL=redis://localhost:6379 python -m nemo_weather.ingest
```

## System Dependencies

- `libeccodes-dev` (GRIB2 parsing)
- Python 3.11+
- Redis 7+
