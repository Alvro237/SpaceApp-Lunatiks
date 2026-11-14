"""Eclipses: the Earth covering the Sun as seen from the Moon (a lunar eclipse seen from the Earth).

Hand-worked cases for logic.visibility.disc_overlap_fraction, then the engine and the state endpoint against
NASA's lunar eclipse catalogue (tests/fixtures/nasa_lunar_eclipses_2025_2035.json, Espenak, GSFC).
"""
from __future__ import annotations

import json
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import services
from app.db.store import get_store
from app.logic.engine import evaluate, time_grid, visibility_ranges
from app.logic.visibility import disc_overlap_fraction
from app.main import app

client = TestClient(app)
CATALOGUE = json.loads((Path(__file__).parent / "fixtures" / "nasa_lunar_eclipses_2025_2035.json")
                       .read_text(encoding="utf-8"))["events"]
SITE = "apollo-11"   # near side, Sun and Earth well above the horizon at an eclipse


# ---------------------------------------------------------------------------- hand-worked overlap cases

def test_overlap_disjoint_discs_hide_nothing():
    assert disc_overlap_fraction(1.25, 0.27, 0.95) == 0.0       # d >= r1 + r2 (first contact at 1.22)


def test_overlap_target_inside_cover_is_total():
    assert disc_overlap_fraction(0.5, 0.27, 0.95) == 1.0        # d <= r2 - r1 = 0.68


def test_overlap_small_cover_inside_target_is_area_ratio():
    assert disc_overlap_fraction(0.2, 1.0, 0.5) == pytest.approx(0.25)   # (r2 / r1)^2


def test_overlap_equal_discs_one_radius_apart():
    # Two unit circles with centres 1 apart: lens = 2 acos(1/2) - sqrt(3)/2 = 2 pi/3 - sqrt(3)/2
    expected = (2 * math.pi / 3 - math.sqrt(3) / 2) / math.pi    # 0.391002
    assert disc_overlap_fraction(1.0, 1.0, 1.0) == pytest.approx(expected, abs=1e-12)


def test_overlap_half_plane_limit():
    # A huge cover whose edge passes through the target centre hides half of it
    assert disc_overlap_fraction(1000.0, 1.0, 1000.0) == pytest.approx(0.5, abs=1e-3)


def test_overlap_is_continuous_and_monotonic_through_contacts():
    d = np.linspace(0.0, 1.4, 2001)
    f = disc_overlap_fraction(d, 0.27, 0.95)
    assert np.all(np.diff(f) <= 1e-12)                         # never grows as the discs separate
    assert np.max(np.abs(np.diff(f))) < 0.01                   # no jumps at d = 0.68 or d = 1.22


# ---------------------------------------------------------------------------- against NASA's catalogue

def _utc(td: str) -> str:
    t = datetime.fromisoformat(td).replace(tzinfo=timezone.utc) - timedelta(seconds=69)   # TD -> UTC
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


@pytest.mark.parametrize("event", [e for e in CATALOGUE if e["type"] == "total"], ids=lambda e: e["greatest_td"])
def test_total_lunar_eclipses_black_out_the_sun(event):
    """At greatest eclipse of a total lunar eclipse the whole Moon is in the umbra: no sunlight anywhere."""
    r = client.get(f"/api/v1/sites/{SITE}/state", params={"t": _utc(event["greatest_td"])}).json()
    assert r["eclipse"] == "total" and r["sun_eclipsed_fraction"] == 1.0
    assert r["sun"]["visible_fraction"] == 1.0                   # the horizon is not what hides it


@pytest.mark.parametrize("event", [e for e in CATALOGUE if e["type"] == "penumbral"], ids=lambda e: e["greatest_td"])
def test_penumbral_eclipses_never_hide_the_whole_sun(event):
    r = client.get(f"/api/v1/sites/{SITE}/state", params={"t": _utc(event["greatest_td"])}).json()
    assert r["eclipse"] != "total" and r["sun_eclipsed_fraction"] < 1.0


def test_every_engine_eclipse_is_in_the_nasa_catalogue():
    """No invented events: every eclipse the engine finds at the site in 2025-2035 is a catalogue eclipse."""
    store = get_store()
    model = services.model_for_site(store, store.sites.get(SITE), 0.0)
    t = time_grid(services.to_ms(datetime(2025, 1, 1, tzinfo=timezone.utc)), 24 * 365 * 11 - 48, 10.0)
    s = evaluate(store.ephemeris, model, t)
    greatest = [services.to_ms(datetime.fromisoformat(e["greatest_td"]).replace(tzinfo=timezone.utc))
                for e in CATALOGUE]
    events = visibility_ranges(t, s.eclipse > 0)
    assert len(events) >= 20
    for a, b in events:
        assert any(a - 3_600_000 <= g <= b + 3_600_000 for g in greatest), services.iso_utc(a)


def test_eclipse_phases_through_the_endpoint():
    """2029-06-26 at the site: none, partial (share between 0 and 1), total."""
    p = [client.get(f"/api/v1/sites/{SITE}/state", params={"t": f"2029-06-26T{h}Z"}).json()
         for h in ("01:00:00", "02:00:00", "03:22:00")]
    assert [x["eclipse"] for x in p] == ["none", "partial", "total"]
    assert [x["sun_eclipsed_fraction"] for x in p][0] == 0.0 and 0.0 < p[1]["sun_eclipsed_fraction"] < 1.0


def test_engine_power_leaves_the_eclipse_to_the_power_model():
    """power_w_m2 = irradiance x horizon fraction x panel factor, with no eclipse factor: MECH's power, thermal and
    battery code apply (1 - obscuration) themselves, so the engine must not (it would count eclipses twice).
    sun_eclipsed_fraction carries the eclipse: 0, partial, then 1 in totality on 2029-06-26."""
    store = get_store()
    model = services.model_for_site(store, store.sites.get(SITE), 0.0)
    t = [services.to_ms(datetime(2029, 6, 26, h, m, tzinfo=timezone.utc)) for h, m in ((1, 0), (2, 0), (3, 22))]
    s = evaluate(store.ephemeris, model, t)
    assert s.power_w_m2 == pytest.approx(s.irradiance_w_m2 * s.sun_frac * np.cos(np.radians(s.sun_el)))
    assert s.power_w_m2[2] > 0
    assert s.sun_eclipsed_fraction[0] == 0.0 and 0 < s.sun_eclipsed_fraction[1] < 1 and s.sun_eclipsed_fraction[2] == 1.0
