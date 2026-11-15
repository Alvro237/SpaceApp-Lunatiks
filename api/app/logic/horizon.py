"""Horizon profile: elevation angle of the skyline per azimuth."""
from __future__ import annotations

import numpy as np

from .constants import MOON_R_KM


class HorizonProfile:
    """Elevation (degrees) of the horizon per azimuth, azimuth clockwise from north, evenly spaced
    starting at 0. ``kind`` records where it came from: "terrain" (LOLA ray-marched mask) or
    "smooth_sphere" (geometric dip only)."""

    def __init__(self, values: np.ndarray, kind: str = "terrain"):
        self.values = np.asarray(values, dtype=np.float64)
        self.kind = kind
        self.az_step_deg = 360.0 / self.values.size
        self.min = float(self.values.min())
        self.max = float(self.values.max())

    @property
    def is_flat(self) -> bool:
        return self.max - self.min < 1e-9

    def at(self, az_deg) -> np.ndarray:
        """Linear interpolation, wrapping at 360 degrees."""
        n = self.values.size
        x = (np.asarray(az_deg, dtype=np.float64) / self.az_step_deg) % n
        i = np.floor(x).astype(np.int64) % n
        f = x - np.floor(x)
        a = self.values[i]
        b = self.values[(i + 1) % n]
        return a + (b - a) * f


def spherical_horizon_deg(mast_m: float, ground_m: float = 0.0) -> float:
    """Geometric dip of the horizon over a smooth reference sphere, degrees (negative or zero)."""
    ro = MOON_R_KM * 1000.0 + ground_m + mast_m
    return -float(np.degrees(np.arccos(min(1.0, MOON_R_KM * 1000.0 / ro))))


def flat_profile(deg: float, n: int = 720) -> HorizonProfile:
    return HorizonProfile(np.full(n, deg), kind="smooth_sphere")


def decode_centideg(raw: np.ndarray) -> np.ndarray:
    """int16 hundredths of a degree (the pipeline's storage unit) to degrees."""
    return np.asarray(raw, dtype=np.float64) / 100.0


# ---------------------------------------------------------------------------- ray-traced horizon for any point
#
# Method (after Mazarico et al. 2011, and the pipeline's lunarnav.horizon for the catalogue sites): march outward
# along each azimuth on the reference sphere, read the terrain height at every step, and keep the highest elevation
# angle seen from the observer. The geometry is done in the plane through the Moon's centre, the observer and the
# sample, so the Moon's curvature is exact (no flat-ground correction, no refraction: airless):
#
#     observer O = (0, R_o),  sample S = (R_s sin(theta), R_s cos(theta))
#     elevation  = atan2(R_s cos(theta) - R_o, R_s sin(theta))
#
# with R_o = R + ground + mast, R_s = R + terrain height and theta = distance / R the angle at the Moon's centre.
# A sample without terrain data is skipped; an azimuth with none at all keeps the smooth-sphere dip.

R_M = MOON_R_KM * 1000.0
RAY_AZIMUTHS = 720
RAY_MAX_RANGE_M = 250_000.0     # a 10 km rise above the observer still clears the limb at sqrt(2 R H) ~ 186 km
RAY_GROWTH = 1.008              # geometric step beyond the near field: under one DEM cell at 100 km for 960 m cells


def ray_distances(cell_m: float, max_m: float = RAY_MAX_RANGE_M, growth: float = RAY_GROWTH) -> np.ndarray:
    """Distances along each ray, metres: quarter-cell steps over the first five cells (where the slope under the
    observer decides the skyline), then geometric growth (the far terrain spans less angle per metre)."""
    near_step = cell_m / 4.0
    near_end = 5.0 * cell_m
    near = np.arange(near_step, near_end, near_step)
    far = [near_end]
    while far[-1] < max_m:
        far.append(far[-1] * growth)
    return np.concatenate([near, np.asarray(far)])


def destination(lat0_rad: float, lon0_rad: float, az_rad: np.ndarray, dist_m: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Great-circle destination on the reference sphere (radians). az shape (n_az, 1), dist shape (1, n_d)."""
    delta = dist_m / R_M
    sin_lat = np.sin(lat0_rad) * np.cos(delta) + np.cos(lat0_rad) * np.sin(delta) * np.cos(az_rad)
    lat = np.arcsin(np.clip(sin_lat, -1.0, 1.0))
    lon = lon0_rad + np.arctan2(np.sin(az_rad) * np.sin(delta) * np.cos(lat0_rad), np.cos(delta) - np.sin(lat0_rad) * sin_lat)
    return lat, (lon + np.pi) % (2 * np.pi) - np.pi


def destination_south_polar_xy(lat0_rad: float, lon0_rad: float, az_rad: np.ndarray, dist_m: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """destination() straight to south polar stereographic x, y (metres), with no inverse trigonometry: the same
    great-circle point, r = 2 R cos(lat) / (1 - sin(lat)), longitude rotated by the bearing's (X, Y) components.
    For tracing many rays over the polar grids (area search)."""
    delta = dist_m / R_M
    s0, c0 = np.sin(lat0_rad), np.cos(lat0_rad)
    sd, cd = np.sin(delta), np.cos(delta)
    sin_lat = np.clip(s0 * cd + c0 * sd * np.cos(az_rad), -1.0, 1.0)
    yy = np.sin(az_rad) * sd * c0
    xx = cd - s0 * sin_lat
    h = np.hypot(xx, yy)
    h = np.where(h == 0.0, 1.0, h)
    sl, cl = np.sin(lon0_rad), np.cos(lon0_rad)
    sin_lon = (sl * xx + cl * yy) / h
    cos_lon = (cl * xx - sl * yy) / h
    r = 2.0 * R_M * np.sqrt(np.maximum(0.0, 1.0 - sin_lat * sin_lat)) / (1.0 - sin_lat + 1e-300)
    return r * sin_lon, r * cos_lon


def skyline_from_heights(dist_m: np.ndarray, heights: np.ndarray, ground_m: float, mast_m: float) -> np.ndarray:
    """horizon_from_heights() without the terrain range: the skyline (degrees) per azimuth. The elevation is
    atan2(a, b) with b = r_s sin(theta) > 0, monotonic in a / b, so the maximum is taken on the ratio and one arctan
    per azimuth is enough. Azimuths with no data at all get the smooth-sphere dip."""
    theta = dist_m / R_M
    r_s = R_M + heights
    r_o = R_M + ground_m + mast_m
    ratio = (r_s * np.cos(theta)[None, :] - r_o) / (r_s * np.sin(theta)[None, :])
    best = np.max(np.where(np.isnan(ratio), -np.inf, ratio), axis=1)
    dip = spherical_horizon_deg(mast_m, ground_m)
    return np.where(np.isfinite(best), np.degrees(np.arctan(best)), dip)


def horizon_from_heights(dist_m: np.ndarray, heights: np.ndarray, ground_m: float, mast_m: float) -> tuple[np.ndarray, np.ndarray]:
    """Skyline elevation (degrees) per azimuth and the farthest distance with terrain data per azimuth (metres).

    heights: (n_az, n_d) terrain heights above the reference sphere, NaN where there is no data."""
    theta = dist_m / R_M
    r_s = R_M + heights
    r_o = R_M + ground_m + mast_m
    elev = np.degrees(np.arctan2(r_s * np.cos(theta)[None, :] - r_o, r_s * np.sin(theta)[None, :]))
    valid = ~np.isnan(elev)
    dip = spherical_horizon_deg(mast_m, ground_m)
    out = np.where(valid.any(axis=1), np.max(np.where(valid, elev, -90.0), axis=1), dip)
    last = np.where(valid.any(axis=1), dist_m[np.where(valid, np.arange(dist_m.size)[None, :], 0).max(axis=1)], 0.0)
    return out, last


def ray_traced_horizon(heights_at, lat_deg: float, lon_deg: float, ground_m: float, mast_m: float, cell_m: float,
                       n_az: int = RAY_AZIMUTHS, max_range_m: float = RAY_MAX_RANGE_M) -> tuple[HorizonProfile, float]:
    """Terrain skyline of any point from a height field, and the shortest terrain range over all azimuths (metres:
    below max_range_m the DEM ends before the ray does, so far terrain in that direction is missing).

    heights_at(lat_rad, lon_rad) -> metres above the 1737.4 km sphere, NaN without data (any array shape)."""
    dist = ray_distances(cell_m, max_range_m)
    az = np.radians(np.arange(n_az) * (360.0 / n_az))[:, None]
    lat, lon = destination(np.radians(lat_deg), np.radians(lon_deg), az, dist[None, :])
    values, last = horizon_from_heights(dist, heights_at(lat, lon), ground_m, mast_m)
    return HorizonProfile(values, kind="terrain"), float(last.min())
