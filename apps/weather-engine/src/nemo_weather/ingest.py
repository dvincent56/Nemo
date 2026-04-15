"""NOAA GFS ingest — Phase 2 skeleton.

Télécharge les runs GFS atmosphérique et GFS Wave les plus récents, convertit U10/V10
en TWS/TWD, sérialise les plans (TWS, TWD, SWH, MWD, MWP) en Float32Array et pousse
le résultat dans Redis (+ fichier JSON de backup).
"""

from __future__ import annotations

import base64
import datetime as dt
import io
import json
import logging
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import numpy as np
import requests
import xarray as xr

LOG = logging.getLogger("nemo.weather")

NOAA_ATMOS = (
    "https://nomads.ncep.noaa.gov/pub/data/nccf/com/gfs/prod/"
    "gfs.{ymd}/{hh}/atmos/gfs.t{hh}z.pgrb2.0p25.f{fff}"
)
NOAA_WAVE = (
    "https://nomads.ncep.noaa.gov/pub/data/nccf/com/gfs/prod/"
    "gfs.{ymd}/{hh}/wave/gridded/gfswave.t{hh}z.global.0p16.f{fff}.grib2"
)

FORECAST_HOURS = [0, 3, 6, 12, 24, 48, 72, 120, 192, 240]


@dataclass(frozen=True)
class GridMeta:
    run_ts: int
    bbox: dict
    resolution: float
    shape: dict
    forecast_hours: list[int]


def pick_latest_run(now: dt.datetime | None = None) -> dt.datetime:
    """Le run NOAA est publié avec ~4h de délai après son heure d'origine."""
    now = now or dt.datetime.utcnow()
    anchor = now - dt.timedelta(hours=4)
    hh = (anchor.hour // 6) * 6
    return anchor.replace(hour=hh, minute=0, second=0, microsecond=0)


def fetch_grib(url: str, tmp: Path) -> Path:
    tmp.parent.mkdir(parents=True, exist_ok=True)
    LOG.info("download %s", url)
    with requests.get(url, stream=True, timeout=120) as r:
        r.raise_for_status()
        with open(tmp, "wb") as f:
            for chunk in r.iter_content(chunk_size=1 << 20):
                f.write(chunk)
    return tmp


def uv_to_tws_twd(u: np.ndarray, v: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """U10/V10 (m/s) → TWS (kts), TWD (deg compass, d'où vient le vent)."""
    speed_ms = np.sqrt(u * u + v * v)
    tws_kts = speed_ms * 1.94384
    # TWD "from": wind coming from
    twd = (np.degrees(np.arctan2(-u, -v)) + 360.0) % 360.0
    return tws_kts.astype(np.float32), twd.astype(np.float32)


def serialize(arr: np.ndarray) -> str:
    return base64.b64encode(arr.astype(np.float32).tobytes()).decode("ascii")


def build_grid(atmos_ds: xr.Dataset, wave_ds: xr.Dataset, meta: GridMeta) -> dict:
    u10 = atmos_ds["u10"].values
    v10 = atmos_ds["v10"].values
    tws, twd = uv_to_tws_twd(u10, v10)
    swh = wave_ds["swh"].values.astype(np.float32)
    mwd = wave_ds["mwd"].values.astype(np.float32)
    mwp = wave_ds["perpw"].values.astype(np.float32)
    return {
        "runTs": meta.run_ts,
        "bbox": meta.bbox,
        "resolution": meta.resolution,
        "shape": meta.shape,
        "forecastHours": meta.forecast_hours,
        "variables": {
            "tws": serialize(tws),
            "twd": serialize(twd),
            "swh": serialize(swh),
            "mwd": serialize(mwd),
            "mwp": serialize(mwp),
        },
    }


def push_to_redis(grid: dict) -> None:
    import redis  # type: ignore[import-untyped]

    url = os.environ.get("REDIS_URL", "redis://localhost:6379")
    r = redis.from_url(url)
    key = f"weather:grid:{grid['runTs']}"
    r.set(key, json.dumps(grid), ex=6 * 3600)
    r.publish("weather:grid:updated", str(grid["runTs"]))
    LOG.info("pushed to redis key=%s", key)


def main(argv: Iterable[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    LOG.warning("Phase 2 skeleton — full ingest implementation pending")
    run = pick_latest_run()
    LOG.info("would ingest run %s", run.isoformat())
    # TODO Phase 2 finale : itérer FORECAST_HOURS, télécharger, parser, pousser Redis.
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
