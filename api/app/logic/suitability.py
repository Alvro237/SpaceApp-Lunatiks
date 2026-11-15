"""Suitability search: the criteria catalogue and the pure helpers (docs/mission-design-spec.md section 8, amended by
docs/mission-planner-ui-spec.md section 6).

Every criterion is a hard limit the planner sets. The score is per category: a switched-on category with a natural
measure adds one utility layer (0..1 per cell):

  power       share of the mission window with any part of the Sun visible
  earth       share of the window with Earth contact (comms_min_fraction of the disc)
  topography  1 - slope / max_slope (clipped 0..1), mean with 1 - cover / max_cover when crater cover is set
  science     mean of 1 - distance / limit for each distance criterion set (PSR, named feature, past landings
              "near"), and (H - limit) / (H_best - limit) for hydrogen (H_best: highest value among the cells passing
              every hard criterion in the region)
  radiation   1 - dose / max_dose

Layers are weighted by the planner's priority order with rank order centroid weights (Barron and Barrett 1996,
Management Science 42(11) 1515-1523): w_k = (1/n) sum_{i=k..n} 1/i. Utilities are quantised to uint8 (0..250) and
the score is computed from the quantised values, so the browser can re-weight and get the same number.
No file access here: arrays in, arrays out.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

import numpy as np

# ---------------------------------------------------------------- catalogue

CATEGORIES: tuple[tuple[str, str, str | None], ...] = (
    ("search", "Search area", None),
    ("power", "Power and sunlight", "Share of the mission window with any part of the Sun visible"),
    ("earth", "Earth contact", "Share of the mission window with Earth contact"),
    ("topography", "Topography and landing safety", "1 - slope / maximum slope, averaged with 1 - crater cover / maximum cover when that limit is set"),
    ("landing", "Landing conditions", None),
    ("science", "Science and resources", "Mean closeness to the science targets set (1 - distance / limit; hydrogen relative to the best in the region)"),
    ("radiation", "Radiation", "1 - dose / maximum dose"),
    ("schedule", "Schedule", None),
)
CATEGORY_IDS = tuple(c[0] for c in CATEGORIES)
CATEGORY_TITLE = {c[0]: c[1] for c in CATEGORIES}
CATEGORY_SCORE = {c[0]: c[2] for c in CATEGORIES}
SCORED_CATEGORIES = tuple(c[0] for c in CATEGORIES if c[2] is not None)

POWER_FLAT_KEYS = ("panel_area_m2", "cell_efficiency", "derating", "load_w", "battery_capacity_wh",
                   "battery_initial_soc", "battery_min_soc", "charge_efficiency", "discharge_efficiency")


@dataclass(frozen=True)
class ParamSpec:
    key: str
    label: str
    unit: str | None
    kind: Literal["number", "text"]
    min: float | None = None
    max: float | None = None
    required: bool = True
    min_exclusive: bool = False


@dataclass(frozen=True)
class CriterionSpec:
    id: str
    category: str
    label: str
    unit: str | None
    kind: Literal["value", "range", "choice", "flag"]
    comparator: Literal[">=", "<="] | None       # value criteria: value <comparator> limit passes
    stage: Literal["geometry", "regional", "medium", "fine", "window"]
    coverage: str
    source: str
    tip: str
    options: tuple[str, ...] = ()
    params: tuple[ParamSpec, ...] = ()
    limit_min: float | None = None              # allowed limit (or range bounds) interval
    limit_max: float | None = None
    bounded: bool = False                       # the ephemeris bound can prove a fail


_POWER_PARAMS = (
    ParamSpec("panel_area_m2", "Panel area", "m2", "number", 0.0, None, True, True),
    ParamSpec("cell_efficiency", "Cell efficiency", "0-1", "number", 0.0, 1.0, True, True),
    ParamSpec("derating", "Derating", "0-1", "number", 0.0, 1.0, True, True),
    ParamSpec("load_w", "Day load", "W", "number", 0.0, None),
    ParamSpec("night_load_w", "Night load", "W", "number", 0.0, None, False),
    ParamSpec("battery_capacity_wh", "Battery capacity", "Wh", "number", 0.0, None, True, True),
    ParamSpec("battery_initial_soc", "State of charge at landing", "0-1", "number", 0.0, 1.0),
    ParamSpec("battery_min_soc", "Lowest allowed state of charge", "0-1", "number", 0.0, 1.0),
    ParamSpec("charge_efficiency", "Charge efficiency", "0-1", "number", 0.0, 1.0, True, True),
    ParamSpec("discharge_efficiency", "Discharge efficiency", "0-1", "number", 0.0, 1.0, True, True),
)

CATALOGUE_LIST: tuple[CriterionSpec, ...] = (
    CriterionSpec("side", "search", "Near or far side", None, "choice", None, "geometry", "everywhere",
                  "MOON_ME longitude", "Keeps only the side chosen (near: longitude within 90 deg of the sub-Earth meridian); "
                  "a coarse screen, the Earth contact criteria compute real visibility.", options=("near", "far")),
    CriterionSpec("battery_autonomy_h", "power", "Battery autonomy", "h", "value", "<=", "window", "south of 60 S",
                  "Engine series over traced LOLA horizons", "No stretch of darkness during the mission may be longer "
                  "than the hours the battery keeps the lander alive.", limit_min=0.0, bounded=True),
    CriterionSpec("recharge_h", "power", "Recharge time", "h", "value", ">=", "window", "south of 60 S",
                  "Engine series over traced LOLA horizons", "Every sunlit stretch must last at least this long: the first "
                  "one after landing and each one between two nights (a stretch cut by the end of the mission is not checked).",
                  limit_min=0.0),
    CriterionSpec("avoid_psr", "power", "Avoid permanently shadowed ground", None, "flag", None, "medium", "south of 65 S",
                  "PGDA product 69 permanent shadow (LPSR_65S_240M_201608)", "Leaves out any cell that contains ground the "
                  "Sun never reaches."),
    CriterionSpec("battery_model", "power", "Detailed battery model", None, "flag", None, "window", "south of 60 S",
                  "Same model as POST /api/v1/power level 3 (eclipses included)", "Simulates the battery hour by hour with "
                  "the panel and loads given; passes when no load is ever left unserved. Replaces battery autonomy and "
                  "recharge time.", params=_POWER_PARAMS),
    CriterionSpec("blackout_h", "earth", "Longest blackout", "h", "value", "<=", "window", "south of 60 S",
                  "Engine series over traced LOLA horizons", "The longest time without direct radio contact with Earth "
                  "that the mission accepts.", limit_min=0.0, bounded=True),
    CriterionSpec("max_slope_deg", "topography", "Maximum slope", "deg", "value", "<=", "fine", "south of 60 S",
                  "LOLA slope, PGDA product 90 (320 m south of 80 S, 960 m elsewhere)", "Steepest ground the lander can "
                  "stand on: a cell fails if any part of it is steeper.", limit_min=0.0, limit_max=90.0),
    CriterionSpec("crater_cover_pct", "topography", "Crater cover in the landing area", "%", "value", "<=", "regional",
                  "catalogue global, raster south of 60 S", "Robbins (2018) crater catalogue", "Share of the landing "
                  "ellipse (or of the cell without one) inside craters at least twice the cell size.",
                  limit_min=0.0, limit_max=100.0),
    CriterionSpec("rim_margin_radii", "topography", "Margin from crater rims", "crater radii", "value", ">=", "fine",
                  "catalogue global, raster south of 60 S", "Robbins (2018) crater catalogue", "Keep at least this many "
                  "crater radii away from the rim of every crater at least twice the cell size, inside or outside it.",
                  limit_min=0.0, limit_max=5.0),
    CriterionSpec("sun_el_at_landing_deg", "landing", "Sun height at landing", "deg", "range", None, "window",
                  "south of 60 S", "Engine state at the landing instant", "Elevation of the Sun's centre above the "
                  "horizontal at touchdown.", limit_min=-90.0, limit_max=90.0, bounded=True),
    CriterionSpec("earth_at_landing", "landing", "Earth in view at landing", None, "flag", None, "window", "south of 60 S",
                  "Engine state at the landing instant", "The Earth must be in contact at touchdown, for live telemetry.",
                  bounded=True),
    CriterionSpec("psr_distance_km", "science", "Near permanent shadow", "km", "value", "<=", "regional", "south of 65 S",
                  "PGDA product 69 permanent shadow", "Within this distance of permanently shadowed ground, where water "
                  "ice may be trapped.", limit_min=0.0, limit_max=100.0),
    CriterionSpec("hydrogen_ppm", "science", "Hydrogen", "ppm", "value", ">=", "regional", "south of 60 S",
                  "Lunar Prospector neutron spectrometer (Feldman et al. 2001)", "Hydrogen in the top metre of soil; each "
                  "value covers about 45 km."),
    CriterionSpec("target_distance_km", "science", "Near a named feature", "km", "value", "<=", "geometry", "everywhere",
                  "USGS Gazetteer of Planetary Nomenclature (IAU)", "Within this distance of the centre of a named feature.",
                  params=(ParamSpec("feature", "Feature (IAU name)", None, "text"),), limit_min=0.0, limit_max=2000.0),
    CriterionSpec("past_landings", "science", "Past landings", "km", "value", None, "geometry", "everywhere",
                  "NASA NSSDCA lunar artifact list (measured landing points)", "Keep clear of (away) or stay close to "
                  "(near) earlier landing and impact sites.", options=("away", "near"), limit_min=0.0, limit_max=2000.0),
    CriterionSpec("dose_mgy", "radiation", "Maximum dose", "mGy", "value", "<=", "medium", "south of 65 S",
                  "LRO CRaTER climatology x open sky (PGDA 69) / 4 pi", "Cosmic-ray dose over the mission in silicon, "
                  "lower where the terrain hides more of the sky; solar storms not included.", limit_min=0.0),
)
CATALOGUE: dict[str, CriterionSpec] = {c.id: c for c in CATALOGUE_LIST}

UNAVAILABLE: dict[str, tuple[str, str, str]] = {   # id -> (category, label, reason)
    "roughness": ("topography", "Roughness", "The LOLA roughness map (PGDA 90, LDRM_80S_1000MPP) has no confirmed units yet."),
    "rocks": ("topography", "Rocks", "No open boulder or rock-abundance map is loaded for the pole."),
    "regolith_density": ("topography", "Regolith density", "No regolith density or compaction map is loaded (candidate: Diviner H-parameter, to verify)."),
    "temperature": ("radiation", "Thermal", "The thermal model runs on one spot: open a site, then the Power panel."),
    "colony": ("power", "Colony", "Sized on one spot: open a site, then Colony in the Power panel."),
    "link_margin": ("earth", "Link margin", "Needs a radio link budget (antenna, power, frequency)."),
    "solar_storm_risk": ("radiation", "Solar storms", "No forecast of solar particle events exists for a future window."),
    "north_pole": ("search", "North pole", "The polar grids cover the south pole only (north polar grids are not built)."),
}

FIXED_INPUTS = (
    ("region", "Search region", "Centre (south of 60 S) and radius of the disc searched."),
    ("window", "Mission window", "Landing instant (UTC) and mission duration."),
)
REQUEST_PARAMETERS = (
    ("landing_radius_km", "Landing ellipse radius", "Topography: a spot is kept only if no failing cell lies within this distance."),
    ("comms_min_fraction", "Earth disc needed for contact", "Earth contact: share of the Earth's disc above the horizon that counts as contact (team parameter 0.5)."),
    ("robust_delay_h", "Robust to a landing delay", "Schedule: every window criterion must still pass if the landing slips by this many hours."),
)


@dataclass
class ValidatedInputs:
    criteria: dict[str, object]            # id -> CriterionInput (validated)
    categories: list[str]                  # switched on, catalogue order
    errors: list[str] = field(default_factory=list)


def validate_inputs(categories: list[str], criteria: list, priority: list[str] | None) -> list[str]:
    """Errors of the planner's inputs (empty when valid). criteria: objects with id, limit, min, max, choice, params."""
    errs: list[str] = []
    on = set(categories)
    seen: set[str] = set()
    for c in criteria:
        if c.id in UNAVAILABLE or c.id not in CATALOGUE:
            errs.append(f"{c.id}: unknown or unavailable criterion")
            continue
        if c.id in seen:
            errs.append(f"{c.id}: given twice")
            continue
        seen.add(c.id)
        spec = CATALOGUE[c.id]
        if spec.category not in on:
            errs.append(f"{c.id}: its category '{spec.category}' is switched off")
        if spec.kind == "value":
            if c.limit is None:
                errs.append(f"{c.id}: limit required")
            elif (spec.limit_min is not None and c.limit < spec.limit_min) or (spec.limit_max is not None and c.limit > spec.limit_max):
                errs.append(f"{c.id}: limit outside {spec.limit_min}..{spec.limit_max} {spec.unit or ''}".rstrip())
            if c.min is not None or c.max is not None:
                errs.append(f"{c.id}: takes a limit, not min/max")
        if spec.kind == "range":
            if c.min is None and c.max is None:
                errs.append(f"{c.id}: give min, max or both")
            if c.min is not None and c.max is not None and c.min > c.max:
                errs.append(f"{c.id}: min is above max")
            for v in (c.min, c.max):
                if v is not None and spec.limit_min is not None and not (spec.limit_min <= v <= spec.limit_max):
                    errs.append(f"{c.id}: values within {spec.limit_min}..{spec.limit_max} {spec.unit}")
            if c.limit is not None:
                errs.append(f"{c.id}: takes min/max, not a limit")
        if spec.options:
            if c.choice not in spec.options:
                errs.append(f"{c.id}: choice must be one of {', '.join(spec.options)}")
        elif c.choice is not None:
            errs.append(f"{c.id}: takes no choice")
        known = {p.key: p for p in spec.params}
        for k in c.params:
            if k not in known:
                errs.append(f"{c.id}: unknown parameter {k}")
        for p in spec.params:
            v = c.params.get(p.key)
            if v is None:
                if p.required:
                    errs.append(f"{c.id}: parameter {p.key} required")
                continue
            if p.kind == "text":
                if not isinstance(v, str) or not v.strip():
                    errs.append(f"{c.id}: parameter {p.key} must be text")
                continue
            if isinstance(v, str):
                errs.append(f"{c.id}: parameter {p.key} must be a number")
                continue
            lo_bad = p.min is not None and (v <= p.min if p.min_exclusive else v < p.min)
            hi_bad = p.max is not None and v > p.max
            if lo_bad or hi_bad:
                errs.append(f"{c.id}: parameter {p.key} outside {p.min}..{p.max}")
    if "battery_model" in seen and seen & {"battery_autonomy_h", "recharge_h"}:
        errs.append("battery_model replaces battery_autonomy_h and recharge_h: send one or the other")
    for p in priority or []:
        if p not in SCORED_CATEGORIES:
            errs.append(f"priority: {p} is not a scored category ({', '.join(SCORED_CATEGORIES)})")
    if priority is not None and len(set(priority)) != len(priority):
        errs.append("priority: a category is listed twice")
    return errs


def ordered_scored(categories: list[str], priority: list[str] | None, scored: set[str]) -> list[str]:
    """Scored categories (those that produce a layer), in the planner's priority order; the rest in catalogue order."""
    first = [p for p in (priority or []) if p in scored and p in categories]
    return first + [c for c in SCORED_CATEGORIES if c in scored and c in categories and c not in first]


# ---------------------------------------------------------------- pure helpers (spec 8.1)

def roc_weights(n: int) -> np.ndarray:
    """Rank order centroid weights (Barron and Barrett 1996): w_k = (1/n) sum_{i=k..n} 1/i, k = 1 most important."""
    inv = 1.0 / np.arange(1, n + 1)
    return np.cumsum(inv[::-1])[::-1] / n


def utility(x, limit: float, ideal: float) -> np.ndarray:
    """0 at limit and on its worse side, 1 at ideal and beyond, linear between; NaN stays NaN."""
    return np.clip((np.asarray(x, dtype=np.float64) - limit) / (ideal - limit), 0.0, 1.0) + 0.0


def quantize_utility(u: np.ndarray) -> np.ndarray:
    """uint8: floor(u * 250 + 0.5), 255 = no data. The score is computed from these quantized values, on the server
    and in the browser alike, so both give the same number."""
    q = np.floor(np.nan_to_num(u, nan=0.0) * 250.0 + 0.5)
    return np.where(np.isnan(u), 255, q).astype(np.uint8)


def score_from_quantized(q: list[np.ndarray], w: np.ndarray) -> tuple[np.ndarray | None, np.ndarray | None]:
    """score = sum w_i (q_i / 250) / sum w_i over the layers with data (q != 255); coverage = sum of those w_i /
    sum w_i. Summation in the list order, float64. No layers -> (None, None): the caller uses score 1, coverage 1.
    No data at a cell -> 0, 0."""
    if not q:
        return None, None
    num = np.zeros(q[0].shape)
    den = np.zeros(q[0].shape)
    for qi, wi in zip(q, w):
        ok = qi != 255
        num += np.where(ok, wi * (qi / 250.0), 0.0)
        den += np.where(ok, wi, 0.0)
    score = np.where(den > 0, num / np.where(den > 0, den, 1.0), 0.0)
    return score, den / float(np.sum(w))


def score_u8(score: np.ndarray, viable: np.ndarray) -> np.ndarray:
    """0 for non-viable cells, else clip(floor(score * 255 + 0.5), 1, 255)."""
    return np.where(viable, np.clip(np.floor(score * 255.0 + 0.5), 1, 255), 0).astype(np.uint8)


def edt_cells(mask: np.ndarray, max_cells: float) -> np.ndarray:
    """Exact Euclidean distance (cells) from each cell centre to the nearest True cell centre, up to max_cells; inf
    beyond or when mask is empty. Column pass exact by two scans; row pass min over offsets |s| <= max_cells."""
    ny, nx = mask.shape
    g = np.full((ny, nx), np.inf)
    last = np.full(nx, -np.inf)
    for i in range(ny):
        last = np.where(mask[i], float(i), last)
        g[i] = i - last
    last = np.full(nx, np.inf)
    for i in range(ny - 1, -1, -1):
        last = np.where(mask[i], float(i), last)
        g[i] = np.minimum(g[i], last - i)
    g2 = g * g
    out = g2.copy()
    for s in range(1, min(int(np.floor(max_cells)), nx - 1) + 1):
        s2 = float(s * s)
        np.minimum(out[:, s:], g2[:, :-s] + s2, out=out[:, s:])
        np.minimum(out[:, :-s], g2[:, s:] + s2, out=out[:, :-s])
    d = np.sqrt(out)
    d[d > max_cells] = np.inf
    return d


def min_filter_square(a: np.ndarray, r: int) -> np.ndarray:
    """Minimum over the (2r+1) x (2r+1) square around each cell, NaN ignored (the edge uses the part inside).
    The square circumscribes the landing disc, so it is the conservative choice."""
    if r <= 0:
        return a.copy()
    out = np.where(np.isnan(a), np.inf, a)
    for axis in (0, 1):
        src, acc = out, out.copy()
        for s in range(1, min(r, src.shape[axis] - 1) + 1):
            hi = [slice(None)] * 2
            lo = [slice(None)] * 2
            hi[axis], lo[axis] = slice(s, None), slice(None, -s)
            np.minimum(acc[tuple(hi)], src[tuple(lo)], out=acc[tuple(hi)])
            np.minimum(acc[tuple(lo)], src[tuple(hi)], out=acc[tuple(lo)])
        out = acc
    return np.where(np.isinf(out), np.nan, out)


def pick_sites(score, tiebreak, x_m, y_m, scale_k, min_sep_m: float, k: int) -> list[tuple[int, int]]:
    """Greedy non-maximum suppression: best cell, then the best cell at least min_sep_m (ground distance:
    projected distance / mean scale factor) from every pick, until k picks. NaN score = not a candidate.
    Order: score desc, tiebreak desc, flat index asc."""
    flat = np.flatnonzero(~np.isnan(score))
    if flat.size == 0:
        return []
    if flat.size > 200_000:
        best = np.argpartition(-score.reshape(-1)[flat], 200_000)[:200_000]
        flat = np.sort(flat[best])
    order = flat[np.lexsort((flat, -tiebreak.reshape(-1)[flat], -score.reshape(-1)[flat]))]
    xs, ys, ks = x_m.reshape(-1), y_m.reshape(-1), scale_k.reshape(-1)
    picks: list[int] = []
    for c in order:
        if len(picks) == k:
            break
        if picks:
            p = np.array(picks)
            if (np.hypot(xs[p] - xs[c], ys[p] - ys[c]) / ((ks[p] + ks[c]) / 2.0) < min_sep_m).any():
                continue
        picks.append(int(c))
    return [tuple(int(v) for v in np.unravel_index(c, score.shape)) for c in picks]


def pros_cons(entries: list[dict], n: int = 3) -> tuple[list[str], list[str]]:
    """entries: one dict per scored category at the site with keys id, utility (float or None), weight.
    Pros: utility >= 0.5, by weight * utility desc. Cons: utility < 0.5, by weight * (1 - utility) desc."""
    known = [e for e in entries if e["utility"] is not None]
    pros = sorted((e for e in known if e["utility"] >= 0.5), key=lambda e: (-e["weight"] * e["utility"], e["id"]))
    cons = sorted((e for e in known if e["utility"] < 0.5), key=lambda e: (-e["weight"] * (1 - e["utility"]), e["id"]))
    return [e["id"] for e in pros[:n]], [e["id"] for e in cons[:n]]


def passes(spec: CriterionSpec, x: np.ndarray, c) -> np.ndarray:
    """Hard test. value: compared with c.limit by spec.comparator (past_landings: away -> >=, near -> <=);
    range: min <= x <= max (either may be None); choice / flag: the evaluator returns 1.0 for pass, 0.0 for fail."""
    x = np.asarray(x, dtype=np.float64)
    with np.errstate(invalid="ignore"):
        if spec.kind == "value":
            comp = spec.comparator or (">=" if c.choice == "away" else "<=")
            return x >= c.limit if comp == ">=" else x <= c.limit
        if spec.kind == "range":
            ok = np.ones(np.shape(x), bool)
            if c.min is not None:
                ok &= x >= c.min
            if c.max is not None:
                ok &= x <= c.max
            return ok
        return x > 0.5


def margin(spec: CriterionSpec, x: float, c) -> float | None:
    """Distance to the limit on the passing side (negative when failing), criterion unit; range: to the nearer bound."""
    if x is None or not np.isfinite(x):
        return None
    if spec.kind == "value":
        comp = spec.comparator or (">=" if c.choice == "away" else "<=")
        return float(x - c.limit) if comp == ">=" else float(c.limit - x)
    if spec.kind == "range":
        ds = [x - c.min] if c.min is not None else []
        ds += [c.max - x] if c.max is not None else []
        return float(min(ds)) if ds else None
    return None


def shortest_checked_run(flags: np.ndarray) -> int | None:
    """Recharge: length (samples) of the shortest run of True that is either the first run (starts at sample 0) or is
    followed by a False inside the series; None when no run is checked (no full night in the window)."""
    f = np.asarray(flags, dtype=bool)
    if f.size == 0:
        return None
    d = np.diff(np.concatenate(([0], f.astype(np.int8), [0])))
    starts = np.flatnonzero(d == 1)
    ends = np.flatnonzero(d == -1)          # exclusive
    checked = [(e - s) for s, e in zip(starts, ends) if s == 0 or e < f.size]
    return int(min(checked)) if checked else None


def closeness(d: np.ndarray, limit: float) -> np.ndarray:
    """Science distance utility: 1 - d / limit, clipped to 0..1 (0 at the limit, 1 on the target)."""
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.clip(1.0 - np.asarray(d, dtype=np.float64) / limit, 0.0, 1.0) if limit > 0 else np.where(np.asarray(d) <= 0, 1.0, 0.0)


def initial_bearing_deg(lat1, lon1, lat2, lon2) -> float:
    """Initial great-circle bearing from point 1 to point 2, degrees clockwise from north, 0..360."""
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dl = np.radians(lon2 - lon1)
    y = np.sin(dl) * np.cos(p2)
    x = np.cos(p1) * np.sin(p2) - np.sin(p1) * np.cos(p2) * np.cos(dl)
    return float((np.degrees(np.arctan2(y, x)) + 360.0) % 360.0)
