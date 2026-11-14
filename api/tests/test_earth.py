"""Earth answers: hand-worked cases for app/logic/earth and the HTTP contract of POST /api/v1/earth."""
from __future__ import annotations

from datetime import datetime, timezone

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import services
from app.db.store import get_store
from app.logic.earth import libration_wander
from app.logic.engine import AnalysisParams, compute_metrics
from app.main import app

client = TestClient(app)
BASE = {"site_id": "mons-malapert", "start": "2027-03-01T00:00:00Z", "duration_h": 24 * 30, "step_min": 60}


def test_libration_wander_unwraps_azimuth_across_north():
    w = libration_wander(np.array([350.0, 10.0, 0.0]), np.array([5.0, 7.0, 6.0]))
    assert w["azimuth_span_deg"] == pytest.approx(20.0)          # not 340
    assert w["elevation_span_deg"] == pytest.approx(2.0)
    assert w["mean_azimuth_deg"] == pytest.approx(0.0, abs=1e-9) or w["mean_azimuth_deg"] == pytest.approx(360.0)
    assert w["mean_elevation_deg"] == pytest.approx(6.0)


def test_earth_matches_the_engine_metrics():
    r = client.post("/api/v1/earth", json=BASE)
    assert r.status_code == 200, r.text
    b = r.json()
    store = get_store()
    t0 = services.to_ms(datetime(2027, 3, 1, tzinfo=timezone.utc))
    s = services.evaluate_window(store, services.model_for_site(store, store.sites.get("mons-malapert"), 2.0), t0, 24 * 30, 60)
    m = compute_metrics(s, AnalysisParams())
    assert b["horizon_kind"] == "terrain" and b["comms_min_fraction"] == 0.5
    assert b["earth_el_deg"] == pytest.approx(s.earth_el.tolist())
    assert b["visible_window_fraction"] == pytest.approx(m.comms_pct / 100.0)
    assert b["longest_blackout_h"] == pytest.approx(m.longest_blackout_h)
    assert (len(b["visible_ranges"]) > 0) == (b["visible_window_fraction"] > 0)
    tr = b["next_transition"]
    if tr is not None:
        assert tr["kind"] == ("set" if b["now"]["visible"] else "rise") and tr["in_hours"] > 0
    assert (b["hours_to_earthset"] is not None) == (tr is not None and tr["kind"] == "set")


def test_stricter_link_rule_never_gives_more_visibility():
    loose = client.post("/api/v1/earth", json={**BASE, "comms_min_fraction": 0.1}).json()
    strict = client.post("/api/v1/earth", json={**BASE, "comms_min_fraction": 1.0}).json()
    assert strict["visible_window_fraction"] <= loose["visible_window_fraction"]


def test_near_side_always_and_far_side_never():
    near = client.post("/api/v1/earth", json={**BASE, "site_id": None, "lat": 0.0, "lon": 0.0}).json()
    assert near["visible_window_fraction"] == 1.0 and near["longest_blackout_h"] == 0.0
    assert near["next_transition"] is None and near["now"]["elevation_deg"] > 75.0
    assert 1.0 < near["libration"]["elevation_span_deg"] < 20.0                    # libration of a few degrees
    assert near["now"]["angular_radius_deg"] == pytest.approx(0.95, abs=0.06)      # Earth ~1.9 deg wide
    far = client.post("/api/v1/earth", json={**BASE, "site_id": None, "lat": 0.0, "lon": 180.0}).json()
    assert far["visible_window_fraction"] == 0.0 and far["visible_ranges"] == [] and far["next_transition"] is None


def test_errors():
    assert client.post("/api/v1/earth", json={**BASE, "site_id": "nowhere"}).status_code == 404
    assert client.post("/api/v1/earth", json={**BASE, "comms_min_fraction": 0}).status_code == 422
    assert client.post("/api/v1/earth", json={**BASE, "start": "2040-01-01T00:00:00Z"}).status_code == 400
