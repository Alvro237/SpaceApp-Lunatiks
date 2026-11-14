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


def series_matches_state(client, site_id: str, r: dict, every: int = 97) -> list[str]:
    """Samples equal the state endpoint at the same instant, and every inner range edge flips state's flag
    between 2 s before and the edge itself (edges are refined to ~1 s)."""
    bad = []
    params = {"mast_m": r["mast_m"], "comms_min_fraction": r["comms_min_fraction"]}
    for i in range(0, r["samples"], every):
        st = client.get(STATE.format(site_id=site_id), params={"t": r["t"][i], **params}).json()
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
                now = client.get(STATE.format(site_id=site_id), params={"t": _iso(at), **params}).json()[body]["visible"]
                before = client.get(STATE.format(site_id=site_id),
                                    params={"t": _iso(at - timedelta(seconds=2)), **params}).json()[body]["visible"]
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
    if r["horizon_kind"] == "terrain":
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
    print(f"[{'PASS' if not fails else 'FAIL'}] horizon vs NASA PGDA product 69 (2025-2035 engine over the served "
          f"masks): Sun {n_sun}/{len(rows) // 2}, Earth {n_earth}/{len(rows) // 2} inside the zone range +/-{PGDA_TOL}"
          + "".join(f"\n    {x['site']} {x['kind']}: PGDA {x['pgda']:.3f} vs zone [{x['lo']:.3f}, {x['hi']:.3f}]"
                    for x in fails))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
