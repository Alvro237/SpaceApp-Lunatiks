"""GET /api/v1/sites/{site_id}/horizon: contract, errors and validation (see tests/sw1_validation.py)."""
from __future__ import annotations

import copy
import math

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.schemas.horizon import HorizonResponse
from tests import sw1_validation as v

client = TestClient(app)
URL = "/api/v1/sites/{}/horizon"
TERRAIN = ["im-1", "im-2", "chandrayaan-3", "mons-malapert", "shackleton", "haworth", "faustini", "amundsen",
           "nobile", "de-gerlache", "cabeus", "shoemaker", "sverdrup"]


def get(site="im-2", **params):
    return client.get(URL.format(site), params=params)


def test_happy_path_matches_the_contract():
    r = get(mast_m=2)
    assert r.status_code == 200
    body = HorizonResponse.model_validate(r.json())
    assert body.horizon_kind == "terrain" and body.mast_used_m == 2.0 and len(body.elevation_deg) == 720
    assert body.zone is None and body.zone_available          # neighbours only on request
    assert body.max_deg == 4.01 and body.max_az_deg == 118.0  # IM-2: highest skyline to the east-south-east


@pytest.mark.parametrize("site", TERRAIN)
@pytest.mark.parametrize("mast", [0, 2, 3, 10])
def test_terrain_sites_are_bit_exact_and_consistent(site, mast):
    assert v.horizon_invariants(get(site, mast_m=mast, include_zone=True).json()) == []


@pytest.mark.parametrize("site", TERRAIN)
def test_a_higher_mast_never_sees_a_higher_skyline(site):
    assert v.horizon_mast_monotonic(client, site) == []


@pytest.mark.parametrize("mast", [0, 2, 7.5, 20])
def test_smooth_sphere_is_the_geometric_dip(mast):
    r = get("apollo-11", mast_m=mast, include_zone=True).json()
    assert r["horizon_kind"] == "smooth_sphere" and r["mast_used_m"] == mast and r["zone"] is None
    dip = -math.degrees(math.acos(1_737_400 / (1_737_400 + mast)))     # 2 m: -0.08694 deg, 20 m: -0.27494 deg
    assert r["max_deg"] == pytest.approx(dip, abs=1e-12) and v.horizon_invariants(r) == []
    if mast == 0:
        assert math.copysign(1.0, r["elevation_deg"][0]) > 0           # 0.0, not "-0.0", on the wire


def test_zone_centre_and_rings():
    z = get(mast_m=10, include_zone=True).json()["zone"]
    assert z["mast_m"] == 2.0 and len(z["points"]) == 17                # stored for 2 m only, whatever was asked
    assert sorted({p["distance_m"] for p in z["points"]}) == [0.0, 500.0, 1500.0]
    assert sorted({p["bearing_deg"] for p in z["points"][1:]}) == [i * 45.0 for i in range(8)]


@pytest.mark.parametrize("site", ["im-2", "shackleton", "apollo-11"])
def test_state_uses_this_profile(site):
    assert v.horizon_matches_state(client, site, v.SWEEP_TIMES[0], 2) == []


def test_agrees_with_nasa_pgda_long_term_maps():
    """PGDA product 69 inside the range of the zone points for Sun and Earth at every terrain site."""
    rows = v.horizon_vs_pgda(client)
    assert len(rows) == 2 * len(TERRAIN)
    assert [r for r in rows if not r["ok"]] == []


def test_open_sky_matches_nasa_pgda_sky_visibility():
    """Solid angle of open sky from the served masks against PGDA SKYV (an independent NASA computation): typical
    agreement within 0.05 sr, every site within 0.35 sr (a 960 m cell averages a summit with its slopes)."""
    rows = v.horizon_sky_vs_pgda(client)
    errs = sorted(abs(r["own_sr"] - r["pgda_sr"]) for r in rows)
    assert len(rows) == len(TERRAIN) and all(r["ok"] for r in rows)
    assert errs[len(errs) // 2] < v.SKY_MEDIAN_TOL_SR


def test_null_mast_is_zero():
    assert get(mast_m="null").json() == get(mast_m=0).json()


def test_unknown_site_is_404():
    assert get("atlantis").status_code == 404


@pytest.mark.parametrize("params", [{"mast_m": -1}, {"mast_m": 25}, {"mast_m": "abc"}, {"include_zone": "maybe"}])
def test_invalid_input_is_422(params):
    assert get(**params).status_code == 422


def test_the_horizon_validator_catches_wrong_data():
    good = get(mast_m=2, include_zone=True).json()
    assert v.horizon_invariants(good) == []
    edits = [lambda r: r["elevation_deg"].__setitem__(100, r["elevation_deg"][100] + 0.01),
             lambda r: r.__setitem__("max_az_deg", 0.0),
             lambda r: r["zone"]["points"][3].__setitem__("lat", r["zone"]["points"][3]["lat"] + 0.01),
             lambda r: r["zone"]["points"][5]["elevation_deg"].reverse(),
             lambda r: r.__setitem__("mast_used_m", 5.0)]
    for edit in edits:
        bad = copy.deepcopy(good)
        edit(bad)
        assert v.horizon_invariants(bad), "tampered horizon not detected"
