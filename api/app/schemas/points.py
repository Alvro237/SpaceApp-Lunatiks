"""Response models of the manual-coordinates endpoints (SW-1): the site models plus ``terrain_reference``.
Output format: docs/sw1-output-format.md."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from .horizon import PLANES_DESCRIPTION, SKYLINE_DISTANCE_DESCRIPTION, HorizonPlane, ProfileSummary
from .state import SeriesResponse, StateResponse


class LongTermComparison(BaseModel):
    pgda: float = Field(description="NASA PGDA product 69 value at the point: 18.6-year average over real LOLA "
                                    "terrain, 960 m cell, 0..1")
    smooth_sphere: float = Field(description="Same quantity from this engine over the smooth-sphere horizon at "
                                             "the point, 2025-2035 every 6 h, 0..1")
    difference: float = Field(description="pgda - smooth_sphere. Negative: the smooth sphere overstates here "
                                          "(crater, slope). Positive: it understates (summit or ridge facing the body)")


class TerrainReference(BaseModel):
    source: str = Field(description="Where the terrain-aware values come from")
    smooth_sphere_period: str = Field(description="Period the smooth-sphere values average over, UTC")
    sun_mean_visible_fraction: LongTermComparison = Field(
        description="Mean visible fraction of the solar disc (PGDA AVGVISIB_65S_240M_201608)")
    earth_any_visible_fraction: LongTermComparison = Field(
        description="Share of time with any part of the Earth's disc visible (PGDA AVGVISIB_65S_240M_201608_EARTH)")


TERRAIN_REFERENCE_DESCRIPTION = ("Which way the smooth sphere errs at this point, from NASA's terrain-aware "
                                 "long-term maps; null north of 65 S, where PGDA has no map")


class PointStateResponse(StateResponse):
    terrain_reference: TerrainReference | None = Field(description=TERRAIN_REFERENCE_DESCRIPTION)


class PointSeriesResponse(SeriesResponse):
    terrain_reference: TerrainReference | None = Field(description=TERRAIN_REFERENCE_DESCRIPTION)


class PointHorizonResponse(ProfileSummary):
    lat: float = Field(description="Planetocentric latitude, degrees, Moon Mean-Earth frame")
    lon: float = Field(description="East-positive longitude, degrees, -180..180")
    ground_m: float = Field(description="Ground height above the 1737.4 km reference sphere, metres (bilinear on "
                                        "the finest LOLA grid; 0 on the smooth sphere)")
    ground_source: Literal["lola_grid", "reference_sphere"] = Field(description="Where the ground height comes from")
    mast_m: float = Field(description="Height of the observer above the ground, metres (computed for this value)")
    horizon_kind: Literal["terrain", "smooth_sphere"] = Field(description=(
        "'terrain': ray-traced over the LOLA elevation grids (lola_elevation_80s at 240 m south of about 80 S, "
        "lola_elevation_60s at 960 m to about 60 S); 'smooth_sphere': outside them, geometric dip -acos(R/(R+h))"))
    near_grid: str | None = Field(description="Finest grid at the point, which decides the near field; null on the "
                                              "smooth sphere")
    near_cell_m: float | None = Field(description="Cell size of that grid, metres")
    terrain_range_km: float | None = Field(description=(
        "Shortest distance, over all azimuths, up to which terrain data exists, km. Below 250 km a ray leaves the "
        "grids early and far terrain in that direction is missing (points near 60 S)"))
    method: str = Field(description="How the skyline was computed")
    validation: str = Field(description="Measured accuracy of the method against the catalogue's fine masks")
    az_step_deg: float = Field(description="Azimuth spacing, degrees")
    az: list[float] = Field(description="Azimuths, degrees clockwise from north, 0 to 360 - az_step_deg")
    elevation_deg: list[float] = Field(description="Skyline elevation at each azimuth, degrees")
    planes: list[HorizonPlane] | None = Field(None, description=PLANES_DESCRIPTION)
    skyline_distance_km: list[float | None] | None = Field(None, description=SKYLINE_DISTANCE_DESCRIPTION)
