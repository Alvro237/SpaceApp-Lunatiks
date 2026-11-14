"""Site catalogue (data/sites.json): landing sites and south-polar features with cited coordinates."""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Site:
    id: str
    name: str
    group: str
    kind: str
    lat: float            # planetocentric, degrees, MOON_ME
    lon: float            # east-positive, -180..180
    region: str | None
    landing_utc: str | None
    source: dict          # {label, url, note}: where the coordinates come from
    terrain: dict         # raw terrain block of sites.json (camelCase keys, see data/README.md)
    raw: dict             # the whole record as stored

    @property
    def has_terrain(self) -> bool:
        return bool(self.terrain.get("available")) and "horizonOffset" in self.terrain

    @property
    def ground_m(self) -> float:
        """Ground height above the 1737.4 km sphere; 0 where no terrain data was read."""
        return float(self.terrain.get("groundHeightM", 0.0)) if self.has_terrain else 0.0

    @property
    def slope_deg(self) -> float | None:
        return self.terrain.get("slopeDeg") if self.has_terrain else None


class SiteRepository:
    def __init__(self, data_dir: Path):
        doc = json.loads((data_dir / "sites.json").read_text(encoding="utf-8"))
        self.azimuth_count: int = doc["azimuthCount"]
        self.masts_m: list[float] = [float(m) for m in doc["mastsM"]]
        self.max_range_m: float = doc["maxRangeM"]
        self._sites = [
            Site(id=r["id"], name=r["name"], group=r["group"], kind=r["kind"], lat=float(r["lat"]),
                 lon=float(r["lon"]), region=r.get("region"), landing_utc=r.get("landingUtc"),
                 source=r["source"], terrain=r.get("terrain", {}), raw=r)
            for r in doc["sites"]
        ]
        self._by_id = {s.id: s for s in self._sites}

    def all(self) -> list[Site]:
        return list(self._sites)

    def get(self, site_id: str) -> Site | None:
        return self._by_id.get(site_id)

    def groups(self) -> list[str]:
        return list(dict.fromkeys(s.group for s in self._sites))
