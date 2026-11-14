"""Sun and Earth state of a catalogue site at one instant (SW-1).

    GET /api/v1/sites/{site_id}/state?t=2026-11-20T12:00:00Z&mast_m=2&panel=vertical&comms_min_fraction=0.5

Shape of routers/sites.py: validate, call services/engine, shape the response. No physics here.
``state_response`` is reused by the manual-coordinates router (``/points/state``).
Output format: docs/sw1-output-format.md.
"""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query

from .. import services
from ..db.store import DataStore, get_store
from ..logic.engine import AnalysisParams, SiteModel
from ..logic.ephemeris import OutOfCoverage
from ..schemas.state import BodyState, PanelModel, StateResponse, Transition

router = APIRouter(prefix="/sites", tags=["state"])

ECLIPSE = {0: "none", 1: "partial", 2: "total"}

T_QUERY = Query(..., description="Instant, ISO 8601 (e.g. 2026-11-20T12:00:00Z). No offset = UTC",
                examples=["2026-11-20T12:00:00Z"])
MAST_QUERY = Query(2.0, ge=0.0, le=20.0, description="Panel or antenna height above the ground, metres. "
                   "Terrain masks exist for 0, 2, 5 and 10 m; the nearest is used (see mast_used_m)")
PANEL_QUERY = Query("vertical", description="Solar array model for power_w_m2: sun-tracking, vertical "
                    "(turning in azimuth) or horizontal")
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


def _transition(tr) -> Transition | None:
    if tr is None:
        return None
    return Transition(kind=tr.kind, at=services.iso_utc(tr.at_ms), in_hours=tr.in_ms / 3_600_000.0)


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
        mast_m=model.mast_m, mast_used_m=mast_used_m, panel=params.panel,
        comms_min_fraction=params.comms_min_fraction, horizon_kind=model.horizon.kind,
        sun=_body(s.sun_az[0], s.sun_el[0], st.sun_horizon_el, s.sun_frac[0], s.sun_radius_deg[0],
                  s.sun_dist_km[0], s.sunlit()[0]),
        earth=_body(s.earth_az[0], s.earth_el[0], st.earth_horizon_el, s.earth_frac[0], s.earth_radius_deg[0],
                    s.earth_dist_km[0], s.comms(params)[0]),
        eclipse=ECLIPSE[int(s.eclipse[0])], irradiance_w_m2=float(s.irradiance_w_m2[0]),
        power_w_m2=float(s.power_w_m2[0]),
        next_sun_transition=_transition(st.next_sun), next_earth_transition=_transition(st.next_earth),
        transition_search_days=services.TRANSITION_SEARCH_DAYS)


@router.get("/{site_id}/state", response_model=StateResponse,
            summary="Sun and Earth at a site and instant: az/el, visible fraction, power, time to next set/rise")
def site_state(site_id: str, t: datetime = T_QUERY, mast_m: float = MAST_QUERY,
               panel: PanelModel = PANEL_QUERY, comms_min_fraction: float = COMMS_QUERY,
               store: DataStore = Depends(get_store)) -> StateResponse:
    site = store.sites.get(site_id)
    if site is None:
        raise HTTPException(status_code=404, detail=f"Unknown site id {site_id!r}; see GET /api/v1/sites")
    t_ms = parse_instant_ms(store, t)
    model = services.model_for_site(store, site, mast_m)
    mast_used = store.horizons.nearest_mast(mast_m) if site.has_terrain else mast_m
    params = AnalysisParams(panel=panel, comms_min_fraction=comms_min_fraction)
    return state_response(store, model, t_ms, params, mast_used, site.id)
