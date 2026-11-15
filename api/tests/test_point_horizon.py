"""Ray-traced horizon of manual coordinates (logic.horizon.ray_traced_horizon, services.point_horizon,
GET /api/v1/points/horizon): analytic cases for the geometry, then the accuracy against the catalogue's fine masks
(the numbers stated by the endpoint's ``validation`` field come from here)."""
from __future__ import annotations

import math

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import services
from app.db.store import get_store
from app.logic.horizon import R_M, ray_traced_horizon, spherical_horizon_deg
from app.main import app

client = TestClient(app)


def elevation(h_target: float, dist_m: float, ground: float, mast: float) -> float:
    """Elevation angle of a point h_target high at dist_m over the sphere, exact (the method's own formula)."""
    th = dist_m / R_M
    rs, ro = R_M + h_target, R_M + ground + mast
    return math.degrees(math.atan2(rs * math.cos(th) - ro, rs * math.sin(th)))


@pytest.mark.parametrize("mast", [0.5, 2.0, 10.0])
def test_flat_ground_gives_the_geometric_dip(mast):
    flat = lambda la, lo: np.zeros(np.shape(la))
    p, rng = ray_traced_horizon(flat, -85.0, 30.0, 0.0, mast, cell_m=240.0)
    assert p.kind == "terrain" and rng > 249_000
    # the limb is the tangent point at sqrt(2 R h): sampled finely enough to land within a thousandth of a degree
    assert np.allclose(p.values, spherical_horizon_deg(mast), atol=1e-3)


def test_a_ring_of_relief_sets_the_skyline_at_its_exact_angle():
    lat0, lon0 = -88.0, 0.0
    H, D = 1500.0, 20_000.0

    def ring(la, lo):
        # great-circle distance from the observer; terrain H high between D and D + 3 km, flat elsewhere
        d = R_M * np.arccos(np.clip(np.sin(la) * math.sin(math.radians(lat0)) + np.cos(la) * math.cos(math.radians(lat0))
                                    * np.cos(lo - math.radians(lon0)), -1, 1))
        return np.where((d >= D) & (d <= D + 3000.0), H, 0.0)

    p, _ = ray_traced_horizon(ring, lat0, lon0, 0.0, 2.0, cell_m=240.0)
    # The near edge of the ring is the highest point seen. The first sample inside the band lies at most one step
    # (0.8 % of the distance) beyond the edge, so against a vertical cliff, the worst case, the skyline is never
    # above the exact angle and never below the angle one step farther.
    expected = elevation(H, D, 0.0, 2.0)
    assert np.all(p.values <= expected + 1e-9)
    assert np.all(p.values >= elevation(H, D * 1.008, 0.0, 2.0) - 1e-9)
    assert np.ptp(p.values) < 1e-9                      # the same in every direction
    assert expected == pytest.approx(math.degrees(math.atan2(H - 2.0, D)) - math.degrees(D / (2 * R_M)), abs=0.01)


def test_curvature_hides_a_low_far_ridge():
    # 300 m of relief 150 km away sits below the observer's own limb: the skyline stays at the smooth dip
    lat0 = -86.0

    def far_ridge(la, lo):
        d = R_M * np.abs(la - math.radians(lat0))      # along the meridian is enough for azimuths 0 and 180
        return np.where((d > 150_000.0) & (d < 152_000.0), 300.0, 0.0)

    p, _ = ray_traced_horizon(far_ridge, lat0, 0.0, 0.0, 2.0, cell_m=240.0)
    assert elevation(300.0, 150_000.0, 0.0, 2.0) < spherical_horizon_deg(2.0)    # hidden by curvature
    assert np.allclose(p.values, spherical_horizon_deg(2.0), atol=1e-3)


def test_missing_data_keeps_the_smooth_dip_and_reports_the_range():
    nan = lambda la, lo: np.full(np.shape(la), np.nan)
    p, rng = ray_traced_horizon(nan, -85.0, 0.0, 0.0, 2.0, cell_m=960.0)
    assert np.allclose(p.values, spherical_horizon_deg(2.0)) and rng == 0.0


def test_accuracy_against_the_catalogue_fine_masks():
    """The endpoint states these numbers; they are measured here, at 2 m, with the ground a typed-in point gets."""
    store = get_store()
    rms = {}
    for site in store.sites.all():
        if not site.has_terrain:
            continue
        ref = store.horizons.for_site(site, 2.0).values
        ph = services.point_horizon(store, site.lat, site.lon, 2.0)
        assert ph is not None and ph.profile.kind == "terrain"
        rms[site.id] = float(np.sqrt(np.mean((ph.profile.values - ref) ** 2)))
    values = np.array(list(rms.values()))
    assert len(values) == 13
    assert np.median(values) <= 0.25                       # measured 0.21
    assert (values <= 0.5).sum() >= 11                     # measured 11 of 13
    assert max(rms, key=rms.get) == "mons-malapert" and rms["mons-malapert"] <= 3.5   # measured 3.25


def test_endpoint_uses_the_finest_grid_covering_the_point():
    r = client.get("/api/v1/points/horizon", params={"lat": -85.5, "lon": 10, "mast_m": 2})
    assert r.status_code == 200
    b = r.json()
    assert b["horizon_kind"] == "terrain" and b["near_grid"] == "lola_elevation_80s" and b["near_cell_m"] == 240.0
    assert len(b["elevation_deg"]) == 720 and b["terrain_range_km"] > 249 and b["ground_source"] == "lola_grid"
    assert b["max_deg"] == pytest.approx(max(b["elevation_deg"]))
    # farther from the pole only the 960 m grid covers the point
    b = client.get("/api/v1/points/horizon", params={"lat": -70, "lon": 10}).json()
    assert b["horizon_kind"] == "terrain" and b["near_grid"] == "lola_elevation_60s"
    # outside the polar grids the whole-Moon 8 ppd grid closes the chain: terrain everywhere
    b = client.get("/api/v1/points/horizon", params={"lat": 0, "lon": 0}).json()
    assert b["horizon_kind"] == "terrain" and b["near_grid"] == "lola_elevation_global" and b["ground_source"] == "lola_grid"
    assert b["near_cell_m"] == pytest.approx(3790.4, abs=0.1) and b["terrain_range_km"] > 249
    assert client.get("/api/v1/points/horizon", params={"lat": -95, "lon": 0}).status_code == 422


def test_point_endpoints_use_the_traced_horizon_on_request():
    p = {"lat": -85.5, "lon": 10, "t": "2026-11-20T12:00:00Z"}
    assert client.get("/api/v1/points/state", params=p).json()["horizon_kind"] == "smooth_sphere"   # default kept
    s = client.get("/api/v1/points/state", params={**p, "horizon": "terrain"}).json()
    h = client.get("/api/v1/points/horizon", params={"lat": -85.5, "lon": 10}).json()
    assert s["horizon_kind"] == "terrain" and s["ground_m"] == pytest.approx(h["ground_m"])
    series = client.get("/api/v1/points/series", params={"lat": -85.5, "lon": 10, "start": p["t"], "duration_h": 24,
                                                         "horizon": "terrain"}).json()
    assert series["horizon_kind"] == "terrain"
    assert client.get("/api/v1/points/state", params={**p, "horizon": "bumpy"}).status_code == 422


def test_window_endpoints_accept_the_traced_horizon():
    body = {"lat": -85.5, "lon": 10, "start": "2027-01-01T00:00:00Z", "duration_h": 48, "level": 1, "panel": "vertical"}
    smooth = client.post("/api/v1/power", json=body).json()
    traced = client.post("/api/v1/power", json={**body, "horizon": "terrain"}).json()
    assert smooth["horizon_kind"] == "smooth_sphere" and traced["horizon_kind"] == "terrain"
    assert client.post("/api/v1/sun", json={**body, "horizon": "terrain"}).json()["horizon_kind"] == "terrain"
