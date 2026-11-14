"""Sun answers: hand-worked cases for app/logic/sun and the HTTP contract of POST /api/v1/sun."""
from __future__ import annotations

from datetime import datetime, timezone

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import services
from app.db.store import get_store
from app.logic.engine import compute_metrics
from app.logic.sun import elevation_stats, events, longest_run_h
from app.main import app

client = TestClient(app)
H = 3_600_000.0


# ------------------------------------------------------------------ hand-worked logic cases

def test_events_split_runs_and_keep_the_deepest_phase():
    t = np.arange(8) * H
    codes = np.array([0, 1, 2, 1, 0, 0, 1, 0])
    ev = events(t, codes)
    assert [(e.start_ms / H, e.end_ms / H, e.duration_h, e.max_code) for e in ev] == [(1, 3, 3.0, 2), (6, 6, 1.0, 1)]
    assert events(t, np.zeros(8)) == []


def test_longest_runs_and_elevation_stats():
    t = np.arange(6) * H
    lit = np.array([True, True, False, False, False, True])
    assert longest_run_h(lit, t, True) == 2.0 and longest_run_h(lit, t, False) == 3.0
    st = elevation_stats(np.array([2.0, 4.0, -1.0, -3.0, -2.0, 6.0]), lit)
    assert st == {"max_deg": 6.0, "min_deg": -3.0, "mean_sunlit_deg": 4.0}
    assert elevation_stats(np.array([-1.0]), np.array([False]))["mean_sunlit_deg"] is None


# ------------------------------------------------------------------ HTTP contract

BASE = {"site_id": "mons-malapert", "start": "2027-03-01T00:00:00Z", "duration_h": 24 * 30, "step_min": 60}


def test_sun_matches_the_engine_series_and_metrics():
    r = client.post("/api/v1/sun", json=BASE)
    assert r.status_code == 200, r.text
    b = r.json()
    store = get_store()
    t0 = services.to_ms(datetime(2027, 3, 1, tzinfo=timezone.utc))
    s = services.evaluate_window(store, services.model_for_site(store, store.sites.get("mons-malapert"), 2.0), t0, 24 * 30, 60)
    m = compute_metrics(s)
    assert b["horizon_kind"] == "terrain" and len(b["t"]) == s.t_ms.size
    assert b["sun_el_deg"] == pytest.approx(s.sun_el.tolist())
    assert b["sunlit_fraction"] == pytest.approx(m.sunlight_pct / 100.0)
    assert b["longest_dark_h"] == pytest.approx(m.longest_dark_h)
    assert b["sunlit_hours"] == pytest.approx(m.sunlight_pct / 100.0 * len(b["t"]))       # 1 h step
    assert b["elevation"]["max_deg"] == pytest.approx(m.max_sun_el_deg)
    assert b["now"]["elevation_deg"] == pytest.approx(s.sun_el[0])
    tr = b["next_transition"]
    assert tr is not None and tr["kind"] == ("set" if b["now"]["sunlit"] else "rise") and tr["in_hours"] > 0
    assert (b["hours_to_sunset"] is not None) == b["now"]["sunlit"]


def test_total_eclipse_at_blue_ghost_on_2025_03_14():
    # Total lunar eclipse of 2025-03-14 (NASA GSFC): totality 06:26-07:31 UTC, greatest 06:59 UTC.
    # From a near-side site the Earth then covers the whole Sun; Blue Ghost 1 was on the surface (Mare Crisium).
    r = client.post("/api/v1/sun", json={"site_id": "blue-ghost-1", "start": "2025-03-14T00:00:00Z",
                                         "duration_h": 12, "step_min": 1})
    assert r.status_code == 200, r.text
    b = r.json()
    assert len(b["eclipses"]) == 1
    e = b["eclipses"][0]
    assert e["kind"] == "total"
    assert e["start"] < "2025-03-14T05:10:00Z" and e["end"] > "2025-03-14T08:45:00Z"   # spans the umbral phases
    assert "2025-03-14T03:00:00Z" < e["start"] and e["end"] < "2025-03-14T10:00:00Z"   # inside the penumbral bounds
    i = b["t"].index("2025-03-14T06:59:00Z")
    assert b["now"]["sunlit"] and b["visible_fraction"][i] > 0                    # Sun above the horizon, but eclipsed


def test_manual_coordinates_and_errors():
    r = client.post("/api/v1/sun", json={**BASE, "site_id": None, "lat": -85.0, "lon": 30.0, "duration_h": 48})
    assert r.status_code == 200 and r.json()["horizon_kind"] == "smooth_sphere"
    assert client.post("/api/v1/sun", json={**BASE, "site_id": "nowhere"}).status_code == 404
    assert client.post("/api/v1/sun", json={**BASE, "lat": -85.0, "lon": 30.0}).status_code == 422
    assert client.post("/api/v1/sun", json={**BASE, "duration_h": 24 * 3650, "step_min": 1}).status_code == 422
    assert client.post("/api/v1/sun", json={**BASE, "start": "2040-01-01T00:00:00Z"}).status_code == 400
