"""The datasets load, the shared services work end to end and the reference endpoints answer."""
from __future__ import annotations

from datetime import datetime, timezone

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import services
from app.db.store import get_store
from app.logic.constraints import all_pass, evaluate_constraints
from app.logic.engine import compute_metrics, next_transition
from app.logic.scoring import score_metrics
from app.main import app

client = TestClient(app)
T0 = services.to_ms(datetime(2027, 3, 1, tzinfo=timezone.utc))


def test_store_loads_every_dataset():
    store = get_store()
    assert len(store.sites.all()) == 21
    assert store.ephemeris.covers(T0)
    assert {"lola_slope_60s", "lola_slope_80s", "lola_elevation_60s", "sun_illumination_65s",
            "earth_visibility_65s", "permanent_shadow_65s", "sky_visibility_65s"} <= set(store.grids.ids())
    assert store.craters.meta["count"] > 1_000_000


def test_terrain_horizon_matches_the_site_summary():
    store = get_store()
    site = store.sites.get("im-1")
    profile = store.horizons.for_site(site, 2.0)
    assert profile.kind == "terrain" and profile.values.size == 720
    assert profile.max == pytest.approx(site.terrain["horizon2mMaxDeg"], abs=0.01)
    assert store.horizons.for_site(store.sites.get("apollo-11"), 2.0).kind == "smooth_sphere"


def test_grids_agree_with_the_catalogue():
    store = get_store()
    site = store.sites.get("shackleton")            # crater floor: deep, permanently shadowed
    assert store.grids.sample("lola_elevation_60s", site.lat, site.lon) == pytest.approx(site.ground_m, abs=400)
    assert store.grids.sample("permanent_shadow_65s", site.lat, site.lon) > 0.9
    assert store.grids.sample("sun_illumination_65s", site.lat, site.lon) < 0.05
    assert store.grids.sample("lola_slope_60s", 0.0, 0.0) is None          # outside the grid
    # near side sees the Earth almost always, far side never (long-term average maps)
    assert store.grids.sample("earth_visibility_65s", -70.0, 0.0) > 0.9
    assert store.grids.sample("earth_visibility_65s", -70.0, 180.0) < 0.1


def test_crater_lookup():
    store = get_store()
    near = store.craters.within(-89.67, 129.78, 30.0)
    assert near["lat"].size > 0 and float(near["dist_km"].max()) <= 30.0
    assert np.any(near["diam_km"] > 15)                                    # Shackleton itself, ~21 km
    assert store.craters.density_per_km2(-85.0, 30.0) > 0


def test_engine_end_to_end_on_a_terrain_site():
    store = get_store()
    site = store.sites.get("mons-malapert")
    series = services.evaluate_window(store, services.model_for_site(store, site, 2.0), T0, 24 * 30, 60)
    m = compute_metrics(series)
    assert series.t_ms.size == 24 * 30 + 1
    assert 0 < m.sunlight_pct < 100 and 0 <= m.comms_pct <= 100
    assert np.all((series.sun_frac >= 0) & (series.sun_frac <= 1))
    assert 0 <= score_metrics(m).score <= 100
    tr = next_transition(store.ephemeris, services.model_for_site(store, site, 2.0), T0, "sun")
    assert tr is not None and tr.kind in ("set", "rise") and tr.in_ms > 0


def test_hard_filters_reference_implementations():
    store = get_store()
    site = store.sites.get("im-2")                     # 1.1 deg slope
    ctx = services.constraint_context(store, services.model_for_site(store, site, 2.0), T0, 24 * 14, site=site)
    slope_ok, light = evaluate_constraints(ctx, {"max_slope": {"max_deg": 10}, "continuous_light": {"min_fraction": 1.0}})
    assert slope_ok.passed is True and slope_ok.basis == "dataset" and slope_ok.margin == pytest.approx(10 - 1.12)
    assert light.fraction == pytest.approx(ctx.metrics.sunlight_pct / 100.0)
    assert light.passed == ctx.metrics.continuous_light
    assert (len(light.ranges) > 0) == (light.fraction > 0)
    steep = evaluate_constraints(ctx, {"max_slope": {"max_deg": 1.0}})
    assert steep[0].passed is False and not all_pass(steep)
    # a point with no slope data is reported as unknown, never guessed
    far = services.constraint_context(store, services.model_for_point(store, 10.0, 20.0, 2.0), T0, 24)
    unknown = evaluate_constraints(far, {"max_slope": {"max_deg": 10}})[0]
    assert unknown.passed is None and unknown.basis == "unavailable"


def test_api_reference_endpoints():
    r = client.get("/health")
    assert r.status_code == 200 and r.json()["status"] == "ok" and r.json()["sites"] == 21
    r = client.get("/api/v1/sites")
    body = r.json()
    assert r.status_code == 200 and body["count"] == 21 and "South-polar features" in body["groups"]
    assert client.get("/api/v1/sites", params={"terrain_only": True}).json()["count"] == 13
    r = client.get("/api/v1/sites/im-1")
    assert r.status_code == 200 and r.json()["terrain"]["available"] is True and r.json()["source"]["url"].startswith("http")
    assert client.get("/api/v1/sites/nowhere").status_code == 404
    assert "grids" in client.get("/api/v1/meta/datasets").json()
    assert "max_slope" in client.get("/api/v1/meta/constraints").json()["hard_filters"]


def test_global_elevation_grid_samples_the_whole_moon():
    """The equirectangular whole-Moon grid: known heights, longitude wrap and pole clamp."""
    import numpy as np
    store = get_store()
    g = store.grids
    # Mare Tranquillitatis (Apollo 11) is a couple of kilometres below the sphere; the far-side
    # highlands around Korolev are kilometres above it (LOLA, Smith et al. 2010).
    assert -3000 < g.sample("lola_elevation_global", 0.674, 23.473) < -1000
    assert g.sample("lola_elevation_global", -4.0, -157.0) > 1000
    # polar height agrees with the finer polar grid within a coarse cell's smoothing
    south = g.sample("lola_elevation_60s", -85.0, 20.0)
    assert g.sample("lola_elevation_global", -85.0, 20.0) == pytest.approx(south, abs=1500)
    # bilinear sampling wraps in longitude (0/360 seam) and is finite at the poles
    seam = g.bilinear_many("lola_elevation_global", np.array([10.0, 10.0]), np.array([179.99, -179.99]))
    assert np.all(np.isfinite(seam)) and abs(seam[0] - seam[1]) < 500
    wrap = g.bilinear_many("lola_elevation_global", np.array([10.0, 10.0]), np.array([0.01, 359.99]))
    assert np.all(np.isfinite(wrap)) and abs(wrap[0] - wrap[1]) < 500
    assert np.isfinite(g.bilinear_many("lola_elevation_global", np.array([89.999, -89.999]), np.array([0.0, 0.0]))).all()
