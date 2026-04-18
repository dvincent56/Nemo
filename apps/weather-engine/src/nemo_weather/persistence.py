from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

import base64
import numpy as np

LOG = logging.getLogger("nemo.weather.persistence")

REDIS_TTL_SEC = 24 * 3600


def serialize(arr: np.ndarray) -> str:
    return base64.b64encode(arr.astype(np.float32).tobytes()).decode("ascii")


def push_hour_to_redis(
    run_ts: int,
    hour: int,
    u: np.ndarray,
    v: np.ndarray,
    swh: np.ndarray,
    mwd_sin: np.ndarray,
    mwd_cos: np.ndarray,
    mwp: np.ndarray,
    redis_client: Any,
) -> None:
    """Push a single forecast hour to Redis (~33 MB per key)."""
    key = f"weather:grid:{run_ts}:f{hour:03d}"
    data = json.dumps({
        "u": serialize(u),
        "v": serialize(v),
        "swh": serialize(swh),
        "mwdSin": serialize(mwd_sin),
        "mwdCos": serialize(mwd_cos),
        "mwp": serialize(mwp),
    })
    redis_client.set(key, data, ex=REDIS_TTL_SEC)
    LOG.info("pushed hour f%03d to redis (%d bytes)", hour, len(data))


def push_meta_to_redis(
    run_ts: int,
    forecast_hours: list[int],
    bbox: dict[str, float],
    resolution: float,
    shape: dict[str, int],
    redis_client: Any,
) -> None:
    """Push run metadata + notify subscribers."""
    key = f"weather:grid:{run_ts}"
    meta = {
        "runTs": run_ts,
        "bbox": bbox,
        "resolution": resolution,
        "shape": shape,
        "forecastHours": forecast_hours,
    }
    redis_client.set(key, json.dumps(meta), ex=REDIS_TTL_SEC)
    redis_client.publish("weather:grid:updated", str(run_ts))
    LOG.info("pushed meta to redis key=%s, %d hours, notified subscribers", key, len(forecast_hours))


def save_to_disk(grid: dict[str, Any], directory: Path) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    for old in directory.glob("weather-grid-*.json"):
        old.unlink()
    path = directory / f"weather-grid-{grid['runTs']}.json"
    path.write_text(json.dumps(grid))
    LOG.info("saved to disk %s", path)
    return path


def load_from_disk(directory: Path) -> dict[str, Any] | None:
    files = sorted(directory.glob("weather-grid-*.json"))
    if not files:
        return None
    latest = files[-1]
    LOG.info("loading from disk %s", latest)
    return json.loads(latest.read_text())
