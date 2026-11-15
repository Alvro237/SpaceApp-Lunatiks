"""Validation system for the SW-1 endpoints (state, series, horizon, points).

Three layers of checks, all through the HTTP layer so they test exactly what the frontend receives:

1. **External reference**: Sun and Earth az/el against JPL Horizons (tests/fixtures/horizons_reference.json)
   for the catalogue site whose coordinates match a fixture case (IM-1), tolerance 0.01 degrees.
2. **Physical invariants** on every response: ranges, distances, disc sizes from distance, visible fraction
   consistent with el - horizon_el, eclipse state consistent with the eclipsed share, consistent flags.
3. **Self-consistency of events**: a reported sunset/Earthset really flips the state one minute either side.
4. **Eclipses** against NASA's lunar eclipse catalogue (tests/fixtures/nasa_lunar_eclipses_2025_2035.json):
   at greatest eclipse of every total lunar eclipse the Sun is fully hidden behind the Earth.
5. **Horizon masks** bit-exact against an independent read of the data files, and against NASA PGDA product 69
   (long-term Sun and Earth visibility maps) through the engine.
6. **Manual points** against Horizons at every fixture place, against the site endpoint, and terrain against
   smooth sphere: the lower skyline always sees more.
7. **Terrain reference** of the point endpoints: NASA PGDA's long-term values point the same way as our own
   terrain masks.

Pytest uses the functions below (tests/test_state.py). The same checks print a report from the command line:

    cd api && uv run python -m tests.sw1_validation
"""
from __future__ import annotations

import json
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path

FIXTURE = Path(__file__).parent / "fixtures" / "horizons_reference.json"
ECLIPSES = Path(__file__).parent / "fixtures" / "nasa_lunar_eclipses_2025_2035.json"
HORIZONS_TOL_DEG = 0.01
AU_KM = 149_597_870.7
SUN_R_KM, EARTH_R_KM = 695_700.0, 6_378.137
# Catalogue sites with exactly the coordinates of a Horizons fixture case (the fixture is at 0 km height;
# the site's ground height shifts the Earth by at most ~0.0004 degrees, well inside the tolerance).
SITE_FOR_CASE = {"IM-1 area": "im-1"}


def sky_error_deg(az1, el1, az2, el2) -> float:
    """Angular distance on the sky between two (az, el) directions, degrees."""
    a1, e1, a2, e2 = map(math.radians, (az1, el1, az2, el2))
    c = math.sin(e1) * math.sin(e2) + math.cos(e1) * math.cos(e2) * math.cos(a1 - a2)
    return math.degrees(math.acos(max(-1.0, min(1.0, c))))


def state_invariants(r: dict) -> list[str]:
    """Physical consistency of one state response. Returns the list of violations (empty = valid)."""
    bad: list[str] = []

    def need(cond: bool, msg: str):
        if not cond:
            bad.append(msg)

    for name, radius_km in (("sun", SUN_R_KM), ("earth", EARTH_R_KM)):
        b = r[name]
        need(0.0 <= b["az"] < 360.0, f"{name}.az {b['az']} outside 0..360")
        need(-90.0 <= b["el"] <= 90.0, f"{name}.el {b['el']} outside -90..90")
        need(0.0 <= b["visible_fraction"] <= 1.0, f"{name}.visible_fraction outside 0..1")
        expected_radius = math.degrees(math.asin(radius_km / b["distance_km"]))
        need(abs(b["angular_radius_deg"] - expected_radius) < 1e-3,
             f"{name}.angular_radius_deg {b['angular_radius_deg']} vs {expected_radius} from distance")
        margin = b["el"] - b["horizon_el"]
        # The horizon varies with azimuth across the disc, so only clear cases are checked (2 radii away).
        if margin > 2 * b["angular_radius_deg"] + 0.5:
            need(b["visible_fraction"] > 0.99, f"{name} well above the horizon but fraction {b['visible_fraction']}")
        if margin < -2 * b["angular_radius_deg"] - 0.5:
            need(b["visible_fraction"] < 0.01, f"{name} well below the horizon but fraction {b['visible_fraction']}")
    sun, earth = r["sun"], r["earth"]
    need(0.255 < sun["angular_radius_deg"] < 0.275, "Sun angular radius not ~0.27 deg")
    need(0.85 < earth["angular_radius_deg"] < 1.05, "Earth angular radius not ~0.95 deg")
    need(0.97 * AU_KM < sun["distance_km"] < 1.03 * AU_KM, "Sun distance not ~1 AU")
    need(340_000 < earth["distance_km"] < 420_000, "Earth distance outside the lunar orbit range")
    need(sun["visible"] == (sun["visible_fraction"] > 0.0), "sun.visible disagrees with visible_fraction > 0")
    need(earth["visible"] == (earth["visible_fraction"] >= r["comms_min_fraction"]),
         "earth.visible disagrees with comms_min_fraction")
    ecl = r["sun_eclipsed_fraction"]
    need(0.0 <= ecl <= 1.0, "sun_eclipsed_fraction outside 0..1")
    need((r["eclipse"] == "none") == (ecl == 0.0), f"eclipse {r['eclipse']} vs eclipsed fraction {ecl}")
    need((r["eclipse"] == "total") == (ecl == 1.0), f"eclipse {r['eclipse']} vs eclipsed fraction {ecl}")
    for gone in ("panel", "irradiance_w_m2", "power_w_m2"):
        need(gone not in r, f"{gone} belongs to the power endpoint, not to state")
    need(r["horizon_kind"] in ("terrain", "smooth_sphere"), "horizon_kind missing")
    for key, body in (("next_sun_transition", "sun"), ("next_earth_transition", "earth")):
        tr = r[key]
        if tr is not None:
            need(tr["in_hours"] > 0, f"{key} not in the future")
            need(tr["kind"] == ("set" if r[body]["visible"] else "rise"), f"{key}.kind disagrees with visibility")
            dt = (_parse(tr["at"]) - _parse(r["t"])).total_seconds() / 3600.0
            need(abs(dt - tr["in_hours"]) < 1.0 / 3600 + 1e-6, f"{key}.in_hours {tr['in_hours']} vs at - t {dt}")
    return bad


def _parse(utc: str) -> datetime:
    return datetime.fromisoformat(utc.replace("Z", "+00:00")).astimezone(timezone.utc)


def _iso(t: datetime) -> str:
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


def _state_at(client, site_id: str, utc: str):
    r = client.get(f"/api/v1/sites/{site_id}/state", params={"t": utc})
    if r.status_code == 400:
        return None
    r.raise_for_status()
    body = r.json()
    return {k: (body[k]["az"], body[k]["el"]) for k in ("sun", "earth")}


def _series_first_sample(client, site_id: str, utc: str):
    r = client.get(f"/api/v1/sites/{site_id}/series", params={"start": utc, "duration_h": 1, "step_min": 60})
    if r.status_code == 400:
        return None
    r.raise_for_status()
    body = r.json()
    return {k: (body[k]["az"][0], body[k]["el"][0]) for k in ("sun", "earth")}


ENDPOINT_AT = {"state": _state_at, "series": _series_first_sample}


def horizons_comparisons(client, endpoint: str = "state") -> list[dict]:
    """Every fixture sample for the matching catalogue sites, through HTTP (``state`` at t, or the first sample
    of a ``series`` starting at t): one row per body with the angular error against JPL Horizons."""
    fetch = ENDPOINT_AT[endpoint]
    rows = []
    for case in json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]:
        site_id = SITE_FOR_CASE.get(case["name"])
        if site_id is None:
            continue
        for sample in case["samples"]:
            got = fetch(client, site_id, sample["utc"])
            if got is None:               # outside the tables
                continue
            for name in ("sun", "earth"):
                az, el = got[name]
                rows.append({"case": case["name"], "utc": sample["utc"], "body": name,
                             "error_deg": sky_error_deg(az, el, sample[name]["az"], sample[name]["el"])})
    return rows


def transition_flips(client, path: str, t: str, body: str, extra: dict | None = None) -> list[str]:
    """The reported next transition really changes the state: same as now 2 s before ``at`` (edges are refined
    to ~1 s), already changed at the published ``at`` itself."""
    params = {"t": t, **(extra or {})}
    now = client.get(path, params=params).json()
    tr = now[f"next_{body}_transition"]
    if tr is None:
        return []
    at = _parse(tr["at"])
    before = client.get(path, params={**params, "t": _iso(at - timedelta(seconds=2))}).json()[body]["visible"]
    after = client.get(path, params={**params, "t": _iso(at)}).json()[body]["visible"]
    bad = []
    if before != now[body]["visible"]:
        bad.append(f"{body} {tr['kind']} at {tr['at']}: state already changed 2 s before")
    if after == now[body]["visible"]:
        bad.append(f"{body} {tr['kind']} at {tr['at']}: state not changed at the published instant")
    return bad


SWEEP_TIMES = ["2026-11-20T12:00:00Z", "2027-03-01T00:00:00Z", "2028-06-15T06:30:00Z", "2030-01-01T18:00:00Z"]


def sweep_invariants(client) -> list[str]:
    """state_invariants on every catalogue site x SWEEP_TIMES x two comms thresholds."""
    bad = []
    for site in client.get("/api/v1/sites").json()["sites"]:
        for t in SWEEP_TIMES:
            for comms in (0.5, 1.0):
                r = client.get(f"/api/v1/sites/{site['id']}/state", params={"t": t, "comms_min_fraction": comms})
                bad += [f"{site['id']} {t} comms {comms}: {m}" for m in state_invariants(r.json())]
    return bad


# ---------------------------------------------------------------------------- series

SERIES = "/api/v1/sites/{site_id}/series"
STATE = "/api/v1/sites/{site_id}/state"


def _in_ranges(t: datetime, ranges: list[dict]) -> bool:
    """Visible at t according to refined ranges: [start, end), closed at end when the range runs past the window."""
    for r in ranges:
        a, b = _parse(r["start"]), _parse(r["end"])
        if a <= t < b or (r["ends_after_window"] and t == b):
            return True
    return False


def series_invariants(r: dict) -> list[str]:
    """Internal consistency of one series response: shapes, grid, flags, ranges against samples, metrics."""
    bad: list[str] = []

    def need(cond: bool, msg: str):
        if not cond:
            bad.append(msg)

    n = r["samples"]
    arrays = [r["t"], r["eclipse"], r["sun_eclipsed_fraction"]] + [r[b][k] for b in ("sun", "earth")
                                                                   for k in ("az", "el", "horizon_el",
                                                                             "visible_fraction", "visible")]
    need(all(len(a) == n for a in arrays), "arrays of different lengths")
    t = [_parse(x) for x in r["t"]]
    need(r["t"][0] == r["start"] and r["t"][-1] == r["end"], "t does not run from start to end")
    step = timedelta(minutes=r["step_min"])
    need(all(abs((b - a) - step) <= timedelta(seconds=1) for a, b in zip(t, t[1:])), "uneven time grid")
    for name, thr in (("sun", None), ("earth", r["comms_min_fraction"])):
        b = r[name]
        need(all(0.0 <= a < 360.0 for a in b["az"]), f"{name}.az outside 0..360")
        need(all(0.0 <= f <= 1.0 for f in b["visible_fraction"]), f"{name}.visible_fraction outside 0..1")
        expect = [f > 0.0 if thr is None else f >= thr for f in b["visible_fraction"]]
        need(b["visible"] == expect, f"{name}.visible disagrees with visible_fraction")
    for e, f in zip(r["eclipse"], r["sun_eclipsed_fraction"]):
        if (e == "none") != (f == 0.0) or (e == "total") != (f == 1.0):
            bad.append(f"eclipse {e} vs eclipsed fraction {f}")
            break
    flags = {"sunlit_ranges": r["sun"]["visible"], "comms_ranges": r["earth"]["visible"],
             "eclipse_ranges": [e != "none" for e in r["eclipse"]]}
    for key, flag in flags.items():
        rr = r[key]
        bounds = [(_parse(x["start"]), _parse(x["end"])) for x in rr]
        need(all(a < b for a, b in bounds), f"{key}: empty or reversed range")
        need(all(b1 <= a2 for (_, b1), (a2, _) in zip(bounds, bounds[1:])), f"{key}: overlapping or unsorted")
        need(all(t[0] <= a and b <= t[-1] for a, b in bounds), f"{key}: range outside the window")
        need(all(x["starts_before_window"] == (_parse(x["start"]) == t[0] and flag[0]) for x in rr),
             f"{key}: starts_before_window flag wrong")
        mismatch = [r["t"][i] for i in range(n) if flag[i] != _in_ranges(t[i], rr)]
        need(not mismatch, f"{key}: samples disagree with ranges, first at {mismatch[:1]}")
        for x, (a, b) in zip(rr, bounds):
            need(abs(x["duration_h"] - (b - a).total_seconds() / 3600.0) < 1e-6, f"{key}: duration_h != end - start")
    m = r["metrics"]
    sun, earth = r["sun"]["visible"], r["earth"]["visible"]
    need(abs(m["sunlight_pct"] - 100.0 * sum(sun) / n) < 1e-9, "sunlight_pct != share of sunlit samples")
    need(abs(m["comms_pct"] - 100.0 * sum(earth) / n) < 1e-9, "comms_pct != share of comms samples")
    need(abs(m["both_pct"] - 100.0 * sum(a and b for a, b in zip(sun, earth)) / n) < 1e-9, "both_pct wrong")
    need(m["continuous_light"] == all(sun) and m["continuous_comms"] == all(earth), "continuous flags wrong")
    need(abs(m["max_sun_el_deg"] - max(r["sun"]["el"])) < 1e-9 and abs(m["min_sun_el_deg"] - min(r["sun"]["el"])) < 1e-9,
         "solar elevation extremes wrong")
    need(m["eclipse_events"] == len(r["eclipse_ranges"]), "eclipse_events != number of eclipse ranges")
    for gone in ("panel", "irradiance_w_m2", "power_w_m2", "mean_power_w_m2"):
        need(gone not in r and gone not in m, f"{gone} belongs to the power endpoint")
    return bad


def series_matches_state(client, site_id: str | None, r: dict, every: int = 97, state_path: str | None = None,
                         extra: dict | None = None) -> list[str]:
    """Samples equal the state endpoint at the same instant, and every inner range edge flips state's flag
    between 2 s before and the edge itself (edges are refined to ~1 s). For a point, pass
    ``state_path=POINT_STATE`` and ``extra={"lat": ..., "lon": ...}``."""
    bad = []
    path = state_path or STATE.format(site_id=site_id)
    params = {"mast_m": r["mast_m"], "comms_min_fraction": r["comms_min_fraction"], **(extra or {})}
    for i in range(0, r["samples"], every):
        st = client.get(path, params={"t": r["t"][i], **params}).json()
        for b in ("sun", "earth"):
            for k in ("az", "el", "horizon_el", "visible_fraction", "visible"):
                if abs(float(st[b][k]) - float(r[b][k][i])) > 1e-9:
                    bad.append(f"sample {r['t'][i]} {b}.{k}: series {r[b][k][i]} vs state {st[b][k]}")
    for key, body in (("sunlit_ranges", "sun"), ("comms_ranges", "earth")):
        for x in r[key]:
            for edge, inside, cut in (("start", True, x["starts_before_window"]), ("end", False, x["ends_after_window"])):
                if cut:
                    continue
                at = _parse(x[edge])
                now = client.get(path, params={"t": _iso(at), **params}).json()[body]["visible"]
                before = client.get(path, params={"t": _iso(at - timedelta(seconds=2)), **params}).json()[body]["visible"]
                if now != inside or before == inside:
                    bad.append(f"{key} {edge} {x[edge]}: state before={before} at={now}, expected a flip to {inside}")
    return bad


SERIES_CASES = [("im-2", "2026-11-20T12:00:00Z", 720, 10), ("shackleton", "2027-03-01T00:00:00Z", 336, 30),
                ("mons-malapert", "2028-06-15T06:30:00Z", 240, 5), ("apollo-11", "2029-06-25T12:00:00Z", 36, 10)]


# ---------------------------------------------------------------------------- horizon

HORIZON = "/api/v1/sites/{site_id}/horizon"
DATA_DIR = Path(__file__).resolve().parents[2] / "data"
MOON_R_M = 1_737_400.0


def _raw_masks(site_id: str) -> tuple[dict, dict]:
    """Independent decode of data/horizons.i16 and data/zones.i16 (int16 hundredths of a degree) from the
    offsets in data/sites.json, without the API's repository code: {mast: values}, {zone index: values}."""
    import numpy as np
    doc = json.loads((DATA_DIR / "sites.json").read_text(encoding="utf-8"))
    n, masts = doc["azimuthCount"], doc["mastsM"]
    terrain = next(x for x in doc["sites"] if x["id"] == site_id).get("terrain", {})
    if "horizonOffset" not in terrain:
        return {}, {}
    h = np.fromfile(DATA_DIR / "horizons.i16", dtype="<i2")
    z = np.fromfile(DATA_DIR / "zones.i16", dtype="<i2")
    by_mast = {float(m): (h[(terrain["horizonOffset"] * len(masts) + i) * n:][:n] / 100.0).tolist()
               for i, m in enumerate(masts)}
    k = len(terrain["zone"]["points"])
    by_zone = {j: (z[(terrain["zoneOffset"] * k + j) * n:][:n] / 100.0).tolist() for j in range(k)}
    return by_mast, by_zone


def _distance_bearing(lat1, lon1, lat2, lon2) -> tuple[float, float]:
    """Great-circle distance (m, R = 1737.4 km) and initial bearing (degrees from north) from point 1 to 2."""
    p1, l1, p2, l2 = map(math.radians, (lat1, lon1, lat2, lon2))
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin((l2 - l1) / 2) ** 2
    d = 2 * MOON_R_M * math.asin(math.sqrt(a))
    b = math.degrees(math.atan2(math.sin(l2 - l1) * math.cos(p2),
                                math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(l2 - l1)))
    return d, b % 360.0


def _profile_summary_errors(name: str, x: dict, values: list[float], step: float) -> list[str]:
    bad = []
    i_max = max(range(len(values)), key=values.__getitem__)
    i_min = min(range(len(values)), key=values.__getitem__)
    if x["max_deg"] != values[i_max] or x["max_az_deg"] != i_max * step:
        bad.append(f"{name}: max {x['max_deg']} at {x['max_az_deg']} vs {values[i_max]} at {i_max * step}")
    if x["min_deg"] != values[i_min] or x["min_az_deg"] != i_min * step:
        bad.append(f"{name}: min {x['min_deg']} at {x['min_az_deg']} vs {values[i_min]} at {i_min * step}")
    if abs(x["mean_deg"] - sum(values) / len(values)) > 1e-9:
        bad.append(f"{name}: mean_deg wrong")
    return bad


def horizon_invariants(r: dict) -> list[str]:
    """One horizon response against the files, the catalogue, geometry and its own summary."""
    bad: list[str] = []

    def need(cond: bool, msg: str):
        if not cond:
            bad.append(msg)

    n, step = len(r["elevation_deg"]), r["az_step_deg"]
    need(n == 720 and step == 0.5 and r["az"] == [i * step for i in range(n)], "azimuth grid is not 720 x 0.5 deg")
    bad += _profile_summary_errors("site", r, r["elevation_deg"], step)
    by_mast, by_zone = _raw_masks(r["site_id"])
    if r["horizon_kind"] == "terrain" and not by_mast:
        # no stored mask: the skyline is ray-traced over the elevation grids at the exact mast asked
        need(r["mast_used_m"] == r["mast_m"], "traced skyline must use the requested mast")
        need(r["masts_available_m"] == [] and not r["zone_available"] and r["zone"] is None,
             "traced skyline reporting stored masks")
        need(all(-90.0 < v < 90.0 for v in r["elevation_deg"]), "traced skyline out of range")
    elif r["horizon_kind"] == "terrain":
        need(r["mast_used_m"] == min(by_mast, key=lambda m: abs(m - r["mast_m"])), "mast_used_m is not the nearest mask")
        need(r["elevation_deg"] == by_mast[r["mast_used_m"]], "values differ from an independent read of horizons.i16")
        need(r["masts_available_m"] == sorted(by_mast), "masts_available_m wrong")
        if r["mast_used_m"] == 2.0:          # the catalogue summarises the 2 m mask, rounded to 0.01 deg
            cat = next(x for x in json.loads((DATA_DIR / "sites.json").read_text(encoding="utf-8"))["sites"]
                       if x["id"] == r["site_id"])["terrain"]
            need(abs(r["max_deg"] - cat["horizon2mMaxDeg"]) < 0.005 and abs(r["mean_deg"] - cat["horizon2mMeanDeg"]) < 0.005,
                 f"summary {r['max_deg']}/{r['mean_deg']} vs catalogue {cat['horizon2mMaxDeg']}/{cat['horizon2mMeanDeg']}")
    else:
        dip = -math.degrees(math.acos(MOON_R_M / (MOON_R_M + r["mast_m"])))
        need(all(abs(v - dip) < 1e-12 for v in r["elevation_deg"]), f"smooth sphere is not -acos(R/(R+h)) = {dip}")
        need(r["masts_available_m"] == [] and not r["zone_available"] and r["zone"] is None, "smooth sphere with masks")
    if r["zone"] is not None:
        pts = r["zone"]["points"]
        need(r["zone"]["mast_m"] == 2.0 and len(pts) == len(by_zone), "zone size or mast wrong")
        need(pts[0]["distance_m"] == 0.0 and pts[0]["elevation_deg"] == by_mast[2.0], "zone centre != site 2 m mask")
        for j, pt in enumerate(pts):
            need(len(pt["elevation_deg"]) == n, f"zone point {j}: not {n} values")
            need(pt["elevation_deg"] == by_zone[j], f"zone point {j}: differs from an independent read of zones.i16")
            bad += _profile_summary_errors(f"zone point {j}", pt, pt["elevation_deg"], step)
            if pt["distance_m"] > 0:
                d, b = _distance_bearing(r["lat"], r["lon"], pt["lat"], pt["lon"])
                need(abs(d - pt["distance_m"]) < 1.0, f"zone point {j}: {d:.1f} m away, says {pt['distance_m']}")
                need(min(abs(b - pt["bearing_deg"]), 360 - abs(b - pt["bearing_deg"])) < 0.5,
                     f"zone point {j}: bearing {b:.2f}, says {pt['bearing_deg']}")
    return bad


def horizon_mast_monotonic(client, site_id: str) -> list[str]:
    """Raising the mast can only lower the skyline: mask(0) >= mask(2) >= mask(5) >= mask(10) at every azimuth."""
    masks = [client.get(HORIZON.format(site_id=site_id), params={"mast_m": m}).json()["elevation_deg"]
             for m in (0, 2, 5, 10)]
    bad = []
    for lo, hi, a, b in zip((0, 2, 5), (2, 5, 10), masks, masks[1:]):
        n_up = sum(y > x for x, y in zip(a, b))
        if n_up:
            bad.append(f"{site_id}: {n_up} azimuths higher at {hi} m than at {lo} m")
    return bad


def _interp(values: list[float], step: float, az: float) -> float:
    x = (az / step) % len(values)
    i = int(math.floor(x)) % len(values)
    f = x - math.floor(x)
    return values[i] + (values[(i + 1) % len(values)] - values[i]) * f


def horizon_matches_state(client, site_id: str, t: str, mast_m: float) -> list[str]:
    """state's horizon_el is this profile interpolated at the Sun's and the Earth's azimuth."""
    h = client.get(HORIZON.format(site_id=site_id), params={"mast_m": mast_m}).json()
    st = client.get(STATE.format(site_id=site_id), params={"t": t, "mast_m": mast_m}).json()
    bad = []
    for body in ("sun", "earth"):
        expect = _interp(h["elevation_deg"], h["az_step_deg"], st[body]["az"])
        if abs(st[body]["horizon_el"] - expect) > 1e-9:
            bad.append(f"{site_id} {t} {body}: state horizon_el {st[body]['horizon_el']} vs profile {expect}")
    return bad


PGDA_TOL = 0.02


def horizon_vs_pgda(client) -> list[dict]:
    """Independent NASA check of the served masks. For every terrain site, the engine runs 2025-2035 (6-hourly)
    over each zone point's mask as served by the API, giving the mean visible solar-disc fraction and the share
    of time with any of the Earth's disc visible. PGDA product 69 (Mazarico et al., 18.6-year averages over
    960 m cells) must fall inside the range across the zone points, +/- PGDA_TOL."""
    from app import services
    from app.db.store import get_store
    from app.logic.engine import evaluate, make_model, time_grid
    from app.logic.horizon import HorizonProfile

    store = get_store()
    t = time_grid(services.to_ms(datetime(2025, 1, 1, tzinfo=timezone.utc)), 24 * 365 * 11 - 48, 360)
    rows = []
    for site in client.get("/api/v1/sites", params={"terrain_only": True}).json()["sites"]:
        r = client.get(HORIZON.format(site_id=site["id"]), params={"mast_m": 2, "include_zone": True}).json()
        sun, earth = [], []
        for pt in r["zone"]["points"]:
            model = make_model(pt["lat"], pt["lon"], pt["ground_m"], HorizonProfile(pt["elevation_deg"]), 2.0)
            s = evaluate(store.ephemeris, model, t)
            sun.append(float(s.sun_frac.mean()))
            earth.append(float((s.earth_frac > 0).mean()))
        for kind, grid, vals in (("sun", "sun_illumination_65s", sun), ("earth", "earth_visibility_65s", earth)):
            ref = store.grids.sample(grid, r["lat"], r["lon"])
            rows.append({"site": r["site_id"], "kind": kind, "pgda": ref, "centre": vals[0], "lo": min(vals),
                         "hi": max(vals), "ok": min(vals) - PGDA_TOL <= ref <= max(vals) + PGDA_TOL})
    return rows



SKY_MEDIAN_TOL_SR = 0.05   # the real criterion: typical agreement
SKY_TOL_SR = 0.35          # loose cap per site: a 960 m cell averages a summit with its slopes (Mons Malapert)


def horizon_sky_vs_pgda(client) -> list[dict]:
    """Open-sky solid angle from each served mask, integral over azimuth of (1 - sin(skyline)) d(az) in steradians
    (a flat plain sees 2 pi), against NASA PGDA SKYV_65S_240M (product 69, 960 m cells), at every terrain site.
    The cell is a mean over ~1 km, so a summit's value is diluted by its slopes: tolerance SKY_TOL_SR."""
    from app.db.store import get_store
    grids = get_store().grids
    rows = []
    for site in client.get("/api/v1/sites", params={"terrain_only": True}).json()["sites"]:
        r = client.get(HORIZON.format(site_id=site["id"]), params={"mast_m": 2}).json()
        step = math.radians(r["az_step_deg"])
        own = sum(1.0 - math.sin(math.radians(h)) for h in r["elevation_deg"]) * step
        ref = grids.sample("sky_visibility_65s", r["lat"], r["lon"])
        rows.append({"site": r["site_id"], "own_sr": own, "pgda_sr": ref, "ok": abs(own - ref) <= SKY_TOL_SR})
    return rows


# ---------------------------------------------------------------------------- points (manual coordinates)

POINT_STATE = "/api/v1/points/state"


def points_horizons_comparisons(client) -> list[dict]:
    """Every case of the Horizons fixture (11 places from pole to pole, near and far side, a +4 km site) asked
    as manual coordinates: the point sits exactly where Horizons computed. One row per body and sample."""
    rows = []
    for case in json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]:
        for sample in case["samples"]:
            r = client.get(POINT_STATE, params={"lat": case["lat"], "lon": case["lon"], "t": sample["utc"]})
            if r.status_code == 400:
                continue
            r.raise_for_status()
            body = r.json()
            for name in ("sun", "earth"):
                rows.append({"case": case["name"], "utc": sample["utc"], "body": name,
                             "error_deg": sky_error_deg(body[name]["az"], body[name]["el"],
                                                        sample[name]["az"], sample[name]["el"])})
    return rows


def point_equals_site(client, site_id: str, t: str) -> list[str]:
    """At a catalogue site without a stored mask (traced skyline) the point endpoint with ``horizon=terrain``
    gives the site endpoint's answer, except site_id: both ray-trace the same grids at the same coordinates."""
    site = client.get(STATE.format(site_id=site_id), params={"t": t, "mast_m": 2}).json()
    pt = client.get(POINT_STATE, params={"lat": site["lat"], "lon": site["lon"], "t": t, "mast_m": 2,
                                         "horizon": "terrain"}).json()
    diff = [k for k in site if k != "site_id" and site[k] != pt[k]]
    return [f"{site_id} {t}: point differs from site in {diff}"] if diff else []


def _span_extremes(values: list[float], step: float, az: float, half_width_deg: float) -> tuple[float, float]:
    """Min and max of a 720-value profile over [az - w, az + w] (sampled every 0.1 deg, linear, wrapping)."""
    k = max(1, int(2 * half_width_deg / 0.1))
    pts = [_interp(values, step, az - half_width_deg + i * 2 * half_width_deg / k) for i in range(k + 1)]
    return min(pts), max(pts)


def lower_skyline_sees_more(client, site_id: str, times: list[str], mast_m: float = 2.0) -> tuple[list[str], dict]:
    """Terrain (site) against smooth sphere (point at the same coordinates). Where the terrain skyline across the
    whole disc is below the smooth dip, terrain must see at least as much of the disc; where it is entirely
    above, at most. Returns violations and how many instants fell in each case."""
    prof = client.get(HORIZON.format(site_id=site_id), params={"mast_m": mast_m}).json()
    dip = -math.degrees(math.acos(MOON_R_M / (MOON_R_M + mast_m)))
    bad, counts = [], {"terrain_lower": 0, "terrain_higher": 0, "mixed": 0}
    for t in times:
        site = client.get(STATE.format(site_id=site_id), params={"t": t, "mast_m": mast_m}).json()
        pt = client.get(POINT_STATE, params={"lat": site["lat"], "lon": site["lon"], "t": t, "mast_m": mast_m}).json()
        for body in ("sun", "earth"):
            b = site[body]
            w = b["angular_radius_deg"] / max(0.05, math.cos(math.radians(b["el"]))) + 0.05
            lo, hi = _span_extremes(prof["elevation_deg"], prof["az_step_deg"], b["az"], w)
            ft, fs = b["visible_fraction"], pt[body]["visible_fraction"]
            if hi < dip - 0.01:
                counts["terrain_lower"] += 1
                if ft < fs - 1e-3:
                    bad.append(f"{site_id} {t} {body}: terrain lower everywhere but sees {ft:.4f} < {fs:.4f}")
            elif lo > dip + 0.01:
                counts["terrain_higher"] += 1
                if ft > fs + 1e-3:
                    bad.append(f"{site_id} {t} {body}: terrain higher everywhere but sees {ft:.4f} > {fs:.4f}")
            else:
                counts["mixed"] += 1
    return bad, counts


def point_ground_checks(client) -> list[str]:
    """ground_m and ground_source: bilinear height from the finest LOLA grid covering the point (the polar
    grids inside 60 S, the whole-Moon grid elsewhere, so every point reports 'lola_grid')."""
    import numpy as np

    from app.db.store import get_store
    grids = get_store().grids
    bad = []
    for lat, lon in ((-85.0, 20.0), (-84.7906, 29.1957), (-60.5, 0.0), (-59.9, 0.0), (0.0, 0.0), (45.0, -120.0)):
        r = client.get(POINT_STATE, params={"lat": lat, "lon": lon, "t": SWEEP_TIMES[0]}).json()
        want = ("reference_sphere", 0.0)
        for gid in ("lola_elevation_80s", "lola_elevation_60s", "lola_elevation_global"):
            g = grids.bilinear_many(gid, np.array([lat]), np.array([lon]))[0]
            if not np.isnan(g):
                want = ("lola_grid", float(g))
                break
        if (r["ground_source"], r["ground_m"]) != want:
            bad.append(f"({lat}, {lon}): ground {r['ground_source']} {r['ground_m']} vs {want}")
    return bad


def lon_normalisation(client) -> list[str]:
    """0..360 and -180..180 name the same meridian and give identical answers."""
    bad = []
    for a, b in ((330.0, -30.0), (180.0, -180.0), (360.0, 0.0), (200.5, -159.5)):
        ra = client.get(POINT_STATE, params={"lat": -85.0, "lon": a, "t": SWEEP_TIMES[0]}).json()
        rb = client.get(POINT_STATE, params={"lat": -85.0, "lon": b, "t": SWEEP_TIMES[0]}).json()
        if ra != rb:
            bad.append(f"lon {a} and {b} differ")
    return bad


POINT_SWEEP = [(-89.9999, 0.0), (-89.5, 129.78), (-85.0, -42.0), (-70.0, 100.0), (-30.0, -60.0), (0.0, 0.0),
               (0.0, 180.0), (45.0, 90.0), (89.9999, 0.0)]


# ---------------------------------------------------------------------------- points/series and terrain reference

POINT_SERIES = "/api/v1/points/series"
TERRAIN_EFFECT_MIN = 0.05   # judge the sign only where our masks show a clear terrain effect


def _point_series_first_sample(client, lat: float, lon: float, utc: str):
    r = client.get(POINT_SERIES, params={"lat": lat, "lon": lon, "start": utc, "duration_h": 1, "step_min": 60})
    if r.status_code == 400:
        return None
    r.raise_for_status()
    body = r.json()
    return {k: (body[k]["az"][0], body[k]["el"][0]) for k in ("sun", "earth")}


def points_series_horizons_comparisons(client) -> list[dict]:
    """Horizons at all 11 fixture places through points/series (first sample of a window starting at t)."""
    rows = []
    for case in json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]:
        for sample in case["samples"]:
            got = _point_series_first_sample(client, case["lat"], case["lon"], sample["utc"])
            if got is None:
                continue
            for name in ("sun", "earth"):
                az, el = got[name]
                rows.append({"case": case["name"], "utc": sample["utc"], "body": name,
                             "error_deg": sky_error_deg(az, el, sample[name]["az"], sample[name]["el"])})
    return rows


def point_series_equals_site(client, site_id: str, start: str, hours: float) -> list[str]:
    """At a catalogue site without a stored mask points/series with ``horizon=terrain`` equals
    sites/{id}/series except site_id (both ray-trace the same grids)."""
    q = {"start": start, "duration_h": hours, "mast_m": 2}
    site = client.get(SERIES.format(site_id=site_id), params=q).json()
    pt = client.get(POINT_SERIES, params={"lat": site["lat"], "lon": site["lon"], "horizon": "terrain", **q}).json()
    diff = [k for k in site if k != "site_id" and site[k] != pt[k]]
    return [f"{site_id}: points/series differs from sites/series in {diff}"] if diff else []


def terrain_reference_checks(client) -> tuple[list[str], int]:
    """At the 13 terrain sites: the sign of terrain_reference.difference (PGDA - smooth) matches the sign of the
    effect measured with our own terrain masks (engine, terrain - smooth, same period and definitions) wherever
    that effect exceeds TERRAIN_EFFECT_MIN; smooth_sphere recomputed independently; the reference is identical in
    points/state and points/series. Returns violations and the number of clear cases judged."""
    from app import services
    from app.db.store import get_store
    from app.logic.engine import evaluate, time_grid

    store = get_store()
    t = time_grid(services.to_ms(services.LONG_TERM_START), services.LONG_TERM_HOURS, services.LONG_TERM_STEP_MIN)
    bad, judged = [], 0
    for site in client.get("/api/v1/sites", params={"terrain_only": True}).json()["sites"]:
        q = {"lat": site["lat"], "lon": site["lon"], "mast_m": 2}
        ref = client.get(POINT_STATE, params={"t": SWEEP_TIMES[0], **q}).json()["terrain_reference"]
        ref_series = client.get(POINT_SERIES, params={"start": SWEEP_TIMES[0], "duration_h": 1, **q}).json()
        if ref_series["terrain_reference"] != ref:
            bad.append(f"{site['id']}: terrain_reference differs between points/state and points/series")
        terr = evaluate(store.ephemeris, services.model_for_site(store, store.sites.get(site["id"]), 2.0), t)
        smooth = evaluate(store.ephemeris, services.model_for_point(store, site["lat"], site["lon"], 2.0), t)
        for key, fn in (("sun_mean_visible_fraction", lambda s: float(s.sun_frac.mean())),
                        ("earth_any_visible_fraction", lambda s: float((s.earth_frac > 0).mean()))):
            x = ref[key]
            if abs(x["smooth_sphere"] - fn(smooth)) > 1e-12 or abs(x["difference"] - (x["pgda"] - x["smooth_sphere"])) > 1e-12:
                bad.append(f"{site['id']} {key}: smooth_sphere or difference not reproduced")
            effect = fn(terr) - fn(smooth)
            if abs(effect) >= TERRAIN_EFFECT_MIN:
                judged += 1
                if x["difference"] * effect <= 0:
                    bad.append(f"{site['id']} {key}: terrain effect {effect:+.3f} but PGDA says {x['difference']:+.3f}")
    for lat, lon in ((0.0, 0.0), (-60.0, 0.0), (45.0, 90.0)):
        if client.get(POINT_STATE, params={"lat": lat, "lon": lon, "t": SWEEP_TIMES[0]}).json()["terrain_reference"] is not None:
            bad.append(f"({lat}, {lon}): terrain_reference outside PGDA's maps is not null")
    return bad, judged


POINT_SERIES_CASES = [(-84.7906, 29.1957, "2026-11-20T12:00:00Z", 336, 10), (-89.5, 129.78, "2027-03-01T00:00:00Z", 240, 30),
                      (-70.0, 100.0, "2028-06-15T06:30:00Z", 120, 5), (0.67416, 23.47314, "2029-06-25T12:00:00Z", 36, 10)]


def main() -> int:
    from fastapi.testclient import TestClient

    from app.main import app

    client = TestClient(app)
    ok = True
    rows = horizons_comparisons(client)
    worst = max(rows, key=lambda x: x["error_deg"])
    passed = worst["error_deg"] < HORIZONS_TOL_DEG
    ok &= passed
    print(f"[{'PASS' if passed else 'FAIL'}] state vs JPL Horizons: {len(rows)} comparisons, worst "
          f"{worst['error_deg']:.6f} deg ({worst['body']} {worst['utc']}), tolerance {HORIZONS_TOL_DEG}")
    bad = sweep_invariants(client)
    ok &= not bad
    print(f"[{'PASS' if not bad else 'FAIL'}] physical invariants on every site x {len(SWEEP_TIMES)} dates x 2 comms thresholds"
          + "".join(f"\n    {m}" for m in bad[:20]))
    bad = []
    for site_id in ("im-2", "shackleton", "apollo-11"):
        for body in ("sun", "earth"):
            bad += transition_flips(client, f"/api/v1/sites/{site_id}/state", SWEEP_TIMES[0], body)
    ok &= not bad
    print(f"[{'PASS' if not bad else 'FAIL'}] next transitions flip the state (im-2, shackleton, apollo-11)"
          + "".join(f"\n    {m}" for m in bad))
    bad = []
    totals = [e for e in json.loads(ECLIPSES.read_text(encoding="utf-8"))["events"] if e["type"] == "total"]
    for e in totals:
        t = datetime.fromisoformat(e["greatest_td"]).replace(tzinfo=timezone.utc) - timedelta(seconds=69)  # TD->UTC
        r = client.get("/api/v1/sites/apollo-11/state", params={"t": _iso(t)}).json()
        if not (r["eclipse"] == "total" and r["sun_eclipsed_fraction"] == 1.0):
            bad.append(f"{e['greatest_td']}: eclipse={r['eclipse']} eclipsed={r['sun_eclipsed_fraction']:.4f}")
    ok &= not bad
    print(f"[{'PASS' if not bad else 'FAIL'}] {len(totals)} NASA total lunar eclipses 2025-2035: Sun fully hidden"
          + "".join(f"\n    {m}" for m in bad))
    bad = []
    for site_id, start, hours, step in SERIES_CASES:
        r = client.get(SERIES.format(site_id=site_id), params={"start": start, "duration_h": hours, "step_min": step})
        r.raise_for_status()
        bad += [f"{site_id} {start}: {m}" for m in series_invariants(r.json()) + series_matches_state(client, site_id, r.json())]
    ok &= not bad
    print(f"[{'PASS' if not bad else 'FAIL'}] series: arrays, ranges and metrics consistent and equal to state, "
          f"refined edges flip state ({len(SERIES_CASES)} windows)" + "".join(f"\n    {m}" for m in bad[:20]))
    rows = horizons_comparisons(client, "series")
    worst = max(rows, key=lambda x: x["error_deg"])
    passed = worst["error_deg"] < HORIZONS_TOL_DEG
    ok &= passed
    print(f"[{'PASS' if passed else 'FAIL'}] series vs JPL Horizons: {len(rows)} comparisons, worst "
          f"{worst['error_deg']:.6f} deg")
    bad = []
    for site in client.get("/api/v1/sites").json()["sites"]:
        for m in (0, 2, 3, 10):
            r = client.get(HORIZON.format(site_id=site["id"]), params={"mast_m": m, "include_zone": True}).json()
            bad += [f"{site['id']} {m} m: {x}" for x in horizon_invariants(r)]
        if site["terrain_available"]:
            bad += horizon_mast_monotonic(client, site["id"])
        bad += horizon_matches_state(client, site["id"], SWEEP_TIMES[0], 2)
    ok &= not bad
    print(f"[{'PASS' if not bad else 'FAIL'}] horizon: bit-exact vs data files, catalogue, geometry, mast "
          "monotonic, equal to state's horizon_el (every site)" + "".join(f"\n    {m}" for m in bad[:20]))
    rows = horizon_vs_pgda(client)
    fails = [x for x in rows if not x["ok"]]
    ok &= not fails
    n_sun = sum(x["ok"] for x in rows if x["kind"] == "sun")
    n_earth = sum(x["ok"] for x in rows if x["kind"] == "earth")
    sky = horizon_sky_vs_pgda(client)
    bad_sky = [x for x in sky if not x["ok"]]
    errs = sorted(abs(x["own_sr"] - x["pgda_sr"]) for x in sky)
    median = errs[len(errs) // 2]
    ok &= not bad_sky and median < SKY_MEDIAN_TOL_SR
    worst = max(sky, key=lambda x: abs(x["own_sr"] - x["pgda_sr"]))
    print(f"[{'PASS' if not bad_sky and median < SKY_MEDIAN_TOL_SR else 'FAIL'}] horizon open-sky solid angle vs NASA "
          f"PGDA SKYV: median error {median:.3f} sr (< {SKY_MEDIAN_TOL_SR}), all {len(sky)} within {SKY_TOL_SR} sr, "
          f"worst {worst['site']} {worst['own_sr']:.3f} vs {worst['pgda_sr']:.3f} sr")
    print(f"[{'PASS' if not fails else 'FAIL'}] horizon vs NASA PGDA product 69 (2025-2035 engine over the served "
          f"masks): Sun {n_sun}/{len(rows) // 2}, Earth {n_earth}/{len(rows) // 2} inside the zone range +/-{PGDA_TOL}"
          + "".join(f"\n    {x['site']} {x['kind']}: PGDA {x['pgda']:.3f} vs zone [{x['lo']:.3f}, {x['hi']:.3f}]"
                    for x in fails))
    rows = points_horizons_comparisons(client)
    worst = max(rows, key=lambda x: x["error_deg"])
    passed = worst["error_deg"] < HORIZONS_TOL_DEG
    ok &= passed
    print(f"[{'PASS' if passed else 'FAIL'}] points/state vs JPL Horizons at all 11 fixture places: {len(rows)} "
          f"comparisons, worst {worst['error_deg']:.6f} deg ({worst['case']}, {worst['body']})")
    bad = []
    for lat, lon in POINT_SWEEP:
        for t in SWEEP_TIMES:
            r = client.get(POINT_STATE, params={"lat": lat, "lon": lon, "t": t}).json()
            bad += [f"({lat}, {lon}) {t}: {m}" for m in state_invariants(r)]
            if r["horizon_kind"] != "smooth_sphere" or r["site_id"] is not None:
                bad.append(f"({lat}, {lon}): not a smooth-sphere point")
    for site_id in ("apollo-11", "slim", "blue-ghost-1"):
        bad += point_equals_site(client, site_id, SWEEP_TIMES[0])
    bad += point_ground_checks(client) + lon_normalisation(client)
    for lat, lon in ((-89.5, 129.78), (-70.0, 100.0)):
        for body in ("sun", "earth"):
            bad += transition_flips(client, POINT_STATE, SWEEP_TIMES[0], body, {"lat": lat, "lon": lon})
    ok &= not bad
    print(f"[{'PASS' if not bad else 'FAIL'}] points/state: invariants pole to pole, equal to the site endpoint at "
          "smooth-sphere sites, ground source, longitude normalisation, transitions" + "".join(f"\n    {m}" for m in bad[:20]))
    times = [_iso(datetime(2027, 1, 1, tzinfo=timezone.utc) + timedelta(hours=h)) for h in range(0, 24 * 365, 37)]
    bad, total = [], {"terrain_lower": 0, "terrain_higher": 0, "mixed": 0}
    for site_id in ("im-2", "mons-malapert", "nobile", "shackleton"):
        b, c = lower_skyline_sees_more(client, site_id, times)
        bad += b
        total = {k: total[k] + c[k] for k in total}
    ok &= not bad
    print(f"[{'PASS' if not bad else 'FAIL'}] terrain vs smooth sphere: the lower skyline always sees more "
          f"({total['terrain_lower']} cases terrain below, {total['terrain_higher']} above, {total['mixed']} mixed "
          "and not judged)" + "".join(f"\n    {m}" for m in bad[:20]))
    bad = []
    for lat, lon, start, hours, step in POINT_SERIES_CASES:
        q = {"lat": lat, "lon": lon}
        r = client.get(POINT_SERIES, params={"start": start, "duration_h": hours, "step_min": step, **q}).json()
        bad += [f"({lat}, {lon}) {start}: {m}" for m in series_invariants(r)
                + series_matches_state(client, None, r, state_path=POINT_STATE, extra=q)]
    for site_id in ("apollo-11", "slim"):
        bad += point_series_equals_site(client, site_id, SERIES_CASES[0][1], 72)
    ok &= not bad
    print(f"[{'PASS' if not bad else 'FAIL'}] points/series: consistent, equal to points/state (samples and edges) and "
          f"to sites/series at smooth-sphere sites ({len(POINT_SERIES_CASES)} windows)" + "".join(f"\n    {m}" for m in bad[:20]))
    rows = points_series_horizons_comparisons(client)
    worst = max(rows, key=lambda x: x["error_deg"])
    passed = worst["error_deg"] < HORIZONS_TOL_DEG
    ok &= passed
    print(f"[{'PASS' if passed else 'FAIL'}] points/series vs JPL Horizons at 11 places: {len(rows)} comparisons, "
          f"worst {worst['error_deg']:.6f} deg")
    bad, judged = terrain_reference_checks(client)
    ok &= not bad
    print(f"[{'PASS' if not bad else 'FAIL'}] terrain_reference: PGDA's sign matches our terrain masks in all "
          f"{judged} clear cases (effect >= {TERRAIN_EFFECT_MIN}), values reproduced, null north of 65 S"
          + "".join(f"\n    {m}" for m in bad))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
