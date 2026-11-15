"""Past landing points (NASA NSSDCA lunar artifact list, data/external/sites/landing_sites.csv).

Only rows whose coordinates are a measured landing point are used (coord_quality == measured_landing_point);
impact craters estimated from a nearby feature are left out.
"""
from __future__ import annotations

import csv
from functools import lru_cache
from pathlib import Path

LANDINGS_CSV = Path("external") / "sites" / "landing_sites.csv"


@lru_cache(maxsize=4)
def measured_landings(data_dir: Path) -> tuple[tuple[str, float, float], ...]:
    """(name, lat, lon east -180..180) of every measured landing point; empty when the file is missing."""
    path = Path(data_dir) / LANDINGS_CSV
    if not path.exists():
        return ()
    with path.open(encoding="utf-8", newline="") as fh:
        return tuple((r["name"], float(r["lat"]), float(r["lon_pm180"])) for r in csv.DictReader(fh)
                     if r.get("coord_quality") == "measured_landing_point")
