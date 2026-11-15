"""Request and response models of POST /api/v1/link (AERO-2). snake_case JSON, units in descriptions.

Level 1 (geometric contact): there is contact at an instant when the lunar site sees the Earth AND at least one of
the selected antennas sees the Moon above its elevation limit. Level 2 (link budget) is not available yet.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

from .common import TimeRange, WindowRequest, WindowResponse

Direction = Literal["downlink", "uplink_low_power", "uplink_high_power"]


class CustomStation(BaseModel):
    """An antenna the user adds. Its elevation limit is one number for every azimuth."""
    id: str = Field(min_length=1, max_length=40, pattern=r"^[A-Za-z0-9_-]+$",
                    description="Your own identifier; must not clash with a catalogue id (GET /api/v1/link/stations)")
    name: str | None = Field(None, max_length=80, description="Label shown in the response; defaults to the id")
    lat_deg: float = Field(ge=-90.0, le=90.0, description="Geodetic latitude, degrees, north positive")
    lon_deg: float = Field(ge=-180.0, le=180.0, description="Longitude, degrees, east positive")
    height_m: float = Field(0.0, ge=-500.0, le=9000.0, description="Height above the WGS84 ellipsoid, metres")
    min_elevation_deg: float = Field(ge=0.0, lt=90.0, description=(
        "Lowest elevation at which the antenna can track the Moon, degrees; used for every azimuth and every "
        "direction. Required: no default is assumed."))


class LinkRequest(WindowRequest):
    level: Literal[1] = Field(1, description="1 = geometric contact (the only level available now)")
    networks: list[str] = Field(default_factory=lambda: ["dsn", "estrack", "jaxa"], description=(
        "Antenna networks to use (GET /api/v1/link/stations lists them): dsn, estrack, jaxa. An empty list is "
        "allowed when custom_stations is given."))
    custom_stations: list[CustomStation] = Field(default_factory=list, max_length=20, description=(
        "Antennas you add, used together with the selected networks"))
    direction: Direction = Field("downlink", description=(
        "downlink = the Moon transmits and the antenna receives (receive elevation limit); uplink_low_power and "
        "uplink_high_power = the antenna transmits (transmit limits; DSN only, other antennas have none and are skipped)"))
    comms_min_fraction: float = Field(0.5, gt=0.0, le=1.0, description=(
        "Share of the Earth's disc that must be above the lunar site's horizon to count as visible, 0..1 "
        "(team convention 0.5 = the centre, CLAUDE.md)"))

    @model_validator(mode="after")
    def _some_station(self):
        if not self.networks and not self.custom_stations:
            raise ValueError("select at least one network or add a custom station")
        ids = [c.id for c in self.custom_stations]
        if len(set(ids)) != len(ids):
            raise ValueError("custom station ids must be unique")
        return self


class StationInfo(BaseModel):
    id: str
    name: str
    network: str
    agency: str
    site: str
    country: str
    lat_deg: float
    lon_deg: float
    height_m: float
    dish: str
    bands: dict | None = Field(description="Transmit/receive bands when a source states them, else null")
    limit_source: Literal["cited", "owner_estimate"] = Field(description=(
        "cited = published by the operator; owner_estimate = a value chosen by the project (see limit_source_note)"))
    limit_source_note: str
    has_azimuth_mask: bool = Field(description="True when the receive limit varies with azimuth")
    receive_limit_deg: dict = Field(description="min and max of the receive elevation limit over azimuth, degrees")
    has_transmit_limits: bool


class StationCatalogue(BaseModel):
    networks: dict[str, str] = Field(description="Network id -> description")
    stations: list[StationInfo]


class StationResult(BaseModel):
    id: str
    name: str
    network: str = Field(description="dsn, estrack, jaxa or custom")
    lat_deg: float
    lon_deg: float
    height_m: float
    limit_source: Literal["cited", "owner_estimate", "user"]
    limit_min_deg: float = Field(description="Lowest elevation limit over azimuth for this direction, degrees")
    limit_max_deg: float = Field(description="Highest elevation limit over azimuth for this direction, degrees")
    moon_visible_fraction: float = Field(description="Share of samples with the Moon above this antenna's limit, 0..1")
    moon_visible_hours: float = Field(description="Samples with the Moon visible x step, hours")
    moon_visible_ranges: list[TimeRange]
    contact_fraction: float = Field(description=(
        "Share of samples with the Earth visible from the lunar site AND the Moon visible from this antenna, 0..1"))
    contact_hours: float
    now_moon_azimuth_deg: float = Field(description="Azimuth of the Moon from the antenna at start, degrees from north")
    now_moon_elevation_deg: float = Field(description="Elevation of the Moon from the antenna at start, degrees")
    now_limit_deg: float = Field(description="The antenna's elevation limit in that direction at start, degrees")


class SkippedStation(BaseModel):
    id: str
    reason: str


class LinkNow(BaseModel):
    earth_visible: bool = Field(description="The lunar site sees the Earth at start")
    any_station_sees_moon: bool
    contact: bool = Field(description="Both of the above at start")
    stations_in_contact: list[str] = Field(description="Ids of the antennas in contact at start")


class LinkResponse(WindowResponse):
    level: int
    direction: str
    comms_min_fraction: float
    networks_used: list[str]
    now: LinkNow
    contact: list[bool] = Field(description="Contact at each sample: the site sees the Earth and some antenna sees the Moon")
    contact_window_fraction: float = Field(description="Share of samples with contact, 0..1")
    contact_hours: float = Field(description="Samples with contact x step, hours")
    contact_ranges: list[TimeRange] = Field(description="Time ranges with contact")
    longest_contact_h: float
    longest_blackout_h: float = Field(description="Longest stretch without contact, hours")
    earth_visible_fraction: float = Field(description="Share of samples where the lunar site sees the Earth, 0..1")
    earth_visible_ranges: list[TimeRange]
    any_station_fraction: float = Field(description="Share of samples where at least one antenna sees the Moon, 0..1")
    any_station_ranges: list[TimeRange]
    stations: list[StationResult] = Field(description="One entry per antenna used, with its own windows")
    skipped_stations: list[SkippedStation]
    estimated_limits: list[str] = Field(description=(
        "Ids of the antennas whose elevation limit is an owner estimate: the result depends on an unconfirmed value"))
