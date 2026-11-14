"""Replanning sweep (MECH): POST /api/v1/sweep. Places x landing dates for one stay length."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from .. import services
from ..db.store import DataStore, get_store
from ..logic.eclipse import obscuration
from ..logic.engine import AnalysisParams
from ..logic.power import array_power_w, load_series_w, params_from_flat
from ..logic.radiation import mission_dose, shielding_factor, sky_solid_angle
from ..logic.sweep import (energy_balance_rows, longest_run_rows, window_fraction, window_matrix, window_mean,
                           window_starts)
from ..schemas.sweep import PlaceSweep, SweepRequest, SweepResponse

router = APIRouter(prefix="/sweep", tags=["sweep"])

ASSUMPTIONS = [
    "One series per place on a regular grid; each landing window uses exactly the samples a single-window call would.",
    "Sunlit: any part of the Sun above the horizon. Link: at least comms_min_fraction of the Earth's disc above it.",
    "Power includes eclipses (1 - obscuration). Durations are counted at the sampling step.",
    "Radiation: CRaTER GCR climatology, the same for every landing date; no solar particle events.",
]


@router.post("", response_model=SweepResponse, summary="Replanning: compare landing dates (and places) for one stay")
def sweep(req: SweepRequest, store: DataStore = Depends(get_store)) -> SweepResponse:
    start_ms = services.to_ms(req.first_landing)
    span_h = (req.landings - 1) * req.landing_step_h + req.stay_h
    if not (store.ephemeris.covers(start_ms) and store.ephemeris.covers(start_ms + span_h * 3_600_000.0)):
        raise HTTPException(status_code=400, detail=(
            "The sweep is outside the ephemeris tables (2025-2035, 1969-1972 for Apollo); see GET /api/v1/meta/datasets"))
    n = round(req.stay_h * 60.0 / req.step_min)
    starts = window_starts(req.landings, round(req.landing_step_h * 60.0 / req.step_min))
    step_h = req.step_min / 60.0
    params = AnalysisParams(panel=req.panel, comms_min_fraction=req.comms_min_fraction)
    gcr = store.radiation.gcr_free_space_mean() if store.radiation else None
    array, battery, load = params_from_flat(req.model_dump())

    out: list[PlaceSweep] = []
    for pl in req.places:
        if pl.site_id is not None:
            site = store.sites.get(pl.site_id)
            if site is None:
                raise HTTPException(status_code=404, detail=f"Unknown site id {pl.site_id!r}; see GET /api/v1/sites")
            model, name = services.model_for_site(store, site, req.mast_m), site.name
        else:
            model, name = services.model_for_point(store, pl.lat, pl.lon, req.mast_m, horizon=getattr(req, "horizon", "smooth_sphere")), None
        s = services.evaluate_window(store, model, start_ms, span_h, req.step_min, params)
        lit, link = s.sunlit(), s.comms(params)
        occ = obscuration(s)
        q = s.power_w_m2 * (1.0 - occ)
        row = PlaceSweep(
            site_id=pl.site_id, name=name, lat=model.lat, lon=model.lon, horizon_kind=model.horizon.kind,
            sunlight_fraction=window_fraction(lit, starts, n).tolist(),
            comms_fraction=window_fraction(link, starts, n).tolist(),
            both_fraction=window_fraction(lit & link, starts, n).tolist(),
            longest_dark_h=(longest_run_rows(window_matrix(lit, starts, n), False) * step_h).tolist(),
            longest_blackout_h=(longest_run_rows(window_matrix(link, starts, n), False) * step_h).tolist(),
            eclipse_hours=(window_fraction(occ > 0, starts, n) * (n + 1) * step_h).tolist(),
            mean_power_w_m2=window_mean(q, starts, n).tolist())
        if array is not None:
            p = array_power_w(q, array)
            row.mean_array_w = window_mean(p, starts, n).tolist()
            if battery is not None:
                bal = energy_balance_rows(window_matrix(p, starts, n), window_matrix(load_series_w(lit, load), starts, n),
                                          step_h, battery)
                row.battery_survived = bal.survived.tolist()
                row.battery_min_soc = bal.min_soc.tolist()
                row.unserved_energy_wh = bal.unserved_wh.tolist()
        omega, _ = sky_solid_angle(store.grids.sample("sky_visibility_65s", model.lat, model.lon), model.horizon.kind)
        if gcr is not None and omega is not None:
            row.gcr_dose_mgy_si = mission_dose(gcr * shielding_factor(omega), req.stay_h)
        out.append(row)
    return SweepResponse(landings=[services.iso_utc(start_ms + float(a) * req.step_min * 60_000.0) for a in starts],
                         stay_h=req.stay_h, step_min=req.step_min, assumptions=ASSUMPTIONS, places=out)
