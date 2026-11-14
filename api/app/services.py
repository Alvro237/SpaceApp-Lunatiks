"""Glue between the datasets (app/db) and the computation (app/logic) that several endpoints share.

Routers stay thin: parse the request, call a function here or in app/logic, shape the response.
If two routers need the same combination of data and logic, it belongs in this module.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import numpy as np

from .db.sites import Site
from .db.store import DataStore
from .logic.constraints import ConstraintContext
from .logic.horizon import HorizonProfile
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


def model_for_point(store: DataStore, lat: float, lon: float, mast_m: float) -> SiteModel:
    """Manual coordinates: ground height from the LOLA grid when covered, smooth-sphere horizon.
    Say so in the response (``horizon.kind``): a smooth sphere is an estimate, not a bound. Real terrain shortens
    light and comms in craters and lengthens them on peaks, where the skyline drops below the horizontal."""
    ground = store.grids.sample("lola_elevation_60s", lat, lon) or 0.0
    return make_model(lat, lon, ground, store.horizons.for_point(mast_m), mast_m)


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
                       params: AnalysisParams = DEFAULT_PARAMS) -> ConstraintContext:
    """Everything the hard filters need for one candidate and one mission window."""
    series = evaluate_window(store, model, start_ms, duration_h, step_min, params)
    return ConstraintContext(site_id=site.id if site else None, lat=model.lat, lon=model.lon, start_ms=start_ms,
                             duration_h=duration_h, series=series, metrics=compute_metrics(series, params),
                             params=params, horizon_kind=model.horizon.kind,
                             lookups=point_lookups(store, model.lat, model.lon, site))


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
    return "reference_sphere" if store.grids.sample("lola_elevation_60s", lat, lon) is None else "lola_grid"


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
    s = evaluate_window(store, model_for_point(store, lat, lon, mast_m), to_ms(LONG_TERM_START), LONG_TERM_HOURS,
                        LONG_TERM_STEP_MIN)
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
