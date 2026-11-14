"""Power level 4 (colony analysis): hand cases for the habitat heat model, the load dispatch and the status rules,
energy conservation, the implicit regolith solver, and POST /api/v1/power with level 4."""
from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timezone

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import services
from app.db.store import get_store
from app.logic import colony, thermal
from app.logic.colony import ColonyLoads, Habitat
from app.logic.eclipse import obscuration
from app.logic.power import BatteryParams
from app.main import app

client = TestClient(app)
H = 3_600_000.0                       # one hour in ms
SIGMA = thermal.SIGMA


def hab(**kw) -> Habitat:
    base = dict(crew_count=0, t_set_k=294.0, t_min_k=283.0, ua_w_k=5.0, area_m2=200.0, skin_absorptivity=0.3,
                skin_emissivity=0.8, structure_mass_kg=20000.0, structure_specific_heat_j_kgk=900.0,
                air_volume_m3=0.0, air_pressure_pa=0.0)
    return Habitat(**{**base, **kw})


def loads(**kw) -> ColonyLoads:
    base = dict(critical_w=100.0, deferrable_w=0.0, comms_w=0.0, comms_critical=False, shed_soc=0.0,
                max_charge_w=1e9, max_discharge_w=1e9)
    return ColonyLoads(**{**base, **kw})


IDEAL = BatteryParams(capacity_wh=1000.0, initial_soc=1.0, min_soc=0.0)


def hours(n):
    return np.arange(n) * H


def test_metabolic_default_is_the_bvad_40_year_mean():
    # NASA BVAD Rev 1 Table 3-21: 12.996 (male) and 11.292 (female) MJ per crewmember-day at 40 years
    assert colony.METABOLIC_W_PER_CREW == pytest.approx(140.5556, abs=1e-3)
    assert hab(crew_count=4).metabolic_w == pytest.approx(4 * 140.5556, abs=1e-2)


def test_air_mass_and_heat_capacity_from_the_ideal_gas_law():
    h = hab(air_volume_m3=100.0, air_pressure_pa=101325.0, t_set_k=293.15)
    rho = 101325.0 * 0.0289644 / (8.314462618 * 293.15)             # 1.204 kg/m3
    assert h.air_mass_kg == pytest.approx(100.0 * rho) and rho == pytest.approx(1.204, abs=1e-3)
    assert h.heat_capacity_j_k == pytest.approx(20000.0 * 900.0 + 100.0 * rho * 1007.0)


def test_skin_balance_hand_cases():
    h = hab()
    # no insulation leak: the skin is at radiative equilibrium with what it absorbs
    tiny = replace(h, ua_w_k=1e-9)
    assert float(colony.skin_k(294.0, 5000.0, tiny)) == pytest.approx((5000.0 / (0.8 * 200.0 * SIGMA)) ** 0.25, rel=1e-6)
    # general case: the balance closes
    ts = float(colony.skin_k(294.0, 3000.0, h))
    assert 5.0 * (294.0 - ts) + 3000.0 == pytest.approx(0.8 * 200.0 * SIGMA * ts ** 4, rel=1e-9)
    assert float(colony.leak_w(294.0, 3000.0, h)) == pytest.approx(5.0 * (294.0 - ts))
    # absorbed: alpha (0.5 A G + 0.5 A rho_g H) + eps A 0.5 eps_g sigma Tg^4
    q = colony.absorbed_by_skin_w(1000.0, 500.0, 250.0, 0.1, 0.9, h)
    assert float(q) == pytest.approx(0.3 * (0.5 * 200 * 1000 + 200 * 0.5 * 0.1 * 500) + 0.8 * 200 * 0.5 * 0.9 * SIGMA * 250 ** 4)


def test_heater_holds_setpoint_and_counts_internal_gains():
    h = hab(crew_count=2)
    q = np.full(5, 100.0)
    leak = float(colony.leak_w(294.0, 100.0, h))
    r = colony.simulate(hours(5), np.full(5, 1e4), np.zeros(5, bool), q, h, loads(critical_w=50.0), IDEAL)
    assert r.heater_w[0] == pytest.approx(max(0.0, leak - 2 * colony.METABOLIC_W_PER_CREW - 50.0))
    assert np.all(r.interior_k == 294.0) and r.first_failure_index is None
    # more electrical load inside -> less heater, same total heat
    r2 = colony.simulate(hours(5), np.full(5, 1e4), np.zeros(5, bool), q, h, loads(critical_w=150.0), IDEAL)
    assert r2.heater_w[0] == pytest.approx(max(0.0, r.heater_w[0] - 100.0))


def test_failure_time_hand_case_and_conservation():
    # no sun, 1000 Wh usable, 100 W critical, no heater (gains > leak): the battery carries exactly 10 h
    h = hab(ua_w_k=1e-6)
    r = colony.simulate(hours(25), np.zeros(25), np.zeros(25, bool), np.zeros(25), h, loads(), IDEAL)
    assert r.first_failure_index == 10 and r.heater_w[:10].max() == 0.0
    # after the failure the interior floats below t_set and the heater asks to reheat (not counted as critical)
    assert r.interior_k[-1] < 294.0 and r.heater_w[11:-1].min() > 0.0
    st, _ = colony.status(hours(25), r, lambda s: r, 1000.0)
    assert st == "failure_after_x_days"
    e = r.energy
    assert e["critical_served"] == pytest.approx(1000.0) and e["critical_unserved"] == pytest.approx(1400.0)


def _balance(r: colony.ColonyRun) -> float:
    e = r.energy
    used = e["critical_served"] + e["heater_served"] + e["comms_served"] + e["deferrable_served"]
    return e["generated"] - used - e["curtailed"] - e["charge_losses"] - e["discharge_losses"] - (r.soc_wh[-1] - r.soc_wh[0])


def test_energy_conservation_with_losses_limits_shedding_and_failure():
    rng = np.random.default_rng(1)
    n = 400
    gen = np.where((np.arange(n) // 50) % 2 == 0, rng.uniform(0, 2000, n), 0.0)
    bat = BatteryParams(capacity_wh=3000.0, initial_soc=0.6, min_soc=0.2, charge_efficiency=0.9, discharge_efficiency=0.85)
    ld = loads(critical_w=200.0, deferrable_w=300.0, comms_w=80.0, shed_soc=0.5, max_charge_w=700.0, max_discharge_w=450.0)
    r = colony.simulate(hours(n), gen, rng.random(n) > 0.5, rng.uniform(0, 4000, n), hab(crew_count=1, ua_w_k=8.0), ld, bat)
    assert abs(_balance(r)) < 1e-6
    assert r.first_failure_index is not None and r.shed.any()
    assert r.soc_wh.min() >= bat.min_soc * bat.capacity_wh - 1e-9


def test_shedding_charge_and_discharge_limits():
    h = hab(ua_w_k=1e-6)
    # below shed_soc the deferrable load is off, above it is on
    bat = BatteryParams(capacity_wh=1000.0, initial_soc=0.55, min_soc=0.0)
    r = colony.simulate(hours(4), np.zeros(4), np.zeros(4, bool), np.zeros(4), h,
                        loads(critical_w=10.0, deferrable_w=40.0, shed_soc=0.5), bat)
    # 550 -> 500 Wh (exactly at shed_soc: still on) -> 450 Wh (below: off)
    assert r.shed.tolist()[:3] == [False, False, True]
    assert r.total_demand_w[1] == pytest.approx(50.0) and r.total_demand_w[2] == pytest.approx(10.0)
    # charge limited to 100 W at the array side, x 0.9 into the battery
    empty = BatteryParams(capacity_wh=1000.0, initial_soc=0.0, min_soc=0.0, charge_efficiency=0.9)
    r = colony.simulate(hours(3), np.full(3, 1000.0), np.zeros(3, bool), np.zeros(3), h,
                        loads(critical_w=0.0, max_charge_w=100.0), empty)
    assert r.soc_wh[1] == pytest.approx(90.0) and r.energy["curtailed"] == pytest.approx(1800.0)
    # discharge limited to 60 W: a 100 W critical load fails at once even with a full battery
    r = colony.simulate(hours(3), np.zeros(3), np.zeros(3, bool), np.zeros(3), h, loads(max_discharge_w=60.0), IDEAL)
    assert r.first_failure_index == 0


def test_comms_only_when_the_earth_is_visible_and_critical_switch():
    h = hab(ua_w_k=1e-6)
    link = np.array([True, False, True, False])
    r = colony.simulate(hours(4), np.full(4, 1e4), link, np.zeros(4), h, loads(critical_w=10.0, comms_w=30.0), IDEAL)
    assert r.total_demand_w.tolist() == [40.0, 10.0, 40.0, 10.0] and r.critical_demand_w.tolist() == [10.0] * 4
    rc = colony.simulate(hours(4), np.full(4, 1e4), link, np.zeros(4), h,
                         loads(critical_w=10.0, comms_w=30.0, comms_critical=True), IDEAL)
    assert rc.critical_demand_w.tolist() == [40.0, 10.0, 40.0, 10.0]


def _months(n_months: float, step_h: float = 6.0):
    n = int(np.ceil(n_months * colony.SYNODIC_MONTH_H / step_h)) + 1
    t = np.arange(n) * step_h * H
    day = (t / H % colony.SYNODIC_MONTH_H) < colony.SYNODIC_MONTH_H / 2
    return t, day


@pytest.mark.parametrize("gen_w,expected", [(500.0, "survives_independently"),
                                            (190.0, "survives_window_declining"),
                                            (20.0, "failure_after_x_days")])
def test_status_rules(gen_w, expected):
    # half a synodic month of sun at gen_w, then dark; 100 W critical, ideal battery large enough for 3 months of
    # a small deficit: 190 W by day only gives 95 W on average -> drains 5 W x 709 h = 3.5 kWh a month
    t, day = _months(3)
    bat = BatteryParams(capacity_wh=60000.0, initial_soc=1.0, min_soc=0.0)
    h = hab(ua_w_k=1e-6)
    gen = np.where(day, gen_w, 0.0)

    def rerun(soc0):
        return colony.simulate(t, gen, np.zeros(t.size, bool), np.zeros(t.size), h, loads(), replace(bat, initial_soc=soc0),
                               stop_at_failure=True)
    r = colony.simulate(t, gen, np.zeros(t.size, bool), np.zeros(t.size), h, loads(), bat)
    st, changes = colony.status(t, r, rerun, bat.capacity_wh)
    assert st == expected and len(changes) == 3


def test_cold_soak_scales_with_heat_capacity_and_crew_heat_can_prevent_it():
    h = hab(ua_w_k=5.0)
    a = colony.cold_soak_h(0.0, h)
    b = colony.cold_soak_h(0.0, replace(h, structure_mass_kg=40000.0))
    assert a is not None and b == pytest.approx(2.0 * a, rel=0.01)
    # equilibrium with crew heat only; enough crew keeps it above t_min -> never reached
    warm = replace(h, crew_count=20)
    assert colony.equilibrium_unheated_k(0.0, warm) >= warm.t_min_k and colony.cold_soak_h(0.0, warm) is None
    teq = colony.equilibrium_unheated_k(0.0, h)
    assert teq < h.t_min_k


def test_smallest_passing_bisection():
    assert colony.smallest_passing(lambda x: x >= 3.7, 1.0) == pytest.approx(3.7, rel=0.005)
    assert colony.smallest_passing(lambda x: x >= 3.7, 100.0) == pytest.approx(3.7, rel=0.005)
    assert colony.smallest_passing(lambda x: False, 1.0) is None


def test_implicit_regolith_matches_the_explicit_model():
    store = get_store()
    t0 = services.to_ms(datetime(2027, 1, 1, tzinfo=timezone.utc))
    s = services.evaluate_window(store, services.model_for_point(store, 0.0, 0.0, 2.0), t0, 24 * 30, 60)
    reg = thermal.Regolith(0.12, 0.95, 0.002, 1500.0, 600.0, 0.018)
    f = thermal.absorbed_flux(s.irradiance_w_m2, s.sun_frac, obscuration(s), s.sun_el, reg.albedo)
    d = np.abs(thermal.simulate(s.t_ms, f, reg).surface_k - thermal.surface_implicit(s.t_ms, f, reg))
    assert np.percentile(d, 99) < 1.0 and d.max() < 5.0


HABITAT = {"crew_count": 4, "t_set_k": 294, "t_min_k": 283, "ua_w_k": 5, "area_m2": 200, "skin_absorptivity": 0.3,
           "skin_emissivity": 0.8, "structure_mass_kg": 20000, "structure_specific_heat_j_kgk": 900,
           "air_volume_m3": 150, "air_pressure_pa": 101325}
REGOLITH = {"albedo": 0.12, "emissivity": 0.95, "conductivity_w_mk": 0.002, "density_kg_m3": 1500,
            "heat_capacity_j_kgk": 600, "geothermal_flux_w_m2": 0.018}
L4 = {"lat": 0.0, "lon": 0.0, "start": "2027-01-01T00:00:00Z", "duration_h": 24 * 60, "step_min": 60, "level": 4,
      "panel": "vertical", "panel_area_m2": 60, "cell_efficiency": 0.3, "derating": 0.9,
      "battery_capacity_wh": 2.0e6, "battery_initial_soc": 1, "battery_min_soc": 0.2, "charge_efficiency": 0.95,
      "discharge_efficiency": 0.95, "critical_load_w": 1500, "deferrable_load_w": 1000, "comms_load_w": 200,
      "shed_soc": 0.5, "max_charge_w": 10000, "max_discharge_w": 10000, "habitat": HABITAT, "regolith": REGOLITH}
L4_KEYS = {"colony_status", "failure_after_days", "heater_w", "interior_k", "autonomy_h", "sunrise_margin_wh",
           "energy_breakdown", "degraded_days", "cold_soak_h", "min_battery_capacity_wh", "min_panel_area_m2"}


def test_level_4_endpoint_fields_conservation_and_sizing():
    r = client.post("/api/v1/power", json=L4)
    assert r.status_code == 200, r.text
    b = r.json()
    assert L4_KEYS <= set(b) and b["colony_status"] == "survives_independently" and b["survives"] is True
    assert b["failure_after_days"] is None and b["synodic_months"] == 2 and b["horizon_kind"] == "smooth_sphere"
    e = b["energy_breakdown"]
    used = e["critical_served_wh"] + e["heater_served_wh"] + e["comms_served_wh"] + e["deferrable_served_wh"]
    assert e["generated_wh"] == pytest.approx(used + e["curtailed_wh"] + e["charge_losses_wh"]
                                              + e["discharge_losses_wh"] + e["battery_change_wh"], abs=1e-3)
    assert e["generated_wh"] == pytest.approx(b["energy_wh"], rel=1e-9)
    assert len(b["heater_w"]) == len(b["t"]) and b["metabolic_heat_w"] == pytest.approx(4 * 140.5556, abs=0.01)
    # the reported minimum battery passes and 3 % less does not
    cmin = b["min_battery_capacity_wh"]
    lean = {**L4, "include_sizing": False}
    assert client.post("/api/v1/power", json={**lean, "battery_capacity_wh": cmin}).json()["colony_status"] \
        == "survives_independently"
    assert client.post("/api/v1/power", json={**lean, "battery_capacity_wh": 0.97 * cmin}).json()["colony_status"] \
        != "survives_independently"
    small = client.post("/api/v1/power", json={**lean, "battery_capacity_wh": 2.0e5}).json()
    assert small["colony_status"] == "failure_after_x_days" and small["survives"] is False
    assert small["failure_after_days"] > 0 and small["first_depletion_at"] == small["failure_at"]


@pytest.mark.parametrize("change", [{"duration_h": 24 * 20}, {"habitat": None}, {"shed_soc": 0.1},
                                    {"critical_load_w": None}, {"habitat": {**HABITAT, "t_min_k": 300}}])
def test_level_4_invalid_requests_return_422(change):
    assert client.post("/api/v1/power", json={**L4, **change}).status_code == 422
