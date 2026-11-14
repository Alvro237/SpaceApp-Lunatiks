"""Sun and Earth at manual coordinates (SW-1): the site endpoints with lat/lon instead of a catalogue id.

    GET /api/v1/points/state?lat=-84.7906&lon=29.1957&t=2026-11-20T12:00:00Z

The horizon is always a smooth sphere (no terrain mask exists for an arbitrary point; real terrain can only
shorten light and comms). The ground height comes from the LOLA grid where it covers the point, and
``ground_source`` says so. The response builders are the site endpoints' own (routers/state.py), so a point and
a site are shaped identically. Output format: docs/sw1-output-format.md.
"""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends

from .. import services
from ..db.store import DataStore, get_store
from ..logic.engine import AnalysisParams
from ..schemas.state import StateResponse
from .params import COMMS_QUERY, DEFAULT_MAST_M, T_QUERY, LatParam, LonParam, MastParam, parse_instant_ms
from .state import state_response

router = APIRouter(prefix="/points", tags=["points"])


@router.get("/state", response_model=StateResponse,
            summary="Sun and Earth at manual coordinates and an instant (smooth-sphere horizon)")
def point_state(lat: LatParam, lon: LonParam, t: datetime = T_QUERY, mast_m: MastParam = DEFAULT_MAST_M,
                comms_min_fraction: float = COMMS_QUERY, store: DataStore = Depends(get_store)) -> StateResponse:
    t_ms = parse_instant_ms(store, t)
    model = services.model_for_point(store, lat, lon, mast_m)
    params = AnalysisParams(comms_min_fraction=comms_min_fraction)
    return state_response(store, model, t_ms, params, mast_m, None, services.point_ground_source(store, lat, lon))
