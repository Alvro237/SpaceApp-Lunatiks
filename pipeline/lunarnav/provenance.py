"""Provenance of every dataset: source, version, resolution, terms and the transformation applied.

This feeds the app's "Data & Methods" page and the submission form's NASA-data field.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

import requests

from .config import PGDA_LOLA_BASE, WEB_DATA_DIR

TERMS_PUBLIC = ("Publicly released NASA data. Used with attribution; redistributed here only as "
                "derived, precomputed tables.")


def _head(url: str) -> dict:
    try:
        r = requests.head(url, timeout=60, allow_redirects=True)
        return {"bytes": int(r.headers.get("Content-Length", 0)) or None,
                "serverLastModified": r.headers.get("Last-Modified")}
    except requests.RequestException:
        return {"bytes": None, "serverLastModified": None}


def write_provenance(kernel_manifest: dict) -> dict:
    sites_path = WEB_DATA_DIR / "sites.json"
    dem_files: dict[str, float] = {}
    if sites_path.exists():
        for s in json.loads(sites_path.read_text())["sites"]:
            for lvl in s["terrain"].get("levels", []):
                dem_files[lvl["file"]] = lvl["pixelM"]

    datasets: list[dict] = []
    for role, k in kernel_manifest.items():
        datasets.append({
            "id": f"naif-{role}", "name": k["description"], "agency": "NASA / JPL NAIF",
            "url": k["url"], "file": k["file"], "bytes": k["bytes"], "sha256": k["sha256"],
            "serverLastModified": k["server_last_modified"], "terms": TERMS_PUBLIC,
            "use": "Sun and Earth positions in the Moon Mean-Earth frame (SPICE, light time + stellar aberration)",
            "transformation": "Evaluated hourly 2025-2035 and 1969-1972 into float32 vector tables",
            "nasaData": True,
        })
    for name, px in sorted(dem_files.items(), key=lambda kv: kv[1]):
        url = f"{PGDA_LOLA_BASE}/{name}"
        datasets.append({
            "id": f"lola-{name.replace('.TIF', '').lower()}", "name": f"LOLA digital elevation model {name}",
            "agency": "NASA GSFC PGDA (LRO / LOLA, Barker et al.)", "url": url, "file": name,
            "resolutionM": px, **_head(url), "terms": TERMS_PUBLIC,
            "use": "Terrain horizon mask, ground height and slope at the site",
            "transformation": "Windows read remotely (HTTP range), bilinear sampling, ray marching with exact "
                              "lunar curvature, stored as 720-azimuth int16 profiles",
            "nasaData": True, "reference": "https://pgda.gsfc.nasa.gov/products/90",
        })
    datasets += [
        {"id": "horizons", "name": "JPL Horizons System, lunar surface observer", "agency": "NASA / JPL SSD",
         "url": "https://ssd.jpl.nasa.gov/api/horizons.api", "terms": TERMS_PUBLIC,
         "use": "Independent reference for validating our Sun/Earth azimuth and elevation (never a runtime dependency)",
         "transformation": "Responses stored as a fixture (11 sites x 16 epochs)", "nasaData": True},
        {"id": "alsj", "name": "Apollo Lunar Surface Journal: Earth and Sun altitude/azimuth tables",
         "agency": "NASA (ALSJ, E. Scotti)",
         "url": "https://www.nasa.gov/wp-content/uploads/static/history/alsj/Scotti_AltAz.txt",
         "terms": TERMS_PUBLIC, "use": "Historical validation at 43 Apollo mission events",
         "transformation": "Parsed to a JSON fixture", "nasaData": True},
        {"id": "nssdca-apollo", "name": "Apollo Landing Site Coordinates", "agency": "NASA NSSDCA",
         "url": "https://nssdc.gsfc.nasa.gov/planetary/lunar/lunar_sites.html", "terms": TERMS_PUBLIC,
         "use": "Apollo Lunar Module positions (LRO-derived, Wagner et al. 2017)",
         "transformation": "Copied to the catalogue", "nasaData": True},
        {"id": "lroc", "name": "LROC featured images: IM-1, IM-2, Blue Ghost 1, Chandrayaan-3, SLIM",
         "agency": "NASA / GSFC / Arizona State University", "url": "https://www.lroc.asu.edu/",
         "terms": TERMS_PUBLIC, "use": "Landing coordinates and reference elevations",
         "transformation": "Copied to the catalogue", "nasaData": True},
        {"id": "gazetteer", "name": "Gazetteer of Planetary Nomenclature (Moon)", "agency": "USGS / IAU",
         "url": "https://planetarynames.wr.usgs.gov/", "terms": "Public USGS data",
         "use": "Centres of south-polar craters and massifs", "transformation": "Copied to the catalogue",
         "nasaData": False},
    ]
    doc = {"generatedUtc": datetime.now(timezone.utc).isoformat(timespec="seconds"), "datasets": datasets}
    (WEB_DATA_DIR / "provenance.json").write_text(json.dumps(doc, indent=1))
    print(f"provenance.json: {len(datasets)} datasets")
    return doc
