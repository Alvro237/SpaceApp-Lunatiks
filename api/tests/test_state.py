"""GET /api/v1/sites/{site_id}/state: contract, errors and numerical validation (see tests/sw1_validation.py)."""
from __future__ import annotations

import copy

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.schemas.state import StateResponse
from tests import sw1_validation as v

client = TestClient(app)
URL = "/api/v1/sites/{}/state"
T = "2026-11-20T12:00:00Z"


def get(site="im-2", **params):
    return client.get(URL.format(site), params={"t": T, **params})


def test_happy_path_matches_the_contract():
    r = get()
    assert r.status_code == 200
    body = StateResponse.model_validate(r.json())
    assert body.site_id == "im-2" and body.horizon_kind == "terrain" and body.t == T
    assert body.comms_min_fraction == 0.5 and body.mast_used_m == 0.0
    assert v.state_invariants(r.json()) == []


def test_site_without_a_stored_mask_uses_the_traced_skyline():
    r = get("apollo-11", mast_m=3.0).json()
    assert r["horizon_kind"] == "terrain"
    assert r["mast_used_m"] == 3.0          # no stored masks: the requested mast is used as is
    assert -2.0 < r["sun"]["horizon_el"] < 2.0   # Mare Tranquillitatis: no 3.8 km-scale relief


@pytest.mark.parametrize("params", [{}, {"mast_m": ""}, {"mast_m": "null"}, {"mast_m": "NULL"}, {"mast_m": "none"}])
def test_missing_or_null_mast_defaults_to_zero(params):
    r = get(**params).json()
    assert r["mast_m"] == 0.0 and r["mast_used_m"] == 0.0
    assert r == get(mast_m=0).json()


def test_mast_snaps_to_the_nearest_terrain_mask():
    assert get(mast_m=3.0).json()["mast_used_m"] == 2.0
    assert get(mast_m=8.0).json()["mast_used_m"] == 10.0


def test_no_power_numbers_in_state():
    """Power is the MECH endpoint's (/api/v1/power): state must not publish a second, possibly different figure."""
    r = get().json()
    assert not {"panel", "irradiance_w_m2", "power_w_m2"} & set(r)
    assert get(panel="tracking").json() == r          # an old client's panel parameter is simply ignored


def test_unknown_site_is_404():
    assert get("atlantis").status_code == 404


@pytest.mark.parametrize("params", [{"t": "not-a-date"}, {"mast_m": -1}, {"mast_m": 21}, {"mast_m": "abc"},
                                    {"comms_min_fraction": 1.5}])
def test_invalid_input_is_422(params):
    assert get(**params).status_code == 422


def test_missing_t_is_422():
    assert client.get(URL.format("im-2")).status_code == 422


def test_date_outside_the_tables_is_400():
    r = get(t="2040-01-01T00:00:00Z")
    assert r.status_code == 400 and "outside the ephemeris tables" in r.json()["detail"]


def test_offset_times_are_converted_to_utc():
    assert get(t="2026-11-20T13:00:00+01:00").json() == get().json()


def test_matches_jpl_horizons_through_http():
    rows = v.horizons_comparisons(client)
    assert len(rows) >= 30, "the fixture case for IM-1 did not run"
    worst = max(r["error_deg"] for r in rows)
    assert worst < v.HORIZONS_TOL_DEG, f"worst {worst:.6f} deg"


def test_invariants_on_every_site_and_date():
    assert v.sweep_invariants(client) == []


@pytest.mark.parametrize("site,body", [("im-2", "sun"), ("im-2", "earth"), ("apollo-11", "sun")])
def test_next_transition_flips_the_state(site, body):
    assert get(site).json()[f"next_{body}_transition"] is not None
    assert v.transition_flips(client, URL.format(site), T, body) == []


def test_earth_never_sets_near_the_sub_earth_point():
    """Apollo 11 (0.67 N, 23.5 E, near side): libration moves the Earth by ~8 deg around ~66 deg elevation,
    so it never sets and the transition is null rather than invented."""
    r = get("apollo-11").json()
    assert r["earth"]["visible"] and r["earth"]["el"] > 50
    assert r["next_earth_transition"] is None


def test_the_validator_catches_wrong_numbers():
    """Guard against a validator that always passes."""
    good = get().json()
    for path, value in ((("power_w_m2",), 999.0), (("sun", "angular_radius_deg"), 0.5), (("eclipse",), "total"),
                        (("sun", "visible_fraction"), 1.5), (("sun_eclipsed_fraction",), 0.3),
                        (("earth", "visible"), False)):
        bad = copy.deepcopy(good)
        target = bad
        for key in path[:-1]:
            target = target[key]
        target[path[-1]] = value
        assert v.state_invariants(bad), f"tampered {path} not detected"
