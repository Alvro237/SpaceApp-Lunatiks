"""Hard filter: maximum galactic-cosmic-ray dose over the mission (LRO CRaTER, MECH)."""
from __future__ import annotations

from ..radiation import mission_dose, shielding_factor, sky_solid_angle
from .base import ConstraintContext, ConstraintResult, register


@register("max_dose")
def max_dose(ctx: ConstraintContext, threshold: dict) -> ConstraintResult:
    """threshold: {"max_mgy_si": float}. Passes when the mission GCR dose at the point is at or below the limit.

    Dose = CRaTER mean free-space GCR rate x (open-sky solid angle / 4 pi) x duration (formulas in
    app/logic/radiation.py). Absorbed dose in silicon, GCR only: solar particle events are not included.
    """
    limit = float(threshold["max_mgy_si"])
    rate = ctx.lookups.get("gcr_free_space_mgy_si_per_day")
    omega, source = sky_solid_angle(ctx.lookups.get("sky_visibility_sr"), ctx.horizon_kind)
    if rate is None or omega is None:
        return ConstraintResult(id="max_dose", passed=None, value=None, threshold=limit, unit="mGy_Si",
                                comparator="<=", basis="unavailable",
                                note="No CRaTER data loaded or no sky-visibility value at this terrain point")
    dose = mission_dose(float(rate) * shielding_factor(omega), ctx.duration_h)
    return ConstraintResult(id="max_dose", passed=dose <= limit, value=dose, threshold=limit, unit="mGy_Si",
                            comparator="<=", basis="dataset" if source == "dataset" else "computed",
                            margin=limit - dose, note=f"GCR only (no solar particle events); sky {omega:.3f} sr ({source})")
