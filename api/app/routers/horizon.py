"""Horizon profile of a catalogue site (SW-1).

    GET /api/v1/sites/{site_id}/horizon?mast_m=2&include_zone=true

The 360-degree skyline from the LOLA terrain masks the pipeline precomputed (data/horizons.i16), and optionally
the masks of the neighbours on rings around the site (data/zones.i16). Shape of routers/sites.py: validate, call
services, shape the response. Output format: docs/sw1-output-format.md.
"""
from __future__ import annotations

import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Query

from .. import services
from ..db.store import DataStore, get_store
from ..logic.horizon import HorizonProfile
from ..schemas.horizon import HorizonPlane, HorizonResponse, ProfileSummary, Zone, ZonePoint
from .params import DEFAULT_MAST_M, MastParam

router = APIRouter(prefix="/sites", tags=["horizon"])

ZONE_QUERY = Query(False, description="Also return the neighbours' masks (site centre plus rings at 500 m and "
                   "1.5 km, 8 bearings). They exist for the 2 m mast only")


def _values(p: HorizonProfile) -> np.ndarray:
    return p.values + 0.0          # turns -0.0 (smooth sphere at 0 m) into 0.0 on the wire


def _nullable(a: np.ndarray, scale: float = 1.0) -> list[float | None]:
    """NaN to None (JSON null), optionally scaled (metres to km)."""
    return [None if not np.isfinite(x) else float(x) * scale for x in a]


def planes_fields(planes: services.HorizonPlanes | None) -> dict:
    """The ``planes`` and ``skyline_distance_km`` fields of a horizon response (nulls when no grid covers the point)."""
    if planes is None:
        return {"planes": None, "skyline_distance_km": None}
    return {"planes": [HorizonPlane(distance_km=_nullable(planes.distance_m[:, j], 1e-3),
                                    elevation_deg=_nullable(planes.elevation_deg[:, j]))
                       for j in range(planes.elevation_deg.shape[1])],
            "skyline_distance_km": _nullable(planes.skyline_distance_m, 1e-3)}


def _summary(p: HorizonProfile) -> dict:
    v = _values(p)
    i_max, i_min = int(np.argmax(v)), int(np.argmin(v))
    return ProfileSummary(max_deg=float(v[i_max]), max_az_deg=i_max * p.az_step_deg, min_deg=float(v[i_min]),
                          min_az_deg=i_min * p.az_step_deg, mean_deg=float(v.mean())).model_dump()


@router.get("/{site_id}/horizon", response_model=HorizonResponse,
            summary="360-degree skyline of a site (LOLA terrain mask), optionally with its neighbours")
def site_horizon(site_id: str, mast_m: MastParam = DEFAULT_MAST_M, include_zone: bool = ZONE_QUERY,
                 store: DataStore = Depends(get_store)) -> HorizonResponse:
    site = store.sites.get(site_id)
    if site is None:
        raise HTTPException(status_code=404, detail=f"Unknown site id {site_id!r}; see GET /api/v1/sites")
    h = services.horizon_view(store, site, mast_m, include_zone)
    p = h.profile
    zone = None
    if h.zone:
        zone = Zone(mast_m=2.0, points=[
            ZonePoint(bearing_deg=float(pt["bearingDeg"]), distance_m=float(pt["distanceM"]), lat=float(pt["lat"]),
                      lon=float(pt["lon"]), ground_m=float(pt["groundHeightM"]), elevation_deg=_values(zp).tolist(),
                      **_summary(zp))
            for pt, zp in h.zone])
    return HorizonResponse(
        site_id=site.id, lat=site.lat, lon=site.lon, ground_m=site.ground_m, mast_m=mast_m,
        mast_used_m=h.mast_used_m, masts_available_m=store.horizons.masts_m if site.has_terrain else [],
        horizon_kind=p.kind, az_step_deg=p.az_step_deg, az=(np.arange(p.values.size) * p.az_step_deg).tolist(),
        elevation_deg=_values(p).tolist(), zone_available=h.zone_available, zone=zone,
        **planes_fields(services.point_horizon_planes(store, site.lat, site.lon, h.mast_used_m)), **_summary(p))
