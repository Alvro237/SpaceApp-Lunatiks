"""Fetch NASA's Apollo Lunar Surface Journal Sun/Earth altitude-azimuth tables and store them as a
fixture. Independent historical reference (computed in the 1970s from Nautical Almanac lunar
ephemeris data), used to validate our modern DE440-based numbers at real mission events.

Run once (needs network): ``uv run python -m lunarnav.make_fixtures_apollo``.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone

import requests

from .config import FIXTURE_DIR

URL = "https://www.nasa.gov/wp-content/uploads/static/history/alsj/Scotti_AltAz.txt"
MONTHS = {m: i for i, m in enumerate(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], start=1)}
HEADER = re.compile(r"^\s*Apollo\s+(\d+)\s+\(\s*([+-]?[\d.]+),\s*([+-]?[\d.]+)\)")
NUMBER = re.compile(r"[+-]?\d+\.\d+")


def parse(text: str) -> list[dict]:
    missions: list[dict] = []
    current: dict | None = None
    year = month = day = None
    for raw in text.splitlines():
        line = raw.rstrip()
        h = HEADER.match(line)
        if h:
            current = {"apollo": int(h.group(1)), "lon": float(h.group(2)), "lat": float(h.group(3)), "events": []}
            missions.append(current)
            year = month = day = None
            continue
        if current is None:
            continue
        t = re.search(r"\b(\d\d):(\d\d):(\d\d)\b", line)
        if not t:
            continue
        prefix = line[: t.start()].split()
        rest = line[t.end():]
        nums = NUMBER.findall(rest)
        if len(nums) < 8:
            continue
        vals = [float(n) for n in nums[-8:]]
        # prefix tokens: label words, then optional year / month / day
        while prefix and re.fullmatch(r"\d{4}", prefix[-1]) is None and re.fullmatch(r"\d{1,2}", prefix[-1]):
            day = int(prefix.pop())
        if prefix and prefix[-1] in MONTHS:
            month = MONTHS[prefix.pop()]
        if prefix and re.fullmatch(r"\d{4}", prefix[-1]):
            year = int(prefix.pop())
        # the pops above run right-to-left, so a bare "21" (day only) was consumed first; a
        # "1969 Jul 20" prefix is consumed day -> month -> year in the right order.
        label = " ".join(prefix) or "event"
        if year is None or month is None or day is None:
            raise ValueError(f"cannot resolve date for line: {line!r}")
        when = datetime(year, month, day, int(t.group(1)), int(t.group(2)), int(t.group(3)), tzinfo=timezone.utc)
        e_lon, e_lat, e_alt, e_az, s_lon, s_lat, s_alt, s_az = vals
        current["events"].append({
            "label": label,
            "utc": when.isoformat().replace("+00:00", "Z"),
            "earth": {"alt": e_alt, "az": e_az},
            "sun": {"alt": s_alt, "az": s_az},
        })
    return missions


def main() -> None:
    resp = requests.get(URL, timeout=60, headers={"User-Agent": "lunar-landing-site-navigator-validation/0.1"})
    resp.raise_for_status()
    missions = parse(resp.text)
    FIXTURE_DIR.mkdir(parents=True, exist_ok=True)
    out = FIXTURE_DIR / "alsj_apollo_reference.json"
    out.write_text(json.dumps({
        "source": URL,
        "description": "Apollo Lunar Surface Journal (NASA): Earth and Sun altitude/azimuth at each Apollo "
                       "landing site, derived from Nautical Almanac lunar ephemeris data (Scotti). Site "
                       "coordinates are the ones the table itself was computed for (header of each block).",
        "retrieved_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "missions": missions,
    }, indent=1))
    n = sum(len(m["events"]) for m in missions)
    print(f"wrote {out} ({len(missions)} missions, {n} events)")
    for m in missions:
        print(" Apollo", m["apollo"], m["lon"], m["lat"], [e["label"] + " " + e["utc"][:16] for e in m["events"]][:3], "...")


if __name__ == "__main__":
    main()
