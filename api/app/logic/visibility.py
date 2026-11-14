"""Fraction of a body's disc above the horizon.

The Sun (0.27 deg radius) and the Earth (~0.95 deg radius from the Moon) are discs, not points.
At the lunar poles the Sun grazes the horizon for days, so the visible fraction decides whether
there is power. For a flat horizon the covered part is a circular segment; for real terrain the
horizon varies across the disc, so the disc is cut into vertical slices in azimuth and each slice
uses the horizon at its own azimuth.
"""
from __future__ import annotations

import numpy as np

from .horizon import HorizonProfile


def flat_fraction(d, r) -> np.ndarray:
    """Disc above a straight horizon. d = centre elevation - horizon elevation, r = disc radius
    (same angular units)."""
    d = np.asarray(d, dtype=np.float64)
    r = np.asarray(r, dtype=np.float64)
    x = np.clip(-d / r, -1.0, 1.0)  # horizon offset above the centre, in radii
    return (np.arccos(x) - x * np.sqrt(1.0 - x * x)) / np.pi


def disc_visible_fraction(el_deg, az_deg, r_deg, horizon: HorizonProfile, slices: int = 7) -> np.ndarray:
    """Fraction (0..1) of a disc of angular radius ``r_deg`` centred at (az, el) that is above the horizon."""
    el, az, r = np.broadcast_arrays(np.asarray(el_deg, dtype=np.float64), np.asarray(az_deg, dtype=np.float64),
                                    np.asarray(r_deg, dtype=np.float64))
    if horizon.is_flat:
        return flat_fraction(el - horizon.max, r)
    cos_el = np.maximum(0.05, np.cos(np.radians(el)))
    width = 2.0 * r / slices
    visible = np.zeros(el.shape, dtype=np.float64)
    for k in range(slices):
        x = -r + (k + 0.5) * width                       # offset across the disc, degrees on the sky
        half = np.sqrt(np.maximum(0.0, r * r - x * x))
        hz = horizon.at(az + x / cos_el)                 # azimuth offset = sky offset / cos(el)
        visible += width * np.maximum(0.0, (el + half) - np.maximum(el - half, hz))
    frac = np.minimum(1.0, visible / (np.pi * r * r))
    frac = np.where(el - r >= horizon.max, 1.0, frac)    # whole disc above the highest skyline
    return np.where(el + r <= horizon.min, 0.0, frac)    # whole disc below the lowest skyline


def disc_overlap_fraction(sep, r_target, r_cover) -> np.ndarray:
    """Fraction (0..1) of a target disc of angular radius ``r_target`` hidden by a covering disc of radius
    ``r_cover`` whose centre is ``sep`` away (all in the same angular units). Used for the Earth covering the
    Sun as seen from the Moon (a lunar eclipse seen from the Earth).

    Area of the lens where two circles intersect, divided by the target's area (Weisstein, "Circle-Circle
    Intersection", MathWorld):
        A = r1^2 acos((d^2 + r1^2 - r2^2) / (2 d r1)) + r2^2 acos((d^2 + r2^2 - r1^2) / (2 d r2))
            - 0.5 sqrt((-d + r1 + r2)(d + r1 - r2)(d - r1 + r2)(d + r1 + r2))
    Plane geometry: at radii of about 1 degree the curvature of the sky changes the result by ~1e-4 relative.
    The solar disc is taken as uniformly bright (no limb darkening)."""
    d, r1, r2 = np.broadcast_arrays(np.asarray(sep, dtype=np.float64), np.asarray(r_target, dtype=np.float64),
                                    np.asarray(r_cover, dtype=np.float64))
    out = np.zeros(d.shape, dtype=np.float64)
    inside = d <= np.abs(r2 - r1)                       # one disc entirely inside the other
    out = np.where(inside, np.minimum(1.0, (r2 / r1) ** 2), out)
    lens = (d < r1 + r2) & ~inside
    if np.any(lens):
        dd, a, b = d[lens], r1[lens], r2[lens]
        c1 = np.clip((dd * dd + a * a - b * b) / (2 * dd * a), -1.0, 1.0)
        c2 = np.clip((dd * dd + b * b - a * a) / (2 * dd * b), -1.0, 1.0)
        k = np.maximum(0.0, (-dd + a + b) * (dd + a - b) * (dd - a + b) * (dd + a + b))
        area = a * a * np.arccos(c1) + b * b * np.arccos(c2) - 0.5 * np.sqrt(k)
        out[lens] = np.clip(area / (np.pi * a * a), 0.0, 1.0)
    return out
