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


def parse_wave_grib(
    path: Path, target_lats: np.ndarray, target_lons: np.ndarray
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    # GFS Wave GRIB2 contains multiple "datasets" (different grid extents per variable).
    # cfgrib splits them — we need to search across all datasets for our variables.
    import cfgrib
    datasets = cfgrib.open_datasets(str(path))

    swh_names = ("swh", "shts", "htsgw")
    mwd_names = ("mwd", "swdir", "dirpw", "wvdir")
    mwp_names = ("perpw", "mpts", "mpww")

    def find_var(ds_list: list, names: tuple[str, ...]) -> tuple[xr.Dataset, str]:
        for ds in ds_list:
            for name in names:
                if name in ds:
                    return ds, name
        avail = []
        for ds in ds_list:
            avail.extend(list(ds.data_vars))
        raise KeyError(f"none of {names} found, available: {avail}")

    ds_swh, swh_key = find_var(datasets, swh_names)
    ds_mwd, mwd_key = find_var(datasets, mwd_names)
    ds_mwp, mwp_key = find_var(datasets, mwp_names)

    def extract(ds: xr.Dataset, key: str) -> np.ndarray:
        wave_lats = ds["latitude"].values
        wave_lons = ds["longitude"].values
        LOG.info("wave var %s: lats=[%.1f..%.1f] lons=[%.1f..%.1f] shape=%s",
                 key, float(wave_lats[0]), float(wave_lats[-1]),
                 float(wave_lons[0]), float(wave_lons[-1]), ds[key].shape)
        return reinterpolate_wave(ds[key].values, wave_lats, wave_lons, target_lats, target_lons)

    swh = extract(ds_swh, swh_key)
    mwd = extract(ds_mwd, mwd_key)
    mwp = extract(ds_mwp, mwp_key)

    for ds in datasets:
        ds.close()
    return swh, mwd, mwp
