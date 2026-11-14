"""Query parameters and request checks shared by every SW-1 endpoint (state, series, horizon, points).

One place for the rules the owner decided (mast null = 0 m, sample cap, coordinate bounds) so the endpoints
cannot drift apart. Request validation only: no physics.
"""
from __future__ import annotations

from datetime import datetime
from typing import Annotated

import numpy as np
from fastapi import HTTPException, Query
from pydantic import AfterValidator, BeforeValidator

from .. import services
from ..db.store import DataStore

T_QUERY = Query(..., description="Instant, ISO 8601 (e.g. 2026-11-20T12:00:00Z). No offset = UTC",
                examples=["2026-11-20T12:00:00Z"])
DEFAULT_MAST_M = 0.0   # owner's decision (Sergio): a missing or null mast means the ground itself


def _null_to_default_mast(v):
    """Absent, empty (``mast_m=``) or literal ``null``/``none`` all mean the default mast, 0 m."""
    if v is None or (isinstance(v, str) and v.strip().lower() in ("", "null", "none")):
        return DEFAULT_MAST_M
    return v


MastParam = Annotated[float, BeforeValidator(_null_to_default_mast), Query(
    ge=0.0, le=20.0, description="Panel or antenna height above the ground, metres, 0..20. Absent, empty or "
    "null = 0 m (the ground). Terrain masks exist for 0, 2, 5 and 10 m; the nearest is used (see mast_used_m)")]
COMMS_QUERY = Query(0.5, ge=0.0, le=1.0, description="Share of the Earth's disc that must be above the "
                    "horizon to count as direct-to-Earth comms")


def parse_instant_ms(store: DataStore, t: datetime) -> float:
    """Request instant to Unix ms, 400 when the ephemeris tables do not cover it."""
    t_ms = services.to_ms(t)
    if not store.ephemeris.covers(t_ms):
        spans = ", ".join(f"{services.iso_utc(a)} .. {services.iso_utc(b)}" for a, b in store.ephemeris.coverage())
        raise HTTPException(status_code=400, detail=f"t={services.iso_utc(t_ms)} is outside the ephemeris tables "
                                                    f"({spans})")
    return t_ms


MAX_SAMPLES = 20_000   # docs/endpoints.md, "Series over a window": cap the samples, 422 above it
DEFAULT_STEP_MIN = 10.0

START_QUERY = Query(..., description="Window start, ISO 8601 (e.g. 2026-11-20T12:00:00Z). No offset = UTC",
                    examples=["2026-11-20T12:00:00Z"])
DURATION_QUERY = Query(..., gt=0.0, description="Window length, hours (mission duration). Required: a mission "
                       "input with no neutral default", examples=[336])
STEP_QUERY = Query(DEFAULT_STEP_MIN, ge=1.0, le=1440.0, description="Sample spacing, minutes, 1..1440. Range "
                   f"edges are refined to ~1 s whatever the step. At most {MAX_SAMPLES} samples per request")


def parse_window_ms(store: DataStore, start: datetime, duration_h: float, step_min: float) -> float:
    """Validate the window: sample cap (422) and ephemeris coverage of both ends (400)."""
    samples = int(np.floor(duration_h * 3_600_000.0 / (step_min * 60_000.0))) + 1   # as engine.time_grid
    if samples > MAX_SAMPLES:
        raise HTTPException(status_code=422, detail=f"{samples} samples requested (duration_h={duration_h:g}, "
                            f"step_min={step_min:g}); the limit is {MAX_SAMPLES}: raise step_min or shorten the window")
    start_ms = parse_instant_ms(store, start)
    end_ms = start_ms + duration_h * 3_600_000.0
    if not any(a <= start_ms and end_ms <= b for a, b in store.ephemeris.coverage()):
        spans = ", ".join(f"{services.iso_utc(a)} .. {services.iso_utc(b)}" for a, b in store.ephemeris.coverage())
        raise HTTPException(status_code=400, detail=f"window {services.iso_utc(start_ms)} .. {services.iso_utc(end_ms)} "
                                                    f"leaves the ephemeris tables ({spans})")
    return start_ms


# ---------------------------------------------------------------------------- manual coordinates

MAX_ABS_LAT = 89.9999   # team spec: at the exact poles "north", and so the azimuth, is undefined


def _normalise_lon(v: float) -> float:
    """0..360 to -180..180 (east-positive). 180 becomes -180: the same meridian."""
    return round(v - 360.0, 10) if v >= 180.0 else v


LatParam = Annotated[float, Query(ge=-MAX_ABS_LAT, le=MAX_ABS_LAT, description="Planetocentric latitude, degrees, "
                     f"Moon Mean-Earth frame, -{MAX_ABS_LAT}..{MAX_ABS_LAT} (the exact poles have no azimuth "
                     "reference)", examples=[-84.7906])]
LonParam = Annotated[float, Query(ge=-180.0, le=360.0, description="East-positive longitude, degrees. -180..180 or "
                     "0..360, normalised to -180..180 (330 = -30)", examples=[29.1957]), AfterValidator(_normalise_lon)]
