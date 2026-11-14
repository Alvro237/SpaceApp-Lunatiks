"""Radiation dose on the surface (MECH): POST /api/v1/radiation. Validate, call app/logic/radiation, shape."""
from __future__ import annotations

import numpy as np
from fastapi import APIRouter, Depends, HTTPException

from .. import services
from ..db.store import DataStore, get_store
from ..logic.radiation import (CAREER_LIMIT_MSV, climatology, effective_dose_msv, mission_dose, shielding_factor,
                               sky_solid_angle)
from ..schemas.radiation import DailyStats, DatasetRef, RadiationRequest, RadiationResponse, Range3, SpeRecord
from .common import resolve_model

router = APIRouter(prefix="/radiation", tags=["radiation"])

ASSUMPTIONS = [
    "Galactic cosmic rays treated as isotropic: surface dose = free-space dose x open sky / 4 pi.",
    "Secondary particles from the regolith (albedo neutrons and protons) are not added: the surface value is a lower bound.",
    "No habitat, suit or vehicle shielding.",
    "Solar particle events are not predicted; the record's largest event is reported for context.",
    "Low and high mission values use the 5th and 95th percentile daily rate over the whole mission (a wide bracket).",
]


def _range(rate: DailyStats, factor: float, duration_h: float) -> Range3:
    return Range3(low=mission_dose(rate.p05 * factor, duration_h), mean=mission_dose(rate.mean * factor, duration_h),
                  high=mission_dose(rate.p95 * factor, duration_h))


@router.post("", response_model=RadiationResponse, summary="Galactic-cosmic-ray dose at a site over a mission (LRO CRaTER)")
def radiation(req: RadiationRequest, store: DataStore = Depends(get_store)) -> RadiationResponse:
    rad = store.radiation
    if rad is None or not rad.available:
        raise HTTPException(status_code=503, detail="CRaTER dataset not loaded; run python -m lunarnav.crater_dose")
    model = resolve_model(req, store)
    ok = ~rad.partial_day
    free = DailyStats(**climatology(rad.corrected[ok]))
    omega, source = sky_solid_angle(store.grids.sample("sky_visibility_65s", model.lat, model.lon), model.horizon.kind)
    k = None if omega is None else shielding_factor(omega)
    surface = None if k is None else DailyStats(**{**free.model_dump(), **{s: getattr(free, s) * k
                                                                          for s in ("mean", "p05", "p50", "p95", "max")}})
    mission = None if k is None else _range(free, k, req.duration_h)
    eff = None
    if mission is not None and req.si_to_tissue_factor is not None and req.quality_factor is not None:
        f = lambda d: effective_dose_msv(d, req.si_to_tissue_factor, req.quality_factor)  # noqa: E731
        eff = Range3(low=f(mission.low), mean=f(mission.mean), high=f(mission.high))
    spe_days = int(np.sum(~np.isfinite(rad.corrected) & ok))
    i = int(np.nanargmax(rad.measured))
    m = rad.meta
    return RadiationResponse(
        site_id=req.site_id, lat=model.lat, lon=model.lon, horizon_kind=model.horizon.kind,
        start=services.iso_utc(services.to_ms(req.start)), duration_h=req.duration_h, basis="climatology",
        assumptions=ASSUMPTIONS, sky_solid_angle_sr=omega, sky_source=source, shielding_factor=k,
        gcr_free_space_daily_mgy_si=free, gcr_surface_daily_mgy_si=surface, mission_gcr_dose_mgy_si=mission,
        mission_effective_dose_msv=eff, career_limit_msv=CAREER_LIMIT_MSV,
        fraction_of_career_limit=None if eff is None else eff.mean / CAREER_LIMIT_MSV,
        spe_record=SpeRecord(days_flagged=spe_days, largest_day=rad.dates[i], largest_day_mgy_si=float(rad.measured[i])),
        dataset=DatasetRef(name=m["name"], url=m["url"], first=m["first"], last=m["last"]))
