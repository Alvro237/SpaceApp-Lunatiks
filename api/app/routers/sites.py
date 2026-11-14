"""Site catalogue endpoints. REFERENCE SLICE: copy this file's shape for a new endpoint group.

A router only does three things: validate the request (Pydantic), call the data layer and the
logic, and shape the response model. No physics and no file access here.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from ..db.sites import Site
from ..db.store import DataStore, get_store
from ..schemas.sites import SiteDetail, SiteList, SiteSummary, SourceRef, TerrainSummary

router = APIRouter(prefix="/sites", tags=["sites"])


def _summary(s: Site) -> SiteSummary:
    return SiteSummary(id=s.id, name=s.name, group=s.group, kind=s.kind, lat=s.lat, lon=s.lon, region=s.region,
                       landing_utc=s.landing_utc, terrain_available=s.has_terrain)


def _detail(s: Site, store: DataStore) -> SiteDetail:
    t = s.terrain
    return SiteDetail(
        **_summary(s).model_dump(), source=SourceRef(**s.source),
        terrain=TerrainSummary(available=s.has_terrain, reason=t.get("reason"),
                               ground_height_m=t.get("groundHeightM"), slope_deg=t.get("slopeDeg"),
                               horizon_2m_max_deg=t.get("horizon2mMaxDeg"), horizon_2m_mean_deg=t.get("horizon2mMeanDeg")),
        mast_heights_m=store.horizons.masts_m if s.has_terrain else [])


@router.get("", response_model=SiteList, summary="List the catalogue of landing sites")
def list_sites(group: str | None = Query(None, description="Keep only this group, exact match"),
               terrain_only: bool = Query(False, description="Keep only sites with a LOLA terrain horizon"),
               store: DataStore = Depends(get_store)) -> SiteList:
    sites = [s for s in store.sites.all()
             if (group is None or s.group == group) and (not terrain_only or s.has_terrain)]
    return SiteList(count=len(sites), groups=store.sites.groups(), sites=[_summary(s) for s in sites])


@router.get("/{site_id}", response_model=SiteDetail, summary="One site with its source and terrain summary")
def get_site(site_id: str, store: DataStore = Depends(get_store)) -> SiteDetail:
    site = store.sites.get(site_id)
    if site is None:
        raise HTTPException(status_code=404, detail=f"Unknown site id {site_id!r}; see GET /api/v1/sites")
    return _detail(site, store)
