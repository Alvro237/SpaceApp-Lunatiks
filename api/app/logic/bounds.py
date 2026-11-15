"""Conservative bound on the visibility of the Sun and the Earth over whole tiles of the surface, from the
ephemeris and the elevation range alone: proves where a window criterion must fail, so those tiles are dropped
before any horizon is traced. Pure NumPy, no I/O.

Statement and proof
-------------------

Observer O at radius ``r_o = R + top``, ``top`` = ground height + mast (m). Every terrain point has radius at
least ``r_s = R + h_min``. The engine's skyline in an azimuth is the maximum, over the ray samples ``d_i``
(surface distance), of the elevation of the terrain point at ``d_i`` (``logic.horizon.skyline_from_heights``). The
elevation of a point at central angle ``theta_i = d_i / R`` and radius ``r`` is
``atan((r cos theta_i - r_o) / (r sin theta_i))``, increasing in ``r``. So the skyline is at least
``floor = max_i atan((r_s cos theta_i - r_o) / (r_s sin theta_i))``, whatever the terrain. A body whose highest
point is below ``floor`` is hidden for sure. If the engine had infinite rays this floor tends to
``-arccos(r_s / r_o)`` (the tangent to the lowest sphere), so the same floor is also a physical bound. For a tile,
the local vertical of any cell differs from the tile centre's by at most the central angle ``theta_tile`` of the
half-diagonal, so the elevation of a body at any cell is at most the centre value plus ``theta_tile``.

Possible visibility at a sample: ``el_centre + ang_radius + theta_tile + MARGIN_DEG > floor(top_tile)``, where
``top_tile`` is the highest ground height in and around the tile plus the mast plus ``ELEV_MARGIN_M``, and
``h_min = min(grid minima) - ELEV_MARGIN_M``. If it is false at a sample, no part of the body is visible from any
cell of the tile at that sample, for any terrain consistent with the grids.

Everything derived (upper bound of a visible share, lower bound of a longest hidden run, upper bound of the run
from the start) follows sample by sample on the same time grid as the engine (``engine.time_grid``).

Smooth-sphere results are never bounds (repo rule): this floor is not a smooth sphere, it is the lowest skyline
that any terrain at or above the lowest LOLA height can produce.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .constants import EARTH_R_KM, MOON_R_KM, SUN_R_KM

R_M = MOON_R_KM * 1000.0
ELEV_MARGIN_M = 500.0   # measured: 960 m grid misses up to 329 m of peak and 337 m of floor (spec 3.4); margin above
MARGIN_DEG = 0.05       # angle margin: Earth parallax over a tile (< 0.005 deg at 30 km), float32 ephemeris,
                        # disc sampling of the engine (7 slices), ray sample spacing near the optimum (< 0.001 deg)


def horizon_floor_deg(top_m, h_min_m: float, ray_dist_m: np.ndarray) -> np.ndarray:
    """Lowest skyline (degrees) that terrain at or above h_min_m can give an observer whose eye is top_m above the
    sphere, when the skyline is the maximum over the ray samples ray_dist_m (as skyline_from_heights)."""
    top = np.atleast_1d(np.asarray(top_m, dtype=np.float64))
    theta = np.asarray(ray_dist_m, dtype=np.float64) / R_M
    r_s = R_M + float(h_min_m)
    r_o = R_M + top
    ratio = (r_s * np.cos(theta)[None, :] - r_o[:, None]) / (r_s * np.sin(theta)[None, :])
    return np.degrees(np.arctan(ratio.max(axis=1)))


def unit_vectors(lat_deg, lon_deg) -> np.ndarray:
    la, lo = np.radians(np.asarray(lat_deg, float)), np.radians(np.asarray(lon_deg, float))
    return np.stack([np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)], axis=-1)


def body_elevation_and_radius(up: np.ndarray, body_km: np.ndarray, body_radius_km: float) -> tuple[np.ndarray, np.ndarray]:
    """Centre elevation above the local horizontal of the sphere, and angular radius, degrees, for points with
    unit vectors up (m, 3) on the sphere and body positions body_km (T, 3) from the Moon centre.
    Returns (m, T) arrays. The site position is subtracted (Earth parallax)."""
    pos = up * MOON_R_KM                                   # (m, 3) km
    v = body_km[None, :, :] - pos[:, None, :]              # (m, T, 3)
    dist = np.linalg.norm(v, axis=-1)
    el = np.degrees(np.arcsin(np.clip(np.einsum("mtk,mk->mt", v, up) / dist, -1.0, 1.0)))
    rad = np.degrees(np.arcsin(np.clip(body_radius_km / dist, 0.0, 1.0)))
    return el, rad


def possible_visible(el_deg: np.ndarray, rad_deg: np.ndarray, theta_deg: np.ndarray, floor_deg: np.ndarray) -> np.ndarray:
    """(m, T) True where some part of the body may be visible from some cell of the tile."""
    return el_deg + rad_deg + theta_deg[:, None] + MARGIN_DEG > floor_deg[:, None]


def longest_run(flags: np.ndarray) -> np.ndarray:
    """Longest run of True along the last axis (samples), per row."""
    f = np.asarray(flags, dtype=bool)
    idx = np.arange(f.shape[-1])
    last_false = np.maximum.accumulate(np.where(~f, idx, -1), axis=-1)
    return np.where(f, idx - last_false, 0).max(axis=-1)


def run_from_start(flags: np.ndarray) -> np.ndarray:
    """Samples from the start until the first False, per row (all when never False, 0 when it starts False)."""
    f = np.asarray(flags, dtype=bool)
    return np.where(f.all(axis=-1), f.shape[-1], np.argmin(f, axis=-1))


@dataclass(frozen=True)
class TileBounds:
    """Per tile (arrays of length m). Upper bounds (ub) can only overestimate the true value at any cell of the
    tile, lower bounds (lb) only underestimate it."""
    sun_share_ub: np.ndarray
    dark_lb_h: np.ndarray
    light_left_ub_h: np.ndarray
    earth_share_ub: np.ndarray
    blackout_lb_h: np.ndarray
    contact_left_ub_h: np.ndarray
    both_share_ub: np.ndarray
    sun_el0_min: np.ndarray
    sun_el0_max: np.ndarray
    earth0_possible: np.ndarray


def tile_bounds(lat_deg: np.ndarray, lon_deg: np.ndarray, theta_deg: np.ndarray, top_m: np.ndarray, h_min_m: float,
                ray_dist_sets: list[np.ndarray], sun_km: np.ndarray, earth_km: np.ndarray, step_h: float,
                chunk: int = 4000) -> TileBounds:
    """Bounds for m tiles (centre lat/lon, half-diagonal central angle theta_deg, highest eye height top_m with the
    mast and the margin already added) over T samples (sun_km, earth_km: (T, 3) km). The floor is the lowest over
    every ray sample set the engine may use (ray_dist_sets). NaN top_m -> no bound (everything possible)."""
    m = lat_deg.size
    chunk = min(chunk, max(1, 40_000_000 // (3 * sun_km.shape[0])))
    out = {k: np.empty(m) for k in ("ss", "dk", "ll", "es", "bo", "cl", "bs", "e0n", "e0x")}
    e0p = np.empty(m, dtype=bool)
    for a in range(0, m, chunk):
        s = slice(a, min(m, a + chunk))
        up = unit_vectors(lat_deg[s], lon_deg[s])
        th = np.asarray(theta_deg[s], float)
        top = np.asarray(top_m[s], float)
        known = ~np.isnan(top)
        floor = np.full(top.shape, -90.0)
        if known.any():
            floor[known] = np.min([horizon_floor_deg(top[known], h_min_m, d) for d in ray_dist_sets], axis=0)
        el_s, r_s = body_elevation_and_radius(up, sun_km, SUN_R_KM)
        el_e, r_e = body_elevation_and_radius(up, earth_km, EARTH_R_KM)
        ps = possible_visible(el_s, r_s, th, floor)
        pe = possible_visible(el_e, r_e, th, floor)
        out["ss"][s] = ps.mean(axis=1)
        out["dk"][s] = longest_run(~ps) * step_h
        out["ll"][s] = run_from_start(ps) * step_h
        out["es"][s] = pe.mean(axis=1)
        out["bo"][s] = longest_run(~pe) * step_h
        out["cl"][s] = run_from_start(pe) * step_h
        out["bs"][s] = (ps & pe).mean(axis=1)
        out["e0n"][s] = el_s[:, 0] - th - MARGIN_DEG
        out["e0x"][s] = el_s[:, 0] + th + MARGIN_DEG
        e0p[s] = pe[:, 0]
    return TileBounds(out["ss"], out["dk"], out["ll"], out["es"], out["bo"], out["cl"], out["bs"], out["e0n"],
                      out["e0x"], e0p)
