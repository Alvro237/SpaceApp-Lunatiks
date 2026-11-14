"""Request and response models of POST /api/v1/earth (MECH). snake_case JSON, units in descriptions."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from .common import TimeRange, WindowRequest, WindowResponse


class EarthRequest(WindowRequest):
    comms_min_fraction: float = Field(0.5, gt=0.0, le=1.0, description=(
        "Share of the Earth's disc that must be above the horizon to count as visible for a direct link, 0..1 "
        "(team convention 0.5 = the centre, CLAUDE.md)"))


class EarthNow(BaseModel):
    elevation_deg: float = Field(description="Elevation of the Earth's centre at start, degrees")
    azimuth_deg: float = Field(description="Azimuth of the Earth's centre at start, degrees clockwise from north")
    visible_fraction: float = Field(description="Fraction of the Earth's disc above the local horizon at start, 0..1")
    visible: bool = Field(description="visible_fraction >= comms_min_fraction")
    horizon_elevation_deg: float = Field(description="Height of the skyline in the Earth's direction at start, degrees")
    distance_km: float
    angular_radius_deg: float


class EarthTransition(BaseModel):
    kind: Literal["set", "rise"] = Field(description="set = Earthset (link lost), rise = Earthrise (link regained)")
    at: str = Field(description="ISO 8601 UTC, to about one second")
    in_hours: float = Field(description="Hours from start")


class LibrationWander(BaseModel):
    azimuth_span_deg: float = Field(description="Range of the Earth's azimuth over the window, degrees")
    elevation_span_deg: float = Field(description="Range of the Earth's elevation over the window, degrees")
    mean_azimuth_deg: float
    mean_elevation_deg: float


class EarthResponse(WindowResponse):
    comms_min_fraction: float
    now: EarthNow
    earth_el_deg: list[float] = Field(description="Elevation of the Earth's centre at each sample, degrees")
    earth_az_deg: list[float] = Field(description="Azimuth of the Earth's centre at each sample, degrees")
    visible_fraction: list[float] = Field(description="Fraction of the Earth's disc above the horizon at each sample, 0..1")
    visible_window_fraction: float = Field(description="Fraction of samples with a direct link possible, 0..1")
    visible_hours: float = Field(description="Samples with a link possible x step, hours")
    visible_ranges: list[TimeRange] = Field(description="Earth visibility windows")
    longest_visible_h: float = Field(description="Longest continuous visibility window, hours")
    longest_blackout_h: float = Field(description="Longest stretch without a direct link, hours")
    next_transition: EarthTransition | None = Field(description=(
        "Next Earthset or Earthrise after start (searched up to 45 days); null when none (always or never visible)"))
    hours_to_earthset: float | None = Field(description="Hours from start to the next Earthset when the Earth is visible at start")
    libration: LibrationWander
