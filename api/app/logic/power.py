"""Power levels for a lander or rover at one site over a mission window.

Three levels, each built on the previous one:

    1. Solar disc visible fraction over the horizon  -> engine.Series.sun_frac (no new physics)
    2. Array electrical power   P(t) = q(t) * A * eta * d
         q(t)  engine.Series.power_w_m2: 1361 W/m2 x (1 au / r)^2 x visible fraction x panel cosine factor
         A     array area (m2), eta cell/array efficiency (0..1), d derating for losses (0..1)
    3. Energy balance of a battery through the window (state of charge step by step)

Time integration: values are piecewise constant over each step, taken at the start of the step
(left Riemann sum). With n samples there are n - 1 steps of length dt; the error is of the order of
one step, so choose ``step_min`` small compared with the light and dark periods of interest.

Battery model (level 3), per step i -> i+1 with net = P_i - L_i:
    net >= 0:  E += net * eta_c * dt, capped at the capacity C; the excess is "curtailed"
    net <  0:  E -= |net| / eta_d * dt, floored at E_min = soc_min * C; the load not served once the
               battery reaches E_min is "unserved" (counted at the load, i.e. after eta_d)
L_i is the day load when any part of the Sun is above the horizon (Series.sunlit) and the night load
otherwise. Not modelled: battery ageing, temperature effects on the cells or the battery, voltage /
current limits, peak-power tracking losses beyond the derating factor, dust on the array.

Every parameter is an input; no value is assumed here. Ideal values (eta_c = eta_d = 1, d = 1,
soc_min = 0, one load) give the simplest reading. Pure functions over NumPy arrays: no files, no network, no FastAPI.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .constants import MS_PER_HOUR


@dataclass(frozen=True)
class ArrayParams:
    """area_m2: active array area (m2). efficiency: conversion efficiency (0..1).
    derating: product of other losses (wiring, temperature, mismatch, ...) (0..1)."""
    area_m2: float
    efficiency: float
    derating: float = 1.0


@dataclass(frozen=True)
class BatteryParams:
    """capacity_wh: nominal capacity (Wh). initial_soc, min_soc: state of charge as a fraction of the
    capacity (0..1). charge_efficiency, discharge_efficiency: one-way efficiencies (0..1)."""
    capacity_wh: float
    initial_soc: float
    min_soc: float = 0.0
    charge_efficiency: float = 1.0
    discharge_efficiency: float = 1.0


@dataclass(frozen=True)
class LoadParams:
    """day_w: electrical load while the Sun is visible (W). night_w: load without Sun (W)."""
    day_w: float
    night_w: float


def array_power_w(power_w_m2: np.ndarray, array: ArrayParams) -> np.ndarray:
    """Level 2: electrical power of the array (W) = q(t) * A * eta * d."""
    return np.asarray(power_w_m2, dtype=np.float64) * array.area_m2 * array.efficiency * array.derating


def step_hours(t_ms: np.ndarray) -> np.ndarray:
    """Length of each of the n - 1 steps, hours."""
    return np.diff(np.asarray(t_ms, dtype=np.float64)) / MS_PER_HOUR


def energy_wh(power_w: np.ndarray, t_ms: np.ndarray) -> float:
    """Energy over the window (Wh), left Riemann sum: sum of P_i * dt_i for i = 0 .. n-2."""
    p = np.asarray(power_w, dtype=np.float64)
    return float(np.sum(p[:-1] * step_hours(t_ms))) if p.size > 1 else 0.0


def load_series_w(sunlit: np.ndarray, load: LoadParams) -> np.ndarray:
    """Load per sample (W): day load where the Sun is visible, night load elsewhere."""
    return np.where(np.asarray(sunlit, dtype=bool), load.day_w, load.night_w).astype(np.float64)


@dataclass(frozen=True)
class Balance:
    soc_wh: np.ndarray             # battery energy at every sample (Wh)
    depleted: np.ndarray           # per sample: the step ending there left load unserved
    generated_wh: float            # array energy over the window
    consumed_wh: float             # load energy actually served
    unserved_wh: float             # load energy not served (battery at its floor)
    curtailed_wh: float            # array energy that could not be stored (battery full)
    min_soc: float                 # lowest state of charge reached (fraction of capacity)
    final_soc: float
    survived: bool                 # no load was ever left unserved
    first_depletion_index: int | None


def energy_balance(t_ms: np.ndarray, array_w: np.ndarray, load_w: np.ndarray,
                   battery: BatteryParams) -> Balance:
    """Level 3: state of charge through the window (formulas in the module docstring).

    Sequential by nature (the capacity cap and the floor make each step depend on the previous one):
    a plain loop over at most a few tens of thousands of steps, about a millisecond per thousand.
    """
    t = np.asarray(t_ms, dtype=np.float64)
    p = np.asarray(array_w, dtype=np.float64)
    q = np.asarray(load_w, dtype=np.float64)
    dt = step_hours(t)
    cap, floor = battery.capacity_wh, battery.min_soc * battery.capacity_wh
    eta_c, eta_d = battery.charge_efficiency, battery.discharge_efficiency
    soc = np.empty(t.size, dtype=np.float64)
    depleted = np.zeros(t.size, dtype=bool)
    e = battery.initial_soc * cap
    soc[0] = e
    served = unserved = curtailed = 0.0
    for i in range(t.size - 1):
        net = p[i] - q[i]
        if net >= 0.0:
            stored = net * eta_c * dt[i]
            room = cap - e
            if stored > room:
                curtailed += (stored - room) / eta_c      # back to array-side energy
                stored = room
            e += stored
            served += q[i] * dt[i]
        else:
            need = -net * dt[i]                          # load energy the battery must supply
            draw = need / eta_d
            available = max(e - floor, 0.0)
            if draw > available:
                supplied = available * eta_d
                unserved += need - supplied
                served += q[i] * dt[i] - (need - supplied)
                e -= available
                depleted[i + 1] = True
            else:
                e -= draw
                served += q[i] * dt[i]
        soc[i + 1] = e
    hits = np.flatnonzero(depleted)
    return Balance(soc_wh=soc, depleted=depleted, generated_wh=energy_wh(p, t), consumed_wh=served,
                   unserved_wh=unserved, curtailed_wh=curtailed, min_soc=float(soc.min() / cap),
                   final_soc=float(soc[-1] / cap), survived=hits.size == 0,
                   first_depletion_index=int(hits[0]) if hits.size else None)


def night_energy_wh(longest_dark_h: float, load: LoadParams, battery: BatteryParams) -> float:
    """Battery energy needed to carry the night load through the longest dark stretch, ignoring any
    partial sunlight inside it: night_w * hours / eta_d (Wh). Compare with the usable capacity."""
    return load.night_w * longest_dark_h / battery.discharge_efficiency


def usable_capacity_wh(battery: BatteryParams) -> float:
    """Energy between the floor and full charge: C * (1 - soc_min) (Wh)."""
    return battery.capacity_wh * (1.0 - battery.min_soc)
