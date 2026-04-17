from __future__ import annotations

import datetime as dt
import logging
import time

import requests

LOG = logging.getLogger("nemo.weather.poller")

NOAA_CHECK_URL = (
    "https://nomads.ncep.noaa.gov/pub/data/nccf/com/gfs/prod/"
    "gfs.{ymd}/{hh}/atmos/gfs.t{hh}z.pgrb2.0p25.f000"
)

POLL_INTERVAL_SEC = 300
MAX_WAIT_SEC = 6 * 3600


def pick_target_run(now: dt.datetime | None = None) -> dt.datetime:
    now = now or dt.datetime.utcnow()
    anchor = now - dt.timedelta(hours=4)
    hh = (anchor.hour // 6) * 6
    return anchor.replace(hour=hh, minute=0, second=0, microsecond=0)


def check_run_available(run: dt.datetime) -> bool:
    url = NOAA_CHECK_URL.format(ymd=run.strftime("%Y%m%d"), hh=f"{run.hour:02d}")
    try:
        resp = requests.head(url, timeout=30)
        return resp.status_code == 200
    except requests.RequestException:
        return False


def wait_for_run(run: dt.datetime) -> bool:
    start = time.monotonic()
    while time.monotonic() - start < MAX_WAIT_SEC:
        if check_run_available(run):
            LOG.info("run %s is available", run.isoformat())
            return True
        LOG.info("run %s not yet available, retrying in %ds", run.isoformat(), POLL_INTERVAL_SEC)
        time.sleep(POLL_INTERVAL_SEC)
    LOG.warning("run %s not available after %ds, skipping", run.isoformat(), MAX_WAIT_SEC)
    return False
