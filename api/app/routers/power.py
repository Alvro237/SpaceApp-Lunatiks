"""Power levels (MECH): POST /api/v1/power, team API rules (flat fields). Validate, call the engine and
app/logic/power, shape."""
from __future__ import annotations

from dataclasses import replace

import numpy as np
from fastapi import APIRouter, Depends

from .. import services
from ..db.store import DataStore, get_store
from ..logic import colony
from ..logic.eclipse import obscuration
from ..logic.power import BatteryParams
from ..logic.thermal import Regolith, absorbed_flux, direct_sun, surface_implicit
from ..logic.engine import AnalysisParams, compute_metrics
from ..logic.power import (array_power_w, energy_balance, energy_margin_wh, energy_wh, load_series_w, night_energy_wh,
                           params_from_flat, usable_capacity_wh)
from ..schemas.power import EnergyBreakdown, PowerRequest, PowerResponse
from .common import ranges, resolve_model, window_fields, window_ms

router = APIRouter(prefix="/power", tags=["power"])

ASSUMPTIONS = [
    "Irradiance 1361 W/m2 at 1 au scaled by (1 au / r)^2; no dust, no light reflected by the terrain.",
    "Eclipses: power x (1 - fraction of the solar disc covered by the Earth), uniform solar disc, independent of the horizon cut.",
    "Values are constant over each step (left Riemann sum); accuracy is of the order of one step.",
    "Battery: no ageing, no temperature or voltage/current limits; losses only through the given efficiencies.",
    "Panels, antenna and habitat 2 m above the ground (fixed, team decision: most panels sit on structures).",
]
COLONY_ASSUMPTIONS = [
    "Level 4 habitat: two nodes, interior (air + structure) held at t_set_k, massless skin radiating to space and "
    "the ground; sun-facing area 0.5 x area and ground view factor 0.5 (team decision); constant UA.",
    "Every watt of electrical load served and the crew metabolic heat end as heat inside; resistive heater; the "
    "electrical cost of rejecting surplus heat is not modelled; no air leaks, no conduction through the footings.",
    "Ground temperature from the 1-D regolith model of /thermal on flat ground (no terrain infrared).",
    "Battery power limited by max_charge_w and max_discharge_w; critical loads (with the heater) served first; "
    "deferrable loads switched off below shed_soc.",
    "survives_independently = no critical failure and the battery ends the last whole synodic month at least as "
    "full as it started (0.1 % of capacity numerical tolerance): the window repeated forever never fails.",
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

    if req.level == 4:
        return _colony(req, s, t, q, p, occ, out)

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


def _colony(req: PowerRequest, s, t, q, p, occ, out: PowerResponse) -> PowerResponse:
    """Level 4: habitat heat, prioritised loads and a power-limited battery (app/logic/colony)."""
    d = req.model_dump()
    battery = BatteryParams(capacity_wh=d["battery_capacity_wh"], initial_soc=d["battery_initial_soc"],
                            min_soc=d["battery_min_soc"], charge_efficiency=d["charge_efficiency"],
                            discharge_efficiency=d["discharge_efficiency"])
    loads = colony.ColonyLoads(critical_w=req.critical_load_w, deferrable_w=req.deferrable_load_w,
                               comms_w=req.comms_load_w, comms_critical=req.comms_critical, shed_soc=req.shed_soc,
                               max_charge_w=req.max_charge_w, max_discharge_w=req.max_discharge_w)
    hab = colony.Habitat(**req.habitat.model_dump())
    reg = Regolith(**req.regolith.model_dump())
    direct = direct_sun(s.irradiance_w_m2, s.sun_frac, occ)
    on_ground = direct * np.maximum(np.sin(np.radians(s.sun_el)), 0.0)
    ground = surface_implicit(t, absorbed_flux(s.irradiance_w_m2, s.sun_frac, occ, s.sun_el, reg.albedo), reg)
    q_abs = colony.absorbed_by_skin_w(direct, on_ground, ground, reg.albedo, reg.emissivity, hab)
    link = s.comms(AnalysisParams(comms_min_fraction=req.comms_min_fraction))
    at_set = colony.leak_w(np.full(t.size, hab.t_set_k), q_abs, hab).tolist(),         colony.skin_k(np.full(t.size, hab.t_set_k), q_abs, hab).tolist()

    def run_with(power, bat, stop=False):
        return colony.simulate(t, power, link, q_abs, hab, loads, bat, stop_at_failure=stop, at_set=at_set)

    def assess(power, bat, run=None):
        run = run or run_with(power, bat, stop=True)
        return colony.status(t, run, lambda soc0: run_with(power, replace(bat, initial_soc=soc0), stop=True),
                             bat.capacity_wh)

    run = run_with(p, battery)
    status, months = assess(p, battery, run)
    cap, en = battery.capacity_wh, run.energy

    out.assumptions = out.assumptions + COLONY_ASSUMPTIONS
    out.colony_status, out.synodic_months, out.month_soc_change = status, len(months), months
    if run.first_failure_index is not None:
        out.failure_at = services.iso_utc(t[run.first_failure_index])
        out.failure_after_days = float((t[run.first_failure_index] - t[0]) / 86_400_000.0)
    out.load_profile_w = run.total_demand_w.tolist()
    out.net_power_w = (p - run.total_demand_w).tolist()
    out.battery_soc = (run.soc_wh / cap).tolist()
    out.min_soc, out.final_soc = float(run.soc_wh.min() / cap), float(run.soc_wh[-1] / cap)
    out.survives = run.first_failure_index is None
    out.first_depletion_at = out.failure_at
    out.unserved_energy_wh = en["critical_unserved"] + en["noncritical_unserved"]
    out.energy_margin_wh = (out.min_soc - battery.min_soc) * cap if out.survives else -en["critical_unserved"]
    out.depleted_ranges = ranges(t, run.failed)
    out.curtailed_energy_wh = en["curtailed"]
    out.usable_capacity_wh = usable_capacity_wh(battery)
    out.critical_load_profile_w = run.critical_demand_w.tolist()
    out.heater_w, out.cooling_demand_w = run.heater_w.tolist(), run.cooling_w.tolist()
    out.interior_k, out.skin_k, out.ground_k = run.interior_k.tolist(), run.skin_k.tolist(), ground.tolist()
    out.autonomy_h = colony.autonomy_h(run, battery, loads.max_discharge_w)
    out.sunrise_margin_wh = colony.sunrise_margin_wh(run, t, s.sunlit(), battery)
    out.shed_ranges = ranges(t, run.shed)
    step_h = req.step_min / 60.0
    out.degraded_days = float(run.shed[:-1].sum() * step_h / 24.0)
    out.interior_below_min_ranges = ranges(t, run.interior_k < hab.t_min_k)
    out.energy_breakdown = EnergyBreakdown(
        **{f"{k}_wh": v for k, v in en.items()}, battery_change_wh=float(run.soc_wh[-1] - run.soc_wh[0]))
    out.metabolic_heat_w, out.habitat_heat_capacity_j_k = hab.metabolic_w, hab.heat_capacity_j_k
    coldest = int(np.argmax(colony.leak_w(np.full(t.size, hab.t_set_k), q_abs, hab)))
    out.unheated_equilibrium_k = colony.equilibrium_unheated_k(float(q_abs[coldest]), hab)
    out.cold_soak_h = colony.cold_soak_h(float(q_abs[coldest]), hab)

    if req.include_sizing:
        def ok(power, bat) -> bool:
            return assess(power, bat)[0] == "survives_independently"
        out.min_battery_capacity_wh = colony.smallest_passing(lambda c: ok(p, replace(battery, capacity_wh=c)), cap)
        scale = colony.smallest_passing(lambda k: ok(p * k, battery), 1.0)
        out.min_panel_area_m2 = None if scale is None else scale * req.panel_area_m2
    return out
