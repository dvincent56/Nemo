from __future__ import annotations

import base64
import logging
from pathlib import Path
from typing import Any

import numpy as np
import xarray as xr
from scipy.interpolate import RegularGridInterpolator

LOG = logging.getLogger("nemo.weather.grid_builder")


def uv_to_components(u: np.ndarray, v: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    return u.astype(np.float32), v.astype(np.float32)


def decompose_mwd(mwd_deg: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    rad = np.radians(mwd_deg)
    return np.sin(rad).astype(np.float32), np.cos(rad).astype(np.float32)


def reinterpolate_wave(
    values: np.ndarray,
    src_lats: np.ndarray,
    src_lons: np.ndarray,
    target_lats: np.ndarray,
    target_lons: np.ndarray,
) -> np.ndarray:
    interp = RegularGridInterpolator(
        (src_lats, src_lons), values, method="linear", bounds_error=False, fill_value=None
    )
    grid_lat, grid_lon = np.meshgrid(target_lats, target_lons, indexing="ij")
    pts = np.column_stack([grid_lat.ravel(), grid_lon.ravel()])
    return interp(pts).reshape(len(target_lats), len(target_lons)).astype(np.float32)


def serialize(arr: np.ndarray) -> str:
    return base64.b64encode(arr.astype(np.float32).tobytes()).decode("ascii")


def build_grid_payload(
    *,
    run_ts: int,
    forecast_hours: list[int],
    u_planes: list[np.ndarray],
    v_planes: list[np.ndarray],
    swh_planes: list[np.ndarray],
    mwd_sin_planes: list[np.ndarray],
    mwd_cos_planes: list[np.ndarray],
    mwp_planes: list[np.ndarray],
    bbox: dict[str, float],
    resolution: float,
    shape: dict[str, int],
) -> dict[str, Any]:
    u_all = np.concatenate([p.ravel() for p in u_planes])
    v_all = np.concatenate([p.ravel() for p in v_planes])
    swh_all = np.concatenate([p.ravel() for p in swh_planes])
    mwd_sin_all = np.concatenate([p.ravel() for p in mwd_sin_planes])
    mwd_cos_all = np.concatenate([p.ravel() for p in mwd_cos_planes])
    mwp_all = np.concatenate([p.ravel() for p in mwp_planes])

    return {
        "runTs": run_ts,
        "bbox": bbox,
        "resolution": resolution,
        "shape": shape,
        "forecastHours": forecast_hours,
        "variables": {
            "u": serialize(u_all),
            "v": serialize(v_all),
            "swh": serialize(swh_all),
            "mwdSin": serialize(mwd_sin_all),
            "mwdCos": serialize(mwd_cos_all),
            "mwp": serialize(mwp_all),
        },
    }


def parse_atmos_grib(path: Path) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    ds = xr.open_dataset(path, engine="cfgrib", backend_kwargs={
        "filter_by_keys": {"typeOfLevel": "heightAboveGround", "level": 10},
    })
    # GFS uses u10/v10 or u/v depending on cfgrib version
    u_key = "u10" if "u10" in ds else "u" if "u" in ds else "10u"
    v_key = "v10" if "v10" in ds else "v" if "v" in ds else "10v"
    u10 = ds[u_key].values.astype(np.float32)
    v10 = ds[v_key].values.astype(np.float32)
    lats = ds["latitude"].values
    lons = ds["longitude"].values
    ds.close()
    # GFS stores north-to-south; flip to south-to-north for game-engine
    if lats[0] > lats[-1]:
        lats = lats[::-1]
        u10 = u10[::-1, :]
        v10 = v10[::-1, :]
    return u10, v10, lats, lons


def parse_wave_from_atmos(path: Path) -> tuple[np.ndarray, np.ndarray, np.ndarray] | None:
    """Try to extract wave variables from the atmospheric GRIB (0.25° global).
    GFS pgrb2.0p25 files include wave data at the surface level."""
    import cfgrib
    try:
        datasets = cfgrib.open_datasets(str(path))
    except Exception:
        return None

    swh_names = ("swh", "shww", "htsgw")
    mwd_names = ("mwd", "dirpw", "swdir", "mdww", "mwsdir", "wvdir")
    mwp_names = ("mwp", "mpww", "perpw", "mpts")

    def find_best(names: tuple[str, ...]) -> tuple[np.ndarray, str] | None:
        """Search by name priority first, then dataset order."""
        for name in names:
            for ds in datasets:
                if name in ds:
                    data = ds[name].values
                    while data.ndim > 2:
                        data = data[0]
                    lats = ds["latitude"].values
                    if lats[0] > lats[-1]:
                        data = data[::-1, :]
                    return np.nan_to_num(data, nan=0.0).astype(np.float32), name
        return None

    swh_result = find_best(swh_names)
    mwd_result = find_best(mwd_names)
    mwp_result = find_best(mwp_names)

    swh_data = swh_result[0] if swh_result else None
    mwd_data = mwd_result[0] if mwd_result else None
    mwp_data = mwp_result[0] if mwp_result else None

    if swh_result: LOG.info("wave swh: %s shape=%s", swh_result[1], swh_result[0].shape)
    if mwd_result: LOG.info("wave mwd: %s shape=%s", mwd_result[1], mwd_result[0].shape)
    if mwp_result: LOG.info("wave mwp: %s shape=%s", mwp_result[1], mwp_result[0].shape)

    for ds in datasets:
        ds.close()

    if swh_data is not None and mwd_data is not None and mwp_data is not None:
        return swh_data, mwd_data, mwp_data
    avail = []
    for ds in datasets:
        avail.extend(list(ds.data_vars))
    LOG.warning("wave variables incomplete (swh=%s, mwd=%s, mwp=%s), available: %s",
                swh_data is not None, mwd_data is not None, mwp_data is not None, avail)
    return None
