"""LRO CRaTER dosimeter daily dose rates (data/radiation/crater_dosimeter_daily.json), 2009-06 to 2013-04.
Decodes the file into arrays; no physics. NaN marks a missing value."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np


class RadiationRepository:
    def __init__(self, data_dir: Path):
        path = data_dir / "radiation" / "crater_dosimeter_daily.json"
        raw = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
        self.meta: dict = raw.get("meta", {})
        self.dates: list[str] = raw.get("date", [])
        f = lambda k: np.array([np.nan if v is None else v for v in raw.get(k, [])], dtype=np.float64)  # noqa: E731
        self.measured = f("measured_mgy_si_per_day")       # in lunar orbit, as measured (includes SPE days)
        self.corrected = f("corrected_mgy_si_per_day")     # free-space equivalent, GCR only (NaN on SPE days)
        self.partial_day = np.array(raw.get("partial_day", []), dtype=bool)

    @property
    def available(self) -> bool:
        return bool(self.meta)

    def gcr_free_space_mean(self) -> float | None:
        """Mean of the full-day corrected (GCR, free-space) dose rate, mGy(Si)/day."""
        if not self.available:
            return None
        ok = np.isfinite(self.corrected) & ~self.partial_day
        return float(self.corrected[ok].mean())
