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
    u10 = ds["u10"].values.astype(np.float32)
    v10 = ds["v10"].values.astype(np.float32)
    lats = ds["latitude"].values
    lons = ds["longitude"].values
    ds.close()
    return u10, v10, lats, lons


def parse_wave_grib(
    path: Path, target_lats: np.ndarray, target_lons: np.ndarray
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    ds = xr.open_dataset(path, engine="cfgrib")
    wave_lats = ds["latitude"].values
    wave_lons = ds["longitude"].values
    swh = reinterpolate_wave(ds["swh"].values, wave_lats, wave_lons, target_lats, target_lons)
    mwd = reinterpolate_wave(ds["mwd"].values, wave_lats, wave_lons, target_lats, target_lons)
    mwp = reinterpolate_wave(ds["perpw"].values, wave_lats, wave_lons, target_lats, target_lons)
    ds.close()
    return swh, mwd, mwp
