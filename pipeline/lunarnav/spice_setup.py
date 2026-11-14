"""Load the SPICE kernels once and expose small geometry helpers."""
from __future__ import annotations

import numpy as np
import spiceypy as spice

from .config import KERNEL_DIR, KERNELS, MOON_RADIUS_KM

_LOADED = False


def load_kernels() -> None:
    """Furnish all kernels (idempotent). The frame kernel needs the lunar BPC loaded first."""
    global _LOADED
    if _LOADED:
        return
    for role in ("lsk", "pck_constants", "spk", "pck_moon", "fk_moon"):
        path = KERNEL_DIR / KERNELS[role]["file"]
        if not path.exists():
            raise FileNotFoundError(f"{path} missing; run `uv run python -m lunarnav.download`")
        spice.furnsh(str(path))
    _LOADED = True


def site_vector_km(lat_deg: float, lon_deg: float, height_km: float = 0.0) -> np.ndarray:
    """Position of a surface point in MOON_ME. Horizons' geodetic site on a sphere equals the
    planetocentric one, so a spherical reference (R = 1737.4 km) is exact here."""
    lat, lon = np.radians(lat_deg), np.radians(lon_deg)
    r = MOON_RADIUS_KM + height_km
    return r * np.array([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)])


def local_basis(lat_deg: float, lon_deg: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """East, north, up unit vectors at a surface point (MOON_ME)."""
    lat, lon = np.radians(lat_deg), np.radians(lon_deg)
    east = np.array([-np.sin(lon), np.cos(lon), 0.0])
    north = np.array([-np.sin(lat) * np.cos(lon), -np.sin(lat) * np.sin(lon), np.cos(lat)])
    up = np.array([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)])
    return east, north, up


def az_el_deg(vec_from_moon_center_km: np.ndarray, lat_deg: float, lon_deg: float,
              height_km: float = 0.0) -> tuple[float, float]:
    """Azimuth (clockwise from north) and elevation of a body whose Moon-centre vector is given,
    as seen from a surface site. Subtracts the site vector (parallax)."""
    east, north, up = local_basis(lat_deg, lon_deg)
    d = np.asarray(vec_from_moon_center_km, dtype=float) - site_vector_km(lat_deg, lon_deg, height_km)
    d /= np.linalg.norm(d)
    el = np.degrees(np.arcsin(np.clip(d @ up, -1, 1)))
    az = np.degrees(np.arctan2(d @ east, d @ north)) % 360.0
    return float(az), float(el)
