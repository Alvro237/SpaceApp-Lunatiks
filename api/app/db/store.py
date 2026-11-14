"""The single entry point to the datasets. Routers get it with ``Depends(get_store)``.

Rule of the layer: ``app/db`` reads files and returns arrays or plain objects; it does no physics.
``app/logic`` does the physics and never opens a file. Swapping a file for a real database later
only touches this package.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from .. import config
from ..logic.ephemeris import EphemerisTable
from .craters import CraterRepository
from .ephemeris import load_ephemeris
from .grids import GridRepository
from .horizons import HorizonRepository
from .radiation import RadiationRepository
from .sites import SiteRepository
from .stations import StationRepository


@dataclass(frozen=True)
class DataStore:
    data_dir: Path
    sites: SiteRepository
    ephemeris: EphemerisTable
    ephemeris_index: dict        # frame, correction, kernels (provenance)
    horizons: HorizonRepository
    grids: GridRepository
    craters: CraterRepository
    provenance: dict
    validation: dict
    radiation: RadiationRepository | None = None   # LRO CRaTER daily dose (MECH)
    stations: StationRepository | None = None      # ground stations and the Moon in the Earth-fixed frame (AERO-2)


def _json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def load_store(data_dir: Path) -> DataStore:
    sites = SiteRepository(data_dir)
    ephemeris, index = load_ephemeris(data_dir)
    return DataStore(data_dir=data_dir, sites=sites, ephemeris=ephemeris, ephemeris_index=index,
                     horizons=HorizonRepository(data_dir, sites), grids=GridRepository(data_dir),
                     craters=CraterRepository(data_dir), provenance=_json(data_dir / "provenance.json"),
                     validation=_json(data_dir / "validation.json"), radiation=RadiationRepository(data_dir),
                     stations=StationRepository(data_dir) if (data_dir / "ground_stations.json").exists() else None)


@lru_cache(maxsize=1)
def get_store() -> DataStore:
    """Loaded once per process (a few megabytes; grids and craters load lazily on first use)."""
    return load_store(config.DATA_DIR)
