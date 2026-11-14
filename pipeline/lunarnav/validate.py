"""Measure, with code, how well our numbers agree with independent references.

The app's Validation page shows ``validation.json`` as generated here, so the claims in the UI and
in the demo come from a computation, not from prose.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

import numpy as np
import spiceypy as spice

from .config import FIXTURE_DIR, WEB_DATA_DIR
from .spice_setup import az_el_deg, load_kernels, local_basis


def _dt(iso: str) -> datetime:
    return datetime.fromisoformat(iso.replace("Z", "+00:00"))


def _vec(body: str, utc_iso: str) -> np.ndarray:
    et = spice.str2et(_dt(utc_iso).strftime("%Y-%m-%d %H:%M:%S") + " UTC")
    pos, _ = spice.spkpos(body, et, "MOON_ME", "LT+S", "MOON")
    return pos


def _angdiff(a: float, b: float) -> float:
    return abs((a - b + 180.0) % 360.0 - 180.0)


def horizons_stats() -> dict:
    data = json.loads((FIXTURE_DIR / "horizons_reference.json").read_text())
    el_err = {"sun": [], "earth": []}
    az_err = {"sun": [], "earth": []}
    for case in data["cases"]:
        for s in case["samples"]:
            for body, name in (("sun", "SUN"), ("earth", "EARTH")):
                az, el = az_el_deg(_vec(name, s["utc"]), case["lat"], case["lon"], case["alt_km"])
                ref = s[body]
                el_err[body].append(abs(el - ref["el"]))
                if abs(ref["el"]) < 85:  # azimuth is ill-defined near the zenith
                    az_err[body].append(_angdiff(az, ref["az"]) * np.cos(np.radians(ref["el"])))
    n = sum(len(c["samples"]) for c in data["cases"])
    return {
        "reference": "JPL Horizons API (airless apparent azimuth/elevation of the target centre, DE441)",
        "sites": len(data["cases"]),
        "epochs": len(data["cases"][0]["samples"]),
        "comparisons": n * 2,
        "dateRange": [data["cases"][0]["samples"][0]["utc"], data["cases"][0]["samples"][-1]["utc"]],
        "maxElevationErrorDeg": round(float(max(max(v) for v in el_err.values())), 6),
        "maxAzimuthErrorDeg": round(float(max(max(v) for v in az_err.values())), 6),
        "toleranceDeg": 0.01,
    }


def apollo_stats() -> dict:
    data = json.loads((FIXTURE_DIR / "alsj_apollo_reference.json").read_text())
    sun_el, sun_az, earth_inf, earth_par = [], [], [], []
    for m in data["missions"]:
        for e in m["events"]:
            sun = _vec("SUN", e["utc"])
            az, el = az_el_deg(sun, m["lat"], m["lon"])
            sun_el.append(abs(el - e["sun"]["alt"]))
            if (m["apollo"], e["label"]) != (12, "EVA1 end"):  # documented typo in the source table
                sun_az.append(_angdiff(az, e["sun"]["az"]))
            ev = _vec("EARTH", e["utc"])
            _, _, up = local_basis(m["lat"], m["lon"])
            earth_inf.append(abs(np.degrees(np.arcsin(ev @ up / np.linalg.norm(ev))) - e["earth"]["alt"]))
            _, el_par = az_el_deg(ev, m["lat"], m["lon"])
            earth_par.append(el_par - e["earth"]["alt"])
    return {
        "reference": "NASA Apollo Lunar Surface Journal, Sun/Earth altitude-azimuth tables "
                     "(Nautical Almanac lunar ephemeris, 1970s)",
        "events": sum(len(m["events"]) for m in data["missions"]),
        "missions": [m["apollo"] for m in data["missions"]],
        "sunElevationMaxErrorDeg": round(float(max(sun_el)), 3),
        "sunAzimuthMaxErrorDeg": round(float(max(sun_az)), 3),
        "earthElevationMaxErrorNoParallaxDeg": round(float(max(earth_inf)), 3),
        "earthParallaxOffsetDeg": [round(float(min(earth_par)), 3), round(float(max(earth_par)), 3)],
        "note": "The 1970s tables place the Earth at infinity (no lunar-radius parallax, up to 0.26 deg). "
                "Without parallax we match them; with parallax, as Horizons and this project do, the "
                "difference equals the parallax.",
        "excludedAzimuthEntry": "Apollo 12 EVA1 end (out of sequence in the source table, 0.41 deg off)",
    }


def dem_stats() -> list[dict]:
    path = WEB_DATA_DIR / "sites.json"
    if not path.exists():
        return []
    sites = json.loads(path.read_text())["sites"]
    out = []
    for s in sites:
        ref = s.get("referenceElevationM")
        if ref is not None and s["terrain"].get("available"):
            out.append({
                "site": s["name"],
                "referenceElevationM": ref,
                "ourDemElevationM": s["terrain"]["groundHeightM"],
                "differenceM": round(s["terrain"]["groundHeightM"] - ref, 1),
                "reference": s["source"]["url"],
            })
    return out


def write_validation() -> dict:
    load_kernels()
    doc = {
        "generatedUtc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "ephemerisVsHorizons": horizons_stats(),
        "ephemerisVsApolloTables": apollo_stats(),
        "terrainHeightVsLroc": dem_stats(),
        "horizonAlgorithm": {
            "method": "Ray marching over LOLA DEMs in the plane Moon-centre/observer/sample (exact curvature)",
            "analyticTests": ["smooth sphere gives the geometric dip -acos(R/(R+mast)) in every azimuth",
                              "a 500 m ridge 10 km away appears at the analytic angle (0.08 deg tolerance)",
                              "a higher mast sees lower; NaN samples are ignored",
                              "a 10 deg plane returns a 10 deg slope"],
        },
    }
    WEB_DATA_DIR.mkdir(parents=True, exist_ok=True)
    (WEB_DATA_DIR / "validation.json").write_text(json.dumps(doc, indent=1))
    h, a = doc["ephemerisVsHorizons"], doc["ephemerisVsApolloTables"]
    print(f"validation.json: Horizons max el err {h['maxElevationErrorDeg']} deg over {h['comparisons']} comparisons; "
          f"Apollo sun el max err {a['sunElevationMaxErrorDeg']} deg over {a['events']} events")
    return doc
