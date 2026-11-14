"""Build the site catalogue: terrain horizon masks, ground height, slope and zone masks.

Terrain data exists south of 60 deg S (PGDA LOLA south-pole products). Sites outside that band are
kept in the catalogue with ``terrain.available = false``: the app then uses the geometric horizon
of a smooth sphere and says so. Nothing is invented for them.

Output (web/public/data):
  sites.json      catalogue + per-site terrain metadata
  horizons.i16    int16 LE hundredths of a degree, per terrain site [mast][azimuth]
  zones.i16       int16 LE, per terrain site [zone point][azimuth], 2 m mast
"""
from __future__ import annotations

import json
from copy import deepcopy

import numpy as np

from . import horizon as hz
from .catalog import SITES
from .config import FIXTURE_DIR, WEB_DATA_DIR
from .dem import DemStack

ZONE_RINGS_M = (500.0, 1500.0)
ZONE_BEARINGS = 8
ZONE_MAST_M = 2.0
POLAR_COVERAGE_LAT = -60.0


def zone_points(lat_deg: float, lon_deg: float) -> list[dict]:
    pts = [{"bearingDeg": 0.0, "distanceM": 0.0, "lat": lat_deg, "lon": lon_deg}]
    for ring in ZONE_RINGS_M:
        for k in range(ZONE_BEARINGS):
            bearing = k * 360.0 / ZONE_BEARINGS
            la, lo = hz.destination(np.radians(lat_deg), np.radians(lon_deg),
                                    np.array([[np.radians(bearing)]]), np.array([[ring]]))
            pts.append({"bearingDeg": bearing, "distanceM": ring,
                        "lat": float(np.degrees(la[0, 0])), "lon": float(np.degrees(lo[0, 0]))})
    return pts


def _fill_nan(profile: np.ndarray, mast_m: float, ground_m: float) -> tuple[np.ndarray, int]:
    bad = np.isnan(profile)
    if bad.any():
        profile = profile.copy()
        profile[bad] = hz.spherical_horizon_deg(mast_m, ground_m)
    return profile, int(bad.sum())


def compute_terrain(stack: DemStack, lat: float, lon: float) -> tuple[dict, np.ndarray, np.ndarray]:
    ground = stack.ground_height()
    dist, heights = hz.sample_rays(stack.height, lat, lon)
    masts = []
    fallback = 0
    for mast in hz.MASTS_M:
        prof, nbad = _fill_nan(hz.horizon_from_heights(dist, heights, ground, mast), mast, ground)
        masts.append(prof)
        fallback = max(fallback, nbad)
    masts_arr = np.array(masts)               # (n_masts, 720) degrees
    two_m = masts_arr[hz.MASTS_M.index(2.0)]

    zone_meta = zone_points(lat, lon)
    zone_profiles = []
    for p in zone_meta:
        g = float(stack.height(np.array([np.radians(p["lat"])]), np.array([np.radians(p["lon"])]))[0])
        if not np.isfinite(g):
            g = ground
        d, h = hz.sample_rays(stack.height, p["lat"], p["lon"])
        prof, _ = _fill_nan(hz.horizon_from_heights(d, h, g, ZONE_MAST_M), ZONE_MAST_M, g)
        p["groundHeightM"] = round(g, 1)
        zone_profiles.append(prof)

    meta = {
        "available": True,
        "groundHeightM": round(ground, 1),
        "slopeDeg": round(hz.slope_deg(stack.height, lat, lon, 100.0), 2),
        "levels": [{"file": w.spec.file, "pixelM": w.spec.pixel_m} for w in stack.windows],
        "horizon2mMaxDeg": round(float(two_m.max()), 2),
        "horizon2mMeanDeg": round(float(two_m.mean()), 2),
        "fallbackAzimuths": fallback,
        "zone": {"mastM": ZONE_MAST_M, "points": zone_meta},
    }
    return meta, hz.encode_centideg(masts_arr), hz.encode_centideg(np.array(zone_profiles))


def apollo_landing_times() -> dict[int, str]:
    data = json.loads((FIXTURE_DIR / "alsj_apollo_reference.json").read_text())
    return {m["apollo"]: m["events"][0]["utc"] for m in data["missions"]}


def build_sites(only: set[str] | None = None) -> dict:
    WEB_DATA_DIR.mkdir(parents=True, exist_ok=True)
    landing = apollo_landing_times()
    sites_out, hz_chunks, zone_chunks = [], [], []
    for site in SITES:
        s = deepcopy(site)
        if "apollo" in s:
            s["landingUtc"] = landing[s["apollo"]]
        print(f"[{s['id']}] {s['name']}  ({s['lat']:.4f}, {s['lon']:.4f})", flush=True)
        terrain: dict = {"available": False,
                         "reason": "Terrain data (LOLA south-pole products) covers south of 60 S only; "
                                   "the geometric horizon of a smooth sphere is used"}
        if s["lat"] <= POLAR_COVERAGE_LAT and (only is None or s["id"] in only):
            stack = DemStack(s["lat"], s["lon"])
            if stack.covered and np.isfinite(stack.ground_height()):
                meta, masts, zones = compute_terrain(stack, s["lat"], s["lon"])
                meta["horizonOffset"] = len(hz_chunks)
                meta["zoneOffset"] = len(zone_chunks)
                hz_chunks.append(masts)
                zone_chunks.append(zones)
                terrain = meta
                print(f"    ground {meta['groundHeightM']} m, slope {meta['slopeDeg']} deg, "
                      f"horizon(2 m) mean {meta['horizon2mMeanDeg']} max {meta['horizon2mMaxDeg']} deg", flush=True)
        s["terrain"] = terrain
        sites_out.append(s)

    (WEB_DATA_DIR / "horizons.i16").write_bytes(
        np.concatenate([c.ravel() for c in hz_chunks]).astype("<i2").tobytes() if hz_chunks else b"")
    (WEB_DATA_DIR / "zones.i16").write_bytes(
        np.concatenate([c.ravel() for c in zone_chunks]).astype("<i2").tobytes() if zone_chunks else b"")
    doc = {
        "format": 1,
        "referenceRadiusKm": 1737.4,
        "azimuthStepDeg": hz.AZ_STEP_DEG,
        "azimuthCount": hz.N_AZ,
        "mastsM": list(hz.MASTS_M),
        "horizonFile": "horizons.i16",
        "horizonUnit": "int16 little-endian, hundredths of a degree, layout [terrainSite][mast][azimuth]",
        "zoneFile": "zones.i16",
        "zoneUnit": "int16 little-endian, hundredths of a degree, layout [terrainSite][zonePoint][azimuth], 2 m mast",
        "maxRangeM": hz.MAX_RANGE_M,
        "sites": sites_out,
    }
    (WEB_DATA_DIR / "sites.json").write_text(json.dumps(doc, indent=1))
    n_terrain = sum(1 for s in sites_out if s["terrain"]["available"])
    print(f"sites.json: {len(sites_out)} sites, {n_terrain} with terrain horizon")
    return doc
