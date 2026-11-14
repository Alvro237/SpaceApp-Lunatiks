"""Terrain horizon mask: for each azimuth, the highest elevation angle the terrain reaches.

Method (after Mazarico et al. 2011, who used the same idea on 240 m LOLA DEMs): march outward
along each azimuth, read the terrain height at every step, and keep the maximum elevation angle
seen from the observer. Geometry is done in the plane through the Moon's centre, the observer and
the sample, so lunar curvature is exact (no flat-Earth correction and no refraction: airless).

    observer O = (0, R_o),  sample S = (R_s sin(theta), R_s cos(theta))
    elevation  = atan2(R_s cos(theta) - R_o, R_s sin(theta))

with R_o = R + ground + mast, R_s = R + terrain height and theta the angle at the Moon's centre
between the two (distance / R on the reference sphere).
"""
from __future__ import annotations

import warnings
from typing import Callable

import numpy as np

from .config import MOON_RADIUS_KM

R_M = MOON_RADIUS_KM * 1000.0
AZ_STEP_DEG = 0.5
N_AZ = 720
MAX_RANGE_M = 175_000.0   # ~ sqrt(2 R H) for H = 8.8 km, the largest relief near the pole
MASTS_M = (0.0, 2.0, 5.0, 10.0)

HeightFn = Callable[[np.ndarray, np.ndarray], np.ndarray]


def distance_schedule(first_m: float = 10.0, near_limit_m: float = 3_000.0, near_step_m: float = 10.0,
                      growth: float = 1.006, max_m: float = MAX_RANGE_M) -> np.ndarray:
    """Dense linear steps near the site, then geometric growth. The limb dip for a 2 m mast peaks
    at ~2.6 km, so the near field must be sampled at the DEM's own pixel scale."""
    near = np.arange(first_m, near_limit_m, near_step_m)
    far = [near_limit_m]
    while far[-1] < max_m:
        far.append(far[-1] * growth)
    return np.concatenate([near, np.array(far[1:])])


def destination(lat0: float, lon0: float, az: np.ndarray, dist_m: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Great-circle destination on the reference sphere. Inputs in radians, az shape (n_az, 1),
    dist shape (1, n_d). Returns (lat, lon) in radians with shape (n_az, n_d)."""
    delta = dist_m / R_M
    sin_lat = np.sin(lat0) * np.cos(delta) + np.cos(lat0) * np.sin(delta) * np.cos(az)
    lat = np.arcsin(np.clip(sin_lat, -1.0, 1.0))
    lon = lon0 + np.arctan2(np.sin(az) * np.sin(delta) * np.cos(lat0),
                            np.cos(delta) - np.sin(lat0) * sin_lat)
    return lat, (lon + np.pi) % (2 * np.pi) - np.pi


def sample_rays(height_fn: HeightFn, lat_deg: float, lon_deg: float,
                dist_m: np.ndarray | None = None) -> tuple[np.ndarray, np.ndarray]:
    """Terrain heights along all azimuths. Returns (dist_m (n_d,), heights (N_AZ, n_d))."""
    if dist_m is None:
        dist_m = distance_schedule()
    az = np.radians(np.arange(N_AZ) * AZ_STEP_DEG)[:, None]
    lat, lon = destination(np.radians(lat_deg), np.radians(lon_deg), az, dist_m[None, :])
    return dist_m, height_fn(lat, lon)


def horizon_from_heights(dist_m: np.ndarray, heights: np.ndarray, ground_m: float, mast_m: float) -> np.ndarray:
    """Elevation angle of the horizon (degrees) per azimuth for one mast height.

    Samples without data (NaN) are ignored. If every sample of an azimuth is NaN the result is
    NaN, which the caller must treat as "no terrain information"."""
    theta = dist_m / R_M
    r_s = R_M + heights
    r_o = R_M + ground_m + mast_m
    num = r_s * np.cos(theta)[None, :] - r_o
    den = r_s * np.sin(theta)[None, :]
    elev = np.degrees(np.arctan2(num, den))
    with np.errstate(all="ignore"), warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)  # all-NaN rows are reported as NaN
        return np.nanmax(elev, axis=1)


def spherical_horizon_deg(mast_m: float, ground_m: float = 0.0) -> float:
    """Geometric dip of the horizon over a smooth reference sphere (no terrain)."""
    r_o = R_M + ground_m + mast_m
    return float(-np.degrees(np.arccos(np.clip(R_M / r_o, -1, 1))))


def slope_deg(height_fn: HeightFn, lat_deg: float, lon_deg: float, baseline_m: float = 100.0) -> float:
    """Local slope from central differences over ``baseline_m``."""
    lat0, lon0 = np.radians(lat_deg), np.radians(lon_deg)
    half = np.array([[baseline_m / 2.0]])
    pts = {}
    for name, az in (("n", 0.0), ("e", np.pi / 2), ("s", np.pi), ("w", 3 * np.pi / 2)):
        la, lo = destination(lat0, lon0, np.array([[az]]), half)
        pts[name] = float(height_fn(la, lo)[0, 0])
    dzdy = (pts["n"] - pts["s"]) / baseline_m
    dzdx = (pts["e"] - pts["w"]) / baseline_m
    return float(np.degrees(np.arctan(np.hypot(dzdx, dzdy))))


def encode_centideg(horizon_deg: np.ndarray) -> np.ndarray:
    """Int16 hundredths of a degree (0.01 deg resolution; the solar disc is 0.53 deg wide)."""
    return np.round(horizon_deg * 100.0).astype("<i2")
