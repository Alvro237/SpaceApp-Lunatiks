"""Robbins (2018) lunar crater catalogue (data/craters/robbins_2018.npz): 1.3 million craters,
complete above about 1-2 km. Crater density only: it knows nothing about boulders."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from ..logic.constants import MOON_R_KM
from ..logic.projection import great_circle_km


class CraterRepository:
    def __init__(self, data_dir: Path):
        self._dir = data_dir / "craters"
        meta_path = self._dir / "craters.json"
        self.meta: dict = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
        self._data: dict[str, np.ndarray] | None = None

    @property
    def available(self) -> bool:
        return bool(self.meta)

    def _load(self) -> dict[str, np.ndarray]:
        if self._data is None:   # ~15 MB in memory, loaded on first use
            with np.load(self._dir / self.meta["file"]) as z:
                self._data = {k: z[k] for k in ("lat", "lon", "diam_km")}
        return self._data

    def within(self, lat: float, lon: float, radius_km: float, min_diam_km: float = 0.0) -> dict[str, np.ndarray]:
        """Craters whose centre lies within ``radius_km`` (great circle) of the point."""
        d = self._load()
        band = np.degrees(radius_km / MOON_R_KM)
        a = np.searchsorted(d["lat"], lat - band, side="left")     # arrays are sorted by latitude
        b = np.searchsorted(d["lat"], lat + band, side="right")
        la, lo, di = d["lat"][a:b], d["lon"][a:b], d["diam_km"][a:b]
        dist = great_circle_km(lat, lon, la.astype(np.float64), lo.astype(np.float64))
        keep = (dist <= radius_km) & (di >= min_diam_km)
        return {"lat": la[keep], "lon": lo[keep], "diam_km": di[keep], "dist_km": dist[keep]}

    def density_per_km2(self, lat: float, lon: float, radius_km: float = 10.0, min_diam_km: float = 1.0) -> float:
        """Craters per square kilometre inside a spherical cap of ``radius_km`` around the point."""
        n = self.within(lat, lon, radius_km, min_diam_km)["lat"].size
        area = 2.0 * np.pi * MOON_R_KM ** 2 * (1.0 - np.cos(radius_km / MOON_R_KM))
        return float(n / area)
