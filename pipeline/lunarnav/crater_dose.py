"""Daily dose rate measured by the LRO CRaTER dosimeter (NASA), for the radiation model.

Source: CRaTER Legacy Data Products, University of New Hampshire (LRO / CRaTER instrument team),
"CRaTER Dosimeter Daily Dose Rate, As-Measured and Corrected for Lunar Shielding", 2009-06-19 to 2013-04-30.
Columns used: dose rate as measured in lunar orbit and the value corrected for the Moon's shielding of the sky
at the spacecraft (a free-space equivalent), both in mGy in silicon per day, and the partial-day flag.
The corrected value is N/A on days dominated by solar particle events (the correction does not apply to them),
so the corrected series is galactic cosmic rays only.

Output: ``data/radiation/crater_dosimeter_daily.json`` with the arrays and a provenance block.

Run:  uv run python -m lunarnav.crater_dose   (reads data/raw/crater/table_dosimdrate.html, downloads it if missing)
"""
from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone

from .config import DATA_DIR, DATASET_DIR

URL = "https://crater-products.sr.unh.edu/data/inst/dosim/table_dosimdrate.php"
RAW = DATA_DIR / "crater" / "table_dosimdrate.html"
OUT_DIR = DATASET_DIR / "radiation"
OUT = OUT_DIR / "crater_dosimeter_daily.json"

ROW = re.compile(r"<tr>\s*<td>\s*(\d{4}-\d{2}-\d{2})\s*</td>\s*<td>\s*\d{7}\s*</td>\s*<td>([^<]*)</td>\s*<td>([^<]*)</td>"
                 r"\s*<td>[^<]*</td>\s*<td>[^<]*</td>\s*<td>\s*([01])\s*</td>")


def _ensure_raw() -> bytes:
    if not RAW.exists():
        import requests          # pipeline dependency; the parse below needs only the standard library
        RAW.parent.mkdir(parents=True, exist_ok=True)
        r = requests.get(URL, timeout=120)
        r.raise_for_status()
        RAW.write_bytes(r.content)
    return RAW.read_bytes()


def _num(s: str) -> float | None:
    """Missing values appear as empty, 'N/A' or a run of dashes."""
    s = s.strip()
    try:
        return float(s)
    except ValueError:
        return None


def parse(html: str) -> dict:
    rows = sorted(ROW.findall(html))                    # the page lists newest first
    if not rows:
        raise ValueError("no data rows found: the page layout changed")
    return {"date": [r[0] for r in rows],
            "measured_mgy_si_per_day": [_num(r[1]) for r in rows],
            "corrected_mgy_si_per_day": [_num(r[2]) for r in rows],
            "partial_day": [r[3] == "1" for r in rows]}


def build() -> dict:
    raw = _ensure_raw()
    data = parse(raw.decode("utf-8", errors="replace"))
    meta = {
        "format": 1, "id": "crater-dosimeter-daily",
        "name": "LRO CRaTER dosimeter daily dose rate, as measured and corrected for lunar shielding",
        "agency": "NASA LRO / CRaTER team, University of New Hampshire", "url": URL, "nasaData": True,
        "units": "mGy in silicon per day", "count": len(data["date"]),
        "first": data["date"][0], "last": data["date"][-1],
        "correctedMissing": sum(v is None for v in data["corrected_mgy_si_per_day"]),
        "partialDays": sum(data["partial_day"]),
        "sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw),
        "transformation": "HTML table parsed into arrays sorted by date; values unchanged",
        "caveats": [
            "Measured in lunar orbit (about 50 km, higher in 2009); 'corrected' removes the Moon's shielding "
            "of the sky at the spacecraft and is a free-space equivalent.",
            "Corrected is N/A on solar-particle-event days: the corrected series is galactic cosmic rays only.",
            "Dose in silicon, not in water or tissue; no quality factor applied.",
            "Covers 2009-06 to 2013-04 only (solar minimum to the maximum of cycle 24).",
        ],
        "builtUtc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"meta": meta, **data}, separators=(",", ":")), encoding="utf-8")
    return meta


if __name__ == "__main__":
    print(json.dumps(build(), indent=1))
