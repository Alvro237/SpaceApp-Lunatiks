# Mission design: suitability heatmap, ranked landing sites and the ordered funnel

**Implementation and validation specification.** Written 2026-11-15 for the model that implements it
(Claude Sonnet). Every decision is already taken here: follow the steps in order, copy the code given, run the
checks, and stop to ask the person only where this document says **ASK**.

Repository: `/Users/sergio_ini/Documents/NasaSpaceApps/repos/SpaceApp-Lunatiks` (below: "the repo").
All paths below are relative to the repo unless they start with `/`.

---

## 0. How to use this document

1. Read section 2 (ground rules) and obey it for the whole job.
2. Work pull request by pull request in the order of section 5. Each PR section lists: branch name, files,
   code, tests, validation, docs, definition of done. Do not start a PR before the previous one is open
   (they stack; PR 2 is independent and can go in parallel with PR 1).
3. Wherever a block of code is given, use it as written (adjust only imports and names that the repo forces).
   Wherever a number is given as "measured", it was measured on 2026-11-15 on this repo's data; your validation
   re-measures it and must reproduce it within the stated tolerance.
4. When a check fails, do not loosen the check. Stop, report the output to the person, and ask.

---

## 1. Context and goal

### 1.0 Builds on the current version; replaces nothing

Checked against `main` at `f29c8a3` (2026-11-15, after PRs #27-#31): `area_search.py`, `logic/areas.py`,
`schemas/areas.py` and `logic/horizon.py` are unchanged since this spec was written, every name it imports exists,
and `tests/test_areas.py` passes (22 tests). Everything here is **added next to** the current mission mode:

- API: `/api/v1/areas/search` stays as it is and keeps working; `/api/v1/suitability/*` is a new endpoint that
  **imports** the area-search helpers and never edits them.
- Web: the current mission panel (filters, "Load example mission", Find areas, pass/fail map) stays intact behind a
  "Pass/fail areas" tab; the new panel is a second tab. The map shader keeps today's look as mode 0.
- If `main` has moved again when you start, run `git log --oneline f29c8a3..origin/main -- api/app/area_search.py
  api/app/logic/areas.py api/app/schemas/areas.py api/app/logic/horizon.py web/src/panels/MissionPanel.tsx
  web/src/terrain` and, if anything is listed, read those diffs and **ASK** before continuing.

### 1.1 What already exists on `main` (commit `f29c8a3` or later)

- `POST /api/v1/areas/search` (owner SW-1): `api/app/area_search.py` (glue), `api/app/logic/areas.py`
  (raster helpers and the adaptive quadtree), `api/app/schemas/areas.py`, `api/app/routers/areas.py`,
  `api/tests/test_areas.py`. It paints which cells of a disc (centre south of 60 S, radius up to 400 km, at most
  360 000 cells) pass **hard** filters, in a funnel: static rasters, then a landing-radius dilation, then
  mission-window filters on adaptive samples (`quadtree_samples`), each sample with its own ray-traced horizon.
  It returns `codes_b64` (0 outside, 1 fails static, 2 fails window, 3 viable, 4 unknown), a `score_b64` that
  only mixes sunlight and Earth contact, and the 12 largest connected areas.
- Web mission mode (owner SW-1/SW-2): `web/src/panels/MissionPanel.tsx`, `web/src/panels/missionFilters.ts`,
  `web/src/state/areas.ts`; the raster is painted by `web/src/terrain/engine.ts` (`setAreas`) and
  `web/src/terrain/shaders.ts` (uniform `uArea`, r = code, g = score). Comparison radar:
  `web/src/charts/RadarChart.tsx`, used by `web/src/compare/ComparePanel.tsx`.
- Data (see `data/README.md`): LOLA slope and elevation grids south of 60 S (960 m) and 80 S (320 m slope,
  240 m elevation), PGDA 69 long-term Sun, Earth, permanent shadow and sky grids south of 65 S (960 m),
  Lunar Prospector hydrogen (3.84 km), Robbins (2018) craters (only `lat`, `lon`, `diam_km` stored), NSSDCA past
  landings, IAU nomenclature (`data/external/nomenclature/moon_nomenclature.csv`), ephemeris 2025-2035 hourly.

### 1.2 What to build

A **mission design** mode where the planner:

1. opens a picker, ticks the criteria they care about (no need to fill 35 fields), moves them to an
   "Active" list; the region and the mission window are fixed inputs that are always active and cannot be
   removed;
2. for each active criterion chooses a **role**: *Must* (hard limit: a cell that fails is out), *Prefer*
   (soft: it only changes the score) or *Both*; types the limit (worst acceptable) and, for Prefer/Both, the
   ideal value;
3. ranks the preferences by dragging them (weights by rank order centroid) or types percentages;
4. gets a **heatmap** of suitability (red → yellow → green, failed cells hatched, unknown dotted), with other
   display modes (three bands, limiting factor, colour-blind palette);
5. gets the **10 best landing sites**, spread apart, each with its values, pros and cons, margins to the
   limits and the nearest named feature; can save them to favourites in named folders, and compare them in a
   radar.

Changing a weight repaints instantly in the browser with no request. Changing a limit, role or parameter sends a
new request (cached on the server).

### 1.3 The key design idea: order the funnel by spatial scale and cost

Criteria differ in how fast they change across the surface, not only in how restrictive they are:

- Sunlight and Earth visibility over a mission window are driven by the ephemeris and change slowly across
  the surface (1 degree of elevation per 30.3 km of ground). A **conservative bound** computed from the
  ephemeris and the elevation alone can discard whole 30-60 km tiles in milliseconds, before any raster is read
  at full resolution (section 3, measured).
- Slope changes from one cell to the next: no tile larger than a few km is uniformly passing or failing
  (measured, section 3). It must be checked last, at full resolution, on what survives.

So the funnel runs: geometry (exact) → ephemeris bound (coarse tiles, proven fails) → regional rasters →
medium rasters → fine rasters → landing radius → window samples → exact evaluation of the top sites.
**The order changes the speed, never the result** (tested).

---

## 2. Ground rules (from the repo; non-negotiable)

1. At the start of the session, invoke the repo skill `develop-endpoint`
   (`.claude/skills/develop-endpoint/SKILL.md`) and read `docs/STATUS.md`. **ASK** the person which role they are
   (SW-1, SW-2, AERO-1, AERO-2, MECH); branch names below use `<role>` in lower case.
2. The team chats in Spanish: answer the person in Spanish. **Everything written to the repo is English**
   (code, comments, API fields, docs, commit messages, UI text).
3. One branch per functionality, from an up-to-date `main`; `main` changes only through a reviewed pull request.
   Never commit or push to `main`, never merge your own PR, never force-push a branch someone else pulled.
   **ASK** before every push, PR creation or deploy.
4. Layer rules: `app/logic/` is pure NumPy (no file access, no FastAPI, no imports from `db/`, `routers/`,
   `schemas/`). `app/db/` reads files, computes no physics. `app/routers/` hold no formulas. Glue that combines
   data and logic goes in a glue module (`app/suitability_search.py`, like `app/area_search.py`).
5. Shared files (`app/main.py`, `app/services.py`, `app/logic/engine.py`, `app/db/store.py`): additive edits
   only, and say so in the PR. Files owned by another role (`area_search.py`, `logic/areas.py`,
   `schemas/areas.py`, everything in `web/src/panels/`, `web/src/terrain/`): **do not edit** them in PRs 1-3; you
   may **import** from them. PR 4 edits a few web files owned by SW-1/SW-2: **ASK** the person to get the owners'
   agreement before starting PR 4.
6. No threshold or default without a cited source or the owner's decision. Every criterion threshold in this
   design is a user input with **no default**. Method parameters (cell size, tile sizes, margins, top-k, spacing)
   have defaults because they set resolution or display, not what passes; each is named and justified here.
7. A value no dataset provides is `null`/NaN with an explicit reason, never an estimate.
8. Every new external source goes into `docs/references.md` in the same PR.
9. `CLAUDE.md` is edited only to add one row to "Implemented endpoints and filters" in the PR that finishes an
   endpoint. `docs/STATUS.md` is never edited in a feature branch.
10. Before each push: `cd api && uv run pytest -q` (whole suite) and, for web PRs, `cd web && npm run typecheck
    && npm run lint && npm test`. Python is run with `uv run`, never bare `python`.
11. Smooth-sphere results are never bounds (repo rule). The bound in this design is **not** a smooth sphere: it
    is the lowest skyline that any terrain at or above the lowest LOLA height can produce. Section 6 proves it and
    the tests check it against real LOLA horizons.

---

## 3. Measured facts this design relies on

Prototype scripts (kept for reference, not part of the repo):
`/private/tmp/claude-501/-Users-sergio-ini--claude-spares-spare-5XzIcL/ed3c8d20-7c01-4552-9243-7f065dd146f5/scratchpad/bound_proto.py`,
`.../bound_validate.py`, `.../bound_bands.py`, `.../pyramid.py`, `.../spec_helpers.py`, `.../edt_bounded.py`
(same folder). If that folder was cleared, the code in this document is the complete version.

### 3.1 The ephemeris bound is safe against real terrain (prototype settings)

Prototype: lowest height −9.2 km, Sun radius 0.27°, Earth radius 1.0° (constants), point bound (theta = 0).
Checked against the LOLA terrain masks of the 13 catalogue terrain sites × 17 zone points
(`data/zones.i16`, 2 m mast), **every hourly sample 2025-2035**:

| Body | Samples with any part visible on the real horizon | Samples where the bound said "impossible" | Smallest margin (real skyline − bound floor) |
| --- | --- | --- | --- |
| Sun | 3 676 764 | **0** | 2.369° |
| Earth | 7 252 663 | **0** | 3.649° |

The final design is strictly more conservative than the prototype (lower floor, per-sample disc radii,
+0.05° margin), so the validation of PR 1 must again find 0 violations.

### 3.2 How much the bound discards (south of 60 S, window from 2027-01-10T00:00Z, hourly, threshold 70 %)

Share of the area proven to fail, tiles of 7.68 km:

| Latitude band | Sun ≥ 70 %, 14 d | Sun ≥ 70 %, 29.53 d | Earth ≥ 70 %, 14 d | Earth ≥ 70 %, 29.53 d |
| --- | --- | --- | --- | --- |
| 60-70 S | 60.0 % | 100.0 % | 38.3 % | 45.4 % |
| 70-80 S | 54.5 % | 90.9 % | 30.9 % | 43.5 % |
| 80-85 S | 26.6 % | 4.6 % | 5.0 % | 39.8 % |
| 85-88 S | 0.0 % | 0.0 % | 0.0 % | 22.4 % |
| 88-90 S | 0.0 % | 0.0 % | 0.0 % | 0.0 % |

By tile size (whole cap south of 60 S, Sun ≥ 70 % over 29.53 d): 61.44 km tiles 77.3 % out in 0.01 s;
30.72 km 82.0 % (0.04 s); 7.68 km 86.8 % (0.70 s); 3.84 km 87.6 % (2.66 s). Most of the gain is at the coarse
levels. Over one lunation the bound also proves a night longer than 100 h on 94.3 % of the area.

Consequence: the bound is decisive from 60 S to about 85 S and for Earth contact; within about 5° of the pole the
Sun stays near the horizon and only the terrain decides (window samples stay necessary there).

### 3.3 Slope cannot be decided by tiles; hydrogen can

Share of tiles uniformly decided (all pass or all fail) by a min/max pyramid, slope limit 10°:
`lola_slope_80s` (320 m): 20.5 km 0.0 %, 10.2 km 0.0 %, 5.1 km 4.8 %, 2.6 km 24.6 %, 1.3 km 53.8 %.
`lola_slope_60s` (960 m): 30.7 km 0.0 %, 15.4 km 2.1 %, 7.7 km 14.8 %, 3.8 km 41.0 %.
Hydrogen (`lp_hydrogen_60s`, 45 km footprint) decides most tiles already at 61 km. Hence the stage order.

### 3.4 The 960 m elevation grid hides relief

Comparing `lola_elevation_60s` (960 m, smoothed) with the 240 m pixels of `lola_elevation_80s` over the 399 424
fully covered cells: the 240 m maximum exceeds the 960 m value by up to **329 m** (99.9th percentile 284 m), and
the 960 m value exceeds the 240 m minimum by up to **337 m**. Grid minima: `lola_elevation_60s` −9108.0 m,
`lola_elevation_80s` −7286.5 m; maxima 6984.0 m and 7025.0 m. Design margin: **ELEV_MARGIN_M = 500 m** on both
the observer height and the lowest terrain height. A test re-measures the 329/337 m and fails if either exceeds
450 m.

### 3.5 Robbins (2018) columns

The CSV inside the zip (`lunar_crater_database_robbins_2018_bundle/data/lunar_crater_database_robbins_2018.csv`)
has exactly these 21 columns (read on 2026-11-15):

```
CRATER_ID,LAT_CIRC_IMG,LON_CIRC_IMG,LAT_ELLI_IMG,LON_ELLI_IMG,DIAM_CIRC_IMG,DIAM_CIRC_SD_IMG,
DIAM_ELLI_MAJOR_IMG,DIAM_ELLI_MINOR_IMG,DIAM_ELLI_ECCEN_IMG,DIAM_ELLI_ELLIP_IMG,DIAM_ELLI_ANGLE_IMG,
LAT_ELLI_SD_IMG,LON_ELLI_SD_IMG,DIAM_ELLI_MAJOR_SD_IMG,DIAM_ELLI_MINOR_SD_IMG,DIAM_ELLI_ANGLE_SD_IMG,
DIAM_ELLI_ECCEN_SD_IMG,DIAM_ELLI_ELLIP_SD_IMG,ARC_IMG,PTS_RIM_IMG
```

First data row: `00-1-000000,-19.8304,264.757,-19.8905,264.665,940.96,21.3179,975.874,905.968,0.371666,1.07716,
35.9919,0.00788792,0.00842373,0.63675,0.560417,0.373749,0.00208495,0.000968482,0.568712,8088`.
**There is no depth column.** Depth is measured from LOLA in PR 2.

### 3.6 Reference numbers for unit tests (computed with the code of this document)

- Rank order centroid weights: n = 3 → `[0.6111, 0.2778, 0.1111]`; n = 4 → `[0.5208, 0.2708, 0.1458, 0.0625]`;
  n = 5 → `[0.4567, 0.2567, 0.1567, 0.0900, 0.0400]`.
- `utility([4, 5, 7.5, 10, 12], limit=10, ideal=5)` → `[1, 1, 0.5, 0, 0]`;
  `utility([0.2, 0.5, 0.65, 0.8, 0.9], limit=0.5, ideal=0.8)` → `[0, 0, 0.5, 1, 1]`.
- `horizon_floor_deg(top_m, h_min_m, ray_distances(240.0, max_m, 1.02))` (degrees):

  | top_m | h_min_m | max_m = 150 000 | max_m = 1 000 000 | −arccos((R+h_min)/(R+top)) |
  | --- | --- | --- | --- | --- |
  | 2000 | 0 | −2.7479 | −2.7479 | −2.7479 |
  | 2000 | −9608 | −6.8986 | −6.6233 | −6.6231 |
  | 7524 | −9608 | −8.9749 | −8.0356 | −8.0354 |
  | 0 | −9608 | −6.1420 | −6.0285 | −6.0284 |
  | 2 | 0 | −0.0869 | −0.0869 | −0.0869 |

  (Truncating rays at 150 km lowers the floor: the engine's sampled horizons can be lower than the physical
  limit, so the floor must use the same ray samples as the engine. See 6.2.)
- Greedy site picking on a 10 × 10 grid of 1 km cells, scores 1.0 at (2,2), 0.99 at (2,3), 0.7 at (0,9),
  0.5 at (8,8), min separation 3 km, k = 3 → picks `[(2,2), (0,9), (8,8)]`.
- Bounded exact distance transform: 900 × 900 raster, cap 104 cells: 0.12 s; equals brute force on 30 random
  cases.

---

## 4. Architecture

### 4.1 Data flow

```
Browser (mission design panel)
  GET  /api/v1/suitability/criteria   -> catalogue of criteria (groups A-I, units, roles, params, coverage,
                                         unavailable ones with the reason)
  POST /api/v1/suitability/search     -> raster: codes, score, one utility layer per preference, limiting
                                         factor, funnel, bound info, top-k sites with pros/cons
  (weights change)                    -> recompute score in the browser from the utility layers, repaint
API
  routers/suitability.py  -> suitability_search.search(store, req)   (glue; imports helpers from area_search)
                              logic/bounds.py      (ephemeris bound, pure)
                              logic/suitability.py (catalogue, validation, utilities, weights, EDT, min
                                                    filter, site picking, pros/cons; pure)
                              logic/areas.py       (dilate, quadtree_samples; existing, imported)
                              db/nomenclature.py   (IAU features; new)
                              db/craters.py        (+ shape arrays from PR 2; additive)
```

### 4.2 Cell codes (uint8)

| Code | Meaning | Set by |
| --- | --- | --- |
| 0 | Outside the region | setup |
| 1 | Fails a static (map) criterion or the landing radius | stages geometry, regional, medium, fine, landing_radius |
| 2 | Fails a window criterion (sampled with a traced horizon) | stage window |
| 3 | Viable | final |
| 4 | Unknown: some active hard criterion has no data there and `unknown_passes` is false | any stage |
| 5 | Proven to fail a window criterion by the ephemeris bound (no sampling needed) | stage bound |

**Precedence (order-independent):** a cell that fails anything is failed (1, 2 or 5; the first stage that failed
it, in the fixed stage order). Only a cell that fails nothing and lacks data somewhere is 4. To make this hold
whatever the order, **unknown cells stay alive** and keep being evaluated by later criteria (this differs from
`area_search.py`, where unknown cells stop being evaluated).

### 4.3 Stages (fixed order)

| # | Stage | Criteria | How a cell is decided |
| --- | --- | --- | --- |
| 0 | `geometry` | `side`, `landing_distance_km`, `target_distance_km` | exact per cell |
| 1 | `bound` | the **hard** window criteria (see 8.2), only if `use_bounds` | conservative tile bound: proven fails only |
| 2 | `regional` | `hydrogen_ppm`, `psr_distance_km`, `crater_density_per_km2`, `elongated_crater_density_per_km2` | per cell |
| 3 | `medium` | `elevation_m`, `permanent_shadow_fraction`, `long_term_sun`, `long_term_earth`, `sky_sr`, `dose_mgy`, `host_crater_depth_m` | per cell |
| 4 | `fine` | `slope_deg`, `rim_distance_km` | per cell |
| 5 | `landing_radius` | request `landing_radius_km` | dilation of code-1 cells |
| 6 | `window` | the window criteria (hard and soft) | `quadtree_samples` over alive cells |
| 7 | `sites` | top-k | exact engine at each candidate |

Inside stages 2, 3 and 4, hard criteria run in **descending estimated kill rate** (estimated on a 1/16
subsample), ties by id; the order used is reported. Only hard (and both) criteria eliminate cells in stages 0-6;
soft-only criteria are computed after stage 6, on the cells still alive.

---

## 5. Pull request plan

| PR | Branch | Content | Depends on |
| --- | --- | --- | --- |
| 1 | `feat/<role>-visibility-bound` | `api/app/logic/bounds.py`, tests, validation script, method doc | — |
| 2 | `feat/<role>-crater-shape` | Robbins ellipse columns + LOLA crater depth (pipeline, data, db, docs) | — |
| 3 | `feat/<role>-suitability-api` | `/suitability/criteria` + `/suitability/search`, nomenclature repo, gzip | PR 1 merged (PR 2 optional: shape criteria appear only when its data exists) |
| 4 | `feat/<role>-mission-design-web` | picker, roles, weights, heatmap modes, top sites, favourites, radar | PR 3 merged; owners' agreement |
| 5+ | one branch each | gated items (section 10) | each gate's check |

---

## 6. PR 1 — the ephemeris visibility bound (`api/app/logic/bounds.py`)

### 6.1 Statement and proof (put this in the module docstring and in `docs/data-and-computation.md`)

Observer O at radius `r_o = R + top`, `top` = ground height + mast (m). Every terrain point has radius at least
`r_s = R + h_min`. The engine's skyline in an azimuth is the maximum, over the ray samples `d_i` (surface
distance), of the elevation of the terrain point at `d_i`
(`logic.horizon.skyline_from_heights`). The elevation of a point at central angle `θ_i = d_i / R` and radius
`r` is `atan((r cos θ_i − r_o) / (r sin θ_i))`, increasing in `r`. So the skyline is at least
`floor = max_i atan((r_s cos θ_i − r_o) / (r_s sin θ_i))`, whatever the terrain. A body whose highest point is
below `floor` is hidden for sure. If the engine had infinite rays this floor tends to `−arccos(r_s / r_o)` (the
tangent to the lowest sphere), so the same floor is also a physical bound. For a tile, the local vertical of any
cell differs from the tile centre's by at most the central angle `θ_tile` of the half-diagonal, so the elevation
of a body at any cell is at most the centre value plus `θ_tile`.

**Possible visibility at a sample:** `el_centre + ang_radius + θ_tile + MARGIN_DEG > floor(top_tile)`, where
`top_tile` is the highest ground height in and around the tile plus the mast plus `ELEV_MARGIN_M`, and
`h_min = min(grid minima) − ELEV_MARGIN_M`. If it is false at a sample, no part of the body is visible from any
cell of the tile at that sample, for any terrain consistent with the grids.

Everything derived (upper bound of a visible share, lower bound of a longest hidden run, upper bound of the run
from the start) follows sample by sample on the same time grid as the engine (`engine.time_grid`).

Constants (method parameters):

```python
ELEV_MARGIN_M = 500.0   # measured: 960 m grid misses up to 329 m of peak and 337 m of floor (3.4); margin above
MARGIN_DEG = 0.05       # angle margin: Earth parallax over a tile (< 0.005 deg at 30 km), float32 ephemeris,
                        # disc sampling of the engine (7 slices), ray sample spacing near the optimum (< 0.001 deg)
```

### 6.2 Code (copy into `api/app/logic/bounds.py`)

```python
"""Conservative bound on the visibility of the Sun and the Earth over whole tiles of the surface, from the
ephemeris and the elevation range alone: proves where a window criterion must fail, so those tiles are dropped
before any horizon is traced. Pure NumPy, no I/O.

<paste the statement and proof of section 6.1 here, in English>
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .constants import EARTH_R_KM, MOON_R_KM, SUN_R_KM

R_M = MOON_R_KM * 1000.0
ELEV_MARGIN_M = 500.0
MARGIN_DEG = 0.05


def horizon_floor_deg(top_m, h_min_m: float, ray_dist_m: np.ndarray) -> np.ndarray:
    """Lowest skyline (degrees) that terrain at or above h_min_m can give an observer whose eye is top_m above the
    sphere, when the skyline is the maximum over the ray samples ray_dist_m (as skyline_from_heights)."""
    top = np.atleast_1d(np.asarray(top_m, dtype=np.float64))
    theta = np.asarray(ray_dist_m, dtype=np.float64) / R_M
    r_s = R_M + float(h_min_m)
    r_o = R_M + top
    ratio = (r_s * np.cos(theta)[None, :] - r_o[:, None]) / (r_s * np.sin(theta)[None, :])
    return np.degrees(np.arctan(ratio.max(axis=1)))


def unit_vectors(lat_deg, lon_deg) -> np.ndarray:
    la, lo = np.radians(np.asarray(lat_deg, float)), np.radians(np.asarray(lon_deg, float))
    return np.stack([np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)], axis=-1)


def body_elevation_and_radius(up: np.ndarray, body_km: np.ndarray, body_radius_km: float) -> tuple[np.ndarray, np.ndarray]:
    """Centre elevation above the local horizontal of the sphere, and angular radius, degrees, for points with
    unit vectors up (m, 3) on the sphere and body positions body_km (T, 3) from the Moon centre.
    Returns (m, T) arrays. The site position is subtracted (Earth parallax)."""
    pos = up * MOON_R_KM                                   # (m, 3) km
    v = body_km[None, :, :] - pos[:, None, :]              # (m, T, 3)
    dist = np.linalg.norm(v, axis=-1)
    el = np.degrees(np.arcsin(np.clip(np.einsum("mtk,mk->mt", v, up) / dist, -1.0, 1.0)))
    rad = np.degrees(np.arcsin(np.clip(body_radius_km / dist, 0.0, 1.0)))
    return el, rad


def possible_visible(el_deg: np.ndarray, rad_deg: np.ndarray, theta_deg: np.ndarray, floor_deg: np.ndarray) -> np.ndarray:
    """(m, T) True where some part of the body may be visible from some cell of the tile."""
    return el_deg + rad_deg + theta_deg[:, None] + MARGIN_DEG > floor_deg[:, None]


def longest_run(flags: np.ndarray) -> np.ndarray:
    """Longest run of True along the last axis (samples), per row."""
    f = np.asarray(flags, dtype=bool)
    idx = np.arange(f.shape[-1])
    last_false = np.maximum.accumulate(np.where(~f, idx, -1), axis=-1)
    return np.where(f, idx - last_false, 0).max(axis=-1)


def run_from_start(flags: np.ndarray) -> np.ndarray:
    """Samples from the start until the first False, per row (all when never False, 0 when it starts False)."""
    f = np.asarray(flags, dtype=bool)
    return np.where(f.all(axis=-1), f.shape[-1], np.argmin(f, axis=-1))


@dataclass(frozen=True)
class TileBounds:
    """Per tile (arrays of length m). Upper bounds (ub) can only overestimate the true value at any cell of the
    tile, lower bounds (lb) only underestimate it."""
    sun_share_ub: np.ndarray
    dark_lb_h: np.ndarray
    light_left_ub_h: np.ndarray
    earth_share_ub: np.ndarray
    blackout_lb_h: np.ndarray
    contact_left_ub_h: np.ndarray
    both_share_ub: np.ndarray
    sun_el0_min: np.ndarray
    sun_el0_max: np.ndarray
    earth0_possible: np.ndarray


def tile_bounds(lat_deg: np.ndarray, lon_deg: np.ndarray, theta_deg: np.ndarray, top_m: np.ndarray, h_min_m: float,
                ray_dist_sets: list[np.ndarray], sun_km: np.ndarray, earth_km: np.ndarray, step_h: float,
                chunk: int = 4000) -> TileBounds:
    """Bounds for m tiles (centre lat/lon, half-diagonal central angle theta_deg, highest eye height top_m with the
    mast and the margin already added) over T samples (sun_km, earth_km: (T, 3) km). The floor is the lowest over
    every ray sample set the engine may use (ray_dist_sets). NaN top_m -> no bound (everything possible)."""
    m = lat_deg.size
    out = {k: np.empty(m) for k in ("ss", "dk", "ll", "es", "bo", "cl", "bs", "e0n", "e0x")}
    e0p = np.empty(m, dtype=bool)
    for a in range(0, m, chunk):
        s = slice(a, min(m, a + chunk))
        up = unit_vectors(lat_deg[s], lon_deg[s])
        th = np.asarray(theta_deg[s], float)
        top = np.asarray(top_m[s], float)
        known = ~np.isnan(top)
        floor = np.full(top.shape, -90.0)
        if known.any():
            floor[known] = np.min([horizon_floor_deg(top[known], h_min_m, d) for d in ray_dist_sets], axis=0)
        el_s, r_s = body_elevation_and_radius(up, sun_km, SUN_R_KM)
        el_e, r_e = body_elevation_and_radius(up, earth_km, EARTH_R_KM)
        ps = possible_visible(el_s, r_s, th, floor)
        pe = possible_visible(el_e, r_e, th, floor)
        out["ss"][s] = ps.mean(axis=1)
        out["dk"][s] = longest_run(~ps) * step_h
        out["ll"][s] = run_from_start(ps) * step_h
        out["es"][s] = pe.mean(axis=1)
        out["bo"][s] = longest_run(~pe) * step_h
        out["cl"][s] = run_from_start(pe) * step_h
        out["bs"][s] = (ps & pe).mean(axis=1)
        out["e0n"][s] = el_s[:, 0] - th - MARGIN_DEG
        out["e0x"][s] = el_s[:, 0] + th + MARGIN_DEG
        e0p[s] = pe[:, 0]
    return TileBounds(out["ss"], out["dk"], out["ll"], out["es"], out["bo"], out["cl"], out["bs"], out["e0n"],
                      out["e0x"], e0p)
```

Notes for the implementer:

- `sun_el0`: the engine's `sun_el` is the geometric elevation of the disc centre above the sphere's local
  horizontal; terrain does not change it. So `[e0n, e0x]` is a two-sided exact interval for any cell of the tile.
- `comms` in the engine needs `earth_frac >= comms_min_fraction` with `comms_min_fraction > 0` (schema), so "any
  part possible" is a valid superset for contact.
- Memory: a chunk of 4000 tiles × T samples × 3 floats; for T = 9601 (400 days hourly) reduce `chunk` to
  `max(1, 40_000_000 // (T * 3))`. Do this inside the function (compute `chunk = min(chunk, max(1, 40_000_000 //
  (3 * T)))`).

### 6.3 Tests: `api/tests/test_bounds.py`

Write these tests (names are suggestions; all must exist):

1. `test_floor_matches_reference_table`: the five rows of 3.6 with `ray_distances(240.0, max_m, 1.02)` from
   `app.logic.horizon`; tolerance 1e-3 deg.
2. `test_floor_is_below_every_skyline_of_terrain_at_h_min`: for random ray heights `h >= h_min` (uniform between
   h_min and h_min + 15 km, 50 random rays, `ray_distances(960.0, 150_000.0, 1.02)`), the output of
   `skyline_from_heights(dist, heights, ground_m, mast_m)` is ≥ `horizon_floor_deg(ground_m + mast_m, h_min,
   dist)` for ground_m in {−5000, 0, 3000, 7000}.
3. `test_longest_run_and_run_from_start`: `[[1,1,0,1,1,1,0],[0]*7,[1]*7]` → longest runs `[3, 0, 7]`, run from
   start `[2, 0, 7]`.
4. `test_bound_is_never_optimistic_against_lola_masks`: port of section 6.4 sampled **every 6th hour** of
   2025-2035 (to keep the suite fast), at the 221 zone points, theta = 0, `top = groundHeightM + 2 + ELEV_MARGIN_M`,
   `h_min = min(grid minima) − ELEV_MARGIN_M`, floor from both ray sets used by the engine (240 m and 960 m cells,
   150 km; these floors are below the physical tangent floor −arccos(r_s / r_o), so they also cover the pipeline's
   175 km masks): assert 0 samples where the real mask shows
   any part of the body and `possible_visible` is False. Real visibility: `el + true_radius > mask(az)` with the
   mask read at the nearest of 720 azimuths, `true_radius` from the distance.
5. `test_tile_bound_contains_every_cell`: pick 3 tiles (centres at 75 S 0 E, 84 S 60 E, 88 S −120 E; 16 cells of
   960 m), compute `tile_bounds` for a 14-day window from 2027-01-10 hourly; for each of the 256 cells of the tile
   compute `body_elevation_and_radius` at the cell itself with theta = 0 and its own top: assert per sample that
   `possible(cell) ⇒ possible(tile)`, and that the cell's sun_el0 lies in `[e0n, e0x]`.
6. `test_engine_samples_respect_the_floor`: for 20 cells drawn with a fixed seed inside a 30 km disc around
   (−85.5, 30), trace the horizon with `app.area_search._sample_horizon` (azimuth step 2°, radius 150 km;
   ground from `_finest_xy(store, ELEVATION_GRIDS, x, y, True)`) and assert every value of the returned
   `HorizonProfile.values` ≥ the floor for that cell (top = ground + mast + margin, both ray sets).
7. `test_elevation_margin_still_covers_the_grids`: recompute section 3.4 (vectorised with `np.maximum.at` /
   `np.minimum.at` as below) and assert both maxima < 450 m.

```python
# section 3.4 measurement (put in the test)
from app.db.store import get_store
g = get_store().grids
fine, mf = g.float_array("lola_elevation_80s"), g.meta("lola_elevation_80s")
coarse, mc = g.float_array("lola_elevation_60s"), g.meta("lola_elevation_60s")
n = fine.shape[0]
xs = mf["xLeftM"] + (np.arange(n) + 0.5) * mf["pixelM"]
ys = mf["yTopM"] - (np.arange(n) + 0.5) * mf["pixelM"]
X, Y = np.meshgrid(xs, ys)
col = np.floor((X - mc["xLeftM"]) / mc["pixelM"]).astype(int)
row = np.floor((mc["yTopM"] - Y) / mc["pixelM"]).astype(int)
mx = np.full(coarse.shape, -np.inf); mn = np.full(coarse.shape, np.inf); cnt = np.zeros(coarse.shape, int)
np.maximum.at(mx, (row.ravel(), col.ravel()), fine.ravel())
np.minimum.at(mn, (row.ravel(), col.ravel()), fine.ravel())
np.add.at(cnt, (row.ravel(), col.ravel()), 1)
full = cnt == 16
assert (mx - coarse)[full].max() < 450 and (coarse - mn)[full].max() < 450
```

For test 4, the zone layout is `[terrainSite][zonePoint][azimuth]` int16 hundredths of a degree, 13 × 17 × 720;
zone points and ground heights are in `data/sites.json` (`terrain.zone.points[*].lat/lon/groundHeightM`), sites
in file order filtered by `terrain.available`. Local azimuth: east = normalize(z × up), north = up × east,
az = atan2(v·east, v·north) mod 360 (same as `logic.geometry.site_frame`).

### 6.4 Validation script: `api/tests/validation_bounds.py` (run by hand, like `sw1_validation.py`)

Same as test 4 but **every hourly sample** of 2025-2035, printing per site the true visible share, the bound share
and the number of violations, then the totals and the smallest margin (real mask minus floor). Then the discard
table of 3.2 recomputed with the final constants (tiles of 61.44, 30.72, 7.68, 3.84 km over the whole cap south of
60 S, tile top from the 960 m grid max over the tile and its ring + mast 2 m + margin). Run:

```
cd api
uv run python tests/validation_bounds.py
```

Pass criteria: 0 violations for both bodies; smallest margin ≥ 1.5°; discard shares within ±3 percentage points of
section 3.2 or lower (the final bound is more conservative, so lower is allowed; higher than +3 points is a bug).
Paste the output in the PR and in `docs/data-and-computation.md` (new section "Ephemeris visibility bound").

### 6.5 Docs and done (PR 1)

- `docs/data-and-computation.md`: new section with the statement, the proof, the constants and their
  justification, the validation output, the discard table and the limitation (no discard within ~5° of the pole).
- `docs/endpoints.md`: add a section "`<ROLE>` · Mission design: suitability search" with Status "in progress
  (PR 1: bound)" and the file list of PRs 1-3 (it is your own section; this is allowed).
- No `CLAUDE.md` change (no endpoint yet).
- Done when: `uv run pytest -q` passes; validation script output pasted; PR opened after **ASK**.

---

## 7. PR 2 — crater shape: ellipse columns and LOLA depth

### 7.1 Pipeline: `pipeline/lunarnav/crater_shape.py` (new; do not change the existing `craters.npz` layout)

1. Reuse `craters._ensure_zip()` (import it) to get the zip.
2. Read the PDS label `lunar_crater_database_robbins_2018_bundle/data/lunar_crater_database_robbins_2018.xml` from
   the zip and print the `<name>`, `<unit>` and `<description>` of the fields `DIAM_ELLI_MAJOR_IMG`,
   `DIAM_ELLI_MINOR_IMG`, `DIAM_ELLI_ANGLE_IMG`, `DIAM_ELLI_ELLIP_IMG`, `DIAM_ELLI_ECCEN_IMG`, `ARC_IMG`. Copy those
   definitions verbatim into the JSON sidecar (`fields`). If the angle's reference direction (from east or north,
   which sense) is not stated, set `"angleUsable": false` and never use the angle downstream.
3. Read the CSV with `csv.reader` (some ellipse fields may be empty → NaN; do not use `np.loadtxt`). Keep for every
   row with a valid circle fit (same `keep` rule and the **same order** as `craters.build()`: filter, move longitude
   to −180..180, stable sort by latitude) the arrays:
   `ell_major_km`, `ell_minor_km`, `ell_angle_deg`, `ellipticity` (DIAM_ELLI_ELLIP_IMG), `eccentricity`,
   `arc_fraction` (ARC_IMG), all float32. Assert that the re-derived `lat`, `lon`, `diam_km` equal the arrays in
   `data/craters/robbins_2018.npz` exactly (same build rule ⇒ same order); stop with an error otherwise.
4. Depth from LOLA, only south of 60 S, written as `depth_m` (float32, NaN where not measured):
   - grid: `lola_elevation_80s` (240 m) where the whole crater (centre ± 1.2 R) is inside it, else
     `lola_elevation_60s` (960 m); read with rasterio-free NumPy from `data/grids/*.npz` (scale and nodata from
     `grids.json`);
   - measured only if `D ≥ 10 × pixel` (2.4 km on the 240 m grid, 9.6 km on the 960 m grid), else NaN;
   - rim height = median of the elevations at 72 azimuths on the circle of radius R (= D/2) around the centre,
     bilinear; floor height = minimum of the grid pixels whose centres lie within 0.5 R of the centre;
     `depth_m = rim − floor`; NaN if any of the 72 rim samples or all floor pixels are nodata;
   - distances on the sphere: place the rim points with `destination` (great circle) and project with the south
     polar stereographic formulas of `data/README.md`.
5. Write `data/craters/robbins_2018_shape.npz` (arrays aligned 1:1 with `robbins_2018.npz`) and
   `data/craters/crater_shape.json`: format, file, count, fields (copied definitions), `angleUsable`, depth method
   (grid choice, D ≥ 10 px rule, rim and floor definitions), counts of craters with depth by grid, build date,
   source and citation as in `craters.json`.
6. Command: `cd pipeline && uv run python -m lunarnav.crater_shape`.
7. Keep the committed file small: if `robbins_2018_shape.npz` is larger than 15 MB, store only the craters south of
   55 S plus an `index` int32 array into the main arrays (document it in the sidecar).

### 7.2 Validation of the depth (pipeline test `pipeline/tests/test_crater_shape.py`)

- Parsing: a 3-row CSV fixture written in the test (header of 3.5, the first data row of 3.5, a row with empty
  ellipse fields) → the parser returns the right floats and NaN.
- Depth on a synthetic cone: a 200 × 200 grid of 240 m pixels with a paraboloid crater of D = 9.6 km, depth 1.8 km
  below a flat 0 m plain with a 100 m rim → `depth_m` within 5 % of 1 900 m (rim 100 − floor −1 800).
- Real case: Shackleton (catalogue entry nearest −89.67, 129.78 with D between 19 and 23 km): **ASK** the person
  for the published rim-to-floor depth from Zuber et al. (2012), Nature 486, 378-381 (or read the abstract if
  accessible) and assert agreement within 20 %. Record the published number and the measured one in the sidecar
  and in `docs/data-and-computation.md`.
- Distribution check printed (not asserted): median d/D by diameter bin (2.4-5, 5-10, 10-20, 20-50 km); expect
  values well below 0.2 for the larger bins (fresh simple craters are near 0.2, Pike 1977; degraded ones less).

### 7.3 API data access (additive)

In `api/app/db/craters.py` add (do not change existing methods):

```python
    @property
    def shape_available(self) -> bool:
        return (self._dir / "crater_shape.json").exists()

    def _load_shape(self) -> dict[str, np.ndarray]:
        """Shape arrays aligned with _load() (ellipse fit from Robbins 2018, depth measured on LOLA); empty dict
        when the file is missing."""
        if getattr(self, "_shape", None) is None:
            path = self._dir / "robbins_2018_shape.npz"
            self._shape = {}
            if path.exists():
                with np.load(path) as z:
                    self._shape = {k: z[k] for k in z.files}
        return self._shape
```

If 7.1 step 7 stored a subset, add the `index` handling here and document it.

### 7.4 Docs and done (PR 2)

`data/README.md` (new file row + caveats: depth only for D ≥ 10 px south of 60 S; angle usable or not),
`docs/references.md` (Robbins already listed: add "ellipse fit columns"; add Pike 1977 if quoted, Zuber et al.
2012), test output pasted. No endpoint, no `CLAUDE.md` change.

---

## 8. PR 3 — the suitability API

Files (new unless marked): `api/app/schemas/suitability.py`, `api/app/logic/suitability.py`,
`api/app/suitability_search.py`, `api/app/routers/suitability.py`, `api/app/db/nomenclature.py`,
`api/app/db/store.py` (additive: one field), `api/app/main.py` (additive: router + GZip),
`api/tests/test_suitability_logic.py`, `api/tests/test_suitability.py`, `api/tests/bench_suitability.py`.

### 8.1 Logic helpers (`api/app/logic/suitability.py`, pure)

Copy these, tested in 3.6:

```python
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


def score_from_quantized(q: list[np.ndarray], w: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """score = sum w_i (q_i / 250) / sum w_i over the criteria with data (q != 255); coverage = sum of those w_i /
    sum w_i. Summation in the list order, float64. No criteria -> score 1, coverage 1. No data at all -> 0, 0."""
    if not q:
        return None, None   # caller: score = 1 everywhere, coverage = 1
    num = np.zeros(q[0].shape); den = np.zeros(q[0].shape)
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
            hi = [slice(None)] * 2; lo = [slice(None)] * 2
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
```

(`pick_sites` takes the candidates in a Python loop; it stops after k picks, and the distance check is against at
most k points, so it is fast as long as the loop breaks early. Pass at most 200 000 candidates: if more, keep the
200 000 best by score first with `np.argpartition`.)

Pros and cons (pure):

```python
def pros_cons(entries: list[dict], n: int = 3) -> tuple[list[str], list[str]]:
    """entries: one dict per soft/both criterion at the site with keys id, utility (float or None), weight.
    Pros: utility >= 0.5, by weight * utility desc. Cons: utility < 0.5, by weight * (1 - utility) desc.
    0.5 is the midpoint between the limit and the ideal the planner typed."""
    known = [e for e in entries if e["utility"] is not None]
    pros = sorted((e for e in known if e["utility"] >= 0.5), key=lambda e: (-e["weight"] * e["utility"], e["id"]))
    cons = sorted((e for e in known if e["utility"] < 0.5), key=lambda e: (-e["weight"] * (1 - e["utility"]), e["id"]))
    return [e["id"] for e in pros[:n]], [e["id"] for e in cons[:n]]
```

Hard test (pure):

```python
def passes(kind: str, better: str | None, x: np.ndarray, c) -> np.ndarray:
    """c: the CriterionInput. value: better higher -> x >= limit, lower -> x <= limit. range: min <= x <= max (either
    may be None). choice / flag: evaluated by the evaluator itself (x is 1.0 for pass, 0.0 for fail)."""
    with np.errstate(invalid="ignore"):
        if kind == "value":
            return x >= c.limit if better == "higher" else x <= c.limit
        if kind == "range":
            ok = np.ones(np.shape(x), bool)
            if c.min is not None: ok &= x >= c.min
            if c.max is not None: ok &= x <= c.max
            return ok
        return x > 0.5
```

### 8.2 The criteria catalogue (in `logic/suitability.py`)

```python
@dataclass(frozen=True)
class ParamSpec:
    key: str
    label: str
    unit: str | None
    kind: Literal["number", "choice", "text"]
    min: float | None = None
    max: float | None = None
    options: tuple[str, ...] = ()
    required: bool = True


@dataclass(frozen=True)
class CriterionSpec:
    id: str
    group: str            # letter A..I
    label: str
    unit: str | None
    kind: Literal["value", "range", "choice", "flag"]
    better: Literal["higher", "lower"] | None
    roles: tuple[str, ...]            # subset of ("hard", "soft", "both")
    stage: Literal["geometry", "regional", "medium", "fine", "window"]
    params: tuple[ParamSpec, ...]
    coverage: str          # where data exists, in words
    source: str            # dataset ids / citation
    tip: str               # what it checks, one sentence
    bounded: bool = False  # the ephemeris bound can prove a fail (window criteria only)
    needs_shape: bool = False   # needs PR 2 data
```

Groups: A Search area, B Terrain and landing, C Light and power, D Earth contact, E Temperature, F Radiation,
G Mission window, H Colony, I Science.

The catalogue (all roles listed are allowed; "V" = `value`, "R" = `range`, "C" = `choice`, "F" = `flag`):

| id | grp | label | unit | kind | better | roles | stage | params | computation (glue) | coverage |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `side` | A | Near or far side | – | C | – | hard | geometry | `side` ∈ {near, far} | `abs(clon) <= 90` near (as `area_search`) | everywhere |
| `landing_distance_km` | A | Away from past landings | km | V | higher | hard, soft, both | geometry | – | min `great_circle_km` to `measured_landings(store.data_dir)` | everywhere |
| `target_distance_km` | A | Near a named feature | km | V | lower | hard, soft, both | geometry | `feature` text (exact IAU name, case-insensitive) | `great_circle_km` to the feature centre (`db/nomenclature.py`); 422 if the name is unknown | everywhere |
| `slope_deg` | B | Slope | deg | V | lower | hard, soft, both | fine | – | sub-grid **max** of `SLOPE_GRIDS` (as `area_search`) | south of 60 S |
| `elevation_m` | B | Elevation range | m | R | – | hard | medium | – (uses `min`, `max`) | sub-grid **mean**, bilinear, `ELEVATION_GRIDS` | south of 60 S |
| `crater_density_per_km2` | B | Crater density | 1/km² | V | lower | hard, soft, both | regional | `radius_km` (0 < r ≤ 50), `min_diam_km` (> 0) | `area_search.crater_density` | catalogue global, raster south of 60 S |
| `rim_distance_km` | B | Away from crater rims | km | V | higher | hard, soft, both | fine | `min_diam_km` (> 0) | `area_search.rim_distance_km(..., within_km=max(limit, ideal or limit))`; values equal to the cap mean "at least the cap" | idem |
| `permanent_shadow_fraction` | B | Permanent shadow in the cell | 0-1 | V | lower | hard, soft, both | medium | – | sub-grid **max** of `permanent_shadow_65s` | south of 65 S |
| `host_crater_depth_m` | B | Depth of the crater the site is in | m | V | lower | hard, soft, both | medium | `min_diam_km` | deepest measured `depth_m` among craters ≥ min_diam containing the cell centre; 0 if inside none; NaN if inside one whose depth is NaN | south of 60 S; needs PR 2 |
| `elongated_crater_density_per_km2` | B | Elongated craters nearby | 1/km² | V | lower | hard, soft, both | regional | `radius_km`, `min_diam_km`, `min_ellipticity` (> 1) | same counting as `crater_density` but only craters with `ellipticity >= min_ellipticity` (often secondary craters) | needs PR 2 |
| `long_term_sun` | C | Long-term sunlight | 0-1 | V | higher | hard, soft, both | medium | – | sub-grid **mean** of `sun_illumination_65s` | south of 65 S |
| `sunlit_fraction` | C | Sunlight during the mission | 0-1 | V | higher | hard, soft, both | window | – | window sample `sunlit` | south of 60 S |
| `longest_dark_h` | C | Longest darkness | h | V | lower | hard, soft, both | window | – | `dark` | idem |
| `light_left_h` | C | Light left after landing | h | V | higher | hard, soft, both | window | – | `light_left` | idem |
| `mean_power_w_m2` | C | Mean solar power | W/m² | V | higher | hard, soft, both | window | – | `power` (panel from request) | idem |
| `long_term_earth` | D | Long-term Earth view | 0-1 | V | higher | hard, soft, both | medium | – | sub-grid **mean** of `earth_visibility_65s` | south of 65 S |
| `comms_fraction` | D | Direct-to-Earth time | 0-1 | V | higher | hard, soft, both | window | – | `comms` | south of 60 S |
| `longest_blackout_h` | D | Longest blackout | h | V | lower | hard, soft, both | window | – | `blackout` | idem |
| `contact_left_h` | D | Contact left after landing | h | V | higher | hard, soft, both | window | – | `contact_left` | idem |
| `both_fraction` | D | Sun and Earth together | 0-1 | V | higher | hard, soft, both | window | – | `both` | idem |
| `sun_el_at_landing_deg` | G | Sun height at landing | deg | R | – | hard | window | – (uses `min`, `max`) | `sun_el0` | idem |
| `earth_at_landing` | G | Earth in view at landing | – | F | – | hard | window | – | `earth0 > 0.5` | idem |
| `sky_sr` | F | Open sky (terrain shielding) | sr | V | lower | hard, soft, both | medium | – | sub-grid **mean** of `sky_visibility_65s` | south of 65 S |
| `dose_mgy` | F | Cosmic-ray dose over the window | mGy | V | lower | hard, soft, both | medium | – | `rate * sky / FULL_SKY_SR * duration_h / 24` (as `area_search`) | south of 65 S |
| `psr_distance_km` | I | Distance to permanent shadow | km | V | lower | hard, soft, both | regional | – | see 8.4.4 | south of 65 S |
| `hydrogen_ppm` | I | Hydrogen | ppm | V | higher | hard, soft, both | regional | – | sub-grid **mean** of `lp_hydrogen_60s` | south of 60 S (78.5 % valid) |

`bounded = True` for: `sunlit_fraction`, `longest_dark_h`, `light_left_h`, `comms_fraction`,
`longest_blackout_h`, `contact_left_h`, `both_fraction`, `sun_el_at_landing_deg`, `earth_at_landing`
(not `mean_power_w_m2`). `needs_shape = True` for `host_crater_depth_m` and `elongated_crater_density_per_km2`:
they are listed as unavailable ("needs the crater shape dataset") when `store.craters.shape_available` is false.

Tips (`tip`) are one sentence each; reuse the wording of `web/src/panels/missionFilters.ts` where the criterion
exists there.

Unavailable criteria (listed by the criteria endpoint with `available: false` and the reason; never accepted by
the search, 422 if sent):

| id | reason |
| --- | --- |
| `roughness` | "The LOLA roughness map (PGDA 90, LDRM_80S_1000MPP) has no confirmed units yet." |
| `rocks` | "No open boulder or rock-abundance map is loaded for the pole." |
| `regolith_density` | "No regolith density or compaction map is loaded (candidate: Diviner H-parameter, to verify)." |
| `temperature` | "The thermal model runs on one spot: open a site, then the Power panel." |
| `battery` | "Sized on one spot: open a site, then the Power panel." |
| `colony` | "Sized on one spot: open a site, then Colony in the Power panel." |
| `link_margin` | "Needs a radio link budget (antenna, power, frequency)." |
| `solar_storm_risk` | "No forecast of solar particle events exists for a future window." |
| `north_pole` | "The polar grids cover the south pole only (north polar grids are not built)." |

Fixed inputs (always active, cannot be removed; listed in `fixed_inputs` of the criteria response): `region`
("Search region": centre and radius) and `window` ("Mission window": start and duration).

### 8.3 Schemas (`api/app/schemas/suitability.py`)

```python
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from .areas import GridInfo, WindowInfo

Role = Literal["hard", "soft", "both"]


class SuitabilityRegion(BaseModel):
    center_lat: float = Field(ge=-90.0, le=-60.0, description="Centre of the search disc, degrees (south of 60 S: the LOLA grids)")
    center_lon: float = Field(ge=-180.0, le=360.0, description="Centre longitude, degrees east")
    radius_km: float = Field(gt=0.0, le=400.0, description="Radius of the search disc, km")


class CriterionInput(BaseModel):
    id: str = Field(description="Criterion id from GET /api/v1/suitability/criteria")
    role: Role = Field(description="hard: a cell beyond the limit is out; soft: only changes the score; both: out beyond the limit and scored between limit and ideal")
    limit: float | None = Field(None, description="Worst acceptable value, in the criterion unit (value criteria): hard test and utility 0")
    ideal: float | None = Field(None, description="Value that earns full marks (utility 1), in the criterion unit (soft and both)")
    min: float | None = Field(None, description="Lowest allowed value (range criteria), criterion unit")
    max: float | None = Field(None, description="Highest allowed value (range criteria), criterion unit")
    choice: str | None = Field(None, description="Chosen option (choice criteria, e.g. side: near or far)")
    params: dict[str, float | str] = Field(default_factory=dict, description="Criterion parameters (see the catalogue), units in the catalogue")


class Weighting(BaseModel):
    mode: Literal["rank", "percent"] = Field(description="rank: weights by rank order centroid from `order`; percent: the given shares, normalised")
    order: list[str] | None = Field(None, description="rank mode: every soft/both criterion id, most important first")
    percent: dict[str, float] | None = Field(None, description="percent mode: criterion id -> share (>= 0), normalised to sum 1")


class SuitabilityRequest(BaseModel):
    region: SuitabilityRegion
    start: datetime = Field(description="Start of the mission window (landing), ISO 8601 UTC")
    duration_h: float = Field(gt=0.0, le=24 * 400, description="Mission window, hours")
    criteria: list[CriterionInput] = Field(min_length=1, max_length=24)
    weighting: Weighting | None = Field(None, description="Required when a criterion has role soft or both")
    cell_km: float = Field(0.96, ge=0.24, le=7.68, description="Cell size of the raster, km")
    landing_radius_km: float | None = Field(None, gt=0.0, le=20.0, description="A cell survives only if no cell failing a static criterion lies within this radius, km; the site score is the worst score within it")
    robust_delay_h: float | None = Field(None, gt=0.0, le=24 * 30, description="Hard window criteria must also pass if the landing slips by this many hours, h")
    step_min: float = Field(60.0, ge=10.0, le=1440.0, description="Time step of the window criteria and of the bound, minutes")
    mast_m: float = Field(2.0, ge=0.0, le=10.0, description="Height of panel and antenna above the ground, m")
    panel: Literal["tracking", "vertical", "horizontal"] = Field("vertical", description="Panel orientation for mean power")
    comms_min_fraction: float = Field(0.5, gt=0.0, le=1.0, description="Share of the Earth's disc above the horizon that counts as contact")
    horizon_az_step_deg: float = Field(0.5, ge=0.25, le=5.0, description="Azimuth step of the traced horizons, degrees")
    horizon_radius_km: float = Field(150.0, ge=20.0, le=250.0, description="How far each horizon ray goes, km")
    max_window_samples: int = Field(300, ge=1, le=2000, description="Most quadtree samples for the window criteria")
    unknown_passes: bool = Field(False, description="True: a hard criterion without data at a cell lets it through")
    use_bounds: bool = Field(True, description="Method switch: drop tiles the ephemeris bound proves to fail (false only for validation)")
    top_k: int = Field(10, ge=1, le=25, description="Number of proposed landing sites")
    min_separation_km: float = Field(10.0, gt=0.0, le=200.0, description="Least ground distance between two proposed sites, km (display spacing, not a physical threshold)")


class FunnelStep(BaseModel):
    id: str
    stage: Literal["geometry", "bound", "regional", "medium", "fine", "landing_radius", "window"]
    cells_in: int = Field(description="Cells alive when it ran")
    cells_out: int = Field(description="Cells it removed")
    cells_unknown: int = Field(description="Alive cells without data for it")
    est_kill_fraction: float | None = Field(None, description="Share failing on the 1/16 subsample, used to order the stage")
    seconds: float


class BoundInfo(BaseModel):
    tile_km: list[float] = Field(description="Tile sides used, coarse to fine, km")
    tiles_evaluated: int
    cells_proven_failed: int
    by_criterion: dict[str, int] = Field(description="Cells proven failed, by the first criterion (catalogue order) that failed")
    h_min_m: float = Field(description="Lowest terrain height assumed, m (grid minimum minus the margin)")
    elev_margin_m: float
    margin_deg: float


class Layer(BaseModel):
    id: str = Field(description="Criterion id")
    label: str
    unit: str | None
    role: Role
    weight: float = Field(description="Normalised weight in the score, 0..1")
    limit: float
    ideal: float
    utility_b64: str = Field(description="uint8 per cell, row-major: round(utility x 250), 255 = no data or not scored")
    value_min: float | None = Field(description="Smallest value among scored cells, criterion unit")
    value_max: float | None


class SiteCriterion(BaseModel):
    id: str
    label: str
    unit: str | None
    role: Role
    value: float | None = Field(description="At the site, criterion unit (window values exact when window_exact)")
    utility: float | None
    weight: float | None
    contribution: float | None = Field(description="weight x utility")
    passes: bool | None = Field(description="Hard test (hard and both); None for soft or unknown")
    margin: float | None = Field(description="Distance to the limit on the passing side, criterion unit (range: to the nearer bound)")


class NearFeature(BaseModel):
    name: str
    distance_km: float
    bearing_deg: float = Field(description="From the feature centre to the site, clockwise from north")


class TopSite(BaseModel):
    rank: int
    lat: float
    lon: float
    near: NearFeature | None
    score: float = Field(description="0..1 at the site cell")
    area_score: float = Field(description="0..1, worst score within the landing radius (= score without one)")
    coverage: float = Field(description="Share of the preference weight with data at the site, 0..1")
    clearance_km: float = Field(description="Distance to the nearest cell that is not viable, km (map distance)")
    window_exact: bool | None = Field(description="True: window values evaluated at the site with its own traced horizon; None: no window criteria")
    horizon_kind: Literal["terrain"] | None
    criteria: list[SiteCriterion]
    pros: list[str] = Field(description="Criterion ids, strongest first")
    cons: list[str]
    unknown: list[str] = Field(description="Active criteria without data at the site")


class SuitabilityResponse(BaseModel):
    grid: GridInfo
    codes_b64: str = Field(description="uint8 per cell, row-major (row 0 = top): 0 outside, 1 fails a static criterion or the landing radius, 2 fails a window criterion (sampled), 3 viable, 4 unknown, 5 proven to fail a window criterion by the ephemeris bound")
    score_b64: str = Field(description="uint8 per cell: 0 not viable, 1..255 = score x 255 for viable cells")
    limiting_b64: str = Field(description="uint8 per cell: index in `layers` of the criterion that costs the most score (largest weight x (1 - utility)), 255 = none")
    layers: list[Layer]
    weights: dict[str, float]
    weighting_mode: Literal["rank", "percent", "none"]
    counts: dict[str, int] = Field(description="Cells by code: outside, failed_static, failed_window, viable, unknown, failed_bound")
    funnel: list[FunnelStep]
    bound: BoundInfo | None
    window: WindowInfo | None
    sites: list[TopSite]
    sites_dropped: int = Field(description="Candidates that failed a hard window criterion when evaluated exactly")
    seconds: float
    assumptions: list[str]
```

Criteria endpoint response (`GET /api/v1/suitability/criteria`): `CriteriaCatalogue{ groups: list[{letter,
title}], fixed_inputs: list[{id, label, tip}], criteria: list[CriterionInfo] }` where `CriterionInfo` mirrors
`CriterionSpec` plus `available: bool`, `unavailable_reason: str | None`, `params: list[ParamInfo]` (fields of
`ParamSpec`). Write these Pydantic models in the same schema file.

### 8.4 Glue: `api/app/suitability_search.py`

Imports from the existing modules (read-only use; do not edit them):

```python
from .area_search import (ELEVATION_GRIDS, FULL_SKY_SR, HORIZON_GROWTH, MAX_CELLS, MAX_SUB, CHUNK_CELLS, PROXY_TOL,
                          PSR_PIXEL, SLOPE_GRIDS, SearchTooLarge, _cell_max, _cell_mean, _finest_xy, _run_from_start,
                          _sample_horizon, crater_density, rim_distance_km)
from .logic import areas as A
from .logic import bounds as B
from .logic import suitability as S
from .logic.engine import AnalysisParams, compute_metrics, make_model, time_grid
from .logic.horizon import ray_distances
from .logic.projection import great_circle_km, south_polar_latlon, south_polar_xy
from .db.landings import measured_landings
```

#### 8.4.1 Validation of inputs (before any computation) → `ValueError` list → router returns 422

For each `CriterionInput`, with `spec = CATALOGUE[id]`:

1. unknown id or unavailable → error `"<id>: unknown or unavailable criterion"`; duplicated id → error.
2. `role not in spec.roles` → error.
3. `kind == "value"`: `limit` required. If role in (soft, both): `ideal` required, `ideal != limit`, and on the
   better side (`higher`: ideal > limit; `lower`: ideal < limit).
4. `kind == "range"`: at least one of `min`, `max`; if both, `min <= max`. `limit`/`ideal` must be null.
5. `kind == "choice"`: `choice` in the options of the first param. `kind == "flag"`: nothing else.
6. params: every required `ParamSpec` present, numbers within `[min, max]` (exclusive lower bound where the
   catalogue says "> 0"), no unknown keys.
7. Weighting: if any soft/both criterion → `weighting` required; rank mode: `order` must be exactly the set of
   soft/both ids (any order, no extras, no missing); percent mode: keys exactly that set, values ≥ 0, sum > 0.
   No soft/both criterion and `weighting` given → ignore it (`weighting_mode = "none"`).
8. Region/cells: `n = ceil(2 * radius_km / cell_km)`; `n * n > MAX_CELLS` → error (same text as `area_search`).
9. Ephemeris coverage of `[start, start + duration_h + (robust_delay_h or 0)]` → **400** (as `routers/areas.py`).

#### 8.4.2 Setup (copy from `area_search.search`)

Grid: `lon_c`, `cell_m`, `n`, `x_left`, `y_top`, `gx`, `gy`, `inside`, `clat`, `clon` exactly as in
`area_search.search`. Arrays: `failed = np.zeros((n, n), np.uint8)` (0 none, else code 1/2/5), `unknown =
np.zeros((n, n), bool)`, `values: dict[str, np.ndarray]`, `funnel: list[FunnelStep]`, `assumptions: list[str]`.
`alive()` = `inside & (failed == 0)`.

`sub(grid_ids, reduce, bilinear=False, mask=None)`: the `sub` closure of `area_search.search` rewritten as a
function taking the mask of cells to read (default `alive()`); returns NaN outside the mask.

`apply(cid, stage, vals, ok, code, est=None, seconds=0.0)`:

```python
a = alive()
unk = a & np.isnan(vals)
bad = a & ~np.isnan(vals) & ~ok
failed[bad] = code
if not req.unknown_passes:
    unknown |= unk
funnel.append(FunnelStep(id=cid, stage=stage, cells_in=int(a.sum()), cells_out=int(bad.sum()),
                         cells_unknown=int(unk.sum()), est_kill_fraction=est, seconds=round(seconds, 4)))
```

Hard criteria = role in (hard, both). Soft criteria = role in (soft, both).

#### 8.4.3 Evaluators (one function per criterion id; signature `ev(mask) -> np.ndarray` of shape (n, n), NaN outside `mask` or without data)

- Per-cell evaluators (read only `mask` cells): `slope_deg`, `elevation_m`, `permanent_shadow_fraction`,
  `long_term_sun`, `long_term_earth`, `sky_sr`, `dose_mgy`, `hydrogen_ppm`, `side`, `landing_distance_km`,
  `target_distance_km`, `host_crater_depth_m`.
- Dense evaluators (compute the whole raster once, cache, then mask): `crater_density_per_km2`,
  `elongated_crater_density_per_km2`, `rim_distance_km`, `psr_distance_km`.
- `side` returns 1.0/0.0 (pass/fail per `choice`), `earth_at_landing` likewise from the window values.

#### 8.4.4 `psr_distance_km`

1. Pad: `cap_km = min(100.0, max(limit, ideal or limit))` (both and soft: the largest of the two; hard: limit);
   `p = ceil(cap_km * 1000 / cell_m)` cells; build the padded grid centres (n + 2p)² from `x_left − p·cell_m`,
   `y_top + p·cell_m`.
2. If `(n + 2p) > 1400`, evaluate on a coarser grid of cell `c2 = cell_m * ceil((n + 2p) / 1400)` covering the same
   padded square, then sample back to the cells by nearest centre; add to the assumptions:
   "PSR distance computed on a <c2/1000> km grid (resolution limit)".
3. `shade = _finest_xy(store, ("permanent_shadow_65s",), px, py, False)`; `psr = nan_to_num(shade) >= PSR_PIXEL`.
4. `d_km = S.edt_cells(psr, cap_km * 1000 / cell) * cell / 1000.0`, cropped to the n × n region. Distances above
   the cap are inf: keep them as `cap_km + cell/1000` for the utility (beyond the cap counts as "far"), and record
   in the assumptions that distances beyond `cap_km` are reported as "more than cap_km".
5. NaN where `shade` is NaN at the cell itself and `d_km` is inf (no data, no PSR nearby).

Note: this is map distance on the stereographic plane (scale factor 1.0 to 1.07 south of 60 S); divide by the
scale factor `k = 2 / (1 + sin(-lat))` at the cell to get ground distance (do it).

#### 8.4.5 `target_distance_km` and `NearFeature` (`api/app/db/nomenclature.py`)

```python
class NomenclatureRepository:
    """IAU lunar feature names (data/external/nomenclature/moon_nomenclature.csv, USGS Gazetteer of Planetary
    Nomenclature): name, centre (lat, lon east -180..180), diameter km, feature type. Loaded lazily."""
    def __init__(self, data_dir: Path): ...
    @property
    def available(self) -> bool: ...
    def arrays(self) -> dict[str, np.ndarray]:   # name (object), lat, lon, diameter_km, type (object)
    def find(self, name: str) -> tuple[str, float, float] | None:   # case-insensitive exact match on `name` or `clean_name`
```

CSV columns: `name, clean_name, approvaldt, origin, diameter, center_lon, center_lat, type, ...`; `center_lon`
is 0..360 east → convert to −180..180. Add `nomenclature: NomenclatureRepository | None = None` as the last field of
`DataStore` and construct it in `load_store` (additive edit of a shared file: say so in the PR).

`near` of a site: the feature with the smallest `great_circle_km` among features south of 55 S, if within 100 km;
bearing from the feature to the site with the standard initial-bearing formula, degrees clockwise from north,
0..360. Prefer, among features within 1 km of the nearest distance, the one with the largest diameter.

#### 8.4.6 Stage 0: geometry

For each hard criterion with stage `geometry`, in catalogue order: compute, `apply(..., code=1)`.

#### 8.4.7 Stage 1: bound (only if `use_bounds` and some hard criterion has `bounded`)

1. Time grid: `t = time_grid(start_ms, duration_h, step_min)`; `eph = store.ephemeris.positions(t)`; `sun = eph[:,
   0:3]`, `earth = eph[:, 3:6]`; `step_h = step_min / 60`. If `robust_delay_h`: a second grid shifted by the delay.
2. `h_min_m = min(store.grids.meta(g)["min"] for g in ELEVATION_GRIDS) − B.ELEV_MARGIN_M` (gives −9608 m).
   Use only `ELEVATION_GRIDS` (the two polar grids the window sampler reads). Never pass `lola_elevation_global`
   (equirectangular, added on `main` in #27) to `sample_xy`/`bilinear_xy`: they raise `ValueError` for it.
3. Ray sample sets: `[ray_distances(float(store.grids.meta(g)["pixelM"]), horizon_radius_km * 1000, HORIZON_GROWTH)
   for g in ELEVATION_GRIDS]` (the two sets the window sampler can use).
4. Cell tops: `cell_top = sub(ELEVATION_GRIDS, _cell_max, mask=inside)` (every inside cell), then
   `ring_top = 3 × 3 maximum filter of cell_top` (NaN ignored; implement as `-min_filter_square(-cell_top, 1)`),
   `top = ring_top + mast_m + B.ELEV_MARGIN_M`.
5. Levels: `T0` = largest power of 2 with `T0 * cell_km <= 32` (at least 1); then `T0/2, T0/4, …` while
   `T * cell_km >= 3.84` (at least one level). Tiles are the aligned blocks `[i0, i0+T) × [j0, j0+T)`.
6. Level loop: candidate tiles = tiles holding at least one alive cell and (after the first level) inside a parent
   tile that was not failed. For each: centre `xc = x_left + (j0 + h/2)·cell_m`, `yc = y_top − (i0 + hh/2)·cell_m`
   (h, hh = actual block width/height at the edge), `lat, lon = south_polar_latlon(xc, yc)`,
   `theta_deg = degrees(hypot(h, hh)·cell_m / 2 / R_M)` (map half-diagonal: conservative since the scale factor is
   ≥ 1), `top_tile = nanmax(top[block])` (NaN if all NaN → tile undecided).
   Skip refining a level when `len(tiles) * len(t) > 50_000_000`: keep the decisions of the coarser level and
   record "bound stopped at <T·cell_km> km tiles (budget)".
7. `tb = B.tile_bounds(lat, lon, theta, top_tile, h_min_m, ray_sets, sun, earth, step_h)` (and `tb2` for the
   delayed grid). A tile **fails** if, for any hard bounded criterion `c`:

   | criterion | fails when |
   | --- | --- |
   | `sunlit_fraction` | `tb.sun_share_ub < c.limit` |
   | `longest_dark_h` | `tb.dark_lb_h > c.limit` |
   | `light_left_h` | `tb.light_left_ub_h < c.limit` |
   | `comms_fraction` | `tb.earth_share_ub < c.limit` |
   | `longest_blackout_h` | `tb.blackout_lb_h > c.limit` |
   | `contact_left_h` | `tb.contact_left_ub_h < c.limit` |
   | `both_fraction` | `tb.both_share_ub < c.limit` |
   | `sun_el_at_landing_deg` | `(c.min is not None and tb.sun_el0_max < c.min) or (c.max is not None and tb.sun_el0_min > c.max)` |
   | `earth_at_landing` | `not tb.earth0_possible` |

   With `robust_delay_h`, the same test on `tb2` also fails the tile (window criteria must pass both windows).
   NaN `top_tile` → not failed.
8. Every alive cell of a failed tile gets `failed = 5`. `by_criterion` counts by the first failing criterion in
   catalogue order. One `FunnelStep(id="ephemeris_bound", stage="bound", ...)`.
9. `assumptions.append(...)`: "Ephemeris bound: tiles from X km to Y km; a tile is dropped only when no part of the
   Sun (or Earth) can be above any horizon that terrain at or above <h_min> m can make (rays as the window samples,
   +500 m height margin, +0.05 deg)."

#### 8.4.8 Stages 2, 3, 4: regional, medium, fine

For each stage, hard criteria of that stage:

1. Estimate: `sample = alive() & (ii % 4 == 0) & (jj % 4 == 0)`; for per-cell evaluators `v = ev(sample)`; for dense
   ones `v = ev(alive())` (cached); `est = share of sample cells with data that fail` (0 if none).
2. Order: by `est` descending, then id ascending.
3. Apply in that order: per-cell evaluators recomputed on `alive()` at application time (fewer cells each time);
   dense from cache. `apply(id, stage, v, S.passes(...), code=1, est=est, seconds=...)`.
4. Keep every computed value array in `values[id]` (needed for site entries and utilities).

#### 8.4.9 Stage 5: landing radius

If `landing_radius_km`: `near_fail = A.dilate(failed == 1, landing_radius_km * 1000 / cell_m)`; `hit = alive() &
near_fail`; `failed[hit] = 1`; `FunnelStep(id="landing_radius_km", stage="landing_radius", ...)`. Same assumption
text as `area_search`.

#### 8.4.10 Stage 6: window

Runs if any active criterion has stage `window` (hard or soft) and `alive().any()`.

- Copy the closures `window_values`, `one`, `evaluate` and the thread pool from `area_search.search` (they are
  local functions there and cannot be imported); keep the logic identical, including `robust_delay_h` (`"delayed"`
  key). The outcome per sample: 1 if it passes every **hard** window criterion (and the delayed window when
  `robust_delay_h`), 0 if not, 2 if no ground height. With no hard window criterion every outcome is 1.
- Survivors: `alive()` (unknown cells included).
- Proxies: long-term Sun and Earth, from `values` when present, else `sub(("sun_illumination_65s",), _cell_mean)`
  and the Earth equivalent.
- `rows, cols, vals, outcome, leaves, owner = A.quadtree_samples(alive(), evaluate, max_window_samples,
  proxies=(lt_sun, lt_earth), proxy_tol=PROXY_TOL)`.
- Per-cell arrays for each window key exactly as in `area_search` (`owner` mapping); `values[id]` for each window
  criterion from its key (`sunlit_fraction`→`sunlit`, `longest_dark_h`→`dark`, `light_left_h`→`light_left`,
  `mean_power_w_m2`→`power`, `comms_fraction`→`comms`, `longest_blackout_h`→`blackout`,
  `contact_left_h`→`contact_left`, `both_fraction`→`both`, `sun_el_at_landing_deg`→`sun_el0`,
  `earth_at_landing`→`earth0`).
- Apply each hard window criterion (`code=2`) in catalogue order; then `robust_delay_h` as in `area_search`.
- `WindowInfo` and the assumption text as in `area_search`.

#### 8.4.11 Final codes, soft values, utilities, score

```python
code = np.where(inside, A.VIABLE, A.OUTSIDE).astype(np.uint8)
code[unknown & inside] = A.UNKNOWN
code[failed > 0] = failed[failed > 0]          # 1, 2 or 5
viable = code == A.VIABLE
scored = (code == A.VIABLE) | (code == A.UNKNOWN)
```

- Soft-only criteria not yet computed: compute with `mask=scored` (window ones already have values).
- Weights over soft/both criteria: rank → `S.roc_weights(len(order))` in `order`; percent → shares / sum.
- Layers in this order: the weighting order (rank) or descending weight then id (percent). For each:
  `u = S.utility(values[id], limit, ideal)` on `scored` cells (NaN elsewhere); `q = S.quantize_utility(u)` with
  `q[~scored] = 255`.
- `score, coverage = S.score_from_quantized([q...], w)`; if no soft criteria: score = 1, coverage = 1 on `scored`.
- `score_b64 = S.score_u8(score, viable)`.
- `limiting`: for scored cells with at least one known layer, the index of the largest `w_i * (1 − q_i/250)` among
  known layers (ties: lowest index); 255 elsewhere or with no layers.

#### 8.4.12 Stage 7: sites

1. `clearance_km = S.edt_cells(~viable & inside, max_cells=200) * cell_m / 1000` (inf → 200·cell).
2. `area = S.min_filter_square(np.where(inside, np.where(viable, score, 0.0), np.nan), r)` with
   `r = ceil(landing_radius_km * 1000 / cell_m)` (0 without landing radius → `area = score`).
3. Candidates: `cand = np.where(viable, area, np.nan)`; picks with `S.pick_sites(cand, clearance_km, gx, gy,
   kscale, min_separation_km * 1000, n_picks)`, where `kscale = 2 / (1 + sin(radians(-clat)))` (polar
   stereographic scale factor per cell) and `n_picks` is defined next. If there are window criteria, ask for up to
   `n_picks = 3 * top_k` picks (more candidates in case some fail exactly), else `n_picks = top_k`.
4. Exact window evaluation (only if any window criterion): evaluate the picks in order with the copied `one()` (the
   thread pool, batches of `top_k`); recompute the window values at the site; if a hard window criterion (or its
   delayed check) fails → drop it, `sites_dropped += 1`. Stop when `top_k` sites are accepted or the picks run out.
5. For each accepted site: recompute its utilities with the exact values (same quantization), its `score`, and
   `area_score = min(area[i, j], score_exact)`. Entries for every active criterion (value, utility, weight,
   contribution, passes for hard/both, margin as in `SiteCriterion`), `pros/cons = S.pros_cons(...)`, `unknown`,
   `near`, `clearance_km`, `coverage`, `window_exact`, `horizon_kind = "terrain"` when traced.
6. Sort accepted sites by `area_score` desc, then `score` desc, then clearance desc; ranks 1..k.

#### 8.4.13 Response

`counts` with keys `outside, failed_static, failed_window, viable, unknown, failed_bound`; `seconds`; the
assumptions (every rule above that says "record"); `GridInfo` as in `area_search`.

### 8.5 Router (`api/app/routers/suitability.py`) and registration

Copy the shape of `routers/areas.py`: `APIRouter(prefix="/suitability", tags=["suitability"])`,
`POST /search` (summary "Score the cells of a region for a mission and propose the best landing sites") with the
same 400 check and an LRU cache of 16 keyed on `req.model_dump_json()`; `ValueError` from the validation →
`HTTPException(422, detail=[...messages])`; `SearchTooLarge` → 422. `GET /criteria` (summary "Criteria the
mission design can use, with units, roles, parameters and coverage") returns the catalogue with
`available`/`unavailable_reason` resolved against the store (shape data present or not).

`api/app/main.py` (additive): `from .routers import ... suitability`, `app.include_router(suitability.router,
prefix=config.API_PREFIX)`, and `from fastapi.middleware.gzip import GZipMiddleware` +
`app.add_middleware(GZipMiddleware, minimum_size=1000)` right after the CORS middleware (the utility layers
compress well; say so in the PR).

### 8.6 Tests

`api/tests/test_suitability_logic.py` (pure, fast):

- ROC values (3.6), sum to 1 for n = 1..10.
- `utility` values (3.6), NaN passthrough; `quantize_utility` of `[0, 0.5, 1, nan]` → `[0, 125, 250, 255]`.
- `score_from_quantized` hand case: q1 = `[250, 0, 255]`, q2 = `[125, 125, 125]`, w = `[0.75, 0.25]` → score
  `[0.875, 0.125, 0.5]`, coverage `[1, 1, 0.25]`.
- `score_u8` rounding: score 0.5 → 128 (floor(127.5 + 0.5)); 0 on a viable cell → 1.
- `edt_cells` vs brute force on 30 random masks with random caps (copy `edt_bounded.py` logic); empty mask → inf.
- `min_filter_square` vs brute force for r in {0, 1, 2, 5} with NaN holes.
- `pick_sites` case of 3.6; separation respected on a random case; k larger than candidates.
- `pros_cons` ordering on a hand case.
- Input validation: each rule of 8.4.1 has one failing example and one passing example.

`api/tests/test_suitability.py` (endpoint and real data). Regions: `SMALL = {"center_lat": -89.3, "center_lon":
60.0, "radius_km": 25.0}` (as `test_areas.py`), `MID = {"center_lat": -84.5, "center_lon": 30.0, "radius_km":
40.0}`, `FAR = {"center_lat": -68.0, "center_lon": 150.0, "radius_km": 40.0}`; start `2027-01-10T00:00:00Z`.

1. Criteria endpoint: lists every catalogue id plus the unavailable ones with reasons; `fixed_inputs` has `region`
   and `window`.
2. Happy path, static only: `slope_deg` both (limit 15, ideal 5), `long_term_sun` soft (limit 0.2, ideal 0.5),
   rank weighting `["slope_deg", "long_term_sun"]` on `SMALL` at 0.96 km: 200, raster sizes n × n, weights
   `{slope: 0.75, sun: 0.25}`, at least one site, sites at least 10 km apart, every site viable in the codes,
   `score_b64` consistent with recomputing from `layers` via `score_from_quantized` (exact equality).
3. 422 cases: unknown id; unavailable id (`rocks`); role not allowed (`elevation_m` soft); ideal on the worse side;
   missing params (`crater_density_per_km2` without `radius_km`); rank order missing an id; region north of 60 S;
   too many cells (radius 400 at 0.24 km); unknown `target_distance_km` feature name.
4. 400: start in 2040.
5. **Soundness of the bound (the key test):** on `FAR` and `MID`, criteria `sunlit_fraction` hard limit 0.7 and
   `comms_fraction` hard limit 0.7, duration 708.7 h (29.53 d), cell 1.92 km. For **every** cell with code 5 (cap
   at 60 cells drawn with a fixed seed if more), evaluate the window exactly at that cell (trace its horizon with
   `_sample_horizon`, `make_model`, `services.evaluate_window`, `compute_metrics`) and assert it fails at least one
   of the two criteria. Also assert `FAR` has code-5 cells (the bound is active there).
6. **Order invariance:** with `SMALL`, hard `slope_deg` ≤ 20, `permanent_shadow_fraction` ≤ 0.2,
   `long_term_sun` ≥ 0.3, `sky_sr` ≤ 6.0 (no window criteria): run with the normal order and with each stage's
   order reversed (expose a keyword `_order_override: dict[str, list[str]] | None = None` on `search()`, used only
   by tests) → identical `codes_b64`.
7. **Regression against `/areas/search`:** same `SMALL` region and cell, hard-only criteria mapped to the area
   filters (`max_slope_deg=20`, `max_permanent_shadow=0.2`, `min_long_term_sun=0.3`), `use_bounds=false`, no
   window criteria: codes identical cell by cell, except cells where areas says 4 and suitability says 1 (FAIL beats
   UNKNOWN here); assert that set is the only difference.
8. Bound on/off agreement: on `MID` with `sunlit_fraction` hard 0.5 (14 d), every cell that is viable with
   `use_bounds=true` is either viable or code 2 with `use_bounds=false` (never code 1); every code-5 cell is code 2
   or viable-but-shared-sample in the unbounded run (just record the share in the test output, do not assert
   beyond soundness test 5).
9. `landing_radius_km` = 2: every site's `area_score <= score`; no code-1 cell within 2 km of a site.
10. With PR 2 data present: `host_crater_depth_m` returns 0 outside craters and a positive depth inside a known
    crater cell; skipped (`pytest.skip`) when `shape_available` is false.

`api/tests/bench_suitability.py` (script, not a test): prints `seconds`, funnel step times and counts for: (a) `SMALL`
static only; (b) `MID` with two window criteria and `use_bounds` true vs false; (c) `FAR` radius 200 km at
1.92 km with the bound. Paste its output in the PR and in `docs/data-and-computation.md`. No timing is asserted.

### 8.7 Manual call (required before the PR)

```
cd api
uv run uvicorn app.main:app --port 8010
```

Then (in another shell) post the request of test 2 and of test 5 with `curl -s -X POST
http://127.0.0.1:8010/api/v1/suitability/search -H 'content-type: application/json' --data @req.json | head -c
2000`, open `http://127.0.0.1:8010/docs`, check the schema. Stop the server by its own process (Ctrl-C / its PID),
never by killing whatever holds the port.

### 8.8 Docs and done (PR 3)

`docs/endpoints.md` (your section: status "done", the two endpoints, request/response summary), `docs/references.md`
(Barron and Barrett 1996, Management Science 42(11) 1515-1523, rank order centroid; IAU nomenclature already
listed? add "nearest feature names" use if not), `docs/data-and-computation.md` (stage order, codes, precedence,
scoring, quantization, site picking, bench output), `CLAUDE.md`: **one row** in "Implemented endpoints and
filters": `| Endpoint | POST /api/v1/suitability/search, GET /api/v1/suitability/criteria | routers/suitability.py,
suitability_search.py, logic/suitability.py, logic/bounds.py | <ROLE> | Ordered funnel with ephemeris bound;
weighted utilities; top-k sites with pros/cons |`.

---

## 9. PR 4 — the web mission design

**ASK first:** the person must confirm that SW-1 and SW-2 agree to the edits of `MissionPanel.tsx`,
`terrain/engine.ts`, `terrain/shaders.ts`, `terrain/TerrainView.tsx`, `terrain/Legend.tsx`, `api/client.ts`,
`api/types.ts`. Then `cd web && npm run gen:api` (with the API of PR 3 merged) to regenerate `schema.gen.ts`, and
export the new types from `api/types.ts` (generated section).

### 9.1 Files

New: `web/src/mission/criteriaApi.ts` (hooks), `web/src/state/mission.ts`, `web/src/state/favourites.ts`,
`web/src/mission/score.ts`, `web/src/mission/CriteriaPicker.tsx`, `web/src/mission/ActiveCriteria.tsx`,
`web/src/mission/PriorityList.tsx`, `web/src/mission/TopSites.tsx`, `web/src/mission/SiteRadar.tsx`,
`web/src/mission/FavouritesPanel.tsx`, `web/src/mission/MissionDesign.tsx`, `web/src/mission/mission.css`, tests
`web/src/mission/*.test.ts(x)`.
Edited (additive): `api/client.ts` (`suitabilityCriteria`, `suitabilitySearch`), `api/hooks.ts`
(`useSuitabilityCriteria` query with `staleTime: Infinity`, `useSuitabilitySearch` mutation),
`panels/MissionPanel.tsx` (a segmented control at the top: "Mission design" | "Pass/fail areas"; default
"Mission design" renders `<MissionDesign/>`, the other the existing content unchanged, including its
"Load example mission" button and `EXAMPLE_MISSION` from `missionFilters.ts`). Mission design gets its own
"Load example mission" built from the same `EXAMPLE_MISSION` (centre, radius, cell, landing radius, duration) with
slope as Both (limit 10, ideal 5), sunlight during the mission Must 0.6, longest darkness Must 48, Earth contact
Both (limit 0.5, ideal 0.8), rank order slope, Earth contact; the same note that these are example values, not
requirements, `terrain/engine.ts`,
`terrain/shaders.ts`, `terrain/TerrainView.tsx`, `terrain/Legend.tsx`.

### 9.2 State (`web/src/state/mission.ts`, zustand, like `state/areas.ts`)

```ts
export type Role = 'hard' | 'soft' | 'both'
export interface ActiveCriterion {
  id: string
  role: Role
  /** typed text, parsed on submit */
  limit: string
  ideal: string
  min: string
  max: string
  choice: string
  params: Record<string, string>
}
export type DisplayMode = 'continuous' | 'bands' | 'limiting' | 'colourblind'
interface MissionState {
  center: { lat: number; lon: number } | null
  radiusKm: number            // default 30
  cellKm: number              // default 0.96
  landingRadiusKm: string
  robustDelayH: string
  active: ActiveCriterion[]   // in priority order for rank mode
  weighting: 'rank' | 'percent'
  percent: Record<string, string>
  pickerOpen: boolean
  result: SuitabilityResponse | null
  raster: SuitabilityRaster | null   // decoded codes, score (recomputed), limiting, layers (Uint8Array[])
  /** the request that produced `result`, to know whether limits changed since (button says Update) */
  lastBody: string | null
  display: DisplayMode
  focusSite: number | null
  compareSites: number[]      // ranks, at most 4
  // actions: set, add(ids), remove(ids), move(id, toIndex), setRole, setField, setParam, setResult, reweight()
}
```

`reweight()` recomputes `raster.score` and `raster.limiting` from `raster.layers` and the current weights with
`mission/score.ts` (no request) and bumps a version so the map repaints.

### 9.3 Client score (`web/src/mission/score.ts`) — must equal the server bit for bit

```ts
export function rocWeights(n: number): number[] {
  const w: number[] = []
  for (let k = 1; k <= n; k++) { let s = 0; for (let i = k; i <= n; i++) s += 1 / i; w.push(s / n) }
  return w
}
/** Same as logic/suitability.score_from_quantized + score_u8 + limiting. Float64, summation in layer order,
 * rounding floor(x * 255 + 0.5), clip 1..255 for viable cells; 255 = no data in the layers. */
export function recompute(codes: Uint8Array, layers: Uint8Array[], w: number[]): { score: Uint8Array; limiting: Uint8Array } {
  const n = codes.length, score = new Uint8Array(n), limiting = new Uint8Array(n).fill(255)
  for (let c = 0; c < n; c++) {
    const code = codes[c]
    if (code !== 3 && code !== 4) continue
    let num = 0, den = 0, worst = -1, wi = 255
    for (let i = 0; i < layers.length; i++) {
      const q = layers[i][c]
      if (q === 255) continue
      num += w[i] * (q / 250); den += w[i]
      const loss = w[i] * (1 - q / 250)
      if (loss > worst) { worst = loss; wi = i }
    }
    if (layers.length > 0) limiting[c] = wi
    const s = layers.length === 0 ? 1 : den > 0 ? num / den : 0
    if (code === 3) score[c] = Math.min(255, Math.max(1, Math.floor(s * 255 + 0.5)))
  }
  return { score, limiting }
}
```

(Server and client use the same rule for ties in `limiting`: the first, lowest index, wins because the comparison is
strict `>`. Make sure the server does the same.)

Percent mode in the browser: weights = parsed shares / sum (ignore NaN as 0; if the sum is 0, show "Give at least one
preference a share" and do not repaint).

### 9.4 Criteria picker (`CriteriaPicker.tsx`)

- A modal dialog (`role="dialog"`, `aria-modal="true"`, labelled "Choose criteria"), focus trapped, Escape and a
  "Done" button close it (closing keeps the choice).
- Two columns: **Available** (grouped by A–I with group headings, a search box filtering by label and tip) and
  **Active**. Each row: a checkbox, the label, the unit, an ⓘ with the tip, and the coverage in small text.
- Buttons between columns: "Add selected →" (moves checked Available rows to the end of Active) and "← Remove
  selected". Double-click on a row moves it. Keyboard: Space toggles the checkbox, Enter moves the focused row.
- Fixed rows at the top of Active: "Search region" and "Mission window", with a lock icon, no checkbox, text
  "Always used".
- Unavailable criteria are shown in Available, disabled, with their reason as the row's description
  (`aria-disabled`, not focusable as an action).
- After closing: `ActiveCriteria` shows a card per active criterion.

### 9.5 Active criteria cards (`ActiveCriteria.tsx`) and priority (`PriorityList.tsx`)

- Card: label + unit, role segmented control limited to the allowed roles ("Must" = hard, "Prefer" = soft, "Both"),
  inputs: value kind → "Worst acceptable" (limit) and, for Prefer/Both, "Ideal"; range kind → "Lowest"/"Highest";
  choice → a select; flag → no input. Params with their labels and units. Inline validation with the same messages
  as the API (8.4.1), shown under the field (`aria-describedby`).
- Priority list (only soft/both criteria): drag handle (HTML5 `draggable`) and "Move up"/"Move down" buttons for
  keyboard users; an `aria-live="polite"` region announces "<label> moved to position k of n". Next to each row the
  weight in percent (rank mode: ROC; percent mode: an input). A switch "Rank | Percent" changes the mode (switching
  to percent pre-fills the ROC percentages).
- Weight changes call `reweight()` at once (no request). Any other change marks the result stale: the main button
  reads "Update results" instead of "Find sites".

### 9.6 Map painting (`engine.ts`, `shaders.ts`, `TerrainView.tsx`, `Legend.tsx`)

- `engine.setAreas(a, mode = 0)`: unchanged texture (r = code, g = score) but in mode 3 (limiting) g = limiting
  index. New uniform `uAreaMode` (int): 0 legacy pass/fail (current look), 1 continuous, 2 bands, 3 limiting,
  4 colour-blind continuous. `TerrainView` paints the mission design raster when the mission panel is on "Mission
  design" and a result exists, else the area raster as today.
- Shader, inside `if (code > 0)` of the existing block, before the existing branches:

```glsl
vec3 rdylgn(float s) {            // d3 RdYlGn end and mid points
  vec3 r = vec3(0.647, 0.0, 0.149), y = vec3(1.0, 1.0, 0.749), g = vec3(0.0, 0.408, 0.216);
  return s < 0.5 ? mix(r, y, s * 2.0) : mix(y, g, (s - 0.5) * 2.0);
}
vec3 viridis(float s) {           // 5-stop approximation of viridis
  vec3 c0 = vec3(0.267, 0.005, 0.329), c1 = vec3(0.230, 0.322, 0.546), c2 = vec3(0.128, 0.567, 0.551),
       c3 = vec3(0.369, 0.789, 0.383), c4 = vec3(0.993, 0.906, 0.144);
  float t = clamp(s, 0.0, 1.0) * 4.0;
  return t < 1.0 ? mix(c0, c1, t) : t < 2.0 ? mix(c1, c2, t - 1.0) : t < 3.0 ? mix(c2, c3, t - 2.0) : mix(c3, c4, t - 3.0);
}
const vec3 OKABE[8] = vec3[8](vec3(0.902,0.624,0.0), vec3(0.337,0.706,0.914), vec3(0.0,0.620,0.451),
  vec3(0.941,0.894,0.259), vec3(0.0,0.447,0.698), vec3(0.835,0.369,0.0), vec3(0.800,0.475,0.655), vec3(0.6,0.6,0.6));
```

  For code 3 and `uAreaMode` 1/2/4: `s = g`; mode 2 → `s = s < 1.0/3.0 ? 0.0 : s < 2.0/3.0 ? 0.5 : 1.0`;
  colour = `mix(colour, mode == 4 ? viridis(s) : rdylgn(s), 0.7)`; draw an outline (same edge test as today) where
  the neighbour's band (`floor(g * 3)`) differs, so the bands never depend on colour alone. Mode 3: colour =
  `mix(colour, OKABE[min(idx, 7)], 0.7)` with `idx = int(g * 255.0 + 0.5)` and 255 → grey. Code 5: cross-hatch
  (both diagonals) in the code-2 colour. Codes 1, 2 and 4 keep today's look.
- Legend: per mode, the ramp with tick values 0, 0.33, 0.67, 1 ("score"), the band names (poor / marginal /
  favourable), or the list of limiting criteria with their swatch and name; plus the swatches for failed (map),
  failed (window, sampled), failed (window, proven), unknown, with words. A "Display" select (Continuous, Three
  bands, Limiting factor, Colour-blind palette) next to the legend.

### 9.7 Top sites (`TopSites.tsx`) and radar (`SiteRadar.tsx`)

- A list (`<ol>`), one item per site: rank, title "Site k · <distance> km <compass> of <near.name>" (or the
  coordinates), score as a bar plus the number in percent, area score when a landing radius is set, coverage when
  below 100 %, pros as "✓ <label> <value> <unit>" and cons as "✗ …", unknown criteria as "? <label>: no data".
- Buttons per site: "Show" (`look(lat, lon, 12)` of the map), "Study" (select the point and switch to study mode,
  like the existing `study()` in `MissionPanel`), "Save" (opens the save dialog of 9.8), and a "Compare" checkbox
  (at most 4; a fifth is refused with a message).
- `SiteRadar`: when two or more are ticked, `RadarChart` with one axis per soft/both criterion (key = id, label =
  short label) and one series per site (values = utilities 0..1, null when unknown), plus a `DataTable` with the
  values and units, and the summary text for the chart. Also a button "Open in live comparison" that calls
  `useApp.getState().addCompare({ kind: 'point', lat, lon })` for each ticked site (existing `ComparePanel`).

### 9.8 Favourites (`state/favourites.ts`, `FavouritesPanel.tsx`)

- Storage key `lunatiks.favourites.v1` in `localStorage`, every read and write in try/catch (the tool must work
  without storage: keep the data in memory and say "Saved for this session only").
- Schema:

```ts
interface FavouritesV1 {
  version: 1
  folders: { id: string; name: string; createdMs: number }[]
  items: {
    id: string; folderId: string | null; name: string; lat: number; lon: number; savedMs: number
    score: number; areaScore: number; pros: string[]; cons: string[]
    utilities: Record<string, number | null>      // for the radar later
    request: SuitabilityRequest                   // to re-run the same search
  }[]
}
```

- Save dialog: name (default "Site k · near <feature>"), folder select (existing folders and "New folder…" with a
  name field), Save. Ids: `crypto.randomUUID()` with a fallback counter.
- Panel (a "Saved" tab inside Mission design): folders (create, rename, delete with confirmation, which moves items
  to "No folder"), items with Show, Re-run (loads `request` into the store and submits), Move to folder, Rename,
  Delete (confirmation), and Compare (tick up to 4 → `SiteRadar` from the stored utilities; axes = union of keys).
- Export/Import JSON buttons (download a file / read an uploaded one, validated against the schema).

### 9.9 Web tests

- `score.test.ts`: ROC values of 3.6; `recompute` on the hand case of 8.6 (two layers, three cells) gives the
  server's numbers; a fixture captured from the API test of 8.6 #2 (save its response JSON into
  `web/src/mission/__fixtures__/suitability.json` while writing PR 4) recomputed with its weights equals its
  `score_b64` byte for byte.
- `favourites.test.ts`: save, rename, move, delete folder moves items, storage that throws on `setItem` keeps working
  in memory, import rejects a bad file.
- `CriteriaPicker.test.tsx` (Testing Library): tick two, Add selected, they appear in Active; fixed rows cannot be
  removed; unavailable row is disabled and shows its reason; keyboard Space/Enter path.
- `PriorityList.test.tsx`: Move up changes the order and the ROC percentages; the live region announces it.
- `app.test.tsx` (extend, following its existing mocks): mock `/api/v1/suitability/criteria` and
  `/api/v1/suitability/search`, run a search, the raster is decoded, five sites listed, changing a weight changes
  `raster.score` without a new fetch.
- e2e (`web/e2e/navigator.spec.ts`, follow its patterns): open mission mode, open the picker, add slope and
  long-term sunlight, type values, Find sites, the list shows sites, the legend shows the ramp; run the axe check
  with the WCAG tags already used in that file.
- `npm run typecheck && npm run lint && npm test` pass; `npm run test:e2e` passes locally.

### 9.10 Visual verification (with the preview tools of the session)

1. Start the API (`uv run uvicorn app.main:app --port 8000`) and the web dev server from `.claude/launch.json` with
   `preview_start` (create the launch entry if missing: `npm run dev` in `web/`, its Vite port).
2. In the browser pane: mission mode → Mission design → set a centre at −85.5, 30 (map click) → picker → slope
   (Both, 15/5), long-term sunlight (Prefer, 0.2/0.5), sunlight during the mission (Must, 0.5) → Find sites.
3. Check with `read_page`: 10 sites listed (or fewer with a stated reason), pros/cons present; legend present.
4. Drag long-term sunlight above slope: the map changes, no network request (`read_network_requests`).
5. Switch display modes; screenshot each; check the colour-blind mode and the band outlines.
6. Save two sites into a new folder, reload the page, they are still there; compare them in the radar.
7. Keyboard only: open the picker, add a criterion, reorder priorities, run, open a site. No console errors
   (`read_console_messages`).
8. Share the screenshots in the PR.

### 9.11 Done (PR 4)

Tests and lint pass, screenshots in the PR, `docs/endpoints.md` (SW-2 frontend section is not yours: add a line in
your own section "web: mission design panel"), `docs/accessibility.md` if it lists components (add the picker and the
priority list and how they meet keyboard and text-alternative rules).

---

## 10. Gated work (each one its own branch; do not start without its gate)

| Item | Gate (must be true before writing code) | Then |
| --- | --- | --- |
| Roughness criterion | The units and definition of `LDRM_80S_1000MPP_ADJ_AVGROUGH` / `CLASS` / `SPSLP` are found in the PGDA product 90 documentation (https://pgda.gsfc.nasa.gov/products/90) and quoted | dataset recipe (`CLAUDE.md`): pipeline module, `data/grids/lola_roughness_80s.npz` + `grids.json` entry, `fine` stage criterion `roughness` |
| Rock abundance | A Diviner rock abundance product (Bandfield et al. 2011) on PDS is found whose coverage includes south of 80 S at ≤ 1 km, with its units and licence | dataset recipe; `medium` criterion `rock_abundance` (lower better) |
| Regolith density / compaction | A Diviner H-parameter map (Hayne et al. 2017) on PDS with polar coverage and units is found | dataset recipe; criterion `h_parameter` |
| North pole | The north polar LOLA products (PGDA 90 `*_60N_*` / `*_80N_*`) and PGDA 69 north illumination exist and are downloaded | mirror `polar_grids` for the north, add a north stereographic projection, `pole` field in the request |
| Horizon envelopes near the pole | PR 3 merged and the bench shows window sampling dominates south of 85 S | precompute per 1.92 km cell south of 80 S the min and max skyline in 5° sectors from the 240 m grid; bound becomes two-sided (visible for sure / hidden for sure); validate like PR 1 |
| Landing date range | PR 3 merged | `landing_window {from, to, step_h, min_pass_share}`: bound per date at tile level, exact for the top sites |
| Branch-and-bound top-k | Regions larger than 360 000 cells are needed | min/max pyramids of each utility; upper bound of the score per tile; best-first expansion |

---

## 11. Validation plan (summary of every check, with pass criteria)

| # | Check | Where | Pass criterion |
| --- | --- | --- | --- |
| V1 | Pure functions on hand-worked numbers | `test_bounds.py`, `test_suitability_logic.py`, web `score.test.ts` | values of 3.6 within 1e-3 (angles) / exact (integers) |
| V2 | Bound never optimistic vs LOLA masks (every 6 h in CI, every hour by hand) | `test_bounds.py` #4, `validation_bounds.py` | 0 violations, smallest margin ≥ 1.5° |
| V3 | Bound never optimistic vs the engine's traced samples | `test_bounds.py` #6 | every azimuth ≥ floor |
| V4 | Tile bound contains its cells | `test_bounds.py` #5 | implication holds at every sample |
| V5 | Elevation margin still covers the grids | `test_bounds.py` #7 | both maxima < 450 m |
| V6 | Every proven-fail cell fails exactly | `test_suitability.py` #5 | 100 % |
| V7 | Order invariance | `test_suitability.py` #6 | identical codes |
| V8 | Regression vs `/areas/search` | `test_suitability.py` #7 | only the documented FAIL-over-UNKNOWN difference |
| V9 | Server score = browser score | `test_suitability.py` #2, web `score.test.ts` | byte for byte |
| V10 | Crater depth | `pipeline/tests/test_crater_shape.py` | synthetic within 5 %, Shackleton within 20 % of the published value |
| V11 | API contract | `test_suitability.py` #1-4 | 200 / 422 / 400 as listed |
| V12 | Performance recorded | `bench_suitability.py` | output pasted in docs (no threshold) |
| V13 | Web behaviour and accessibility | vitest, e2e + axe, 9.10 | all pass, screenshots |
| V14 | Full suites | `cd api && uv run pytest -q`; `cd pipeline && uv run pytest -q`; `cd web && npm test` | green |

If any check fails: do not change the check. Report the output to the person and **ASK**.

---

## 12. Documentation to update (by PR)

- PR 1: `docs/data-and-computation.md` (bound), `docs/endpoints.md` (your section, in progress).
- PR 2: `data/README.md`, `docs/references.md`, `docs/data-and-computation.md` (depth method and check).
- PR 3: `docs/endpoints.md` (done), `docs/references.md` (ROC), `docs/data-and-computation.md` (funnel, scoring,
  sites, bench), `CLAUDE.md` (one row).
- PR 4: `docs/endpoints.md` (your section: web), `docs/accessibility.md` if relevant.
- The data page of the product (`web/src/pages/DataPage.tsx`) is SW-2's: **ASK** whether to add a paragraph on the
  bound and the scoring (AI use is declared there already).

---

## 13. Definition of done (every PR)

- [ ] Branch `feat/<role>-<topic>` from an up-to-date `main`, rebased before the push.
- [ ] Layers respected; shared files with additive edits only, listed in the PR.
- [ ] Schemas snake_case, units in every description, UTC times.
- [ ] No threshold default; unknown data is NaN/null with a reason.
- [ ] Tests of the PR written and passing; whole suites passing (output pasted).
- [ ] For API PRs: the endpoint called on a running server, response checked.
- [ ] Docs of section 12 updated in the same branch; references added.
- [ ] Pushed and PR opened only after the person said yes; waiting for a reviewer; not merged by you.

---

## 14. Glossary

- **Hard / Must**: a limit; a cell beyond it is out. **Soft / Prefer**: only changes the score. **Both**: out
  beyond the limit, scored between limit and ideal.
- **Utility**: 0 at the limit, 1 at the ideal, linear between, clipped.
- **ROC weights**: rank order centroid; the planner orders, the weights follow.
- **Bound**: a value guaranteed to be at least (upper bound) or at most (lower bound) the true value at every cell of
  a tile; used only to prove failures.
- **Floor**: the lowest skyline any terrain consistent with the grids can produce for an observer.
- **Funnel stage**: a group of criteria with the same cost and spatial scale, run in a fixed order.
- **Area score**: the worst score within the landing radius around a site.
