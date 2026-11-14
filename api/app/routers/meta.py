"""Health and dataset provenance. The frontend's "Data & validation" page reads /meta/datasets."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from .. import config
from ..services import iso_utc as _iso
from ..db.store import DataStore, get_store
from ..logic.constraints import REGISTRY
from ..logic.scoring import DEFAULT_WEIGHTS

health_router = APIRouter(tags=["meta"])
router = APIRouter(prefix="/meta", tags=["meta"])


@health_router.get("/health", summary="Liveness and what data is loaded")
def health(store: DataStore = Depends(get_store)) -> dict:
    return {
        "status": "ok",
        "version": config.API_VERSION,
        "sites": len(store.sites.all()),
        "ephemeris_coverage_utc": [[_iso(a), _iso(b)] for a, b in store.ephemeris.coverage()],
        "grids": store.grids.ids(),
        "craters": store.craters.meta.get("count", 0),
        "constraints": sorted(REGISTRY),
    }


@router.get("/datasets", summary="Provenance of every dataset the API serves")
def datasets(store: DataStore = Depends(get_store)) -> dict:
    return {
        "frame": store.ephemeris_index.get("frame"),
        "correction": store.ephemeris_index.get("correction"),
        "ephemeris": {"segments": [{k: s[k] for k in ("id", "startUtc", "stepSeconds", "count")}
                                   for s in store.ephemeris_index.get("segments", [])],
                      "kernels": store.ephemeris_index.get("kernels", {})},
        "catalogue_and_terrain": store.provenance,
        "grids": store.grids.index,
        "craters": store.craters.meta,
        "validation": store.validation,
    }


@router.get("/constraints", summary="Hard filters and soft-score weights currently implemented")
def constraints() -> dict:
    return {
        "hard_filters": {cid: (fn.__doc__ or "").strip() for cid, fn in sorted(REGISTRY.items())},
        "soft_score_default_weights": DEFAULT_WEIGHTS,
    }
