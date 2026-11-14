"""RF-11 verdict: hand-worked score and verdict rules, the battery_survives filter and POST /api/v1/verdict."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.logic.scoring import ScoreResult, overall_verdict, weighted_score
from app.main import app

client = TestClient(app)


def test_score_and_verdict_rules_hand_case():
    # 100 x (0.5 x 0.8 + 0.3 x 0.5 + 0.2 x 0.6) / 1.0 = 67.0
    s = weighted_score({"sunlight": 0.8, "comms": 0.5, "continuity": 0.6}, {"sunlight": 0.5, "comms": 0.3, "continuity": 0.2})
    assert s == pytest.approx(67.0)
    sc = ScoreResult(score=s, verdict="marginal", parts={}, weights={})
    assert overall_verdict([True, True], sc) == "marginal"
    assert overall_verdict([True, False, None], sc) == "unfeasible"          # a failure beats an unknown
    assert overall_verdict([True, None], sc) == "unknown"
    assert overall_verdict([True, None], sc, unknown_passes=True) == "marginal"
    assert overall_verdict([], sc) == "marginal"


BASE = {"site_id": "mons-malapert", "start": "2027-10-05T00:00:00Z", "duration_h": 24 * 14, "step_min": 60}
PWR = {"panel_area_m2": 2.0, "cell_efficiency": 0.3, "derating": 0.9, "load_w": 60.0, "night_load_w": 40.0,
       "battery_capacity_wh": 3000.0, "battery_initial_soc": 1.0, "battery_min_soc": 0.2, "charge_efficiency": 0.95,
       "discharge_efficiency": 0.95}


def test_score_only_and_a_failing_filter():
    b = client.post("/api/v1/verdict", json=BASE).json()
    assert b["verdict"] in ("favourable", "marginal", "poor") and b["hard_filters"] == []
    assert b["score"]["weights"] == {"sunlight": 0.5, "comms": 0.3, "continuity": 0.2}
    steep = client.post("/api/v1/verdict", json={**BASE, "hard_filters": {"max_slope": {"max_deg": 0.01}}}).json()
    assert steep["verdict"] == "unfeasible" and steep["reasons"][0].startswith("max_slope failed")
    comms_only = client.post("/api/v1/verdict", json={**BASE, "weights": {"sunlight": 0, "comms": 1, "continuity": 0}}).json()
    assert comms_only["score"]["score"] == pytest.approx(100 * comms_only["score"]["parts"]["comms"])


def test_unknown_data_gives_unknown_unless_accepted():
    far = {**BASE, "site_id": None, "lat": 10.0, "lon": 20.0, "hard_filters": {"max_slope": {"max_deg": 10}}}
    assert client.post("/api/v1/verdict", json=far).json()["verdict"] == "unknown"
    assert client.post("/api/v1/verdict", json={**far, "unknown_passes": True}).json()["verdict"] in ("favourable", "marginal", "poor")


def test_battery_filter_agrees_with_power_level_3():
    for cap in (300.0, 30000.0):
        bat = {**PWR, "battery_capacity_wh": cap}
        v = client.post("/api/v1/verdict", json={**BASE, "hard_filters": {"battery_survives": {
            **bat}}}).json()
        p = client.post("/api/v1/power", json={**BASE, "level": 3, **bat}).json()
        f = v["hard_filters"][0]
        assert f["passed"] == p["survives"]
        assert f["value"] == pytest.approx(p["min_soc"])
        assert (v["verdict"] == "unfeasible") == (not p["survives"])


def test_errors():
    assert client.post("/api/v1/verdict", json={**BASE, "hard_filters": {"no_such_filter": {}}}).status_code == 422
    assert client.post("/api/v1/verdict", json={**BASE, "hard_filters": {"max_slope": {}}}).status_code == 422
    assert client.post("/api/v1/verdict", json={**BASE, "favourable_min": 40, "marginal_min": 60}).status_code == 422
    assert client.post("/api/v1/verdict", json={**BASE, "site_id": "nowhere"}).status_code == 404
