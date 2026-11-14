"""Glue of POST /api/v1/areas/search: reads the grids, catalogue and ephemeris (app/db), runs the funnel of
logic.areas and the engine, and shapes the raster answer. The method, step by step, is in logic/areas.py.

Resolution and cost, kept bounded on purpose:
  * the region is a disc of at most 400 km radius and the raster at most MAX_CELLS cells;
  * every static filter reads a k x k sub-grid per cell, k = cell size / pixel of the finest grid (at most 8), so
    each grid pixel inside the cell is read once; slope and shadow take the worst of them (a cell fails if any
    part of it fails), heights and long-term maps the mean. Only cells still alive are read (funnel order);
  * the window filters run on at most max_window_samples samples placed by a quadtree over the surviving cells
    (finer where neighbours disagree), each with a horizon ray-traced over the LOLA elevation grids every
    horizon_az_step_deg out to horizon_radius_km. Measured: about 20 samples per second on 8 threads, and at 300
    samples 91 % of the cells agree with a 1718-sample reference over a 40 km region (docs/data-and-computation.md).
"""
from __future__ import annotations

import base64
import math
import os
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import timezone

import numpy as np

from . import services
from .db.landings import measured_landings
from .db.store import DataStore
from .logic import areas as A
from .logic.engine import AnalysisParams, compute_metrics, make_model
from .logic.horizon import HorizonProfile, destination_south_polar_xy, ray_distances, skyline_from_heights
from .logic.projection import great_circle_km, south_polar_latlon, south_polar_xy
from .schemas.areas import (WINDOW_FILTERS, Area, AreaSearchRequest, AreaSearchResponse, FilterCount, GridInfo,
                            WindowInfo)

MAX_CELLS = 360_000
MAX_SUB = 8                               # most sub-grid samples per cell side for the static filters
CHUNK_CELLS = 16_000                      # cells per batch of sub-grid reads (bounds memory)
SLOPE_GRIDS = ("lola_slope_80s", "lola_slope_60s")
ELEVATION_GRIDS = ("lola_elevation_80s", "lola_elevation_60s")
FULL_SKY_SR = 4.0 * math.pi
HORIZON_GROWTH = 1.02                     # geometric step of the sample horizons beyond the near field
AZ_CHUNK_POINTS = 12_000                  # ray points traced per batch of azimuths
PROXY_TOL = 0.1                           # quadtree: split a tile whose long-term light or Earth spans more than this


#: window filter id -> (sample value key, test(value, threshold)); values per sample in `one` below
WINDOW_CHECKS = (
    ("min_sunlit_fraction", "sunlit", lambda v, t: v >= t),
    ("max_dark_h", "dark", lambda v, t: v <= t),
    ("min_comms_fraction", "comms", lambda v, t: v >= t),
    ("max_blackout_h", "blackout", lambda v, t: v <= t),
    ("min_sun_el_at_landing_deg", "sun_el0", lambda v, t: v >= t),
    ("max_sun_el_at_landing_deg", "sun_el0", lambda v, t: v <= t),
    ("earth_visible_at_landing", "earth0", lambda v, t: (v > 0.5) == bool(t)),
    ("min_mean_power_w_m2", "power", lambda v, t: v >= t),
    ("min_light_left_h", "light_left", lambda v, t: v >= t),
    ("min_contact_left_h", "contact_left", lambda v, t: v >= t),
    ("min_both_fraction", "both", lambda v, t: v >= t),
)
WINDOW_KEYS = ("sunlit", "dark", "comms", "blackout", "sun_el0", "earth0", "power", "light_left", "contact_left", "both")
PSR_PIXEL = 0.5                           # a permanent_shadow_65s pixel counts as a PSR from this share up


class SearchTooLarge(ValueError):
    pass


def _cell_mean(a: np.ndarray) -> np.ndarray:
    """Mean over the last axis ignoring NaN; NaN where the cell has no data at all."""
    ok = ~np.isnan(a)
    cnt = ok.sum(axis=-1)
    return np.where(cnt > 0, np.where(ok, a, 0.0).sum(axis=-1) / np.maximum(cnt, 1), np.nan)


def _cell_max(a: np.ndarray) -> np.ndarray:
    """Largest value over the last axis ignoring NaN; NaN where the cell has no data at all."""
    ok = ~np.isnan(a)
    return np.where(ok.any(axis=-1), np.where(ok, a, -np.inf).max(axis=-1), np.nan)


def _finest_xy(store: DataStore, grid_ids: tuple[str, ...], x: np.ndarray, y: np.ndarray, bilinear: bool) -> np.ndarray:
    """Value from the first (finest) grid that has data at each projected point; NaN where none has."""
    out = np.full(np.shape(x), np.nan)
    for gid in grid_ids:
        miss = np.isnan(out)
        if not miss.any():
            break
        f = store.grids.bilinear_xy if bilinear else store.grids.sample_xy
        out[miss] = f(gid, x[miss], y[miss])
    return out


def _bilinear_f32(arr: np.ndarray, m: dict, x: np.ndarray, y: np.ndarray) -> np.ndarray:
    """Bilinear heights between the four nearest cell centres of a float32 grid with NaN for no data (the same
    interpolation as GridRepository.bilinear_xy, on flat indices)."""
    w, h = int(m["width"]), int(m["height"])
    fx = (x - m["xLeftM"]) / m["pixelM"] - 0.5
    fy = (m["yTopM"] - y) / m["pixelM"] - 0.5
    c0, r0 = np.floor(fx), np.floor(fy)
    tx, ty = fx - c0, fy - r0
    inside = (c0 >= 0) & (c0 < w - 1) & (r0 >= 0) & (r0 < h - 1)
    idx = np.where(inside, r0 * w + c0, 0).astype(np.intp)
    flat = arr.reshape(-1)
    q00, q01 = flat.take(idx), flat.take(idx + 1)
    q10, q11 = flat.take(idx + w), flat.take(idx + w + 1)
    top = q00 + (q01 - q00) * tx
    v = top + (q10 + (q11 - q10) * tx - top) * ty
    return np.where(inside, v, np.nan)


def _sample_horizon(store: DataStore, lat: float, lon: float, ground: float, mast: float, az_step: float,
                    radius_m: float) -> HorizonProfile:
    """Skyline of one window sample, ray-traced like services.point_horizon (same rays, heights and curvature):
    rays every az_step degrees out to radius_m, quarter-cell steps over the first five cells of the finest LOLA
    elevation grid at the point, then 2 % geometric growth; heights bilinear from the finest grid at each ray point."""
    grids = [(store.grids.float_array(g), store.grids.meta(g)) for g in ELEVATION_GRIDS]
    px, py = south_polar_xy(np.array([lat]), np.array([lon]))
    fine = 0 if not np.isnan(_bilinear_f32(*grids[0], px, py)[0]) else 1
    dist = ray_distances(float(grids[fine][1]["pixelM"]), radius_m, HORIZON_GROWTH)
    n_az = int(round(360.0 / az_step))
    az = np.radians(np.arange(n_az) * (360.0 / n_az))[:, None]
    out = np.empty(n_az)
    step = max(1, AZ_CHUNK_POINTS // dist.size)         # azimuths per chunk: the arrays stay in the CPU cache
    for a in range(0, n_az, step):
        x, y = destination_south_polar_xy(np.radians(lat), np.radians(lon), az[a:a + step], dist[None, :])
        heights = _bilinear_f32(*grids[fine], x, y)
        miss = np.isnan(heights)
        if fine == 0 and miss.any():
            heights[miss] = _bilinear_f32(*grids[1], x[miss], y[miss])
        out[a:a + step] = skyline_from_heights(dist, heights, ground, mast)
    return HorizonProfile(out, kind="terrain")


def search(store: DataStore, req: AreaSearchRequest) -> AreaSearchResponse:
    t0 = time.perf_counter()
    f = req.filters
    reg = req.region
    lon_c = ((reg.center_lon + 180.0) % 360.0) - 180.0
    cell_m = req.cell_km * 1000.0
    radius_m = reg.radius_km * 1000.0
    n = int(math.ceil(2.0 * radius_m / cell_m))
    if n * n > MAX_CELLS:
        raise SearchTooLarge(f"{n * n} cells: make cell_km larger or the region smaller (limit {MAX_CELLS})")
    x0, y0 = (float(v) for v in south_polar_xy(np.array(reg.center_lat), np.array(lon_c)))
    x_left, y_top = x0 - n * cell_m / 2.0, y0 + n * cell_m / 2.0
    xs = x_left + (np.arange(n) + 0.5) * cell_m
    ys = y_top - (np.arange(n) + 0.5) * cell_m
    gx, gy = np.meshgrid(xs, ys)
    inside = (gx - x0) ** 2 + (gy - y0) ** 2 <= radius_m ** 2
    clat, clon = south_polar_latlon(gx, gy)

    code = np.where(inside, A.VIABLE, A.OUTSIDE).astype(np.uint8)
    funnel: list[FilterCount] = []
    assumptions: list[str] = []

    def apply(fid: str, stage: str, values: np.ndarray, passes: np.ndarray) -> None:
        alive = code == A.VIABLE
        unknown = alive & np.isnan(values)
        fail = alive & ~np.isnan(values) & ~passes
        code[fail] = A.FAIL_STATIC if stage != "window" else A.FAIL_WINDOW
        if not req.unknown_passes:
            code[unknown] = A.UNKNOWN
        funnel.append(FilterCount(id=fid, stage=stage, cells_in=int(alive.sum()), cells_out=int(fail.sum()),
                                  cells_unknown=int(unknown.sum())))

    sub_sizes: dict[str, int] = {}

    def sub(fid: str, grid_ids: tuple[str, ...], reduce, bilinear: bool = False) -> np.ndarray:
        """Per-cell value of the cells still alive (NaN elsewhere): a k x k sub-grid read from the finest grid,
        reduced by `reduce` over the samples."""
        out = np.full((n, n), np.nan)
        alive = np.flatnonzero(code == A.VIABLE)
        known = [g for g in grid_ids if g in store.grids.index["grids"]]
        if alive.size == 0 or not known:
            return out
        pix = min(float(store.grids.meta(g)["pixelM"]) for g in known)
        k = int(min(MAX_SUB, max(1, math.ceil(cell_m / pix - 1e-9))))
        sub_sizes[fid] = k
        off = ((np.arange(k) + 0.5) / k - 0.5) * cell_m
        flat = out.reshape(-1)
        for a in range(0, alive.size, CHUNK_CELLS):
            idx = alive[a:a + CHUNK_CELLS]
            px = gx.reshape(-1)[idx][:, None, None] + off[None, None, :]
            py = gy.reshape(-1)[idx][:, None, None] - off[None, :, None]
            px, py = np.broadcast_arrays(px, py)
            flat[idx] = reduce(_finest_xy(store, grid_ids, px.reshape(idx.size, k * k), py.reshape(idx.size, k * k), bilinear))
        return out

    # ---- A. search zone
    if f.side is not None:
        near = np.abs(clon) <= 90.0
        apply("side", "static", np.zeros((n, n)), near if f.side == "near" else ~near)
    if f.away_from_landings_km is not None:
        d = np.full((n, n), np.inf)
        for _, la, lo in measured_landings(store.data_dir):
            d = np.minimum(d, great_circle_km(clat, clon, la, lo))
        apply("away_from_landings_km", "static", d, d >= f.away_from_landings_km)

    # ---- B. terrain
    if f.max_slope_deg is not None:
        worst = sub("max_slope_deg", SLOPE_GRIDS, _cell_max)
        apply("max_slope_deg", "static", worst, worst <= f.max_slope_deg)
    if f.min_elevation_m is not None or f.max_elevation_m is not None:
        h = sub("elevation_m", ELEVATION_GRIDS, _cell_mean, bilinear=True)
        ok = np.ones_like(h, dtype=bool)
        if f.min_elevation_m is not None:
            ok &= h >= f.min_elevation_m
        if f.max_elevation_m is not None:
            ok &= h <= f.max_elevation_m
        apply("elevation_m", "static", h, ok)
    if f.max_permanent_shadow is not None:
        worst = sub("max_permanent_shadow", ("permanent_shadow_65s",), _cell_max)
        apply("max_permanent_shadow", "static", worst, worst <= f.max_permanent_shadow)
    if f.min_rim_distance_km is not None:
        d = rim_distance_km(store, gx, gy, clat, f.rim_min_diam_km, f.min_rim_distance_km)
        apply("min_rim_distance_km", "static", d, d >= f.min_rim_distance_km)
    if f.max_crater_density_per_km2 is not None:
        dens = crater_density(store, x_left, y_top, cell_m, n, f.crater_radius_km, f.crater_min_diam_km)
        apply("max_crater_density_per_km2", "static", dens, dens <= f.max_crater_density_per_km2)

    # ---- C, D, F. long-term maps and shielding
    long_sun = long_earth = None
    if f.min_long_term_sun is not None:
        long_sun = sub("min_long_term_sun", ("sun_illumination_65s",), _cell_mean)
        apply("min_long_term_sun", "static", long_sun, long_sun >= f.min_long_term_sun)
    if f.min_long_term_earth is not None:
        long_earth = sub("min_long_term_earth", ("earth_visibility_65s",), _cell_mean)
        apply("min_long_term_earth", "static", long_earth, long_earth >= f.min_long_term_earth)
    if f.max_sky_sr is not None or f.max_dose_mgy is not None:
        sky = sub("max_sky_sr", ("sky_visibility_65s",), _cell_mean)
    if f.max_sky_sr is not None:
        apply("max_sky_sr", "static", sky, sky <= f.max_sky_sr)
    if f.max_dose_mgy is not None:
        rate = store.radiation.gcr_free_space_mean() if store.radiation else None
        dose = np.full((n, n), np.nan) if rate is None else rate * (sky / FULL_SKY_SR) * (req.duration_h / 24.0)
        apply("max_dose_mgy", "static", dose, dose <= f.max_dose_mgy)
        assumptions.append("Dose: mean CRaTER galactic-cosmic-ray rate (free space) x open sky / 4 pi x window days; no solar storms.")

    # ---- I. science: near a permanently shadowed region
    if f.max_psr_distance_km is not None:
        shade = _finest_xy(store, ("permanent_shadow_65s",), gx, gy, False)
        psr = np.nan_to_num(shade, nan=0.0) >= PSR_PIXEL
        near_psr = A.dilate(psr, f.max_psr_distance_km * 1000.0 / cell_m)
        apply("max_psr_distance_km", "static", np.where(np.isnan(shade) & ~near_psr, np.nan, 0.0), near_psr)
        assumptions.append(f"Near a PSR: within {f.max_psr_distance_km} km of a 960 m PGDA pixel at least {PSR_PIXEL:.0%} in "
                           "permanent shadow, among the pixels inside the search square.")

    if f.min_hydrogen_ppm is not None:
        h2 = sub("min_hydrogen_ppm", ("lp_hydrogen_60s",), _cell_mean)
        apply("min_hydrogen_ppm", "static", h2, h2 >= f.min_hydrogen_ppm)
        assumptions.append("Hydrogen: Lunar Prospector neutron spectrometer map (Feldman et al. 2001), 0.5 deg bins with a "
                           "footprint of about 45 km, so it marks regions, not single cells; values as published.")

    # ---- landing radius: no static failure within it
    if req.landing_radius_km is not None:
        failed = code == A.FAIL_STATIC
        near_fail = A.dilate(failed, req.landing_radius_km * 1000.0 / cell_m)
        alive = code == A.VIABLE
        hit = alive & near_fail
        code[hit] = A.FAIL_STATIC
        funnel.append(FilterCount(id="landing_radius_km", stage="landing_radius", cells_in=int(alive.sum()),
                                  cells_out=int(hit.sum()), cells_unknown=0))

    # ---- window filters: adaptive samples (quadtree) over the survivors, each with its own traced horizon
    window = None
    sun_frac_cells = comms_frac_cells = None
    want_window = any(getattr(f, k) is not None for k in WINDOW_FILTERS)
    if want_window and (code == A.VIABLE).any():
        start_ms = req.start.astimezone(timezone.utc).timestamp() * 1000.0
        params = AnalysisParams(panel=req.panel, comms_min_fraction=req.comms_min_fraction)
        checks = [(fid, key, test) for fid, key, test in WINDOW_CHECKS if getattr(f, fid) is not None]

        def window_values(model, t0_ms: float) -> dict[str, float]:
            series = services.evaluate_window(store, model, t0_ms, req.duration_h, req.step_min, params)
            met = compute_metrics(series, params)
            step_h = series.step_ms / 3_600_000.0
            return {"sunlit": met.sunlight_pct / 100.0, "dark": met.longest_dark_h, "comms": met.comms_pct / 100.0,
                    "blackout": met.longest_blackout_h, "sun_el0": float(series.sun_el[0]),
                    "earth0": float(series.comms(params)[0]), "power": met.mean_power_w_m2,
                    "light_left": _run_from_start(series.sunlit()) * step_h,
                    "contact_left": _run_from_start(series.comms(params)) * step_h, "both": met.both_pct / 100.0}

        def one(i: int, j: int) -> dict | None:
            la, lo = float(clat[i, j]), float(clon[i, j])
            g = float(_finest_xy(store, ELEVATION_GRIDS, gx[i, j:j + 1], gy[i, j:j + 1], True)[0])
            if np.isnan(g):
                return None
            hz = _sample_horizon(store, la, lo, g, req.mast_m, req.horizon_az_step_deg, req.horizon_radius_km * 1000.0)
            model = make_model(la, lo, g, hz, req.mast_m)
            v = window_values(model, start_ms)
            if f.robust_delay_h is not None:   # the same horizon, the window shifted: cheap next to the tracing
                v["delayed"] = window_values(model, start_ms + f.robust_delay_h * 3_600_000.0)
            return v

        def passes(v: dict) -> bool:
            return all(test(v[key], getattr(f, fid)) for fid, key, test in checks)

        # numpy releases the GIL in the heavy parts (trig, gathers), so threads share the cores without copies
        pool = ThreadPoolExecutor(max_workers=max(1, min(8, os.cpu_count() or 1)))

        def evaluate(rows: np.ndarray, cols: np.ndarray):
            vals = list(pool.map(one, rows.tolist(), cols.tolist()))
            out = []
            for v in vals:
                if v is None:
                    out.append(2)
                else:
                    out.append(int(passes(v) and ("delayed" not in v or passes(v["delayed"]))))
            return vals, out

        # refinement proxies: the long-term light and Earth maps (PGDA 69, computed over real horizons)
        lt_sun = long_sun if long_sun is not None else sub("proxy_long_term_sun", ("sun_illumination_65s",), _cell_mean)
        lt_earth = long_earth if long_earth is not None else sub("proxy_long_term_earth", ("earth_visibility_65s",), _cell_mean)
        try:
            rows, cols, vals, outcome, leaves, owner = A.quadtree_samples(
                code == A.VIABLE, evaluate, req.max_window_samples, proxies=(lt_sun, lt_earth), proxy_tol=PROXY_TOL)
        finally:
            pool.shutdown()
        m = rows.size
        cells = {}
        for key in WINDOW_KEYS:
            per = np.array([np.nan if v is None else v[key] for v in vals])
            cells[key] = np.where(owner >= 0, per[np.maximum(owner, 0)], np.nan)
        for fid, key, test in checks:
            with np.errstate(invalid="ignore"):
                apply(fid, "window", cells[key], test(cells[key], getattr(f, fid)))
        if f.robust_delay_h is not None:
            per = np.array([np.nan if v is None else float(passes(v["delayed"])) for v in vals])
            late = np.where(owner >= 0, per[np.maximum(owner, 0)], np.nan)
            apply("robust_delay_h", "window", late, late > 0.5)
            assumptions.append(f"Robust to a delay: the window filters pass for the planned start and for a landing "
                               f"{f.robust_delay_h} h later (same duration, same horizon).")
        sun_frac_cells, comms_frac_cells = cells["sunlit"], cells["comms"]
        sizes = [lf.size for lf in leaves] or [1]
        window = WindowInfo(samples=int(m), finest_tile_km=round(min(sizes) * req.cell_km, 3),
                            coarsest_tile_km=round(max(sizes) * req.cell_km, 3),
                            horizon_az_step_deg=req.horizon_az_step_deg, horizon_radius_km=req.horizon_radius_km)
        assumptions.append(
            f"Window filters: {m} samples placed by a quadtree (tiles from {max(sizes) * req.cell_km:.2f} km down to "
            f"{min(sizes) * req.cell_km:.2f} km, split where neighbours disagree or the long-term light or Earth map spans "
            f"more than {PROXY_TOL} inside a tile); each sample has a horizon ray-traced over "
            f"LOLA every {req.horizon_az_step_deg} deg out to {req.horizon_radius_km:.0f} km and the cells of a tile share it.")

    # ---- score among viable cells: weighted sunlight and Earth contact (window values when run, else long term)
    w = {"sunlight": 1.0, "comms": 1.0, **(req.weights or {})}
    if sun_frac_cells is None and long_sun is None:
        long_sun = sub("score_long_term_sun", ("sun_illumination_65s",), _cell_mean)
    if comms_frac_cells is None and long_earth is None:
        long_earth = sub("score_long_term_earth", ("earth_visibility_65s",), _cell_mean)
    sun_c = sun_frac_cells if sun_frac_cells is not None else long_sun
    com_c = comms_frac_cells if comms_frac_cells is not None else long_earth
    parts = [(w["sunlight"], sun_c), (w["comms"], com_c)]
    num = sum(wi * np.nan_to_num(c, nan=0.0) for wi, c in parts)
    den = sum(wi * (~np.isnan(c)) for wi, c in parts)
    score = np.where(den > 0, num / np.maximum(den, 1e-12), 0.0)
    viable = code == A.VIABLE
    score_u8 = np.where(viable, np.clip(np.rint(score * 255.0), 1, 255), 0).astype(np.uint8)

    # ---- connected areas
    labels, nl = A.label(viable)
    k = 2.0 / (1.0 + np.sin(np.radians(-clat)))          # polar stereographic scale factor
    cell_km2 = (cell_m / 1000.0) ** 2 / (k * k)
    site_cells: dict[int, list[str]] = {}
    for site in store.sites.all():
        if site.lat > -60.0:
            continue
        sxp, syp = south_polar_xy(np.array(site.lat), np.array(site.lon))
        j = int((float(sxp) - x_left) // cell_m)
        i = int((y_top - float(syp)) // cell_m)
        if 0 <= i < n and 0 <= j < n and labels[i, j]:
            site_cells.setdefault(int(labels[i, j]), []).append(site.name)
    found = []
    for lab in range(1, nl + 1):
        sel = labels == lab
        cells_n = int(sel.sum())
        area = float(cell_km2[sel].sum())
        sc = score[sel]
        bi = np.argmax(np.where(sel, score, -1.0))
        bi, bj = np.unravel_index(bi, sel.shape)
        cx, cy = float(gx[sel].mean()), float(gy[sel].mean())
        clat_a, clon_a = south_polar_latlon(np.array(cx), np.array(cy))
        found.append(Area(id=lab, cells=cells_n, area_km2=round(area, 2), centroid_lat=float(clat_a), centroid_lon=float(clon_a),
                          best_lat=float(clat[bi, bj]), best_lon=float(clon[bi, bj]), best_score=round(float(score[bi, bj]), 4),
                          mean_score=round(float(sc.mean()), 4), sites=site_cells.get(lab, [])))
    found.sort(key=lambda a: a.area_km2 * (0.25 + a.mean_score), reverse=True)

    counts = {name: int((code == c).sum()) for name, c in (("outside", A.OUTSIDE), ("failed_static", A.FAIL_STATIC),
                                                          ("failed_window", A.FAIL_WINDOW), ("viable", A.VIABLE),
                                                          ("unknown", A.UNKNOWN))}
    if sub_sizes:
        assumptions.append("Static filters read a k x k sub-grid per cell from the finest grid covering it ("
                           + ", ".join(f"{k}: {v} x {v}" for k, v in sub_sizes.items() if not k.startswith(("score", "proxy")))
                           + "): slope and permanent shadow take the worst sample, heights and long-term maps the mean.")
    if req.landing_radius_km is not None:
        assumptions.append(f"Landing radius {req.landing_radius_km} km: a cell survives only if no cell failing a static "
                           "filter lies within it; near the edge of the region only the inside is checked.")
    return AreaSearchResponse(
        grid=GridInfo(projection="south polar stereographic, true scale at the pole, R = 1737400 m, MOON_ME",
                      x_left_m=x_left, y_top_m=y_top, cell_m=cell_m, nx=n, ny=n),
        codes_b64=base64.b64encode(code.tobytes()).decode("ascii"),
        score_b64=base64.b64encode(score_u8.tobytes()).decode("ascii"),
        counts=counts, funnel=funnel, areas=found[:12], window=window,
        seconds=round(time.perf_counter() - t0, 3), assumptions=assumptions)


def _run_from_start(flags: np.ndarray) -> int:
    """Samples from the start until the first False (all of them when it never goes False; 0 when it starts False)."""
    f = np.asarray(flags, dtype=bool)
    return int(f.size if f.all() else np.argmin(f))


def rim_distance_km(store: DataStore, gx: np.ndarray, gy: np.ndarray, clat: np.ndarray, min_diam_km: float,
                    within_km: float) -> np.ndarray:
    """Distance from each cell centre to the nearest rim of a Robbins (2018) crater of at least min_diam_km, km,
    capped at within_km (only rims closer than that matter to the filter). Rim = circle of the catalogue diameter;
    projected distances are divided by the polar stereographic scale factor."""
    if not store.craters.available:
        return np.full(gx.shape, np.nan)
    out = np.full(gx.shape, float(within_km))
    c = store.craters._load()
    keep = (c["diam_km"] >= min_diam_km) & (c["lat"] <= -55.0)
    cx, cy = south_polar_xy(c["lat"][keep], c["lon"][keep])
    rad = c["diam_km"][keep] * 500.0
    k = 2.0 / (1.0 + np.sin(np.radians(-clat)))
    ny, nx = gx.shape
    cell = float(gx[0, 1] - gx[0, 0]) if nx > 1 else 1.0
    x0, y0 = float(gx[0, 0]), float(gy[0, 0])
    reach = within_km * 1000.0
    for xc, yc, r in zip(cx, cy, rad):
        j0 = max(0, math.floor((xc - r - reach - x0) / cell))
        j1 = min(nx, math.ceil((xc + r + reach - x0) / cell) + 1)
        i0 = max(0, math.floor((y0 - (yc + r + reach)) / cell))
        i1 = min(ny, math.ceil((y0 - (yc - r - reach)) / cell) + 1)
        if j0 >= j1 or i0 >= i1:
            continue
        d = np.abs(np.hypot(gx[i0:i1, j0:j1] - xc, gy[i0:i1, j0:j1] - yc) / k[i0:i1, j0:j1] - r) / 1000.0
        np.minimum(out[i0:i1, j0:j1], d, out=out[i0:i1, j0:j1])
    return out


def crater_density(store: DataStore, x_left: float, y_top: float, cell_m: float, n: int, radius_km: float,
                   min_diam_km: float) -> np.ndarray:
    """Robbins (2018) craters of at least min_diam_km per km2 within radius_km of each cell centre (counted on the
    raster: crater centres binned to cells, then summed over a disc)."""
    if not store.craters.available:
        return np.full((n, n), np.nan)
    c = store.craters._load()
    pad = radius_km * 1000.0
    keep = (c["diam_km"] >= min_diam_km) & (c["lat"] <= -55.0)
    x, y = south_polar_xy(c["lat"][keep], c["lon"][keep])
    j = np.floor((x - x_left) / cell_m).astype(np.int64)
    i = np.floor((y_top - y) / cell_m).astype(np.int64)
    r = int(math.ceil(pad / cell_m))
    ok = (i >= -r) & (i < n + r) & (j >= -r) & (j < n + r)
    counts = np.zeros((n + 2 * r, n + 2 * r))
    np.add.at(counts, (i[ok] + r, j[ok] + r), 1.0)
    within = A.count_within(counts, radius_km * 1000.0 / cell_m)[r:r + n, r:r + n]
    disc_km2 = A.disc(radius_km * 1000.0 / cell_m).sum() * (cell_m / 1000.0) ** 2
    return within / disc_km2
