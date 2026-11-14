"""Request and response models of POST /api/v1/areas/search (mission mode). snake_case JSON, units in descriptions.

Every filter threshold is optional and has no default: a filter is on when its threshold is given (CLAUDE.md:
thresholds need a cited source or the planner's decision). Method parameters (cell size, horizon discretisation)
have defaults because they set the resolution, not what passes.
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class Region(BaseModel):
    center_lat: float = Field(ge=-90.0, le=-60.0, description="Centre of the search disc, degrees (south of 60 S: the LOLA grids)")
    center_lon: float = Field(ge=-180.0, le=360.0, description="Centre longitude, degrees east")
    radius_km: float = Field(gt=0.0, le=400.0, description="Radius of the search disc, km (keeps the search bounded)")


class AreaFilters(BaseModel):
    # A. search zone
    side: Literal["near", "far"] | None = Field(None, description=(
        "Near side: longitude within 90 deg of the mean sub-Earth meridian (0 E); far side: the rest"))
    away_from_landings_km: float | None = Field(None, gt=0.0, description="At least this far from every past landing (NSSDCA), km")
    # B. terrain and landing
    max_slope_deg: float | None = Field(None, gt=0.0, le=90.0, description="Steepest LOLA slope anywhere in the cell, degrees (320 m grid south of 80 S, 960 m elsewhere)")
    min_elevation_m: float | None = Field(None, description="Lowest ground height allowed, m above the 1737.4 km sphere")
    max_elevation_m: float | None = Field(None, description="Highest ground height allowed, m above the 1737.4 km sphere")
    max_crater_density_per_km2: float | None = Field(None, ge=0.0, description="Craters per km2 (Robbins 2018) counted within crater_radius_km")
    crater_radius_km: float | None = Field(None, gt=0.0, le=50.0, description="Radius of the crater count, km (required with max_crater_density_per_km2)")
    crater_min_diam_km: float | None = Field(None, gt=0.0, description="Smallest crater counted, km (required with max_crater_density_per_km2)")
    max_permanent_shadow: float | None = Field(None, ge=0.0, le=1.0, description="Share of the cell in permanent shadow at most (PGDA 69), 0..1; 0 = no shadow at all")
    min_rim_distance_km: float | None = Field(None, gt=0.0, le=50.0, description=(
        "At least this far from the rim of every crater of rim_min_diam_km or more (Robbins 2018), km"))
    rim_min_diam_km: float | None = Field(None, gt=0.0, description="Smallest crater whose rim counts, km (required with min_rim_distance_km)")
    # C. light (long term, PGDA 69 averages over 18.6 years)
    min_long_term_sun: float | None = Field(None, ge=0.0, le=1.0, description="Mean share of the solar disc visible over 18.6 years at least, 0..1 (PGDA 69, south of 65 S)")
    # D. Earth (long term)
    min_long_term_earth: float | None = Field(None, ge=0.0, le=1.0, description="Share of time with any of the Earth visible over 18.6 years at least, 0..1 (PGDA 69, south of 65 S)")
    # F. radiation
    max_sky_sr: float | None = Field(None, gt=0.0, le=6.2832, description="Open sky at most, steradians (terrain shielding; PGDA 69, south of 65 S)")
    max_dose_mgy: float | None = Field(None, gt=0.0, description="Cosmic-ray dose over the window at most, mGy (silicon): CRaTER climatology x open sky / 4 pi")
    # mission window (per sample, with a ray-traced horizon)
    min_sunlit_fraction: float | None = Field(None, ge=0.0, le=1.0, description="Share of the window with some Sun visible at least, 0..1")
    max_dark_h: float | None = Field(None, ge=0.0, description="Longest stretch without Sun at most, hours")
    min_comms_fraction: float | None = Field(None, ge=0.0, le=1.0, description="Share of the window with the Earth in contact at least, 0..1")
    max_blackout_h: float | None = Field(None, ge=0.0, description="Longest stretch without the Earth at most, hours")
    min_sun_el_at_landing_deg: float | None = Field(None, ge=-90.0, le=90.0, description="Solar elevation at the start of the window at least, degrees")
    max_sun_el_at_landing_deg: float | None = Field(None, ge=-90.0, le=90.0, description="Solar elevation at the start of the window at most, degrees")
    earth_visible_at_landing: bool | None = Field(None, description="True: the Earth must be in contact at the start of the window")
    min_mean_power_w_m2: float | None = Field(None, ge=0.0, description="Mean solar power on 1 m2 of panel over the window at least, W/m2")
    min_light_left_h: float | None = Field(None, ge=0.0, description="Hours of continuous light from the start of the window at least")
    min_contact_left_h: float | None = Field(None, ge=0.0, description="Hours of continuous Earth contact from the start of the window at least")
    min_both_fraction: float | None = Field(None, ge=0.0, le=1.0, description="Share of the window with the Sun visible and the Earth in contact at once, at least")
    robust_delay_h: float | None = Field(None, gt=0.0, le=24 * 30, description=(
        "The window filters must also pass if the landing slips by this many hours (same duration), h"))
    # I. science
    max_psr_distance_km: float | None = Field(None, gt=0.0, le=100.0, description=(
        "Within this distance of a permanently shadowed pixel (PGDA 69, at least half of a 960 m pixel in shadow), km"))
    min_hydrogen_ppm: float | None = Field(None, description=(
        "Hydrogen at least this abundant, ppm by weight (Lunar Prospector neutron spectrometer, 0.5 deg bins, "
        "footprint about 45 km: a regional signal, not a cell-scale one)"))

    @model_validator(mode="after")
    def _crater_trio(self) -> "AreaFilters":
        if self.max_crater_density_per_km2 is not None and (self.crater_radius_km is None or self.crater_min_diam_km is None):
            raise ValueError("max_crater_density_per_km2 needs crater_radius_km and crater_min_diam_km")
        if self.min_rim_distance_km is not None and self.rim_min_diam_km is None:
            raise ValueError("min_rim_distance_km needs rim_min_diam_km")
        return self


WINDOW_FILTERS = ("min_sunlit_fraction", "max_dark_h", "min_comms_fraction", "max_blackout_h", "min_sun_el_at_landing_deg",
                  "max_sun_el_at_landing_deg", "earth_visible_at_landing", "min_mean_power_w_m2", "min_light_left_h",
                  "min_contact_left_h", "min_both_fraction")


class AreaSearchRequest(BaseModel):
    region: Region
    filters: AreaFilters
    cell_km: float = Field(1.92, ge=0.24, le=7.68, description="Cell size of the search raster, km")
    landing_radius_km: float | None = Field(None, gt=0.0, le=20.0, description=(
        "A cell survives only if no cell failing a static filter lies within this radius, km (room for a landing ellipse)"))
    start: datetime | None = Field(None, description="Start of the mission window, ISO 8601 UTC (needed by window filters and the dose)")
    duration_h: float | None = Field(None, gt=0.0, le=24 * 400, description="Mission window, hours")
    step_min: float = Field(60.0, ge=10.0, le=1440.0, description="Time step of the window filters, minutes")
    mast_m: float = Field(2.0, ge=0.0, le=10.0, description="Height of the panel and antenna above the ground, m")
    panel: Literal["tracking", "vertical", "horizontal"] = Field("vertical", description="Panel orientation for the power filter")
    comms_min_fraction: float = Field(0.5, gt=0.0, le=1.0, description="Share of the Earth's disc above the horizon that counts as contact")
    horizon_az_step_deg: float = Field(0.5, ge=0.25, le=5.0, description="Azimuth step of the ray-traced horizons of the window samples, degrees")
    horizon_radius_km: float = Field(150.0, ge=20.0, le=250.0, description="How far each horizon ray goes, km (terrain beyond is ignored)")
    max_window_samples: int = Field(300, ge=1, le=2000, description=(
        "Most samples for the window filters, placed by a quadtree that refines where neighbours disagree"))
    unknown_passes: bool = Field(False, description="True: a filter without data at a cell lets it through")
    weights: dict[str, float] | None = Field(None, description="Score weights among viable cells: sunlight, comms (default equal)")

    @model_validator(mode="after")
    def _window(self) -> "AreaSearchRequest":
        needs = any(getattr(self.filters, k) is not None for k in WINDOW_FILTERS) or self.filters.max_dose_mgy is not None
        if needs and (self.start is None or self.duration_h is None):
            raise ValueError("window filters and the dose need start and duration_h")
        if self.filters.robust_delay_h is not None and not any(getattr(self.filters, k) is not None for k in WINDOW_FILTERS):
            raise ValueError("robust_delay_h applies to the window filters: switch at least one on")
        return self


class GridInfo(BaseModel):
    projection: str = Field(description="South polar stereographic, true scale at the pole, R = 1737.4 km, MOON_ME")
    x_left_m: float = Field(description="Projected x of the left edge of the first column, m")
    y_top_m: float = Field(description="Projected y of the top edge of the first row, m")
    cell_m: float = Field(description="Cell size, m")
    nx: int
    ny: int


class FilterCount(BaseModel):
    id: str
    stage: Literal["static", "landing_radius", "window"]
    cells_in: int = Field(description="Cells reaching this filter")
    cells_out: int = Field(description="Cells it removed")
    cells_unknown: int = Field(description="Cells without data for it")


class Area(BaseModel):
    id: int
    cells: int
    area_km2: float
    centroid_lat: float
    centroid_lon: float
    best_lat: float = Field(description="Cell with the highest score")
    best_lon: float
    best_score: float = Field(description="0..1")
    mean_score: float = Field(description="0..1")
    sites: list[str] = Field(description="Catalogue sites inside the area")


class WindowInfo(BaseModel):
    samples: int = Field(description="Window samples evaluated, each with its own ray-traced horizon")
    finest_tile_km: float = Field(description="Side of the smallest quadtree tile (boundaries), km")
    coarsest_tile_km: float = Field(description="Side of the largest quadtree tile (uniform interiors), km")
    horizon_az_step_deg: float
    horizon_radius_km: float


class AreaSearchResponse(BaseModel):
    grid: GridInfo
    codes_b64: str = Field(description="uint8 per cell, row-major (row 0 = top): 0 outside, 1 fails a static filter or the "
                                       "landing radius, 2 fails a window filter, 3 viable, 4 unknown")
    score_b64: str = Field(description="uint8 per cell: score 0..255 for viable cells, 0 elsewhere")
    counts: dict[str, int] = Field(description="Cells by code: outside, failed_static, failed_window, viable, unknown")
    funnel: list[FilterCount]
    areas: list[Area] = Field(description="Largest connected viable areas, best first (at most 12)")
    window: WindowInfo | None
    seconds: float
    assumptions: list[str]
