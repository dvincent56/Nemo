"""NOAA GFS ingest — continuous polling and ingestion."""

from __future__ import annotations

import calendar
import datetime as dt
import logging
import os
import sys
import time
from pathlib import Path
from typing import Iterable

import numpy as np
import redis as redis_lib
import requests

from .grid_builder import (
    decompose_mwd,
    parse_atmos_grib,
    parse_wave_from_atmos,
    uv_to_components,
)
from .persistence import push_hour_to_redis, push_meta_to_redis
from .poller import check_run_available, pick_target_run, wait_for_run

LOG = logging.getLogger("nemo.weather")

# NOAA Open Data Dissemination Program S3 mirror — free, public, no auth,
# significantly more reliable than nomads.ncep.noaa.gov which is regularly
# saturated. Path structure after the bucket root is identical to the
# nomads /pub/data/nccf/com/gfs/prod/ tree.
NOAA_ATMOS = (
    "https://noaa-gfs-bdp-pds.s3.amazonaws.com/"
    "gfs.{ymd}/{hh}/atmos/gfs.t{hh}z.pgrb2.0p25.f{fff}"
)
NOAA_WAVE = (
    "https://noaa-gfs-bdp-pds.s3.amazonaws.com/"
    "gfs.{ymd}/{hh}/wave/gridded/gfswave.t{hh}z.global.0p25.f{fff}.grib2"
)

# f000–f072 every 3h, f078–f240 every 6h (53 forecast hours)
FORECAST_HOURS: list[int] = list(range(0, 73, 3)) + list(range(78, 241, 6))

TMP_DIR = Path("/tmp/nemo-weather")
FALLBACK_DIR = Path(os.environ.get("WEATHER_FALLBACK_DIR", "/data/weather-fallback"))
MAX_RETRIES = 3
RETRY_BACKOFF = [5, 15, 45]
POLL_CYCLE_SEC = 300


def fetch_grib(url: str, dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    for attempt in range(MAX_RETRIES):
        try:
            LOG.info("downloading %s (attempt %d)", url, attempt + 1)
            with requests.get(url, stream=True, timeout=120) as r:
                r.raise_for_status()
                with open(dest, "wb") as f:
                    for chunk in r.iter_content(chunk_size=1 << 20):
                        f.write(chunk)
            return dest
        except requests.RequestException as e:
            if attempt < MAX_RETRIES - 1:
                wait = RETRY_BACKOFF[attempt]
                LOG.warning("download failed: %s, retrying in %ds", e, wait)
                time.sleep(wait)
            else:
                raise
    return dest


def ingest_run(run: dt.datetime, redis_client: redis_lib.Redis) -> None:
    ymd = run.strftime("%Y%m%d")
    hh = f"{run.hour:02d}"
    run_ts = int(calendar.timegm(run.timetuple()))

    ingested_hours: list[int] = []
    target_lats: np.ndarray | None = None
    target_lons: np.ndarray | None = None

    for fh in FORECAST_HOURS:
        fff = f"{fh:03d}"
        try:
            atmos_url = NOAA_ATMOS.format(ymd=ymd, hh=hh, fff=fff)
            atmos_path = TMP_DIR / f"atmos_{ymd}_{hh}_f{fff}.grib2"
            fetch_grib(atmos_url, atmos_path)
            u10, v10, lats, lons = parse_atmos_grib(atmos_path)

            if target_lats is None:
                target_lats = lats
                target_lons = lons

            u, v = uv_to_components(u10, v10)

            # Download wave GRIB 0.25° (same resolution as atmos, global coverage)
            wave_url = NOAA_WAVE.format(ymd=ymd, hh=hh, fff=fff)
            wave_path = TMP_DIR / f"wave_{ymd}_{hh}_f{fff}.grib2"
            try:
                fetch_grib(wave_url, wave_path)
                wave_result = parse_wave_from_atmos(wave_path)
            except Exception:
                LOG.warning("wave download/parse failed for f%s, filling zeros", fff)
                wave_result = None

            if wave_result is not None:
                swh, mwd_raw, mwp = wave_result
                mwd_sin, mwd_cos = decompose_mwd(mwd_raw)
            else:
                shape = u.shape
                swh = np.zeros(shape, dtype=np.float32)
                mwd_sin = np.zeros(shape, dtype=np.float32)
                mwd_cos = np.ones(shape, dtype=np.float32)
                mwp = np.zeros(shape, dtype=np.float32)

            # Push this hour to Redis immediately (~33 MB per key)
            push_hour_to_redis(run_ts, fh, u, v, swh, mwd_sin, mwd_cos, mwp, redis_client)
            ingested_hours.append(fh)

            # Update meta after each hour so game-engine can start using data immediately
            rows = target_lats.shape[0]
            cols = target_lons.shape[0]
            lat_min = min(float(target_lats[0]), float(target_lats[-1]))
            lat_max = max(float(target_lats[0]), float(target_lats[-1]))
            push_meta_to_redis(
                run_ts=run_ts,
                forecast_hours=list(ingested_hours),
                bbox={"latMin": lat_min, "latMax": lat_max,
                      "lonMin": float(target_lons[0]), "lonMax": float(target_lons[-1])},
                resolution=0.25,
                shape={"rows": rows, "cols": cols},
                redis_client=redis_client,
            )

            atmos_path.unlink(missing_ok=True)
            wave_path.unlink(missing_ok=True)

            LOG.info("ingested f%s (%d/%d)", fff, len(ingested_hours), len(FORECAST_HOURS))

        except Exception:
            LOG.exception("failed to ingest f%s, skipping", fff)
            continue

    if not ingested_hours:
        LOG.error("no forecast hours ingested for run %s, aborting", run.isoformat())
        return

    # Meta already pushed incrementally after each hour
    LOG.info("run %s complete: %d/%d forecast hours", run.isoformat(), len(ingested_hours), len(FORECAST_HOURS))


def main(argv: Iterable[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    redis_url = os.environ.get("REDIS_URL", "redis://localhost:6379")
    redis_client = redis_lib.from_url(redis_url)
    LOG.info("connected to redis at %s", redis_url)

    last_ingested_ts = 0

    while True:
        target = pick_target_run()
        target_ts = int(calendar.timegm(target.timetuple()))

        if target_ts <= last_ingested_ts:
            LOG.debug("run %s already ingested, sleeping %ds", target.isoformat(), POLL_CYCLE_SEC)
            time.sleep(POLL_CYCLE_SEC)
            continue

        if not check_run_available(target):
            LOG.info("run %s not yet available, waiting...", target.isoformat())
            if not wait_for_run(target):
                time.sleep(POLL_CYCLE_SEC)
                continue

        try:
            ingest_run(target, redis_client)
            last_ingested_ts = target_ts
        except Exception:
            LOG.exception("failed to ingest run %s", target.isoformat())

        time.sleep(POLL_CYCLE_SEC)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
