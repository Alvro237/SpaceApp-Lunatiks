"""Response models of the manual-coordinates endpoints (SW-1): the site models plus ``terrain_reference``.
Output format: docs/sw1-output-format.md."""
from __future__ import annotations

from pydantic import BaseModel, Field

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
