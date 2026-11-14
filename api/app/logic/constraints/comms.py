"""Hard filters: direct-to-Earth communication hours and maximum blackout.

Both are time-based and answer in the two forms the team asked for: ``fraction`` and ``ranges``.

What "communication" means here. By default the Earth is in line of sight: at least
``ctx.params.comms_min_fraction`` of its disc is above the site's horizon (default 0.5, a parameter and not a
physical constant), with no ground antenna considered. When the context carries ``ctx.contact`` (built by
``services.constraint_context(..., link_networks=[...])``, level 1 of ``POST /api/v1/link``) the filters use that
series instead: the Earth is visible from the lunar site AND an antenna of the selected networks sees the Moon above
its elevation limit. Neither includes a link budget (level 2).

A threshold is never defaulted: each filter needs the user's own limit (CLAUDE.md, "Do not claim a number you
did not measure"). A missing or invalid threshold raises ``ValueError`` so the caller can answer 422.
"""
from __future__ import annotations

import numpy as np

from ..engine import longest_run, visibility_ranges
from .base import ConstraintContext, ConstraintResult, register

MS_PER_HOUR = 3_600_000.0


def _link_series(ctx: ConstraintContext):
    """Contact at each sample: the radio-link contact when the context carries it (the lunar site sees the Earth AND a
    selected ground antenna sees the Moon), else the Earth's line of sight alone."""
    return np.asarray(ctx.contact, dtype=bool) if ctx.contact is not None else ctx.series.comms(ctx.params)


def _basis_note(ctx: ConstraintContext) -> str:
    if ctx.contact is not None:
        return (f"contact with a selected ground antenna (the Earth has at least {ctx.params.comms_min_fraction:.0%} of "
                "its disc above the lunar horizon AND an antenna sees the Moon above its elevation limit)")
    return (f"Earth in view (at least {ctx.params.comms_min_fraction:.0%} of its disc above the horizon; "
            "line of sight only, no ground antenna considered)")


def _horizon_note(ctx: ConstraintContext) -> str:
    if ctx.horizon_kind == "terrain":
        return ""
    return ("; smooth-sphere horizon (an estimate: local terrain is not modelled and can shorten or "
            "lengthen the contact)")


def _number(threshold: dict, key: str) -> float | None:
    value = threshold.get(key)
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"threshold {key!r} must be a number, got {value!r}") from None
    if number != number or number < 0:
        raise ValueError(f"threshold {key!r} must be a non-negative number, got {value!r}")
    return number


@register("comms_hours")
def comms_hours(ctx: ConstraintContext, threshold: dict) -> ConstraintResult:
    """threshold: exactly one of {"min_hours": float} or {"min_fraction": float (0..1)}.

    Passes when the Earth is in view for at least that many hours (or that share) of the mission window.
    ``min_hours`` is compared with ``fraction x window length``, so it is consistent with ``min_fraction``
    whatever the sampling step. ``fraction`` and ``ranges`` describe the time WITH contact.
    """
    min_hours = _number(threshold, "min_hours")
    min_fraction = _number(threshold, "min_fraction")
    if (min_hours is None) == (min_fraction is None):
        raise ValueError("comms_hours needs exactly one of 'min_hours' or 'min_fraction'")
    if min_fraction is not None and min_fraction > 1.0:
        raise ValueError("'min_fraction' must be between 0 and 1")

    link = _link_series(ctx)
    fraction = float(link.mean())
    hours = fraction * ctx.metrics.window_hours
    note = f"{_basis_note(ctx)}: {hours:.1f} h of {ctx.metrics.window_hours:.1f} h" + _horizon_note(ctx)
    ranges = visibility_ranges(ctx.series.t_ms, link)
    if min_hours is not None:
        return ConstraintResult(id="comms_hours", passed=hours >= min_hours, value=hours, threshold=min_hours,
                                unit="hours", comparator=">=", basis="computed", margin=hours - min_hours,
                                fraction=fraction, ranges=ranges, note=note)
    return ConstraintResult(id="comms_hours", passed=fraction >= min_fraction, value=fraction,
                            threshold=min_fraction, unit="fraction of mission time", comparator=">=",
                            basis="computed", margin=fraction - min_fraction, fraction=fraction,
                            ranges=ranges, note=note)


@register("max_blackout")
def max_blackout(ctx: ConstraintContext, threshold: dict) -> ConstraintResult:
    """threshold: {"max_hours": float}. Passes when the longest single stretch without Earth contact
    is at most ``max_hours``.

    For this filter ``ranges`` are the BLACKOUT ranges (the stretches the limit is about) and ``fraction`` is
    the share of the mission spent in blackout. The longest stretch is counted in whole samples of the series
    step, so its resolution is that step.
    """
    max_hours = _number(threshold, "max_hours")
    if max_hours is None:
        raise ValueError("max_blackout needs 'max_hours'")

    link = _link_series(ctx)
    blackout = ~link
    # with the radio-link series the longest run is counted here (samples x step, the engine's convention);
    # without it the engine's own metric is used, which is the same number for the Earth's line of sight
    longest = ctx.metrics.longest_blackout_h if ctx.contact is None else longest_run(link, False) * ctx.series.step_ms / MS_PER_HOUR
    note = (f"{_basis_note(ctx)}: longest blackout {longest:.1f} h; {blackout.mean():.0%} of the window without contact"
            + _horizon_note(ctx))
    return ConstraintResult(id="max_blackout", passed=longest <= max_hours, value=longest, threshold=max_hours,
                            unit="hours", comparator="<=", basis="computed", margin=max_hours - longest,
                            fraction=float(blackout.mean()), ranges=visibility_ranges(ctx.series.t_ms, blackout),
                            note=note)
