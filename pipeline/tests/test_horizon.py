"""Horizon algorithm against analytic solutions (synthetic terrain, no network)."""
from __future__ import annotations

import numpy as np
import pytest

from lunarnav import horizon as hz


def flat(lat, lon):
    return np.zeros_like(lat)


def test_flat_sphere_gives_geometric_dip():
    """Over a smooth sphere the horizon sits at -acos(R / (R + mast)) in every direction."""
    for mast in (2.0, 10.0):
        dist, h = hz.sample_rays(flat, -85.0, 20.0)
        prof = hz.horizon_from_heights(dist, h, 0.0, mast)
        expected = hz.spherical_horizon_deg(mast)
        assert np.allclose(prof, expected, atol=0.004), (mast, prof.min(), prof.max(), expected)
        assert np.ptp(prof) < 0.004  # isotropic


def test_dip_matches_closed_form_for_known_mast():
    # sqrt(2 m / R) in degrees for a 2 m mast: ~0.0485 deg
    assert hz.spherical_horizon_deg(2.0) == pytest.approx(-np.degrees(np.sqrt(2 * 2.0 / hz.R_M)), rel=1e-3)


def test_ridge_elevation_matches_analytic_angle():
    """A 500 m ridge 10 km to the north, seen from a 2 m mast, appears at atan((500-2)/10000)
    plus the curvature drop. Only the northern azimuths see it."""
    lat0, lon0 = -85.0, 0.0
    ridge_dist = 10_000.0
    ridge_lat = lat0 + np.degrees(ridge_dist / hz.R_M)  # due north on the same meridian

    def terrain(lat, lon):
        out = np.zeros_like(lat)
        out[(np.abs(np.degrees(lat) - ridge_lat) < 0.002) & (np.abs(np.degrees(lon)) < 1.0)] = 500.0
        return out

    dist, h = hz.sample_rays(terrain, lat0, lon0, dist_m=np.arange(10.0, 20_000.0, 10.0))
    prof = hz.horizon_from_heights(dist, h, 0.0, 2.0)
    theta = ridge_dist / hz.R_M
    r_s, r_o = hz.R_M + 500.0, hz.R_M + 2.0
    expected = np.degrees(np.arctan2(r_s * np.cos(theta) - r_o, r_s * np.sin(theta)))
    north = prof[0]
    assert north == pytest.approx(expected, abs=0.08)  # sampling step 10 m over a 0.002 deg band
    assert expected > 2.5                                # sanity: ~2.85 deg
    # south-facing directions see no ridge: they stay at the geometric dip
    assert prof[360] == pytest.approx(hz.spherical_horizon_deg(2.0), abs=0.01)


def test_higher_observer_sees_further_below():
    dist, h = hz.sample_rays(flat, 0.0, 0.0)
    low = hz.horizon_from_heights(dist, h, 0.0, 2.0)
    high = hz.horizon_from_heights(dist, h, 0.0, 10.0)
    assert (high < low).all()


def test_nan_samples_are_ignored_and_all_nan_is_nan():
    dist = np.array([100.0, 200.0, 300.0])
    heights = np.array([[np.nan, 0.0, np.nan], [np.nan, np.nan, np.nan]])
    out = hz.horizon_from_heights(dist, heights, 0.0, 2.0)
    assert np.isfinite(out[0])
    assert np.isnan(out[1])


def test_slope_of_a_plane():
    # a 10 degree plane rising to the north
    slope = np.tan(np.radians(10.0))
    lat0 = np.radians(-85.0)

    def plane(lat, lon):
        return (lat - lat0) * hz.R_M * slope

    assert hz.slope_deg(plane, -85.0, 0.0, 100.0) == pytest.approx(10.0, abs=0.05)


def test_encoding_roundtrip_resolution():
    prof = np.array([-0.0485, 1.234, 5.678, -2.0])
    dec = hz.encode_centideg(prof) / 100.0
    assert np.allclose(dec, prof, atol=0.005)
