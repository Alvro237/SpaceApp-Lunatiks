"""Request and response models of POST /api/v1/radiation (MECH). snake_case JSON, units in descriptions."""
from __future__ import annotations

from pydantic import BaseModel, Field

from .common import WindowRequest


class RadiationRequest(WindowRequest):
    si_to_tissue_factor: float = Field(1.333, gt=0.0, description=(
        "Absorbed dose in water per absorbed dose in silicon; default 1.333, the CRaTER team's conversion "
        "(NASA ISWA CRaTER data page)"))
    quality_factor: float | None = Field(None, gt=0.0, description=(
        "Mean GCR quality factor to turn absorbed dose (mGy) into effective dose (mSv); give it with a source "
        "(MSL RAD cruise measurements, Zeitlin et al. 2013, imply about 3.8: verify). Needed for mSv and the risk index"))


class DailyStats(BaseModel):
    mean: float
    p05: float
    p50: float
    p95: float
    max: float
    days: int = Field(description="Days of record used")


class Range3(BaseModel):
    low: float = Field(description="With the 5th-percentile daily rate")
    mean: float = Field(description="With the mean daily rate")
    high: float = Field(description="With the 95th-percentile daily rate")


class SpeRecord(BaseModel):
    days_flagged: int = Field(description="Full days in the record without a GCR value (solar-particle-event days)")
    largest_day: str = Field(description="Date of the largest daily dose in the record, measured in orbit")
    largest_day_mgy_si: float = Field(description="That day's dose as measured in lunar orbit, mGy(Si); not scaled to the surface")


class Risk(BaseModel):
    index: float = Field(description="1 (negligible) .. 10 (whole career limit in one mission), GCR only")
    share_of_career_limit: float = Field(description="Mean mission effective dose / 600 mSv")
    index_with_worst_storm: float | None = Field(description=(
        "Same scale if the record's largest solar storm day also hit the mission (storm counted with Q = 1, "
        "the minimum: a lower bound)"))
    worst_storm_msv: float | None = Field(description="That storm day at this point, mSv (lower bound, isotropic approximation)")
    scale: str


class DatasetRef(BaseModel):
    name: str
    url: str
    first: str
    last: str


class RadiationResponse(BaseModel):
    site_id: str | None
    lat: float
    lon: float
    horizon_kind: str
    start: str
    duration_h: float
    basis: str = Field(description="climatology: the mission date is outside the record, statistics of the record are used")
    assumptions: list[str]
    sky_solid_angle_sr: float | None = Field(description="Open sky at the point, sr (flat ground 2 pi = 6.283)")
    sky_source: str = Field(description="dataset (PGDA 69 grid), computed (smooth sphere: 2 pi) or unavailable")
    shielding_factor: float | None = Field(description="Share of the free-space dose that reaches the point: sky / 4 pi")
    gcr_free_space_daily_mgy_si: DailyStats = Field(description="CRaTER GCR dose rate, free-space equivalent, mGy(Si)/day")
    gcr_surface_daily_mgy_si: DailyStats | None = Field(description="Same scaled to the point, mGy(Si)/day")
    mission_gcr_dose_mgy_si: Range3 | None = Field(description="GCR dose over the mission at the point, mGy(Si)")
    mission_effective_dose_msv: Range3 | None = Field(description="Effective dose over the mission, mSv; null without both factors")
    career_limit_msv: float = Field(description="NASA-STD-3001 career effective dose limit, mSv")
    fraction_of_career_limit: float | None = Field(description="Mean mission effective dose / career limit")
    risk: Risk | None = Field(None, description="Astronaut risk on a 1-10 scale; null without quality_factor or sky data")
    spe_record: SpeRecord
    dataset: DatasetRef
