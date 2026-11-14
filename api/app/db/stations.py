"""Ground-station catalogue and the Moon in the Earth-fixed frame (data/ground_stations.json, moon_itrf_*.f32).

Built by ``pipeline/lunarnav/ground_stations.py``. This layer only decodes files: the geometry is in
``app/logic/stations.py``.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from ..logic.stations import MoonEcefTable


@dataclass(frozen=True)
class Station:
    id: str
    name: str
    network: str                  # "dsn", "estrack" or "jaxa"
    agency: str
    site: str
    country: str
    lat_deg: float                # geodetic, north positive
    lon_deg: float                # east positive
    height_m: float               # above the WGS84 ellipsoid
    diameter_m: float
    dish: str
    bands: dict | None            # {"transmit": [...], "receive": [...]} when a source states them, else None
    elevation_limits: dict        # source, source_note, azimuth_step_deg, receive_deg / transmit_*_deg
    position_source: str

    @property
    def limits_are_estimated(self) -> bool:
        """True when the elevation limit is the owner's estimate and not a published figure."""
        return self.elevation_limits.get("source") != "cited"

    def limit(self, kind: str = "receive") -> tuple[float | np.ndarray | None, float | None]:
        """(limit, azimuth step) for ``receive``, ``transmit_low`` or ``transmit_high``: a number, or an array of
        degrees at azimuths 0, step, ... for a mask; None when the antenna has no such limit."""
        value = self.elevation_limits.get(f"{kind}_deg")
        step = self.elevation_limits.get("azimuth_step_deg")
        if isinstance(value, list):
            return np.asarray(value, dtype=np.float64), float(step)
        return value, None


class StationRepository:
    def __init__(self, data_dir: Path):
        doc = json.loads((data_dir / "ground_stations.json").read_text(encoding="utf-8"))
        self.meta = {k: v for k, v in doc.items() if k != "stations"}
        self._stations = [Station(
            id=s["id"], name=s["name"], network=s["network"], agency=s["agency"], site=s["site"], country=s["country"],
            lat_deg=s["lat_deg"], lon_deg=s["lon_deg"], height_m=s["height_m"], diameter_m=s["diameter_m"],
            dish=s["dish"], bands=s.get("bands"), elevation_limits=s["elevation_limits"],
            position_source=s["position_source"]) for s in doc["stations"]]
        self._by_id = {s.id: s for s in self._stations}
        mt = doc["moon_table"]
        raw = np.fromfile(data_dir / mt["file"], dtype="<f4")
        if raw.size != mt["count"] * 3:
            raise ValueError(f"{mt['file']}: expected {mt['count'] * 3} floats, got {raw.size}")
        self.moon = MoonEcefTable(start_ms=int(mt["startUnixMs"]), step_s=int(mt["stepSeconds"]),
                                  data=raw.reshape(-1, 3))

    def all(self) -> list[Station]:
        return list(self._stations)

    def get(self, station_id: str) -> Station | None:
        return self._by_id.get(station_id)

    def networks(self) -> dict[str, str]:
        """Network id -> description."""
        return dict(self.meta.get("networks", {}))

    def in_networks(self, networks: list[str]) -> list[Station]:
        """Stations of the given networks. Unknown network ids raise KeyError (the router answers 422)."""
        known = self.networks()
        for n in networks:
            if n not in known:
                raise KeyError(n)
        return [s for s in self._stations if s.network in networks]
