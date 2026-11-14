"""HTTP helpers shared by the mission-analysis routers (power, sun, earth, thermal, radiation).
No physics here: resolve the place, check the window against the tables, format times and ranges."""
from __future__ import annotations

import numpy as np
from fastapi import HTTPException

from .. import services
from ..db.store import DataStore
from ..logic.engine import SiteModel, visibility_ranges
from ..schemas.common import MAST_M, TimeRange, WindowRequest


def resolve_model(req: WindowRequest, store: DataStore) -> SiteModel:
    """Catalogue site (404 when unknown) or manual coordinates, seen from the fixed height MAST_M."""
    if req.site_id is not None:
        site = store.sites.get(req.site_id)
        if site is None:
            raise HTTPException(status_code=404, detail=f"Unknown site id {req.site_id!r}; see GET /api/v1/sites")
        return services.model_for_site(store, site, MAST_M)
    return services.model_for_point(store, req.lat, req.lon, MAST_M)


def window_ms(req: WindowRequest, store: DataStore) -> float:
    """Start of the window in Unix ms; 400 when any part of it is outside the ephemeris tables."""
    start_ms = services.to_ms(req.start)
    end_ms = start_ms + req.duration_h * 3_600_000.0
    if not (store.ephemeris.covers(start_ms) and store.ephemeris.covers(end_ms)):
        raise HTTPException(status_code=400, detail=(
            "The window is outside the ephemeris tables (2025-2035, 1969-1972 for Apollo); see GET /api/v1/meta/datasets"))
    return start_ms


def mast_used(model: SiteModel, req: WindowRequest, store: DataStore) -> float:
    return store.horizons.nearest_mast(MAST_M) if model.horizon.kind == "terrain" else MAST_M


def ranges(t_ms: np.ndarray, flags: np.ndarray) -> list[TimeRange]:
    return [TimeRange(start=services.iso_utc(a), end=services.iso_utc(b)) for a, b in visibility_ranges(t_ms, flags)]


def window_fields(req: WindowRequest, model: SiteModel, store: DataStore, start_ms: float, t_ms: np.ndarray,
                  assumptions: list[str]) -> dict:
    """The fields of ``schemas.common.WindowResponse``."""
    return dict(site_id=req.site_id, lat=model.lat, lon=model.lon, horizon_kind=model.horizon.kind,
                mast_m_used=mast_used(model, req, store), start=services.iso_utc(start_ms),
                duration_h=req.duration_h, step_min=req.step_min, assumptions=assumptions,
                t=[services.iso_utc(x) for x in t_ms])
