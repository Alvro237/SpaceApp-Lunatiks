"""Thermal model: hand-worked steady states, the limit readings, the max_temperature filter and POST /api/v1/thermal.

The regolith and equipment numbers below are TEST INPUTS of a plausible magnitude, not cited defaults.
"""
from __future__ import annotations

from datetime import datetime, timezone

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import services
from app.db.store import get_store
from app.logic.constraints import evaluate_constraints
from app.logic.thermal import Equipment, Regolith, check_max, simulate
from app.main import app

client = TestClient(app)
H = 3_600_000.0
REG = {"albedo": 0.12, "emissivity": 0.95, "conductivity_w_mk": 0.002, "density_kg_m3": 1500.0,
       "heat_capacity_j_kgk": 600.0, "geothermal_flux_w_m2": 0.0}
BOX = {"absorptivity": 0.3, "emissivity": 0.8, "sun_area_m2": 0.5, "radiator_area_m2": 0.5, "ground_view_factor": 0.0,
       "heat_capacity_j_k": 100.0, "internal_power_w": 10.0}


def test_surface_stays_at_radiative_equilibrium():
    # constant absorbed flux 1361 x (1 - 0.12) = 1197.68 W/m2, eps 0.95:
    # T = (1197.68 / (0.95 x 5.670374e-8))^(1/4) = 386.15 K; started there with no geothermal flux it must stay.
    t = np.arange(49) * H
    res = simulate(t, np.full(49, 1197.68), Regolith(**REG), initial_k=386.15)
    assert res.surface_k[-1] == pytest.approx(386.15, abs=0.05)
    assert np.all(np.abs(res.deep_k - 386.15) < 0.05)


def test_equipment_steady_state_in_the_dark():
    # no Sun, 10 W inside, radiator 0.5 m2 at eps 0.8 seeing only cold space:
    # T = (10 / (0.8 x 0.5 x 5.670374e-8))^(1/4) = 144.90 K
    t = np.arange(49) * H
    res = simulate(t, np.zeros(49), Regolith(**REG), Equipment(**BOX), sun_w_m2=np.zeros(49), initial_k=250.0)
    assert res.equipment_k[-1] == pytest.approx(144.90, abs=0.1)
    assert np.all(np.diff(res.surface_k) <= 1e-9)                       # dark ground only cools


def test_limit_readings_hand_case():
    t = np.arange(5) * H
    temps = np.array([300.0, 410.0, 420.0, 300.0, 405.0])
    d = check_max(t, temps, 400.0, "discrete")
    assert not d.passed and d.fraction_above == pytest.approx(0.6) and d.longest_above_h == 2.0
    assert not check_max(t, temps, 400.0, "continuous", 1.5).passed       # 2 h above > 1.5 h allowed
    assert check_max(t, temps, 400.0, "continuous", 2.5).passed


BASE = {"site_id": None, "lat": 0.0, "lon": 0.0, "start": "2027-03-01T00:00:00Z", "duration_h": 24 * 30, "step_min": 60}


def test_equator_day_and_night_temperatures():
    r = client.post("/api/v1/thermal", json={**BASE, "regolith": {**REG, "geothermal_flux_w_m2": 0.018},
                                             "limits": {"max_k": 350.0, "min_k": 120.0}})
    assert r.status_code == 200, r.text
    b = r.json()
    assert 360.0 < b["surface"]["max_k"] < 400.0                     # noon near the radiative-equilibrium value
    assert 50.0 < b["surface"]["min_k"] < 150.0                      # lunar night
    assert b["limits_apply_to"] == "surface"
    assert b["above_max"]["passed"] is False and 0.0 < b["above_max"]["fraction_beyond"] < 1.0
    assert b["below_min"]["passed"] is False and len(b["below_min"]["ranges_beyond"]) >= 1
    assert 0.02 < b["skin_depth_m"] < 0.2


def test_equipment_node_through_the_api_and_errors():
    r = client.post("/api/v1/thermal", json={**BASE, "duration_h": 72, "regolith": REG,
                                             "equipment": {**BOX, "ground_view_factor": 0.5},
                                             "limits": {"min_k": 200.0, "mode": "continuous", "max_hours_beyond": 5}})
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["limits_apply_to"] == "equipment" and len(b["equipment_k"]) == len(b["t"])
    assert client.post("/api/v1/thermal", json={**BASE, "site_id": "nowhere", "lat": None, "lon": None,
                                                "regolith": REG}).status_code == 404


def test_lunar_regolith_default_reproduces_hayne_2017():
    # Hayne et al. 2017: global thermal inertia 55 J m-2 K-1 s-1/2 at 273 K, c_p(T) polynomial (Table A1),
    # density profile 1800 - 700 exp(-z / 0.06 m) taken at one diurnal skin depth
    from app.logic.thermal import LUNAR_REGOLITH as R, skin_depth_m
    t = 273.0
    cp = -3.6125 + 2.7431 * t + 2.3616e-3 * t**2 - 1.2340e-5 * t**3 + 8.9093e-9 * t**4
    assert R.heat_capacity_j_kgk == pytest.approx(cp, abs=0.1)
    assert (R.conductivity_w_mk * R.density_kg_m3 * R.heat_capacity_j_kgk) ** 0.5 == pytest.approx(55.0, abs=0.1)
    assert R.density_kg_m3 == pytest.approx(1800 - 700 * np.exp(-skin_depth_m(R) / 0.06), abs=1.0)
    assert (R.albedo, R.emissivity, R.geothermal_flux_w_m2) == (0.12, 0.95, 0.018)
    # without regolith the endpoint uses these values instead of failing
    r = client.post("/api/v1/thermal", json={**BASE, "duration_h": 24 * 30})
    assert r.status_code == 200, r.text
    assert 350 < r.json()["surface"]["max_k"] < 420 and r.json()["surface"]["min_k"] < 150


def test_max_temperature_filter():
    store = get_store()
    t0 = services.to_ms(datetime(2027, 3, 1, tzinfo=timezone.utc))
    ctx = services.constraint_context(store, services.model_for_point(store, 0.0, 0.0, 2.0), t0, 24 * 30)
    hot, ok = evaluate_constraints(ctx, {"max_temperature": {"max_k": 350.0, "mode": "discrete", "regolith": REG}})[0], \
        evaluate_constraints(ctx, {"max_temperature": {"max_k": 450.0, "mode": "discrete", "regolith": REG}})[0]
    assert hot.passed is False and hot.fraction > 0 and hot.ranges and hot.basis == "computed"
    assert ok.passed is True and ok.margin > 0
    assert "max_temperature" in client.get("/api/v1/meta/constraints").json()["hard_filters"]
