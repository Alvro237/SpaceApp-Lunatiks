"""Mission mode area search (logic.areas, app.area_search, POST /api/v1/areas/search): the raster helpers on
synthetic cases, the fast sample tracer against the point tracer, and the endpoint's funnel on real data."""
from __future__ import annotations

import base64
import math

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import area_search, services
from app.db.store import get_store
from app.logic import areas as A
from app.logic.horizon import (RAY_MAX_RANGE_M, destination, destination_south_polar_xy, horizon_from_heights,
                               ray_distances, skyline_from_heights)
from app.logic.projection import south_polar_xy
from app.main import app

client = TestClient(app)
URL = "/api/v1/areas/search"
SMALL = {"center_lat": -89.3, "center_lon": 60.0, "radius_km": 25.0}


def codes_of(body: dict) -> np.ndarray:
    g = body["grid"]
    return np.frombuffer(base64.b64decode(body["codes_b64"]), np.uint8).reshape(g["ny"], g["nx"])


# ---------------------------------------------------------------------------- raster helpers

def test_disc_and_dilation_are_exact_on_a_grid():
    assert A.disc(0.5).sum() == 1 and A.disc(1.0).sum() == 5 and A.disc(2.0).sum() == 13
    m = np.zeros((21, 21), bool)
    m[10, 10] = True
    d = A.dilate(m, 3.0)
    yy, xx = np.mgrid[0:21, 0:21]
    assert np.array_equal(d, (yy - 10) ** 2 + (xx - 10) ** 2 <= 9)


def test_count_within_sums_points_over_the_disc():
    pts = np.zeros((30, 30))
    pts[5, 5] = 2
    pts[5, 8] = 1
    c = A.count_within(pts, 3.0)
    assert c[5, 5] == 3 and c[5, 2] == 2 and c[5, 11] == 1 and c[20, 20] == 0


def test_label_joins_diagonal_neighbours():
    m = np.zeros((6, 6), bool)
    m[0, 0] = m[1, 1] = True          # one component (8-connected)
    m[4, 4] = m[4, 5] = True          # another
    lab, n = A.label(m)
    assert n == 2 and lab[0, 0] == lab[1, 1] != lab[4, 4]


def _truth_disc(n: int = 128):
    yy, xx = np.mgrid[0:n, 0:n]
    return (xx - 70) ** 2 + (yy - 50) ** 2 < 30 ** 2


def test_quadtree_covers_every_survivor_and_converges():
    truth = _truth_disc()
    surv = np.ones(truth.shape, bool)
    surv[:, :10] = False
    calls = []

    def ev(r, c):
        calls.append(r.size)
        return [None] * r.size, truth[r, c].astype(int)

    errs = []
    for budget in (64, 256, 1024, 20_000):
        calls.clear()
        rows, cols, vals, out, leaves, owner = A.quadtree_samples(surv, ev, budget)
        assert sum(calls) == rows.size <= budget
        assert ((owner >= 0) == surv).all()          # every survivor belongs to one sample, nothing else does
        pred = out[np.maximum(owner, 0)] == 1
        errs.append(((pred != truth) & surv).sum() / surv.sum())
    assert errs[0] > errs[1] > errs[2] and errs[-1] == 0.0
    # against the same budget spread uniformly (tiles of 8 x 8 for 256 samples) the boundary error is smaller
    assert errs[1] < 0.03


def test_quadtree_proxy_splits_a_uniform_tile_hiding_a_feature():
    n = 64
    truth = np.zeros((n, n), bool)
    truth[40:43, 40:43] = True                        # a small feature the first coarse samples miss
    proxy = np.where(truth, 1.0, 0.0)
    surv = np.ones((n, n), bool)
    ev = lambda r, c: ([None] * r.size, truth[r, c].astype(int))
    *_, out0, _, owner0 = A.quadtree_samples(surv, ev, 64)
    *_, out1, _, owner1 = A.quadtree_samples(surv, ev, 64, proxies=(proxy,), proxy_tol=0.5)
    assert not (out0[owner0[truth]] == 1).any()
    assert (out1[owner1[truth]] == 1).any()


# ---------------------------------------------------------------------------- the sample tracer

def test_destination_straight_to_the_projection_matches_lat_lon():
    az = np.radians(np.arange(0, 360, 7.5))[:, None]
    dist = np.array([[50.0, 1_000.0, 30_000.0, 249_000.0]])
    for lat, lon in ((-89.95, 10.0), (-85.0, -120.0), (-62.0, 170.0)):
        la, lo = destination(math.radians(lat), math.radians(lon), az, dist)
        x0, y0 = south_polar_xy(np.degrees(la), np.degrees(lo))
        x1, y1 = destination_south_polar_xy(math.radians(lat), math.radians(lon), az, dist)
        assert np.abs(x1 - x0).max() < 1e-3 and np.abs(y1 - y0).max() < 1e-3


def test_skyline_matches_horizon_from_heights():
    rng = np.random.default_rng(1)
    dist = ray_distances(240.0, 100_000.0, 1.02)
    h = rng.normal(0.0, 400.0, (36, dist.size))
    h[3, :] = np.nan                                   # an azimuth with no data: smooth-sphere dip in both
    ref, _ = horizon_from_heights(dist, h, 120.0, 2.0)
    assert np.allclose(skyline_from_heights(dist, h, 120.0, 2.0), ref, atol=1e-9)


@pytest.mark.parametrize("lat,lon", [(-89.45, -137.0), (-87.8, 142.0), (-84.6, 26.6), (-75.0, 10.0)])
def test_sample_horizon_matches_the_point_tracer(lat, lon):
    """The screening horizons (2 % growth) against the point tracer (0.8 %): measured max 0.13 deg, mean 0.008."""
    store = get_store()
    ph = services.point_horizon(store, lat, lon, 2.0)
    hz = area_search._sample_horizon(store, lat, lon, ph.ground_m, 2.0, 0.5, RAY_MAX_RANGE_M)
    d = np.abs(hz.values - ph.profile.values)
    assert hz.values.size == 720 and d.max() < 0.2 and d.mean() < 0.01


# ---------------------------------------------------------------------------- endpoint

def test_static_search_paints_the_region():
    r = client.post(URL, json={"region": SMALL, "cell_km": 0.96, "filters": {"max_slope_deg": 12}})
    assert r.status_code == 200, r.text
    b = r.json()
    c = codes_of(b)
    assert c.shape == (b["grid"]["ny"], b["grid"]["nx"])
    assert sum(b["counts"].values()) == c.size
    assert b["counts"]["viable"] == int((c == A.VIABLE).sum()) > 0
    assert [f["id"] for f in b["funnel"]] == ["max_slope_deg"]
    assert b["window"] is None and b["areas"]
    assert all(a["area_km2"] > 0 and -90 <= a["best_lat"] <= -88 for a in b["areas"])


def test_a_stricter_threshold_never_adds_cells():
    loose = codes_of(client.post(URL, json={"region": SMALL, "filters": {"max_slope_deg": 15}}).json())
    strict = codes_of(client.post(URL, json={"region": SMALL, "filters": {"max_slope_deg": 8}}).json())
    assert ((strict == A.VIABLE) <= (loose == A.VIABLE)).all()
    assert (strict == A.VIABLE).sum() < (loose == A.VIABLE).sum()


def test_landing_radius_keeps_failures_out_of_reach():
    body = {"region": SMALL, "cell_km": 0.96, "filters": {"max_slope_deg": 12}}
    fail = codes_of(client.post(URL, json=body).json()) == A.FAIL_STATIC
    c = codes_of(client.post(URL, json={**body, "landing_radius_km": 2.0}).json())
    viable = c == A.VIABLE
    assert viable.any() and not (viable & A.dilate(fail, 2.0 / 0.96)).any()
    # and nothing that had room was taken away: every cell out of reach of a failure is still viable
    assert ((~A.dilate(fail, 2.0 / 0.96)) & (c != A.OUTSIDE) <= viable).all()


def test_crater_density_follows_the_catalogue():
    """Raster count (crater centres binned to cells) against the catalogue's own great-circle count."""
    store = get_store()
    cell_m, n = 960.0, 60
    x0, y0 = (float(v) for v in south_polar_xy(np.array(-88.5), np.array(45.0)))
    x_left, y_top = x0 - n * cell_m / 2, y0 + n * cell_m / 2
    dens = area_search.crater_density(store, x_left, y_top, cell_m, n, 8.0, 1.0)
    from app.logic.projection import south_polar_latlon
    for i, j in ((30, 30), (10, 45), (50, 12)):
        la, lo = south_polar_latlon(np.array(x_left + (j + 0.5) * cell_m), np.array(y_top - (i + 0.5) * cell_m))
        ref = store.craters.density_per_km2(float(la), float(lo), 8.0, 1.0)
        assert dens[i, j] == pytest.approx(ref, rel=0.25, abs=0.004)


def test_window_filters_run_on_the_survivors():
    body = {"region": {"center_lat": -89.3, "center_lon": 60.0, "radius_km": 15.0}, "cell_km": 0.96,
            "start": "2027-01-10T00:00:00Z", "duration_h": 240, "max_window_samples": 60,
            "filters": {"max_slope_deg": 15, "min_sunlit_fraction": 0.5}}
    b = client.post(URL, json=body).json()
    stages = [(f["id"], f["stage"]) for f in b["funnel"]]
    assert stages == [("max_slope_deg", "static"), ("min_sunlit_fraction", "window")]
    w = b["window"]
    assert 0 < w["samples"] <= 60 and w["horizon_az_step_deg"] == 0.5
    assert b["funnel"][1]["cells_in"] == b["funnel"][0]["cells_in"] - b["funnel"][0]["cells_out"]


def test_errors_are_explicit():
    assert client.post(URL, json={"region": SMALL, "filters": {"min_sunlit_fraction": 0.5}}).status_code == 422
    late = {"region": SMALL, "start": "2040-01-01T00:00:00Z", "duration_h": 24, "filters": {"min_sunlit_fraction": 0.5}}
    assert client.post(URL, json=late).status_code == 400
    big = {"region": {"center_lat": -80.0, "center_lon": 0.0, "radius_km": 400.0}, "cell_km": 0.24, "filters": {}}
    assert client.post(URL, json=big).status_code == 422
    bad = {"region": SMALL, "filters": {"max_crater_density_per_km2": 0.1}}
    assert client.post(URL, json=bad).status_code == 422


def test_side_splits_the_pole_at_90_degrees():
    near = codes_of(client.post(URL, json={"region": SMALL, "filters": {"side": "near"}}).json())
    far = codes_of(client.post(URL, json={"region": SMALL, "filters": {"side": "far"}}).json())
    inside = near != A.OUTSIDE
    assert ((near == A.VIABLE) ^ (far == A.VIABLE))[inside].all()


def test_rim_distance_is_exact_for_a_lone_crater():
    """A crater of radius 5 km centred in a 0.5 km grid: cells closer than 1 km to its rim circle fail."""
    class Craters:
        available = True

        @staticmethod
        def _load():
            return {"lat": np.array([-88.0]), "lon": np.array([0.0]), "diam_km": np.array([10.0])}

    class Store:
        craters = Craters()

    x0, y0 = (float(v) for v in south_polar_xy(np.array(-88.0), np.array(0.0)))
    xs = x0 + (np.arange(41) - 20) * 500.0
    ys = y0 - (np.arange(41) - 20) * 500.0
    gx, gy = np.meshgrid(xs, ys)
    from app.logic.projection import south_polar_latlon
    clat, _ = south_polar_latlon(gx, gy)
    d = area_search.rim_distance_km(Store(), gx, gy, clat, 1.0, 3.0)
    k = 2.0 / (1.0 + np.sin(np.radians(-clat)))
    ref = np.minimum(np.abs(np.hypot(gx - x0, gy - y0) / k / 1000.0 - 5.0), 3.0)
    assert np.allclose(d, ref, atol=1e-9)
    assert d[20, 20] == pytest.approx(3.0) and d[20, 30] == pytest.approx(0.0, abs=0.05)


def test_near_psr_keeps_only_cells_close_to_permanent_shadow():
    body = {"region": {"center_lat": -89.6, "center_lon": 0.0, "radius_km": 20.0}, "cell_km": 0.96}
    near = codes_of(client.post(URL, json={**body, "filters": {"max_psr_distance_km": 1.0}}).json())
    wide = codes_of(client.post(URL, json={**body, "filters": {"max_psr_distance_km": 5.0}}).json())
    assert 0 < (near == A.VIABLE).sum() < (wide == A.VIABLE).sum()          # Shackleton's floor is a PSR
    assert ((near == A.VIABLE) <= (wide == A.VIABLE)).all()


def test_hydrogen_filter_reads_the_lunar_prospector_grid():
    store = get_store()
    m = store.grids.meta("lp_hydrogen_60s")
    assert m["unit"] == "ppm" and m["pixelM"] == 3840.0
    # first row of the source table: the bin at 89.5-90 S, 179.5-180 W holds 147.49 ppm
    assert store.grids.sample("lp_hydrogen_60s", -89.9, -179.9) == pytest.approx(147.5, abs=0.06)
    assert store.grids.sample("lp_hydrogen_60s", -59.0, 0.0) is None          # outside the grid's 60 S edge
    body = {"region": {"center_lat": -88.0, "center_lon": 0.0, "radius_km": 60.0}, "cell_km": 1.92}
    # around 88 S, 0 E the map spans about 116 to 170 ppm (median 142): thresholds on both sides of the median
    lo = codes_of(client.post(URL, json={**body, "filters": {"min_hydrogen_ppm": 130.0}}).json())
    hi = codes_of(client.post(URL, json={**body, "filters": {"min_hydrogen_ppm": 150.0}}).json())
    assert ((hi == A.VIABLE) <= (lo == A.VIABLE)).all() and (hi == A.VIABLE).sum() < (lo == A.VIABLE).sum()


def test_a_delay_can_only_remove_cells():
    body = {"region": {"center_lat": -89.3, "center_lon": 60.0, "radius_km": 10.0}, "cell_km": 0.96,
            "start": "2027-01-10T00:00:00Z", "duration_h": 120, "max_window_samples": 40,
            "filters": {"min_sunlit_fraction": 0.5}}
    base = client.post(URL, json=body).json()
    late = client.post(URL, json={**body, "filters": {**body["filters"], "robust_delay_h": 96}}).json()
    assert late["funnel"][-1]["id"] == "robust_delay_h"
    assert late["counts"]["viable"] <= base["counts"]["viable"]
    no_window = {**body, "filters": {"robust_delay_h": 24}}
    assert client.post(URL, json=no_window).status_code == 422
