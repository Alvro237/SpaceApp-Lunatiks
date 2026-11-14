"""The Moon as seen from a ground station on the Earth: azimuth, elevation and the station's elevation limit.

Pure functions over NumPy arrays: no files, no network, no FastAPI.

Method
    The pipeline stores the geocentric Moon vector in the Earth-fixed frame ITRF93 (light time and stellar aberration
    corrected, hourly). For any antenna, catalogue or user-defined:

    1. its ECEF vector from geodetic coordinates (WGS84 ellipsoid),
    2. direction to the Moon = Moon vector minus antenna vector (topocentric parallax, up to about 1 deg),
    3. projection on the antenna's local east / north / up basis (east, north from the geodetic latitude and longitude;
       up is the ellipsoid normal): elevation = asin(d . up / |d|), azimuth = atan2(d . east, d . north).

    The result is compared with the antenna's elevation limit at that azimuth: a single number, or a per-azimuth
    mask (DSN, JAXA), interpolated linearly with wrap-around at 360 degrees.

Convention: azimuth clockwise from north, degrees. Times are Unix milliseconds.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .ephemeris import OutOfCoverage

WGS84_A_KM = 6378.137
WGS84_F = 1.0 / 298.257223563
WGS84_E2 = WGS84_F * (2.0 - WGS84_F)


def geodetic_to_ecef_km(lat_deg: float, lon_deg: float, height_m: float = 0.0) -> np.ndarray:
    """Earth-fixed position (km) of a point given by geodetic latitude, longitude and ellipsoidal height (WGS84)."""
    lat, lon = np.radians(lat_deg), np.radians(lon_deg)
    n = WGS84_A_KM / np.sqrt(1.0 - WGS84_E2 * np.sin(lat) ** 2)       # prime-vertical radius of curvature
    h = height_m / 1000.0
    return np.array([(n + h) * np.cos(lat) * np.cos(lon),
                     (n + h) * np.cos(lat) * np.sin(lon),
                     (n * (1.0 - WGS84_E2) + h) * np.sin(lat)])


def enu_basis(lat_deg: float, lon_deg: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """East, north and up (ellipsoid normal) unit vectors in the Earth-fixed frame."""
    lat, lon = np.radians(lat_deg), np.radians(lon_deg)
    east = np.array([-np.sin(lon), np.cos(lon), 0.0])
    north = np.array([-np.sin(lat) * np.cos(lon), -np.sin(lat) * np.sin(lon), np.cos(lat)])
    up = np.array([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)])
    return east, north, up


def moon_az_el(moon_ecef_km: np.ndarray, lat_deg: float, lon_deg: float, height_m: float = 0.0):
    """Azimuth and elevation (degrees) of the Moon from an antenna, for each geocentric Moon vector (n, 3)."""
    moon = np.atleast_2d(np.asarray(moon_ecef_km, dtype=np.float64))
    d = moon - geodetic_to_ecef_km(lat_deg, lon_deg, height_m)
    east, north, up = enu_basis(lat_deg, lon_deg)
    norm = np.linalg.norm(d, axis=1)
    el = np.degrees(np.arcsin(np.clip((d @ up) / norm, -1.0, 1.0)))
    az = np.degrees(np.arctan2(d @ east, d @ north)) % 360.0
    return az, el


def limit_at(az_deg, limit, step_deg: float | None = None) -> np.ndarray:
    """Elevation limit (degrees) in the direction ``az_deg``.

    ``limit`` is a number (the same limit in every direction) or an array of values at azimuths 0, step, 2 step, ...,
    360 - step (a mask). A ``None`` limit means the antenna has none defined for that use: NaN is returned.
    """
    az = np.atleast_1d(np.asarray(az_deg, dtype=np.float64))
    if limit is None:
        return np.full(az.shape, np.nan)
    if np.isscalar(limit):
        return np.full(az.shape, float(limit))
    values = np.asarray(limit, dtype=np.float64)
    if step_deg is None:
        raise ValueError("a per-azimuth mask needs its azimuth step")
    x = (az % 360.0) / step_deg
    i = np.floor(x).astype(np.int64) % values.size
    f = x - np.floor(x)
    return values[i] + (values[(i + 1) % values.size] - values[i]) * f


def sees_moon(az_deg, el_deg, limit, step_deg: float | None = None) -> np.ndarray:
    """True where the Moon is at or above the antenna's elevation limit. NaN limit (undefined) gives False."""
    lim = limit_at(az_deg, limit, step_deg)
    return np.asarray(el_deg) >= lim


@dataclass(frozen=True)
class MoonEcefTable:
    """Hourly geocentric Moon vectors in the Earth-fixed frame, with 4-point cubic Lagrange interpolation
    (the same scheme as the Sun/Earth tables)."""
    start_ms: int
    step_s: int
    data: np.ndarray          # (count, 3) float32, km

    @property
    def count(self) -> int:
        return self.data.shape[0]

    @property
    def end_ms(self) -> int:
        return self.start_ms + (self.count - 1) * self.step_s * 1000

    def covers(self, t_ms: float) -> bool:
        return self.start_ms <= t_ms <= self.end_ms

    def positions(self, t_ms) -> np.ndarray:
        t = np.atleast_1d(np.asarray(t_ms, dtype=np.float64))
        if t.size and (t.min() < self.start_ms or t.max() > self.end_ms):
            bad = float(t[(t < self.start_ms) | (t > self.end_ms)][0])
            raise OutOfCoverage(f"time {bad:.0f} ms (Unix) is outside the Moon table [{self.start_ms}, {self.end_ms}]")
        u = (t - self.start_ms) / (self.step_s * 1000.0)
        s0 = np.clip(np.floor(u).astype(np.int64) - 1, 0, self.count - 4)
        f = u - (s0 + 1)
        w0 = -f * (f - 1) * (f - 2) / 6
        w1 = (f + 1) * (f - 1) * (f - 2) / 2
        w2 = -(f + 1) * f * (f - 2) / 2
        w3 = (f + 1) * f * (f - 1) / 6
        d = self.data
        return (w0[:, None] * d[s0] + w1[:, None] * d[s0 + 1] + w2[:, None] * d[s0 + 2] + w3[:, None] * d[s0 + 3])
