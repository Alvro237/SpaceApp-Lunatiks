"""Unit tests of the pure logic: analytic cases with known answers."""
from __future__ import annotations

import numpy as np
import pytest

from app.logic.engine import longest_run, time_grid, visibility_ranges
from app.logic.horizon import HorizonProfile, flat_profile, spherical_horizon_deg
from app.logic.projection import great_circle_km, south_polar_latlon, south_polar_xy
from app.logic.scoring import weighted_score
from app.logic.visibility import disc_visible_fraction, flat_fraction


def test_flat_fraction_known_values():
    assert flat_fraction(0.0, 0.27) == pytest.approx(0.5)          # centre on the horizon: half the disc
    assert flat_fraction(0.27, 0.27) == pytest.approx(1.0)
    assert flat_fraction(-0.27, 0.27) == pytest.approx(0.0)
    assert flat_fraction(5.0, 0.27) == pytest.approx(1.0)
    assert 0.5 < float(flat_fraction(0.1, 0.27)) < 1.0


def test_disc_fraction_terrain_agrees_with_flat_when_skyline_is_level():
    level = HorizonProfile(np.full(720, 2.0) + np.linspace(0, 1e-6, 720))   # not flagged as flat
    for el in (1.8, 2.0, 2.1, 2.25):
        sliced = float(disc_visible_fraction(el, 45.0, 0.27, level))
        assert sliced == pytest.approx(float(flat_fraction(el - 2.0, 0.27)), abs=0.02)


def test_disc_fraction_hidden_behind_a_ridge():
    values = np.zeros(720)
    values[80:100] = 10.0                     # a ridge between azimuth 40 and 50 degrees
    ridge = HorizonProfile(values)
    assert float(disc_visible_fraction(5.0, 45.0, 0.27, ridge)) == 0.0
    assert float(disc_visible_fraction(5.0, 120.0, 0.27, ridge)) == 1.0


def test_spherical_horizon_dips_with_height():
    assert spherical_horizon_deg(0.0) == 0.0
    assert spherical_horizon_deg(2.0) == pytest.approx(-0.0869, abs=1e-3)   # 2 m mast: about -0.09 deg
    assert flat_profile(-0.1).is_flat


def test_runs_and_ranges():
    flags = np.array([1, 1, 0, 0, 0, 1, 0, 1, 1, 1], dtype=bool)
    assert longest_run(flags, True) == 3
    assert longest_run(flags, False) == 3
    t = time_grid(0.0, 9.0, 60.0)
    assert t.size == 10
    assert visibility_ranges(t, flags) == [(0.0, 3_600_000.0), (18_000_000.0, 18_000_000.0),
                                           (25_200_000.0, 32_400_000.0)]


def test_polar_projection_round_trip():
    lat, lon = np.array([-89.5, -80.13, -69.37]), np.array([0.0, 1.44, 32.32])
    x, y = south_polar_xy(lat, lon)
    lat2, lon2 = south_polar_latlon(x, y)
    assert np.allclose(lat, lat2) and np.allclose(lon, lon2)
    assert float(south_polar_xy(-90.0, 0.0)[0]) == pytest.approx(0.0, abs=1e-6)
    # one degree of latitude on the reference sphere is 30.32 km
    assert float(great_circle_km(-80.0, 10.0, -81.0, 10.0)) == pytest.approx(30.32, abs=0.01)


def test_weighted_score_is_a_weighted_mean():
    parts = {"sunlight": 1.0, "comms": 0.0}
    assert weighted_score(parts, {"sunlight": 1.0, "comms": 1.0}) == pytest.approx(50.0)
    assert weighted_score(parts, {"sunlight": 3.0, "comms": 1.0}) == pytest.approx(75.0)
    assert weighted_score(parts, {"sunlight": 0.0, "comms": 0.0}) == 0.0
