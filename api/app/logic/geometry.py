"""Site frame and direction to a body. Pure NumPy, vectorised over time."""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .constants import AU_KM, DEG, MOON_R_KM, SOLAR_CONSTANT_W_M2


@dataclass(frozen=True)
class SiteFrame:
    """Local frame at a surface point, vectors in MOON_ME."""
    pos_km: np.ndarray   # site position from the Moon centre
    east: np.ndarray
    north: np.ndarray
    up: np.ndarray


def site_frame(lat_deg: float, lon_deg: float, height_km: float = 0.0) -> SiteFrame:
    """A spherical reference (R = 1737.4 km) is exact here: Horizons' "geodetic" site on a sphere
    equals the planetocentric one. Height is above that sphere."""
    lat, lon = lat_deg * DEG, lon_deg * DEG
    cl, sl, co, so = np.cos(lat), np.sin(lat), np.cos(lon), np.sin(lon)
    up = np.array([cl * co, cl * so, sl])
    return SiteFrame(pos_km=(MOON_R_KM + height_km) * up, east=np.array([-so, co, 0.0]),
                     north=np.array([-sl * co, -sl * so, cl]), up=up)


@dataclass(frozen=True)
class BodyDirection:
    az: np.ndarray       # degrees clockwise from north, 0..360
    el: np.ndarray       # elevation of the body centre above the local horizontal, degrees
    dist_km: np.ndarray  # distance from the site
    unit: np.ndarray     # (n, 3) unit vectors from the site to the body, MOON_ME


def body_direction(body_km: np.ndarray, frame: SiteFrame) -> BodyDirection:
    """Direction to a body given its Moon-centre vectors (n, 3). Always subtracts the site position:
    the Earth's parallax across the lunar surface reaches 0.26 degrees."""
    d = np.atleast_2d(np.asarray(body_km, dtype=np.float64)) - frame.pos_km
    dist = np.linalg.norm(d, axis=1)
    unit = d / dist[:, None]
    e, n, u = unit @ frame.east, unit @ frame.north, unit @ frame.up
    el = np.degrees(np.arcsin(np.clip(u, -1.0, 1.0)))
    az = np.degrees(np.arctan2(e, n)) % 360.0
    return BodyDirection(az=az, el=el, dist_km=dist, unit=unit)


def angular_radius_deg(radius_km: float, dist_km: np.ndarray) -> np.ndarray:
    """Angular radius of a sphere of radius ``radius_km`` seen from ``dist_km``."""
    return np.degrees(np.arcsin(radius_km / np.asarray(dist_km, dtype=np.float64)))


def solar_irradiance_w_m2(sun_dist_km: np.ndarray, solar_constant: float = SOLAR_CONSTANT_W_M2) -> np.ndarray:
    """Irradiance normal to the rays from the actual Sun distance."""
    return solar_constant * (AU_KM / np.asarray(sun_dist_km, dtype=np.float64)) ** 2


def separation_deg(a_unit: np.ndarray, b_unit: np.ndarray) -> np.ndarray:
    """Angular separation between two sets of unit directions (n, 3)."""
    dot = np.einsum("ij,ij->i", a_unit, b_unit)
    cross = np.linalg.norm(np.cross(a_unit, b_unit), axis=1)
    return np.degrees(np.arctan2(cross, dot))
