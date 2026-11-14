"""Core evaluation: Sun and Earth over a site's horizon across time.

Everything every endpoint needs starts here:

    model  = SiteModel(...)                       # where, which horizon, which mast
    series = evaluate(eph, model, time_grid(...)) # az/el, visible disc fractions, eclipse, power per m2
    m      = compute_metrics(series)              # percentages, longest dark / blackout, continuity
    ranges = visibility_ranges(series.t_ms, series.sunlit())   # time ranges instead of fractions

Pure functions over NumPy arrays: no files, no network, no FastAPI. Times are Unix milliseconds.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import numpy as np

from .constants import DEG, EARTH_R_KM, MS_PER_DAY, MS_PER_HOUR, SUN_R_KM
from .ephemeris import EphemerisTable
from .geometry import (SiteFrame, angular_radius_deg, body_direction, separation_deg, site_frame,
                       solar_irradiance_w_m2)
from .horizon import HorizonProfile
from .visibility import disc_overlap_fraction, disc_visible_fraction

PanelModel = Literal["tracking", "vertical", "horizontal"]
Body = Literal["sun", "earth"]


@dataclass(frozen=True)
class AnalysisParams:
    """panel: how the solar array is oriented (sets the cosine factor on the irradiance).
    comms_min_fraction: the Earth counts as visible for direct communication when at least this
    fraction of its disc is above the horizon."""
    panel: PanelModel = "vertical"
    comms_min_fraction: float = 0.5


DEFAULT_PARAMS = AnalysisParams()


@dataclass(frozen=True)
class SiteModel:
    """Everything needed to evaluate geometry at one point with one horizon."""
    lat: float
    lon: float
    ground_m: float          # height of the ground above the 1737.4 km sphere
    mast_m: float            # height of the panel / antenna above the ground
    horizon: HorizonProfile
    frame: SiteFrame


def make_model(lat: float, lon: float, ground_m: float, horizon: HorizonProfile, mast_m: float) -> SiteModel:
    # The frame sits on the ground: the mast is already inside the horizon mask and its effect on
    # the direction to the Sun or the Earth is below a micro-degree.
    return SiteModel(lat=lat, lon=lon, ground_m=ground_m, mast_m=mast_m, horizon=horizon,
                     frame=site_frame(lat, lon, ground_m / 1000.0))


@dataclass(frozen=True)
class Series:
    """Per-sample results; every array has the length of ``t_ms``."""
    t_ms: np.ndarray
    sun_el: np.ndarray
    sun_az: np.ndarray
    sun_frac: np.ndarray          # 0..1 of the solar disc above the horizon
    sun_dist_km: np.ndarray
    sun_radius_deg: np.ndarray
    earth_el: np.ndarray
    earth_az: np.ndarray
    earth_frac: np.ndarray        # 0..1 of the Earth's disc above the horizon
    earth_dist_km: np.ndarray
    earth_radius_deg: np.ndarray
    eclipse: np.ndarray           # 0 none, 1 partial, 2 total: the Earth covering the Sun
    irradiance_w_m2: np.ndarray   # normal to the rays, before horizon and panel factors
    power_w_m2: np.ndarray        # irradiance x visible fraction x (1 - eclipsed) x panel cosine factor
    sun_eclipsed_fraction: np.ndarray  # 0..1 of the solar disc hidden behind the Earth (lunar eclipse)

    def sunlit(self) -> np.ndarray:
        return self.sun_frac > 0.0

    def comms(self, params: AnalysisParams = DEFAULT_PARAMS) -> np.ndarray:
        return self.earth_frac >= params.comms_min_fraction

    @property
    def step_ms(self) -> float:
        return float(self.t_ms[1] - self.t_ms[0]) if self.t_ms.size > 1 else 0.0


def time_grid(start_ms: float, duration_h: float, step_min: float) -> np.ndarray:
    """Evenly spaced times from ``start_ms`` covering ``duration_h`` (both ends included)."""
    step_ms = step_min * 60_000.0
    n = int(np.floor(duration_h * MS_PER_HOUR / step_ms)) + 1
    return start_ms + step_ms * np.arange(n, dtype=np.float64)


def panel_factor(panel: PanelModel, sun_el_deg: np.ndarray) -> np.ndarray:
    """Cosine factor of an idealised array: sun-tracking, vertical turning in azimuth (the usual
    polar choice), or lying flat on the ground."""
    if panel == "tracking":
        return np.ones_like(sun_el_deg)
    if panel == "vertical":
        return np.cos(sun_el_deg * DEG)
    return np.maximum(0.0, np.sin(sun_el_deg * DEG))


def evaluate(eph: EphemerisTable, model: SiteModel, t_ms, params: AnalysisParams = DEFAULT_PARAMS) -> Series:
    t = np.atleast_1d(np.asarray(t_ms, dtype=np.float64))
    v = eph.positions(t)
    sun = body_direction(v[:, 0:3], model.frame)
    earth = body_direction(v[:, 3:6], model.frame)
    sr = angular_radius_deg(SUN_R_KM, sun.dist_km)
    er = angular_radius_deg(EARTH_R_KM, earth.dist_km)
    sun_frac = disc_visible_fraction(sun.el, sun.az, sr, model.horizon)
    earth_frac = disc_visible_fraction(earth.el, earth.az, er, model.horizon)
    sep = separation_deg(sun.unit, earth.unit)
    eclipse = np.where(sep < er - sr, 2, np.where(sep < er + sr, 1, 0)).astype(np.uint8)
    irradiance = solar_irradiance_w_m2(sun.dist_km)
    # Light reaching the array: the part of the disc above the horizon and not behind the Earth. The product
    # treats the two occulters as independent; it is exact whenever either fraction is 0 or 1, and otherwise
    # lies between the true bounds max(0, f_h + f_e - 1) and min(f_h, f_e) (only when an eclipse coincides with
    # the Sun crossing the skyline).
    sun_eclipsed = disc_overlap_fraction(sep, sr, er)
    power = irradiance * sun_frac * (1.0 - sun_eclipsed) * panel_factor(params.panel, sun.el)
    return Series(t_ms=t, sun_el=sun.el, sun_az=sun.az, sun_frac=sun_frac, sun_dist_km=sun.dist_km,
                  sun_radius_deg=sr, earth_el=earth.el, earth_az=earth.az, earth_frac=earth_frac,
                  earth_dist_km=earth.dist_km, earth_radius_deg=er, eclipse=eclipse,
                  irradiance_w_m2=irradiance, power_w_m2=power, sun_eclipsed_fraction=sun_eclipsed)


# ---------------------------------------------------------------------------- time summaries

def longest_run(flags: np.ndarray, target: bool) -> int:
    """Longest run (in samples) where flags == target."""
    f = np.asarray(flags, dtype=bool) == target
    if not f.any():
        return 0
    edges = np.diff(np.concatenate(([0], f.astype(np.int8), [0])))
    return int((np.flatnonzero(edges == -1) - np.flatnonzero(edges == 1)).max())


def visibility_ranges(t_ms: np.ndarray, flags: np.ndarray) -> list[tuple[float, float]]:
    """Time ranges [start_ms, end_ms] where ``flags`` is true, at the resolution of the grid.
    This is the "time ranges" answer; the "fraction of time" answer is ``flags.mean()``."""
    f = np.asarray(flags, dtype=bool)
    if not f.any():
        return []
    edges = np.diff(np.concatenate(([0], f.astype(np.int8), [0])))
    starts, ends = np.flatnonzero(edges == 1), np.flatnonzero(edges == -1) - 1
    return [(float(t_ms[a]), float(t_ms[b])) for a, b in zip(starts, ends)]


@dataclass(frozen=True)
class Metrics:
    window_hours: float
    sunlight_pct: float
    comms_pct: float
    both_pct: float
    longest_dark_h: float
    longest_blackout_h: float
    mean_power_w_m2: float
    continuous_light: bool
    continuous_comms: bool
    eclipse_minutes: float
    eclipse_events: int
    max_sun_el_deg: float
    min_sun_el_deg: float


def compute_metrics(series: Series, params: AnalysisParams = DEFAULT_PARAMS) -> Metrics:
    n = series.t_ms.size
    step_h = series.step_ms / MS_PER_HOUR
    sunlit, comms = series.sunlit(), series.comms(params)
    ecl = series.eclipse > 0
    return Metrics(
        window_hours=(n - 1) * step_h,
        sunlight_pct=100.0 * float(sunlit.mean()),
        comms_pct=100.0 * float(comms.mean()),
        both_pct=100.0 * float((sunlit & comms).mean()),
        longest_dark_h=longest_run(sunlit, False) * step_h,
        longest_blackout_h=longest_run(comms, False) * step_h,
        mean_power_w_m2=float(series.power_w_m2.mean()),
        continuous_light=bool(sunlit.all()),
        continuous_comms=bool(comms.all()),
        eclipse_minutes=float(ecl.sum()) * series.step_ms / 60_000.0,
        eclipse_events=int(np.count_nonzero(ecl[1:] & ~ecl[:-1]) + int(ecl[0])),
        max_sun_el_deg=float(series.sun_el.max()),
        min_sun_el_deg=float(series.sun_el.min()),
    )


# ---------------------------------------------------------------------------- next sunset / Earthset

@dataclass(frozen=True)
class Transition:
    kind: Literal["set", "rise"]   # the body leaves view or comes into view
    at_ms: float
    in_ms: float                   # from the search start


def _visible(series: Series, body: Body, params: AnalysisParams) -> np.ndarray:
    return series.sunlit() if body == "sun" else series.comms(params)


def next_transition(eph: EphemerisTable, model: SiteModel, from_ms: float, body: Body,
                    params: AnalysisParams = DEFAULT_PARAMS, search_days: float = 45.0,
                    coarse_ms: float = 600_000.0) -> Transition | None:
    """Next change of visibility of the Sun (any part of the disc above the horizon) or of the Earth
    (at least ``comms_min_fraction`` of its disc). Coarse scan, then bisection to about one second.
    None when the state does not change within ``search_days`` or the tables end first."""
    last = max(end for start, end in eph.coverage() if start <= from_ms <= end)
    end = min(from_ms + search_days * MS_PER_DAY, last)
    t = np.arange(from_ms, end + 1.0, coarse_ms)
    if t.size < 2:
        return None
    vis = _visible(evaluate(eph, model, t, params), body, params)
    change = np.flatnonzero(vis != vis[0])
    if change.size == 0:
        return None
    lo, hi = float(t[change[0] - 1]), float(t[change[0]])
    while hi - lo > 1000.0:
        mid = (lo + hi) / 2.0
        if bool(_visible(evaluate(eph, model, mid, params), body, params)[0]) == bool(vis[0]):
            lo = mid
        else:
            hi = mid
    return Transition(kind="set" if vis[0] else "rise", at_ms=hi, in_ms=hi - from_ms)


# ---------------------------------------------------------------------------- ranges with refined edges

Flag = Literal["sun", "earth", "eclipse"]


def _flag(series: Series, which: Flag, params: AnalysisParams) -> np.ndarray:
    if which == "eclipse":
        return series.eclipse > 0
    return _visible(series, which, params)


@dataclass(frozen=True)
class RefinedRange:
    start_ms: float              # first instant in the state (or the window start)
    end_ms: float                # first instant out of it again (or the window end)
    starts_before_window: bool   # true at the first sample: the state may have begun earlier
    ends_after_window: bool      # true at the last sample: the state may go on after the window


def refined_ranges(eph: EphemerisTable, model: SiteModel, series: Series, which: Flag,
                   params: AnalysisParams = DEFAULT_PARAMS, tol_ms: float = 1000.0) -> list[RefinedRange]:
    """Ranges where the Sun is visible ("sun"), the Earth is visible for comms ("earth") or an eclipse is on
    ("eclipse"), with every inner edge bisected between its two samples to ``tol_ms`` (default 1 s), the same
    rule as ``next_transition``: an edge is the first instant in the new state. All edges are refined together,
    one vectorised ``evaluate`` per bisection step. Events shorter than the grid step can be missed entirely;
    that is the grid's resolution, not the edges'."""
    t = series.t_ms
    f = _flag(series, which, params)
    if not f.any():
        return []
    d = np.diff(np.concatenate(([0], f.astype(np.int8), [0])))
    first, last = np.flatnonzero(d == 1), np.flatnonzero(d == -1) - 1
    n = t.size
    # Edges to refine: rises at first[i] > 0 (between first-1 and first), sets at last[i] < n-1 (last, last+1).
    rise_i = first[first > 0]
    set_i = last[last < n - 1]
    lo = np.concatenate((t[rise_i - 1], t[set_i]))
    hi = np.concatenate((t[rise_i], t[set_i + 1]))
    target = np.concatenate((np.ones(rise_i.size, bool), np.zeros(set_i.size, bool)))   # state at `hi`
    while lo.size and np.max(hi - lo) > tol_ms:
        mid = (lo + hi) / 2.0
        at_mid = _flag(evaluate(eph, model, mid, params), which, params)
        moved = at_mid == target            # mid already in the new state: the edge is at or before mid
        hi = np.where(moved, mid, hi)
        lo = np.where(moved, lo, mid)
    rise_at = dict(zip(rise_i.tolist(), hi[:rise_i.size].tolist()))
    set_at = dict(zip(set_i.tolist(), hi[rise_i.size:].tolist()))
    out = []
    for a, b in zip(first.tolist(), last.tolist()):
        out.append(RefinedRange(start_ms=rise_at.get(a, float(t[0])), end_ms=set_at.get(b, float(t[-1])),
                                starts_before_window=a == 0, ends_after_window=b == n - 1))
    return out
