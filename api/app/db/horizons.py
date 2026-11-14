"""Terrain horizon masks (data/horizons.i16, data/zones.i16) computed by the pipeline from LOLA.

horizons.i16: int16 hundredths of a degree, layout [terrainSite][mast][azimuth].
zones.i16:    same unit, layout [terrainSite][zonePoint][azimuth], 2 m mast: the site centre plus
              rings of neighbours, used to show how much a few hundred metres change the answer.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np

from ..logic.horizon import HorizonProfile, decode_centideg, flat_profile, spherical_horizon_deg
from .sites import Site, SiteRepository


class HorizonRepository:
    def __init__(self, data_dir: Path, sites: SiteRepository):
        self._n = sites.azimuth_count
        self._masts = sites.masts_m
        self._horizons = np.fromfile(data_dir / "horizons.i16", dtype="<i2")
        self._zones = np.fromfile(data_dir / "zones.i16", dtype="<i2")

    @property
    def masts_m(self) -> list[float]:
        """Mast heights for which terrain masks exist."""
        return list(self._masts)

    def nearest_mast(self, mast_m: float) -> float:
        return min(self._masts, key=lambda m: abs(m - mast_m))

    def for_site(self, site: Site, mast_m: float) -> HorizonProfile:
        """Terrain mask for the nearest stored mast height, or the smooth-sphere dip when the site
        has no terrain data. ``profile.kind`` tells which one you got."""
        if not site.has_terrain:
            return flat_profile(spherical_horizon_deg(mast_m), self._n)
        mi = self._masts.index(self.nearest_mast(mast_m))
        start = (site.terrain["horizonOffset"] * len(self._masts) + mi) * self._n
        return HorizonProfile(decode_centideg(self._horizons[start:start + self._n]), kind="terrain")

    def for_point(self, mast_m: float, ground_m: float = 0.0) -> HorizonProfile:
        """A point typed in by the user: no terrain mask exists, smooth-sphere horizon."""
        return flat_profile(spherical_horizon_deg(mast_m, ground_m), self._n)

    def zone(self, site: Site) -> list[tuple[dict, HorizonProfile]]:
        """(zone point, horizon mask) pairs around a terrain site; empty when there is none."""
        zone = site.terrain.get("zone")
        if not site.has_terrain or not zone or "zoneOffset" not in site.terrain:
            return []
        points = zone["points"]
        out = []
        for k, point in enumerate(points):
            start = (site.terrain["zoneOffset"] * len(points) + k) * self._n
            out.append((point, HorizonProfile(decode_centideg(self._zones[start:start + self._n]), kind="terrain")))
        return out
