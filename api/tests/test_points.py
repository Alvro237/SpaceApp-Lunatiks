"""GET /api/v1/points/state: contract, coordinates, errors and validation (see tests/sw1_validation.py)."""
from __future__ import annotations

import copy
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.schemas.state import StateResponse
from tests import sw1_validation as v

client = TestClient(app)
URL = "/api/v1/points/state"
T = "2026-11-20T12:00:00Z"
IM2 = {"lat": -84.7906, "lon": 29.1957}       # the team spec's IM-2 demo point


def get(**params):
    return client.get(URL, params={"t": T, **IM2, **params})


def test_happy_path_matches_the_contract():
    r = get(mast_m=2)
    assert r.status_code == 200
    body = StateResponse.model_validate(r.json())
    assert body.site_id is None and body.horizon_kind == "smooth_sphere" and body.mast_used_m == 2.0
    assert body.ground_source == "lola_grid" and body.lat == IM2["lat"] and body.lon == IM2["lon"]
    assert v.state_invariants(r.json()) == []


def test_matches_jpl_horizons_at_every_fixture_place():
    rows = v.points_horizons_comparisons(client)
    assert len(rows) == 352 and len({r["case"] for r in rows}) == 11
    assert max(r["error_deg"] for r in rows) < v.HORIZONS_TOL_DEG


@pytest.mark.parametrize("lat,lon", v.POINT_SWEEP)
def test_invariants_from_pole_to_pole(lat, lon):
    r = client.get(URL, params={"lat": lat, "lon": lon, "t": T}).json()
    assert v.state_invariants(r) == [] and r["horizon_kind"] == "smooth_sphere"


@pytest.mark.parametrize("site", ["apollo-11", "apollo-17", "slim", "blue-ghost-1"])
def test_equals_the_site_endpoint_at_smooth_sphere_sites(site):
    assert v.point_equals_site(client, site, T) == []


def test_ground_comes_from_the_grid_or_says_it_is_assumed():
    assert v.point_ground_checks(client) == []


def test_site_endpoints_report_their_ground_source():
    assert client.get("/api/v1/sites/im-2/state", params={"t": T}).json()["ground_source"] == "lola_site"
    # no pipeline mask at Apollo 11: modelled with the elevation grid's height and traced skyline
    assert client.get("/api/v1/sites/apollo-11/state", params={"t": T}).json()["ground_source"] == "lola_grid"
    series = client.get("/api/v1/sites/im-2/series", params={"start": T, "duration_h": 1}).json()
    assert series["ground_source"] == "lola_site"


def test_longitude_0_360_is_normalised():
    assert v.lon_normalisation(client) == []
    assert get(lon=330).json()["lon"] == -30.0


@pytest.mark.parametrize("site", ["im-2", "mons-malapert", "shackleton"])
def test_the_lower_skyline_always_sees_more(site):
    """Replaces "terrain can only shorten light": on peaks the real skyline is below the smooth one."""
    times = [(datetime(2027, 1, 1, tzinfo=timezone.utc) + timedelta(hours=h)).strftime("%Y-%m-%dT%H:%M:%SZ")
             for h in range(0, 24 * 365, 211)]
    bad, counts = v.lower_skyline_sees_more(client, site, times)
    assert bad == []
    assert counts["terrain_lower"] + counts["terrain_higher"] > 0.9 * 2 * len(times)   # the check really ran


def test_terrain_gives_more_earth_than_the_smooth_sphere_on_mons_mouton():
    """IM-2 sits on a 5.3 km massif: its skyline dips to -1.46 deg, below the smooth -0.087 deg at 2 m. At this
    instant the terrain site sees all of the Earth while the point (smooth sphere) sees only part of it."""
    t = "2026-12-03T18:00:00Z"
    site = client.get("/api/v1/sites/im-2/state", params={"t": t, "mast_m": 2}).json()["earth"]
    point = client.get(URL, params={"t": t, "lat": -84.78, "lon": 29.13, "mast_m": 2}).json()["earth"]
    assert site["horizon_el"] < point["horizon_el"] and site["visible_fraction"] > point["visible_fraction"]


@pytest.mark.parametrize("lat,lon", [(-89.5, 129.78), (-70.0, 100.0)])
@pytest.mark.parametrize("body", ["sun", "earth"])
def test_transitions_flip_the_state(lat, lon, body):
    assert v.transition_flips(client, URL, T, body, {"lat": lat, "lon": lon}) == []


def test_null_mast_is_zero():
    assert get(mast_m="null").json() == get(mast_m=0).json()


@pytest.mark.parametrize("params", [{"lat": None}, {"lon": None}, {"lat": -90}, {"lat": 90}, {"lat": -91},
                                    {"lon": -181}, {"lon": 361}, {"lat": "south"}, {"mast_m": 30},
                                    {"comms_min_fraction": 2}, {"t": "yesterday"}])
def test_invalid_input_is_422(params):
    query = {"t": T, **IM2, **params}
    assert client.get(URL, params={k: x for k, x in query.items() if x is not None}).status_code == 422


def test_date_outside_the_tables_is_400():
    assert get(t="2040-01-01T00:00:00Z").status_code == 400


def test_the_lower_skyline_validator_catches_a_wrong_fraction(monkeypatch):
    """Guard against a validator that always passes: make the site endpoint report a fuller Sun on a crater floor."""
    real_get = client.get

    def fake_get(url, params=None):
        r = real_get(url, params=params)
        if url.startswith("/api/v1/sites/shackleton/state"):
            body = copy.deepcopy(r.json())
            body["sun"]["visible_fraction"] = 1.0

            class Fake:
                def json(self):
                    return body
            return Fake()
        return r

    monkeypatch.setattr(client, "get", fake_get)
    bad, _ = v.lower_skyline_sees_more(client, "shackleton", ["2027-03-01T00:00:00Z", "2027-06-01T00:00:00Z"])
    assert bad, "a terrain fraction above the smooth sphere's under a higher skyline was not detected"


# ---------------------------------------------------------------------------- points/series

SERIES_URL = "/api/v1/points/series"


def get_series(**params):
    return client.get(SERIES_URL, params={"start": T, "duration_h": 336, **IM2, **params})


def test_series_happy_path_matches_the_contract():
    from app.schemas.points import PointSeriesResponse
    r = get_series()
    assert r.status_code == 200
    body = PointSeriesResponse.model_validate(r.json())
    assert body.site_id is None and body.horizon_kind == "smooth_sphere" and body.samples == 2017
    assert body.ground_source == "lola_grid" and body.terrain_reference is not None


@pytest.mark.parametrize("lat,lon,start,hours,step", v.POINT_SERIES_CASES)
def test_series_is_consistent_and_equals_points_state(lat, lon, start, hours, step):
    q = {"lat": lat, "lon": lon}
    r = client.get(SERIES_URL, params={"start": start, "duration_h": hours, "step_min": step, **q}).json()
    assert v.series_invariants(r) == []
    assert v.series_matches_state(client, None, r, every=211, state_path=URL, extra=q) == []


@pytest.mark.parametrize("site", ["apollo-11", "slim"])
def test_series_equals_the_site_series_at_smooth_sphere_sites(site):
    assert v.point_series_equals_site(client, site, T, 72) == []


def test_series_matches_jpl_horizons_at_every_fixture_place():
    rows = v.points_series_horizons_comparisons(client)
    assert len(rows) == 352 and max(r["error_deg"] for r in rows) < v.HORIZONS_TOL_DEG


def test_series_first_sunset_is_points_state_next_sunset():
    s = get_series(mast_m=2).json()
    st = get(mast_m=2).json()
    assert s["sunlit_ranges"][0]["end"] == st["next_sun_transition"]["at"]
    assert s["comms_ranges"][0]["end"] == st["next_earth_transition"]["at"]


def test_series_longitude_0_360_is_normalised():
    a = client.get(SERIES_URL, params={"lat": -85, "lon": 330, "start": T, "duration_h": 24}).json()
    b = client.get(SERIES_URL, params={"lat": -85, "lon": -30, "start": T, "duration_h": 24}).json()
    assert a == b and a["lon"] == -30.0


@pytest.mark.parametrize("params", [{"lat": None}, {"lon": 400}, {"start": None}, {"duration_h": None},
                                    {"duration_h": 0}, {"step_min": 0.1}, {"duration_h": 24 * 365}])
def test_series_invalid_input_is_422(params):
    query = {"start": T, "duration_h": 24, **IM2, **params}
    assert client.get(SERIES_URL, params={k: x for k, x in query.items() if x is not None}).status_code == 422


def test_series_window_outside_the_tables_is_400():
    assert get_series(start="2035-12-31T00:00:00Z", duration_h=48).status_code == 400


# ---------------------------------------------------------------------------- terrain reference

def test_terrain_reference_points_the_same_way_as_our_terrain_masks():
    bad, judged = v.terrain_reference_checks(client)
    assert bad == [] and judged >= 20


def test_terrain_reference_on_mons_mouton_and_shackleton():
    """IM-2's summit: the smooth sphere overstates the Sun a little and understates the Earth. Shackleton's floor:
    PGDA says permanent shadow, the smooth sphere would give about half the time lit."""
    im2 = get(mast_m=2).json()["terrain_reference"]
    assert im2["sun_mean_visible_fraction"]["difference"] < 0 < im2["earth_any_visible_fraction"]["difference"]
    sh = client.get(URL, params={"t": T, "lat": -89.67, "lon": 129.78, "mast_m": 2}).json()["terrain_reference"]
    assert sh["sun_mean_visible_fraction"]["pgda"] == 0.0 and sh["sun_mean_visible_fraction"]["difference"] < -0.4


def test_terrain_reference_is_null_where_pgda_has_no_map():
    assert get(lat=-60.0, lon=0.0).json()["terrain_reference"] is None
    assert get(lat=10.0, lon=0.0).json()["terrain_reference"] is None


def test_the_terrain_reference_validator_catches_a_flipped_sign(monkeypatch):
    real_get = client.get

    def fake_get(url, params=None):
        r = real_get(url, params=params)
        if url in (URL, SERIES_URL) and r.status_code == 200 and r.json().get("terrain_reference"):
            body = copy.deepcopy(r.json())
            for k in ("sun_mean_visible_fraction", "earth_any_visible_fraction"):
                x = body["terrain_reference"][k]
                x["pgda"], x["difference"] = x["smooth_sphere"] - x["difference"], -x["difference"]

            class Fake:
                status_code = 200

                def json(self):
                    return body
            return Fake()
        return r

    monkeypatch.setattr(client, "get", fake_get)
    bad, _ = v.terrain_reference_checks(client)
    assert any("PGDA says" in m for m in bad), "a flipped terrain reference was not detected"
