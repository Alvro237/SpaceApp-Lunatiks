"""Earth over a mission window (MECH): POST /api/v1/earth. Validate, call the engine and app/logic, shape."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from .. import services
from ..db.store import DataStore, get_store
from ..logic.earth import libration_wander
from ..logic.engine import AnalysisParams, next_transition
from ..logic.sun import longest_run_h
from ..schemas.earth import EarthNow, EarthRequest, EarthResponse, EarthTransition, LibrationWander
from .common import ranges, resolve_model, window_fields, window_ms

router = APIRouter(prefix="/earth", tags=["earth"])

ASSUMPTIONS = [
    "Visible means at least comms_min_fraction of the Earth's disc above the local horizon: geometry only, "
    "no link budget and no ground-station coverage on Earth.",
    "Durations are counted at the sampling step; use a smaller step_min for finer edges.",
]


@router.post("", response_model=EarthResponse, summary="Earth visibility windows, time to Earthset and libration wander")
def earth(req: EarthRequest, store: DataStore = Depends(get_store)) -> EarthResponse:
    model = resolve_model(req, store)
    start_ms = window_ms(req, store)
    params = AnalysisParams(comms_min_fraction=req.comms_min_fraction)
    s = services.evaluate_window(store, model, start_ms, req.duration_h, req.step_min, params)
    t, vis = s.t_ms, s.comms(params)
    step_h = s.step_ms / 3_600_000.0
    tr = next_transition(store.ephemeris, model, start_ms, "earth", params)
    transition = None if tr is None else EarthTransition(kind=tr.kind, at=services.iso_utc(tr.at_ms),
                                                         in_hours=tr.in_ms / 3_600_000.0)
    return EarthResponse(
        **window_fields(req, model, store, start_ms, t, ASSUMPTIONS), comms_min_fraction=req.comms_min_fraction,
        now=EarthNow(elevation_deg=float(s.earth_el[0]), azimuth_deg=float(s.earth_az[0]),
                     visible_fraction=float(s.earth_frac[0]), visible=bool(vis[0]),
                     horizon_elevation_deg=float(model.horizon.at(s.earth_az[0])),
                     distance_km=float(s.earth_dist_km[0]), angular_radius_deg=float(s.earth_radius_deg[0])),
        earth_el_deg=s.earth_el.tolist(), earth_az_deg=s.earth_az.tolist(), visible_fraction=s.earth_frac.tolist(),
        visible_window_fraction=float(vis.mean()), visible_hours=float(vis.sum()) * step_h, visible_ranges=ranges(t, vis),
        longest_visible_h=longest_run_h(vis, t, True), longest_blackout_h=longest_run_h(vis, t, False),
        next_transition=transition,
        hours_to_earthset=transition.in_hours if transition is not None and transition.kind == "set" else None,
        libration=LibrationWander(**libration_wander(s.earth_az, s.earth_el)))
