"""GET /api/v1/sites/{site_id}/series: contract, guards and numerical validation (see tests/sw1_validation.py)."""
from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.schemas.state import SeriesResponse
from tests import sw1_validation as v

client = TestClient(app)
URL = "/api/v1/sites/{}/series"
START = "2026-11-20T12:00:00Z"


def get(site="im-2", **params):
    return client.get(URL.format(site), params={"start": START, "duration_h": 720, **params})


def test_happy_path_matches_the_contract():
    r = get()
    assert r.status_code == 200
    body = SeriesResponse.model_validate(r.json())
    assert body.samples == 4321 == len(body.t) == len(body.sun.el)        # 30 days at the default 10 min
    assert body.step_min == 10 and body.mast_m == 0.0 and body.horizon_kind == "terrain"
    assert body.start == START and body.end == "2026-12-20T12:00:00Z"


@pytest.mark.parametrize("site,start,hours,step", v.SERIES_CASES)
def test_series_is_internally_consistent(site, start, hours, step):
    r = client.get(URL.format(site), params={"start": start, "duration_h": hours, "step_min": step}).json()
    assert v.series_invariants(r) == []


@pytest.mark.parametrize("site,start,hours,step", v.SERIES_CASES[:2])
def test_series_equals_state_and_edges_flip_it(site, start, hours, step):
    r = client.get(URL.format(site), params={"start": start, "duration_h": hours, "step_min": step}).json()
    assert v.series_matches_state(client, site, r) == []


def test_first_edges_are_state_next_transitions():
    """The first inner sunset and Earthset of the series are the ones state announces from the window start."""
    s = get().json()
    st = client.get(f"/api/v1/sites/im-2/state", params={"t": START}).json()
    assert s["sunlit_ranges"][0]["end"] == st["next_sun_transition"]["at"]
    assert s["comms_ranges"][0]["end"] == st["next_earth_transition"]["at"]


def test_edges_do_not_depend_on_the_step():
    """Edges are refined to the second, so a coarse and a fine grid give the same instants."""
    coarse, fine = get(step_min=60).json(), get(step_min=5).json()
    for key in ("sunlit_ranges", "comms_ranges"):
        assert [(x["start"], x["end"]) for x in coarse[key]] == [(x["start"], x["end"]) for x in fine[key]]


def test_night_cut_by_the_window_is_flagged():
    r = get().json()
    first, last = r["sunlit_ranges"][0], r["sunlit_ranges"][-1]
    assert first["starts_before_window"] and first["start"] == START
    assert last["ends_after_window"] and last["end"] == r["end"]


def test_matches_jpl_horizons_through_series():
    rows = v.horizons_comparisons(client, "series")
    assert len(rows) >= 30
    assert max(x["error_deg"] for x in rows) < v.HORIZONS_TOL_DEG


def test_total_eclipse_shows_up_as_a_range_around_nasa_greatest_eclipse():
    """NASA: total lunar eclipse 2029-06-26, greatest at 03:23:22 TD (03:22:13 UTC)."""
    r = client.get(URL.format("apollo-11"), params={"start": "2029-06-25T12:00:00Z", "duration_h": 36}).json()
    assert len(r["eclipse_ranges"]) == 1 and r["metrics"]["eclipse_events"] == 1
    a, b = (datetime.fromisoformat(r["eclipse_ranges"][0][k].replace("Z", "+00:00")) for k in ("start", "end"))
    greatest = datetime(2029, 6, 26, 3, 22, 13, tzinfo=timezone.utc)
    assert a < greatest < b and timedelta(hours=3) < b - a < timedelta(hours=6)
    assert "total" in r["eclipse"]


def test_no_power_numbers_in_series():
    r = get(duration_h=24).json()
    assert not {"panel", "irradiance_w_m2", "power_w_m2"} & set(r) and "mean_power_w_m2" not in r["metrics"]


def test_null_mast_is_zero():
    assert get(duration_h=24, mast_m="null").json() == get(duration_h=24, mast_m=0).json()


def test_unknown_site_is_404():
    assert get("atlantis").status_code == 404


@pytest.mark.parametrize("params", [{"start": None}, {"duration_h": None}, {"duration_h": 0}, {"duration_h": -5},
                                    {"step_min": 0.5}, {"step_min": 2000}, {"start": "tomorrow"}])
def test_invalid_input_is_422(params):
    query = {"start": START, "duration_h": 24, **params}
    assert client.get(URL.format("im-2"), params={k: x for k, x in query.items() if x is not None}).status_code == 422


def test_sample_cap_is_422_with_the_count():
    r = get(duration_h=24 * 365, step_min=10)
    assert r.status_code == 422 and "52561 samples" in r.json()["detail"]
    assert get(duration_h=(20_000 - 1) * 10 / 60).status_code == 200          # exactly at the cap


@pytest.mark.parametrize("start,hours", [("2040-01-01T00:00:00Z", 24), ("2035-12-31T00:00:00Z", 48)])
def test_window_outside_the_tables_is_400(start, hours):
    r = client.get(URL.format("im-2"), params={"start": start, "duration_h": hours})
    assert r.status_code == 400 and "ephemeris tables" in r.json()["detail"]


def test_thirty_days_answer_fast():
    t = time.perf_counter()
    assert get().status_code == 200
    assert time.perf_counter() - t < 2.0          # measured ~0.16 s; generous for slow CI machines


def test_the_series_validator_catches_wrong_data():
    good = get(duration_h=48).json()
    assert v.series_invariants(good) == []
    tampered = []
    bad = dict(good, metrics={**good["metrics"], "sunlight_pct": 12.3}); tampered.append(bad)
    bad = dict(good, sun={**good["sun"], "visible": [not x for x in good["sun"]["visible"]]}); tampered.append(bad)
    bad = dict(good, sunlit_ranges=[]); tampered.append(bad)
    bad = dict(good, power_w_m2=[0.0] * good["samples"]); tampered.append(bad)
    for b in tampered:
        assert v.series_invariants(b), "tampered series not detected"
