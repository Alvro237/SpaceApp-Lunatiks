"""Thermal model (MECH): POST /api/v1/thermal. Validate, call the engine and app/logic/thermal, shape."""
from __future__ import annotations

import numpy as np
from fastapi import APIRouter, Depends

from .. import services
from ..db.store import DataStore, get_store
from ..logic.eclipse import obscuration
from ..logic.thermal import (LUNAR_REGOLITH, Equipment, Regolith, absorbed_flux, check_max, direct_sun, simulate, skin_depth_m)
from ..schemas.thermal import LimitResult, Stats, ThermalRequest, ThermalResponse
from .common import ranges, resolve_model, window_fields, window_ms

router = APIRouter(prefix="/thermal", tags=["thermal"])

ASSUMPTIONS = [
    "Flat ground: absorbed flux = (1 - albedo) x irradiance x visible solar fraction x (1 - eclipse) x sin(elevation).",
    "1-D conduction with constant properties; no infrared or reflected light from the surrounding terrain "
    "(shadowed floors come out colder than they are).",
    "Starts uniform at the equilibrium temperature of the window's mean absorbed flux (no spin-up): "
    "the first lunar day is the least reliable part.",
    "Equipment: one isothermal node, radiator seeing ground and cold space; no conduction to the ground, no heater control.",
]


def _stats(x: np.ndarray) -> Stats:
    return Stats(max_k=float(x.max()), min_k=float(x.min()), mean_k=float(x.mean()))


def _limit(t: np.ndarray, temps: np.ndarray, limit: float, mode: str, hours: float, upper: bool) -> LimitResult:
    chk = check_max(t, temps if upper else -temps, limit if upper else -limit, mode, hours)
    return LimitResult(limit_k=limit, passed=chk.passed, fraction_beyond=chk.fraction_above,
                       longest_beyond_h=chk.longest_above_h, ranges_beyond=ranges(t, chk.above))


@router.post("", response_model=ThermalResponse, summary="Regolith surface and equipment temperature over a mission")
def thermal(req: ThermalRequest, store: DataStore = Depends(get_store)) -> ThermalResponse:
    model = resolve_model(req, store)
    start_ms = window_ms(req, store)
    s = services.evaluate_window(store, model, start_ms, req.duration_h, req.step_min)
    occ = obscuration(s)
    reg = Regolith(**req.regolith.model_dump()) if req.regolith is not None else LUNAR_REGOLITH
    eq = Equipment(**req.equipment.model_dump()) if req.equipment is not None else None
    res = simulate(s.t_ms, absorbed_flux(s.irradiance_w_m2, s.sun_frac, occ, s.sun_el, reg.albedo), reg, eq,
                   direct_sun(s.irradiance_w_m2, s.sun_frac, occ))
    out = ThermalResponse(
        **window_fields(req, model, store, start_ms, s.t_ms, ASSUMPTIONS),
        surface_k=res.surface_k.tolist(), deep_k=res.deep_k.tolist(),
        equipment_k=None if res.equipment_k is None else res.equipment_k.tolist(),
        surface=_stats(res.surface_k), equipment=None if res.equipment_k is None else _stats(res.equipment_k),
        initial_k=res.initial_k, grid_depth_m=res.grid_depth_m, skin_depth_m=skin_depth_m(reg))
    if req.limits is not None:
        lim = req.limits
        temps = res.equipment_k if res.equipment_k is not None else res.surface_k
        out.limits_apply_to = "equipment" if res.equipment_k is not None else "surface"
        if lim.max_k is not None:
            out.above_max = _limit(s.t_ms, temps, lim.max_k, lim.mode, lim.max_hours_beyond, upper=True)
        if lim.min_k is not None:
            out.below_min = _limit(s.t_ms, temps, lim.min_k, lim.mode, lim.max_hours_beyond, upper=False)
    return out
