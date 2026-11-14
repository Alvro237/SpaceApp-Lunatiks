"""Sun over a mission window (MECH): POST /api/v1/sun. Validate, call the engine and app/logic/sun, shape."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from .. import services
from ..db.store import DataStore, get_store
from ..logic.eclipse import obscuration
from ..logic.engine import next_transition
from ..logic.sun import elevation_stats, events, longest_run_h
from ..schemas.sun import EclipseEvent, ElevationStats, SunNow, SunRequest, SunResponse, Transition
from .common import ranges, resolve_model, window_fields, window_ms

router = APIRouter(prefix="/sun", tags=["sun"])

ASSUMPTIONS = [
    "Sunlit means any part of the solar disc above the local horizon; elevations are geometric (no atmosphere).",
    "Durations are counted at the sampling step; use a smaller step_min for finer edges.",
    "Eclipses: Earth's disc over the Sun's, Earth's atmosphere ignored.",
]


@router.post("", response_model=SunResponse, summary="Solar elevation, sunlight duration, time to sunset and eclipses")
def sun(req: SunRequest, store: DataStore = Depends(get_store)) -> SunResponse:
    model = resolve_model(req, store)
    start_ms = window_ms(req, store)
    s = services.evaluate_window(store, model, start_ms, req.duration_h, req.step_min)
    t, lit = s.t_ms, s.sunlit()
    step_h = s.step_ms / 3_600_000.0
    occ = obscuration(s)
    tr = next_transition(store.ephemeris, model, start_ms, "sun")
    transition = None if tr is None else Transition(kind=tr.kind, at=services.iso_utc(tr.at_ms), in_hours=tr.in_ms / 3_600_000.0)
    return SunResponse(
        **window_fields(req, model, store, start_ms, t, ASSUMPTIONS),
        now=SunNow(elevation_deg=float(s.sun_el[0]), azimuth_deg=float(s.sun_az[0]),
                   visible_fraction=float(s.sun_frac[0]), sunlit=bool(lit[0]),
                   horizon_elevation_deg=float(model.horizon.at(s.sun_az[0]))),
        sun_el_deg=s.sun_el.tolist(), sun_az_deg=s.sun_az.tolist(), visible_fraction=s.sun_frac.tolist(),
        elevation=ElevationStats(**elevation_stats(s.sun_el, lit)),
        sunlit_fraction=float(lit.mean()), sunlit_hours=float(lit.sum()) * step_h, sunlit_ranges=ranges(t, lit),
        longest_sunlit_h=longest_run_h(lit, t, True), longest_dark_h=longest_run_h(lit, t, False),
        next_transition=transition,
        hours_to_sunset=transition.in_hours if transition is not None and transition.kind == "set" else None,
        obscuration=occ.tolist(),
        eclipse_fraction=float((s.eclipse > 0).mean()), eclipse_ranges=ranges(t, s.eclipse > 0),
        eclipses=[EclipseEvent(start=services.iso_utc(e.start_ms), end=services.iso_utc(e.end_ms), duration_h=e.duration_h,
                               kind="total" if e.max_code == 2 else "partial", max_obscuration=e.max_value)
                  for e in events(t, s.eclipse, occ)])
