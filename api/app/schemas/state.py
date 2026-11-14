"""Request options and response models of the Sun/Earth state endpoints (SW-1).

Shared by ``GET /api/v1/sites/{site_id}/state`` and, later, ``GET /api/v1/points/state``.
JSON field names are snake_case; angles in degrees; times ISO 8601 UTC with a trailing Z.
Output format documented for integration in ``docs/sw1-output-format.md``.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

PanelModel = Literal["tracking", "vertical", "horizontal"]
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
    panel: PanelModel = Field(description="Solar array model used for power_w_m2")
    comms_min_fraction: float = Field(description="Share of the Earth's disc required for comms, 0..1")
    horizon_kind: HorizonKind = Field(description="'terrain': LOLA ray-traced mask; 'smooth_sphere': geometric "
                                                  "dip only (real terrain can only shorten light and comms)")
    sun: BodyState
    earth: BodyState
    eclipse: EclipseState = Field(description="The Earth covering the Sun as seen from the site (a lunar eclipse "
                                              "seen from the Earth)")
    sun_eclipsed_fraction: float = Field(description="Fraction of the solar disc hidden behind the Earth, 0..1 "
                                                     "(1 during a total eclipse, 0 when eclipse is 'none')")
    irradiance_w_m2: float = Field(description="Solar irradiance normal to the rays at the actual Sun "
                                               "distance, W/m2, before horizon and panel factors")
    power_w_m2: float = Field(description="irradiance_w_m2 x sun.visible_fraction x (1 - sun_eclipsed_fraction) "
                                          "x panel cosine factor, W/m2 of array (before efficiency)")
    next_sun_transition: Transition | None = Field(
        description="Next sunset (kind 'set') or sunrise ('rise'); null if none within the search span")
    next_earth_transition: Transition | None = Field(
        description="Next Earthset or Earthrise for comms; null if none within the search span")
    transition_search_days: float = Field(description="Days searched ahead for the transitions (capped by "
                                                      "the end of the ephemeris tables)")
