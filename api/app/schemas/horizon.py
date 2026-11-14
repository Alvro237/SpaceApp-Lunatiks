"""Response model of the horizon profile endpoint (SW-1). Output format: docs/sw1-output-format.md."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class HorizonPlane(BaseModel):
    """One layer of the landscape: where a visible crest is at each azimuth of the response's ``az``."""
    distance_km: list[float | None] = Field(description="Distance from the observer to the crest, km; null where "
                                                        "this layer has no crest at that azimuth")
    elevation_deg: list[float | None] = Field(description="Elevation of the crest seen from the observer, degrees; "
                                                          "null where this layer has no crest")


PLANES_DESCRIPTION = ("Up to three layers of the landscape, near to far, the last one being the skyline: at each "
                      "azimuth the visible crests of the terrain along that ray (a crest is higher than everything "
                      "nearer and falls away by at least 0.3 degrees behind itself). A layer with no crest at an "
                      "azimuth is null there. Ray-traced over the LOLA elevation grids (240 m south of about 80 S, "
                      "960 m to about 60 S); null where no grid covers the point. For drawing depth: the skyline "
                      "metrics are elevation_deg")
SKYLINE_DISTANCE_DESCRIPTION = ("Distance to the skyline sample at each azimuth, km (ray-traced over the LOLA elevation "
                                "grids); null where no grid covers the point or the ray has no terrain data")


class ProfileSummary(BaseModel):
    max_deg: float = Field(description="Highest skyline elevation, degrees")
    max_az_deg: float = Field(description="Azimuth of the highest skyline point, degrees clockwise from north")
    min_deg: float = Field(description="Lowest skyline elevation, degrees")
    min_az_deg: float = Field(description="Azimuth of the lowest skyline point, degrees clockwise from north")
    mean_deg: float = Field(description="Mean skyline elevation over the 720 azimuths, degrees")


class ZonePoint(ProfileSummary):
    bearing_deg: float = Field(description="Direction from the site centre, degrees clockwise from north")
    distance_m: float = Field(description="Distance from the site centre over the 1737.4 km sphere, metres "
                                          "(0 for the centre itself)")
    lat: float = Field(description="Planetocentric latitude, degrees, Moon Mean-Earth frame")
    lon: float = Field(description="East-positive longitude, degrees, -180..180")
    ground_m: float = Field(description="Ground height above the 1737.4 km sphere, metres")
    elevation_deg: list[float] = Field(description="Skyline elevation at each azimuth of HorizonResponse.az, degrees")


class Zone(BaseModel):
    mast_m: float = Field(description="Mast height of the neighbour masks, metres (the pipeline stores 2 m only)")
    points: list[ZonePoint] = Field(description="The site centre first, then the neighbours by ring and bearing")


class HorizonResponse(ProfileSummary):
    site_id: str = Field(description="Catalogue id")
    lat: float = Field(description="Planetocentric latitude, degrees, Moon Mean-Earth frame")
    lon: float = Field(description="East-positive longitude, degrees, -180..180")
    ground_m: float = Field(description="Ground height above the 1737.4 km reference sphere, metres")
    mast_m: float = Field(description="Mast height requested, metres")
    mast_used_m: float = Field(description="Mast height of the profile returned, metres: the nearest stored "
                                           "terrain mask, or the requested one on a smooth sphere")
    masts_available_m: list[float] = Field(description="Mast heights with a stored terrain mask; empty on a "
                                                       "smooth sphere (any mast is computed exactly)")
    horizon_kind: Literal["terrain", "smooth_sphere"] = Field(
        description="'terrain': LOLA ray-traced mask to 175 km; 'smooth_sphere': geometric dip -acos(R/(R+h))")
    az_step_deg: float = Field(description="Azimuth spacing, degrees")
    az: list[float] = Field(description="Azimuths, degrees clockwise from north, 0 to 360 - az_step_deg")
    elevation_deg: list[float] = Field(description="Skyline elevation at each azimuth, degrees. Between "
                                                   "azimuths interpolate linearly, wrapping at 360")
    planes: list[HorizonPlane] | None = Field(None, description=PLANES_DESCRIPTION)
    skyline_distance_km: list[float | None] | None = Field(None, description=SKYLINE_DISTANCE_DESCRIPTION)
    zone_available: bool = Field(description="True when neighbour masks exist for this site")
    zone: Zone | None = Field(description="Neighbour masks; null unless include_zone=true and zone_available")
