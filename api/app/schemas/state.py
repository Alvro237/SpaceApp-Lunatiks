"""Request options and response models of the Sun/Earth state endpoints (SW-1).

Shared by ``GET /api/v1/sites/{site_id}/state`` and, later, ``GET /api/v1/points/state``.
JSON field names are snake_case; angles in degrees; times ISO 8601 UTC with a trailing Z.
Output format documented for integration in ``docs/sw1-output-format.md``.

Light and comms geometry only: irradiance and array power are the MECH power endpoint's (``/api/v1/power``),
so this contract carries no power number that could disagree with it.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

EclipseState = Literal["none", "partial", "total"]
HorizonKind = Literal["terrain", "smooth_sphere"]


class Transition(BaseModel):
    kind: Literal["set", "rise"] = Field(
        description="'set': the body leaves view at that instant; 'rise': it comes into view")
    at: str = Field(description="Instant of the change, ISO 8601 UTC, resolved to about one second")
    in_hours: float = Field(description="Hours from the requested instant t to the change")


class BodyState(BaseModel):
    az: float = Field(description="Azimuth of the body centre, degrees clockwise from north, 0..360")
    el: float = Field(description="Elevation of the body centre above the local horizontal, degrees "
                                  "(airless, apparent: light time + stellar aberration)")
    horizon_el: float = Field(description="Elevation of the horizon at the body's azimuth, degrees "
                                          "(terrain mask or smooth-sphere dip, see horizon_kind)")
    visible_fraction: float = Field(description="Fraction of the body's disc above the horizon, 0..1")
    visible: bool = Field(description="Sun: any part of the disc above the horizon (visible_fraction > 0). "
                                      "Earth: at least comms_min_fraction of the disc above it")
    angular_radius_deg: float = Field(description="Apparent angular radius of the disc, degrees")
    distance_km: float = Field(description="Distance from the site to the body centre, km")


class StateResponse(BaseModel):
    site_id: str | None = Field(None, description="Catalogue id; null for manual coordinates")
    lat: float = Field(description="Planetocentric latitude, degrees, Moon Mean-Earth frame")
    lon: float = Field(description="East-positive longitude, degrees, -180..180")
    ground_m: float = Field(description="Ground height above the 1737.4 km reference sphere, metres")
    t: str = Field(description="Requested instant, ISO 8601 UTC")
    mast_m: float = Field(description="Mast height requested, metres above the ground")
    mast_used_m: float = Field(description="Mast height of the horizon actually used, metres: the nearest "
                                           "stored terrain mask (0, 2, 5, 10 m) or the requested one on a "
                                           "smooth sphere")
    comms_min_fraction: float = Field(description="Share of the Earth's disc required for comms, 0..1")
    horizon_kind: HorizonKind = Field(description="'terrain': LOLA ray-traced mask; 'smooth_sphere': geometric "
                                                  "dip only (real terrain can only shorten light and comms)")
    sun: BodyState
    earth: BodyState
    eclipse: EclipseState = Field(description="The Earth covering the Sun as seen from the site (a lunar eclipse "
                                              "seen from the Earth)")
    sun_eclipsed_fraction: float = Field(description="Fraction of the solar disc hidden behind the Earth, 0..1 "
                                                     "(1 during a total eclipse, 0 when eclipse is 'none')")
    next_sun_transition: Transition | None = Field(
        description="Next sunset (kind 'set') or sunrise ('rise'); null if none within the search span")
    next_earth_transition: Transition | None = Field(
        description="Next Earthset or Earthrise for comms; null if none within the search span")
    transition_search_days: float = Field(description="Days searched ahead for the transitions (capped by "
                                                      "the end of the ephemeris tables)")


# ---------------------------------------------------------------------------- series over a mission window

class BodySeries(BaseModel):
    """One value per sample, aligned with ``SeriesResponse.t``."""
    az: list[float] = Field(description="Azimuth of the disc centre, degrees clockwise from north, 0..360")
    el: list[float] = Field(description="Elevation of the disc centre, degrees (airless, apparent)")
    horizon_el: list[float] = Field(description="Horizon elevation at the body's azimuth, degrees")
    visible_fraction: list[float] = Field(description="Fraction of the disc above the horizon, 0..1")
    visible: list[bool] = Field(description="Sun: visible_fraction > 0. Earth: >= comms_min_fraction")


class TimeRange(BaseModel):
    start: str = Field(description="First instant in the state, ISO 8601 UTC (refined to ~1 s), or the window "
                                   "start when starts_before_window")
    end: str = Field(description="First instant out of the state, ISO 8601 UTC (refined to ~1 s), or the window "
                                 "end when ends_after_window")
    duration_h: float = Field(description="end - start, hours (a lower bound when cut by the window)")
    starts_before_window: bool = Field(description="Already in the state at the window start")
    ends_after_window: bool = Field(description="Still in the state at the window end")


class SeriesMetrics(BaseModel):
    """The engine's Metrics over the window, from the samples. No power figures (MECH's /power)."""
    window_hours: float = Field(description="Span from the first to the last sample, hours")
    sunlight_pct: float = Field(description="Share of samples with the Sun visible, percent")
    comms_pct: float = Field(description="Share of samples with the Earth visible for comms, percent")
    both_pct: float = Field(description="Share of samples with both, percent")
    longest_dark_h: float = Field(description="Longest run of samples without Sun, hours (grid resolution)")
    longest_blackout_h: float = Field(description="Longest run of samples without comms, hours (grid resolution)")
    continuous_light: bool = Field(description="Sun visible at every sample")
    continuous_comms: bool = Field(description="Earth visible for comms at every sample")
    eclipse_minutes: float = Field(description="Time with any eclipse (partial or total), minutes, from samples")
    eclipse_events: int = Field(description="Number of separate eclipse stretches in the window")
    max_sun_el_deg: float = Field(description="Highest solar elevation in the window, degrees")
    min_sun_el_deg: float = Field(description="Lowest solar elevation in the window, degrees")


class SeriesResponse(BaseModel):
    site_id: str | None = Field(None, description="Catalogue id; null for manual coordinates")
    lat: float = Field(description="Planetocentric latitude, degrees, Moon Mean-Earth frame")
    lon: float = Field(description="East-positive longitude, degrees, -180..180")
    ground_m: float = Field(description="Ground height above the 1737.4 km reference sphere, metres")
    start: str = Field(description="Window start, ISO 8601 UTC")
    end: str = Field(description="Last sample, ISO 8601 UTC")
    duration_h: float = Field(description="Requested window length, hours")
    step_min: float = Field(description="Sample spacing, minutes")
    samples: int = Field(description="Number of samples (length of every array)")
    mast_m: float = Field(description="Mast height requested, metres")
    mast_used_m: float = Field(description="Mast height of the horizon actually used, metres")
    comms_min_fraction: float = Field(description="Share of the Earth's disc required for comms, 0..1")
    horizon_kind: HorizonKind = Field(description="'terrain' (LOLA mask) or 'smooth_sphere' (geometric dip only)")
    t: list[str] = Field(description="Sample instants, ISO 8601 UTC")
    sun: BodySeries
    earth: BodySeries
    eclipse: list[EclipseState] = Field(description="The Earth covering the Sun, per sample")
    sun_eclipsed_fraction: list[float] = Field(description="Share of the solar disc hidden by the Earth, per sample")
    sunlit_ranges: list[TimeRange] = Field(description="Stretches with the Sun visible")
    comms_ranges: list[TimeRange] = Field(description="Stretches with the Earth visible for comms")
    eclipse_ranges: list[TimeRange] = Field(description="Stretches with any eclipse (partial or total)")
    metrics: SeriesMetrics
