"""Response models of the site catalogue. JSON field names are snake_case across the whole API."""
from __future__ import annotations

from pydantic import BaseModel, Field


class SourceRef(BaseModel):
    label: str
    url: str
    note: str | None = None


class TerrainSummary(BaseModel):
    available: bool = Field(description="True when a LOLA terrain horizon mask exists for the site")
    reason: str | None = Field(None, description="Why there is no terrain data, when there is none")
    ground_height_m: float | None = Field(None, description="Height above the 1737.4 km reference sphere")
    slope_deg: float | None = Field(None, description="LOLA slope at the site, 100 m baseline")
    horizon_2m_max_deg: float | None = Field(None, description="Highest skyline elevation seen from a 2 m mast")
    horizon_2m_mean_deg: float | None = None


class SiteSummary(BaseModel):
    id: str
    name: str
    group: str
    kind: str
    lat: float = Field(description="Planetocentric latitude, degrees, Moon Mean-Earth frame")
    lon: float = Field(description="East-positive longitude, degrees, -180..180")
    region: str | None = None
    landing_utc: str | None = None
    terrain_available: bool


class SiteDetail(SiteSummary):
    source: SourceRef
    terrain: TerrainSummary
    mast_heights_m: list[float] = Field(description="Mast heights with a stored terrain horizon mask")


class SiteList(BaseModel):
    count: int
    groups: list[str]
    sites: list[SiteSummary]
