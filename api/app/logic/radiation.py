"""Radiation dose on the lunar surface from LRO CRaTER measurements (MECH).

Dose comes from particles, galactic cosmic rays (GCR) and solar particle events (SPE), not from sunlight.

GCR on the surface, per day:
    D_surface = D_free_space x (Omega_sky / 4 pi)
    D_free_space  CRaTER dosimeter dose rate corrected for the Moon's shielding at the spacecraft (mGy Si / day)
    Omega_sky     solid angle of open sky at the point (sr): the Moon blocks half the sky on flat ground
                  (2 pi sr), terrain blocks more (PGDA product 69 sky-visibility grid, south of 65 S)
GCR is close to isotropic, which is what makes the solid-angle scaling valid. Not modelled: secondary
particles (albedo neutrons and protons) coming up from the regolith, which add to the surface dose;
shielding by a habitat or a suit; the anisotropy of SPEs.

Mission dose = daily rate x duration / 24 h. Optional conversions, only when the caller gives them:
    absorbed dose in tissue = D_Si x si_to_tissue;   effective dose (mSv) = D_tissue (mGy) x quality_factor.
Future windows: CRaTER covers 2009-06 to 2013-04, so a mission date gets the record's climatology
(mean and percentiles), never a measured value for that date.

Pure functions over NumPy arrays: no files, no network, no FastAPI.
"""
from __future__ import annotations

import math

import numpy as np

FREE_SPACE_SR = 4.0 * math.pi
FLAT_GROUND_SR = 2.0 * math.pi
CAREER_LIMIT_MSV = 600.0   # NASA-STD-3001: career effective dose limit, all ages and sexes
SI_TO_WATER = 1.333        # CRaTER team's silicon-to-water dose conversion (NASA ISWA CRaTER data page)


def risk_index(effective_msv: float, limit_msv: float = CAREER_LIMIT_MSV) -> float:
    """Astronaut radiation risk on a 1-10 scale from the share of the career limit one mission uses.

    Logarithmic, because mission doses span orders of magnitude: 0.1 % of the limit -> 1, 1 % -> 4,
    10 % -> 7, 100 % or more -> 10 (index = 1 + 3 log10(share / 0.001), clipped to 1..10). The scale is a
    presentation choice of the team, not a medical standard; the share itself is the physical number.
    """
    share = max(effective_msv / limit_msv, 1e-12)
    return float(min(10.0, max(1.0, 1.0 + 3.0 * math.log10(share / 0.001))))


def storm_surface_mgy_si(orbit_mgy_si: float, orbit_to_free_space: float, shielding: float) -> float:
    """A solar-particle-event day measured in orbit, brought to the surface point with the same solid-angle
    scaling as GCR (free space = orbit x orbit_to_free_space, then x shielding). Treats the storm as isotropic,
    which real SPEs are not: an order-of-magnitude figure."""
    return orbit_mgy_si * orbit_to_free_space * shielding


def sky_solid_angle(sky_sr: float | None, horizon_kind: str) -> tuple[float | None, str]:
    """Open-sky solid angle at the point and where it came from.

    The PGDA grid when it covers the point; on a smooth-sphere horizon the geometric value 2 pi sr; otherwise
    (a terrain site outside the grid) unknown.
    """
    if sky_sr is not None:
        return float(sky_sr), "dataset"
    if horizon_kind == "smooth_sphere":
        return FLAT_GROUND_SR, "computed"
    return None, "unavailable"


def shielding_factor(omega_sr: float) -> float:
    """Fraction of the free-space isotropic dose that reaches the point: Omega / 4 pi."""
    return omega_sr / FREE_SPACE_SR


def climatology(values: np.ndarray) -> dict:
    """Mean, 5th / 50th / 95th percentiles and maximum of the finite values."""
    v = np.asarray(values, dtype=np.float64)
    v = v[np.isfinite(v)]
    p5, p50, p95 = np.percentile(v, [5, 50, 95])
    return {"mean": float(v.mean()), "p05": float(p5), "p50": float(p50), "p95": float(p95), "max": float(v.max()),
            "days": int(v.size)}


def mission_dose(rate_per_day: float, duration_h: float) -> float:
    return rate_per_day * duration_h / 24.0


def effective_dose_msv(dose_mgy_si: float, si_to_tissue: float | None, quality_factor: float | None) -> float | None:
    """Effective dose (mSv) when both conversion factors are given; None otherwise."""
    if si_to_tissue is None or quality_factor is None:
        return None
    return dose_mgy_si * si_to_tissue * quality_factor
