"""Ground stations: the Moon's azimuth/elevation from an antenna, elevation limits, and the dataset itself."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pytest

from app import services
from app.db.store import get_store
from app.logic.ephemeris import OutOfCoverage
from app.logic.stations import (MoonEcefTable, geodetic_to_ecef_km, limit_at, moon_az_el, sees_moon,
                                WGS84_A_KM)

FIXTURE = Path(__file__).parent / "fixtures" / "station_reference.json"
MOON_KM = 384_400.0


# ------------------------------------------------------------------------------ hand-worked cases

def test_ecef_of_known_points():
    assert geodetic_to_ecef_km(0, 0, 0) == pytest.approx([WGS84_A_KM, 0, 0])
    assert geodetic_to_ecef_km(0, 90, 1000) == pytest.approx([0, WGS84_A_KM + 1.0, 0], abs=1e-9)
    pole = geodetic_to_ecef_km(90, 0, 0)                          # semi-minor axis b = a (1 - f)
    assert pole == pytest.approx([0, 0, 6356.752314245], abs=1e-6)


def test_moon_at_the_zenith():
    az, el = moon_az_el(np.array([[MOON_KM, 0.0, 0.0]]), 0.0, 0.0)
    assert el[0] == pytest.approx(90.0, abs=1e-9)


def test_moon_on_the_horizon_plane_is_slightly_below_it():
    """Station on the equator at longitude 0, Moon along +Y (due east, 90 deg away in longitude). The antenna is
    6378.137 km from the geocentre, so the Moon lies below its horizontal: parallax of asin(R / |d|) = 0.9505 deg."""
    az, el = moon_az_el(np.array([[0.0, MOON_KM, 0.0]]), 0.0, 0.0)
    expected = -np.degrees(np.arcsin(WGS84_A_KM / np.hypot(WGS84_A_KM, MOON_KM)))
    assert el[0] == pytest.approx(expected, abs=1e-9) and el[0] == pytest.approx(-0.9505, abs=1e-3)
    assert az[0] == pytest.approx(90.0, abs=1e-9)                 # due east


def test_azimuth_is_clockwise_from_north():
    # equator, longitude 0: north is +Z, east is +Y. Moon towards +Z and +Y equally -> azimuth 45
    az, _ = moon_az_el(np.array([[MOON_KM, MOON_KM, MOON_KM]]), 0.0, 0.0)
    assert az[0] == pytest.approx(45.0, abs=1e-6)
    az, _ = moon_az_el(np.array([[MOON_KM, 0.0, -MOON_KM]]), 0.0, 0.0)      # south
    assert az[0] == pytest.approx(180.0, abs=1e-6)


def test_elevation_limit_constant_and_mask_with_wraparound():
    assert limit_at([0, 123.4], 6.0) == pytest.approx([6.0, 6.0])
    mask = np.array([10.0, 20.0, 30.0, 40.0])                     # 90 deg steps: 0, 90, 180, 270
    assert limit_at([0, 45, 90, 225], mask, 90.0) == pytest.approx([10, 15, 20, 35])
    assert limit_at([315, 359.999], mask, 90.0) == pytest.approx([25.0, 10.0], abs=1e-2)   # wraps 270 -> 360 = 0
    assert np.isnan(limit_at([10], None)[0])
    with pytest.raises(ValueError):
        limit_at([10], mask)                                       # a mask needs its azimuth step


def test_sees_moon_compares_with_the_limit():
    mask = np.array([5.0, 5.0, 12.0, 5.0])
    assert sees_moon([0, 180], [6.0, 11.0], mask, 90.0).tolist() == [True, False]
    assert sees_moon([0], [10.0], None).tolist() == [False]       # an undefined limit never counts as visible


def test_interpolating_a_rotating_vector():
    """A vector turning 15 deg/h (the Earth's rotation) sampled hourly: cubic interpolation half-way between samples
    stays within 0.01 deg of the exact direction."""
    n = 40
    ang = np.radians(15.0 * np.arange(n))
    data = (MOON_KM * np.stack([np.cos(ang), np.sin(ang), 0.1 * np.ones(n)], axis=1)).astype(np.float32)
    table = MoonEcefTable(start_ms=0, step_s=3600, data=data)
    t = np.array([10.5, 17.25, 30.9]) * 3_600_000.0
    got = table.positions(t)
    exact_ang = np.radians(15.0 * np.array([10.5, 17.25, 30.9]))
    exact = MOON_KM * np.stack([np.cos(exact_ang), np.sin(exact_ang), 0.1 * np.ones(3)], axis=1)
    cos = np.einsum("ij,ij->i", got, exact) / (np.linalg.norm(got, axis=1) * np.linalg.norm(exact, axis=1))
    assert np.degrees(np.arccos(np.clip(cos, -1, 1))).max() < 0.01
    with pytest.raises(OutOfCoverage):
        table.positions([-1.0])


# ------------------------------------------------------------------------------ the dataset

def test_catalogue_content():
    repo = get_store().stations
    assert repo is not None and len(repo.all()) == 18
    assert set(repo.networks()) == {"dsn", "estrack", "jaxa"}
    assert len(repo.in_networks(["dsn"])) == 12 and len(repo.in_networks(["estrack"])) == 3
    assert len(repo.in_networks(["dsn", "jaxa"])) == 15
    with pytest.raises(KeyError):
        repo.in_networks(["nasa"])
    # well-known locations: Goldstone, Madrid and Canberra complexes
    for sid, lat, lon in (("dss-14", 35.43, -116.89), ("dss-63", 40.43, -4.25), ("dss-43", -35.40, 148.98)):
        s = repo.get(sid)
        assert s.lat_deg == pytest.approx(lat, abs=0.02) and s.lon_deg == pytest.approx(lon, abs=0.02)


def test_elevation_limits_and_their_sources():
    repo = get_store().stations
    dss63 = repo.get("dss-63")
    rcv, step = dss63.limit("receive")
    assert step == 1.0 and rcv.size == 360 and rcv.min() == pytest.approx(6.0)       # 70 m: 6.0 deg minimum
    low, _ = dss63.limit("transmit_low")
    high, _ = dss63.limit("transmit_high")
    assert low.min() == pytest.approx(10.1) and high.min() == pytest.approx(13.6)
    assert repo.get("dss-43").limit("transmit_high")[0].min() == pytest.approx(17.5)  # DSS-43 80 kW X-band
    assert not dss63.limits_are_estimated
    esa = repo.get("esa-dsa2-cebreros")
    assert esa.limit("receive") == (6.0, None) and esa.limits_are_estimated               # owner estimate, flagged
    assert esa.limit("transmit_low") == (None, None)
    jaxa, jstep = repo.get("jaxa-misasa-54m").limit("receive")
    assert jstep == 1.0 and jaxa.size == 360 and jaxa[0] == pytest.approx(10.06)         # published skyline, north


def test_moon_table_matches_the_sun_earth_tables_grid_and_is_at_lunar_distance():
    store = get_store()
    seg = store.ephemeris.segments[0]
    moon = store.stations.moon
    assert (moon.start_ms, moon.step_s, moon.count) == (seg.start_ms, seg.step_s, seg.count)
    dist = np.linalg.norm(moon.data, axis=1)
    assert 350_000 < dist.min() and dist.max() < 410_000          # perigee and apogee, km


def test_against_spice_at_off_grid_instants():
    """Interpolation + ECEF conversion + local basis reproduce SPICE's own topocentric DSS frames within 0.01 deg
    (measured 2026-11-14: worst 0.0024 deg in elevation and 0.0023 deg in azimuth over the 24 cases)."""
    ref = json.loads(FIXTURE.read_text(encoding="utf-8"))
    moon = get_store().stations.moon
    worst = 0.0
    for case in ref["cases"]:
        st = ref["stations"][case["station"]]
        t_ms = services.to_ms(datetime.fromisoformat(case["utc"].replace("Z", "+00:00")))
        az, el = moon_az_el(moon.positions(t_ms), st["lat_deg"], st["lon_deg"], st["height_m"])
        d_el = abs(el[0] - case["el_deg"])
        d_az = abs((az[0] - case["az_deg"] + 180.0) % 360.0 - 180.0) * np.cos(np.radians(case["el_deg"]))
        worst = max(worst, d_el, d_az)
    assert len(ref["cases"]) == 24 and worst < 0.01, f"worst difference {worst:.4f} deg"


def test_the_three_dsn_complexes_cover_the_whole_day():
    """Sanity of the whole chain: over one day the Moon is above the DSN receive limit at one of Goldstone, Canberra
    or Madrid for most of the time (the network was built for continuous coverage; geometry only, no scheduling)."""
    store = get_store()
    t = services.to_ms(datetime(2027, 3, 1, tzinfo=timezone.utc)) + np.arange(0, 24 * 60, 10) * 60_000.0
    vec = store.stations.moon.positions(t)
    seen = np.zeros(t.size, dtype=bool)
    for sid in ("dss-14", "dss-43", "dss-63"):
        s = store.stations.get(sid)
        az, el = moon_az_el(vec, s.lat_deg, s.lon_deg, s.height_m)
        limit, step = s.limit("receive")
        seen |= sees_moon(az, el, limit, step)
    assert seen.mean() > 0.9
