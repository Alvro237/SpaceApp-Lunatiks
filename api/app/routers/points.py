"""Sun and Earth at manual coordinates (SW-1): the site endpoints with lat/lon instead of a catalogue id.

    GET /api/v1/points/state?lat=-84.7906&lon=29.1957&t=2026-11-20T12:00:00Z
    GET /api/v1/points/series?lat=-84.7906&lon=29.1957&start=2026-11-20T12:00:00Z&duration_h=336

    GET /api/v1/points/horizon?lat=-85.5&lon=10&mast_m=2

State and series use the smooth sphere by default (the contract they were validated on) and the skyline
ray-traced over the LOLA elevation grids with ``horizon=terrain`` (south of about 60 S; services.point_horizon,
logic.horizon.ray_traced_horizon); /points/horizon returns that skyline. ``horizon_kind`` always says which. The ground height comes from the same grids, and ``ground_source`` says so. The response builders are the site endpoints' own (routers/state.py), so a point and
a site are shaped identically. A smooth sphere is an estimate, not a bound, so both responses add
``terrain_reference``: NASA's terrain-aware long-term values at the point against the smooth sphere's.
Output format: docs/sw1-output-format.md.
"""
from __future__ import annotations

from datetime import datetime

import numpy as np
from typing import Literal

from fastapi import APIRouter, Depends, Query

from .. import services
from ..db.store import DataStore, get_store
from ..logic.engine import AnalysisParams
from ..schemas.points import LongTermComparison, PointHorizonResponse, PointSeriesResponse, PointStateResponse, TerrainReference
from .params import (COMMS_QUERY, DEFAULT_MAST_M, DURATION_QUERY, STEP_QUERY, START_QUERY, T_QUERY, LatParam,
                     LonParam, MastParam, parse_instant_ms, parse_window_ms)
from .horizon import planes_fields
from .state import series_response, state_response

router = APIRouter(prefix="/points", tags=["points"])

HORIZON_QUERY = Query("smooth_sphere", description=(
    "'terrain': skyline ray-traced over the LOLA elevation grids where they cover the point (south of about 60 S; "
    "see /points/horizon); 'smooth_sphere' (default): geometric dip"))


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
            summary="Sun and Earth at manual coordinates and an instant (smooth sphere, or traced terrain on request)")
def point_state(lat: LatParam, lon: LonParam, t: datetime = T_QUERY, mast_m: MastParam = DEFAULT_MAST_M,
                comms_min_fraction: float = COMMS_QUERY, horizon: Literal["smooth_sphere", "terrain"] = HORIZON_QUERY,
                store: DataStore = Depends(get_store)) -> PointStateResponse:
    t_ms = parse_instant_ms(store, t)
    model = services.model_for_point(store, lat, lon, mast_m, horizon=horizon)
    params = AnalysisParams(comms_min_fraction=comms_min_fraction)
    r = state_response(store, model, t_ms, params, mast_m, None, services.point_ground_source(store, lat, lon))
    return PointStateResponse(**r.model_dump(), terrain_reference=terrain_reference(store, lat, lon, mast_m))


@router.get("/series", response_model=PointSeriesResponse,
            summary="Sun and Earth over a mission window at manual coordinates (smooth sphere, or traced terrain on request)")
def point_series(lat: LatParam, lon: LonParam, start: datetime = START_QUERY, duration_h: float = DURATION_QUERY,
                 step_min: float = STEP_QUERY, mast_m: MastParam = DEFAULT_MAST_M,
                 comms_min_fraction: float = COMMS_QUERY, horizon: Literal["smooth_sphere", "terrain"] = HORIZON_QUERY,
                 store: DataStore = Depends(get_store)) -> PointSeriesResponse:
    start_ms = parse_window_ms(store, start, duration_h, step_min)
    model = services.model_for_point(store, lat, lon, mast_m, horizon=horizon)
    params = AnalysisParams(comms_min_fraction=comms_min_fraction)
    r = series_response(store, model, start_ms, duration_h, step_min, params, mast_m, None,
                        services.point_ground_source(store, lat, lon))
    return PointSeriesResponse(**r.model_dump(), terrain_reference=terrain_reference(store, lat, lon, mast_m))


METHOD = ("For each of 720 azimuths, march outward on the 1737.4 km sphere (quarter-cell steps over the first five "
          "cells, then 0.8 % geometric growth, to 250 km), read the terrain height (bilinear, finest LOLA grid with "
          "data) and keep the highest elevation angle atan2(R_s cos(theta) - R_o, R_s sin(theta)): exact lunar "
          "curvature, no refraction (airless). After Mazarico et al. (2011) and the pipeline's catalogue masks.")
VALIDATION = ("Against the 13 catalogue masks (LOLA 10-240 m, 2 m mast): median RMS 0.21 deg; 11 of 13 within "
              "0.5 deg RMS; worst Mons Malapert 3.25 deg and Haworth 2.07 deg RMS, where relief a few tens of metres "
              "across near the point lifts the real skyline (the computed one is lower there). Measured by "
              "tests/test_point_horizon.py.")


@router.get("/horizon", response_model=PointHorizonResponse,
            summary="360-degree skyline of manual coordinates, ray-traced over LOLA terrain where covered")
def point_horizon(lat: LatParam, lon: LonParam, mast_m: MastParam = DEFAULT_MAST_M,
                  store: DataStore = Depends(get_store)) -> PointHorizonResponse:
    lon = ((lon + 180.0) % 360.0) - 180.0
    ph = services.point_horizon(store, lat, lon, mast_m)
    if ph is not None:
        p, ground, kind = ph.profile, ph.ground_m, "terrain"
        near, cell, rng = ph.near_grid, ph.near_cell_m, ph.terrain_range_m / 1000.0
    else:
        p, ground, kind, near, cell, rng = store.horizons.for_point(mast_m), 0.0, "smooth_sphere", None, None, None
    v = p.values + 0.0
    i_max, i_min = int(np.argmax(v)), int(np.argmin(v))
    return PointHorizonResponse(
        lat=lat, lon=lon, ground_m=ground, ground_source=services.point_ground_source(store, lat, lon), mast_m=mast_m,
        horizon_kind=kind, near_grid=near, near_cell_m=cell, terrain_range_km=rng, method=METHOD,
        validation=VALIDATION, az_step_deg=p.az_step_deg, az=(np.arange(v.size) * p.az_step_deg).tolist(),
        elevation_deg=v.tolist(), max_deg=float(v[i_max]), max_az_deg=i_max * p.az_step_deg, min_deg=float(v[i_min]),
        min_az_deg=i_min * p.az_step_deg, mean_deg=float(v.mean()),
        **planes_fields(services.point_horizon_planes(store, lat, lon, mast_m) if ph is not None else None))
