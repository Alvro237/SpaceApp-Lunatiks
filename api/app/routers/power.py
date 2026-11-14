"""Power levels (MECH): POST /api/v1/power. Validate, call the engine and app/logic/power, shape."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from .. import services
from ..db.store import DataStore, get_store
from ..logic.engine import AnalysisParams, compute_metrics
from ..logic.power import (ArrayParams, BatteryParams, LoadParams, array_power_w, energy_balance, energy_wh,
                           load_series_w, night_energy_wh, usable_capacity_wh)
from ..schemas.power import ArrayLevel, BalanceLevel, PowerRequest, PowerResponse, SunLevel
from .common import ranges, resolve_model, window_fields, window_ms

router = APIRouter(prefix="/power", tags=["power"])

ASSUMPTIONS = [
    "Irradiance 1361 W/m2 at 1 au scaled by (1 au / r)^2; no dust, no light reflected by the terrain.",
    "Values are constant over each step (left Riemann sum); accuracy is of the order of one step.",
    "Battery: no ageing, no temperature or voltage/current limits; losses only through the given efficiencies.",
]


@router.post("", response_model=PowerResponse, summary="Solar power levels: visible Sun, array power, battery balance")
def power(req: PowerRequest, store: DataStore = Depends(get_store)) -> PowerResponse:
    model = resolve_model(req, store)
    start_ms = window_ms(req, store)
    series = services.evaluate_window(store, model, start_ms, req.duration_h, req.step_min, AnalysisParams(panel=req.panel))
    t, m = series.t_ms, compute_metrics(series)
    out = PowerResponse(
        **window_fields(req, model, store, start_ms, t, ASSUMPTIONS), level=req.level, panel=req.panel,
        sun=SunLevel(sun_el_deg=series.sun_el.tolist(), visible_fraction=series.sun_frac.tolist(),
                     mean_visible_fraction=float(series.sun_frac.mean()), sunlit_fraction=m.sunlight_pct / 100.0,
                     sunlit_ranges=ranges(t, series.sunlit()), longest_dark_h=m.longest_dark_h))
    if req.level == 1:
        return out

    a = req.array
    p = array_power_w(series.power_w_m2, ArrayParams(area_m2=a.area_m2, efficiency=a.efficiency, derating=a.derating))
    out.array = ArrayLevel(power_w=p.tolist(), mean_power_w=float(p.mean()), peak_power_w=float(p.max()),
                           energy_wh=energy_wh(p, t), producing_fraction=float((p > 0).mean()),
                           producing_ranges=ranges(t, p > 0))
    if req.level == 2:
        return out

    b, ld = req.battery, req.load
    battery = BatteryParams(capacity_wh=b.capacity_wh, initial_soc=b.initial_soc, min_soc=b.min_soc,
                            charge_efficiency=b.charge_efficiency, discharge_efficiency=b.discharge_efficiency)
    load = LoadParams(day_w=ld.load_w, night_w=ld.load_w if ld.night_load_w is None else ld.night_load_w)
    q = load_series_w(series.sunlit(), load)
    bal = energy_balance(t, p, q, battery)
    out.balance = BalanceLevel(
        soc_fraction=(bal.soc_wh / battery.capacity_wh).tolist(), load_w=q.tolist(),
        min_soc_fraction=bal.min_soc, final_soc_fraction=bal.final_soc, survived=bal.survived,
        first_depletion_at=None if bal.first_depletion_index is None else services.iso_utc(t[bal.first_depletion_index]),
        depleted_fraction=float(bal.depleted.mean()), depleted_ranges=ranges(t, bal.depleted),
        generated_energy_wh=bal.generated_wh, consumed_energy_wh=bal.consumed_wh, unserved_energy_wh=bal.unserved_wh,
        curtailed_energy_wh=bal.curtailed_wh, usable_capacity_wh=usable_capacity_wh(battery),
        longest_dark_energy_wh=night_energy_wh(m.longest_dark_h, load, battery))
    return out
