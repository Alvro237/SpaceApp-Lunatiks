"""Minimal client for the JPL Horizons API, used only to build validation fixtures.

Horizons does not allow browser (CORS) access, so it is never a runtime dependency of the site.
We query it from Python, store the answers as fixtures and compare our own SPICE-based numbers
against them (pytest and vitest both read the same fixture file).
"""
from __future__ import annotations

import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

from .config import DATA_DIR

API = "https://ssd.jpl.nasa.gov/api/horizons.api"
CACHE_DIR = DATA_DIR / "horizons_cache"

TARGETS = {"sun": "10", "earth": "399"}


def jd_from_utc(dt: datetime) -> float:
    return dt.astimezone(timezone.utc).timestamp() / 86400.0 + 2440587.5


def _query(target: str, lat: float, lon: float, alt_km: float, jds: list[float]) -> list[tuple[float, float]]:
    params = {
        "format": "json",
        "COMMAND": f"'{target}'",
        "OBJ_DATA": "'NO'",
        "MAKE_EPHEM": "'YES'",
        "EPHEM_TYPE": "'OBSERVER'",
        "CENTER": "'coord@301'",
        "COORD_TYPE": "'GEODETIC'",
        "SITE_COORD": f"'{lon:.6f},{lat:.6f},{alt_km:.6f}'",
        "TLIST_TYPE": "'JD'",
        "TIME_TYPE": "'UT'",
        "TLIST": "'" + " ".join(f"{jd:.9f}" for jd in jds) + "'",
        "QUANTITIES": "'4'",
        "ANG_FORMAT": "'DEG'",
        "CSV_FORMAT": "'YES'",
        "REF_SYSTEM": "'ICRF'",
    }
    key = json.dumps(params, sort_keys=True)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_file = CACHE_DIR / (re.sub(r"[^0-9a-zA-Z]+", "_", f"{target}_{lat}_{lon}_{alt_km}")[:60]
                              + f"_{abs(hash(key)) % 10**10}.txt")
    if cache_file.exists():
        text = cache_file.read_text()
    else:
        resp = requests.get(API, params=params, timeout=90)
        resp.raise_for_status()
        payload = resp.json()
        if "result" not in payload:
            raise RuntimeError(f"Horizons error: {payload}")
        text = payload["result"]
        cache_file.write_text(text)
        time.sleep(0.4)  # be polite to the public API
    if "$$SOE" not in text:
        raise RuntimeError("Horizons returned no ephemeris rows:\n" + text[:1500])
    rows = text.split("$$SOE")[1].split("$$EOE")[0].strip().splitlines()
    out = []
    for row in rows:
        nums = [f for f in (c.strip() for c in row.split(",")) if re.fullmatch(r"-?\d+\.\d+", f)]
        out.append((float(nums[-2]), float(nums[-1])))  # azimuth, elevation (deg)
    if len(out) != len(jds):
        raise RuntimeError(f"expected {len(jds)} rows, got {len(out)}")
    return out


def horizons_az_el(body: str, lat: float, lon: float, alt_km: float, times: list[datetime]):
    """Airless apparent (light-time + stellar aberration) azimuth/elevation from a lunar site."""
    return _query(TARGETS[body], lat, lon, alt_km, [jd_from_utc(t) for t in times])
