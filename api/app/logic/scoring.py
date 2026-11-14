"""Soft scoring among the sites that pass every hard filter.

A weighted mean with weights that the user sees and can change. It is a screening aid that an
engineer can disagree with, not a mission rule: never hide a weight, never fold a hard filter in
here (a site that fails a hard filter is out, it does not just score lower).

    score = 100 * sum(w_i * c_i) / sum(w_i)        with every criterion c_i scaled to 0..1

Add a criterion by adding a function to ``CRITERIA`` and a default weight to ``DEFAULT_WEIGHTS``.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from .engine import Metrics

VERDICT_FAVOURABLE = 75.0
VERDICT_MARGINAL = 50.0


def _continuity(m: Metrics) -> float:
    """1 when light never stops, 0 when the whole window is one dark stretch."""
    return 1.0 - min(1.0, m.longest_dark_h / m.window_hours) if m.window_hours > 0 else m.sunlight_pct / 100.0


# criterion id -> function(Metrics) -> value in 0..1 (higher is better)
CRITERIA: dict[str, Callable[[Metrics], float]] = {
    "sunlight": lambda m: m.sunlight_pct / 100.0,
    "comms": lambda m: m.comms_pct / 100.0,
    "continuity": _continuity,
}

DEFAULT_WEIGHTS: dict[str, float] = {"sunlight": 0.5, "comms": 0.3, "continuity": 0.2}


@dataclass(frozen=True)
class ScoreResult:
    score: float                 # 0..100
    verdict: str                 # favourable | marginal | poor
    parts: dict[str, float]      # each criterion's 0..1 value
    weights: dict[str, float]    # the weights actually used, as given (not normalised)


def weighted_score(parts: dict[str, float], weights: dict[str, float]) -> float:
    total = sum(max(0.0, weights.get(k, 0.0)) for k in parts)
    if total <= 0:
        return 0.0
    return 100.0 * sum(max(0.0, weights.get(k, 0.0)) * v for k, v in parts.items()) / total


def score_metrics(m: Metrics, weights: dict[str, float] | None = None) -> ScoreResult:
    w = dict(DEFAULT_WEIGHTS if weights is None else weights)
    parts = {k: float(min(1.0, max(0.0, fn(m)))) for k, fn in CRITERIA.items()}
    s = weighted_score(parts, w)
    verdict = "favourable" if s >= VERDICT_FAVOURABLE else "marginal" if s >= VERDICT_MARGINAL else "poor"
    return ScoreResult(score=s, verdict=verdict, parts=parts, weights=w)
