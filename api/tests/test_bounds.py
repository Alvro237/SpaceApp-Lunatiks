"""Ephemeris visibility bound (app/logic/bounds.py): reference numbers, proof checks and safety against real LOLA
terrain. The full hourly validation is tests/validation_bounds.py (run by hand)."""
from __future__ import annotations

import numpy as np
import pytest

from app import area_search as AS
from app.db.store import get_store
from app.logic import bounds as B
from app.logic.horizon import ray_distances, skyline_from_heights
from app.logic.projection import south_polar_latlon, south_polar_xy
from tests import validation_bounds as V

R_M = B.R_M


# (top_m, h_min_m, floor with rays to 150 km, floor with rays to 1 000 km, tangent -arccos((R + h_min) / (R + top)))
REFERENCE = [
    (2000.0, 0.0, -2.7479, -2.7479, -2.7479),
    (2000.0, -9608.0, -6.8986, -6.6233, -6.6231),
    (7524.0, -9608.0, -8.9749, -8.0356, -8.0354),
    (0.0, -9608.0, -6.1420, -6.0285, -6.0284),
    (2.0, 0.0, -0.0869, -0.0869, -0.0869),
]


@pytest.mark.parametrize("top,h_min,f150,f1000,tangent", REFERENCE)
def test_floor_matches_reference_table(top, h_min, f150, f1000, tangent):
    assert B.horizon_floor_deg(top, h_min, ray_distances(240.0, 150_000.0, 1.02))[0] == pytest.approx(f150, abs=1e-3)
    assert B.horizon_floor_deg(top, h_min, ray_distances(240.0, 1_000_000.0, 1.02))[0] == pytest.approx(f1000, abs=1e-3)
    assert -np.degrees(np.arccos((R_M + h_min) / (R_M + top))) == pytest.approx(tangent, abs=1e-3)


@pytest.mark.parametrize("ground", [-5000.0, 0.0, 3000.0, 7000.0])
def test_floor_is_below_every_skyline_of_terrain_at_h_min(ground):
    rng = np.random.default_rng(7)
    h_min, mast = -9608.0, 2.0
    dist = ray_distances(960.0, 150_000.0, 1.02)
    heights = rng.uniform(h_min, h_min + 15_000.0, size=(50, dist.size))
    sky = skyline_from_heights(dist, heights, ground, mast)
    assert (sky >= B.horizon_floor_deg(ground + mast, h_min, dist)[0]).all()
    # the floor is reached by terrain that sits exactly at h_min everywhere
    flat_low = skyline_from_heights(dist, np.full((1, dist.size), h_min), ground, mast)
    assert flat_low[0] == pytest.approx(B.horizon_floor_deg(ground + mast, h_min, dist)[0], abs=1e-9)


def test_longest_run_and_run_from_start():
    flags = np.array([[1, 1, 0, 1, 1, 1, 0], [0] * 7, [1] * 7], dtype=bool)
    assert B.longest_run(flags).tolist() == [3, 0, 7]
    assert B.run_from_start(flags).tolist() == [2, 0, 7]


def test_bound_is_never_optimistic_against_lola_masks():
    res = V.check_real_masks(get_store(), stride=6)          # every 6th hour of 2025-2035 keeps the suite fast
    for body in ("sun", "earth"):
        t = res["total"][body]
        assert t["visible"] > 100_000                         # the check is not vacuous
        assert t["violations"] == 0, f"{body}: bound said impossible while the real skyline shows the body"
        assert t["margin"] >= V.PASS_MIN_MARGIN_DEG


def _window(store, days=14.0):
    return V.window_vectors(store, days)


@pytest.mark.parametrize("lat,lon", [(-75.0, 0.0), (-84.0, 60.0), (-88.0, -120.0)])
def test_tile_bound_contains_every_cell(lat, lon):
    store = get_store()
    sun, earth = _window(store)
    n_side, cell = 16, 960.0
    cx, cy = south_polar_xy(lat, lon)
    offs = (np.arange(n_side) - (n_side - 1) / 2.0) * cell
    gx, gy = np.meshgrid(cx + offs, cy + offs)
    gx, gy = gx.ravel(), gy.ravel()
    clat, clon = south_polar_latlon(gx, gy)
    ground = store.grids.bilinear_xy("lola_elevation_60s", gx, gy)
    assert not np.isnan(ground).any()
    half_diag = n_side * cell * np.sqrt(2.0) / 2.0
    theta = np.degrees(half_diag / R_M)                       # projected length >= ground length: conservative
    top_tile = float(ground.max()) + V.MAST_ZONE_M + B.ELEV_MARGIN_M
    hmin, sets = V.h_min_m(store), V.ray_sets()
    tb = B.tile_bounds(np.array([lat]), np.array([lon]), np.array([theta]), np.array([top_tile]), hmin, sets, sun, earth, 1.0)
    tfloor = np.min([B.horizon_floor_deg(np.array([top_tile]), hmin, d) for d in sets], axis=0)
    up_t = B.unit_vectors(np.array([lat]), np.array([lon]))
    ts = B.possible_visible(*B.body_elevation_and_radius(up_t, sun, B.SUN_R_KM), np.array([theta]), tfloor)[0]
    te = B.possible_visible(*B.body_elevation_and_radius(up_t, earth, B.EARTH_R_KM), np.array([theta]), tfloor)[0]
    up_c = B.unit_vectors(clat, clon)
    cfloor = np.min([B.horizon_floor_deg(ground + V.MAST_ZONE_M + B.ELEV_MARGIN_M, hmin, d) for d in sets], axis=0)
    el_s, r_s = B.body_elevation_and_radius(up_c, sun, B.SUN_R_KM)
    el_e, r_e = B.body_elevation_and_radius(up_c, earth, B.EARTH_R_KM)
    zeros = np.zeros(gx.size)
    cs = B.possible_visible(el_s, r_s, zeros, cfloor)
    ce = B.possible_visible(el_e, r_e, zeros, cfloor)
    assert not (cs & ~ts[None, :]).any() and not (ce & ~te[None, :]).any()      # possible(cell) implies possible(tile)
    assert (cs.mean(axis=1) <= tb.sun_share_ub[0] + 1e-12).all() and (ce.mean(axis=1) <= tb.earth_share_ub[0] + 1e-12).all()
    assert (B.longest_run(~cs) >= tb.dark_lb_h[0] - 1e-9).all() and (B.longest_run(~ce) >= tb.blackout_lb_h[0] - 1e-9).all()
    assert (B.run_from_start(cs) <= tb.light_left_ub_h[0] + 1e-9).all() and (B.run_from_start(ce) <= tb.contact_left_ub_h[0] + 1e-9).all()
    assert ((cs & ce).mean(axis=1) <= tb.both_share_ub[0] + 1e-12).all()
    assert (tb.sun_el0_min[0] <= el_s[:, 0]).all() and (el_s[:, 0] <= tb.sun_el0_max[0]).all()
    assert (ce[:, 0] <= tb.earth0_possible[0]).all()


def test_engine_samples_respect_the_floor():
    store = get_store()
    rng = np.random.default_rng(20261115)
    c_lat, c_lon = -85.5, 30.0
    cx, cy = south_polar_xy(c_lat, c_lon)
    rad = 30_000.0 * np.sqrt(rng.uniform(size=20))
    ang = rng.uniform(0.0, 2.0 * np.pi, size=20)
    xs, ys = cx + rad * np.cos(ang), cy + rad * np.sin(ang)
    lats, lons = south_polar_latlon(xs, ys)
    ground = AS._finest_xy(store, AS.ELEVATION_GRIDS, xs, ys, True)
    hmin, sets, mast = V.h_min_m(store), V.ray_sets(), 2.0
    for lat, lon, g in zip(lats, lons, ground):
        assert not np.isnan(g)
        floor = np.min([B.horizon_floor_deg(np.array([g + mast + B.ELEV_MARGIN_M]), hmin, d) for d in sets], axis=0)[0]
        prof = AS._sample_horizon(store, float(lat), float(lon), float(g), mast, 2.0, 150_000.0)
        assert prof.values.min() >= floor


def test_elevation_margin_still_covers_the_grids():
    g = get_store().grids
    fine, mf = g.float_array("lola_elevation_80s"), g.meta("lola_elevation_80s")
    coarse, mc = g.float_array("lola_elevation_60s"), g.meta("lola_elevation_60s")
    n = fine.shape[0]
    xs = mf["xLeftM"] + (np.arange(n) + 0.5) * mf["pixelM"]
    ys = mf["yTopM"] - (np.arange(n) + 0.5) * mf["pixelM"]
    X, Y = np.meshgrid(xs, ys)
    col = np.floor((X - mc["xLeftM"]) / mc["pixelM"]).astype(int)
    row = np.floor((mc["yTopM"] - Y) / mc["pixelM"]).astype(int)
    mx = np.full(coarse.shape, -np.inf)
    mn = np.full(coarse.shape, np.inf)
    cnt = np.zeros(coarse.shape, int)
    np.maximum.at(mx, (row.ravel(), col.ravel()), fine.ravel())
    np.minimum.at(mn, (row.ravel(), col.ravel()), fine.ravel())
    np.add.at(cnt, (row.ravel(), col.ravel()), 1)
    full = cnt == 16
    assert (mx - coarse)[full].max() < 450 and (coarse - mn)[full].max() < 450
    assert B.ELEV_MARGIN_M >= 450
