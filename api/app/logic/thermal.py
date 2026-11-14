"""Thermal model (MECH): regolith surface temperature and an optional equipment node.

Absorbed solar flux on flat ground (W/m2):
    F(t) = (1 - A) * S(t) * f_vis(t) * (1 - obscuration(t)) * max(sin el(t), 0)
    S irradiance at the Moon's distance from the Sun, f_vis share of the solar disc above the local horizon.

Regolith: 1-D heat conduction with constant properties (k conductivity, rho density, c heat capacity):
    rho c dT/dt = k d2T/dz2
    surface node (half cell):  rho c dz0/2 dT0/dt = F - eps sigma T0^4 + k (T1 - T0) / dz0
    bottom:                    geothermal flux Q_geo flows up into the deepest node
The grid is geometric, from a fraction of the diurnal skin depth delta = sqrt(kappa P / pi) (P synodic month,
kappa = k / (rho c)) down to several skin depths. Explicit time stepping with sub-steps sized for stability.
Initial state: uniform at the radiative-equilibrium temperature of the mean absorbed flux plus the geothermal
flux over the window (no spin-up): the first lunar day of a window is the least reliable part, state it.

Equipment node (lumped, isothermal box), optional:
    C dT/dt = alpha A_sun G(t) + Q_int + eps A_rad sigma (F_ground T_surface^4 - T^4)
    G(t) = S f_vis (1 - obscuration): direct sunlight on the sun-facing area A_sun (no cosine: the area is the
    projected area towards the Sun); the radiator sees the ground with view factor F_ground and cold space
    (about 3 K, taken as 0) with the rest.

Not modelled: temperature-dependent conductivity and heat capacity (Diviner-derived models have them), slope
and orientation of the ground, infrared and reflected light from surrounding terrain (crater floors come out
colder than they are), conduction between equipment and ground, heaters with control.

Pure functions over NumPy arrays: no files, no network, no FastAPI.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from .constants import DEG, SYNODIC_MONTH_DAYS

SIGMA = 5.670374419e-8          # Stefan-Boltzmann constant, W m-2 K-4 (CODATA 2018)
T_STABILITY_K = 420.0           # hottest temperature assumed when sizing the explicit sub-steps


@dataclass(frozen=True)
class Regolith:
    albedo: float
    emissivity: float
    conductivity_w_mk: float
    density_kg_m3: float
    heat_capacity_j_kgk: float
    geothermal_flux_w_m2: float


@dataclass(frozen=True)
class Equipment:
    absorptivity: float
    emissivity: float
    sun_area_m2: float
    radiator_area_m2: float
    ground_view_factor: float
    heat_capacity_j_k: float
    internal_power_w: float


def absorbed_flux(irradiance, visible_fraction, obscuration, sun_el_deg, albedo: float) -> np.ndarray:
    """Solar flux absorbed by flat ground, W/m2 (formula in the module docstring)."""
    mu = np.maximum(np.sin(np.asarray(sun_el_deg) * DEG), 0.0)
    return (1.0 - albedo) * np.asarray(irradiance) * np.asarray(visible_fraction) * (1.0 - np.asarray(obscuration)) * mu


def direct_sun(irradiance, visible_fraction, obscuration) -> np.ndarray:
    """Direct solar irradiance on a surface facing the Sun, W/m2."""
    return np.asarray(irradiance) * np.asarray(visible_fraction) * (1.0 - np.asarray(obscuration))


def skin_depth_m(reg: Regolith) -> float:
    kappa = reg.conductivity_w_mk / (reg.density_kg_m3 * reg.heat_capacity_j_kgk)
    return math.sqrt(kappa * SYNODIC_MONTH_DAYS * 86_400.0 / math.pi)


def grid(reg: Regolith, first_fraction: float = 1 / 15, growth: float = 1.12, depth_skins: float = 6.0) -> np.ndarray:
    """Layer thicknesses (m), geometric from delta * first_fraction down to depth_skins * delta."""
    d = skin_depth_m(reg)
    dz, total = [d * first_fraction], d * first_fraction
    while total < depth_skins * d:
        dz.append(dz[-1] * growth)
        total += dz[-1]
    return np.array(dz)


@dataclass(frozen=True)
class ThermalResult:
    surface_k: np.ndarray          # at every sample
    deep_k: np.ndarray             # deepest node at every sample
    equipment_k: np.ndarray | None
    initial_k: float
    substeps_per_step: int
    grid_depth_m: float


def simulate(t_ms: np.ndarray, flux_w_m2: np.ndarray, reg: Regolith, equipment: Equipment | None = None,
             sun_w_m2: np.ndarray | None = None, initial_k: float | None = None) -> ThermalResult:
    """Integrate the regolith (and the equipment node) over the samples; forcing constant over each step."""
    t = np.asarray(t_ms, dtype=np.float64)
    F = np.asarray(flux_w_m2, dtype=np.float64)
    dz = grid(reg)
    rc = reg.density_kg_m3 * reg.heat_capacity_j_kgk
    k, eps = reg.conductivity_w_mk, reg.emissivity
    # node heat capacities per m2: half cell at the surface and at the bottom, full cells inside
    nodes = dz.size + 1
    cap = np.empty(nodes)
    cap[0] = rc * dz[0] / 2.0
    cap[1:-1] = rc * (dz[:-1] + dz[1:]) / 2.0
    cap[-1] = rc * dz[-1] / 2.0
    g = k / dz                                                   # conductance between node i and i + 1, W m-2 K-1
    T0 = initial_k if initial_k is not None else max(((F.mean() + reg.geothermal_flux_w_m2) / (eps * SIGMA)) ** 0.25, 1.0)
    T = np.full(nodes, T0)
    step_s = float(t[1] - t[0]) / 1000.0 if t.size > 1 else 0.0
    # explicit stability: conduction cap/(g_left+g_right) and surface radiation cap0/(4 eps sigma T^3)
    tau = np.min(cap / (np.concatenate(([0.0], g)) + np.concatenate((g, [0.0]))))
    tau = min(tau, cap[0] / (4.0 * eps * SIGMA * T_STABILITY_K ** 3))
    Te = None
    if equipment is not None:
        Te = T0
        tau = min(tau, equipment.heat_capacity_j_k / (4.0 * equipment.emissivity * equipment.radiator_area_m2
                                                       * SIGMA * T_STABILITY_K ** 3))
    sub = max(1, int(math.ceil(step_s / (0.4 * tau)))) if step_s > 0 else 1
    h = step_s / sub
    surf, deep = np.empty(t.size), np.empty(t.size)
    eq = np.empty(t.size) if equipment is not None else None
    surf[0], deep[0] = T[0], T[-1]
    if eq is not None:
        eq[0] = Te
    G = None if equipment is None else np.asarray(sun_w_m2, dtype=np.float64)
    for i in range(t.size - 1):
        for _ in range(sub):
            flow = g * (T[1:] - T[:-1])                          # heat into node i from node i + 1
            dT = np.empty(nodes)
            dT[0] = F[i] - eps * SIGMA * T[0] ** 4 + flow[0]
            dT[1:-1] = flow[1:] - flow[:-1]
            dT[-1] = reg.geothermal_flux_w_m2 - flow[-1]
            if equipment is not None:
                e = equipment
                q = (e.absorptivity * e.sun_area_m2 * G[i] + e.internal_power_w
                     + e.emissivity * e.radiator_area_m2 * SIGMA * (e.ground_view_factor * T[0] ** 4 - Te ** 4))
                Te = max(Te + h * q / e.heat_capacity_j_k, 1.0)
            T = np.maximum(T + h * dT / cap, 1.0)
        surf[i + 1], deep[i + 1] = T[0], T[-1]
        if eq is not None:
            eq[i + 1] = Te
    return ThermalResult(surface_k=surf, deep_k=deep, equipment_k=eq, initial_k=float(T0), substeps_per_step=sub,
                         grid_depth_m=float(dz.sum()))


def surface_implicit(t_ms: np.ndarray, flux_w_m2: np.ndarray, reg: Regolith, max_substep_s: float = 600.0) -> np.ndarray:
    """Regolith surface temperature (K) with the same grid, physics and initial state as ``simulate``, but backward
    Euler in time with the surface emission linearised about the previous value (eps sigma (4 T*^3 T - 3 T*^4)).
    Unconditionally stable: 10-minute sub-steps instead of thousands per hour, a year at a one-hour step in about
    0.6 s. Against ``simulate`` at the equator over 60 days: 99 % of samples within 0.5 K, worst 3.7 K just after
    sunset. Used where only the surface temperature is needed (colony analysis).

    Each sub-step solves (A0 + c e0 e0^T) T = b, A0 = diag(cap / h) + conduction matrix (constant), c = 4 eps sigma T*^3,
    by Sherman-Morrison with A0^-1 computed once.
    """
    t = np.asarray(t_ms, dtype=np.float64)
    F = np.asarray(flux_w_m2, dtype=np.float64)
    dz = grid(reg)
    rc = reg.density_kg_m3 * reg.heat_capacity_j_kgk
    k, eps = reg.conductivity_w_mk, reg.emissivity
    nodes = dz.size + 1
    cap = np.empty(nodes)
    cap[0] = rc * dz[0] / 2.0
    cap[1:-1] = rc * (dz[:-1] + dz[1:]) / 2.0
    cap[-1] = rc * dz[-1] / 2.0
    g = k / dz
    T = np.full(nodes, max(((F.mean() + reg.geothermal_flux_w_m2) / (eps * SIGMA)) ** 0.25, 1.0))
    out = np.empty(t.size)
    out[0] = T[0]
    if t.size < 2:
        return out
    step_s = float(t[1] - t[0]) / 1000.0
    sub = max(1, int(math.ceil(step_s / max_substep_s)))
    h = step_s / sub
    A0 = np.diag(cap / h)
    idx = np.arange(nodes - 1)
    A0[idx, idx] += g
    A0[idx + 1, idx + 1] += g
    A0[idx, idx + 1] -= g
    A0[idx + 1, idx] -= g
    inv = np.linalg.inv(A0)
    col0, inv00 = inv[:, 0].copy(), inv[0, 0]
    es = eps * SIGMA
    for i in range(t.size - 1):
        for _ in range(sub):
            ts = T[0]
            b = cap / h * T
            b[0] += F[i] + 3.0 * es * ts ** 4
            b[-1] += reg.geothermal_flux_w_m2
            y = inv @ b
            c = 4.0 * es * ts ** 3
            T = np.maximum(y - col0 * (c * y[0] / (1.0 + c * inv00)), 1.0)
        out[i + 1] = T[0]
    return out


@dataclass(frozen=True)
class LimitCheck:
    passed: bool
    fraction_above: float
    longest_above_h: float
    above: np.ndarray            # per sample


def check_max(t_ms: np.ndarray, temps_k: np.ndarray, max_k: float, mode: str, max_hours_above: float = 0.0) -> LimitCheck:
    """discrete: fails if the limit is exceeded at any sample; continuous: fails if it stays exceeded for longer
    than ``max_hours_above`` (runs counted as samples x step)."""
    above = np.asarray(temps_k) > max_k
    step_h = float(t_ms[1] - t_ms[0]) / 3_600_000.0 if len(t_ms) > 1 else 0.0
    run = longest = 0
    for a in above:
        run = run + 1 if a else 0
        longest = max(longest, run)
    longest_h = longest * step_h
    passed = (not above.any()) if mode == "discrete" else longest_h <= max_hours_above
    return LimitCheck(passed=bool(passed), fraction_above=float(above.mean()), longest_above_h=longest_h, above=above)
