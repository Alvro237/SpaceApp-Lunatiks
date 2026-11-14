"""Hard filter: maximum temperature, discrete or continuous reading (MECH)."""
from __future__ import annotations

from ..eclipse import obscuration
from ..engine import visibility_ranges
from ..thermal import Equipment, Regolith, absorbed_flux, check_max, direct_sun, simulate
from .base import ConstraintContext, ConstraintResult, register


@register("max_temperature")
def max_temperature(ctx: ConstraintContext, threshold: dict) -> ConstraintResult:
    """threshold: {"max_k": float, "mode": "discrete" | "continuous", "max_hours_above": float (continuous),
    "regolith": {albedo, emissivity, conductivity_w_mk, density_kg_m3, heat_capacity_j_kgk, geothermal_flux_w_m2},
    "equipment": {...} optional}.

    Temperature from app/logic/thermal.py over the mission window: the equipment node when given, otherwise the
    regolith surface. ``fraction`` and ``ranges`` describe the time ABOVE the limit.
    """
    limit, mode = float(threshold["max_k"]), threshold.get("mode", "discrete")
    reg = Regolith(**threshold["regolith"])
    eq = Equipment(**threshold["equipment"]) if threshold.get("equipment") else None
    s = ctx.series
    occ = obscuration(s)
    res = simulate(s.t_ms, absorbed_flux(s.irradiance_w_m2, s.sun_frac, occ, s.sun_el, reg.albedo), reg, eq,
                   direct_sun(s.irradiance_w_m2, s.sun_frac, occ))
    temps = res.equipment_k if eq is not None else res.surface_k
    chk = check_max(s.t_ms, temps, limit, mode, float(threshold.get("max_hours_above", 0.0)))
    peak = float(temps.max())
    what = "equipment node" if eq is not None else "regolith surface"
    note = (f"{mode}; {what}; longest above {chk.longest_above_h:.1f} h"
            + ("" if mode == "discrete" else f" (allowed {float(threshold.get('max_hours_above', 0.0)):.1f} h)"))
    return ConstraintResult(id="max_temperature", passed=chk.passed, value=peak, threshold=limit, unit="K",
                            comparator="<=", basis="computed", margin=limit - peak, fraction=chk.fraction_above,
                            ranges=visibility_ranges(s.t_ms, chk.above), note=note)
