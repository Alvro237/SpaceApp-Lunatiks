"""Independent historical check: NASA's Apollo Lunar Surface Journal Sun/Earth tables.

The tables (Scotti, from Nautical Almanac lunar ephemeris data, 1970s) give altitude/azimuth at
each landing, EVA and liftoff. Two findings, both asserted here:

1. Sun elevation/azimuth agree with our DE440 numbers to < 0.1 deg.
2. The tables put the Earth at infinity, i.e. they ignore the Moon's-radius parallax (up to
   0.26 deg, since R_moon / d_earth = 0.0045 rad). Without parallax we match them to < 0.1 deg;
   with parallax (what Horizons and this project do) the offset has the predicted sign and size.

One azimuth entry (Apollo 12 EVA1 end) is out of sequence within its own table (90.53 between
91.03 and 90.60) and disagrees by 0.41 deg; it is a typo in the source and is excluded by name.
"""
from __future__ import annotations

import json
from datetime import datetime

import numpy as np
import pytest
import spiceypy as spice

from lunarnav.config import FIXTURE_DIR
from lunarnav.spice_setup import az_el_deg, load_kernels, local_basis

FIXTURE = FIXTURE_DIR / "alsj_apollo_reference.json"
KNOWN_TYPO = (12, "EVA1 end")  # sun azimuth only


@pytest.fixture(scope="module", autouse=True)
def kernels():
    load_kernels()


def _events():
    data = json.loads(FIXTURE.read_text())
    for m in data["missions"]:
        for e in m["events"]:
            yield m, e


def _spice_vec(body: str, utc_iso: str) -> np.ndarray:
    t = datetime.fromisoformat(utc_iso.replace("Z", "+00:00"))
    et = spice.str2et(t.strftime("%Y-%m-%d %H:%M:%S") + " UTC")
    pos, _ = spice.spkpos(body, et, "MOON_ME", "LT+S", "MOON")
    return pos


def test_fixture_is_complete():
    events = list(_events())
    assert len(events) >= 40
    assert {m["apollo"] for m, _ in events} == {11, 12, 14, 15, 16, 17}


def test_sun_matches_alsj():
    worst_el = worst_az = 0.0
    for m, e in _events():
        az, el = az_el_deg(_spice_vec("SUN", e["utc"]), m["lat"], m["lon"])
        worst_el = max(worst_el, abs(el - e["sun"]["alt"]))
        if (m["apollo"], e["label"]) != KNOWN_TYPO:
            d_az = abs((az - e["sun"]["az"] + 180) % 360 - 180)
            worst_az = max(worst_az, d_az)
    assert worst_el < 0.1, worst_el
    assert worst_az < 0.1, worst_az


def test_earth_matches_alsj_when_parallax_is_ignored_as_in_the_source():
    worst = 0.0
    for m, e in _events():
        d = _spice_vec("EARTH", e["utc"])
        d = d / np.linalg.norm(d)
        _, _, up = local_basis(m["lat"], m["lon"])
        el_inf = np.degrees(np.arcsin(d @ up))
        worst = max(worst, abs(el_inf - e["earth"]["alt"]))
    assert worst < 0.1, worst


def test_parallax_explains_the_difference_with_the_correct_sign_and_size():
    diffs = []
    for m, e in _events():
        _, el = az_el_deg(_spice_vec("EARTH", e["utc"]), m["lat"], m["lon"])
        diffs.append(el - e["earth"]["alt"])
    diffs = np.array(diffs)
    assert (diffs < 0).all()                      # parallax always lowers the Earth
    assert np.abs(diffs).max() < 0.27             # bounded by R_moon / d_earth in degrees
    assert np.abs(diffs).max() > 0.1              # and it is a real, measurable effect
