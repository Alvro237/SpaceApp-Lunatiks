"""Glue between the datasets (app/db) and the computation (app/logic) that several endpoints share.

Routers stay thin: parse the request, call a function here or in app/logic, shape the response.
If two routers need the same combination of data and logic, it belongs in this module.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from collections import OrderedDict
from typing import Literal

import numpy as np

from .db.sites import Site
from .db.store import DataStore
from .logic.constraints import ConstraintContext
from .logic.link import Contact, StationSpec, StationView, combine_contact, station_view
from .logic.horizon import RAY_AZIMUTHS, RAY_MAX_RANGE_M, HorizonProfile, destination, horizon_from_heights, ray_distances
from .logic.engine import (DEFAULT_PARAMS, AnalysisParams, Metrics, RefinedRange, Series, SiteModel, Transition,
                           compute_metrics, evaluate, make_model, next_transition, refined_ranges, time_grid)


def to_ms(utc: datetime) -> float:
    """Timezone-aware datetime to Unix milliseconds (naive datetimes are taken as UTC)."""
    if utc.tzinfo is None:
        utc = utc.replace(tzinfo=timezone.utc)
    return utc.timestamp() * 1000.0


EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


def from_ms(t_ms: float) -> datetime:
    # not datetime.fromtimestamp: on Windows it fails for times before 1970 (the Apollo tables)
    return EPOCH + timedelta(milliseconds=float(t_ms))


def iso_utc(t_ms: float) -> str:
    """Unix milliseconds to ISO 8601 UTC with a trailing Z, the API's time format."""
    return from_ms(t_ms).strftime("%Y-%m-%dT%H:%M:%SZ")


def model_for_site(store: DataStore, site: Site, mast_m: float) -> SiteModel:
    """Catalogue site: LOLA terrain horizon when the pipeline computed one, smooth sphere otherwise."""
    return make_model(site.lat, site.lon, site.ground_m, store.horizons.for_site(site, mast_m), mast_m)


def model_for_point(store: DataStore, lat: float, lon: float, mast_m: float,
                    horizon: Literal["terrain", "smooth_sphere"] = "smooth_sphere") -> SiteModel:
    """Manual coordinates. ``horizon="terrain"``: skyline ray-traced over the LOLA elevation grids wherever they
    cover the point (south of about 60 S; point_horizon), else the smooth sphere. ``"smooth_sphere"`` (default, the
    contract the endpoints were built and validated on): ground height from the LOLA grid, smooth-sphere skyline.
    Responses say which one they used (``horizon_kind``)."""
    ph = point_horizon(store, lat, lon, mast_m) if horizon == "terrain" else None
    if ph is not None:
        return make_model(lat, lon, ph.ground_m, ph.profile, mast_m)
    ground = store.grids.sample("lola_elevation_60s", lat, lon) or 0.0
    return make_model(lat, lon, ground, store.horizons.for_point(mast_m), mast_m)


# ---------------------------------------------------------------------------- ray-traced horizon of a point

# Finest first: each ray sample reads the finest grid that has data there.
POINT_DEM_GRIDS = ("lola_elevation_80s", "lola_elevation_60s")


@dataclass(frozen=True)
class PointHorizon:
    profile: HorizonProfile
    ground_m: float
    #: cell size of the finest grid at the point (the near field decides most of the error), metres
    near_cell_m: float
    near_grid: str
    #: shortest distance over all azimuths up to which terrain data exists, metres (max = RAY_MAX_RANGE_M)
    terrain_range_m: float


def point_dem_heights(store: DataStore, lat_rad: np.ndarray, lon_rad: np.ndarray) -> np.ndarray:
    """Terrain height (m above the 1737.4 km sphere) from the finest LOLA grid covering each sample; NaN where none."""
    lat, lon = np.degrees(lat_rad), np.degrees(lon_rad)
    out = np.full(np.shape(lat), np.nan)
    for grid_id in POINT_DEM_GRIDS:
        miss = np.isnan(out)
        if not miss.any():
            break
        out[miss] = store.grids.bilinear_many(grid_id, lat[miss], lon[miss])
    return out


_RAYS_CACHE: OrderedDict = OrderedDict()
_RAYS_CACHE_SIZE = 8


def _point_rays(store: DataStore, lat: float, lon: float):
    """Terrain heights along all the rays of a point (shared by every mast height), or None outside the grids.
    The last few points are kept in memory (least recently used dropped), about 2 MB each."""
    key = (id(store), lat, lon)
    if key in _RAYS_CACHE:
        _RAYS_CACHE.move_to_end(key)
        return _RAYS_CACHE[key]
    rays = _trace_point_rays(store, lat, lon)
    _RAYS_CACHE[key] = rays
    if len(_RAYS_CACHE) > _RAYS_CACHE_SIZE:
        _RAYS_CACHE.popitem(last=False)
    return rays


def _trace_point_rays(store: DataStore, lat: float, lon: float):
    for grid_id in POINT_DEM_GRIDS:
        ground = store.grids.bilinear_many(grid_id, np.array([lat]), np.array([lon]))[0]
        if not np.isnan(ground):
            cell = float(store.grids.meta(grid_id)["pixelM"])
            dist = ray_distances(cell, RAY_MAX_RANGE_M)
            az = np.radians(np.arange(RAY_AZIMUTHS) * (360.0 / RAY_AZIMUTHS))[:, None]
            la, lo = destination(np.radians(lat), np.radians(lon), az, dist[None, :])
            heights = point_dem_heights(store, la, lo).astype(np.float32)
            return float(ground), grid_id, cell, dist, heights
    return None


def point_horizon(store: DataStore, lat: float, lon: float, mast_m: float) -> PointHorizon | None:
    """Ray-traced terrain horizon of manual coordinates (logic.horizon), cached per point; None outside the grids."""
    rays = _point_rays(store, round(float(lat), 6), round(float(lon), 6))
    if rays is None:
        return None
    ground, grid_id, cell, dist, heights = rays
    values, last = horizon_from_heights(dist, heights.astype(np.float64), ground, mast_m)
    return PointHorizon(HorizonProfile(values, kind="terrain"), ground, cell, grid_id, float(last.min()))


def point_lookups(store: DataStore, lat: float, lon: float, site: Site | None = None) -> dict:
    """Dataset values at a point for the hard filters. None = that dataset has no value there."""
    g = store.grids
    slope, slope_source = None, None
    if site is not None and site.slope_deg is not None:
        slope, slope_source = float(site.slope_deg), "LOLA finest DEM at the site, 100 m baseline"
    else:
        for grid_id in ("lola_slope_80s", "lola_slope_60s"):   # finest grid that covers the point
            slope = g.sample(grid_id, lat, lon)
            if slope is not None:
                m = g.meta(grid_id)
                slope_source = f"LOLA slope grid {grid_id}, {m['pixelM']:.0f} m cells from {m['sourcePixelM']:.0f} m pixels"
                break
    return {
        "slope_deg": slope,
        "slope_source": slope_source,
        "sun_illumination_avg": g.sample("sun_illumination_65s", lat, lon),
        "earth_visibility_avg": g.sample("earth_visibility_65s", lat, lon),
        "permanent_shadow_fraction": g.sample("permanent_shadow_65s", lat, lon),
        "sky_visibility_sr": g.sample("sky_visibility_65s", lat, lon),
        "crater_density_per_km2": store.craters.density_per_km2(lat, lon) if store.craters.available else None,
        "gcr_free_space_mgy_si_per_day": store.radiation.gcr_free_space_mean() if store.radiation else None,
    }


def evaluate_window(store: DataStore, model: SiteModel, start_ms: float, duration_h: float,
                    step_min: float = 60.0, params: AnalysisParams = DEFAULT_PARAMS) -> Series:
    return evaluate(store.ephemeris, model, time_grid(start_ms, duration_h, step_min), params)


def constraint_context(store: DataStore, model: SiteModel, start_ms: float, duration_h: float,
                       site: Site | None = None, step_min: float = 60.0,
                       params: AnalysisParams = DEFAULT_PARAMS, link_networks: list[str] | None = None,
                       link_direction: str = "downlink") -> ConstraintContext:
    """Everything the hard filters need for one candidate and one mission window.

    ``link_networks`` (AERO-2): when given, the context also carries the radio-link contact series (the lunar site sees
    the Earth AND an antenna of those networks sees the Moon) and the communication filters use it instead of the
    Earth's line of sight alone. Left as None the behaviour is unchanged."""
    series = evaluate_window(store, model, start_ms, duration_h, step_min, params)
    contact = None
    if link_networks is not None:
        contact = link_contact(store, series, params, link_stations(store, link_networks, link_direction)).contact
    return ConstraintContext(site_id=site.id if site else None, lat=model.lat, lon=model.lon, start_ms=start_ms,
                             duration_h=duration_h, series=series, metrics=compute_metrics(series, params),
                             params=params, horizon_kind=model.horizon.kind,
                             lookups=point_lookups(store, model.lat, model.lon, site), contact=contact)


# ---------------------------------------------------------------------------- SW-1: state at one instant

TRANSITION_SEARCH_DAYS = 45.0   # engine.next_transition default; reported in the response


@dataclass(frozen=True)
class InstantState:
    """One-sample series plus the next sunset/sunrise and Earthset/Earthrise from that instant."""
    series: Series
    sun_horizon_el: float
    earth_horizon_el: float
    next_sun: Transition | None
    next_earth: Transition | None


def state_at(store: DataStore, model: SiteModel, t_ms: float,
             params: AnalysisParams = DEFAULT_PARAMS) -> InstantState:
    """Sun and Earth over the model's horizon at ``t_ms``. Raises ``OutOfCoverage`` outside the tables."""
    series = evaluate(store.ephemeris, model, t_ms, params)
    h = model.horizon
    return InstantState(
        series=series,
        sun_horizon_el=float(h.at(series.sun_az)[0]),
        earth_horizon_el=float(h.at(series.earth_az)[0]),
        next_sun=next_transition(store.ephemeris, model, t_ms, "sun", params, TRANSITION_SEARCH_DAYS),
        next_earth=next_transition(store.ephemeris, model, t_ms, "earth", params, TRANSITION_SEARCH_DAYS),
    )


# ---------------------------------------------------------------------------- SW-1: series over a window

@dataclass(frozen=True)
class WindowSeries:
    """Sampled series, its metrics, horizon at each body's azimuth and the refined ranges."""
    series: Series
    metrics: Metrics
    sun_horizon_el: np.ndarray
    earth_horizon_el: np.ndarray
    sunlit: list[RefinedRange]
    comms: list[RefinedRange]
    eclipse: list[RefinedRange]


def series_window(store: DataStore, model: SiteModel, start_ms: float, duration_h: float, step_min: float,
                  params: AnalysisParams = DEFAULT_PARAMS) -> WindowSeries:
    """Everything the series endpoints return. Raises ``OutOfCoverage`` outside the tables."""
    s = evaluate_window(store, model, start_ms, duration_h, step_min, params)
    eph = store.ephemeris
    return WindowSeries(series=s, metrics=compute_metrics(s, params),
                        sun_horizon_el=model.horizon.at(s.sun_az), earth_horizon_el=model.horizon.at(s.earth_az),
                        sunlit=refined_ranges(eph, model, s, "sun", params),
                        comms=refined_ranges(eph, model, s, "earth", params),
                        eclipse=refined_ranges(eph, model, s, "eclipse", params))


# ---------------------------------------------------------------------------- SW-1: horizon profile

@dataclass(frozen=True)
class HorizonView:
    profile: HorizonProfile
    mast_used_m: float
    zone: list[tuple[dict, HorizonProfile]]   # (point, mask) pairs; empty when not requested or not available
    zone_available: bool


def horizon_view(store: DataStore, site: Site, mast_m: float, include_zone: bool) -> HorizonView:
    """The site's skyline at the nearest stored mast (smooth sphere when it has no terrain), and optionally the
    neighbours' 2 m masks."""
    zone = store.horizons.zone(site)
    return HorizonView(profile=store.horizons.for_site(site, mast_m),
                       mast_used_m=store.horizons.nearest_mast(mast_m) if site.has_terrain else mast_m,
                       zone=zone if include_zone else [], zone_available=bool(zone))


# ---------------------------------------------------------------------------- SW-1: where the ground height comes from

def site_ground_source(site: Site) -> str:
    return "lola_site" if site.has_terrain else "reference_sphere"


def point_ground_source(store: DataStore, lat: float, lon: float) -> str:
    """Same look-up as ``model_for_point``: the LOLA grid when it covers the point, else the reference sphere."""
    return "reference_sphere" if np.isnan(point_dem_heights(store, np.radians([lat]), np.radians([lon]))[0]) else "lola_grid"


# ---------------------------------------------------------------------------- SW-1: terrain reference for a point

LONG_TERM_START = datetime(2025, 1, 1, tzinfo=timezone.utc)
LONG_TERM_HOURS = 24 * 365 * 11 - 48        # to 2035-12-30, inside the 2025-2035 tables
LONG_TERM_STEP_MIN = 360.0                  # every 6 h: 16 053 samples, a few milliseconds
PGDA_PRODUCT = "NASA PGDA product 69 (Mazarico et al.), 18.6-year averages over LOLA terrain, 960 m cells"


@dataclass(frozen=True)
class LongTermValues:
    sun_mean_visible_fraction: float
    earth_any_visible_fraction: float


def smooth_sphere_long_term(store: DataStore, lat: float, lon: float, mast_m: float) -> LongTermValues:
    """Long-term light and Earth visibility at a point over the smooth sphere, with PGDA's definitions: mean
    visible solar-disc fraction, share of time with any of the Earth's disc visible."""
    s = evaluate_window(store, model_for_point(store, lat, lon, mast_m, horizon="smooth_sphere"), to_ms(LONG_TERM_START),
                        LONG_TERM_HOURS, LONG_TERM_STEP_MIN)
    return LongTermValues(float(s.sun_frac.mean()), float((s.earth_frac > 0.0).mean()))


def pgda_long_term(store: DataStore, lat: float, lon: float) -> LongTermValues | None:
    """PGDA product 69 at the point (terrain-aware); None outside its maps (north of 65 S)."""
    sun = store.grids.sample("sun_illumination_65s", lat, lon)
    earth = store.grids.sample("earth_visibility_65s", lat, lon)
    if sun is None or earth is None:
        return None
    return LongTermValues(round(sun, 4), round(earth, 4))      # the grids store 0.0001 steps


def period_label() -> str:
    return f"{iso_utc(to_ms(LONG_TERM_START))} .. {iso_utc(to_ms(LONG_TERM_START) + LONG_TERM_HOURS * 3_600_000.0)}"


# ---------------------------------------------------------------------------- AERO-2: radio link

LINK_DIRECTION_KIND = {"downlink": "receive", "uplink_low_power": "transmit_low", "uplink_high_power": "transmit_high"}


@dataclass(frozen=True)
class LinkStations:
    """The antennas of one link request, reduced to what the geometry needs."""
    specs: list[StationSpec]
    meta: dict[str, dict]                # antenna id -> name, network, source ("cited", "owner_estimate" or "user")
    skipped: list[tuple[str, str]]       # (antenna id, reason): catalogue antennas with no limit for this direction


def link_stations(store: DataStore, networks, direction: str = "downlink", custom=()) -> LinkStations:
    """Resolve the selected networks and the user's own antennas.

    ``custom`` items need ``id``, ``name``, ``lat_deg``, ``lon_deg``, ``height_m`` and ``min_elevation_deg``.
    Raises LookupError when the dataset is not loaded, KeyError for an unknown network id, ValueError for an id that
    clashes with a catalogue id or when no antenna is usable in this direction.
    """
    repo = store.stations
    if repo is None:
        raise LookupError("the ground-station dataset is not loaded (data/ground_stations.json)")
    catalogue = repo.in_networks(list(networks))
    clash = sorted({c.id for c in custom} & {s.id for s in repo.all()})
    if clash:
        raise ValueError(f"custom station ids clash with catalogue ids: {clash}")
    kind = LINK_DIRECTION_KIND[direction]
    specs: list[StationSpec] = []
    meta: dict[str, dict] = {}
    skipped: list[tuple[str, str]] = []
    for s in catalogue:
        limit, step = s.limit(kind)
        if limit is None:
            skipped.append((s.id, f"no {direction} elevation limit is published for this antenna"))
            continue
        specs.append(StationSpec(s.id, s.lat_deg, s.lon_deg, s.height_m, limit, step))
        meta[s.id] = dict(name=s.name, network=s.network, source=s.elevation_limits["source"])
    for c in custom:
        specs.append(StationSpec(c.id, c.lat_deg, c.lon_deg, c.height_m, c.min_elevation_deg, None))
        meta[c.id] = dict(name=c.name or c.id, network="custom", source="user")
    if not specs:
        raise ValueError(f"no selected antenna has a {direction} elevation limit; choose another direction or add a "
                         "custom station")
    return LinkStations(specs=specs, meta=meta, skipped=skipped)


def link_views(store: DataStore, series: Series, stations: LinkStations) -> dict[str, StationView]:
    """The Moon from each antenna at the samples of ``series``. Raises OutOfCoverage outside the Moon table (2025-2035)."""
    moon = store.stations.moon.positions(series.t_ms)
    return {sp.id: station_view(sp, moon) for sp in stations.specs}


def link_contact(store: DataStore, series: Series, params: AnalysisParams, stations: LinkStations) -> Contact:
    """Level-1 contact: the lunar site sees the Earth AND some antenna sees the Moon (see app/logic/link.py)."""
    views = link_views(store, series, stations)
    return combine_contact(series.comms(params), {k: v.sees_moon for k, v in views.items()})


#: Reference receiver class for G/T estimates: the DSN 34 m beam-waveguide antennas, the most numerous deep-space dish
#: with published values in every lunar band.
GT_REFERENCE_DISH = "34 m BWG"
GT_REFERENCE_DIAMETER_M = 34.0


def gt_reference(store: DataStore, band: str) -> float | None:
    """Mean published G/T of the DSN 34 m BWG antennas in a band, dB/K (None when none is published)."""
    vals = [s.gt(band)[0] for s in store.stations.all()
            if s.network == "dsn" and s.dish == GT_REFERENCE_DISH and s.gt(band)[1] == "cited"]
    return float(np.mean(vals)) if vals else None


def link_receive_gt(store: DataStore, stations: LinkStations, band: str, custom=()) -> dict[str, tuple[float | None, str]]:
    """Downlink G/T per antenna for a band: antenna id -> (dB/K or None, basis).

    basis: "cited" or "spec" (published), "estimated" (the antenna receives in the band but publishes no G/T, or a
    custom antenna gave only its diameter: scaled from the DSN 34 m BWG mean by 20 log10(D / 34 m)), "user" (given in
    the request), "no_receiver" (the antenna has no receiver in this band) or "unknown" (a custom antenna with
    neither a G/T nor a diameter)."""
    from .logic.link import scale_gt_db_per_k

    ref = gt_reference(store, band)
    by_custom = {c.id: c for c in custom}
    out: dict[str, tuple[float | None, str]] = {}
    for sp in stations.specs:
        c = by_custom.get(sp.id)
        if c is not None:
            if getattr(c, "gt_db_per_k", None) is not None:
                out[sp.id] = (float(c.gt_db_per_k), "user")
            elif getattr(c, "diameter_m", None) and ref is not None:
                out[sp.id] = (round(scale_gt_db_per_k(ref, GT_REFERENCE_DIAMETER_M, c.diameter_m), 2), "estimated")
            else:
                out[sp.id] = (None, "unknown")
            continue
        s = store.stations.get(sp.id)
        value, basis = s.gt(band)
        if basis == "unpublished":
            value = None if ref is None else round(scale_gt_db_per_k(ref, GT_REFERENCE_DIAMETER_M, s.diameter_m), 2)
            basis = "estimated" if value is not None else "unknown"
        out[sp.id] = (value, basis)
    return out
