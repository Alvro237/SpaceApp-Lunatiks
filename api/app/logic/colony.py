"""Colony analysis (power level 4): habitat heating, prioritised loads and a power-limited battery.

Habitat, two nodes (team decision 2026-11-14):
    interior: air + structure at one temperature T_in, heat capacity
        C = m_s c_s + m_air c_p,air,   m_air = p V M_air / (R T_set)   (ideal gas, Earth-like air)
    skin: massless outer surface at T_s, solved every step from its balance
        UA (T_in - T_s) + Q_abs = eps A sigma T_s^4
        Q_abs = alpha (A_sun G + A F_g rho_g H) + eps A F_g eps_g sigma T_g^4
    A external area; A_sun = 0.5 A (sun-facing projected area) and F_g = 0.5 (view factor to the ground) are
    team decisions; G = S f_vis (1 - occ) direct sunlight; H = G sin(el) sunlight on flat ground, reflected with
    the ground albedo rho_g; T_g regolith surface temperature (app/logic/thermal), ground emissivity eps_g.
    Heat leak through the insulation: Q_leak = UA (T_in - T_s).

Internal gains: crew metabolic heat (crew x per-person rate) plus every watt of electrical load served inside
the habitat (all electrical energy ends as heat). Resistive heater, efficiency 1:
    P_heat = max(0, Q_leak - gains + C (T_set - T_in) / dt)      (the last term only below T_set)
The holding part max(0, Q_leak - gains) is critical; the reheating part (after a failure) is served next, before the
deferrable loads, and its lack is not a failure. Heat in excess of the leak is a cooling demand (heat to reject); its electrical cost is not modelled.
When the heater is not fully served the interior floats: C dT_in/dt = gains_served + P_heat,served - Q_leak.

Per-person metabolic heat default: mean of the NASA BVAD (NASA/TP-2015-218570 Rev 1, 2018) Table 3-21 rates for a
40-year-old male and female (1.829 m, 82 kg): (12.996 + 11.292) / 2 MJ/CM-d = 140.6 W. All of it is counted as
heat to the cabin (sensible and latent; the latent part is released where the humidity is condensed, inside).

Loads and battery, per step i -> i+1 (left Riemann sum as in app/logic/power):
    critical = critical load (+ comms when comms_critical) + holding heater; served first, then reheating
    other    = deferrable load (+ comms when not critical); shed while SoC < shed_soc (degraded mode)
    supply   = array power + battery discharge (<= max_discharge_w and the energy above the floor)
    surplus  = charges the battery at <= max_charge_w (array side), x charge efficiency, capped at full
Failure = critical load not served. Status over whole synodic months:
    failure_after_x_days       critical load unserved at some sample (the simulated time, not a forecast)
    survives_independently     no failure, and the stored energy at the end of the last whole synodic month is at
                               least that at the start, possibly after repeating the window from its end state
                               (then the window repeated forever never fails: the model is monotonic in E)
    survives_window_declining  no failure in the window, but repeating it keeps draining the battery or fails

Pure functions over NumPy arrays: no files, no network, no FastAPI.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from .constants import MS_PER_HOUR, SYNODIC_MONTH_DAYS
from .power import BatteryParams
from .thermal import SIGMA

SUN_AREA_FRACTION = 0.5          # A_sun / A, team decision 2026-11-14
GROUND_VIEW_FACTOR = 0.5         # F_g, team decision 2026-11-14
METABOLIC_W_PER_CREW = (12.996e6 + 11.292e6) / 2.0 / 86_400.0   # NASA BVAD Rev 1 Table 3-21, 40 years: 140.6 W
R_GAS = 8.314462618              # J mol-1 K-1 (CODATA 2018)
M_AIR = 0.0289644                # kg mol-1, dry air (U.S. Standard Atmosphere 1976)
CP_AIR = 1007.0                  # J kg-1 K-1, air at 300 K (Incropera et al., Table A.4)
SYNODIC_MONTH_H = SYNODIC_MONTH_DAYS * 24.0


@dataclass(frozen=True)
class Habitat:
    crew_count: int
    t_set_k: float
    t_min_k: float
    ua_w_k: float
    area_m2: float
    skin_absorptivity: float
    skin_emissivity: float
    structure_mass_kg: float
    structure_specific_heat_j_kgk: float
    air_volume_m3: float
    air_pressure_pa: float
    metabolic_w_per_crew: float = METABOLIC_W_PER_CREW

    @property
    def metabolic_w(self) -> float:
        return self.crew_count * self.metabolic_w_per_crew

    @property
    def air_mass_kg(self) -> float:
        return self.air_pressure_pa * self.air_volume_m3 * M_AIR / (R_GAS * self.t_set_k)

    @property
    def heat_capacity_j_k(self) -> float:
        return self.structure_mass_kg * self.structure_specific_heat_j_kgk + self.air_mass_kg * CP_AIR


@dataclass(frozen=True)
class ColonyLoads:
    critical_w: float
    deferrable_w: float
    comms_w: float
    comms_critical: bool
    shed_soc: float
    max_charge_w: float
    max_discharge_w: float


def absorbed_by_skin_w(direct_w_m2, ground_sun_w_m2, ground_k, ground_albedo: float, ground_emissivity: float,
                       hab: Habitat) -> np.ndarray:
    """Q_abs (W): sunlight on A_sun, sunlight reflected by the ground and ground infrared (module docstring)."""
    a, fg = hab.area_m2, GROUND_VIEW_FACTOR
    solar = hab.skin_absorptivity * (SUN_AREA_FRACTION * a * np.asarray(direct_w_m2)
                                     + a * fg * ground_albedo * np.asarray(ground_sun_w_m2))
    ir = hab.skin_emissivity * a * fg * ground_emissivity * SIGMA * np.asarray(ground_k, dtype=np.float64) ** 4
    return solar + ir


def skin_k(t_in_k, q_abs_w, hab: Habitat) -> np.ndarray:
    """Solve eps A sigma T_s^4 + UA T_s = UA T_in + Q_abs by Newton. f is increasing and convex, and the start
    point max(T_in, (Q_abs / eps A sigma)^1/4) has f >= 0, so the iteration decreases monotonically to the root."""
    k = hab.skin_emissivity * hab.area_m2 * SIGMA
    rhs = hab.ua_w_k * np.asarray(t_in_k, dtype=np.float64) + np.asarray(q_abs_w, dtype=np.float64)
    ts = np.maximum(np.asarray(t_in_k, dtype=np.float64), (np.asarray(q_abs_w, dtype=np.float64) / k) ** 0.25)
    for _ in range(60):
        f = k * ts ** 4 + hab.ua_w_k * ts - rhs
        step = f / (4.0 * k * ts ** 3 + hab.ua_w_k)
        ts = ts - step
        if np.all(np.abs(step) < 1e-9):
            break
    return ts


def leak_w(t_in_k, q_abs_w, hab: Habitat) -> np.ndarray:
    """Heat leaving the interior through the insulation, UA (T_in - T_s), W."""
    return hab.ua_w_k * (np.asarray(t_in_k, dtype=np.float64) - skin_k(t_in_k, q_abs_w, hab))


@dataclass
class ColonyRun:
    soc_wh: np.ndarray
    interior_k: np.ndarray
    skin_k: np.ndarray
    heater_w: np.ndarray            # heater demand at each sample
    cooling_w: np.ndarray           # heat to reject at each sample
    critical_demand_w: np.ndarray   # critical load + holding heater (+ comms when critical)
    total_demand_w: np.ndarray      # critical + reheating + non-shed other loads
    served_w: np.ndarray            # electrical load served at each step
    failed: np.ndarray              # the step ending at this sample left critical load unserved
    shed: np.ndarray                # deferrable loads switched off during the step starting here
    energy: dict
    first_failure_index: int | None    # sample at whose step the critical load first went unserved


def simulate(t_ms: np.ndarray, array_w: np.ndarray, link: np.ndarray, q_abs_w: np.ndarray, hab: Habitat,
             loads: ColonyLoads, battery: BatteryParams, stop_at_failure: bool = False,
             at_set: tuple[list, list] | None = None) -> ColonyRun:
    """Step the habitat temperature and the battery together (formulas in the module docstring).

    Plain-float loop (a year at one-hour steps in a few tens of ms). ``at_set``: the leak and skin temperature at
    T_set for every sample, precomputed once when the same environment is run many times (sizing)."""
    t = np.asarray(t_ms, dtype=np.float64)
    n = t.size
    dth = (np.diff(t) / MS_PER_HOUR).tolist() + [0.0]
    gen = np.asarray(array_w, dtype=np.float64).tolist()
    lk = np.asarray(link, dtype=bool).tolist()
    qa = np.asarray(q_abs_w, dtype=np.float64)
    if at_set is None:
        at_set = (leak_w(np.full(n, hab.t_set_k), qa, hab).tolist(), skin_k(np.full(n, hab.t_set_k), qa, hab).tolist())
    leak_set, skin_set = at_set
    qa = qa.tolist()
    C, ua, t_set, met = hab.heat_capacity_j_k, hab.ua_w_k, hab.t_set_k, hab.metabolic_w
    cap, floor = battery.capacity_wh, battery.min_soc * battery.capacity_wh
    eta_c, eta_d = battery.charge_efficiency, battery.discharge_efficiency
    shed_below = loads.shed_soc * cap - 1e-9
    crit_w, def_w, com_w, com_crit = loads.critical_w, loads.deferrable_w, loads.comms_w, loads.comms_critical
    max_c, max_d = loads.max_charge_w, loads.max_discharge_w
    k_rad = hab.skin_emissivity * hab.area_m2 * SIGMA

    def leak_at(t_in: float, q: float) -> tuple[float, float]:
        """Scalar skin solve (same Newton as skin_k, plain floats for speed): (leak W, skin K)."""
        rhs = ua * t_in + q
        ts = max(t_in, (q / k_rad) ** 0.25)
        for _ in range(60):
            step = (k_rad * ts ** 4 + ua * ts - rhs) / (4.0 * k_rad * ts ** 3 + ua)
            ts -= step
            if abs(step) < 1e-9:
                break
        return ua * (t_in - ts), ts

    soc, tin_a, ts_a, heat, cool, crit_a, tot_a, served_a, failed, shed_a = ([] for _ in range(10))
    gsum = c_srv = h_srv = cm_srv = d_srv = c_uns = o_uns = shed_e = curt = l_ch = l_dis = 0.0
    e, tin, first = battery.initial_soc * cap, t_set, None
    for i in range(n):
        dt = dth[i]
        hold_set = tin >= t_set - 1e-9
        if hold_set:
            leak, ts = leak_set[i], skin_set[i]
        else:
            leak, ts = leak_at(tin, qa[i])
        shed = e < shed_below
        comms = com_w if lk[i] else 0.0
        crit_other = crit_w + comms if com_crit else crit_w
        other = 0.0 if shed else (def_w if com_crit else def_w + comms)
        hold = leak - met - crit_other - other                        # heater power that holds the temperature
        if hold < 0.0:
            hold = 0.0
        recover = C * (t_set - tin) / (dt * 3600.0) if (not hold_set and dt > 0.0) else 0.0
        soc.append(e); tin_a.append(tin); ts_a.append(ts); heat.append(hold + recover); shed_a.append(shed)
        crit_a.append(crit_other + hold); tot_a.append(crit_other + hold + recover + other)
        if i == n - 1:
            served_a.append(0.0); cool.append(0.0); failed.append(False)
            break
        p = gen[i]
        avail = (e - floor) * eta_d / dt if e > floor else 0.0
        if avail > max_d:
            avail = max_d
        supply = p + avail
        need_c = crit_other + hold
        s_c = need_c if need_c <= supply else supply                 # critical first (life support, then heat)
        s_r = min(recover, supply - s_c)                              # then reheating after a failure
        s_o = min(other, supply - s_c - s_r)                          # then the deferrable loads
        s_co = crit_other if crit_other <= s_c else s_c
        served = s_c + s_r + s_o
        served_a.append(served)
        gsum += p * dt
        c_srv += s_co * dt
        h_srv += (s_c - s_co + s_r) * dt
        if com_crit:
            cm_srv += min(comms, s_co) * dt
            d_srv += s_o * dt
        else:
            cpart = 0.0 if shed else comms
            cs = cpart if cpart <= s_o else s_o
            cm_srv += cs * dt
            d_srv += (s_o - cs) * dt
        c_uns += (need_c - s_c) * dt
        o_uns += (other - s_o) * dt
        if shed:
            shed_e += (def_w if com_crit else def_w + comms) * dt
        net = p - served
        if net >= 0.0:
            accepted = (net if net <= max_c else max_c) * dt
            stored = accepted * eta_c
            if stored > cap - e:
                stored = cap - e if cap > e else 0.0
                accepted = stored / eta_c
            curt += net * dt - accepted
            l_ch += accepted - stored
            e += stored
        else:
            drawn = -net * dt / eta_d
            l_dis += drawn + net * dt
            e -= drawn
        fail = need_c - s_c > 1e-9
        failed.append(fail)
        if fail and first is None:
            first = i                                                 # supply first falls short at this sample
            if stop_at_failure:
                break
        # interior temperature: every served watt and the crew heat end inside
        gains = met + served
        dt_s = dt * 3600.0
        if hold_set and not fail and s_o >= other - 1e-9:
            cool.append(gains - leak if gains > leak else 0.0)        # >= 0 by construction of the holding demand
            tin = t_set
        else:
            m = max(1, math.ceil(4.0 * dt_s * ua / C))
            h = dt_s / m
            for _ in range(m):
                tin += h * (gains - leak_at(tin, qa[i])[0]) / C
            if tin > t_set:
                cool.append((tin - t_set) * C / dt_s)
                tin = t_set
            else:
                cool.append(0.0)
    # failed[j] refers to the step ending at sample j: shift by one so index 0 is never a failure
    failed = ([False] + failed)[:n]
    m_ = len(soc)
    pad = lambda a, v=0.0: np.array(a + [v] * (n - len(a)))  # noqa: E731  (only after an early stop)
    en = {"generated": gsum, "critical_served": c_srv, "heater_served": h_srv, "comms_served": cm_srv,
          "deferrable_served": d_srv, "critical_unserved": c_uns, "noncritical_unserved": o_uns, "shed": shed_e,
          "curtailed": curt, "charge_losses": l_ch, "discharge_losses": l_dis}
    return ColonyRun(soc_wh=pad(soc, soc[-1] if m_ else 0.0), interior_k=pad(tin_a), skin_k=pad(ts_a),
                     heater_w=pad(heat), cooling_w=pad(cool), critical_demand_w=pad(crit_a), total_demand_w=pad(tot_a),
                     served_w=pad(served_a), failed=pad(failed, False).astype(bool), shed=pad(shed_a, False).astype(bool),
                     energy=en, first_failure_index=first)


def cycle_indices(t_ms: np.ndarray) -> np.ndarray:
    """Sample indices at start + k synodic months, k = 0 .. number of whole months in the window."""
    t = np.asarray(t_ms, dtype=np.float64)
    period = SYNODIC_MONTH_H * MS_PER_HOUR
    k = int((t[-1] - t[0]) // period + 1e-9)
    return np.searchsorted(t, t[0] + np.arange(k + 1) * period - 1e-6)


def _month_ends(run: ColonyRun, idx: np.ndarray) -> tuple[float, float]:
    return float(run.soc_wh[idx[0]]), float(run.soc_wh[idx[-1]])


def status(t_ms: np.ndarray, run: ColonyRun, rerun, capacity_wh: float, max_passes: int = 6) -> tuple[str, list[float]]:
    """Colony status and the state-of-charge change over each whole synodic month (fraction of capacity).

    No failure and E(end of the last whole month) >= E(start) - tol: sustainable (the model is monotonic in the
    stored energy, so repeating the window never fails). Otherwise the window is repeated from the lower end state
    (``rerun(initial_soc) -> ColonyRun``), as the battery would be on the next pass: if it settles (same test) the
    colony is sustainable at that lower periodic state; if a repetition fails or it keeps falling after
    ``max_passes``, it is declining. tol = the largest one-step change of stored energy (phase mismatch of the
    month ends with the sampling step) plus 1e-6 of the capacity."""
    idx = cycle_indices(t_ms)
    changes = [float((run.soc_wh[b] - run.soc_wh[a]) / capacity_wh) for a, b in zip(idx[:-1], idx[1:])]
    if run.first_failure_index is not None:
        return "failure_after_x_days", changes
    cur = run
    for _ in range(max_passes):
        tol = float(np.max(np.abs(np.diff(cur.soc_wh)))) + 1e-6 * capacity_wh if cur.soc_wh.size > 1 else 0.0
        e0, e1 = _month_ends(cur, idx)
        if e1 >= e0 - tol:
            return "survives_independently", changes
        cur = rerun(e1 / capacity_wh)
        if cur.first_failure_index is not None:
            return "survives_window_declining", changes
    return "survives_window_declining", changes


def autonomy_h(run: ColonyRun, battery: BatteryParams, max_discharge_w: float) -> list[float | None]:
    """Hours the battery alone could carry the critical demand of each sample; null when that demand is zero."""
    floor = battery.min_soc * battery.capacity_wh
    out: list[float | None] = []
    for e, d in zip(run.soc_wh.tolist(), run.critical_demand_w.tolist()):
        if d <= 0.0:
            out.append(None)
        else:
            out.append(0.0 if d > max_discharge_w else max(e - floor, 0.0) * battery.discharge_efficiency / d)
    return out


def sunrise_margin_wh(run: ColonyRun, t_ms: np.ndarray, sunlit: np.ndarray, battery: BatteryParams) -> list[float | None]:
    """In the dark: battery energy above the floor minus the energy the critical demand needs until the next sunlit
    sample (battery side, / discharge efficiency). Null while sunlit or when no sunrise comes inside the window."""
    lit = np.asarray(sunlit, dtype=bool)
    dth = np.diff(np.asarray(t_ms, dtype=np.float64)) / MS_PER_HOUR
    n = lit.size
    floor = battery.min_soc * battery.capacity_wh
    out: list[float | None] = [None] * n
    need, sunrise_ahead = 0.0, False
    for i in range(n - 1, -1, -1):
        if lit[i]:
            need, sunrise_ahead = 0.0, True
            continue
        if i < n - 1:
            need += run.critical_demand_w[i] * dth[i] / battery.discharge_efficiency
        if sunrise_ahead:
            out[i] = float(run.soc_wh[i] - floor - need)
    return out


def equilibrium_unheated_k(q_abs_w: float, hab: Habitat) -> float:
    """Interior temperature with no electrical heat, only the crew: solve UA (T - T_s(T)) = metabolic by bisection."""
    lo, hi = 1.0, max(hab.t_set_k, 1.0) * 4.0
    for _ in range(100):
        mid = 0.5 * (lo + hi)
        if float(leak_w(mid, q_abs_w, hab)) > hab.metabolic_w:
            hi = mid
        else:
            lo = mid
    return 0.5 * (lo + hi)


def cold_soak_h(q_abs_w: float, hab: Habitat, max_h: float = 24.0 * 365) -> float | None:
    """Hours from T_set down to T_min with all electrical power lost (only crew heat) in the given environment.
    None when the crew heat alone keeps the interior at or above T_min."""
    if equilibrium_unheated_k(q_abs_w, hab) >= hab.t_min_k:
        return None
    C = hab.heat_capacity_j_k
    h = min(600.0, 0.05 * C / hab.ua_w_k)
    tin, elapsed = hab.t_set_k, 0.0
    while tin > hab.t_min_k and elapsed < max_h * 3600.0:
        tin += h * (hab.metabolic_w - float(leak_w(tin, q_abs_w, hab))) / C
        elapsed += h
    return elapsed / 3600.0 if tin <= hab.t_min_k else None


def smallest_passing(passes, x0: float, iterations: int = 8, max_doublings: int = 12) -> float | None:
    """Smallest x > 0 with passes(x) True, assuming passes is monotonic in x, to within 0.4 % (8 bisections of a
    factor-2 bracket); None if not reached by x0 x 2^12."""
    if passes(x0):
        hi, lo = x0, x0 / 2.0
        for _ in range(30):
            if not passes(lo):
                break
            hi, lo = lo, lo / 2.0
        else:
            return hi
    else:
        lo, hi = x0, None
        for _ in range(max_doublings):
            cand = lo * 2.0
            if passes(cand):
                hi = cand
                break
            lo = cand
        if hi is None:
            return None
    for _ in range(iterations):
        mid = 0.5 * (lo + hi)
        if passes(mid):
            hi = mid
        else:
            lo = mid
    return hi
