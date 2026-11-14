"""Power levels (MECH): POST /api/v1/power, team API rules (flat fields). Validate, call the engine and
app/logic/power, shape."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from .. import services
from ..db.store import DataStore, get_store
from ..logic.eclipse import obscuration
from ..logic.engine import AnalysisParams, compute_metrics
from ..logic.power import (array_power_w, energy_balance, energy_margin_wh, energy_wh, load_series_w, night_energy_wh,
                           params_from_flat, usable_capacity_wh)
from ..schemas.power import PowerRequest, PowerResponse
from .common import ranges, resolve_model, window_fields, window_ms

router = APIRouter(prefix="/power", tags=["power"])

ASSUMPTIONS = [
    "Irradiance 1361 W/m2 at 1 au scaled by (1 au / r)^2; no dust, no light reflected by the terrain.",
    "Eclipses: power x (1 - fraction of the solar disc covered by the Earth), uniform solar disc, independent of the horizon cut.",
    "Values are constant over each step (left Riemann sum); accuracy is of the order of one step.",
    "Battery: no ageing, no temperature or voltage/current limits; losses only through the given efficiencies.",
]


@router.post("", response_model=PowerResponse, summary="Solar power levels: visible Sun, array power, battery balance")
def power(req: PowerRequest, store: DataStore = Depends(get_store)) -> PowerResponse:
    model = resolve_model(req, store)
    start_ms = window_ms(req, store)
    s = services.evaluate_window(store, model, start_ms, req.duration_h, req.step_min, AnalysisParams(panel=req.panel))
    t, m = s.t_ms, compute_metrics(s)
    occ = obscuration(s)
    q = s.power_w_m2 * (1.0 - occ)                        # irradiance reaching the panel
    out = PowerResponse(
        **window_fields(req, model, store, start_ms, t, ASSUMPTIONS), level=req.level, panel=req.panel,
        sun_fraction=s.sun_frac.tolist(), sun_el_deg=s.sun_el.tolist(), sunlit_ranges=ranges(t, s.sunlit()),
        longest_dark_h=m.longest_dark_h, sunlit_fraction=m.sunlight_pct / 100.0, obscuration=occ.tolist(),
        eclipse_ranges=ranges(t, occ > 0), mean_power_w_m2=float(q.mean()))
    if req.level == 1:
        return out

    array, battery, load = params_from_flat(req.model_dump())
    p = array_power_w(q, array)
    out.irradiance_w_m2 = q.tolist()
    out.power_w, out.mean_power_w, out.energy_wh = p.tolist(), float(p.mean()), energy_wh(p, t)
    out.peak_power_w = float(p.max())
    out.eclipse_energy_loss_wh = energy_wh(array_power_w(s.power_w_m2, array), t) - out.energy_wh
    if req.level == 2:
        return out

    load_w = load_series_w(s.sunlit(), load)
    bal = energy_balance(t, p, load_w, battery)
    out.net_power_w = (p - load_w).tolist()
    out.battery_soc = (bal.soc_wh / battery.capacity_wh).tolist()
    out.min_soc, out.final_soc, out.survives = bal.min_soc, bal.final_soc, bal.survived
    out.first_depletion_at = None if bal.first_depletion_index is None else services.iso_utc(t[bal.first_depletion_index])
    out.energy_margin_wh = energy_margin_wh(bal, battery)
    out.load_profile_w = load_w.tolist()
    out.depleted_ranges = ranges(t, bal.depleted)
    out.unserved_energy_wh, out.curtailed_energy_wh = bal.unserved_wh, bal.curtailed_wh
    out.usable_capacity_wh = usable_capacity_wh(battery)
    out.longest_dark_energy_wh = night_energy_wh(m.longest_dark_h, load, battery)
    return out
