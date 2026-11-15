"""POST /api/v1/suitability/search, GET /api/v1/suitability/criteria and /features on the real datasets: contract,
validation (422, 400), score consistency, landing radius, and the soundness of the ephemeris bound (every cell it
drops fails when evaluated exactly with its own traced horizon)."""
from __future__ import annotations

import base64
from datetime import datetime, timezone

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import area_search, services
from app.db.store import get_store
from app.logic import suitability as S
from app.logic.engine import AnalysisParams, compute_metrics, make_model
from app.logic.projection import south_polar_latlon
from app.main import app

client = TestClient(app)
URL = "/api/v1/suitability/search"
SMALL = {"center_lat": -89.3, "center_lon": 60.0, "radius_km": 25.0}
FAR = {"center_lat": -68.0, "center_lon": 150.0, "radius_km": 40.0}
START = "2027-01-10T00:00:00Z"


def raster(body: dict, key: str) -> np.ndarray:
    g = body["grid"]
    return np.frombuffer(base64.b64decode(body[key]), np.uint8).reshape(g["ny"], g["nx"])


def post(**kw) -> dict:
    body = {"region": SMALL, "start": START, "duration_h": 168, "cell_km": 0.96, "categories": [], "criteria": []}
    body.update(kw)
    return body


def test_criteria_catalogue():
    r = client.get("/api/v1/suitability/criteria")
    assert r.status_code == 200
    j = r.json()
    ids = {c["id"] for c in j["criteria"]}
    assert set(S.CATALOGUE) <= ids and set(S.UNAVAILABLE) <= ids
    assert {c["id"] for c in j["criteria"] if not c["available"]} >= set(S.UNAVAILABLE)
    assert {f["id"] for f in j["fixed_inputs"]} == {"region", "window"}
    assert [c["id"] for c in j["categories"]] == list(S.CATEGORY_IDS)


def test_features_search():
    r = client.get("/api/v1/suitability/features", params={"q": "shackleton"})
    assert r.status_code == 200
    names = [f["name"] for f in r.json()["features"]]
    assert names[0] == "Shackleton"
    assert all(f["lat"] < -55 for f in r.json()["features"])


def test_static_happy_path_score_matches_layers():
    body = post(categories=["topography", "radiation", "science"],
                criteria=[{"id": "max_slope_deg", "limit": 15}, {"id": "dose_mgy", "limit": 10},
                          {"id": "psr_distance_km", "limit": 30}],
                priority=["topography", "science", "radiation"])
    r = client.post(URL, json=body)
    assert r.status_code == 200, r.text
    j = r.json()
    n = j["grid"]["nx"]
    codes = raster(j, "codes_b64")
    assert codes.shape == (n, n)
    assert [lay["category"] for lay in j["layers"]] == ["topography", "science", "radiation"]
    assert j["weights"]["topography"] == pytest.approx(11 / 18)
    # the score raster equals the score recomputed from the quantised layers (what the browser does)
    qs = [np.frombuffer(base64.b64decode(lay["utility_b64"]), np.uint8).reshape(n, n) for lay in j["layers"]]
    score, _ = S.score_from_quantized(qs, np.array([lay["weight"] for lay in j["layers"]]))
    assert np.array_equal(S.score_u8(score, codes == 3), raster(j, "score_b64"))
    assert j["sites"], "at least one site"
    for s in j["sites"]:
        assert all(c["passes"] is not False for c in s["criteria"])
    # sites at least min_separation_km apart (map distance / scale factor)
    from app.logic.projection import great_circle_km
    for a in range(len(j["sites"])):
        for b in range(a + 1, len(j["sites"])):
            sa, sb = j["sites"][a], j["sites"][b]
            assert great_circle_km(sa["lat"], sa["lon"], sb["lat"], sb["lon"]) >= 9.0


def test_window_categories_and_sites_exact():
    body = post(categories=["power", "earth", "landing"],
                criteria=[{"id": "battery_autonomy_h", "limit": 72}, {"id": "sun_el_at_landing_deg", "min": -5, "max": 15}],
                priority=["earth", "power"], max_window_samples=40, top_k=4)
    r = client.post(URL, json=body)
    assert r.status_code == 200, r.text
    j = r.json()
    assert [lay["category"] for lay in j["layers"]] == ["earth", "power"]
    assert j["window"]["samples"] <= 40
    for s in j["sites"]:
        assert s["window_exact"] is True and s["horizon_kind"] == "terrain"
        crits = {c["id"]: c for c in s["criteria"]}
        assert crits["battery_autonomy_h"]["value"] <= 72
        assert -5 <= crits["sun_el_at_landing_deg"]["value"] <= 15


def test_landing_radius_area_score():
    base = post(categories=["topography"], criteria=[{"id": "max_slope_deg", "limit": 12}])
    static_fail = raster(client.post(URL, json=base).json(), "codes_b64") == 1     # slope failures alone
    j = client.post(URL, json={**base, "landing_radius_km": 2.0}).json()
    g = j["grid"]
    assert j["sites"]
    for s in j["sites"]:
        assert s["area_score"] <= s["score"] + 1e-9
    failed = np.argwhere(static_fail)
    xs = g["x_left_m"] + (failed[:, 1] + 0.5) * g["cell_m"]
    ys = g["y_top_m"] - (failed[:, 0] + 0.5) * g["cell_m"]
    from app.logic.projection import south_polar_xy
    for s in j["sites"]:
        sx, sy = south_polar_xy(np.array(s["lat"]), np.array(s["lon"]))
        assert np.min(np.hypot(xs - sx, ys - sy)) > 2000.0 * 0.99


@pytest.mark.parametrize("body,detail", [
    (post(categories=["topography"], criteria=[{"id": "nope", "limit": 1}]), "unknown or unavailable"),
    (post(categories=["topography"], criteria=[{"id": "rocks"}]), "unknown or unavailable"),
    (post(categories=["power"], criteria=[{"id": "max_slope_deg", "limit": 10}]), "switched off"),
    (post(categories=["topography"], criteria=[{"id": "max_slope_deg"}]), "limit required"),
    (post(categories=["science"], criteria=[{"id": "target_distance_km", "limit": 10, "params": {"feature": "Atlantis"}}]), "unknown feature"),
    (post(categories=["power"], priority=["landing"]), "not a scored category"),
    (post(categories=["topography"], criteria=[{"id": "max_slope_deg", "limit": 10}], cell_km=0.24,
          region={"center_lat": -85.0, "center_lon": 0.0, "radius_km": 400.0}), "cells"),
])
def test_422(body, detail):
    r = client.post(URL, json=body)
    assert r.status_code == 422
    assert detail in str(r.json()["detail"])


def test_422_region_north_of_60():
    r = client.post(URL, json=post(region={"center_lat": -50.0, "center_lon": 0.0, "radius_km": 20.0}))
    assert r.status_code == 422


def test_400_outside_ephemeris():
    r = client.post(URL, json=post(start="2040-01-01T00:00:00Z"))
    assert r.status_code == 400


def test_bound_is_sound_far_region():
    """Every cell the ephemeris bound drops fails the bounded criterion when evaluated exactly at the cell."""
    body = {"region": FAR, "start": START, "duration_h": 708.7, "cell_km": 1.92, "categories": ["power", "earth"],
            "criteria": [{"id": "battery_autonomy_h", "limit": 300}, {"id": "blackout_h", "limit": 300}],
            "max_window_samples": 4, "top_k": 1}
    r = client.post(URL, json=body)
    assert r.status_code == 200, r.text
    j = r.json()
    codes = raster(j, "codes_b64")
    dropped = np.argwhere(codes == 5)
    assert dropped.size, "the bound is active on the far region"
    store = get_store()
    g = j["grid"]
    rng = np.random.default_rng(0)
    pick = dropped[rng.choice(len(dropped), size=min(25, len(dropped)), replace=False)]
    params = AnalysisParams(comms_min_fraction=0.5)
    start_ms = datetime(2027, 1, 10, tzinfo=timezone.utc).timestamp() * 1000.0
    for i, jj in pick:
        x = g["x_left_m"] + (jj + 0.5) * g["cell_m"]
        y = g["y_top_m"] - (i + 0.5) * g["cell_m"]
        lat, lon = (float(v) for v in south_polar_latlon(np.array(x), np.array(y)))
        ground = float(area_search._finest_xy(store, area_search.ELEVATION_GRIDS, np.array([x]), np.array([y]), True)[0])
        hz = area_search._sample_horizon(store, lat, lon, ground, 2.0, 0.5, 150_000.0)
        met = compute_metrics(services.evaluate_window(store, make_model(lat, lon, ground, hz, 2.0), start_ms, 708.7, 60.0, params), params)
        assert met.longest_dark_h > 300 or met.longest_blackout_h > 300, (lat, lon)


def test_every_criterion_at_once():
    """Every available criterion in one request (battery model instead of autonomy and recharge): no error, every
    criterion reported at every site, and the sites pass every hard criterion that has data there."""
    flat = {"panel_area_m2": 4.0, "cell_efficiency": 0.3, "derating": 0.85, "load_w": 60.0, "night_load_w": 40.0,
            "battery_capacity_wh": 5000.0, "battery_initial_soc": 1.0, "battery_min_soc": 0.2,
            "charge_efficiency": 0.95, "discharge_efficiency": 0.95}
    crit = [{"id": "side", "choice": "near"}, {"id": "avoid_psr"}, {"id": "battery_model", "params": flat},
            {"id": "blackout_h", "limit": 120}, {"id": "max_slope_deg", "limit": 20}, {"id": "crater_cover_pct", "limit": 80},
            {"id": "rim_margin_radii", "limit": 0.1}, {"id": "sun_el_at_landing_deg", "min": -10, "max": 20},
            {"id": "earth_at_landing"}, {"id": "psr_distance_km", "limit": 50}, {"id": "hydrogen_ppm", "limit": 0},
            {"id": "target_distance_km", "limit": 80, "params": {"feature": "Shackleton"}},
            {"id": "past_landings", "choice": "away", "limit": 1}, {"id": "dose_mgy", "limit": 50}]
    body = post(categories=list(S.CATEGORY_IDS), criteria=crit, landing_radius_km=0.5, robust_delay_h=12,
                max_window_samples=30, top_k=3)
    r = client.post(URL, json=body)
    assert r.status_code == 200, r.text
    j = r.json()
    assert {lay["category"] for lay in j["layers"]} == {"power", "earth", "topography", "science", "radiation"}
    for s in j["sites"]:
        assert {c["id"] for c in s["criteria"]} == {c["id"] for c in crit}
        assert all(c["passes"] is not False for c in s["criteria"]), s["criteria"]


def test_recharge_time():
    body = post(categories=["power"], criteria=[{"id": "recharge_h", "limit": 6}], max_window_samples=20, top_k=2)
    j = client.post(URL, json=body).json()
    for s in j["sites"]:
        c = next(c for c in s["criteria"] if c["id"] == "recharge_h")
        assert c["passes"] and (c["value"] is None or c["value"] >= 6)
