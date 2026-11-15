"""Request and response models of the suitability search (mission design PR 3, as amended by
docs/mission-planner-ui-spec.md section 6). snake_case JSON, units in descriptions.

Every criterion is a hard limit chosen by the planner (no defaults: CLAUDE.md, thresholds need a cited source or
the planner's decision). The score is per category: each switched-on category with a natural measure adds a layer
(0..1 per cell) and the layers are weighted by the planner's priority order (rank order centroid weights).
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from .areas import GridInfo, WindowInfo
from .link import CustomStation, Direction

CategoryId = Literal["search", "power", "earth", "topography", "landing", "science", "radiation", "schedule"]


class SuitabilityRegion(BaseModel):
    center_lat: float = Field(ge=-90.0, le=-60.0, description="Centre of the search disc, degrees (south of 60 S: the LOLA grids)")
    center_lon: float = Field(ge=-180.0, le=360.0, description="Centre longitude, degrees east")
    radius_km: float = Field(gt=0.0, le=400.0, description="Radius of the search disc, km")


class CriterionInput(BaseModel):
    id: str = Field(description="Criterion id from GET /api/v1/suitability/criteria")
    limit: float | None = Field(None, description="Limit of a value criterion, in the criterion unit (the catalogue says which side passes)")
    min: float | None = Field(None, description="Lowest allowed value of a range criterion, criterion unit")
    max: float | None = Field(None, description="Highest allowed value of a range criterion, criterion unit")
    choice: str | None = Field(None, description="Chosen option of a choice criterion (side: near | far; past_landings: away | near)")
    params: dict[str, float | str] = Field(default_factory=dict, description=(
        "Criterion parameters (see the catalogue): target_distance_km takes feature (IAU name); battery_model takes the "
        "flat fields of POST /api/v1/power level 3 (panel_area_m2, cell_efficiency, derating, load_w, battery_capacity_wh, "
        "battery_initial_soc, battery_min_soc, charge_efficiency, discharge_efficiency, optional night_load_w)"))


class SuitabilityLink(BaseModel):
    """Radio link settings (AERO-2). When given, Earth contact means a radio link: some part of the Earth's disc is above
    the site's horizon AND an antenna of the chosen networks sees the Moon above its elevation limit. It replaces the
    share-of-disc rule (`comms_min_fraction`), which is then not used. Geometry only: no link budget in the search
    (the margin is the same at every site; ask POST /api/v1/link for the proposed sites)."""
    networks: list[str] = Field(default_factory=lambda: ["dsn", "estrack", "jaxa"], description=(
        "Antenna networks to use (GET /api/v1/link/stations lists them): dsn, estrack, jaxa. May be empty when "
        "custom_stations is given"))
    custom_stations: list[CustomStation] = Field(default_factory=list, max_length=20, description="Antennas you add")
    direction: Direction = Field("downlink", description=(
        "downlink = receive limits; uplink_low_power and uplink_high_power = the antenna must be able to send commands "
        "(transmit limits; DSN only, the other antennas have none and are left out)"))

    @model_validator(mode="after")
    def _some_station(self):
        if not self.networks and not self.custom_stations:
            raise ValueError("select at least one network or add a custom station")
        ids = [c.id for c in self.custom_stations]
        if len(set(ids)) != len(ids):
            raise ValueError("custom station ids must be unique")
        return self


class SuitabilityRequest(BaseModel):
    region: SuitabilityRegion
    start: datetime = Field(description="Start of the mission window (landing), ISO 8601 UTC")
    duration_h: float = Field(gt=0.0, le=24 * 400, description="Mission window, hours")
    categories: list[CategoryId] = Field(default_factory=list, description=(
        "Categories switched on. A criterion is accepted only when its category is on; a category on with no criterion "
        "still scores with its natural measure when it has one (power: share sunlit, earth: share with contact)"))
    criteria: list[CriterionInput] = Field(default_factory=list, max_length=24, description="Hard limits set by the planner")
    priority: list[str] | None = Field(None, description=(
        "Scored categories, most important first; weights by rank order centroid (Barron and Barrett 1996). Scored "
        "categories missing from the list follow in catalogue order"))
    cell_km: float = Field(0.96, ge=0.24, le=7.68, description="Cell size of the raster, km")
    landing_radius_km: float | None = Field(None, gt=0.0, le=20.0, description=(
        "Landing ellipse radius, km: a cell survives only if no cell failing a static criterion lies within it; the "
        "site score is the worst score within it"))
    robust_delay_h: float | None = Field(None, gt=0.0, le=24 * 30, description="Hard window criteria must also pass if the landing slips by this many hours, h")
    step_min: float = Field(60.0, ge=10.0, le=1440.0, description="Time step of the window criteria and of the bound, minutes")
    mast_m: float = Field(2.0, ge=0.0, le=10.0, description="Height of panel and antenna above the ground, m")
    panel: Literal["tracking", "vertical", "horizontal"] = Field("vertical", description="Panel orientation (battery model)")
    comms_min_fraction: float = Field(0.5, gt=0.0, le=1.0, description="Share of the Earth's disc above the horizon that counts as contact (team parameter, 0.5); not used when `link` is given")
    link: SuitabilityLink | None = Field(None, description=(
        "Radio link settings. Given: the Earth criteria (longest blackout, Earth in view at landing, the Earth score) and "
        "the link criteria use contact with the antennas of these networks instead of the share of the Earth's disc"))
    horizon_az_step_deg: float = Field(0.5, ge=0.25, le=5.0, description="Azimuth step of the traced horizons, degrees")
    horizon_radius_km: float = Field(150.0, ge=20.0, le=250.0, description="How far each horizon ray goes, km")
    max_window_samples: int = Field(300, ge=1, le=2000, description="Most quadtree samples for the window criteria")
    unknown_passes: bool = Field(False, description="True: a criterion without data at a cell lets it through")
    use_bounds: bool = Field(True, description="Method switch: drop tiles the ephemeris bound proves to fail (false only for validation)")
    top_k: int = Field(10, ge=1, le=25, description="Number of proposed landing sites")
    min_separation_km: float = Field(10.0, gt=0.0, le=200.0, description="Least ground distance between two proposed sites, km (display spacing, not a physical threshold)")


class FunnelStep(BaseModel):
    id: str
    stage: Literal["geometry", "bound", "regional", "medium", "fine", "landing_radius", "window"]
    cells_in: int = Field(description="Cells alive when it ran")
    cells_out: int = Field(description="Cells it removed")
    cells_unknown: int = Field(description="Alive cells without data for it")
    seconds: float


class BoundInfo(BaseModel):
    tile_km: list[float] = Field(description="Tile sides used, coarse to fine, km")
    tiles_evaluated: int
    cells_proven_failed: int
    by_criterion: dict[str, int] = Field(description="Cells proven failed, by the first criterion (catalogue order) that failed")
    h_min_m: float = Field(description="Lowest terrain height assumed, m (grid minimum minus the margin)")
    elev_margin_m: float
    margin_deg: float


class Layer(BaseModel):
    category: CategoryId
    label: str
    measure: str = Field(description="What the 0..1 utility measures, in words")
    weight: float = Field(description="Normalised weight in the score, 0..1")
    utility_b64: str = Field(description="uint8 per cell, row-major: floor(utility x 250 + 0.5), 255 = no data or not scored")


class SiteCategory(BaseModel):
    category: CategoryId
    label: str
    utility: float | None = Field(description="0..1 at the site (None: no data)")
    weight: float
    contribution: float | None = Field(description="weight x utility")


class SiteCriterion(BaseModel):
    id: str
    label: str
    unit: str | None
    value: float | None = Field(description="At the site, criterion unit (window values exact when window_exact); None without data or unbounded")
    passes: bool | None = Field(description="Hard test at the site; None without data")
    margin: float | None = Field(description="Distance to the limit on the passing side, criterion unit (range: to the nearer bound)")


class NearFeature(BaseModel):
    name: str
    distance_km: float
    bearing_deg: float = Field(description="From the feature centre to the site, clockwise from north")


class TopSite(BaseModel):
    rank: int
    lat: float
    lon: float
    near: NearFeature | None
    score: float = Field(description="0..1 at the site cell")
    area_score: float = Field(description="0..1, worst score within the landing radius (= score without one)")
    coverage: float = Field(description="Share of the preference weight with data at the site, 0..1")
    clearance_km: float = Field(description="Distance to the nearest cell that is not viable, km (map distance)")
    window_exact: bool | None = Field(description="True: window values evaluated at the site with its own traced horizon; None: no window run")
    horizon_kind: Literal["terrain"] | None
    categories: list[SiteCategory]
    criteria: list[SiteCriterion]
    pros: list[str] = Field(description="Category ids that help the site most (utility >= 0.5), strongest first")
    cons: list[str] = Field(description="Category ids that cost the site most (utility < 0.5), strongest first")
    unknown: list[str] = Field(description="Active criteria without data at the site")


class SuitabilityResponse(BaseModel):
    grid: GridInfo
    codes_b64: str = Field(description=(
        "uint8 per cell, row-major (row 0 = top): 0 outside, 1 fails a static criterion or the landing radius, 2 fails a "
        "window criterion (sampled), 3 viable, 4 unknown, 5 proven to fail a window criterion by the ephemeris bound"))
    score_b64: str = Field(description="uint8 per cell: 0 not viable, 1..255 = score x 255 for viable cells")
    limiting_b64: str = Field(description="uint8 per cell: index in `layers` of the category that costs the most score (largest weight x (1 - utility)), 255 = none")
    layers: list[Layer]
    weights: dict[str, float] = Field(description="Category -> normalised weight")
    counts: dict[str, int] = Field(description="Cells by code: outside, failed_static, failed_window, viable, unknown, failed_bound")
    funnel: list[FunnelStep]
    bound: BoundInfo | None
    window: WindowInfo | None
    sites: list[TopSite]
    sites_dropped: int = Field(description="Candidates that failed a hard window criterion when evaluated exactly")
    seconds: float
    assumptions: list[str]


# ---- GET /api/v1/suitability/criteria

class CategoryInfo(BaseModel):
    id: CategoryId
    title: str
    score: str | None = Field(description="What the category adds to the score, in words (None: no score)")


class ParamInfo(BaseModel):
    key: str
    label: str
    unit: str | None
    kind: Literal["number", "text"]
    min: float | None
    max: float | None
    required: bool


class CriterionInfo(BaseModel):
    id: str
    category: CategoryId
    label: str
    unit: str | None
    kind: Literal["value", "range", "choice", "flag"]
    comparator: Literal[">=", "<="] | None = Field(description="value criteria: how the value is compared with the limit")
    options: list[str] = Field(description="choice criteria: the options")
    stage: Literal["geometry", "regional", "medium", "fine", "window"]
    params: list[ParamInfo]
    coverage: str
    source: str
    tip: str
    available: bool
    unavailable_reason: str | None


class FixedInput(BaseModel):
    id: str
    label: str
    tip: str


class CriteriaCatalogue(BaseModel):
    categories: list[CategoryInfo]
    fixed_inputs: list[FixedInput]
    request_parameters: list[FixedInput] = Field(description="Inputs sent as request fields, not criteria (landing_radius_km, robust_delay_h, comms_min_fraction)")
    criteria: list[CriterionInfo]


# ---- GET /api/v1/suitability/features?q=&limit=

class FeatureMatch(BaseModel):
    name: str = Field(description="IAU name, as accepted by target_distance_km's feature parameter")
    lat: float = Field(description="Centre latitude, degrees")
    lon: float = Field(description="Centre longitude, degrees east -180..180")
    diameter_km: float | None
    type: str = Field(description="Feature type (crater, mons, ...)")


class FeatureList(BaseModel):
    features: list[FeatureMatch] = Field(description="Named features south of 55 S whose name contains the query, largest first")
