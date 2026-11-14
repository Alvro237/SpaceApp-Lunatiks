"""Request and response models of POST /api/v1/sun (MECH). snake_case JSON, units in descriptions."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from .common import TimeRange, WindowRequest, WindowResponse


class SunRequest(WindowRequest):
    pass


class SunNow(BaseModel):
    elevation_deg: float = Field(description="Solar elevation of the disc centre at start, degrees (refraction-free)")
    azimuth_deg: float = Field(description="Solar azimuth at start, degrees clockwise from north")
    visible_fraction: float = Field(description="Fraction of the solar disc above the local horizon at start, 0..1")
    sunlit: bool
    horizon_elevation_deg: float = Field(description="Height of the skyline in the Sun's direction at start, degrees")


class Transition(BaseModel):
    kind: Literal["set", "rise"] = Field(description="set = sunset (Sun leaves view), rise = sunrise")
    at: str = Field(description="ISO 8601 UTC, to about one second")
    in_hours: float = Field(description="Hours from start")


class EclipseEvent(BaseModel):
    start: str = Field(description="First sample inside the eclipse, ISO 8601 UTC")
    end: str = Field(description="Last sample inside the eclipse, ISO 8601 UTC")
    duration_h: float = Field(description="Samples x step, hours (grid resolution)")
    kind: Literal["partial", "total"] = Field(description="Deepest phase reached: Earth covers part or all of the Sun")


class ElevationStats(BaseModel):
    max_deg: float
    min_deg: float
    mean_sunlit_deg: float | None = Field(description="Mean elevation while sunlit; null when never sunlit")


class SunResponse(WindowResponse):
    now: SunNow
    sun_el_deg: list[float] = Field(description="Solar elevation of the disc centre at each sample, degrees")
    sun_az_deg: list[float] = Field(description="Solar azimuth at each sample, degrees clockwise from north")
    visible_fraction: list[float] = Field(description="Fraction of the solar disc above the horizon at each sample, 0..1")
    elevation: ElevationStats
    sunlit_fraction: float = Field(description="Fraction of samples with any part of the Sun visible, 0..1")
    sunlit_hours: float = Field(description="Sunlit samples x step, hours")
    sunlit_ranges: list[TimeRange]
    longest_sunlit_h: float = Field(description="Longest continuous sunlit stretch, hours")
    longest_dark_h: float = Field(description="Longest stretch with no part of the Sun visible, hours")
    next_transition: Transition | None = Field(description=(
        "Next sunset or sunrise after start (searched up to 45 days); null when none in that time or the tables end"))
    hours_to_sunset: float | None = Field(description="Hours from start to the next sunset when the Sun is up at start")
    eclipse_fraction: float = Field(description="Fraction of samples with the Earth covering part of the Sun, 0..1")
    eclipse_ranges: list[TimeRange]
    eclipses: list[EclipseEvent]
