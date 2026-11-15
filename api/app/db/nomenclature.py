"""IAU lunar feature names (data/external/nomenclature/moon_nomenclature.csv, USGS Gazetteer of Planetary
Nomenclature): name, centre (lat, lon east -180..180), diameter km and feature type. Loaded lazily on first use.
Reads and decodes only; distances and bearings are logic's."""
from __future__ import annotations

import csv
from pathlib import Path

import numpy as np

NOMENCLATURE_CSV = Path("external") / "nomenclature" / "moon_nomenclature.csv"


class NomenclatureRepository:
    def __init__(self, data_dir: Path):
        self._path = Path(data_dir) / NOMENCLATURE_CSV
        self._arrays: dict[str, np.ndarray] | None = None

    @property
    def available(self) -> bool:
        return self._path.exists()

    def arrays(self) -> dict[str, np.ndarray]:
        """name, clean_name (object arrays), lat, lon (-180..180), diameter_km (NaN when blank), type (object)."""
        if self._arrays is None:
            rows = []
            if self.available:
                with self._path.open(encoding="utf-8", newline="") as fh:
                    rows = list(csv.DictReader(fh))

            def num(v: str) -> float:
                try:
                    return float(v)
                except (TypeError, ValueError):
                    return float("nan")

            lon = np.array([num(r["center_lon"]) for r in rows])
            self._arrays = {
                "name": np.array([r["name"] for r in rows], dtype=object),
                "clean_name": np.array([r.get("clean_name") or r["name"] for r in rows], dtype=object),
                "lat": np.array([num(r["center_lat"]) for r in rows]),
                "lon": ((lon + 180.0) % 360.0) - 180.0,
                "diameter_km": np.array([num(r.get("diameter", "")) for r in rows]),
                "type": np.array([r.get("type", "") for r in rows], dtype=object),
            }
        return self._arrays

    def find(self, name: str) -> tuple[str, float, float] | None:
        """(IAU name, lat, lon) of the feature whose name or clean name equals ``name`` (case-insensitive)."""
        a = self.arrays()
        key = name.strip().casefold()
        for i, (n, c) in enumerate(zip(a["name"], a["clean_name"])):
            if n.casefold() == key or c.casefold() == key:
                return str(n), float(a["lat"][i]), float(a["lon"][i])
        return None

    def search(self, query: str, south_of: float, limit: int) -> list[int]:
        """Indices of features south of ``south_of`` whose name or clean name contains ``query`` (case-insensitive),
        names starting with the query first, then by diameter, largest first."""
        a = self.arrays()
        q = query.strip().casefold()
        hits = [i for i in np.flatnonzero(a["lat"] < south_of)
                if not q or q in a["name"][i].casefold() or q in a["clean_name"][i].casefold()]
        d = a["diameter_km"]
        hits.sort(key=lambda i: (not a["clean_name"][i].casefold().startswith(q), -(0.0 if np.isnan(d[i]) else d[i]), a["name"][i]))
        return [int(i) for i in hits[:limit]]
