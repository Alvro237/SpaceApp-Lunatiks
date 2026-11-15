"""Request and response models of POST /api/v1/sweep (MECH): replanning over landing dates. snake_case JSON."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from ..logic.power import ARRAY_KEYS, BATTERY_KEYS
from .power import PowerInputs

MAX_PLACES = 25
MAX_CELLS = 2_000_000         # windows x samples per window, per place
MAX_SERIES_SAMPLES = 200_000  # samples of the single series per place


class Place(BaseModel):
    site_id: str | None = Field(None, description="Catalogue site id; or give lat and lon")
    lat: float | None = Field(None, ge=-90.0, le=90.0, description="Planetocentric latitude, degrees, MOON_ME")
    lon: float | None = Field(None, ge=-180.0, le=180.0, description="East-positive longitude, degrees")

    @model_validator(mode="after")
    def _one(self) -> "Place":
        if (self.site_id is None) == (self.lat is None or self.lon is None):
            raise ValueError("each place needs either site_id or both lat and lon")
        return self


class SweepRequest(PowerInputs):
    """Panel fields (panel_area_m2, cell_efficiency, derating) give array power per landing; adding the battery
    fields (load_w, battery_*, charge_efficiency, discharge_efficiency) gives survival per landing."""
    places: list[Place] = Field(min_length=1, max_length=MAX_PLACES)
    first_landing: datetime = Field(description="First landing time, ISO 8601 UTC")
    landings: int = Field(ge=1, le=2000, description="Number of landing times to try")
    landing_step_h: float = Field(24.0, gt=0.0, description="Hours between consecutive landing times")
    stay_h: float = Field(gt=0.0, description="Mission duration after each landing, hours")
    step_min: float = Field(60.0, ge=1.0, le=1440.0, description="Sampling step, minutes; must divide landing_step_h and stay_h")
    panel: Literal["tracking", "vertical", "horizontal"] = "vertical"
    comms_min_fraction: float = Field(0.5, gt=0.0, le=1.0, description="Share of the Earth's disc needed for a link")

    @model_validator(mode="after")
    def _check(self) -> "SweepRequest":
        for name, hours in (("landing_step_h", self.landing_step_h), ("stay_h", self.stay_h)):
            k = hours * 60.0 / self.step_min
            if abs(k - round(k)) > 1e-9:
                raise ValueError(f"step_min must divide {name}")
        n = round(self.stay_h * 60.0 / self.step_min)
        ls = round(self.landing_step_h * 60.0 / self.step_min)
        if self.landings * (n + 1) > MAX_CELLS or (self.landings - 1) * ls + n + 1 > MAX_SERIES_SAMPLES:
            raise ValueError("sweep too large: fewer landings, a shorter stay or a larger step_min")
        if self._partial(ARRAY_KEYS):
            raise ValueError("panel fields incomplete: missing " + ", ".join(self._missing(ARRAY_KEYS)))
        if self._partial(BATTERY_KEYS):
            raise ValueError("battery fields incomplete: missing " + ", ".join(self._missing(BATTERY_KEYS)))
        if not self._missing(BATTERY_KEYS) and self._missing(ARRAY_KEYS):
            raise ValueError("battery fields need the panel fields too")
        return self


class PlaceSweep(BaseModel):
    site_id: str | None
    name: str | None
    lat: float
    lon: float
    horizon_kind: str
    sunlight_fraction: list[float] = Field(description="Per landing: share of the stay with any of the Sun visible, 0..1")
    comms_fraction: list[float] = Field(description="Per landing: share of the stay with a direct Earth link, 0..1")
    both_fraction: list[float] = Field(description="Per landing: share with Sun and Earth together, 0..1")
    longest_dark_h: list[float] = Field(description="Per landing: longest stretch without Sun, hours")
    longest_blackout_h: list[float] = Field(description="Per landing: longest stretch without Earth link, hours")
    eclipse_hours: list[float] = Field(description="Per landing: hours with the Earth covering part of the Sun")
    mean_power_w_m2: list[float] = Field(description="Per landing: mean power per m2 of panel, eclipses included, W/m2")
    mean_array_w: list[float] | None = Field(None, description="Per landing: mean array power, W (with array)")
    battery_survived: list[bool] | None = Field(None, description="Per landing: load always served (with battery)")
    battery_min_soc: list[float] | None = Field(None, description="Per landing: lowest state of charge, fraction")
    unserved_energy_wh: list[float] | None = Field(None, description="Per landing: load energy not served, Wh")
    gcr_dose_mgy_si: float | None = Field(None, description=(
        "GCR dose over one stay (CRaTER climatology mean, same for every landing), mGy(Si); null without sky data"))


class SweepResponse(BaseModel):
    landings: list[str] = Field(description="Landing times, ISO 8601 UTC")
    stay_h: float
    step_min: float
    assumptions: list[str]
    places: list[PlaceSweep]
