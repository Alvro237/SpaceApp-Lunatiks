"""Validation system for the SW-1 endpoints (state, series, horizon, points).

Three layers of checks, all through the HTTP layer so they test exactly what the frontend receives:

1. **External reference**: Sun and Earth az/el against JPL Horizons (tests/fixtures/horizons_reference.json)
   for the catalogue site whose coordinates match a fixture case (IM-1), tolerance 0.01 degrees.
2. **Physical invariants** on every response: ranges, distances, disc sizes from distance, visible fraction
   consistent with el - horizon_el, eclipse state consistent with the eclipsed share, consistent flags.
3. **Self-consistency of events**: a reported sunset/Earthset really flips the state one minute either side.
4. **Eclipses** against NASA's lunar eclipse catalogue (tests/fixtures/nasa_lunar_eclipses_2025_2035.json):
   at greatest eclipse of every total lunar eclipse the Sun is fully hidden behind the Earth.

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
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
