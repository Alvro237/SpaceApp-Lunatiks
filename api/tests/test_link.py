"""Radio link level 1: hand-worked cases for app/logic/link and the HTTP contract of POST /api/v1/link."""
from __future__ import annotations

from datetime import datetime, timezone

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import services
from app.db.store import get_store
from app.logic.link import (BOLTZMANN_DBW_PER_K_HZ, LinkBudgetParams, StationSpec, combine_contact, ebn0_db,
                            free_space_loss_db, margin_db, max_data_rate_bps, station_view)
from app.logic.stations import moon_az_el
from app.main import app

client = TestClient(app)
BASE = {"site_id": "mons-malapert", "start": "2027-03-01T00:00:00Z", "duration_h": 24 * 30, "step_min": 60}
MOON_KM = 384_400.0
BUDGET = {"frequency_ghz": 8.4, "transmit_eirp_dbw": 10.0, "receive_gt_db_per_k": 40.0, "data_rate_bps": 1e6,
          "required_ebn0_db": 2.5}


# ------------------------------------------------------------------------------ logic

def test_combine_contact_hand_worked_case():
    earth = np.array([True, True, False, True])
    a = np.array([True, False, True, False])
    b = np.array([False, False, True, True])
    c = combine_contact(earth, {"a": a, "b": b})
    assert c.any_station.tolist() == [True, False, True, True]
    assert c.contact.tolist() == [True, False, False, True]          # needs the Earth AND some antenna
    assert c.contact_by_station["a"].tolist() == [True, False, False, False]
    assert c.contact_by_station["b"].tolist() == [False, False, False, True]
    with pytest.raises(ValueError):
        combine_contact(earth, {})
    with pytest.raises(ValueError):
        combine_contact(earth, {"a": a[:3]})


def test_station_view_overhead_and_below_the_horizon():
    spec = StationSpec("x", 0.0, 0.0, 0.0, 6.0)
    moon = np.array([[MOON_KM, 0.0, 0.0], [0.0, MOON_KM, 0.0], [-MOON_KM, 0.0, 0.0]])   # zenith, due east, far side
    v = station_view(spec, moon)
    assert v.sees_moon.tolist() == [True, False, False]
    assert v.el_deg[0] == pytest.approx(90.0) and v.limit_deg.tolist() == [6.0, 6.0, 6.0]


def test_station_view_with_an_azimuth_mask():
    # a mask that blocks the east (azimuth 90) up to 20 deg: the Moon 10 deg above the east horizon is hidden
    mask = np.array([5.0, 20.0, 5.0, 5.0])                           # azimuths 0, 90, 180, 270
    spec = StationSpec("m", 0.0, 0.0, 0.0, mask, 90.0)
    # station on the equator at longitude 0: up = +X, east = +Y; a direction 10 deg above due east from the antenna
    east_10 = np.array([[MOON_KM * np.sin(np.radians(10)) + 6378.137, MOON_KM * np.cos(np.radians(10)), 0.0]])
    az, el = moon_az_el(east_10, 0.0, 0.0)
    assert az[0] == pytest.approx(90.0, abs=1e-6) and el[0] == pytest.approx(10.0, abs=0.01)
    assert station_view(spec, east_10).sees_moon.tolist() == [False]
    assert station_view(StationSpec("n", 0.0, 0.0, 0.0, 5.0), east_10).sees_moon.tolist() == [True]


# ------------------------------------------------------------------------------ catalogue endpoint

def test_station_catalogue():
    r = client.get("/api/v1/link/stations")
    assert r.status_code == 200
    b = r.json()
    assert set(b["networks"]) == {"dsn", "estrack", "jaxa"} and len(b["stations"]) == 18
    esa = [s for s in b["stations"] if s["network"] == "estrack"]
    assert len(esa) == 3 and all(s["limit_source"] == "owner_estimate" and not s["has_azimuth_mask"] for s in esa)
    dss63 = next(s for s in b["stations"] if s["id"] == "dss-63")
    assert dss63["has_azimuth_mask"] and dss63["has_transmit_limits"] and dss63["receive_limit_deg"]["min"] == 6.0


# ------------------------------------------------------------------------------ link endpoint

def test_link_invariants_and_consistency_with_earth_endpoint():
    r = client.post("/api/v1/link", json=BASE)
    assert r.status_code == 200, r.text
    b = r.json()
    n = len(b["t"])
    assert len(b["contact"]) == n and b["level"] == 1 and b["direction"] == "downlink"
    assert b["horizon_kind"] == "terrain" and len(b["stations"]) == 18 and b["skipped_stations"] == []
    # contact needs both ends, so it can never exceed either of them
    assert b["contact_window_fraction"] <= b["earth_visible_fraction"] + 1e-12
    assert b["contact_window_fraction"] <= b["any_station_fraction"] + 1e-12
    assert b["contact_window_fraction"] == pytest.approx(sum(b["contact"]) / n)
    assert b["contact_hours"] == pytest.approx(sum(b["contact"]) * 1.0)
    for s in b["stations"]:
        assert s["contact_fraction"] <= min(b["earth_visible_fraction"], s["moon_visible_fraction"]) + 1e-12
        assert s["contact_hours"] <= b["contact_hours"] + 1e-9
    # the lunar-site half is exactly what POST /earth computes
    earth = client.post("/api/v1/earth", json=BASE).json()
    assert b["earth_visible_fraction"] == pytest.approx(earth["visible_window_fraction"])
    assert b["earth_visible_ranges"] == earth["visible_ranges"]
    assert b["now"]["contact"] == (b["now"]["earth_visible"] and b["now"]["any_station_sees_moon"])


def test_custom_station_matches_the_geometry_directly():
    """One user antenna at DSS-63's position with a 6 deg limit: the response must equal moon_az_el on the table."""
    store = get_store()
    dss = store.stations.get("dss-63")
    body = {**BASE, "networks": [], "custom_stations": [
        {"id": "mine", "lat_deg": dss.lat_deg, "lon_deg": dss.lon_deg, "height_m": dss.height_m, "min_elevation_deg": 6.0}]}
    b = client.post("/api/v1/link", json=body).json()
    t0 = services.to_ms(datetime(2027, 3, 1, tzinfo=timezone.utc))
    t = t0 + 3_600_000.0 * np.arange(24 * 30 + 1)
    _az, el = moon_az_el(store.stations.moon.positions(t), dss.lat_deg, dss.lon_deg, dss.height_m)
    only = b["stations"][0]
    assert only["id"] == "mine" and only["network"] == "custom" and only["limit_source"] == "user"
    assert only["moon_visible_fraction"] == pytest.approx(float((el >= 6.0).mean()))
    assert only["now_moon_elevation_deg"] == pytest.approx(float(el[0]))
    assert b["estimated_limits"] == [] and b["networks_used"] == ["custom"]
    assert b["any_station_fraction"] == pytest.approx(only["moon_visible_fraction"])


def test_near_side_always_sees_the_earth_and_far_side_never():
    near = client.post("/api/v1/link", json={**BASE, "site_id": None, "lat": 0.0, "lon": 0.0}).json()
    assert near["earth_visible_fraction"] == 1.0
    assert near["contact_window_fraction"] == pytest.approx(near["any_station_fraction"])   # the antennas decide
    assert near["horizon_kind"] == "smooth_sphere"
    far = client.post("/api/v1/link", json={**BASE, "site_id": None, "lat": 0.0, "lon": 180.0}).json()
    assert far["contact_window_fraction"] == 0.0 and far["contact_ranges"] == [] and far["longest_contact_h"] == 0.0


def test_the_three_networks_together_cover_more_than_any_one():
    base = {**BASE, "site_id": None, "lat": 0.0, "lon": 0.0}
    each = {n: client.post("/api/v1/link", json={**base, "networks": [n]}).json()["contact_window_fraction"]
            for n in ("dsn", "estrack", "jaxa")}
    allnets = client.post("/api/v1/link", json=base).json()["contact_window_fraction"]
    assert allnets >= max(each.values()) and allnets > 0.9


def test_directions_use_their_own_limits():
    base = {**BASE, "site_id": None, "lat": 0.0, "lon": 0.0, "networks": ["dsn"]}
    down = client.post("/api/v1/link", json=base).json()["contact_hours"]
    low = client.post("/api/v1/link", json={**base, "direction": "uplink_low_power"}).json()["contact_hours"]
    high = client.post("/api/v1/link", json={**base, "direction": "uplink_high_power"}).json()["contact_hours"]
    assert down >= low >= high                                                     # higher limits, fewer hours
    mixed = client.post("/api/v1/link", json={**base, "networks": ["dsn", "estrack"], "direction": "uplink_low_power"}).json()
    assert sorted(s["id"] for s in mixed["skipped_stations"]) == [
        "esa-dsa1-new-norcia", "esa-dsa2-cebreros", "esa-dsa3-malargue"]
    assert client.post("/api/v1/link", json={**base, "networks": ["estrack"], "direction": "uplink_low_power"}).status_code == 422


def test_estimated_limits_are_reported():
    esa = client.post("/api/v1/link", json={**BASE, "networks": ["estrack"]}).json()
    assert esa["estimated_limits"] == ["esa-dsa1-new-norcia", "esa-dsa2-cebreros", "esa-dsa3-malargue"]
    assert any("estimated elevation limit" in a for a in esa["assumptions"])
    dsn = client.post("/api/v1/link", json={**BASE, "networks": ["dsn"]}).json()
    assert dsn["estimated_limits"] == []


def test_errors():
    post = lambda body: client.post("/api/v1/link", json=body).status_code  # noqa: E731
    assert post({**BASE, "site_id": "nowhere"}) == 404
    assert post({**BASE, "networks": ["nasa"]}) == 422                      # unknown network
    assert post({**BASE, "networks": []}) == 422                            # no antenna at all
    assert post({**BASE, "level": 2}) == 422                                # level 2 needs a budget
    assert post({**BASE, "level": 3}) == 422
    assert post({**BASE, "budget": BUDGET}) == 422                          # a budget is not used at level 1
    assert post({**BASE, "level": 2, "budget": {**BUDGET, "data_rate_bps": 0}}) == 422
    assert post({**BASE, "level": 2, "budget": {k: v for k, v in BUDGET.items() if k != "transmit_eirp_dbw"}}) == 422
    assert post({**BASE, "networks": [], "custom_stations": [
        {"id": "a", "lat_deg": 0, "lon_deg": 0, "min_elevation_deg": 5},
        {"id": "a", "lat_deg": 1, "lon_deg": 1, "min_elevation_deg": 5}]}) == 422             # duplicate custom ids
    assert post({**BASE, "custom_stations": [{"id": "dss-14", "lat_deg": 0, "lon_deg": 0, "min_elevation_deg": 5}]}) == 422
    assert post({**BASE, "custom_stations": [{"id": "x", "lat_deg": 0, "lon_deg": 0}]}) == 422   # limit is required
    assert post({**BASE, "start": "2040-01-01T00:00:00Z"}) == 400
    assert post({**BASE, "start": "1970-01-01T00:00:00Z"}) == 400            # Apollo-era tables: no Moon table there


# ------------------------------------------------------------------------------ level 2: link budget (hand-worked)

def test_free_space_loss_at_lunar_distance():
    """20 log10(d_m) + 20 log10(f_Hz) - 147.55: 384 400 km at 8.4 GHz is 222.63 dB, at 2.25 GHz 211.19 dB."""
    assert float(free_space_loss_db(384_400.0, 8.4)) == pytest.approx(222.63, abs=0.01)
    assert float(free_space_loss_db(384_400.0, 2.25)) == pytest.approx(211.19, abs=0.01)
    # doubling the distance costs 6.02 dB
    assert float(free_space_loss_db(768_800.0, 8.4) - free_space_loss_db(384_400.0, 8.4)) == pytest.approx(6.0206, abs=1e-3)


def test_ebn0_hand_worked_case():
    """EIRP 10 dBW, G/T 40 dB/K, 8.4 GHz, 384 400 km, 1 Mbit/s, no other losses:
    10 - 222.63 + 40 + 228.60 - 60 = -4.03 dB (k = 1.380649e-23 J/K = -228.599 dBW/K/Hz)."""
    p = LinkBudgetParams(frequency_ghz=8.4, transmit_eirp_dbw=10.0, receive_gt_db_per_k=40.0, data_rate_bps=1e6,
                         required_ebn0_db=2.5)
    assert BOLTZMANN_DBW_PER_K_HZ == pytest.approx(-228.599, abs=1e-3)
    assert float(ebn0_db(384_400.0, p)) == pytest.approx(-4.03, abs=0.01)
    assert float(margin_db(384_400.0, p)) == pytest.approx(-6.53, abs=0.01)      # 2.5 dB required


def test_data_rate_and_margin_trade_off_decibel_for_decibel():
    p = LinkBudgetParams(frequency_ghz=8.4, transmit_eirp_dbw=10.0, receive_gt_db_per_k=40.0, data_rate_bps=1e6,
                         required_ebn0_db=2.5, min_margin_db=3.0)
    rate = float(max_data_rate_bps(384_400.0, p))
    assert rate == pytest.approx(1e6 * 10 ** (-9.53 / 10), rel=0.01)             # margin -6.53 - 3 dB of headroom
    # at that rate the margin equals the required minimum, exactly
    at_max = LinkBudgetParams(**{**p.__dict__, "data_rate_bps": rate})
    assert float(margin_db(384_400.0, at_max)) == pytest.approx(3.0, abs=1e-9)
    # ten times the data rate costs 10 dB of margin
    tenfold = LinkBudgetParams(**{**p.__dict__, "data_rate_bps": 1e7})
    assert float(margin_db(384_400.0, p) - margin_db(384_400.0, tenfold)) == pytest.approx(10.0, abs=1e-9)


# ------------------------------------------------------------------------------ level 2: endpoint

def _l2(**over):
    body = {**BASE, "site_id": None, "lat": 0.0, "lon": 0.0, "networks": ["dsn"], "level": 2, "budget": {**BUDGET, **over}}
    r = client.post("/api/v1/link", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def test_level_2_link_is_inside_the_geometric_contact():
    b = _l2()
    assert b["level"] == 2 and b["budget"] is not None
    link, contact = b["budget"]["link"], b["contact"]
    assert all(c or not l for l, c in zip(link, contact))                          # link implies contact
    assert b["budget"]["link_window_fraction"] <= b["contact_window_fraction"] + 1e-12
    assert len(b["budget"]["best_margin_db"]) == len(b["t"])
    assert all((m is None) == (not c) for m, c in zip(b["budget"]["best_margin_db"], contact))   # margin only in contact
    assert any("EIRP" in a for a in b["assumptions"])
    lvl1 = client.post("/api/v1/link", json={**BASE, "site_id": None, "lat": 0.0, "lon": 0.0, "networks": ["dsn"]}).json()
    assert lvl1["budget"] is None and lvl1["contact"] == contact                  # level 1 geometry is unchanged


def test_level_2_follows_the_link_equation():
    weak, strong = _l2(transmit_eirp_dbw=-40.0), _l2(transmit_eirp_dbw=80.0)
    assert weak["budget"]["link_hours"] == 0.0 and weak["budget"]["link"] == [False] * len(weak["t"])
    assert strong["budget"]["link"] == strong["contact"]                          # plenty of margin: geometry decides
    # +10 dB EIRP moves every station's margin by exactly 10 dB
    a, c = _l2(transmit_eirp_dbw=10.0), _l2(transmit_eirp_dbw=20.0)
    for sa, sc in zip(a["stations"], c["stations"]):
        if sa["budget"]["margin_db_mean"] is not None:
            assert sc["budget"]["margin_db_mean"] - sa["budget"]["margin_db_mean"] == pytest.approx(10.0, abs=1e-9)
    # ten times the data rate costs 10 dB
    slow, fast = _l2(data_rate_bps=1e6), _l2(data_rate_bps=1e7)
    s0, s1 = slow["stations"][0]["budget"], fast["stations"][0]["budget"]
    assert s0["margin_db_mean"] - s1["margin_db_mean"] == pytest.approx(10.0, abs=1e-9)
    assert s1["max_data_rate_bps_median"] == pytest.approx(s0["max_data_rate_bps_median"])   # a property of the link, not the request


def test_level_2_distance_changes_the_margin_by_about_one_decibel_over_a_month():
    s = _l2()["stations"][0]["budget"]
    spread = s["free_space_loss_db_max"] - s["free_space_loss_db_min"]
    assert 0.0 < spread < 1.3                                                      # perigee to apogee: 20 log10(406.7/356.4) = 1.15 dB

