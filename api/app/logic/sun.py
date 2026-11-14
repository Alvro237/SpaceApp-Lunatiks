"""Sun answers over a mission window, built on the engine's Series (positions and horizon are inputs).

- Sunlit = any part of the solar disc above the horizon (engine convention).
- Eclipse = the Earth's disc overlapping the Sun's as seen from the site: 1 partial, 2 total (engine codes).
  The Earth's atmosphere is ignored (no refraction ring), so totality is geometric.
- Durations at grid resolution: a run of k samples lasts k x step (each sample stands for one step),
  the same convention as engine.compute_metrics (eclipse_minutes). Refine with a smaller step_min.

Pure functions over NumPy arrays: no files, no network, no FastAPI.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .constants import MS_PER_HOUR


@dataclass(frozen=True)
class Event:
    start_ms: float
    end_ms: float            # last sample inside the event
    duration_h: float        # samples x step
    max_code: int            # highest code reached inside the event (eclipse: 1 partial, 2 total)
    max_value: float | None = None   # highest of ``values`` inside the event, when given


def events(t_ms: np.ndarray, codes: np.ndarray, values: np.ndarray | None = None) -> list[Event]:
    """Contiguous runs where ``codes > 0``, with the highest code (and value) reached in each run."""
    t = np.asarray(t_ms, dtype=np.float64)
    c = np.asarray(codes)
    on = c > 0
    if not on.any():
        return []
    step_h = (t[1] - t[0]) / MS_PER_HOUR if t.size > 1 else 0.0
    edges = np.diff(np.concatenate(([0], on.astype(np.int8), [0])))
    starts, ends = np.flatnonzero(edges == 1), np.flatnonzero(edges == -1) - 1
    v = None if values is None else np.asarray(values, dtype=np.float64)
    return [Event(start_ms=float(t[a]), end_ms=float(t[b]), duration_h=float((b - a + 1) * step_h),
                  max_code=int(c[a:b + 1].max()), max_value=None if v is None else float(v[a:b + 1].max()))
            for a, b in zip(starts, ends)]


def longest_run_h(flags: np.ndarray, t_ms: np.ndarray, target: bool = True) -> float:
    """Longest run of ``flags == target`` in hours (samples x step)."""
    f = np.asarray(flags, dtype=bool) == target
    if not f.any() or len(t_ms) < 2:
        return 0.0
    edges = np.diff(np.concatenate(([0], f.astype(np.int8), [0])))
    run = int((np.flatnonzero(edges == -1) - np.flatnonzero(edges == 1)).max())
    return run * float(t_ms[1] - t_ms[0]) / MS_PER_HOUR


def elevation_stats(sun_el: np.ndarray, sunlit: np.ndarray) -> dict:
    """Max, min, and mean elevation of the disc centre while sunlit (None when never sunlit), degrees."""
    el = np.asarray(sun_el, dtype=np.float64)
    lit = np.asarray(sunlit, dtype=bool)
    return {"max_deg": float(el.max()), "min_deg": float(el.min()),
            "mean_sunlit_deg": float(el[lit].mean()) if lit.any() else None}
