"""Request and response models of POST /api/v1/thermal (MECH). snake_case JSON, units in descriptions.

No thermal property has a default: each one needs a cited source, so the caller gives them.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from .common import TimeRange, WindowRequest, WindowResponse


class RegolithIn(BaseModel):
    albedo: float = Field(ge=0.0, lt=1.0, description="Bolometric albedo of the surface, 0..1")
    emissivity: float = Field(gt=0.0, le=1.0, description="Infrared emissivity, 0..1")
    conductivity_w_mk: float = Field(gt=0.0, description="Thermal conductivity, W m-1 K-1 (constant)")
    density_kg_m3: float = Field(gt=0.0, description="Bulk density, kg m-3 (constant)")
    heat_capacity_j_kgk: float = Field(gt=0.0, description="Specific heat capacity, J kg-1 K-1 (constant)")
    geothermal_flux_w_m2: float = Field(ge=0.0, description="Heat flow from the interior, W m-2")


class EquipmentIn(BaseModel):
    absorptivity: float = Field(gt=0.0, le=1.0, description="Solar absorptivity of the sun-facing surface, 0..1")
    emissivity: float = Field(gt=0.0, le=1.0, description="Infrared emissivity of the radiator, 0..1")
    sun_area_m2: float = Field(ge=0.0, description="Area projected towards the Sun, m2")
    radiator_area_m2: float = Field(gt=0.0, description="Radiating area, m2")
    ground_view_factor: float = Field(ge=0.0, le=1.0, description="Share of the radiator's view filled by the ground")
    heat_capacity_j_k: float = Field(gt=0.0, description="Heat capacity of the box, J K-1")
    internal_power_w: float = Field(ge=0.0, description="Internal dissipation (electronics, heaters), W")


class LimitsIn(BaseModel):
    max_k: float | None = Field(None, gt=0.0, description="Upper limit, K")
    min_k: float | None = Field(None, gt=0.0, description="Lower limit, K")
    mode: Literal["discrete", "continuous"] = Field("discrete", description=(
        "discrete: any sample beyond the limit fails; continuous: fails when beyond it for longer than max_hours_beyond"))
    max_hours_beyond: float = Field(0.0, ge=0.0, description="Continuous mode: allowed hours beyond a limit")


class ThermalRequest(WindowRequest):
    regolith: RegolithIn
    equipment: EquipmentIn | None = Field(None, description="Lumped equipment box; limits then apply to it")
    limits: LimitsIn | None = None


class Stats(BaseModel):
    max_k: float
    min_k: float
    mean_k: float


class LimitResult(BaseModel):
    limit_k: float
    passed: bool
    fraction_beyond: float = Field(description="Share of samples beyond the limit, 0..1")
    longest_beyond_h: float
    ranges_beyond: list[TimeRange]


class ThermalResponse(WindowResponse):
    surface_k: list[float] = Field(description="Regolith surface temperature at each sample, K")
    deep_k: list[float] = Field(description="Temperature of the deepest grid node at each sample, K")
    equipment_k: list[float] | None = Field(None, description="Equipment node temperature at each sample, K")
    surface: Stats
    equipment: Stats | None = None
    initial_k: float = Field(description="Uniform starting temperature (equilibrium with the mean absorbed plus geothermal flux), K")
    grid_depth_m: float
    skin_depth_m: float = Field(description="Diurnal thermal skin depth for these properties, m")
    limits_apply_to: str | None = Field(None, description="equipment or surface")
    above_max: LimitResult | None = None
    below_min: LimitResult | None = None
