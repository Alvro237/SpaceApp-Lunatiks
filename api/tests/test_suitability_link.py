"""Radio link in the mission planner (AERO-2): the contact series of many sites over one antenna mask, the three measures
the planner uses (longest gap, contact per day, shortest pass) with hand-worked cases, and POST /api/v1/suitability/search
with the `link` settings on the real datasets."""
from __future__ import annotations

import base64

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.logic.link import (ANY_EARTH_FRACTION, any_antenna_sees_moon, longest_gap_h, min_daily_contact_h,
                            planner_contact, shortest_complete_pass_h, StationView)
from app.main import app

client = TestClient(app)
URL = "/api/v1/suitability/search"
REGION = {"center_lat": -89.3, "center_lon": 60.0, "radius_km": 25.0}
START = "2027-01-10T00:00:00Z"
HOUR = 3_600_000.0


def post(**kw) -> dict:
    body = {"region": REGION, "start": START, "duration_h": 168, "cell_km": 0.96, "categories": ["earth"], "criteria": [],
            "max_window_samples": 20, "top_k": 3}
    body.update(kw)
    return body


def layer(j: dict, category: str) -> np.ndarray:
    g = j["grid"]
    lay = next(x for x in j["layers"] if x["category"] == category)
    return np.frombuffer(base64.b64decode(lay["utility_b64"]), np.uint8).reshape(g["ny"], g["nx"])


# ---------------------------------------------------------------------------- pure functions, worked by hand

def _view(sees: list[bool]) -> StationView:
    z = np.zeros(len(sees))
    return StationView(az_deg=z, el_deg=z, limit_deg=z, sees_moon=np.array(sees), range_km=z)


def test_any_antenna_is_an_or_over_the_antennas():
    mask = any_antenna_sees_moon({"a": _view([True, False, False, True]), "b": _view([False, False, True, True])})
    assert mask.tolist() == [True, False, True, True]
    with pytest.raises(ValueError):
        any_antenna_sees_moon({})


def test_planner_contact_needs_the_earth_and_an_antenna():
    earth = np.array([0.0, 0.001, 0.5, 1.0, 0.7])
    mask = np.array([True, True, False, True, True])
    # an Earth fraction of 0 is below the horizon; any visible slice counts; no antenna means no contact
    assert planner_contact(earth, mask).tolist() == [False, True, False, True, True]
    assert ANY_EARTH_FRACTION < 0.01
    with pytest.raises(ValueError):
        planner_contact(earth, mask[:3])


def test_longest_gap():
    t = np.arange(6) * HOUR
    assert longest_gap_h(np.array([1, 0, 0, 1, 0, 1], bool), t) == 2.0      # samples 1-2
    assert longest_gap_h(np.ones(6, bool), t) == 0.0
    assert longest_gap_h(np.zeros(6, bool), t) == 6.0


def test_min_daily_contact_counts_full_days_only():
    t = np.arange(49) * HOUR                      # 48 h: two full days; the sample at 48 h opens a third
    c = np.zeros(49, bool)
    c[0:6] = True                                 # day 1: 6 h
    c[24:27] = True                               # day 2: 3 h
    c[48] = True                                  # the last sample is not a day
    assert min_daily_contact_h(c, t) == 3.0
    assert min_daily_contact_h(np.zeros(49, bool), t) == 0.0
    # a 10 h window holds no complete day
    assert np.isnan(min_daily_contact_h(np.ones(11, bool), np.arange(11) * HOUR))
    # a 30 minute step: hours are samples x step (4 samples = 2 h on day 1, 6 samples = 3 h on day 2)
    t2 = np.arange(97) * 0.5 * HOUR
    c2 = np.zeros(97, bool)
    c2[0:4] = True
    c2[48:54] = True
    assert min_daily_contact_h(c2, t2) == 2.0


def test_shortest_complete_pass():
    t = np.arange(10) * HOUR
    #            0  1  2  3  4  5  6  7  8  9
    c = np.array([1, 1, 0, 1, 0, 0, 1, 1, 1, 0], bool)
    # [0,2) starts with the window and is not checked; [3,4) lasts 1 h; [6,9) lasts 3 h
    assert shortest_complete_pass_h(c, t) == 1.0
    assert shortest_complete_pass_h(np.zeros(10, bool), t) == 0.0            # no contact at all
    assert shortest_complete_pass_h(np.ones(10, bool), t) == float("inf")    # one pass cut at both ends
    assert shortest_complete_pass_h(np.array([0, 0, 0, 1, 1, 1, 1, 1, 1, 1], bool), t) == float("inf")  # cut by the end


# ---------------------------------------------------------------------------- the search

@pytest.mark.parametrize("body,detail", [
    (post(categories=["earth"], criteria=[{"id": "link_min_daily_h", "limit": 2}]), "needs the radio link settings"),
    (post(categories=["earth"], criteria=[{"id": "link_min_pass_h", "limit": 2}]), "needs the radio link settings"),
    (post(categories=["earth"], criteria=[{"id": "link_min_daily_h", "limit": 2}], link={}, duration_h=12), "at least 24 h"),
    (post(categories=["earth"], link={"networks": ["nope"]}), "unknown network"),
    (post(categories=["earth"], link={"networks": ["estrack"], "direction": "uplink_high_power"}), "elevation limit"),
    (post(categories=["earth"], criteria=[{"id": "link_min_daily_h", "limit": 30}], link={}), "link_min_daily_h"),
    (post(categories=["power"], criteria=[{"id": "link_min_pass_h", "limit": 1}], link={}), "switched off"),
])
def test_link_422(body, detail):
    r = client.post(URL, json=body)
    assert r.status_code == 422, r.text
    assert detail in str(r.json()["detail"])


def test_link_empty_selection_is_422():
    r = client.post(URL, json=post(link={"networks": []}))
    assert r.status_code == 422


def test_link_outside_the_moon_table_is_422():
    r = client.post(URL, json=post(start="1970-06-01T00:00:00Z", link={}))
    assert r.status_code == 422
    assert "Moon table" in str(r.json()["detail"])


def test_link_search_reports_and_applies_the_criteria():
    body = post(categories=["earth"], link={"networks": ["dsn", "estrack", "jaxa"]},
                criteria=[{"id": "blackout_h", "limit": 168}, {"id": "link_min_daily_h", "limit": 0},
                          {"id": "link_min_pass_h", "limit": 0}])
    r = client.post(URL, json=body)
    assert r.status_code == 200, r.text
    j = r.json()
    assert any(a.startswith("Radio link:") for a in j["assumptions"])
    assert j["sites"]
    for s in j["sites"]:
        assert s["horizon_kind"] == "terrain"
        crits = {c["id"]: c for c in s["criteria"]}
        assert {"blackout_h", "link_min_daily_h", "link_min_pass_h"} <= set(crits)
        assert all(c["passes"] is not False for c in s["criteria"])
        assert crits["link_min_daily_h"]["value"] is not None and 0.0 <= crits["link_min_daily_h"]["value"] <= 24.0


def test_a_daily_contact_limit_removes_cells():
    base = post(categories=["earth"], link={}, max_window_samples=30)
    easy = client.post(URL, json={**base, "criteria": [{"id": "link_min_daily_h", "limit": 0}]}).json()
    hard = client.post(URL, json={**base, "criteria": [{"id": "link_min_daily_h", "limit": 24}]}).json()
    assert easy["counts"]["viable"] >= hard["counts"]["viable"]
    for s in hard["sites"]:
        assert next(c for c in s["criteria"] if c["id"] == "link_min_daily_h")["value"] >= 24.0 - 1e-6


def test_more_networks_never_reduce_the_contact_share():
    """The antennas of a smaller selection are a subset: at every cell the Earth score of the full selection is at least
    that of JAXA alone (same quadtree samples, same horizons; only the antenna mask changes)."""
    everyone = client.post(URL, json=post(link={"networks": ["dsn", "estrack", "jaxa"]})).json()
    jaxa = client.post(URL, json=post(link={"networks": ["jaxa"]})).json()
    all_q, jaxa_q = layer(everyone, "earth"), layer(jaxa, "earth")
    assert np.all(all_q >= jaxa_q)
    assert (all_q > jaxa_q).any(), "the extra antennas add contact somewhere"


def test_uplink_uses_the_transmit_limits():
    r = client.post(URL, json=post(link={"networks": ["dsn"], "direction": "uplink_low_power"}))
    assert r.status_code == 200, r.text
    assert any("uplink_low_power" in a for a in r.json()["assumptions"])


def test_bound_stays_sound_with_the_link():
    """The ephemeris bound proves the Earth is hidden for longer than the limit; contact with an antenna is a subset of
    the Earth being in view, so every cell it drops also fails the link blackout when evaluated exactly."""
    from datetime import datetime, timezone
    from app import area_search, services
    from app.db.store import get_store
    from app.logic.engine import AnalysisParams, make_model
    from app.logic.projection import south_polar_latlon

    far = {"center_lat": -68.0, "center_lon": 150.0, "radius_km": 40.0}
    body = {"region": far, "start": START, "duration_h": 708.7, "cell_km": 1.92, "categories": ["earth"],
            "criteria": [{"id": "blackout_h", "limit": 300}], "link": {}, "max_window_samples": 4, "top_k": 1}
    r = client.post(URL, json=body)
    assert r.status_code == 200, r.text
    j = r.json()
    g = j["grid"]
    codes = np.frombuffer(base64.b64decode(j["codes_b64"]), np.uint8).reshape(g["ny"], g["nx"])
    dropped = np.argwhere(codes == 5)
    assert dropped.size, "the bound is active on the far region"
    store = get_store()
    stations = services.link_stations(store, ["dsn", "estrack", "jaxa"], "downlink", [])
    start_ms = datetime(2027, 1, 10, tzinfo=timezone.utc).timestamp() * 1000.0
    rng = np.random.default_rng(0)
    for i, jj in dropped[rng.choice(len(dropped), size=min(20, len(dropped)), replace=False)]:
        x = g["x_left_m"] + (jj + 0.5) * g["cell_m"]
        y = g["y_top_m"] - (i + 0.5) * g["cell_m"]
        lat, lon = (float(v) for v in south_polar_latlon(np.array(x), np.array(y)))
        ground = float(area_search._finest_xy(store, area_search.ELEVATION_GRIDS, np.array([x]), np.array([y]), True)[0])
        hz = area_search._sample_horizon(store, lat, lon, ground, 2.0, 0.5, 150_000.0)
        series = services.evaluate_window(store, make_model(lat, lon, ground, hz, 2.0), start_ms, 708.7, 60.0,
                                          AnalysisParams())
        mask = services.link_antenna_mask(store, stations, series.t_ms)
        assert longest_gap_h(planner_contact(series.earth_frac, mask), series.t_ms) > 300, (lat, lon)


def test_without_link_nothing_changes():
    """No `link` field: the Earth score is the share of the window with the Earth's disc above the threshold, as before."""
    j = client.post(URL, json=post()).json()
    assert not any(a.startswith("Radio link:") for a in j["assumptions"])
