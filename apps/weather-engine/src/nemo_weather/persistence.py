from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

LOG = logging.getLogger("nemo.weather.persistence")

REDIS_TTL_SEC = 24 * 3600


def push_to_redis(grid: dict[str, Any], redis_client: Any) -> None:
    run_ts = grid["runTs"]
    key = f"weather:grid:{run_ts}"
    redis_client.set(key, json.dumps(grid), ex=REDIS_TTL_SEC)
    redis_client.publish("weather:grid:updated", str(run_ts))
    LOG.info("pushed to redis key=%s (TTL=%ds)", key, REDIS_TTL_SEC)


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
