"""Build the Horizons validation fixtures shared by pytest and vitest.

Run once (needs network): ``uv run python -m lunarnav.make_fixtures``.
The output file is committed so tests are deterministic and offline.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

import numpy as np

from .config import FIXTURE_DIR
from .horizons import horizons_az_el

# Test points only (not the product catalogue): polar, mid-latitude, near side, far side, elevated.
POINTS = [
    {"name": "south pole region", "lat": -89.5, "lon": 0.0, "alt_km": 0.0},
    {"name": "Shackleton rim area", "lat": -89.54, "lon": 129.78, "alt_km": 0.0},
    {"name": "Malapert area", "lat": -86.0, "lon": 0.0, "alt_km": 0.0},
    {"name": "Mons Mouton area", "lat": -84.8, "lon": 29.2, "alt_km": 0.0},
    {"name": "IM-1 area", "lat": -80.13, "lon": 1.44, "alt_km": 0.0},
    {"name": "Chandrayaan-3 area", "lat": -69.37, "lon": 32.32, "alt_km": 0.0},
    {"name": "Apollo 11 area", "lat": 0.67, "lon": 23.47, "alt_km": 0.0},
    {"name": "Mare Crisium", "lat": 18.56, "lon": 61.81, "alt_km": 0.0},
    {"name": "far side", "lat": -45.0, "lon": 178.0, "alt_km": 0.0},
    {"name": "north pole region", "lat": 89.5, "lon": 0.0, "alt_km": 0.0},
    {"name": "elevated site (+4 km)", "lat": -85.0, "lon": 20.0, "alt_km": 4.0},
]


def sample_times(n: int = 16) -> list[datetime]:
    rng = np.random.default_rng(20261113)
    start = datetime(2026, 11, 14, tzinfo=timezone.utc).timestamp()
    end = datetime(2034, 12, 31, tzinfo=timezone.utc).timestamp()
    stamps = np.sort(rng.uniform(start, end, n))
    return [datetime.fromtimestamp(float(s), tz=timezone.utc).replace(microsecond=0) for s in stamps]


def main() -> None:
    times = sample_times()
    cases = []
    for pt in POINTS:
        entry = {**pt, "samples": []}
        sun = horizons_az_el("sun", pt["lat"], pt["lon"], pt["alt_km"], times)
        earth = horizons_az_el("earth", pt["lat"], pt["lon"], pt["alt_km"], times)
        for t, s, e in zip(times, sun, earth):
            entry["samples"].append({
                "utc": t.isoformat().replace("+00:00", "Z"),
                "sun": {"az": s[0], "el": s[1]},
                "earth": {"az": e[0], "el": e[1]},
            })
        cases.append(entry)
        print("fetched", pt["name"])
    FIXTURE_DIR.mkdir(parents=True, exist_ok=True)
    out = FIXTURE_DIR / "horizons_reference.json"
    out.write_text(json.dumps({
        "source": "JPL Horizons API (https://ssd.jpl.nasa.gov/api/horizons.api), CENTER=coord@301, "
                  "QUANTITIES=4 (airless apparent azimuth/elevation), DE441",
        "generated_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "cases": cases,
    }, indent=1))
    print("wrote", out)


if __name__ == "__main__":
    main()
