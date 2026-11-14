"""Hard filters (pass / fail). One constraint = one pure function with a threshold set by the user.

Contract
    @register("my_constraint")
    def my_constraint(ctx: ConstraintContext, threshold: dict) -> ConstraintResult: ...

* ``ctx`` carries everything already computed for the candidate (site, mission window, time series,
  metrics, dataset look-ups). A constraint never reads files and never calls the network: if it
  needs a new dataset value, add it to ``ConstraintContext.lookups`` in ``app/services.py``.
* ``threshold`` is the user's input for this constraint, already validated by the request schema.
* Return ``passed=None`` with ``basis="unavailable"`` when the data needed does not exist at that
  point. Never guess: an unknown is reported as unknown and the caller decides how to treat it.
* Time-based constraints answer in both forms the team asked for: ``fraction`` (share of the mission
  time that satisfies the condition) and ``ranges`` (the time ranges where it does).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Literal

from ..engine import AnalysisParams, Metrics, Series

Basis = Literal["computed", "dataset", "unavailable"]


@dataclass(frozen=True)
class ConstraintContext:
    site_id: str | None
    lat: float
    lon: float
    start_ms: float                     # landing / start of the mission window
    duration_h: float
    series: Series                      # evaluated over the mission window
    metrics: Metrics
    params: AnalysisParams
    horizon_kind: str                   # "terrain" or "smooth_sphere"
    # Dataset values at the point, filled by app/services.py. Missing key or None = not available.
    # Known keys: slope_deg, slope_source, sun_illumination_avg, earth_visibility_avg,
    # permanent_shadow_fraction, sky_visibility_sr, crater_density_per_km2.
    lookups: dict[str, float | str | None] = field(default_factory=dict)


@dataclass(frozen=True)
class ConstraintResult:
    id: str
    passed: bool | None                 # None = could not be evaluated
    value: float | None                 # the measured quantity
    threshold: float | None             # the limit it was compared with
    unit: str
    comparator: Literal["<=", ">=", "=="]
    basis: Basis
    margin: float | None = None         # positive = passes with room to spare
    fraction: float | None = None       # time-based: share of the window that satisfies the condition
    ranges: list[tuple[float, float]] | None = None   # time-based: [start_ms, end_ms] where it does
    note: str = ""


ConstraintFn = Callable[[ConstraintContext, dict], ConstraintResult]
REGISTRY: dict[str, ConstraintFn] = {}


def register(constraint_id: str) -> Callable[[ConstraintFn], ConstraintFn]:
    def deco(fn: ConstraintFn) -> ConstraintFn:
        if constraint_id in REGISTRY:
            raise ValueError(f"constraint {constraint_id!r} registered twice")
        REGISTRY[constraint_id] = fn
        return fn
    return deco


def evaluate_constraints(ctx: ConstraintContext, thresholds: dict[str, dict]) -> list[ConstraintResult]:
    """Run every requested constraint. Unknown ids raise KeyError (the router turns it into a 422)."""
    return [REGISTRY[cid](ctx, th) for cid, th in thresholds.items()]


def all_pass(results: list[ConstraintResult], unknown_passes: bool = False) -> bool:
    """A candidate is viable when every hard filter passes. An unknown fails by default."""
    return all(r.passed if r.passed is not None else unknown_passes for r in results)
