"""How much of the Sun the Earth covers, as seen from the site (solar eclipse seen from the Moon).

Obscuration = overlap area of the two discs / area of the solar disc, with both discs flat in the small-angle
approximation (both are under 1 degree in radius) and a uniformly bright Sun (no limb darkening). The Earth's
atmosphere is ignored. The directions come from the engine's azimuth and elevation (inputs), so this module adds
no ephemeris of its own.

Circle-circle overlap (radii r, R, centre separation d):
    A = r^2 acos((d^2 + r^2 - R^2) / (2 d r)) + R^2 acos((d^2 + R^2 - r^2) / (2 d R))
        - 0.5 sqrt((-d + r + R)(d + r - R)(d - r + R)(d + r + R))
with the limits A = 0 for d >= r + R and A = pi min(r, R)^2 for d <= |R - r|.

Pure functions over NumPy arrays: no files, no network, no FastAPI.
"""
from __future__ import annotations

import numpy as np

from .constants import DEG


def unit_from_az_el(az_deg: np.ndarray, el_deg: np.ndarray) -> np.ndarray:
    """Local east-north-up unit vectors from azimuth (clockwise from north) and elevation, degrees."""
    az, el = np.asarray(az_deg) * DEG, np.asarray(el_deg) * DEG
    return np.stack([np.cos(el) * np.sin(az), np.cos(el) * np.cos(az), np.sin(el)], axis=-1)


def separation_deg(az1, el1, az2, el2) -> np.ndarray:
    a, b = unit_from_az_el(az1, el1), unit_from_az_el(az2, el2)
    return np.degrees(np.arccos(np.clip(np.sum(a * b, axis=-1), -1.0, 1.0)))


def disc_overlap_fraction(sep_deg, r_sun_deg, r_earth_deg) -> np.ndarray:
    """Fraction of the solar disc covered by the Earth's disc, 0..1."""
    d = np.atleast_1d(np.asarray(sep_deg, dtype=np.float64))
    r = np.broadcast_to(np.asarray(r_sun_deg, dtype=np.float64), d.shape)
    R = np.broadcast_to(np.asarray(r_earth_deg, dtype=np.float64), d.shape)
    out = np.zeros_like(d)
    inside = d <= np.abs(R - r)
    out[inside] = (np.minimum(r, R)[inside] / r[inside]) ** 2
    part = ~inside & (d < r + R)
    if part.any():
        dp, rp, Rp = d[part], r[part], R[part]
        a1 = rp ** 2 * np.arccos(np.clip((dp ** 2 + rp ** 2 - Rp ** 2) / (2 * dp * rp), -1, 1))
        a2 = Rp ** 2 * np.arccos(np.clip((dp ** 2 + Rp ** 2 - rp ** 2) / (2 * dp * Rp), -1, 1))
        k = (-dp + rp + Rp) * (dp + rp - Rp) * (dp - rp + Rp) * (dp + rp + Rp)
        out[part] = (a1 + a2 - 0.5 * np.sqrt(np.maximum(k, 0.0))) / (np.pi * rp ** 2)
    return np.clip(out, 0.0, 1.0)


def obscuration(series) -> np.ndarray:
    """Obscuration of the Sun by the Earth at every sample of an engine ``Series``, 0..1."""
    sep = separation_deg(series.sun_az, series.sun_el, series.earth_az, series.earth_el)
    return disc_overlap_fraction(sep, series.sun_radius_deg, series.earth_radius_deg)
