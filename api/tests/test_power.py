"""Power levels: hand-worked cases for the model and the HTTP contract of POST /api/v1/power."""
from __future__ import annotations

from datetime import datetime, timezone

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import services
from app.db.store import get_store
from app.logic.engine import AnalysisParams, compute_metrics
from app.logic.power import (ArrayParams, BatteryParams, LoadParams, array_power_w, energy_balance, energy_wh,
                             load_series_w, night_energy_wh, usable_capacity_wh)
from app.main import app

client = TestClient(app)
H = 3_600_000.0                      # one hour in ms
T = np.arange(4) * H                 # four samples, three one-hour steps
T0 = services.to_ms(datetime(2027, 3, 1, tzinfo=timezone.utc))


# ------------------------------------------------------------------ hand-worked model cases

def test_array_power_hand_case():
    # 1000 W/m2 x 2 m2 x 0.30 x 0.90 = 540 W ; 1361 x 0.54 = 734.94 W
    p = array_power_w(np.array([0.0, 1000.0, 1361.0]), ArrayParams(area_m2=2.0, efficiency=0.3, derating=0.9))
    assert p == pytest.approx([0.0, 540.0, 734.94])
    # left Riemann: 0 x 1 h + 540 x 1 h = 540 Wh (the last sample closes the window)
    assert energy_wh(p, T[:3]) == pytest.approx(540.0)


def test_balance_ideal_battery_fills_then_discharges():
    # 100 Wh battery at 90 %, array 100 W for two hours then nothing, constant 50 W load.
    # step 1: +50 Wh -> 140, capped at 100, 40 curtailed ; step 2: +50 all curtailed ; step 3: -50 -> 50
    b = energy_balance(T, np.array([100.0, 100.0, 0.0, 0.0]), np.full(4, 50.0),
                       BatteryParams(capacity_wh=100.0, initial_soc=0.9))
    assert b.soc_wh == pytest.approx([90.0, 100.0, 100.0, 50.0])
    assert b.generated_wh == pytest.approx(200.0)
    assert b.consumed_wh == pytest.approx(150.0)
    assert b.curtailed_wh == pytest.approx(90.0)
    assert b.unserved_wh == 0.0 and b.survived and b.first_depletion_index is None
    assert b.min_soc == pytest.approx(0.5) and b.final_soc == pytest.approx(0.5)


def test_balance_depletes_with_floor_and_discharge_losses():
    # 100 Wh at 50 %, floor 20 %, discharge efficiency 0.8, no array, 40 W load.
    # step 1 needs 40 / 0.8 = 50 Wh, only 30 above the floor -> serves 24 Wh, 16 unserved
    # steps 2 and 3: battery at the floor -> 40 Wh unserved each. Total unserved 96 Wh, served 24 Wh.
    b = energy_balance(T, np.zeros(4), np.full(4, 40.0),
                       BatteryParams(capacity_wh=100.0, initial_soc=0.5, min_soc=0.2, discharge_efficiency=0.8))
    assert b.soc_wh == pytest.approx([50.0, 20.0, 20.0, 20.0])
    assert b.unserved_wh == pytest.approx(96.0) and b.consumed_wh == pytest.approx(24.0)
    assert not b.survived and b.first_depletion_index == 1
    assert b.depleted.tolist() == [False, True, True, True]


def test_balance_charge_efficiency_and_day_night_load():
    # sunlit then dark; day load 0 W, night load 10 W; 100 W array for one hour at eta_c = 0.9 -> +90 Wh
    load = load_series_w(np.array([True, False, False]), LoadParams(day_w=0.0, night_w=10.0))
    assert load.tolist() == [0.0, 10.0, 10.0]
    b = energy_balance(T[:3], np.array([100.0, 0.0, 0.0]), load,
                       BatteryParams(capacity_wh=1000.0, initial_soc=0.0, charge_efficiency=0.9))
    assert b.soc_wh == pytest.approx([0.0, 90.0, 80.0])
    battery = BatteryParams(capacity_wh=1000.0, initial_soc=0.5, min_soc=0.25, discharge_efficiency=0.8)
    assert night_energy_wh(100.0, LoadParams(day_w=0.0, night_w=10.0), battery) == pytest.approx(1250.0)
    assert usable_capacity_wh(battery) == pytest.approx(750.0)


# ------------------------------------------------------------------ HTTP contract

BASE = {"site_id": "mons-malapert", "start": "2027-03-01T00:00:00Z", "duration_h": 24 * 30, "step_min": 60}
ARRAY = {"area_m2": 2.0, "efficiency": 0.3, "derating": 1.0}
BATTERY = {"capacity_wh": 2000.0, "initial_soc": 1.0, "min_soc": 0.0, "charge_efficiency": 1.0,
           "discharge_efficiency": 1.0}


def test_level_1_visible_fraction_matches_the_engine():
    r = client.post("/api/v1/power", json={**BASE, "level": 1})
    assert r.status_code == 200, r.text
    body = r.json()
    store = get_store()
    series = services.evaluate_window(store, services.model_for_site(store, store.sites.get("mons-malapert"), 2.0),
                                      T0, 24 * 30, 60)
    m = compute_metrics(series)
    assert body["horizon_kind"] == "terrain" and len(body["t"]) == series.t_ms.size
    assert body["sun"]["visible_fraction"] == pytest.approx(series.sun_frac.tolist())
    assert body["sun"]["sunlit_fraction"] == pytest.approx(m.sunlight_pct / 100.0)
    assert body["sun"]["longest_dark_h"] == pytest.approx(m.longest_dark_h)
    assert (len(body["sun"]["sunlit_ranges"]) > 0) == (body["sun"]["sunlit_fraction"] > 0)
    assert body["array"] is None and body["balance"] is None


def test_level_2_array_power_is_irradiance_times_area_efficiency():
    r = client.post("/api/v1/power", json={**BASE, "level": 2, "panel": "tracking", "array": ARRAY})
    assert r.status_code == 200, r.text
    body = r.json()
    store = get_store()
    model = services.model_for_site(store, store.sites.get("mons-malapert"), 2.0)
    series = services.evaluate_window(store, model, T0,
                                      24 * 30, 60, AnalysisParams(panel="tracking"))
    expected = series.power_w_m2 * 2.0 * 0.3
    assert body["array"]["power_w"] == pytest.approx(expected.tolist())
    assert body["array"]["peak_power_w"] == pytest.approx(float(expected.max()))
    assert body["array"]["energy_wh"] == pytest.approx(float(np.sum(expected[:-1] * 1.0)))
    derated = client.post("/api/v1/power", json={**BASE, "level": 2, "panel": "tracking",
                                                 "array": {**ARRAY, "derating": 0.85}}).json()
    assert derated["array"]["energy_wh"] == pytest.approx(0.85 * body["array"]["energy_wh"])


def test_level_3_ideal_and_lossy_battery():
    ideal = client.post("/api/v1/power", json={**BASE, "level": 3, "array": ARRAY, "battery": BATTERY,
                                               "load": {"load_w": 50.0}})
    assert ideal.status_code == 200, ideal.text
    b = ideal.json()["balance"]
    assert len(b["soc_fraction"]) == len(ideal.json()["t"]) and 0.0 <= b["min_soc_fraction"] <= 1.0
    assert b["survived"] == (b["unserved_energy_wh"] == 0.0)
    assert set(b["load_w"]) == {50.0}                                    # night load defaults to load_w
    lossy = client.post("/api/v1/power", json={
        **BASE, "level": 3, "array": {**ARRAY, "derating": 0.85},
        "battery": {**BATTERY, "min_soc": 0.2, "charge_efficiency": 0.95, "discharge_efficiency": 0.95},
        "load": {"load_w": 50.0, "night_load_w": 80.0}})
    assert lossy.status_code == 200, lossy.text
    a = lossy.json()["balance"]
    assert a["min_soc_fraction"] >= 0.2 - 1e-9 and set(a["load_w"]) == {50.0, 80.0}
    assert a["generated_energy_wh"] == pytest.approx(0.85 * b["generated_energy_wh"])
    assert a["usable_capacity_wh"] == pytest.approx(1600.0)


def test_manual_coordinates_use_a_smooth_sphere():
    r = client.post("/api/v1/power", json={**BASE, "site_id": None, "lat": -85.0, "lon": 30.0, "level": 1,
                                           "duration_h": 48})
    assert r.status_code == 200, r.text
    assert r.json()["horizon_kind"] == "smooth_sphere" and r.json()["site_id"] is None


@pytest.mark.parametrize("payload", [
    {**BASE, "level": 2},                                                     # array missing
    {**BASE, "level": 3, "array": ARRAY},                                     # battery and load missing
    {**BASE, "level": 2, "array": {"area_m2": 2.0, "efficiency": 0.3}},       # derating missing: no defaults
    {**BASE, "level": 3, "array": ARRAY, "battery": {"capacity_wh": 100.0, "initial_soc": 1.0},
     "load": {"load_w": 50}},                                                 # battery losses missing
    {**BASE, "level": 2, "array": {**ARRAY, "efficiency": 1.5}},              # efficiency above 1
    {**BASE, "level": 1, "lat": -85.0, "lon": 30.0},                          # both site and coordinates
    {**BASE, "site_id": None, "level": 1},                                    # neither
    {**BASE, "level": 1, "duration_h": 24 * 3650, "step_min": 1},             # above the sample cap
    {**BASE, "level": 4},
])
def test_invalid_requests_return_422(payload):
    assert client.post("/api/v1/power", json=payload).status_code == 422


def test_unknown_site_and_dates_outside_the_tables():
    assert client.post("/api/v1/power", json={**BASE, "site_id": "nowhere", "level": 1}).status_code == 404
    r = client.post("/api/v1/power", json={**BASE, "start": "2040-01-01T00:00:00Z", "level": 1})
    assert r.status_code == 400 and "ephemeris" in r.json()["detail"].lower()
