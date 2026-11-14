"""Request and response pieces shared by the mission-analysis endpoints (power, sun, earth, thermal, radiation).

Every such request names a place (catalogue ``site_id`` or manual ``lat``/``lon``) and a mission window;
every response says which horizon it used and gives time results as a fraction and as time ranges.

The height above the ground is not an input: panels, antennas and the habitat are taken 2 m above the ground in
every MECH result (``MAST_M``, team decision 2026-11-14: most panels sit on structures). A ``mast_m`` sent by a
client is ignored; ``mast_m_used`` in the response reports the height used.
"""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field, model_validator

MAX_SAMPLES = 20_000
MAST_M = 2.0      # m above the ground, fixed (team decision 2026-11-14); terrain masks exist for 0, 2, 5 and 10 m


class WindowRequest(BaseModel):
    site_id: str | None = Field(None, description="Catalogue site id (GET /api/v1/sites); or give lat and lon")
    lat: float | None = Field(None, ge=-90.0, le=90.0, description="Planetocentric latitude, degrees, MOON_ME")
    lon: float | None = Field(None, ge=-180.0, le=180.0, description="East-positive longitude, degrees, -180..180")
    start: datetime = Field(description="Start of the mission window, ISO 8601 UTC")
    duration_h: float = Field(gt=0.0, description="Mission window length, hours")
    step_min: float = Field(60.0, ge=1.0, le=1440.0, description="Sampling step, minutes")

    @model_validator(mode="after")
    def _check_window(self):
        has_site, has_point = self.site_id is not None, self.lat is not None or self.lon is not None
        if has_site == has_point:
            raise ValueError("give either site_id or both lat and lon")
        if has_point and (self.lat is None or self.lon is None):
            raise ValueError("give both lat and lon")
        samples = int(self.duration_h * 60.0 / self.step_min) + 1
        if samples > MAX_SAMPLES:
            raise ValueError(f"{samples} samples requested; the limit is {MAX_SAMPLES} (raise step_min)")
        return self


class TimeRange(BaseModel):
    start: str = Field(description="ISO 8601 UTC")
    end: str = Field(description="ISO 8601 UTC, last sample inside the range")


class WindowResponse(BaseModel):
    site_id: str | None
    lat: float
    lon: float
    horizon_kind: str = Field(description=(
        "terrain (LOLA mask) or smooth_sphere (no terrain mask: an estimate, not a bound; real terrain shortens light "
        "and comms in craters and lengthens them on peaks)"))
    mast_m_used: float = Field(description=(
        "Height above the ground the horizon is seen from (panels, antenna, habitat): fixed at 2 m, team decision, m"))
    start: str
    duration_h: float
    step_min: float
    assumptions: list[str] = Field(description="Idealisations and limits behind these numbers")
    t: list[str] = Field(description="Sample times, ISO 8601 UTC")
