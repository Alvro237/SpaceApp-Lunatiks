"""Replanning sweep: hand-worked cases for app/logic/sweep and equality with the single-window endpoints."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.logic.power import BatteryParams, energy_balance
from app.logic.sweep import energy_balance_rows, longest_run_rows, window_fraction, window_matrix, window_starts
from app.main import app

client = TestClient(app)


def test_windows_hand_case():
    flags = np.array([1, 1, 0, 0, 1, 1, 1, 0], dtype=bool)
    starts = window_starts(3, 2)                       # windows start at samples 0, 2, 4; n = 3 -> 4 samples each
    assert starts.tolist() == [0, 2, 4]
    assert window_fraction(flags, starts, 3).tolist() == [0.5, 0.5, 0.75]
    m = window_matrix(flags, starts, 3)
    assert m.tolist() == [[1, 1, 0, 0], [0, 0, 1, 1], [1, 1, 1, 0]]
    assert longest_run_rows(m, True).tolist() == [2, 2, 3]
    assert longest_run_rows(m, False).tolist() == [2, 2, 1]


def test_vectorised_battery_equals_the_scalar_model():
    rng = np.random.default_rng(7)
    p = rng.uniform(0, 300, (6, 50)) * (rng.uniform(size=(6, 50)) > 0.4)
    q = np.full((6, 50), 120.0)
    bat = BatteryParams(capacity_wh=600.0, initial_soc=0.6, min_soc=0.2, charge_efficiency=0.9, discharge_efficiency=0.85)
    rows = energy_balance_rows(p, q, 1.0, bat)
    t = np.arange(50) * 3_600_000.0
    for i in range(6):
        b = energy_balance(t, p[i], q[i], bat)
        assert rows.min_soc[i] == pytest.approx(b.min_soc) and rows.final_soc[i] == pytest.approx(b.final_soc)
        assert rows.unserved_wh[i] == pytest.approx(b.unserved_wh, abs=1e-9) and bool(rows.survived[i]) == b.survived


ARRAY = {"area_m2": 2.0, "efficiency": 0.3, "derating": 0.9}
BATTERY = {"capacity_wh": 3000.0, "initial_soc": 1.0, "min_soc": 0.2, "charge_efficiency": 0.95, "discharge_efficiency": 0.95}
LOAD = {"load_w": 60.0, "night_load_w": 40.0}


def test_each_window_equals_the_single_window_endpoints():
    req = {"places": [{"site_id": "mons-malapert"}, {"lat": -85.0, "lon": 30.0}], "first_landing": "2027-03-10T00:00:00Z",
           "landings": 6, "landing_step_h": 24, "stay_h": 96, "step_min": 60,
           "array": ARRAY, "battery": BATTERY, "load": LOAD}
    r = client.post("/api/v1/sweep", json=req)
    assert r.status_code == 200, r.text
    b = r.json()
    assert len(b["landings"]) == 6 and b["landings"][1] == "2027-03-11T00:00:00Z"
    t0 = datetime(2027, 3, 10, tzinfo=timezone.utc)
    for p_i, place in enumerate(req["places"]):
        row = b["places"][p_i]
        for k in (0, 3, 5):
            start = (t0 + timedelta(days=k)).strftime("%Y-%m-%dT%H:%M:%SZ")
            common = {**place, "start": start, "duration_h": 96, "step_min": 60}
            sun = client.post("/api/v1/sun", json=common).json()
            earth = client.post("/api/v1/earth", json=common).json()
            pw = client.post("/api/v1/power", json={**common, "level": 3, "array": ARRAY, "battery": BATTERY,
                                                    "load": LOAD}).json()
            assert row["sunlight_fraction"][k] == pytest.approx(sun["sunlit_fraction"])
            assert row["longest_dark_h"][k] == pytest.approx(sun["longest_dark_h"])
            assert row["comms_fraction"][k] == pytest.approx(earth["visible_window_fraction"])
            assert row["longest_blackout_h"][k] == pytest.approx(earth["longest_blackout_h"])
            assert row["mean_array_w"][k] == pytest.approx(pw["array"]["mean_power_w"])
            assert row["battery_min_soc"][k] == pytest.approx(pw["balance"]["min_soc_fraction"])
            assert row["battery_survived"][k] == pw["balance"]["survived"]
    assert b["places"][0]["horizon_kind"] == "terrain" and b["places"][1]["horizon_kind"] == "smooth_sphere"
    assert b["places"][0]["gcr_dose_mgy_si"] > 0


def test_errors():
    base = {"places": [{"site_id": "im-2"}], "first_landing": "2027-03-01T00:00:00Z", "landings": 3, "stay_h": 48}
    assert client.post("/api/v1/sweep", json={**base, "places": [{"site_id": "nowhere"}]}).status_code == 404
    assert client.post("/api/v1/sweep", json={**base, "step_min": 7}).status_code == 422          # 7 min does not divide 24 h
    assert client.post("/api/v1/sweep", json={**base, "battery": BATTERY}).status_code == 422     # battery without array/load
    assert client.post("/api/v1/sweep", json={**base, "places": [{}]}).status_code == 422
    assert client.post("/api/v1/sweep", json={**base, "landings": 2000, "stay_h": 2000, "step_min": 1}).status_code == 422
    assert client.post("/api/v1/sweep", json={**base, "first_landing": "2040-01-01T00:00:00Z"}).status_code == 400
