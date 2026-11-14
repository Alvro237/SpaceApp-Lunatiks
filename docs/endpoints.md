# Endpoints and models: specification, owners and status

One section per piece of work. Tell your Claude session which section is yours; it should touch only
the files named there. Each section is one functionality: one branch (`feat/<role>-<topic>`) and one pull
request. Keep the **Status** line of your own section current in that branch (to do, in progress, in review,
done); when it is merged, the same pull request adds its row to "Implemented endpoints and filters" in `CLAUDE.md`.

Names behind the roles (fill in): SW-1 = ____, SW-2 = ____, AERO-1 = ____, AERO-2 = ____, MECH = ____

Common request fields used below:

- `site_id` (catalogue) **or** `lat`, `lon` (manual coordinates, degrees, MOON_ME, east-positive).
- `t` or `start`: ISO 8601 UTC. `duration_h`: mission duration in hours. `step_min`: sampling step.
- `mast_m`: height of the panel or antenna above the ground (terrain masks exist for 0, 2, 5 and 10 m).
- `panel`: `tracking` | `vertical` | `horizontal`. `comms_min_fraction`: share of the Earth's disc required.

Every response that used a horizon includes `horizon_kind`: `terrain` or `smooth_sphere`.
Numbers given as defaults below are placeholders for the owner to set with a cited source.

---

## Done (reference slice)

| Endpoint | File | Notes |
| --- | --- | --- |
| `GET /health` | `routers/meta.py` | Liveness and what is loaded |
| `GET /api/v1/sites?group=&terrain_only=` | `routers/sites.py` | Catalogue list |
| `GET /api/v1/sites/{site_id}` | `routers/sites.py` | Site with source and terrain summary |
| `GET /api/v1/meta/datasets` | `routers/meta.py` | Provenance of every dataset |
| `GET /api/v1/meta/constraints` | `routers/meta.py` | Registered hard filters and default score weights |

---

## SW-1 · Site state at a date and time

**Status:** done in branch `seryitron-branchito`, validated (output format: `docs/sw1-output-format.md`). **Files:** `routers/state.py`, `schemas/state.py`, `tests/test_state.py`.

- `GET /api/v1/sites/{site_id}/state?t=&mast_m=&comms_min_fraction=` (`mast_m` absent or null = 0 m)
- Response: Sun and Earth `az`, `el`, `horizon_el`, `visible_fraction`, `visible`, `angular_radius_deg`,
  `distance_km`; `eclipse`, `sun_eclipsed_fraction`; `next_sun_transition` and `next_earth_transition` (`kind`,
  `at`, `in_hours`); `horizon_kind`. No irradiance or power: those belong to MECH's `/power` (owner's decision).
- Logic: `services.model_for_site` + `engine.evaluate` at one instant + `engine.next_transition`. No new physics.
- Done when: the values for a fixture case in `tests/fixtures/horizons_reference.json` match within 0.01 degrees
  through the HTTP layer, and a date outside the tables returns 400.

## SW-1 · Series over a window

**Status:** done in branch `seryitron-branchito`, validated (output format: `docs/sw1-output-format.md`, plan:
`docs/sw1-roadmap.md`). **Files:** `routers/state.py` (same router), `schemas/state.py`, `tests/test_series.py`.

- `GET /api/v1/sites/{site_id}/series?start=&duration_h=&step_min=&mast_m=...`
- Response: arrays (`t`, Sun and Earth az/el/horizon_el/fraction/visible, `eclipse`, `sun_eclipsed_fraction`),
  `metrics` (the `Metrics` dataclass without power), `sunlit_ranges`, `comms_ranges` and `eclipse_ranges` (edges
  refined to the second), `horizon_kind`. No power: MECH's `/power` (owner's decision).
- Guard: cap the number of samples (for example 20 000) and return 422 above it.

## SW-1 · Horizon profile

**Status:** done in branch `seryitron-branchito`, validated (output format: `docs/sw1-output-format.md`).
**Files:** `routers/horizon.py`, `schemas/horizon.py`, `tests/test_horizon.py`.
`GET /api/v1/sites/{site_id}/horizon?mast_m=&include_zone=` returns the 720 azimuth values, `kind`, the mast
actually used, and optionally the zone neighbours (`db/horizons.py: zone`).

## SW-1 · Manual coordinates

**Status:** `points/state` done in branch `seryitron-branchito`, validated (output format:
`docs/sw1-output-format.md`); `points/series` next; `points/info` not assigned in the team table.
**Files:** `routers/points.py`, `tests/test_points.py` (`schemas/points.py` not needed: the responses are the
site endpoints' models with `site_id: null`).

- `GET /api/v1/points/state`, `/points/series`: same as the site endpoints with `lat`, `lon` instead of an id
  (`services.model_for_point`).
- `GET /api/v1/points/info?lat=&lon=`: what the datasets say at the point (`services.point_lookups`): ground
  height, slope and its source, long-term Sun illumination and Earth visibility, permanent shadow, sky
  visibility, crater density, and which values are unavailable there.
- Validation: latitude -90..90, longitude -180..180 (accept 0..360 and normalise). Say clearly that the horizon
  is a smooth sphere.

---

## SW-2 · Candidate search (mission filters)

**Status:** to do. **Files:** `routers/candidates.py`, `schemas/candidates.py`, `schemas/constraints.py`,
`logic/candidates.py`, `tests/test_candidates.py`.

- `POST /api/v1/candidates/search`
- Request: mission window (`start`, `duration_h`), `mast_m`, `panel`, `comms_min_fraction`; `scope`
  (`catalogue`, optionally `zones` to include the neighbour points around terrain sites, later a grid sweep of a
  region); `hard_filters`: `{ "<constraint id>": { ...threshold } }`; `weights` for the soft score;
  `unknown_passes` (default false).
- Response: per candidate, `viable`, the list of `ConstraintResult` (value, threshold, margin, basis, fraction,
  ranges, note), and for viable ones the soft `score` with its `parts` and the `weights` used. Sorted: viable by
  score, then the rest. Include the counts and the filters that eliminated the most candidates.
- Logic: `services.constraint_context` per candidate, `constraints.evaluate_constraints`, `constraints.all_pass`,
  `scoring.score_metrics`. A grid sweep can pre-filter with `db/grids.py: sample_many` before running the engine.
- Done when: a request with two filters returns every catalogue site with a pass/fail per filter, and an unknown
  constraint id returns 422.

## SW-2 · Compare and mission profiles

**Status:** to do.

- `POST /api/v1/compare`: several sites × several start dates in one call; returns metrics and score per cell
  (this feeds a site-by-date heat map).
- `GET /api/v1/mission-profiles`: named presets (panel area, efficiency, load, battery, antenna, data rate,
  mission duration, default thresholds). The values come from MECH and AERO-2 with sources; keep them in
  `data/mission_profiles.json` with a `source` per value.

## SW-2 · Frontend client, CI, deploy

**Status:** in progress on `feat/sw2-web-shell`: web app per the frontend plan (map with LOD, shadows and layers;
panels; timeline; mission mode; comparison), client generated from `/openapi.json`, web CI. Calls `/state`,
`/series`, `/points/*`, `/candidates/search`, `/power`, `/craters` when they are deployed; contract for the
terrain tiles in `docs/web-tileset.md`. Deploy not set up (team decision). Typed client generated from `/openapi.json`; a GitHub Actions workflow running both test
suites; a public host that answers `/health` with no login. Ask the team before deploying anything.

---

## AERO-1 · Hard filter: solar elevation at landing

**Status:** to do. **File:** `logic/constraints/sun_elevation.py`.

- Threshold: `{ "min_deg": float, "max_deg": float | null }`. Evaluated at the landing instant (`ctx.start_ms`,
  first sample of the series). Return the elevation, both limits and the margin to the nearer one.
- State in the docstring why the range matters (shadow length for hazard detection, glare, thermal) with a source.

## AERO-1 · Hard filter: craters, and the rocks gap

**Status:** to do. **File:** `logic/constraints/hazards.py`.

- `crater_density`: threshold `{ "max_per_km2": float, "radius_km": float, "min_diam_km": float }` using
  `ctx.lookups["crater_density_per_km2"]` (extend `point_lookups` if the radius must follow the request), or
  `nearest_crater_rim_km`. Data: `db/craters.py`.
- `rock_abundance`: register it and return `passed=None, basis="unavailable"` with a note naming the missing
  dataset. Do not approximate rocks from craters.

## AERO-1 · Review and validation

**Status:** to do. Review `logic/constraints/slope.py` and `light.py` and the horizon method in
`docs/data-and-computation.md`. Add validation cases against real missions (computed sunset versus the reported
one) as tests with the source of each date in `docs/references.md`.

---

## AERO-2 · Hard filters: communication hours and maximum blackout

**Status:** to do. **File:** `logic/constraints/comms.py`.

- `comms_hours`: threshold `{ "min_hours": float }` or `{ "min_fraction": float }` over the mission window, from
  `ctx.series.comms(ctx.params)`. Fill `fraction` and `ranges`.
- `max_blackout`: threshold `{ "max_hours": float }` against `ctx.metrics.longest_blackout_h`.

## AERO-2 · Radio link levels

**Status:** to do. **Files:** `logic/link.py`, `routers/link.py`, `schemas/link.py`, `tests/test_link.py`.

- `POST /api/v1/link` with `level`:
  1. Earth visible (already in the engine: fraction of the disc above the horizon).
  2. Ground-station visibility: is the Moon above a minimum elevation at each station at that time. Needs the
     station coordinates (cite the source) and the Earth's orientation; the tables give the Earth-Moon vector
     in MOON_ME, so decide with the team how to get the sub-lunar point (SPICE in the pipeline, precomputed).
  3. Link budget: EIRP, free-space loss with the real distance (`series.earth_dist_km`), receiver G/T, required
     Eb/N0, margin, achievable data rate. Every parameter has a unit and a source.
- `logic/link.py` is pure: inputs are arrays and parameter dataclasses, outputs are arrays.

## AERO-2 · Radiation

**Status:** to do. **Files:** `logic/radiation.py`, `logic/constraints/radiation.py`.

- No dose dataset is loaded. Proposal to evaluate: an open-sky dose rate from a cited NASA source scaled by the
  sky solid angle at the point (`ctx.lookups["sky_visibility_sr"]`, a flat plain sees 2π sr), integrated over
  the mission duration; threshold `{ "max_dose": float, "unit": str }`.
- If no defensible reference value is found, register the filter and return `basis="unavailable"`.

---

## MECH · Power levels

**Status:** to do. **Files:** `logic/power.py`, `routers/power.py`, `schemas/power.py`, `tests/test_power.py`.

- `POST /api/v1/power` with `level`:
  1. Fraction of the solar disc visible (engine).
  2. Array power: `series.power_w_m2` (irradiance × visible fraction × panel factor) × area × efficiency ×
     derating; the three panel models are in `engine.panel_factor`.
  3. Energy balance: load, battery capacity and state of charge through the dark stretches; does the mission
     survive the longest night.
- Inputs as a parameter dataclass with units; three hand-worked cases as tests.

## MECH · Thermal model and maximum temperature

**Status:** to do. **Files:** `logic/thermal.py`, `logic/constraints/temperature.py`.

- `max_temperature`: threshold `{ "max_k": float, "mode": "discrete" | "continuous", "max_hours_above": float }`.
  Discrete fails if the limit is exceeded at any sample; continuous fails if it stays exceeded longer than
  `max_hours_above` (use `engine.longest_run`). Fill `fraction` and `ranges` of the time above the limit.
- The temperature series comes from a model (state its assumptions) or from a measured dataset added through
  the dataset recipe. Say in the result which one (`basis`).

## MECH · Soft score

**Status:** reference in place (`logic/scoring.py`: sunlight, comms, continuity). Decide the criteria and the
default weights with the team, add criteria as functions in `CRITERIA`, keep every weight visible in responses.

## MECH · Demo video and form texts

**Status:** to do. `docs/demo-script.md` and `docs/submission.md` were written for an earlier prototype; update
them to this product. Video of 30 seconds or less.
