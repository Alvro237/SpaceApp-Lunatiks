"""Request and response models of POST /api/v1/power (MECH). snake_case JSON, units in descriptions.

No panel, battery or load value has a default: none has a cited source yet, so the caller gives them.
The frontend decides which ones a user sees (for example ideal values in a simplified view).
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

from .common import TimeRange, WindowRequest, WindowResponse


class ArrayIn(BaseModel):
    area_m2: float = Field(gt=0.0, description="Active solar array area, m2")
    efficiency: float = Field(gt=0.0, le=1.0, description="Array conversion efficiency, 0..1")
    derating: float = Field(gt=0.0, le=1.0, description="Product of other losses (wiring, temperature, mismatch), 0..1; 1 = none")


class BatteryIn(BaseModel):
    capacity_wh: float = Field(gt=0.0, description="Nominal battery capacity, Wh")
    initial_soc: float = Field(ge=0.0, le=1.0, description="State of charge at the start, fraction of capacity")
    min_soc: float = Field(ge=0.0, lt=1.0, description="Lowest allowed state of charge, fraction of capacity")
    charge_efficiency: float = Field(gt=0.0, le=1.0, description="One-way charge efficiency, 0..1; 1 = ideal")
    discharge_efficiency: float = Field(gt=0.0, le=1.0, description="One-way discharge efficiency, 0..1; 1 = ideal")


class LoadIn(BaseModel):
    load_w: float = Field(ge=0.0, description="Electrical load while any part of the Sun is above the horizon, W")
    night_load_w: float | None = Field(None, ge=0.0, description=(
        "Load while no part of the Sun is above the horizon (survival mode, heaters), W; load_w when omitted"))


class PowerRequest(WindowRequest):
    panel: Literal["tracking", "vertical", "horizontal"] = Field("vertical", description=(
        "Array orientation: always facing the Sun, vertical turning in azimuth, or flat on the ground"))
    level: Literal[1, 2, 3] = Field(description=(
        "1 visible solar disc fraction; 2 adds array power (needs array); 3 adds the battery energy balance "
        "(needs array, battery, load)"))
    array: ArrayIn | None = None
    battery: BatteryIn | None = None
    load: LoadIn | None = None

    @model_validator(mode="after")
    def _check_level(self) -> "PowerRequest":
        if self.level >= 2 and self.array is None:
            raise ValueError("level 2 and 3 need array")
        if self.level == 3 and (self.battery is None or self.load is None):
            raise ValueError("level 3 needs battery and load")
        return self


class SunLevel(BaseModel):
    sun_el_deg: list[float] = Field(description="Solar elevation of the disc centre at each sample, degrees")
    visible_fraction: list[float] = Field(description="Fraction of the solar disc above the horizon, 0..1")
    mean_visible_fraction: float = Field(description="Mean of visible_fraction over the window, 0..1")
    sunlit_fraction: float = Field(description="Fraction of samples with any part of the Sun visible, 0..1")
    sunlit_ranges: list[TimeRange]
    longest_dark_h: float = Field(description="Longest stretch with no part of the Sun visible, hours")


class ArrayLevel(BaseModel):
    power_w: list[float] = Field(description="Array electrical power at each sample, W")
    mean_power_w: float = Field(description="Mean array power over the window, W")
    peak_power_w: float = Field(description="Highest array power in the window, W")
    energy_wh: float = Field(description="Array energy over the window (left Riemann sum), Wh")
    producing_fraction: float = Field(description="Fraction of samples with array power above zero, 0..1")
    producing_ranges: list[TimeRange]


class BalanceLevel(BaseModel):
    soc_fraction: list[float] = Field(description="Battery state of charge at each sample, fraction of capacity")
    load_w: list[float] = Field(description="Load applied at each sample, W")
    min_soc_fraction: float
    final_soc_fraction: float
    survived: bool = Field(description="True when the load was always served")
    first_depletion_at: str | None = Field(description="First sample with load unserved, ISO 8601 UTC")
    depleted_fraction: float = Field(description="Fraction of samples ending a step with load unserved, 0..1")
    depleted_ranges: list[TimeRange]
    generated_energy_wh: float = Field(description="Array energy over the window, Wh")
    consumed_energy_wh: float = Field(description="Load energy served, Wh")
    unserved_energy_wh: float = Field(description="Load energy not served because the battery was at its floor, Wh")
    curtailed_energy_wh: float = Field(description="Array energy lost because the battery was full, Wh")
    usable_capacity_wh: float = Field(description="capacity x (1 - min_soc), Wh")
    longest_dark_energy_wh: float = Field(description=(
        "Battery energy to carry the night load through the longest dark stretch: night load x hours / "
        "discharge efficiency, Wh"))


class PowerResponse(WindowResponse):
    level: int
    panel: str
    sun: SunLevel
    array: ArrayLevel | None = None
    balance: BalanceLevel | None = None
