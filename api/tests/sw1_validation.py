"""Validation system for the SW-1 endpoints (state, series, horizon, points).

Three layers of checks, all through the HTTP layer so they test exactly what the frontend receives:

1. **External reference**: Sun and Earth az/el against JPL Horizons (tests/fixtures/horizons_reference.json)
   for the catalogue site whose coordinates match a fixture case (IM-1), tolerance 0.01 degrees.
2. **Physical invariants** on every response: ranges, disc sizes, irradiance from the Sun distance, power from
   irradiance x fraction x panel factor, visible fraction consistent with el - horizon_el, consistent flags.
3. **Self-consistency of events**: a reported sunset/Earthset really flips the state one minute either side.
4. **Eclipses** against NASA's lunar eclipse catalogue (tests/fixtures/nasa_lunar_eclipses_2025_2035.json):
   at greatest eclipse of every total lunar eclipse the Sun is fully hidden and the power is zero.

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
SOLAR_CONSTANT = 1361.0
SUN_R_KM, EARTH_R_KM = 695_700.0, 6_378.137
# Catalogue sites with exactly the coordinates of a Horizons fixture case (the fixture is at 0 km height;
# the site's ground height shifts the Earth by at most ~0.0004 degrees, well inside the tolerance).
SITE_FOR_CASE = {"IM-1 area": "im-1"}


def sky_error_deg(az1, el1, az2, el2) -> float:
    """Angular distance on the sky between two (az, el) directions, degrees."""
    a1, e1, a2, e2 = map(math.radians, (az1, el1, az2, el2))
    c = math.sin(e1) * math.sin(e2) + math.cos(e1) * math.cos(e2) * math.cos(a1 - a2)
    return math.degrees(math.acos(max(-1.0, min(1.0, c))))


def _panel_factor(panel: str, el: float) -> float:
    if panel == "tracking":
        return 1.0
    if panel == "vertical":
        return math.cos(math.radians(el))
    return max(0.0, math.sin(math.radians(el)))


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
    irr = SOLAR_CONSTANT * (AU_KM / sun["distance_km"]) ** 2
    need(abs(r["irradiance_w_m2"] - irr) < 0.01, f"irradiance {r['irradiance_w_m2']} vs 1361/r_AU^2 = {irr}")
    ecl = r["sun_eclipsed_fraction"]
    need(0.0 <= ecl <= 1.0, "sun_eclipsed_fraction outside 0..1")
    need((r["eclipse"] == "none") == (ecl == 0.0), f"eclipse {r['eclipse']} vs eclipsed fraction {ecl}")
    need((r["eclipse"] == "total") == (ecl == 1.0), f"eclipse {r['eclipse']} vs eclipsed fraction {ecl}")
    power = r["irradiance_w_m2"] * sun["visible_fraction"] * (1.0 - ecl) * _panel_factor(r["panel"], sun["el"])
    need(abs(r["power_w_m2"] - power) < 1e-6,
         f"power {r['power_w_m2']} vs irradiance x fraction x (1 - eclipsed) x panel {power}")
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


def horizons_comparisons(client, path: str = "/api/v1/sites/{site_id}/state") -> list[dict]:
    """Every fixture sample for the matching catalogue sites, through HTTP: one row per body."""
    rows = []
    for case in json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]:
        site_id = SITE_FOR_CASE.get(case["name"])
        if site_id is None:
            continue
        for sample in case["samples"]:
            r = client.get(path.format(site_id=site_id), params={"t": sample["utc"]})
            if r.status_code == 400:      # outside the tables
                continue
            r.raise_for_status()
            body = r.json()
            for name in ("sun", "earth"):
                rows.append({"case": case["name"], "utc": sample["utc"], "body": name,
                             "error_deg": sky_error_deg(body[name]["az"], body[name]["el"],
                                                        sample[name]["az"], sample[name]["el"])})
    return rows


def transition_flips(client, path: str, t: str, body: str, extra: dict | None = None) -> list[str]:
    """The reported next transition really changes the state: same as now 60 s before, opposite 60 s after."""
    params = {"t": t, **(extra or {})}
    now = client.get(path, params=params).json()
    tr = now[f"next_{body}_transition"]
    if tr is None:
        return []
    at = _parse(tr["at"])
    before = client.get(path, params={**params, "t": _iso(at - timedelta(seconds=60))}).json()[body]["visible"]
    after = client.get(path, params={**params, "t": _iso(at + timedelta(seconds=60))}).json()[body]["visible"]
    bad = []
    if before != now[body]["visible"]:
        bad.append(f"{body} {tr['kind']} at {tr['at']}: state already changed 60 s before")
    if after == now[body]["visible"]:
        bad.append(f"{body} {tr['kind']} at {tr['at']}: state not changed 60 s after")
    return bad


SWEEP_TIMES = ["2026-11-20T12:00:00Z", "2027-03-01T00:00:00Z", "2028-06-15T06:30:00Z", "2030-01-01T18:00:00Z"]


def sweep_invariants(client) -> list[str]:
    """state_invariants on every catalogue site x SWEEP_TIMES x the three panel models."""
    bad = []
    for site in client.get("/api/v1/sites").json()["sites"]:
        for t in SWEEP_TIMES:
            for panel in ("tracking", "vertical", "horizontal"):
                r = client.get(f"/api/v1/sites/{site['id']}/state", params={"t": t, "panel": panel})
                bad += [f"{site['id']} {t} {panel}: {m}" for m in state_invariants(r.json())]
    return bad


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
    print(f"[{'PASS' if not bad else 'FAIL'}] physical invariants on every site x {len(SWEEP_TIMES)} dates x 3 panels"
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
        if not (r["eclipse"] == "total" and r["power_w_m2"] == 0.0):
            bad.append(f"{e['greatest_td']}: eclipse={r['eclipse']} power={r['power_w_m2']:.1f}")
    ok &= not bad
    print(f"[{'PASS' if not bad else 'FAIL'}] {len(totals)} NASA total lunar eclipses 2025-2035: Sun hidden, power 0"
          + "".join(f"\n    {m}" for m in bad))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
