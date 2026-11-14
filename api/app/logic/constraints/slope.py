"""Hard filter: maximum terrain slope (LOLA). Reference implementation of a dataset-based constraint."""
from __future__ import annotations

from .base import ConstraintContext, ConstraintResult, register


@register("max_slope")
def max_slope(ctx: ConstraintContext, threshold: dict) -> ConstraintResult:
    """threshold: {"max_deg": float}. Passes when the slope at the point is at or below the limit.

    The slope comes from ``ctx.lookups["slope_deg"]``: the site's own LOLA slope (100 m baseline on
    the finest DEM) for catalogue sites with terrain, otherwise the mean slope of the screening grid
    cell. The two are not the same quantity; ``slope_source`` says which one was used.
    """
    limit = float(threshold["max_deg"])
    slope = ctx.lookups.get("slope_deg")
    if slope is None:
        return ConstraintResult(id="max_slope", passed=None, value=None, threshold=limit, unit="deg",
                                comparator="<=", basis="unavailable",
                                note="No LOLA slope at this point (the slope grids cover south of 60 S only)")
    slope = float(slope)
    return ConstraintResult(id="max_slope", passed=slope <= limit, value=slope, threshold=limit, unit="deg",
                            comparator="<=", basis="dataset", margin=limit - slope,
                            note=str(ctx.lookups.get("slope_source") or ""))
