"""Replanning sweep: many landing dates x one stay length, evaluated from ONE series per site.

The series covers [first landing, last landing + stay] on a regular grid. Window w starts at sample a_w and
holds the n + 1 samples a_w .. a_w + n (n = stay / step), exactly the samples a direct evaluation of that
window would use, so every number equals the single-window endpoints (tests check it).

- Fractions: prefix sums, O(1) per window.
- Longest runs and the battery: the windows are gathered into a (W, n + 1) matrix and processed column by
  column, vectorised across windows (n + 1 NumPy steps instead of W x n Python steps).

Pure functions over NumPy arrays: no files, no network, no FastAPI.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .power import BatteryParams


def window_starts(n_landings: int, landing_step_samples: int) -> np.ndarray:
    return np.arange(n_landings, dtype=np.int64) * landing_step_samples


def window_matrix(values: np.ndarray, starts: np.ndarray, n: int) -> np.ndarray:
    """Rows = windows, columns = the n + 1 samples of each window."""
    return np.asarray(values)[starts[:, None] + np.arange(n + 1)[None, :]]


def window_fraction(flags: np.ndarray, starts: np.ndarray, n: int) -> np.ndarray:
    """Share of the n + 1 samples of each window where ``flags`` is true (prefix sums)."""
    c = np.concatenate(([0], np.cumsum(np.asarray(flags, dtype=np.int64))))
    return (c[starts + n + 1] - c[starts]) / (n + 1)


def window_mean(values: np.ndarray, starts: np.ndarray, n: int) -> np.ndarray:
    c = np.concatenate(([0.0], np.cumsum(np.asarray(values, dtype=np.float64))))
    return (c[starts + n + 1] - c[starts]) / (n + 1)


def longest_run_rows(m: np.ndarray, target: bool = True) -> np.ndarray:
    """Longest run of ``target`` in each row of a boolean matrix, in samples."""
    x = np.asarray(m, dtype=bool) == target
    run = np.zeros(x.shape[0], dtype=np.int64)
    best = np.zeros(x.shape[0], dtype=np.int64)
    for j in range(x.shape[1]):
        run = (run + 1) * x[:, j]
        np.maximum(best, run, out=best)
    return best


@dataclass(frozen=True)
class BalanceRows:
    min_soc: np.ndarray        # per window, fraction of capacity
    final_soc: np.ndarray
    unserved_wh: np.ndarray
    survived: np.ndarray       # bool


def energy_balance_rows(array_w: np.ndarray, load_w: np.ndarray, dt_h: float, battery: BatteryParams) -> BalanceRows:
    """``power.energy_balance`` for every row at once (same rules: capacity cap, floor, efficiencies)."""
    p, q = np.asarray(array_w, dtype=np.float64), np.asarray(load_w, dtype=np.float64)
    cap, floor = battery.capacity_wh, battery.min_soc * battery.capacity_wh
    eta_c, eta_d = battery.charge_efficiency, battery.discharge_efficiency
    e = np.full(p.shape[0], battery.initial_soc * cap)
    low = e.copy()
    unserved = np.zeros(p.shape[0])
    for j in range(p.shape[1] - 1):
        net = p[:, j] - q[:, j]
        charge = np.minimum(np.maximum(net, 0.0) * eta_c * dt_h, cap - e)
        need = np.maximum(-net, 0.0) * dt_h
        draw = np.minimum(need / eta_d, np.maximum(e - floor, 0.0))
        unserved += need - draw * eta_d
        e = e + charge - draw
        np.minimum(low, e, out=low)
    unserved[unserved < 1e-9] = 0.0
    return BalanceRows(min_soc=low / cap, final_soc=e / cap, unserved_wh=unserved, survived=unserved == 0.0)
