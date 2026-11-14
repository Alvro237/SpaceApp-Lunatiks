"""Radiation: hand-worked cases for app/logic/radiation, the max_dose filter and POST /api/v1/radiation."""
from __future__ import annotations

import math
from datetime import datetime, timezone

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import services
from app.db.store import get_store
from app.logic.constraints import evaluate_constraints
from app.logic.radiation import (climatology, effective_dose_msv, mission_dose, shielding_factor, sky_solid_angle)
from app.main import app

client = TestClient(app)
BASE = {"site_id": "shackleton", "start": "2027-03-01T00:00:00Z", "duration_h": 24 * 30}


# ------------------------------------------------------------------ hand-worked cases

def test_shielding_and_mission_dose_hand_cases():
    assert shielding_factor(2 * math.pi) == pytest.approx(0.5)              # flat ground: half the sky
    assert shielding_factor(math.pi) == pytest.approx(0.25)                 # deep crater seeing pi sr
    # 0.6 mGy/day free space, flat ground, 48 h -> 0.6 x 0.5 x 2 = 0.6 mGy
    assert mission_dose(0.6 * shielding_factor(2 * math.pi), 48.0) == pytest.approx(0.6)
    assert effective_dose_msv(10.0, 1.3, 3.0) == pytest.approx(39.0)
    assert effective_dose_msv(10.0, None, 3.0) is None


def test_sky_solid_angle_sources():
    assert sky_solid_angle(4.0, "terrain") == (4.0, "dataset")
    assert sky_solid_angle(None, "smooth_sphere") == (pytest.approx(2 * math.pi), "computed")
    assert sky_solid_angle(None, "terrain") == (None, "unavailable")


def test_climatology_hand_case():
    c = climatology(np.array([1.0, 2.0, 3.0, 4.0, 5.0, np.nan]))
    assert c["mean"] == 3.0 and c["p50"] == 3.0 and c["max"] == 5.0 and c["days"] == 5
    assert c["p05"] == pytest.approx(1.2) and c["p95"] == pytest.approx(4.8)


# ------------------------------------------------------------------ dataset

def test_crater_dataset_loads():
    rad = get_store().radiation
    assert rad.available and rad.meta["first"] == "2009-06-19" and rad.meta["last"] == "2013-04-30"
    assert len(rad.dates) == rad.meta["count"] == rad.measured.size
    mean = rad.gcr_free_space_mean()
    assert 0.3 < mean < 1.2                                                  # mGy(Si)/day, GCR free space


# ------------------------------------------------------------------ HTTP contract

def test_flat_point_gets_half_the_free_space_dose():
    r = client.post("/api/v1/radiation", json={**BASE, "site_id": None, "lat": 10.0, "lon": 20.0, "duration_h": 48})
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["horizon_kind"] == "smooth_sphere" and b["sky_source"] == "computed" and b["shielding_factor"] == pytest.approx(0.5)
    free = b["gcr_free_space_daily_mgy_si"]["mean"]
    assert b["gcr_surface_daily_mgy_si"]["mean"] == pytest.approx(free * 0.5)
    assert b["mission_gcr_dose_mgy_si"]["mean"] == pytest.approx(free * 0.5 * 2)
    assert b["mission_effective_dose_msv"] is None and b["fraction_of_career_limit"] is None
    assert b["basis"] == "climatology" and b["spe_record"]["largest_day"] == "2012-03-08"


def test_crater_floor_is_shielded_more_and_conversions_apply():
    b = client.post("/api/v1/radiation", json={**BASE, "si_to_tissue_factor": 1.3, "quality_factor": 3.0}).json()
    assert b["sky_source"] == "dataset" and b["shielding_factor"] < 0.5
    m, e = b["mission_gcr_dose_mgy_si"], b["mission_effective_dose_msv"]
    assert m["low"] <= m["mean"] <= m["high"]
    assert e["mean"] == pytest.approx(m["mean"] * 1.3 * 3.0)
    assert b["fraction_of_career_limit"] == pytest.approx(e["mean"] / 600.0)


def test_risk_index_scale_hand_cases():
    from app.logic.radiation import risk_index
    assert risk_index(0.6) == pytest.approx(1.0)        # 0.1 % of 600 mSv
    assert risk_index(6.0) == pytest.approx(4.0)        # 1 %
    assert risk_index(60.0) == pytest.approx(7.0)       # 10 %
    assert risk_index(600.0) == pytest.approx(10.0) and risk_index(5000.0) == 10.0 and risk_index(0.01) == 1.0


def test_risk_in_the_api():
    no_q = client.post("/api/v1/radiation", json=BASE).json()
    assert no_q["risk"] is None and no_q["mission_effective_dose_msv"] is None
    b = client.post("/api/v1/radiation", json={**BASE, "quality_factor": 3.8}).json()
    r, e = b["risk"], b["mission_effective_dose_msv"]["mean"]
    assert e == pytest.approx(b["mission_gcr_dose_mgy_si"]["mean"] * 1.333 * 3.8)          # default Si -> water
    assert r["share_of_career_limit"] == pytest.approx(e / 600.0)
    assert 1.0 <= r["index"] <= r["index_with_worst_storm"] <= 10.0 and r["worst_storm_msv"] > 0


def test_errors():
    assert client.post("/api/v1/radiation", json={**BASE, "site_id": "nowhere"}).status_code == 404
    assert client.post("/api/v1/radiation", json={**BASE, "quality_factor": 0}).status_code == 422


def test_max_dose_hard_filter():
    store = get_store()
    t0 = services.to_ms(datetime(2027, 3, 1, tzinfo=timezone.utc))
    ctx = services.constraint_context(store, services.model_for_point(store, 10.0, 20.0, 2.0), t0, 48)
    rate = store.radiation.gcr_free_space_mean()
    expected = rate * 0.5 * 2
    ok, bad = (evaluate_constraints(ctx, {"max_dose": {"max_mgy_si": v}})[0] for v in (expected + 0.01, expected - 0.01))
    assert ok.passed is True and ok.value == pytest.approx(expected) and ok.basis == "computed"
    assert bad.passed is False
    assert "max_dose" in client.get("/api/v1/meta/constraints").json()["hard_filters"]
