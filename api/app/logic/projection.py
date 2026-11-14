"""LOLA south polar stereographic projection (true scale at the pole, sphere R = 1737.4 km).

x = r sin(lon), y = r cos(lon), r = 2 R tan((90 + lat) / 2): longitude 0 points to +y, 90 E to +x.
This is the projection of every PGDA south-pole product and of the grids in data/grids.
"""
from __future__ import annotations

import numpy as np

from .constants import MOON_R_KM

R_M = MOON_R_KM * 1000.0


def south_polar_xy(lat_deg, lon_deg) -> tuple[np.ndarray, np.ndarray]:
    lat = np.radians(np.asarray(lat_deg, dtype=np.float64))
    lon = np.radians(np.asarray(lon_deg, dtype=np.float64))
    r = 2.0 * R_M * np.tan((np.pi / 2.0 + lat) / 2.0)
    return r * np.sin(lon), r * np.cos(lon)


def south_polar_latlon(x_m, y_m) -> tuple[np.ndarray, np.ndarray]:
    x = np.asarray(x_m, dtype=np.float64)
    y = np.asarray(y_m, dtype=np.float64)
    r = np.hypot(x, y)
    lat = np.degrees(2.0 * np.arctan(r / (2.0 * R_M))) - 90.0
    lon = np.degrees(np.arctan2(x, y))
    return lat, lon


def great_circle_km(lat1_deg, lon1_deg, lat2_deg, lon2_deg) -> np.ndarray:
    """Great-circle distance on the reference sphere (haversine)."""
    p1, p2 = np.radians(lat1_deg), np.radians(lat2_deg)
    dl = np.radians(np.asarray(lon2_deg, dtype=np.float64) - lon1_deg)
    a = np.sin((p2 - p1) / 2.0) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dl / 2.0) ** 2
    return 2.0 * MOON_R_KM * np.arcsin(np.sqrt(np.clip(a, 0.0, 1.0)))
