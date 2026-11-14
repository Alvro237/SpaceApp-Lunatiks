"""Ridge planes (logic.horizon.ridge_planes / horizon_planes): the visible crests along each ray, near to far, the
skyline last. Hand-worked profiles, synthetic rings of relief with known distances and angles, consistency with the
skyline the API already computes, and the ``planes`` / ``skyline_distance_km`` fields of the two horizon endpoints."""
from __future__ import annotations

import math

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.logic.horizon import R_M, horizon_from_heights, horizon_planes, ray_distances, ridge_planes, spherical_horizon_deg
from app.main import app

client = TestClient(app)


def elevation(h_target: float, dist_m: float, ground: float, mast: float) -> float:
    th = dist_m / R_M
    rs, ro = R_M + h_target, R_M + ground + mast
    return math.degrees(math.atan2(rs * math.cos(th) - ro, rs * math.sin(th)))


def test_hand_profile_one_crest_then_the_skyline():
    d = np.arange(1, 11) * 100.0
    # rises to 5 at 300 m (a crest: it falls to 2 behind), rises to 9 at 800 m (the highest), falls to 1
    e = np.array([[1, 3, 5, 2, 3, 4, 6, 9, 4, 1.0]])
    el, dist, sky = ridge_planes(d, e, k=3, min_drop_deg=0.3)
    assert np.isnan(el[0, 0]) and np.isnan(dist[0, 0])                  # padded on the near side
    assert el[0, 1] == 5.0 and dist[0, 1] == 300.0
    assert el[0, 2] == 9.0 and dist[0, 2] == 800.0 and sky[0] == 800.0


def test_a_crest_hidden_behind_a_nearer_higher_one_is_not_seen():
    d = np.arange(1, 9) * 100.0
    e = np.array([[2, 8, 3, 1, 5, 2, 1, 0.5]])      # the crest at 500 m (5) is below the one at 200 m (8)
    el, dist, _ = ridge_planes(d, e)
    assert np.isnan(el[0, :2]).all() and el[0, 2] == 8.0 and dist[0, 2] == 200.0


def test_a_shallow_bump_is_not_a_crest_unless_the_threshold_allows_it():
    d = np.arange(1, 8) * 100.0
    e = np.array([[1.0, 1.2, 1.1, 1.15, 3.0, 2.0, 0.0]])     # bump of 0.1 at 200 m; the skyline is 3 at 500 m
    shallow = ridge_planes(d, e, min_drop_deg=0.3)[0]
    assert np.isnan(shallow[0, :2]).all()
    deep = ridge_planes(d, e, min_drop_deg=0.05)[0]
    assert deep[0, 1] == 1.2 and deep[0, 2] == 3.0


def test_rows_without_data_are_all_nan_and_the_first_of_tied_maxima_is_the_skyline():
    d = np.arange(1, 6) * 100.0
    e = np.array([[np.nan] * 5, [1, 4, 2, 4, 0.0]])
    el, dist, sky = ridge_planes(d, e)
    assert np.isnan(el[0]).all() and np.isnan(sky[0])
    assert sky[1] == 200.0 and el[1, 2] == 4.0


def _rings(dist, bands):
    """Heights, equal at every azimuth, with flat-topped rings (distance, width, height)."""
    h = np.zeros(dist.size)
    for d0, w, top in bands:
        h = np.where((dist >= d0) & (dist <= d0 + w), top, h)
    return np.tile(h, (8, 1))


def test_two_rings_of_relief_give_two_planes_at_their_distances_and_angles():
    dist = ray_distances(240.0)
    heights = _rings(dist, [(2000.0, 300.0, 100.0), (15000.0, 2000.0, 1100.0)])
    el, d, sky = horizon_planes(dist, heights, 0.0, 2.0)
    for r in range(8):
        assert np.isnan(el[r, 0])
        # the first sample inside a band is at most one geometric step (0.8 %) past its near edge
        assert 2000.0 <= d[r, 1] <= 2000.0 * 1.01 and 15000.0 <= d[r, 2] <= 15000.0 * 1.01
        assert el[r, 1] == pytest.approx(elevation(100.0, d[r, 1], 0.0, 2.0), abs=1e-6)
        assert el[r, 2] == pytest.approx(elevation(1100.0, d[r, 2], 0.0, 2.0), abs=1e-6)
        assert el[r, 1] < el[r, 2] and d[r, 1] < d[r, 2] and sky[r] == d[r, 2]


def test_a_nearer_higher_ring_hides_a_farther_lower_one():
    dist = ray_distances(240.0)
    heights = _rings(dist, [(2000.0, 300.0, 300.0), (10000.0, 2000.0, 300.0)])
    el, d, _ = horizon_planes(dist, heights, 0.0, 2.0)
    assert np.isnan(el[:, :2]).all() and np.all(d[:, 2] < 2100.0)


def test_flat_ground_has_only_the_skyline_at_the_geometric_dip():
    dist = ray_distances(240.0)
    el, d, sky = horizon_planes(dist, np.zeros((4, dist.size)), 0.0, 2.0)
    assert np.isnan(el[:, :2]).all()
    assert np.allclose(el[:, 2], spherical_horizon_deg(2.0), atol=1e-3)
    assert np.allclose(sky, math.sqrt(2.0 * R_M * 2.0), rtol=0.02)           # the limb is at sqrt(2 R h)


def test_last_plane_is_the_skyline_and_planes_only_rise_and_recede():
    rng = np.random.default_rng(3)
    dist = ray_distances(240.0)
    # smooth random relief: sum of a few broad bumps along each ray
    x = np.log(dist)
    heights = np.zeros((40, dist.size))
    for i in range(40):
        for _ in range(6):
            heights[i] += rng.uniform(50, 900) * np.exp(-((x - rng.uniform(x[0], x[-1] - 1)) ** 2) / (2 * rng.uniform(0.05, 0.4) ** 2))
    sky_ref, _ = horizon_from_heights(dist, heights, 100.0, 2.0)
    el, d, sky = horizon_planes(dist, heights, 100.0, 2.0)
    assert np.allclose(el[:, -1], sky_ref, atol=1e-9)
    for r in range(40):
        ok = np.isfinite(el[r])
        assert np.all(np.diff(el[r][ok]) > 0) and np.all(np.diff(d[r][ok]) > 0)
        assert ok[-1] and sky[r] == d[r, -1]


# --------------------------------------------------------------------------------------------- the endpoints

def _arr(v):
    return np.array([np.nan if x is None else x for x in v])


def test_point_horizon_endpoint_returns_the_planes_and_keeps_the_skyline():
    b = client.get("/api/v1/points/horizon", params={"lat": -85.5, "lon": 10.0, "mast_m": 2.0}).json()
    assert b["horizon_kind"] == "terrain" and len(b["planes"]) == 3 and len(b["skyline_distance_km"]) == 720
    for pl in b["planes"]:
        assert len(pl["distance_km"]) == len(pl["elevation_deg"]) == 720
    last = _arr(b["planes"][-1]["elevation_deg"])
    assert np.all(np.isfinite(last)) and np.allclose(last, b["elevation_deg"], atol=1e-9)    # same skyline
    assert np.allclose(_arr(b["planes"][-1]["distance_km"]), _arr(b["skyline_distance_km"]))
    for a, c in zip(b["planes"][:-1], b["planes"][1:]):                  # near planes are lower and nearer
        both = np.isfinite(_arr(a["elevation_deg"])) & np.isfinite(_arr(c["elevation_deg"]))
        assert np.all(_arr(a["elevation_deg"])[both] < _arr(c["elevation_deg"])[both])
        assert np.all(_arr(a["distance_km"])[both] < _arr(c["distance_km"])[both])


def test_point_horizon_planes_are_null_on_the_smooth_sphere():
    b = client.get("/api/v1/points/horizon", params={"lat": 10.0, "lon": 30.0, "mast_m": 2.0}).json()
    assert b["horizon_kind"] == "smooth_sphere" and b["planes"] is None and b["skyline_distance_km"] is None


def test_site_horizon_endpoint_returns_planes_beside_the_stored_mask():
    b = client.get("/api/v1/sites/mons-malapert/horizon", params={"mast_m": 2.0}).json()
    assert b["horizon_kind"] == "terrain" and len(b["planes"]) == 3
    assert any(np.isfinite(_arr(pl["elevation_deg"])).any() for pl in b["planes"][:2])
    # the skyline fields are the catalogue mask, not the planes' grid-derived one
    mask = client.get("/api/v1/sites/mons-malapert/horizon", params={"mast_m": 2.0, "include_zone": False}).json()
    assert mask["elevation_deg"] == b["elevation_deg"]
    no_terrain = client.get("/api/v1/sites/apollo-11/horizon", params={"mast_m": 2.0}).json()
    assert no_terrain["horizon_kind"] == "smooth_sphere" and no_terrain["planes"] is None
