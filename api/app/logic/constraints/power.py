"""Hard filter: the battery carries the load through the whole mission (MECH)."""
from __future__ import annotations

from ..eclipse import obscuration
from ..engine import visibility_ranges
from ..power import ARRAY_KEYS, BATTERY_KEYS, array_power_w, energy_balance, load_series_w, params_from_flat
from .base import ConstraintContext, ConstraintResult, register


@register("battery_survives")
def battery_survives(ctx: ConstraintContext, threshold: dict) -> ConstraintResult:
    """threshold: the flat fields of POST /api/v1/power level 3 (team API rules): panel_area_m2, cell_efficiency,
    derating, load_w, battery_capacity_wh, battery_initial_soc, battery_min_soc, charge_efficiency,
    discharge_efficiency, and optionally night_load_w.

    Same model as /power level 3 (eclipses included, panel orientation from the analysis parameters). Passes when
    no load is ever left unserved. ``value`` is the lowest state of charge; ``fraction`` and ``ranges`` describe
    the time with load unserved.
    """
    missing = [k for k in ARRAY_KEYS + BATTERY_KEYS if threshold.get(k) is None]
    if missing:
        raise KeyError(", ".join(missing))
    array, battery, load = params_from_flat(threshold)
    s = ctx.series
    p = array_power_w(s.power_w_m2, array) * (1.0 - obscuration(s))
    bal = energy_balance(s.t_ms, p, load_series_w(s.sunlit(), load), battery)
    return ConstraintResult(id="battery_survives", passed=bal.survived, value=bal.min_soc, threshold=battery.min_soc,
                            unit="state of charge", comparator=">=", basis="computed",
                            margin=bal.min_soc - battery.min_soc, fraction=float(bal.depleted.mean()),
                            ranges=visibility_ranges(s.t_ms, bal.depleted),
                            note=f"unserved {bal.unserved_wh:.0f} Wh, curtailed {bal.curtailed_wh:.0f} Wh")
