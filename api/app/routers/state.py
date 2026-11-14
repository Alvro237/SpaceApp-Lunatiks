"""Sun and Earth at a catalogue site: one instant (state) and a mission window (series). SW-1.

    GET /api/v1/sites/{site_id}/state?t=2026-11-20T12:00:00Z&mast_m=0&comms_min_fraction=0.5
    GET /api/v1/sites/{site_id}/series?start=2026-11-20T12:00:00Z&duration_h=336&step_min=10

Shape of routers/sites.py: validate, call services/engine, shape the response. No physics here.
``state_response`` and ``series_response`` are reused by the manual-coordinates router (``/points``).
Output format: docs/sw1-output-format.md.
"""
from __future__ import annotations

import math
from datetime import datetime
from typing import Annotated

import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BeforeValidator

from .. import services
from ..db.store import DataStore, get_store
from ..logic.engine import AnalysisParams, SiteModel
from ..logic.ephemeris import OutOfCoverage
from ..schemas.state import (BodySeries, BodyState, SeriesMetrics, SeriesResponse, StateResponse, TimeRange,
                             Transition)

router = APIRouter(prefix="/sites", tags=["state"])

ECLIPSE = {0: "none", 1: "partial", 2: "total"}

T_QUERY = Query(..., description="Instant, ISO 8601 (e.g. 2026-11-20T12:00:00Z). No offset = UTC",
                examples=["2026-11-20T12:00:00Z"])
DEFAULT_MAST_M = 0.0   # owner's decision (Sergio): a missing or null mast means the ground itself


def _null_to_default_mast(v):
    """Absent, empty (``mast_m=``) or literal ``null``/``none`` all mean the default mast, 0 m."""
    if v is None or (isinstance(v, str) and v.strip().lower() in ("", "null", "none")):
        return DEFAULT_MAST_M
    return v


MastParam = Annotated[float, BeforeValidator(_null_to_default_mast), Query(
    ge=0.0, le=20.0, description="Panel or antenna height above the ground, metres, 0..20. Absent, empty or "
    "null = 0 m (the ground). Terrain masks exist for 0, 2, 5 and 10 m; the nearest is used (see mast_used_m)")]
COMMS_QUERY = Query(0.5, ge=0.0, le=1.0, description="Share of the Earth's disc that must be above the "
                    "horizon to count as direct-to-Earth comms")


def parse_instant_ms(store: DataStore, t: datetime) -> float:
    """Request instant to Unix ms, 400 when the ephemeris tables do not cover it."""
    t_ms = services.to_ms(t)
    if not store.ephemeris.covers(t_ms):
        spans = ", ".join(f"{services.iso_utc(a)} .. {services.iso_utc(b)}" for a, b in store.ephemeris.coverage())
        raise HTTPException(status_code=400, detail=f"t={services.iso_utc(t_ms)} is outside the ephemeris tables "
                                                    f"({spans})")
    return t_ms


def edge_ms(t_ms: float) -> float:
    """A refined edge is the first instant in the new state, known to ~1 s. The wire format has whole seconds,
    so round up: the published instant is then already in the new state (truncating would print a time that is
    still in the old one)."""
    return math.ceil(t_ms / 1000.0) * 1000.0


def _transition(tr, from_ms: float) -> Transition | None:
    if tr is None:
        return None
    at = edge_ms(tr.at_ms)
    return Transition(kind=tr.kind, at=services.iso_utc(at), in_hours=(at - from_ms) / 3_600_000.0)


def _body(az, el, horizon_el, frac, radius, dist, visible) -> BodyState:
    return BodyState(az=float(az), el=float(el), horizon_el=horizon_el, visible_fraction=float(frac),
                     visible=bool(visible), angular_radius_deg=float(radius), distance_km=float(dist))


def state_response(store: DataStore, model: SiteModel, t_ms: float, params: AnalysisParams,
                   mast_used_m: float, site_id: str | None) -> StateResponse:
    try:
        st = services.state_at(store, model, t_ms, params)
    except OutOfCoverage as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    s = st.series
    return StateResponse(
        site_id=site_id, lat=model.lat, lon=model.lon, ground_m=model.ground_m, t=services.iso_utc(t_ms),
        mast_m=model.mast_m, mast_used_m=mast_used_m,
        comms_min_fraction=params.comms_min_fraction, horizon_kind=model.horizon.kind,
        sun=_body(s.sun_az[0], s.sun_el[0], st.sun_horizon_el, s.sun_frac[0], s.sun_radius_deg[0],
                  s.sun_dist_km[0], s.sunlit()[0]),
        earth=_body(s.earth_az[0], s.earth_el[0], st.earth_horizon_el, s.earth_frac[0], s.earth_radius_deg[0],
                    s.earth_dist_km[0], s.comms(params)[0]),
        eclipse=ECLIPSE[int(s.eclipse[0])], sun_eclipsed_fraction=float(s.sun_eclipsed_fraction[0]),
        next_sun_transition=_transition(st.next_sun, t_ms), next_earth_transition=_transition(st.next_earth, t_ms),
        transition_search_days=services.TRANSITION_SEARCH_DAYS)


@router.get("/{site_id}/state", response_model=StateResponse,
            summary="Sun and Earth at a site and instant: az/el, visible fraction, eclipse, time to next set/rise")
def site_state(site_id: str, t: datetime = T_QUERY, mast_m: MastParam = DEFAULT_MAST_M,
               comms_min_fraction: float = COMMS_QUERY,
               store: DataStore = Depends(get_store)) -> StateResponse:
    site = store.sites.get(site_id)
    if site is None:
        raise HTTPException(status_code=404, detail=f"Unknown site id {site_id!r}; see GET /api/v1/sites")
    t_ms = parse_instant_ms(store, t)
    model = services.model_for_site(store, site, mast_m)
    mast_used = store.horizons.nearest_mast(mast_m) if site.has_terrain else mast_m
    params = AnalysisParams(comms_min_fraction=comms_min_fraction)
    return state_response(store, model, t_ms, params, mast_used, site.id)


# ---------------------------------------------------------------------------- series

MAX_SAMPLES = 20_000   # docs/endpoints.md, "Series over a window": cap the samples, 422 above it
DEFAULT_STEP_MIN = 10.0

START_QUERY = Query(..., description="Window start, ISO 8601 (e.g. 2026-11-20T12:00:00Z). No offset = UTC",
                    examples=["2026-11-20T12:00:00Z"])
DURATION_QUERY = Query(..., gt=0.0, description="Window length, hours (mission duration). Required: a mission "
                       "input with no neutral default", examples=[336])
STEP_QUERY = Query(DEFAULT_STEP_MIN, ge=1.0, le=1440.0, description="Sample spacing, minutes, 1..1440. Range "
                   f"edges are refined to ~1 s whatever the step. At most {MAX_SAMPLES} samples per request")


def parse_window_ms(store: DataStore, start: datetime, duration_h: float, step_min: float) -> float:
    """Validate the window: sample cap (422) and ephemeris coverage of both ends (400)."""
    samples = int(np.floor(duration_h * 3_600_000.0 / (step_min * 60_000.0))) + 1   # as engine.time_grid
    if samples > MAX_SAMPLES:
        raise HTTPException(status_code=422, detail=f"{samples} samples requested (duration_h={duration_h:g}, "
                            f"step_min={step_min:g}); the limit is {MAX_SAMPLES}: raise step_min or shorten the window")
    start_ms = parse_instant_ms(store, start)
    end_ms = start_ms + duration_h * 3_600_000.0
    if not any(a <= start_ms and end_ms <= b for a, b in store.ephemeris.coverage()):
        spans = ", ".join(f"{services.iso_utc(a)} .. {services.iso_utc(b)}" for a, b in store.ephemeris.coverage())
        raise HTTPException(status_code=400, detail=f"window {services.iso_utc(start_ms)} .. {services.iso_utc(end_ms)} "
                                                    f"leaves the ephemeris tables ({spans})")
    return start_ms


def _ranges(rr) -> list[TimeRange]:
    out = []
    for r in rr:
        a = r.start_ms if r.starts_before_window else edge_ms(r.start_ms)   # window bounds are samples: as is
        b = r.end_ms if r.ends_after_window else edge_ms(r.end_ms)
        out.append(TimeRange(start=services.iso_utc(a), end=services.iso_utc(b), duration_h=(b - a) / 3_600_000.0,
                             starts_before_window=r.starts_before_window, ends_after_window=r.ends_after_window))
    return out


def series_response(store: DataStore, model: SiteModel, start_ms: float, duration_h: float, step_min: float,
                    params: AnalysisParams, mast_used_m: float, site_id: str | None) -> SeriesResponse:
    try:
        w = services.series_window(store, model, start_ms, duration_h, step_min, params)
    except OutOfCoverage as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    s, m = w.series, w.metrics
    return SeriesResponse(
        site_id=site_id, lat=model.lat, lon=model.lon, ground_m=model.ground_m, start=services.iso_utc(start_ms),
        end=services.iso_utc(float(s.t_ms[-1])), duration_h=duration_h, step_min=step_min, samples=int(s.t_ms.size),
        mast_m=model.mast_m, mast_used_m=mast_used_m, comms_min_fraction=params.comms_min_fraction,
        horizon_kind=model.horizon.kind, t=[services.iso_utc(x) for x in s.t_ms],
        sun=BodySeries(az=s.sun_az.tolist(), el=s.sun_el.tolist(), horizon_el=w.sun_horizon_el.tolist(),
                       visible_fraction=s.sun_frac.tolist(), visible=s.sunlit().tolist()),
        earth=BodySeries(az=s.earth_az.tolist(), el=s.earth_el.tolist(), horizon_el=w.earth_horizon_el.tolist(),
                         visible_fraction=s.earth_frac.tolist(), visible=s.comms(params).tolist()),
        eclipse=[ECLIPSE[int(e)] for e in s.eclipse], sun_eclipsed_fraction=s.sun_eclipsed_fraction.tolist(),
        sunlit_ranges=_ranges(w.sunlit), comms_ranges=_ranges(w.comms), eclipse_ranges=_ranges(w.eclipse),
        metrics=SeriesMetrics(window_hours=m.window_hours, sunlight_pct=m.sunlight_pct, comms_pct=m.comms_pct,
                              both_pct=m.both_pct, longest_dark_h=m.longest_dark_h,
                              longest_blackout_h=m.longest_blackout_h, continuous_light=m.continuous_light,
                              continuous_comms=m.continuous_comms, eclipse_minutes=m.eclipse_minutes,
                              eclipse_events=m.eclipse_events, max_sun_el_deg=m.max_sun_el_deg,
                              min_sun_el_deg=m.min_sun_el_deg))


@router.get("/{site_id}/series", response_model=SeriesResponse,
            summary="Sun and Earth over a mission window: per-sample arrays, sunlit/comms/eclipse ranges, metrics")
def site_series(site_id: str, start: datetime = START_QUERY, duration_h: float = DURATION_QUERY,
                step_min: float = STEP_QUERY, mast_m: MastParam = DEFAULT_MAST_M,
                comms_min_fraction: float = COMMS_QUERY, store: DataStore = Depends(get_store)) -> SeriesResponse:
    site = store.sites.get(site_id)
    if site is None:
        raise HTTPException(status_code=404, detail=f"Unknown site id {site_id!r}; see GET /api/v1/sites")
    start_ms = parse_window_ms(store, start, duration_h, step_min)
    model = services.model_for_site(store, site, mast_m)
    mast_used = store.horizons.nearest_mast(mast_m) if site.has_terrain else mast_m
    params = AnalysisParams(comms_min_fraction=comms_min_fraction)
    return series_response(store, model, start_ms, duration_h, step_min, params, mast_used, site.id)
