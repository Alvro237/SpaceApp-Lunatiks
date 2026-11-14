"""Obscuration of the Sun by the Earth: hand-worked overlap cases and the 2025-03-14 eclipse at Blue Ghost 1."""
from __future__ import annotations

import math
from datetime import datetime, timezone

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import services
from app.db.store import get_store
from app.logic.eclipse import disc_overlap_fraction, separation_deg
from app.main import app

client = TestClient(app)


def test_overlap_hand_cases():
    # apart, concentric with a bigger Earth, and two equal unit discs one radius apart:
    # A = 2 acos(1/2) - (1/2) sqrt(3) = 1.22837 -> fraction 1.22837 / pi = 0.39100
    assert disc_overlap_fraction(3.0, 1.0, 1.5)[0] == 0.0
    assert disc_overlap_fraction(0.2, 0.27, 0.95)[0] == 1.0
    assert disc_overlap_fraction(1.0, 1.0, 1.0)[0] == pytest.approx((2 * math.acos(0.5) - 0.5 * math.sqrt(3)) / math.pi)
    # a small Earth fully inside a big Sun covers (R/r)^2 of it
    assert disc_overlap_fraction(0.0, 2.0, 1.0)[0] == pytest.approx(0.25)
    # monotonic: the closer the centres, the more is covered
    f = disc_overlap_fraction(np.linspace(1.3, 0.0, 50), 0.27, 0.95)
    assert np.all(np.diff(f) >= -1e-12) and f[0] == 0.0 and f[-1] == 1.0


def test_separation_from_az_el():
    assert separation_deg(0.0, 0.0, 90.0, 0.0) == pytest.approx(90.0)
    assert separation_deg(350.0, 10.0, 10.0, 10.0) == pytest.approx(19.70, abs=0.01)   # across north


def test_obscuration_agrees_with_engine_eclipse_codes_at_blue_ghost():
    from app.logic.eclipse import obscuration
    store = get_store()
    t0 = services.to_ms(datetime(2025, 3, 14, tzinfo=timezone.utc))
    s = services.evaluate_window(store, services.model_for_site(store, store.sites.get("blue-ghost-1"), 2.0), t0, 12, 1)
    occ = obscuration(s)
    assert np.mean((occ > 0) == (s.eclipse > 0)) > 0.99
    assert np.mean((occ >= 1.0 - 1e-9) == (s.eclipse == 2)) > 0.99


def test_power_drops_to_zero_during_totality_at_blue_ghost():
    body = {"site_id": "blue-ghost-1", "start": "2025-03-14T00:00:00Z", "duration_h": 12, "step_min": 1, "level": 2,
            "panel": "tracking", "panel_area_m2": 1.0, "cell_efficiency": 0.3, "derating": 1.0}
    b = client.post("/api/v1/power", json=body).json()
    i = b["t"].index("2025-03-14T06:59:00Z")
    assert b["obscuration"][i] == 1.0 and b["power_w"][i] == 0.0 and b["irradiance_w_m2"][i] == 0.0
    assert b["power_w"][0] > 300.0                         # Sun well up before the eclipse
    assert b["eclipse_energy_loss_wh"] > 1000.0            # ~4.8 h of ~400 W lost
    sun = client.post("/api/v1/sun", json={k: body[k] for k in ("site_id", "start", "duration_h", "step_min")}).json()
    assert sun["eclipses"][0]["max_obscuration"] == 1.0
