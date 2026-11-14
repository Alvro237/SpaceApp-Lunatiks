"""The engine must reproduce JPL Horizons (airless apparent azimuth/elevation from a lunar surface
site) within 0.01 degrees. The fixture was fetched from the Horizons API by the pipeline."""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

import numpy as np

from app.db.store import get_store
from app.logic.geometry import body_direction, site_frame

FIXTURE = Path(__file__).parent / "fixtures" / "horizons_reference.json"
TOLERANCE_DEG = 0.01


def _ms(utc: str) -> float:
    return datetime.fromisoformat(utc.replace("Z", "+00:00")).timestamp() * 1000.0


def _sky_error_deg(az1, el1, az2, el2) -> float:
    """Angular distance on the sky between two (az, el) directions."""
    a1, e1, a2, e2 = map(np.radians, (az1, el1, az2, el2))
    cosd = np.sin(e1) * np.sin(e2) + np.cos(e1) * np.cos(e2) * np.cos(a1 - a2)
    return float(np.degrees(np.arccos(np.clip(cosd, -1.0, 1.0))))


def test_sun_and_earth_match_horizons():
    eph = get_store().ephemeris
    cases = json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]
    worst, checked = 0.0, 0
    for case in cases:
        frame = site_frame(case["lat"], case["lon"], case["alt_km"])
        for sample in case["samples"]:
            t = _ms(sample["utc"])
            if not eph.covers(t):
                continue
            v = eph.positions(t)
            for body, cols in (("sun", slice(0, 3)), ("earth", slice(3, 6))):
                d = body_direction(v[:, cols], frame)
                worst = max(worst, _sky_error_deg(d.az[0], d.el[0], sample[body]["az"], sample[body]["el"]))
                checked += 1
    assert checked >= 100, f"only {checked} comparisons ran: the fixture or the tables are incomplete"
    assert worst < TOLERANCE_DEG, f"worst error {worst:.6f} deg"
