"""Our SPICE-based Sun/Earth azimuth/elevation against JPL Horizons (offline fixtures).

The project's validity claim: tolerance 0.01 deg (RNF-02). In practice the agreement is far
tighter; the assertion uses 0.005 deg so a regression is caught well before the budget is spent.
"""
from __future__ import annotations

import json
from datetime import datetime

import numpy as np
import pytest
import spiceypy as spice

from lunarnav.config import FIXTURE_DIR
from lunarnav.spice_setup import az_el_deg, load_kernels

TOLERANCE_DEG = 0.005
FIXTURE = FIXTURE_DIR / "horizons_reference.json"


def _angular_diff(a: float, b: float) -> float:
    return abs((a - b + 180.0) % 360.0 - 180.0)


@pytest.fixture(scope="module", autouse=True)
def kernels():
    load_kernels()


def _cases():
    data = json.loads(FIXTURE.read_text())
    return [pytest.param(case, id=case["name"]) for case in data["cases"]]


@pytest.mark.parametrize("case", _cases())
def test_matches_horizons(case):
    worst = 0.0
    for s in case["samples"]:
        t = datetime.fromisoformat(s["utc"].replace("Z", "+00:00"))
        et = spice.str2et(t.strftime("%Y-%m-%d %H:%M:%S") + " UTC")
        for body, name in (("sun", "SUN"), ("earth", "EARTH")):
            pos, _ = spice.spkpos(name, et, "MOON_ME", "LT+S", "MOON")
            az, el = az_el_deg(pos, case["lat"], case["lon"], case["alt_km"])
            ref = s[body]
            d_el = abs(el - ref["el"])
            assert d_el < TOLERANCE_DEG, f"{case['name']} {body} {s['utc']} elevation off by {d_el:.5f} deg"
            # Azimuth is ill-defined for a body at the zenith and the error scales with 1/cos(el).
            if abs(ref["el"]) < 85:
                d_az = _angular_diff(az, ref["az"]) * np.cos(np.radians(ref["el"]))
                assert d_az < TOLERANCE_DEG, f"{case['name']} {body} {s['utc']} azimuth off by {d_az:.5f} deg"
            worst = max(worst, d_el)
    assert worst < TOLERANCE_DEG
