"""Hard filter: sunlight during the mission. Reference implementation of a time-based constraint
(answers both as a fraction of the time and as time ranges)."""
from __future__ import annotations

from ..engine import longest_run, visibility_ranges
from .base import ConstraintContext, ConstraintResult, register

MS_PER_HOUR = 3_600_000.0


@register("continuous_light")
def continuous_light(ctx: ConstraintContext, threshold: dict) -> ConstraintResult:
    """threshold: {"min_fraction": float = 1.0, "max_dark_h": float | None = None,
                   "min_sun_fraction": float = 0.0}

    A sample counts as lit when more than ``min_sun_fraction`` of the solar disc is above the
    horizon (0 = any sliver; raise it when the power system needs most of the disc).
      * ``min_fraction = 1.0`` is the strict reading: light for the whole mission duration.
      * A lower ``min_fraction`` accepts that share of lit time; ``max_dark_h`` additionally caps
        the longest single dark stretch (what the battery must bridge).
    """
    min_fraction = float(threshold.get("min_fraction", 1.0))
    max_dark_h = threshold.get("max_dark_h")
    lit = ctx.series.sun_frac > float(threshold.get("min_sun_fraction", 0.0))
    fraction = float(lit.mean())
    longest_dark_h = longest_run(lit, False) * ctx.series.step_ms / MS_PER_HOUR
    passed = fraction >= min_fraction and (max_dark_h is None or longest_dark_h <= float(max_dark_h))
    note = f"longest dark stretch {longest_dark_h:.1f} h"
    if ctx.horizon_kind != "terrain":
        note += "; smooth-sphere horizon, real terrain can only shorten the light"
    return ConstraintResult(id="continuous_light", passed=passed, value=fraction, threshold=min_fraction,
                            unit="fraction of mission time", comparator=">=", basis="computed",
                            margin=fraction - min_fraction, fraction=fraction,
                            ranges=visibility_ranges(ctx.series.t_ms, lit), note=note)
