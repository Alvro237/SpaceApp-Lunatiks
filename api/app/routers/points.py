"""Sun and Earth at manual coordinates (SW-1): the site endpoints with lat/lon instead of a catalogue id.

    GET /api/v1/points/state?lat=-84.7906&lon=29.1957&t=2026-11-20T12:00:00Z
    GET /api/v1/points/series?lat=-84.7906&lon=29.1957&start=2026-11-20T12:00:00Z&duration_h=336

The horizon is always a smooth sphere (no terrain mask exists for an arbitrary point; real terrain can only
shorten light and comms). The ground height comes from the LOLA grid where it covers the point, and
``ground_source`` says so. The response builders are the site endpoints' own (routers/state.py), so a point and
a site are shaped identically. A smooth sphere is an estimate, not a bound, so both responses add
``terrain_reference``: NASA's terrain-aware long-term values at the point against the smooth sphere's.
Output format: docs/sw1-output-format.md.
"""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends

from .. import services
from ..db.store import DataStore, get_store
from ..logic.engine import AnalysisParams
from ..schemas.points import LongTermComparison, PointSeriesResponse, PointStateResponse, TerrainReference
from .params import (COMMS_QUERY, DEFAULT_MAST_M, DURATION_QUERY, STEP_QUERY, START_QUERY, T_QUERY, LatParam,
                     LonParam, MastParam, parse_instant_ms, parse_window_ms)
from .state import series_response, state_response

router = APIRouter(prefix="/points", tags=["points"])


def terrain_reference(store: DataStore, lat: float, lon: float, mast_m: float) -> TerrainReference | None:
    ref = services.pgda_long_term(store, lat, lon)
    if ref is None:
        return None
    smooth = services.smooth_sphere_long_term(store, lat, lon, mast_m)

    def cmp(a: float, b: float) -> LongTermComparison:
        return LongTermComparison(pgda=a, smooth_sphere=b, difference=a - b)

    return TerrainReference(source=services.PGDA_PRODUCT, smooth_sphere_period=services.period_label(),
                            sun_mean_visible_fraction=cmp(ref.sun_mean_visible_fraction,
                                                          smooth.sun_mean_visible_fraction),
                            earth_any_visible_fraction=cmp(ref.earth_any_visible_fraction,
                                                           smooth.earth_any_visible_fraction))


@router.get("/state", response_model=PointStateResponse,
            summary="Sun and Earth at manual coordinates and an instant (smooth-sphere horizon)")
def point_state(lat: LatParam, lon: LonParam, t: datetime = T_QUERY, mast_m: MastParam = DEFAULT_MAST_M,
                comms_min_fraction: float = COMMS_QUERY, store: DataStore = Depends(get_store)) -> PointStateResponse:
    t_ms = parse_instant_ms(store, t)
    model = services.model_for_point(store, lat, lon, mast_m)
    params = AnalysisParams(comms_min_fraction=comms_min_fraction)
    r = state_response(store, model, t_ms, params, mast_m, None, services.point_ground_source(store, lat, lon))
    return PointStateResponse(**r.model_dump(), terrain_reference=terrain_reference(store, lat, lon, mast_m))


@router.get("/series", response_model=PointSeriesResponse,
            summary="Sun and Earth over a mission window at manual coordinates (smooth-sphere horizon)")
def point_series(lat: LatParam, lon: LonParam, start: datetime = START_QUERY, duration_h: float = DURATION_QUERY,
                 step_min: float = STEP_QUERY, mast_m: MastParam = DEFAULT_MAST_M,
                 comms_min_fraction: float = COMMS_QUERY, store: DataStore = Depends(get_store)) -> PointSeriesResponse:
    start_ms = parse_window_ms(store, start, duration_h, step_min)
    model = services.model_for_point(store, lat, lon, mast_m)
    params = AnalysisParams(comms_min_fraction=comms_min_fraction)
    r = series_response(store, model, start_ms, duration_h, step_min, params, mast_m, None,
                        services.point_ground_source(store, lat, lon))
    return PointSeriesResponse(**r.model_dump(), terrain_reference=terrain_reference(store, lat, lon, mast_m))
