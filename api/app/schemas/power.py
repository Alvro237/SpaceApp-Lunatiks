"""Request and response models of POST /api/v1/power (MECH), following the team's API rules: flat field names.
snake_case JSON, units in descriptions.

No panel, battery or load value has a default: none has a cited source yet, so the caller gives them.
Fields marked "extra" are beyond the API rules and may be ignored by the frontend.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

from ..logic.power import ARRAY_KEYS, BATTERY_KEYS
from .common import TimeRange, WindowRequest, WindowResponse


class PowerInputs(BaseModel):
    """Panel, battery and load parameters with the API rules' flat names (shared by /power and /sweep)."""
    panel_area_m2: float | None = Field(None, gt=0.0, description="Active solar array area, m2 (level 2+)")
    cell_efficiency: float | None = Field(None, gt=0.0, le=1.0, description="Array conversion efficiency, 0..1 (level 2+)")
    derating: float | None = Field(None, gt=0.0, le=1.0, description="Product of other losses, 0..1; 1 = none (level 2+)")
    load_w: float | None = Field(None, ge=0.0, description="Electrical load, W (level 3)")
    night_load_w: float | None = Field(None, ge=0.0, description="Extra: load while no Sun is visible, W; load_w when omitted")
    battery_capacity_wh: float | None = Field(None, gt=0.0, description="Nominal battery capacity, Wh (level 3)")
    battery_initial_soc: float | None = Field(None, ge=0.0, le=1.0, description="State of charge at start, 0..1 (level 3)")
    battery_min_soc: float | None = Field(None, ge=0.0, lt=1.0, description="Lowest allowed state of charge, 0..1 (level 3)")
    charge_efficiency: float | None = Field(None, gt=0.0, le=1.0, description="One-way charge efficiency, 0..1 (level 3)")
    discharge_efficiency: float | None = Field(None, gt=0.0, le=1.0, description="One-way discharge efficiency, 0..1 (level 3)")

    def _missing(self, keys) -> list[str]:
        return [k for k in keys if getattr(self, k) is None]

    def _partial(self, keys) -> bool:
        m = self._missing(keys)
        return 0 < len(m) < len(keys)


class PowerRequest(WindowRequest, PowerInputs):
    panel: Literal["tracking", "vertical", "horizontal"] = Field("vertical", description=(
        "Array orientation: always facing the Sun, vertical turning in azimuth, or flat on the ground"))
    level: Literal[1, 2, 3] = Field(description=(
        "1 visible solar disc; 2 adds array power (panel_area_m2, cell_efficiency, derating); 3 adds the battery "
        "balance (load_w, battery_capacity_wh, battery_initial_soc, battery_min_soc, charge_efficiency, discharge_efficiency)"))

    @model_validator(mode="after")
    def _check_level(self) -> "PowerRequest":
        missing = (self._missing(ARRAY_KEYS) if self.level >= 2 else []) + \
                  (self._missing(BATTERY_KEYS) if self.level == 3 else [])
        if missing:
            raise ValueError(f"level {self.level} needs " + ", ".join(missing))
        return self


class PowerResponse(WindowResponse):
    level: int
    panel: str
    # level 1 (API rules)
    sun_fraction: list[float] = Field(description="Fraction of the solar disc above the local horizon at each sample, 0..1")
    sun_el_deg: list[float] = Field(description="Solar elevation of the disc centre at each sample, degrees")
    sunlit_ranges: list[TimeRange]
    longest_dark_h: float = Field(description="Longest stretch with no part of the Sun visible, hours")
    # level 1 extras
    sunlit_fraction: float = Field(description="Extra: share of samples with any of the Sun visible, 0..1")
    obscuration: list[float] = Field(description="Extra: fraction of the solar disc covered by the Earth (eclipse), 0..1")
    eclipse_ranges: list[TimeRange] = Field(description="Extra: time ranges with the Earth covering part of the Sun")
    mean_power_w_m2: float = Field(description=(
        "Extra: mean solar power incident on 1 m2 of panel over the window (mean of irradiance_w_m2, eclipses "
        "included), W/m2. Needs no panel size, so it compares places directly; same as /sweep mean_power_w_m2"))
    # level 2 (API rules)
    irradiance_w_m2: list[float] | None = Field(None, description=(
        "Irradiance reaching the panel at each sample, W/m2: solar irradiance x visible fraction x panel orientation "
        "factor x (1 - eclipse obscuration)"))
    power_w: list[float] | None = Field(None, description="Array electrical power at each sample, W")
    mean_power_w: float | None = Field(None, description="Mean array power over the window, W")
    energy_wh: float | None = Field(None, description="Array energy over the window (left Riemann sum), Wh")
    # level 2 extras
    peak_power_w: float | None = Field(None, description="Extra: highest array power, W")
    eclipse_energy_loss_wh: float | None = Field(None, description="Extra: array energy lost to eclipses, Wh")
    # level 3 (API rules)
    net_power_w: list[float] | None = Field(None, description="Array power minus load at each sample, W")
    battery_soc: list[float] | None = Field(None, description="Battery state of charge at each sample, fraction of capacity")
    min_soc: float | None = Field(None, description="Lowest state of charge reached, fraction of capacity")
    survives: bool | None = Field(None, description="True when the load was always served")
    first_depletion_at: str | None = Field(None, description="First sample with load unserved, ISO 8601 UTC; null if it survives")
    energy_margin_wh: float | None = Field(None, description=(
        "Energy above the battery floor at the worst moment, Wh; negative = load energy that could not be served"))
    # level 3 extras
    load_profile_w: list[float] | None = Field(None, description="Extra: load applied at each sample, W")
    final_soc: float | None = Field(None, description="Extra: state of charge at the end, fraction")
    depleted_ranges: list[TimeRange] | None = Field(None, description="Extra: time ranges with load unserved")
    unserved_energy_wh: float | None = Field(None, description="Extra: load energy not served, Wh")
    curtailed_energy_wh: float | None = Field(None, description="Extra: array energy lost because the battery was full, Wh")
    usable_capacity_wh: float | None = Field(None, description="Extra: capacity x (1 - battery_min_soc), Wh")
    longest_dark_energy_wh: float | None = Field(None, description=(
        "Extra: battery energy to carry the night load through the longest dark stretch, Wh"))
