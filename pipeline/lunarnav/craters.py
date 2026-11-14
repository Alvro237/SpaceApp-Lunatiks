"""Compact copy of the Robbins (2018) lunar crater database for crater-density hazard checks.

Source: Robbins, S. J. (2018), "A New Global Database of Lunar Impact Craters >1-2 km", JGR Planets,
distributed by USGS Astrogeology (built from LRO LROC/LOLA and JAXA Kaguya Terrain Camera data).
The archive is a ~96 MB zip holding a 238 MB CSV with 21 columns; the API needs three of them.

Output: ``data/craters/robbins_2018.npz`` with float32 arrays ``lat`` (deg, planetocentric),
``lon`` (deg east, -180..180) and ``diam_km``, sorted by latitude so a latitude band is a slice.
The catalogue is complete only above ~1-2 km: it measures crater density, it says nothing about
boulders or small craters at lander scale.

Run:  uv run python -m lunarnav.craters      (downloads the zip into data/raw/robbins if missing)
"""
from __future__ import annotations

import json
import zipfile
from datetime import datetime, timezone

import numpy as np
import requests

from .config import CRATER_DIR, DATA_DIR, ROBBINS_URL

RAW_DIR = DATA_DIR / "robbins"
ZIP_NAME = "lunar_crater_database_robbins_2018.zip"
CSV_MEMBER = "lunar_crater_database_robbins_2018_bundle/data/lunar_crater_database_robbins_2018.csv"


def _ensure_zip():
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    path = RAW_DIR / ZIP_NAME
    if not path.exists():
        with requests.get(ROBBINS_URL, stream=True, timeout=120) as r:
            r.raise_for_status()
            with open(path, "wb") as fh:
                for chunk in r.iter_content(1 << 20):
                    fh.write(chunk)
    return path


def build() -> dict:
    path = _ensure_zip()
    with zipfile.ZipFile(path) as zf, zf.open(CSV_MEMBER) as fh:
        header = fh.readline().decode("ascii").strip().split(",")
        cols = tuple(header.index(c) for c in ("LAT_CIRC_IMG", "LON_CIRC_IMG", "DIAM_CIRC_IMG"))
        table = np.loadtxt(fh, delimiter=",", usecols=cols, dtype=np.float64)
    lat, lon, diam = table[:, 0], table[:, 1], table[:, 2]
    keep = np.isfinite(lat) & np.isfinite(lon) & np.isfinite(diam) & (diam > 0)
    lat, lon, diam = lat[keep], lon[keep], diam[keep]
    lon = np.where(lon > 180.0, lon - 360.0, lon)          # catalogue uses 0..360 east
    order = np.argsort(lat, kind="stable")
    CRATER_DIR.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(CRATER_DIR / "robbins_2018.npz", lat=lat[order].astype(np.float32),
                        lon=lon[order].astype(np.float32), diam_km=diam[order].astype(np.float32))
    meta = {
        "format": 1, "file": "robbins_2018.npz", "count": int(lat.size),
        "arrays": {"lat": "deg, planetocentric, sorted ascending", "lon": "deg east, -180..180", "diam_km": "km"},
        "diameterKm": {"min": round(float(diam.min()), 3), "max": round(float(diam.max()), 3)},
        "southOf60S": int((lat < -60).sum()), "southOf80S": int((lat < -80).sum()),
        "completeness": "Global, complete for diameters above about 1-2 km; not a boulder or small-crater catalogue",
        "frame": "Catalogue coordinates are planetocentric, east-positive; used here as MOON_ME",
        "source": {
            "label": "Robbins (2018) Lunar Crater Database, USGS Astrogeology Science Center",
            "url": "https://astrogeology.usgs.gov/search/map/moon_crater_database_v1_robbins",
            "download": ROBBINS_URL, "zipBytes": path.stat().st_size,
            "citation": "Robbins, S. J. (2018). A new global database of lunar impact craters >1-2 km: 1. Crater "
                        "locations and sizes, comparisons with published databases, and global analysis. "
                        "JGR Planets, 124. doi:10.1029/2018JE005592",
            "instruments": "LRO LROC WAC and LOLA (NASA), Kaguya Terrain Camera (JAXA)",
        },
        "transformation": "Kept circle-fit latitude, longitude and diameter; longitude moved to -180..180; "
                          "sorted by latitude; stored as float32",
        "builtUtc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    (CRATER_DIR / "craters.json").write_text(json.dumps(meta, indent=1), encoding="utf-8")
    return meta


if __name__ == "__main__":
    print(json.dumps(build(), indent=1))
