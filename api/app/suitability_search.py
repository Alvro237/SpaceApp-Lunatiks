"""Glue of POST /api/v1/suitability/search (mission design PR 3, docs/mission-design-spec.md section 8, amended by
docs/mission-planner-ui-spec.md section 6): reads the grids, catalogue, crater and name datasets (app/db), runs an
ordered funnel of hard criteria, scores the surviving cells per category and proposes the best landing sites.

Funnel, cheapest and coarsest first:
  0. geometry   side, past landings, named feature (closed-form distances)
  1. bound      tiles the ephemeris bound (logic/bounds.py) proves to fail a bounded window criterion
  2. regional   crater cover, distance to permanent shadow, hydrogen
  3. medium     permanently shadowed ground, dose
  4. fine       slope, crater rim margin
  5. landing radius (a disc dilation of the static failures)
  6. window     quadtree samples (logic.areas.quadtree_samples), each with its own ray-traced horizon
Then the category layers, the weighted score, and the sites (non-maximum suppression, then each site re-evaluated
exactly with its own horizon).

Reuses the raster setup, sub-grid reads and horizon tracing of area_search (read-only imports).
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
from .area_search import (CHUNK_CELLS, ELEVATION_GRIDS, FULL_SKY_SR, HORIZON_GROWTH, MAX_CELLS, MAX_SUB, PROXY_TOL,
                          PSR_PIXEL, SLOPE_GRIDS, SearchTooLarge, _cell_max, _cell_mean, _finest_xy, _run_from_start,
                          _sample_horizon)
from .db.landings import measured_landings
from .db.store import DataStore
from .logic import areas as A
from .logic import bounds as B
from .logic import suitability as S
from .logic.eclipse import obscuration
from .logic.engine import AnalysisParams, compute_metrics, make_model, time_grid
from .logic.horizon import ray_distances
from .logic.power import array_power_w, energy_balance, load_series_w, params_from_flat
from .logic.projection import great_circle_km, south_polar_latlon, south_polar_xy
from .schemas.areas import GridInfo, WindowInfo
from .schemas.suitability import (BoundInfo, FunnelStep, Layer, NearFeature, SiteCategory, SiteCriterion,
                                  SuitabilityRequest, SuitabilityResponse, TopSite)

FAIL_BOUND = 5
STAGE_ORDER = ("geometry", "regional", "medium", "fine")
#: window criterion id -> key of the per-sample values
WINDOW_KEY = {"battery_autonomy_h": "dark", "recharge_h": "recharge", "battery_model": "battery_ok",
              "blackout_h": "blackout", "sun_el_at_landing_deg": "sun_el0", "earth_at_landing": "earth0"}
WINDOW_VALUE_KEYS = ("sunlit", "comms", "dark", "blackout", "sun_el0", "earth0", "recharge", "battery_ok", "min_soc")
PSR_MAX_GRID = 1400        # most cells per side of the padded PSR distance grid
NEAR_FEATURE_KM = 100.0


class SuitabilityInputError(ValueError):
    def __init__(self, errors: list[str]):
        super().__init__("; ".join(errors))
        self.errors = errors


def _k_scale(lat):
    """Polar stereographic scale factor: map distance / ground distance."""
    return 2.0 / (1.0 + np.sin(np.radians(-np.asarray(lat, dtype=np.float64))))


def search(store: DataStore, req: SuitabilityRequest) -> SuitabilityResponse:
    t0 = time.perf_counter()
    crit = {c.id: c for c in req.criteria}

    # ---- validation (422)
    errors = S.validate_inputs(list(req.categories), req.criteria, req.priority)
    feature = None
    if "target_distance_km" in crit and not errors:
        name = str(crit["target_distance_km"].params.get("feature", ""))
        feature = store.nomenclature.find(name) if store.nomenclature and store.nomenclature.available else None
        if feature is None:
            errors.append(f"target_distance_km: unknown feature name '{name}' (IAU names, GET /api/v1/suitability/features)")
    cell_m = req.cell_km * 1000.0
    radius_m = req.region.radius_km * 1000.0
    n = int(math.ceil(2.0 * radius_m / cell_m))
    if n * n > MAX_CELLS:
        errors.append(f"{n * n} cells: make cell_km larger or the region smaller (limit {MAX_CELLS})")
    if errors:
        raise SuitabilityInputError(errors)

    # ---- raster (as area_search)
    reg = req.region
    lon_c = ((reg.center_lon + 180.0) % 360.0) - 180.0
    x0, y0 = (float(v) for v in south_polar_xy(np.array(reg.center_lat), np.array(lon_c)))
    x_left, y_top = x0 - n * cell_m / 2.0, y0 + n * cell_m / 2.0
    xs = x_left + (np.arange(n) + 0.5) * cell_m
    ys = y_top - (np.arange(n) + 0.5) * cell_m
    gx, gy = np.meshgrid(xs, ys)
    inside = (gx - x0) ** 2 + (gy - y0) ** 2 <= radius_m ** 2
    clat, clon = south_polar_latlon(gx, gy)
    kscale = _k_scale(clat)

    failed = np.zeros((n, n), np.uint8)
    unknown = np.zeros((n, n), bool)
    values: dict[str, np.ndarray] = {}
    funnel: list[FunnelStep] = []
    assumptions: list[str] = []
    sub_sizes: dict[str, int] = {}

    def alive() -> np.ndarray:
        return inside & (failed == 0)

    def apply(cid: str, stage: str, vals: np.ndarray, ok: np.ndarray, code: int, seconds: float) -> None:
        a = alive()
        unk = a & np.isnan(vals)
        bad = a & ~np.isnan(vals) & ~ok
        failed[bad] = code
        if not req.unknown_passes:
            unknown[unk] = True
        funnel.append(FunnelStep(id=cid, stage=stage, cells_in=int(a.sum()), cells_out=int(bad.sum()),
                                 cells_unknown=int(unk.sum()), seconds=round(seconds, 4)))

    def sub(fid: str, grid_ids: tuple[str, ...], reduce, bilinear: bool = False, mask: np.ndarray | None = None) -> np.ndarray:
        """Per-cell value of the cells in mask (default alive): a k x k sub-grid read from the finest grid, reduced."""
        out = np.full((n, n), np.nan)
        sel = np.flatnonzero(alive() if mask is None else mask)
        known = [g for g in grid_ids if g in store.grids.index["grids"]]
        if sel.size == 0 or not known:
            return out
        pix = min(float(store.grids.meta(g)["pixelM"]) for g in known)
        k = int(min(MAX_SUB, max(1, math.ceil(cell_m / pix - 1e-9))))
        sub_sizes[fid] = k
        off = ((np.arange(k) + 0.5) / k - 0.5) * cell_m
        flat = out.reshape(-1)
        for a in range(0, sel.size, CHUNK_CELLS):
            idx = sel[a:a + CHUNK_CELLS]
            px = gx.reshape(-1)[idx][:, None, None] + off[None, None, :]
            py = gy.reshape(-1)[idx][:, None, None] - off[None, :, None]
            px, py = np.broadcast_arrays(px, py)
            flat[idx] = reduce(_finest_xy(store, grid_ids, px.reshape(idx.size, k * k), py.reshape(idx.size, k * k), bilinear))
        return out

    # ---- evaluators of the static criteria: ev() -> (n, n) values, NaN where unknown or not read
    def ev_side() -> np.ndarray:
        near = np.abs(clon) <= 90.0
        return np.where(near if crit["side"].choice == "near" else ~near, 1.0, 0.0)

    def ev_past_landings() -> np.ndarray:
        d = np.full((n, n), np.inf)
        for _, la, lo in measured_landings(store.data_dir):
            d = np.minimum(d, great_circle_km(clat, clon, la, lo))
        return d

    def ev_target() -> np.ndarray:
        return great_circle_km(clat, clon, feature[1], feature[2])

    def ev_slope() -> np.ndarray:
        return sub("max_slope_deg", SLOPE_GRIDS, _cell_max)

    def ev_avoid_psr() -> np.ndarray:
        worst = sub("avoid_psr", ("permanent_shadow_65s",), _cell_max)
        return np.where(np.isnan(worst), np.nan, (worst <= 0.0).astype(float))

    def ev_dose() -> np.ndarray:
        sky = sub("dose_mgy", ("sky_visibility_65s",), _cell_mean)
        rate = store.radiation.gcr_free_space_mean() if store.radiation else None
        assumptions.append("Dose: mean CRaTER galactic-cosmic-ray rate (free space) x open sky / 4 pi x window days; no solar storms.")
        return np.full((n, n), np.nan) if rate is None else rate * (sky / FULL_SKY_SR) * (req.duration_h / 24.0)

    def ev_hydrogen() -> np.ndarray:
        assumptions.append("Hydrogen: Lunar Prospector neutron spectrometer map (Feldman et al. 2001), 0.5 deg bins with a "
                           "footprint of about 45 km, so it marks regions, not single cells.")
        return sub("hydrogen_ppm", ("lp_hydrogen_60s",), _cell_mean)

    def ev_psr_distance() -> np.ndarray:
        cap_km = min(100.0, float(crit["psr_distance_km"].limit))
        p = int(math.ceil(cap_km * 1000.0 / cell_m))
        side = n + 2 * p
        step = max(1, int(math.ceil(side / PSR_MAX_GRID)))
        c2 = cell_m * step
        m = int(math.ceil(side / step))
        pxs = (x_left - p * cell_m) + (np.arange(m) + 0.5) * c2
        pys = (y_top + p * cell_m) - (np.arange(m) + 0.5) * c2
        px, py = np.meshgrid(pxs, pys)
        shade = _finest_xy(store, ("permanent_shadow_65s",), px, py, False)
        psr = np.nan_to_num(shade, nan=0.0) >= PSR_PIXEL
        d = S.edt_cells(psr, cap_km * 1000.0 / c2 * 1.07 + 1) * c2      # map metres (scale factor up to 1.07)
        # back to the n x n cells by nearest centre of the (possibly coarser) padded grid
        ci = np.clip(((gx - (x_left - p * cell_m)) // c2).astype(int), 0, m - 1)
        ri = np.clip((((y_top + p * cell_m) - gy) // c2).astype(int), 0, m - 1)
        dm = d[ri, ci] / kscale / 1000.0                                  # ground km
        own = shade[ri, ci]
        if step > 1:
            assumptions.append(f"PSR distance computed on a {c2 / 1000:.2f} km grid (resolution limit).")
        assumptions.append(f"Near permanent shadow: distance to the nearest 960 m PGDA pixel at least {PSR_PIXEL:.0%} in "
                           f"permanent shadow; beyond {cap_km:g} km reported as farther.")
        dm = np.where(np.isinf(dm), cap_km + c2 / 1000.0, dm)
        return np.where(np.isnan(own) & (dm > cap_km), np.nan, dm)

    crater_cache: dict[str, tuple] = {}

    def big_craters(reach_radii: float = 0.0, pad_m: float = 0.0):
        """Robbins (2018) craters at least twice the cell size whose disc grown by reach_radii radii plus pad_m can
        touch the raster: (x, y, radius_m ground)."""
        if not store.craters.available:
            return None
        if "all" not in crater_cache:
            c = store.craters._load()
            keep = (c["diam_km"] * 1000.0 >= 2.0 * cell_m) & (c["lat"] <= -55.0)
            cx, cy = south_polar_xy(c["lat"][keep], c["lon"][keep])
            crater_cache["all"] = (cx, cy, c["diam_km"][keep] * 500.0)
        cx, cy, r = crater_cache["all"]
        grow = (1.0 + reach_radii) * r * 1.07 + pad_m
        near = ((cx + grow >= x_left) & (cx - grow <= x_left + n * cell_m)
                & (cy + grow >= y_top - n * cell_m) & (cy - grow <= y_top))
        return cx[near], cy[near], r[near]

    def ev_crater_cover() -> np.ndarray:
        r_land = (req.landing_radius_km or 0.0) * 1000.0 / cell_m
        cr = big_craters(0.0, (math.ceil(r_land) + 1) * cell_m)
        if cr is None:
            return np.full((n, n), np.nan)
        p = int(math.ceil(r_land)) + 1
        m = n + 2 * p
        px = (x_left - p * cell_m) + (np.arange(m) + 0.5) * cell_m
        py = (y_top + p * cell_m) - (np.arange(m) + 0.5) * cell_m
        kk = _k_scale(south_polar_latlon(*np.meshgrid(px, py))[0])
        covered = np.zeros((m, m), bool)
        for xc, yc, r in zip(*cr):
            rm = r * 1.07                                   # map radius bound for the window of cells to test
            j0 = max(0, int((xc - rm - px[0]) // cell_m)); j1 = min(m, int((xc + rm - px[0]) // cell_m) + 2)
            i0 = max(0, int((py[0] - (yc + rm)) // cell_m)); i1 = min(m, int((py[0] - (yc - rm)) // cell_m) + 2)
            if j0 >= j1 or i0 >= i1:
                continue
            dx = px[j0:j1][None, :] - xc
            dy = py[i0:i1][:, None] - yc
            covered[i0:i1, j0:j1] |= np.hypot(dx, dy) / kk[i0:i1, j0:j1] <= r
        if r_land > 0:
            frac = A.count_within(covered.astype(float), r_land) / A.disc(r_land).sum()
        else:
            frac = covered.astype(float)
        assumptions.append("Crater cover: Robbins (2018) craters at least twice the cell size filled as discs; share of the "
                           + ("landing ellipse disc" if r_land > 0 else "cell") + " inside them.")
        return frac[p:p + n, p:p + n] * 100.0

    def ev_rim_margin() -> np.ndarray:
        cap = float(crit["rim_margin_radii"].limit) + 1.0
        cr = big_craters(cap)
        if cr is None:
            return np.full((n, n), np.nan)
        out = np.full((n, n), cap)
        for xc, yc, r in zip(*cr):
            reach = (1.0 + cap) * r * 1.07
            j0 = max(0, int((xc - reach - xs[0]) // cell_m)); j1 = min(n, int((xc + reach - xs[0]) // cell_m) + 2)
            i0 = max(0, int((ys[0] - (yc + reach)) // cell_m)); i1 = min(n, int((ys[0] - (yc - reach)) // cell_m) + 2)
            if j0 >= j1 or i0 >= i1:
                continue
            d = np.hypot(gx[i0:i1, j0:j1] - xc, gy[i0:i1, j0:j1] - yc) / kscale[i0:i1, j0:j1]
            np.minimum(out[i0:i1, j0:j1], np.abs(d - r) / r, out=out[i0:i1, j0:j1])
        assumptions.append(f"Rim margin: distance to the rim of the nearest Robbins (2018) crater at least twice the cell "
                           f"size, in crater radii; values of {cap:g} mean at least {cap:g}.")
        return out

    EVAL = {"side": ev_side, "past_landings": ev_past_landings, "target_distance_km": ev_target,
            "max_slope_deg": ev_slope, "avoid_psr": ev_avoid_psr, "dose_mgy": ev_dose, "hydrogen_ppm": ev_hydrogen,
            "psr_distance_km": ev_psr_distance, "crater_cover_pct": ev_crater_cover, "rim_margin_radii": ev_rim_margin}

    def run_stage(stage: str) -> None:
        for spec in S.CATALOGUE_LIST:
            if spec.id in crit and spec.stage == stage and spec.id in EVAL:
                t1 = time.perf_counter()
                v = EVAL[spec.id]()
                values[spec.id] = v
                apply(spec.id, stage, v, S.passes(spec, v, crit[spec.id]), 1, time.perf_counter() - t1)

    # ---- 0. geometry
    run_stage("geometry")

    # ---- 1. ephemeris bound
    start_ms = req.start.astimezone(timezone.utc).timestamp() * 1000.0
    bounded = [cid for cid in crit if S.CATALOGUE[cid].bounded]
    bound_info = None
    if req.use_bounds and bounded and alive().any():
        bound_info = _bound_stage(store, req, crit, bounded, n, cell_m, x_left, y_top, inside, alive, failed, sub,
                                  funnel, assumptions, start_ms)

    # ---- 2-4. regional, medium, fine
    for stage in ("regional", "medium", "fine"):
        run_stage(stage)

    # ---- 5. landing radius
    if req.landing_radius_km is not None:
        t1 = time.perf_counter()
        near_fail = A.dilate(failed == 1, req.landing_radius_km * 1000.0 / cell_m)
        a = alive()
        hit = a & near_fail
        failed[hit] = 1
        funnel.append(FunnelStep(id="landing_radius_km", stage="landing_radius", cells_in=int(a.sum()),
                                 cells_out=int(hit.sum()), cells_unknown=0, seconds=round(time.perf_counter() - t1, 4)))
        assumptions.append(f"Landing radius {req.landing_radius_km} km: a cell survives only if no cell failing a static "
                           "criterion lies within it; near the edge of the region only the inside is checked.")

    # ---- 6. window
    params = AnalysisParams(panel=req.panel, comms_min_fraction=req.comms_min_fraction)
    window_ids = [cid for cid in crit if S.CATALOGUE[cid].stage == "window"]
    want_window = bool(window_ids) or "power" in req.categories or "earth" in req.categories
    battery = None
    if "battery_model" in crit:
        flat = {k: float(v) for k, v in crit["battery_model"].params.items()}
        battery = params_from_flat(flat)
        assumptions.append("Battery model: the same hour-by-hour balance as POST /api/v1/power level 3 (eclipses "
                           f"included, {req.panel} panel); a sample passes when no load is ever left unserved.")

    def window_values(model, t0_ms: float) -> dict[str, float]:
        series = services.evaluate_window(store, model, t0_ms, req.duration_h, req.step_min, params)
        met = compute_metrics(series, params)
        step_h = series.step_ms / 3_600_000.0
        run = S.shortest_checked_run(series.sunlit())
        v = {"sunlit": met.sunlight_pct / 100.0, "comms": met.comms_pct / 100.0, "dark": met.longest_dark_h,
             "blackout": met.longest_blackout_h, "sun_el0": float(series.sun_el[0]),
             "earth0": float(series.comms(params)[0]), "recharge": math.inf if run is None else run * step_h,
             "battery_ok": math.nan, "min_soc": math.nan}
        if battery is not None:
            array, bat, load = battery
            pw = array_power_w(series.power_w_m2, array) * (1.0 - obscuration(series))
            bal = energy_balance(series.t_ms, pw, load_series_w(series.sunlit(), load), bat)
            v["battery_ok"], v["min_soc"] = float(bal.survived), float(bal.min_soc)
        return v

    def hard_ok(v: dict) -> bool:
        for cid in window_ids:
            spec = S.CATALOGUE[cid]
            if not bool(S.passes(spec, np.array(v[WINDOW_KEY[cid]]), crit[cid])):
                return False
        return True

    def one(i: int, j: int) -> dict | None:
        la, lo = float(clat[i, j]), float(clon[i, j])
        g = float(_finest_xy(store, ELEVATION_GRIDS, gx[i, j:j + 1], gy[i, j:j + 1], True)[0])
        if np.isnan(g):
            return None
        hz = _sample_horizon(store, la, lo, g, req.mast_m, req.horizon_az_step_deg, req.horizon_radius_km * 1000.0)
        model = make_model(la, lo, g, hz, req.mast_m)
        v = window_values(model, start_ms)
        if req.robust_delay_h is not None and window_ids:
            v["delayed"] = window_values(model, start_ms + req.robust_delay_h * 3_600_000.0)
        return v

    def outcome_of(v: dict | None) -> int:
        if v is None:
            return 2
        return int(hard_ok(v) and ("delayed" not in v or hard_ok(v["delayed"])))

    window = None
    cells_win: dict[str, np.ndarray] = {}
    pool = ThreadPoolExecutor(max_workers=max(1, min(8, os.cpu_count() or 1)))
    try:
        if want_window and alive().any():
            t1 = time.perf_counter()

            def evaluate(rows: np.ndarray, cols: np.ndarray):
                vals = list(pool.map(one, rows.tolist(), cols.tolist()))
                return vals, [outcome_of(v) for v in vals]

            lt_sun = sub("proxy_long_term_sun", ("sun_illumination_65s",), _cell_mean)
            lt_earth = sub("proxy_long_term_earth", ("earth_visibility_65s",), _cell_mean)
            rows, cols, vals, outcome, leaves, owner = A.quadtree_samples(
                alive(), evaluate, req.max_window_samples, proxies=(lt_sun, lt_earth), proxy_tol=PROXY_TOL)
            for key in WINDOW_VALUE_KEYS:
                per = np.array([np.nan if v is None else v[key] for v in vals], dtype=float)
                cells_win[key] = np.where(owner >= 0, per[np.maximum(owner, 0)], np.nan) if per.size else np.full((n, n), np.nan)
            secs = time.perf_counter() - t1
            for spec in S.CATALOGUE_LIST:
                if spec.id in window_ids:
                    v = cells_win[WINDOW_KEY[spec.id]]
                    values[spec.id] = v
                    apply(spec.id, "window", v, S.passes(spec, v, crit[spec.id]), 2, secs)
                    secs = 0.0
            if req.robust_delay_h is not None and window_ids:
                per = np.array([np.nan if v is None else float(hard_ok(v["delayed"])) for v in vals], dtype=float)
                late = np.where(owner >= 0, per[np.maximum(owner, 0)], np.nan) if per.size else np.full((n, n), np.nan)
                apply("robust_delay_h", "window", late, late > 0.5, 2, 0.0)
                assumptions.append(f"Robust to a delay: the window criteria pass for the planned start and for a landing "
                                   f"{req.robust_delay_h} h later (same duration, same horizon).")
            sizes = [lf.size for lf in leaves] or [1]
            window = WindowInfo(samples=int(rows.size), finest_tile_km=round(min(sizes) * req.cell_km, 3),
                                coarsest_tile_km=round(max(sizes) * req.cell_km, 3),
                                horizon_az_step_deg=req.horizon_az_step_deg, horizon_radius_km=req.horizon_radius_km)
            assumptions.append(
                f"Window criteria: {rows.size} samples placed by a quadtree (tiles from {max(sizes) * req.cell_km:.2f} km down "
                f"to {min(sizes) * req.cell_km:.2f} km); each sample has a horizon ray-traced over LOLA every "
                f"{req.horizon_az_step_deg} deg out to {req.horizon_radius_km:.0f} km and the cells of a tile share it.")

        # ---- final codes
        code = np.where(inside, A.VIABLE, A.OUTSIDE).astype(np.uint8)
        code[unknown & inside] = A.UNKNOWN
        code[failed > 0] = failed[failed > 0]
        viable = code == A.VIABLE
        scored = (code == A.VIABLE) | (code == A.UNKNOWN)

        # ---- category layers
        layer_u: dict[str, np.ndarray] = {}
        if "power" in req.categories and "sunlit" in cells_win:
            layer_u["power"] = cells_win["sunlit"]
        if "earth" in req.categories and "comms" in cells_win:
            layer_u["earth"] = cells_win["comms"]
        topo = []
        if "max_slope_deg" in crit and crit["max_slope_deg"].limit > 0:
            topo.append(np.clip(1.0 - values["max_slope_deg"] / crit["max_slope_deg"].limit, 0.0, 1.0))
        if "crater_cover_pct" in crit and crit["crater_cover_pct"].limit > 0:
            topo.append(np.clip(1.0 - values["crater_cover_pct"] / crit["crater_cover_pct"].limit, 0.0, 1.0))
        if topo:
            layer_u["topography"] = _nanmean(topo)
        sci = []
        for cid in ("psr_distance_km", "target_distance_km"):
            if cid in crit:
                sci.append(S.closeness(values[cid], float(crit[cid].limit)))
        if "past_landings" in crit and crit["past_landings"].choice == "near":
            sci.append(S.closeness(values["past_landings"], float(crit["past_landings"].limit)))
        if "hydrogen_ppm" in crit:
            h = values["hydrogen_ppm"]
            lim = float(crit["hydrogen_ppm"].limit)
            hv = h[viable & ~np.isnan(h)]
            h_best = float(hv.max()) if hv.size else lim
            sci.append(np.where(np.isnan(h), np.nan, 1.0 if h_best <= lim else np.clip((h - lim) / (h_best - lim), 0.0, 1.0)))
        if sci:
            layer_u["science"] = _nanmean(sci)
        if "dose_mgy" in crit and crit["dose_mgy"].limit > 0:
            layer_u["radiation"] = np.clip(1.0 - values["dose_mgy"] / crit["dose_mgy"].limit, 0.0, 1.0)

        order = S.ordered_scored(list(req.categories), req.priority, set(layer_u))
        w = S.roc_weights(len(order)) if order else np.zeros(0)
        weights = {cid: float(wi) for cid, wi in zip(order, w)}
        qs = []
        layers: list[Layer] = []
        for cid, wi in zip(order, w):
            u = np.where(scored, layer_u[cid], np.nan)
            q = S.quantize_utility(u)
            q[~scored] = 255
            qs.append(q)
            layers.append(Layer(category=cid, label=S.CATEGORY_TITLE[cid], measure=S.CATEGORY_SCORE[cid] or "",
                                weight=float(wi), utility_b64=base64.b64encode(q.tobytes()).decode("ascii")))
        score, coverage = S.score_from_quantized(qs, w)
        if score is None:
            score = np.where(scored, 1.0, 0.0)
            coverage = np.where(scored, 1.0, 0.0)
        score_u8 = S.score_u8(score, viable)
        limiting = np.full((n, n), 255, np.uint8)
        if qs:
            cost = np.stack([np.where(q != 255, wi * (1.0 - q / 250.0), -1.0) for q, wi in zip(qs, w)])
            best = np.argmax(cost, axis=0)
            has = (cost.max(axis=0) >= 0) & scored
            limiting[has] = best[has].astype(np.uint8)

        # ---- sites
        sites, dropped = _sites(store, req, crit, n, cell_m, inside, viable, score, coverage, gx, gy, clat, clon, kscale,
                                values, layer_u, order, w, cells_win, window_ids, one, pool, hard_ok)
    finally:
        pool.shutdown()

    counts = {name: int((code == c).sum()) for name, c in (("outside", A.OUTSIDE), ("failed_static", A.FAIL_STATIC),
                                                          ("failed_window", A.FAIL_WINDOW), ("viable", A.VIABLE),
                                                          ("unknown", A.UNKNOWN), ("failed_bound", FAIL_BOUND))}
    if sub_sizes:
        assumptions.append("Static criteria read a k x k sub-grid per cell from the finest grid covering it ("
                           + ", ".join(f"{k}: {v} x {v}" for k, v in sub_sizes.items() if not k.startswith(("proxy", "bound")))
                           + "): slope and permanent shadow take the worst sample, the rest the mean.")
    if order:
        assumptions.append("Score: categories weighted by rank order centroid in the priority order ("
                           + ", ".join(f"{S.CATEGORY_TITLE[c]} {weights[c]:.0%}" for c in order) + ").")
    return SuitabilityResponse(
        grid=GridInfo(projection="south polar stereographic, true scale at the pole, R = 1737400 m, MOON_ME",
                      x_left_m=x_left, y_top_m=y_top, cell_m=cell_m, nx=n, ny=n),
        codes_b64=base64.b64encode(code.tobytes()).decode("ascii"),
        score_b64=base64.b64encode(score_u8.tobytes()).decode("ascii"),
        limiting_b64=base64.b64encode(limiting.tobytes()).decode("ascii"),
        layers=layers, weights=weights, counts=counts, funnel=funnel, bound=bound_info, window=window,
        sites=sites, sites_dropped=dropped, seconds=round(time.perf_counter() - t0, 3), assumptions=assumptions)


def _nanmean(parts: list[np.ndarray]) -> np.ndarray:
    st = np.stack(parts)
    ok = ~np.isnan(st)
    cnt = ok.sum(axis=0)
    return np.where(cnt > 0, np.where(ok, st, 0.0).sum(axis=0) / np.maximum(cnt, 1), np.nan)


def _bound_stage(store, req, crit, bounded, n, cell_m, x_left, y_top, inside, alive, failed, sub, funnel, assumptions,
                 start_ms) -> BoundInfo:
    """Stage 1 (spec 8.4.7): drop the tiles where the ephemeris bound proves a bounded window criterion fails."""
    t1 = time.perf_counter()
    t = time_grid(start_ms, req.duration_h, req.step_min)
    grids_t = [(t, "planned")]
    if req.robust_delay_h is not None:
        grids_t.append((time_grid(start_ms + req.robust_delay_h * 3_600_000.0, req.duration_h, req.step_min), "delayed"))
    step_h = req.step_min / 60.0
    h_min = min(float(store.grids.meta(g)["min"]) for g in ELEVATION_GRIDS) - B.ELEV_MARGIN_M
    ray_sets = [ray_distances(float(store.grids.meta(g)["pixelM"]), req.horizon_radius_km * 1000.0, HORIZON_GROWTH)
                for g in ELEVATION_GRIDS]
    cell_top = sub("bound_top", ELEVATION_GRIDS, _cell_max, mask=inside)
    ring_top = -S.min_filter_square(-cell_top, 1)
    top = ring_top + req.mast_m + B.ELEV_MARGIN_M
    t_cells = 1
    while t_cells * 2 * cell_m / 1000.0 <= 32.0:
        t_cells *= 2
    levels = [t_cells]
    while levels[-1] > 1 and (levels[-1] // 2) * cell_m / 1000.0 >= 3.84:
        levels.append(levels[-1] // 2)
    ephs = [(store.ephemeris.positions(tt), tag) for tt, tag in grids_t]
    order_ids = [c.id for c in S.CATALOGUE_LIST if c.id in bounded]

    def fails(tb) -> np.ndarray:
        out = np.zeros(tb.sun_share_ub.shape, dtype=np.int16) - 1   # index into order_ids of the first failing, -1 none
        for k, cid in enumerate(order_ids):
            c = crit[cid]
            if cid == "battery_autonomy_h":
                f = tb.dark_lb_h > c.limit
            elif cid == "blackout_h":
                f = tb.blackout_lb_h > c.limit
            elif cid == "sun_el_at_landing_deg":
                f = np.zeros(tb.sun_share_ub.shape, bool)
                if c.min is not None:
                    f |= tb.sun_el0_max < c.min
                if c.max is not None:
                    f |= tb.sun_el0_min > c.max
            elif cid == "earth_at_landing":
                f = ~tb.earth0_possible
            else:
                continue
            out = np.where((out < 0) & f, k, out)
        return out

    parent_failed: np.ndarray | None = None      # boolean per (n, n) cell: inside a tile proven failed
    tiles_evaluated = 0
    tile_km = []
    by: dict[str, int] = {}
    newly = np.zeros((n, n), bool)
    first_fail = np.full((n, n), -1, np.int16)
    for T in levels:
        a = alive() & ~newly
        if not a.any():
            break
        ii, jj = np.nonzero(a)
        keys = np.unique((ii // T) * (n // T + 1) + (jj // T))
        ti, tj = keys // (n // T + 1), keys % (n // T + 1)
        if keys.size * len(t) > 50_000_000:
            assumptions.append(f"Ephemeris bound stopped at {T * cell_m / 1000:.2f} km tiles (budget).")
            break
        i0, j0 = ti * T, tj * T
        h = np.minimum(T, n - j0)
        hh = np.minimum(T, n - i0)
        xc = x_left + (j0 + h / 2.0) * cell_m
        yc = y_top - (i0 + hh / 2.0) * cell_m
        lat, lon = south_polar_latlon(xc, yc)
        theta = np.degrees(np.hypot(h, hh) * cell_m / 2.0 / B.R_M)
        top_tile = np.array([np.nan if np.all(np.isnan(blk := top[a0:a0 + T, b0:b0 + T])) else np.nanmax(blk)
                             for a0, b0 in zip(i0, j0)])
        first = np.full(keys.size, -1, np.int16)
        for (eph, _tag) in ephs:
            tb = B.tile_bounds(lat, lon, theta, top_tile, h_min, ray_sets, eph[:, 0:3], eph[:, 3:6], step_h)
            f = fails(tb)
            first = np.where(first < 0, f, first)
        tiles_evaluated += int(keys.size)
        tile_km.append(round(T * cell_m / 1000.0, 3))
        for k in np.flatnonzero(first >= 0):
            blk = (slice(i0[k], i0[k] + T), slice(j0[k], j0[k] + T))
            sel = a[blk] & ~newly[blk]
            newly[blk] |= sel
            first_fail[blk] = np.where(sel, first[k], first_fail[blk])
    cells_in = int(alive().sum())
    hit = alive() & newly
    failed[hit] = FAIL_BOUND
    for k, cid in enumerate(order_ids):
        cnt = int((hit & (first_fail == k)).sum())
        if cnt:
            by[cid] = cnt
    funnel.append(FunnelStep(id="ephemeris_bound", stage="bound", cells_in=cells_in, cells_out=int(hit.sum()),
                             cells_unknown=0, seconds=round(time.perf_counter() - t1, 4)))
    if tile_km:
        assumptions.append(f"Ephemeris bound: tiles from {tile_km[0]} km to {tile_km[-1]} km; a tile is dropped only when no "
                           f"part of the Sun (or Earth) can be above any horizon that terrain at or above {h_min:.0f} m can "
                           f"make (rays as the window samples, +{B.ELEV_MARGIN_M:.0f} m height margin, +{B.MARGIN_DEG} deg).")
    return BoundInfo(tile_km=tile_km, tiles_evaluated=tiles_evaluated, cells_proven_failed=int(hit.sum()),
                     by_criterion=by, h_min_m=h_min, elev_margin_m=B.ELEV_MARGIN_M, margin_deg=B.MARGIN_DEG)


def _near_feature(store: DataStore, lat: float, lon: float) -> NearFeature | None:
    if not store.nomenclature or not store.nomenclature.available:
        return None
    a = store.nomenclature.arrays()
    south = a["lat"] < -55.0
    if not south.any():
        return None
    idx = np.flatnonzero(south)
    d = great_circle_km(lat, lon, a["lat"][idx], a["lon"][idx])
    dmin = float(d.min())
    if dmin > NEAR_FEATURE_KM:
        return None
    close = idx[d <= dmin + 1.0]
    diam = np.nan_to_num(a["diameter_km"][close], nan=0.0)
    i = int(close[np.argmax(diam)])
    dist = float(great_circle_km(lat, lon, a["lat"][i], a["lon"][i]))
    return NearFeature(name=str(a["name"][i]), distance_km=round(dist, 2),
                       bearing_deg=round(S.initial_bearing_deg(a["lat"][i], a["lon"][i], lat, lon), 1))


def _sites(store, req, crit, n, cell_m, inside, viable, score, coverage, gx, gy, clat, clon, kscale, values, layer_u,
           order, w, cells_win, window_ids, one, pool, hard_ok):
    """Stage 7 (spec 8.4.12): pick well-separated high-scoring cells, re-evaluate the window exactly at each one."""
    clear = S.edt_cells(~viable & inside, max_cells=200) * cell_m / 1000.0
    clear = np.where(np.isinf(clear), 200 * cell_m / 1000.0, clear)
    r = int(math.ceil((req.landing_radius_km or 0.0) * 1000.0 / cell_m))
    area = S.min_filter_square(np.where(inside, np.where(viable, score, 0.0), np.nan), r) if r > 0 else score.copy()
    cand = np.where(viable, area, np.nan)
    windowed = bool(cells_win)
    n_picks = 3 * req.top_k if windowed else req.top_k
    picks = S.pick_sites(cand, clear, gx, gy, kscale, req.min_separation_km * 1000.0, n_picks)
    dropped = 0
    accepted: list[tuple[int, int, dict | None]] = []
    if windowed:
        for b in range(0, len(picks), req.top_k):
            batch = picks[b:b + req.top_k]
            exact = list(pool.map(lambda ij: one(*ij), batch))
            for (i, j), v in zip(batch, exact):
                if len(accepted) == req.top_k:
                    break
                if v is not None and window_ids and not (hard_ok(v) and ("delayed" not in v or hard_ok(v["delayed"]))):
                    dropped += 1
                    continue
                accepted.append((i, j, v))
            if len(accepted) == req.top_k:
                break
    else:
        accepted = [(i, j, None) for i, j in picks]

    out: list[TopSite] = []
    for i, j, v in accepted:
        utils = {cid: (None if np.isnan(layer_u[cid][i, j]) else float(layer_u[cid][i, j])) for cid in order}
        if v is not None:
            if "power" in utils:
                utils["power"] = float(v["sunlit"])
            if "earth" in utils:
                utils["earth"] = float(v["comms"])
        qs = [np.array([255 if u is None else int(np.floor(u * 250.0 + 0.5))], np.uint8) for u in utils.values()]
        sc, cov = S.score_from_quantized(qs, w)
        s_exact = 1.0 if sc is None else float(sc[0])
        cov_v = 1.0 if cov is None else float(cov[0])
        cats = [SiteCategory(category=cid, label=S.CATEGORY_TITLE[cid], utility=None if utils[cid] is None else round(utils[cid], 4),
                             weight=round(float(wi), 6), contribution=None if utils[cid] is None else round(float(wi) * utils[cid], 4))
                for cid, wi in zip(order, w)]
        pros, cons = S.pros_cons([{"id": cid, "utility": utils[cid], "weight": float(wi)} for cid, wi in zip(order, w)])
        crit_out, unk = [], []
        for spec in S.CATALOGUE_LIST:
            if spec.id not in crit:
                continue
            c = crit[spec.id]
            if spec.stage == "window":
                x = v[WINDOW_KEY[spec.id]] if v is not None else values.get(spec.id, np.full((n, n), np.nan))[i, j]
                if spec.id == "battery_model" and v is not None:
                    shown = v["min_soc"]
                else:
                    shown = x
            else:
                x = values[spec.id][i, j] if spec.id in values else np.nan
                shown = x
            x = float(x)
            known = not np.isnan(x)
            if not known:
                unk.append(spec.id)
            ok = bool(S.passes(spec, np.array(x), c)) if known else None
            val = None if (shown is None or not np.isfinite(shown) or spec.kind in ("choice", "flag") and spec.id != "battery_model") else round(float(shown), 4)
            crit_out.append(SiteCriterion(id=spec.id, label=spec.label, unit="state of charge" if spec.id == "battery_model" else spec.unit,
                                          value=val, passes=ok, margin=None if not known else _round(S.margin(spec, x, c))))
        out.append(TopSite(rank=0, lat=round(float(clat[i, j]), 5), lon=round(float(clon[i, j]), 5),
                           near=_near_feature(store, float(clat[i, j]), float(clon[i, j])),
                           score=round(s_exact, 4), area_score=round(min(float(area[i, j]), s_exact), 4),
                           coverage=round(cov_v, 4), clearance_km=round(float(clear[i, j]), 3),
                           window_exact=True if v is not None else None, horizon_kind="terrain" if v is not None else None,
                           categories=cats, criteria=crit_out, pros=pros, cons=cons, unknown=unk))
    out.sort(key=lambda s: (-s.area_score, -s.score, -s.clearance_km))
    for k, s in enumerate(out, 1):
        s.rank = k
    return out, dropped


def _round(x: float | None) -> float | None:
    return None if x is None else round(float(x), 4)
