"""Validation of the ephemeris visibility bound (app/logic/bounds.py) against real LOLA terrain, by hand:

    cd api
    uv run python tests/validation_bounds.py

Part 1 (safety): for the 13 catalogue terrain sites x 17 zone points (221 LOLA horizon masks, 2 m mast), at every
hourly sample of 2025-2035, the bound must never say "impossible" while the real mask shows any part of the Sun or
the Earth. Part 2 (usefulness): the share of the area south of 60 S the bound proves to fail, by latitude band and
by tile size, compared with the measured table of the specification (section 3.2 of docs/mission-design-spec.md).

Pass criteria: 0 violations for both bodies; smallest margin >= 1.5 degrees; discard shares not higher than the
specification's by more than 3 percentage points (lower is allowed: the final bound is more conservative).
The functions are reused by tests/test_bounds.py (with a coarser time stride).
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db.store import get_store                                      # noqa: E402
from app.logic import bounds as B                                       # noqa: E402
from app.logic.constants import EARTH_R_KM, MOON_R_KM, SUN_R_KM        # noqa: E402
from app.logic.engine import time_grid                                  # noqa: E402
from app.logic.horizon import ray_distances                             # noqa: E402
from app.logic.projection import south_polar_latlon                     # noqa: E402

MAST_ZONE_M = 2.0
PASS_MIN_MARGIN_DEG = 1.5
PASS_SHARE_TOL_PP = 3.0
WINDOW_START_MS = 1_799_539_200_000.0          # 2027-01-10T00:00:00Z
THRESHOLD = 0.70
BANDS = ((60, 70), (70, 80), (80, 85), (85, 88), (88, 90))
TILES_M = (61_440.0, 30_720.0, 7_680.0, 3_840.0)
GRID_M = 960.0

#: specification 3.2 (south of 60 S, window from 2027-01-10, hourly, threshold 70 %), per latitude band, 7.68 km tiles
REF_BANDS = {"sun14": (60.0, 54.5, 26.6, 0.0, 0.0), "sun29": (100.0, 90.9, 4.6, 0.0, 0.0),
             "earth14": (38.3, 30.9, 5.0, 0.0, 0.0), "earth29": (45.4, 43.5, 39.8, 22.4, 0.0)}
#: specification 3.2, whole cap, Sun >= 70 % over 29.53 d, by tile size
REF_TILES = {61_440.0: 77.3, 30_720.0: 82.0, 7_680.0: 86.8, 3_840.0: 87.6}


def ray_sets() -> list[np.ndarray]:
    """The ray sample sets the engine uses: 240 m and 960 m cells, 150 km, 2 % growth."""
    return [ray_distances(240.0, 150_000.0, 1.02), ray_distances(960.0, 150_000.0, 1.02)]


def h_min_m(store) -> float:
    """Lowest height of the elevation grids minus the margin."""
    return min(store.grids.meta(g)["min"] for g in ("lola_elevation_60s", "lola_elevation_80s")) - B.ELEV_MARGIN_M


def body_vectors(store, stride: int = 1) -> tuple[np.ndarray, np.ndarray]:
    """Sun and Earth vectors (T, 3) km, every `stride`-th hourly sample of the 2025-2035 table."""
    seg = next(s for s in store.ephemeris.segments if s.id == "2025_2035")
    d = seg.data[::stride].astype(np.float64)
    return d[:, 0:3], d[:, 3:6]


def window_vectors(store, days: float) -> tuple[np.ndarray, np.ndarray]:
    t = time_grid(WINDOW_START_MS, days * 24.0, 60.0)
    v = store.ephemeris.positions(t)
    return v[:, 0:3], v[:, 3:6]


def terrain_zone_points(store):
    """(site, zone point, mask values in degrees) for every terrain site, in file order."""
    for site in store.sites.all():
        if site.has_terrain:
            for point, profile in store.horizons.zone(site):
                yield site, point, profile.values


def _real_visibility(up: np.ndarray, body_km: np.ndarray, radius_km: float, mask: np.ndarray):
    """(visible, possible-input el/rad, azimuth index) of one body at one point against its real mask."""
    pos = up * MOON_R_KM
    v = body_km - pos
    dist = np.linalg.norm(v, axis=1)
    z = np.array([0.0, 0.0, 1.0])
    east = np.cross(z, up)
    east /= np.linalg.norm(east)
    north = np.cross(up, east)
    az = np.degrees(np.arctan2(v @ east, v @ north)) % 360.0
    el = np.degrees(np.arcsin(np.clip((v @ up) / dist, -1.0, 1.0)))
    rad = np.degrees(np.arcsin(radius_km / dist))
    idx = np.rint(az / (360.0 / mask.size)).astype(int) % mask.size
    return el + rad > mask[idx], el, rad, idx


def check_real_masks(store, stride: int = 1) -> dict:
    """Part 1. Returns per-site and total counts: samples with any part visible on the real mask, samples where
    the bound said impossible while visible (violations), and the smallest margin real skyline - floor."""
    sun, earth = body_vectors(store, stride)
    hmin, sets = h_min_m(store), ray_sets()
    per_site: dict[str, dict] = {}
    for site, point, mask in terrain_zone_points(store):
        up = B.unit_vectors(point["lat"], point["lon"])
        top = np.array([float(point["groundHeightM"]) + MAST_ZONE_M + B.ELEV_MARGIN_M])
        floor = np.min([B.horizon_floor_deg(top, hmin, d) for d in sets], axis=0)
        row = per_site.setdefault(site.id, {b: {"visible": 0, "possible": 0, "violations": 0, "margin": np.inf}
                                           for b in ("sun", "earth")})
        for name, body, radius in (("sun", sun, SUN_R_KM), ("earth", earth, EARTH_R_KM)):
            vis, el, rad, idx = _real_visibility(up, body, radius, mask)
            poss = B.possible_visible(el[None, :], rad[None, :], np.zeros(1), floor)[0]
            r = row[name]
            r["visible"] += int(vis.sum())
            r["possible"] += int(poss.sum())
            r["violations"] += int((vis & ~poss).sum())
            if vis.any():
                r["margin"] = min(r["margin"], float((mask[idx][vis] - floor[0]).min()))
    total = {b: {"visible": 0, "possible": 0, "violations": 0, "margin": np.inf, "samples": 0} for b in ("sun", "earth")}
    for row in per_site.values():
        for b in total:
            for k in ("visible", "possible", "violations"):
                total[b][k] += row[b][k]
            total[b]["margin"] = min(total[b]["margin"], row[b]["margin"])
    return {"per_site": per_site, "total": total, "samples": sun.shape[0]}


# ------------------------------------------------------------------------------------------------ discard table

def _block_max(a: np.ndarray, k: int) -> np.ndarray:
    """Maximum over k x k blocks of the grid, ignoring NaN, padding the edges with NaN."""
    n = a.shape[0]
    nt = -(-n // k)
    p = np.full((nt * k, nt * k), np.nan)
    p[:n, :n] = a
    with np.errstate(invalid="ignore"):
        return np.nanmax(p.reshape(nt, k, nt, k), axis=(1, 3))


def build_tiles(store, tile_m: float) -> dict:
    """Tiles of tile_m metres over the cap south of 60 S: centre lat/lon, half-diagonal central angle, area weight
    (true area, m^2) and the highest eye height (grid maximum over the tile and a ring of one cell, mast, margin)."""
    meta = store.grids.meta("lola_elevation_60s")
    elev = store.grids.float_array("lola_elevation_60s").astype(np.float64)
    n = elev.shape[0]
    k = int(round(tile_m / GRID_M))
    ring = np.full((n + 2, n + 2), np.nan)
    ring[1:-1, 1:-1] = elev
    dil = np.nanmax(np.stack([ring[1 + dy:n + 1 + dy, 1 + dx:n + 1 + dx] for dy in (-1, 0, 1) for dx in (-1, 0, 1)]), axis=0)
    tmax = _block_max(dil, k)
    nt = tmax.shape[0]
    tile = k * GRID_M
    cx = meta["xLeftM"] + (np.arange(nt) + 0.5) * tile
    cy = meta["yTopM"] - (np.arange(nt) + 0.5) * tile
    X, Y = np.meshgrid(cx, cy)
    r = np.hypot(X, Y)
    cap_r = 2.0 * B.R_M * np.tan(np.radians(15.0))              # 60 S
    keep = (r <= cap_r) & ~np.isnan(tmax)
    lat, lon = south_polar_latlon(X[keep], Y[keep])
    half_diag = tile * np.sqrt(2.0) / 2.0
    r_near = np.maximum(r[keep] - half_diag, 0.0)
    kscale = 1.0 + (r_near / (2.0 * B.R_M)) ** 2                # stereographic scale at the nearest point, <= any in the tile
    theta = np.degrees(half_diag / kscale / B.R_M)
    kc = 1.0 + (r[keep] / (2.0 * B.R_M)) ** 2
    return {"lat": lat, "lon": lon, "theta": theta, "area": tile * tile / kc ** 2,
            "top": tmax[keep] + MAST_ZONE_M + B.ELEV_MARGIN_M}


def discard_shares(store, tiles: dict, days: float) -> dict[str, np.ndarray]:
    """Area share (%) proven to fail per latitude band + whole cap (last entry), for Sun >= 70 % and Earth >= 70 %."""
    sun, earth = window_vectors(store, days)
    tb = B.tile_bounds(tiles["lat"], tiles["lon"], tiles["theta"], tiles["top"], h_min_m(store), ray_sets(), sun, earth, 1.0)
    out = {}
    for name, ub in (("sun", tb.sun_share_ub), ("earth", tb.earth_share_ub)):
        out_mask = ub < THRESHOLD
        shares = []
        for lo, hi in BANDS:
            sel = (-tiles["lat"] >= lo) & (-tiles["lat"] < hi if hi < 90 else -tiles["lat"] <= hi)
            shares.append(100.0 * tiles["area"][sel & out_mask].sum() / max(tiles["area"][sel].sum(), 1e-9))
        shares.append(100.0 * tiles["area"][out_mask].sum() / tiles["area"].sum())
        out[name] = np.array(shares)
    return out


def main() -> int:
    store = get_store()
    ok = True
    t0 = time.perf_counter()
    res = check_real_masks(store)
    print(f"== Part 1: bound vs real LOLA masks ({res['samples']} hourly samples 2025-2035, 221 zone points, theta = 0)")
    print(f"{'site':16s} {'Sun visible':>12s} {'Sun bound':>10s} {'viol':>5s}   {'Earth visible':>13s} {'Earth bound':>11s} {'viol':>5s}")
    n_pts = 17 * res["samples"]
    for sid, row in res["per_site"].items():
        s, e = row["sun"], row["earth"]
        print(f"{sid:16s} {100 * s['visible'] / n_pts:11.2f}% {100 * s['possible'] / n_pts:9.2f}% {s['violations']:5d}   "
              f"{100 * e['visible'] / n_pts:12.2f}% {100 * e['possible'] / n_pts:10.2f}% {e['violations']:5d}")
    for b in ("sun", "earth"):
        t = res["total"][b]
        good = t["violations"] == 0 and t["margin"] >= PASS_MIN_MARGIN_DEG
        ok &= good
        print(f"TOTAL {b:5s}: samples with any part visible {t['visible']:,}; bound said impossible {t['violations']}; "
              f"smallest margin (real skyline - floor) {t['margin']:.3f} deg -> {'PASS' if good else 'FAIL'}"
              f"  [{time.perf_counter() - t0:.0f} s]")

    print("\n== Part 2: share of the area south of 60 S proven to fail (%), Sun >= 70 % / Earth >= 70 %")
    labels = [f"{lo}-{hi} S" for lo, hi in BANDS] + ["whole cap"]
    results: dict[tuple[float, float], dict] = {}
    for tile in TILES_M:
        tiles = build_tiles(store, tile)
        t1 = time.perf_counter()
        for days in (14.0, 29.53):
            results[(tile, days)] = discard_shares(store, tiles, days)
        print(f"  tiles of {tile / 1000:5.2f} km: {tiles['lat'].size:7d} tiles, {time.perf_counter() - t1:5.1f} s")
    print(f"\nBy latitude band, tiles of 7.68 km (final bound | specification 3.2):")
    print(f"{'band':10s} " + " ".join(f"{k:>16s}" for k in ("Sun 14 d", "Sun 29.53 d", "Earth 14 d", "Earth 29.53 d")))
    for bi, lab in enumerate(labels[:-1]):
        cells, tol_ok = [], True
        for key, body, days in (("sun14", "sun", 14.0), ("sun29", "sun", 29.53), ("earth14", "earth", 14.0), ("earth29", "earth", 29.53)):
            val, ref = results[(7_680.0, days)][body][bi], REF_BANDS[key][bi]
            tol_ok &= val <= ref + PASS_SHARE_TOL_PP
            cells.append(f"{val:6.1f} | {ref:5.1f}")
        ok &= tol_ok
        print(f"{lab:10s} " + " ".join(f"{c:>16s}" for c in cells) + ("" if tol_ok else "   FAIL (> spec + 3 pp)"))
    print("\nBy tile size, whole cap, Sun >= 70 % over 29.53 d (final bound | specification 3.2):")
    for tile in TILES_M:
        val, ref = results[(tile, 29.53)]["sun"][-1], REF_TILES[tile]
        good = val <= ref + PASS_SHARE_TOL_PP
        ok &= good
        print(f"  {tile / 1000:5.2f} km: {val:5.1f} | {ref:5.1f} -> {'PASS' if good else 'FAIL'}")
    print(f"\nOVERALL: {'PASS' if ok else 'FAIL'}  [{time.perf_counter() - t0:.0f} s]")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
