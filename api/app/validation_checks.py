"""Validation checks of the MECH models, run against the real datasets (glue: data + logic, like services.py).

Each check states what it compares, the reference value and where that reference comes from (a published
event, an analytic solution or a consistency identity), the tolerance, and whether it passes. The results feed
GET /api/v1/validation together with the pipeline's own validation (data/validation.json).
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timezone

import numpy as np

from . import services
from .db.store import DataStore
from .logic.eclipse import disc_overlap_fraction, obscuration
from .logic.engine import AnalysisParams, compute_metrics, time_grid, evaluate
from .logic.power import ArrayParams, BatteryParams, LoadParams, array_power_w, energy_balance, load_series_w
from .logic.radiation import shielding_factor
from .logic.sweep import energy_balance_rows, window_matrix, window_starts
from .logic.thermal import SIGMA, Equipment, Regolith, simulate

H = 3_600_000.0


@dataclass(frozen=True)
class Check:
    id: str
    model: str
    description: str
    reference: str
    source: str
    computed: str
    tolerance: str
    passed: bool


def _ms(y, mo, d, h=0, mi=0) -> float:
    return services.to_ms(datetime(y, mo, d, h, mi, tzinfo=timezone.utc))


def eclipse_blue_ghost(store: DataStore) -> Check:
    site = store.sites.get("blue-ghost-1")
    model = services.model_for_site(store, site, 2.0)
    t = np.array([_ms(2025, 3, 14, 6, 30), _ms(2025, 3, 14, 6, 59), _ms(2025, 3, 14, 7, 30),
                  _ms(2025, 3, 14, 2, 0), _ms(2025, 3, 14, 11, 0)])
    occ = obscuration(evaluate(store.ephemeris, model, t))
    ok = bool(np.all(occ[:3] >= 1.0 - 1e-9) and np.all(occ[3:] == 0.0))
    return Check("eclipse-blue-ghost-2025-03-14", "sun / power",
                 "Sun totally hidden by the Earth at Blue Ghost 1 during the totality of the 2025-03-14 lunar eclipse, "
                 "and not eclipsed well before and after",
                 "totality 06:26-07:31 UTC, greatest 06:59 UTC (whole Moon in the umbra)",
                 "NASA GSFC Eclipse Web Site (F. Espenak), total lunar eclipse of 2025 March 14",
                 "obscuration at 06:30, 06:59, 07:30 = " + ", ".join(f"{x:.3f}" for x in occ[:3])
                 + "; at 02:00 and 11:00 = " + ", ".join(f"{x:.3f}" for x in occ[3:]),
                 "1.000 inside totality, 0.000 outside", ok)


def disc_overlap_analytic() -> Check:
    ref = (2 * math.acos(0.5) - 0.5 * math.sqrt(3)) / math.pi
    got = float(disc_overlap_fraction(1.0, 1.0, 1.0)[0])
    return Check("eclipse-overlap-analytic", "sun / power",
                 "Covered fraction of a disc by an equal disc one radius away",
                 f"{ref:.6f}", "analytic circle-circle overlap", f"{got:.6f}", "1e-9", abs(got - ref) < 1e-9)


def earth_near_far(store: DataStore) -> Check:
    t = time_grid(_ms(2027, 3, 1), 24 * 30, 60)
    p = AnalysisParams()
    near = evaluate(store.ephemeris, services.model_for_point(store, 0.0, 0.0, 2.0), t).comms(p).mean()
    far = evaluate(store.ephemeris, services.model_for_point(store, 0.0, 180.0, 2.0), t).comms(p).mean()
    return Check("earth-near-far-side", "earth",
                 "Earth visibility over a month at the centre of the near side and of the far side",
                 "near side 100 %, far side 0 % (synchronous rotation)", "geometry of the Earth-Moon system",
                 f"near {100 * near:.1f} %, far {100 * far:.1f} %", "exact", bool(near == 1.0 and far == 0.0))


def thermal_equilibrium() -> Check:
    F, eps = 1361.0 * 0.88, 0.95
    ref = (F / (eps * SIGMA)) ** 0.25
    reg = Regolith(albedo=0.12, emissivity=eps, conductivity_w_mk=0.002, density_kg_m3=1500.0,
                   heat_capacity_j_kgk=600.0, geothermal_flux_w_m2=0.0)
    got = simulate(np.arange(49) * H, np.full(49, F), reg, initial_k=ref).surface_k[-1]
    return Check("thermal-radiative-equilibrium", "thermal",
                 "Regolith under constant sunlight started at equilibrium stays there (48 h)",
                 f"{ref:.2f} K", "Stefan-Boltzmann law: eps sigma T^4 = absorbed flux", f"{got:.2f} K", "0.05 K",
                 abs(got - ref) < 0.05)


def thermal_equipment_dark() -> Check:
    ref = (10.0 / (0.8 * 0.5 * SIGMA)) ** 0.25
    reg = Regolith(0.12, 0.95, 0.002, 1500.0, 600.0, 0.0)
    eq = Equipment(0.3, 0.8, 0.5, 0.5, 0.0, 100.0, 10.0)
    got = simulate(np.arange(49) * H, np.zeros(49), reg, eq, np.zeros(49), initial_k=250.0).equipment_k[-1]
    return Check("thermal-equipment-dark", "thermal",
                 "Equipment box in the dark with 10 W inside reaches its radiative balance (48 h)",
                 f"{ref:.2f} K", "Stefan-Boltzmann law: Q = eps A sigma T^4", f"{got:.2f} K", "0.1 K",
                 abs(got - ref) < 0.1)


def power_energy_conservation(store: DataStore) -> Check:
    model = services.model_for_site(store, store.sites.get("mons-malapert"), 2.0)
    s = services.evaluate_window(store, model, _ms(2027, 3, 1), 720, 60)
    p = array_power_w(s.power_w_m2, ArrayParams(2.0, 0.3, 0.9)) * (1.0 - obscuration(s))
    load = load_series_w(s.sunlit(), LoadParams(50.0, 80.0))
    b = energy_balance(s.t_ms, p, load, BatteryParams(2000.0, 1.0, 0.2, 0.95, 0.95))
    total = float(np.sum(load[:-1]))                                 # 1 h steps
    got = b.consumed_wh + b.unserved_wh
    return Check("power-energy-conservation", "power",
                 "Battery balance at Mons Malapert, March 2027: served + unserved load equals the total load",
                 f"{total:.3f} Wh", "energy conservation", f"{got:.3f} Wh", "1e-6 Wh", abs(got - total) < 1e-6)


def sweep_vs_single(store: DataStore) -> Check:
    model = services.model_for_site(store, store.sites.get("im-2"), 2.0)
    s = services.evaluate_window(store, model, _ms(2027, 3, 1), 24 * 9 + 96, 60)
    p = array_power_w(s.power_w_m2, ArrayParams(2.0, 0.3, 0.9))
    q = load_series_w(s.sunlit(), LoadParams(60.0, 40.0))
    bat = BatteryParams(3000.0, 1.0, 0.2, 0.95, 0.95)
    rows = energy_balance_rows(window_matrix(p, window_starts(10, 24), 96), window_matrix(q, window_starts(10, 24), 96), 1.0, bat)
    diffs = [abs(rows.min_soc[k] - energy_balance(s.t_ms[24 * k:24 * k + 97], p[24 * k:24 * k + 97],
                                                   q[24 * k:24 * k + 97], bat).min_soc) for k in range(10)]
    return Check("sweep-equals-single-window", "sweep",
                 "Vectorised sweep (10 landings at IM-2) equals the single-window battery model for each landing",
                 "identical minimum state of charge", "consistency identity", f"max difference {max(diffs):.2e}",
                 "1e-9", max(diffs) < 1e-9)


def radiation_flat_ground(store: DataStore) -> Check:
    got = shielding_factor(2 * math.pi)
    rad = store.radiation
    ok_data = rad is not None and rad.available and rad.meta["count"] > 1000
    return Check("radiation-flat-ground", "radiation",
                 "Flat ground sees half of an isotropic sky; CRaTER record loaded",
                 "shielding 0.5; record 2009-06-19 to 2013-04-30", "solid-angle geometry; LRO CRaTER (UNH)",
                 f"shielding {got:.3f}; record {rad.meta.get('first')} to {rad.meta.get('last')}" if ok_data else
                 f"shielding {got:.3f}; record missing", "exact", bool(abs(got - 0.5) < 1e-12 and ok_data))


def run_all(store: DataStore) -> list[Check]:
    return [eclipse_blue_ghost(store), disc_overlap_analytic(), earth_near_far(store), thermal_equilibrium(),
            thermal_equipment_dark(), power_energy_conservation(store), sweep_vs_single(store),
            radiation_flat_ground(store)]
