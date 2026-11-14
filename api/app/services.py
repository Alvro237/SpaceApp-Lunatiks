"""Glue between the datasets (app/db) and the computation (app/logic) that several endpoints share.

Routers stay thin: parse the request, call a function here or in app/logic, shape the response.
If two routers need the same combination of data and logic, it belongs in this module.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from .db.sites import Site
from .db.store import DataStore
from .logic.constraints import ConstraintContext
from .logic.engine import (DEFAULT_PARAMS, AnalysisParams, Series, SiteModel, compute_metrics, evaluate,
                           make_model, time_grid)


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
