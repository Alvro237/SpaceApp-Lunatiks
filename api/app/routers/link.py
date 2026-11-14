"""Radio link (AERO-2): POST /api/v1/link (level 1, geometric contact) and GET /api/v1/link/stations.

Validate, resolve the antennas, call app/logic, shape the response. No formulas here."""
from __future__ import annotations

import numpy as np
from fastapi import APIRouter, Depends, HTTPException

from .. import services
from ..db.stations import Station, StationRepository
from ..db.store import DataStore, get_store
from ..logic.ephemeris import OutOfCoverage
from ..logic.engine import AnalysisParams
from ..logic.link import StationSpec, combine_contact, station_view
from ..logic.sun import longest_run_h
from ..schemas.link import (LinkNow, LinkRequest, LinkResponse, SkippedStation, StationCatalogue, StationInfo,
                            StationResult)
from .common import ranges, resolve_model, window_fields, window_ms

router = APIRouter(prefix="/link", tags=["link"])

DIRECTION_KIND = {"downlink": "receive", "uplink_low_power": "transmit_low", "uplink_high_power": "transmit_high"}

ASSUMPTIONS = [
    "Contact means the lunar site sees the Earth (at least comms_min_fraction of its disc above the local horizon) "
    "AND at least one selected antenna sees the Moon above its elevation limit. Geometry only: a visible Moon does "
    "not mean the antenna is scheduled, and there is no link budget (level 2 is not available yet).",
    "The direction from each antenna is to the Moon's centre; the lunar site's position on the Moon (up to 0.26 deg "
    "away) is ignored.",
    "Elevation limits: DSN and JAXA antennas use published per-azimuth masks; ESA publishes none and its antennas use "
    "a 6 deg estimate (see estimated_limits). Your own antennas use the single limit you give.",
    "Durations are counted at the sampling step; use a smaller step_min for finer edges.",
]


def _repo(store: DataStore) -> StationRepository:
    if store.stations is None:
        raise HTTPException(status_code=503, detail="The ground-station dataset is not loaded (data/ground_stations.json)")
    return store.stations


def _limit_range(limit) -> tuple[float, float]:
    arr = np.atleast_1d(np.asarray(limit, dtype=float))
    return float(arr.min()), float(arr.max())


@router.get("/stations", response_model=StationCatalogue, summary="Antenna networks and stations available for the radio link")
def stations(store: DataStore = Depends(get_store)) -> StationCatalogue:
    repo = _repo(store)
    out = []
    for s in repo.all():
        rcv, step = s.limit("receive")
        lo, hi = _limit_range(rcv)
        out.append(StationInfo(
            id=s.id, name=s.name, network=s.network, agency=s.agency, site=s.site, country=s.country,
            lat_deg=s.lat_deg, lon_deg=s.lon_deg, height_m=s.height_m, dish=s.dish, bands=s.bands,
            limit_source=s.elevation_limits["source"], limit_source_note=s.elevation_limits["source_note"],
            has_azimuth_mask=step is not None, receive_limit_deg={"min": lo, "max": hi},
            has_transmit_limits=s.limit("transmit_low")[0] is not None))
    return StationCatalogue(networks=repo.networks(), stations=out)


@router.post("", response_model=LinkResponse, summary="Radio link over a mission window: geometric contact with Earth antennas")
def link(req: LinkRequest, store: DataStore = Depends(get_store)) -> LinkResponse:
    repo = _repo(store)
    model = resolve_model(req, store)
    start_ms = window_ms(req, store)

    kind = DIRECTION_KIND[req.direction]
    try:
        catalogue: list[Station] = repo.in_networks(req.networks)
    except KeyError as exc:
        raise HTTPException(status_code=422, detail=(
            f"Unknown network {exc.args[0]!r}; available: {sorted(repo.networks())}")) from None
    clash = sorted({c.id for c in req.custom_stations} & {s.id for s in repo.all()})
    if clash:
        raise HTTPException(status_code=422, detail=f"Custom station ids clash with catalogue ids: {clash}")

    specs: list[StationSpec] = []
    meta: dict[str, dict] = {}
    skipped: list[SkippedStation] = []
    for s in catalogue:
        limit, step = s.limit(kind)
        if limit is None:
            skipped.append(SkippedStation(id=s.id, reason=f"no {req.direction} elevation limit is published for this antenna"))
            continue
        specs.append(StationSpec(s.id, s.lat_deg, s.lon_deg, s.height_m, limit, step))
        meta[s.id] = dict(name=s.name, network=s.network, source=s.elevation_limits["source"])
    for c in req.custom_stations:
        specs.append(StationSpec(c.id, c.lat_deg, c.lon_deg, c.height_m, c.min_elevation_deg, None))
        meta[c.id] = dict(name=c.name or c.id, network="custom", source="user")
    if not specs:
        raise HTTPException(status_code=422, detail=(
            f"No selected antenna has a {req.direction} elevation limit; choose another direction or add a custom station"))

    params = AnalysisParams(comms_min_fraction=req.comms_min_fraction)
    series = services.evaluate_window(store, model, start_ms, req.duration_h, req.step_min, params)
    t = series.t_ms
    try:
        moon = repo.moon.positions(t)
    except OutOfCoverage:
        raise HTTPException(status_code=400, detail=(
            "The window is outside the Moon table used for the ground antennas (2025-2035); "
            "see GET /api/v1/meta/datasets")) from None

    views = {sp.id: station_view(sp, moon) for sp in specs}
    spec_by_id = {sp.id: sp for sp in specs}
    c = combine_contact(series.comms(params), {k: v.sees_moon for k, v in views.items()})
    step_h = series.step_ms / 3_600_000.0

    results = []
    for sp in specs:
        v, m = views[sp.id], meta[sp.id]
        lo, hi = _limit_range(sp.limit)
        in_contact = c.contact_by_station[sp.id]
        lat, lon, h = (sp.lat_deg, sp.lon_deg, sp.height_m)
        results.append(StationResult(
            id=sp.id, name=m["name"], network=m["network"], lat_deg=lat, lon_deg=lon, height_m=h,
            limit_source=m["source"], limit_min_deg=lo, limit_max_deg=hi,
            moon_visible_fraction=float(v.sees_moon.mean()), moon_visible_hours=float(v.sees_moon.sum()) * step_h,
            moon_visible_ranges=ranges(t, v.sees_moon), contact_fraction=float(in_contact.mean()),
            contact_hours=float(in_contact.sum()) * step_h, now_moon_azimuth_deg=float(v.az_deg[0]),
            now_moon_elevation_deg=float(v.el_deg[0]), now_limit_deg=float(v.limit_deg[0])))

    estimated = [sid for sid, m in meta.items() if m["source"] == "owner_estimate"]
    assumptions = list(ASSUMPTIONS)
    if estimated:
        assumptions.append("The result depends on an estimated elevation limit (not an operator figure) for: "
                           + ", ".join(estimated) + ".")
    now_in = [sid for sid in spec_by_id if bool(c.contact_by_station[sid][0])]
    return LinkResponse(
        **window_fields(req, model, store, start_ms, t, assumptions), level=1, direction=req.direction,
        comms_min_fraction=req.comms_min_fraction, networks_used=sorted({m["network"] for m in meta.values()}),
        now=LinkNow(earth_visible=bool(c.earth_visible[0]), any_station_sees_moon=bool(c.any_station[0]),
                    contact=bool(c.contact[0]), stations_in_contact=now_in),
        contact=c.contact.tolist(), contact_window_fraction=float(c.contact.mean()),
        contact_hours=float(c.contact.sum()) * step_h, contact_ranges=ranges(t, c.contact),
        longest_contact_h=longest_run_h(c.contact, t, True), longest_blackout_h=longest_run_h(c.contact, t, False),
        earth_visible_fraction=float(c.earth_visible.mean()), earth_visible_ranges=ranges(t, c.earth_visible),
        any_station_fraction=float(c.any_station.mean()), any_station_ranges=ranges(t, c.any_station),
        stations=results, skipped_stations=skipped, estimated_limits=estimated)
