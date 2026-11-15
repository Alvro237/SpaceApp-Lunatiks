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

**Status:** done (on `main`), validated (output format: `docs/sw1-output-format.md`). **Files:** `routers/state.py`, `schemas/state.py`, `tests/test_state.py`.

- `GET /api/v1/sites/{site_id}/state?t=&mast_m=&comms_min_fraction=` (`mast_m` absent or null = 0 m)
- Response: Sun and Earth `az`, `el`, `horizon_el`, `visible_fraction`, `visible`, `angular_radius_deg`,
  `distance_km`; `eclipse`, `sun_eclipsed_fraction`; `next_sun_transition` and `next_earth_transition` (`kind`,
  `at`, `in_hours`); `horizon_kind`. No irradiance or power: those belong to MECH's `/power` (owner's decision).
- Logic: `services.model_for_site` + `engine.evaluate` at one instant + `engine.next_transition`. No new physics.
- Done when: the values for a fixture case in `tests/fixtures/horizons_reference.json` match within 0.01 degrees
  through the HTTP layer, and a date outside the tables returns 400.

## SW-1 · Series over a window

**Status:** done (on `main`), validated (output format: `docs/sw1-output-format.md`, plan:
`docs/sw1-roadmap.md`). **Files:** `routers/state.py` (same router), `schemas/state.py`, `tests/test_series.py`.

- `GET /api/v1/sites/{site_id}/series?start=&duration_h=&step_min=&mast_m=...`
- Response: arrays (`t`, Sun and Earth az/el/horizon_el/fraction/visible, `eclipse`, `sun_eclipsed_fraction`),
  `metrics` (the `Metrics` dataclass without power), `sunlit_ranges`, `comms_ranges` and `eclipse_ranges` (edges
  refined to the second), `horizon_kind`. No power: MECH's `/power` (owner's decision).
- Guard: cap the number of samples (for example 20 000) and return 422 above it.

## SW-1 · Horizon profile

**Status:** done (on `main`), validated (output format: `docs/sw1-output-format.md`).
**Files:** `routers/horizon.py`, `schemas/horizon.py`, `tests/test_horizon.py`.
`GET /api/v1/sites/{site_id}/horizon?mast_m=&include_zone=` returns the 720 azimuth values, `kind`, the mast
actually used, and optionally the zone neighbours (`db/horizons.py: zone`).

## SW-1 · Mission mode: area search

**Status:** done (on `main`, #21). **Files:** `routers/areas.py`, `schemas/areas.py`,
`area_search.py` (glue), `logic/areas.py` (raster helpers, quadtree), `db/landings.py`, `tests/test_areas.py`.

- `POST /api/v1/areas/search`: which cells of a bounded disc (centre south of 60 S, radius up to 400 km, at most
  360 000 cells of 0.24 to 7.68 km) pass every filter given. No threshold has a default: a filter is on when its
  value is sent. Answer: the raster (`codes_b64`, `score_b64`, uint8, row 0 at the top, south polar stereographic
  grid in `grid`), cell counts, the funnel (cells in, out and without data per filter, in run order), the 12 largest
  connected viable areas with their best cell and the catalogue sites inside, the window sampling used and the
  assumptions in words. The last 16 answers are kept in memory (same request, same answer, no recomputation).
- Funnel: map filters on every cell first (side, past landings, slope, elevation, permanent shadow, crater rims,
  crater density, long-term Sun and Earth, open sky, dose, near a PSR, hydrogen), each cell reading every grid pixel inside it
  (k x k sub-grid, k = cell / finest pixel, at most 8; slope and shadow take the worst, the rest the mean); then the
  landing radius (a disc dilation of the failures); then the window filters (sunlight, darkness, contact, blackout,
  Sun height and Earth at landing, mean power, light and contact left, Sun and Earth together, robust to a delay)
  on at most `max_window_samples` samples placed by a quadtree, each with its own ray-traced horizon.
- Filters the data cannot answer are not in the request (roughness: the LOLA roughness file has no confirmed
  units; rocks: no open pole-wide boulder map; link margin, temperature, battery and colony: per spot, in the power
  endpoints; solar storm risk: no forecast). Hydrogen reads `lp_hydrogen_60s` (Lunar Prospector, 0.5 deg bins).

## SW-1 · Manual coordinates

**Status:** `points/state`, `points/series` and `points/horizon` done (on `main`), validated (output format:
`docs/sw1-output-format.md`); `points/info` not assigned in the team table.
**Files:** `routers/points.py`, `schemas/points.py` (the site models plus `terrain_reference`),
`tests/test_points.py`.

- `GET /api/v1/points/horizon?lat=&lon=&mast_m=`: 360-degree skyline of any point, ray-traced over the LOLA
  elevation grids (`lola_elevation_80s` 240 m near the pole, `lola_elevation_60s` 960 m to 60 S; smooth sphere
  outside). Exact curvature, 720 azimuths to 250 km (`logic.horizon.ray_traced_horizon`, `services.point_horizon`).
  Measured against the 13 catalogue masks: median RMS 0.21 deg, 11 of 13 within 0.5 deg, worst Mons Malapert
  3.25 deg (`tests/test_point_horizon.py`). `points/state`, `points/series` and the MECH window endpoints take
  `horizon=terrain` to use it; the default stays `smooth_sphere` (the contract they were validated on).
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
terrain tiles in `docs/web-tileset.md`. Live terrain levels z8-z10 (20 m and 10 m LOLA DEMs read block by block
from PGDA) on `feat/sw2-live-dem`; production needs the CORS proxy deployed (team decision). Educational mode (formerly Learn mode and Block Moon), drawn as a world of cubes from the same LOLA data and engine, on `feat/sw2-block-moon`; its mission system redesigned for children (mission map, one step at a time with a button, twelve missions) on `feat/sw2-educational-missions`. Deploy not set up (team decision). Typed client generated from `/openapi.json`; a GitHub Actions workflow running both test
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

**Status:** done (on `main`, #15). Line of sight to the Earth by default; they use the radio-link contact series when
the context carries it (see the link section). **File:** `logic/constraints/comms.py`.

- `comms_hours`: threshold `{ "min_hours": float }` or `{ "min_fraction": float }` over the mission window, from
  `ctx.series.comms(ctx.params)`. Fill `fraction` and `ranges`.
- `max_blackout`: threshold `{ "max_hours": float }` against `ctx.metrics.longest_blackout_h`.

## AERO-2 · Radio link levels

**Status:** level 1 done; level 2 in review on `feat/aero2-link-level1` (built on the station dataset, the Moon in
the Earth-fixed frame, `logic/stations.py`, `db/stations.py`). `POST /api/v1/link` answers with the networks you
select (`networks`), your own antennas (`custom_stations`) and a `direction` (downlink, uplink low or high power).
Level 2 adds a `budget` that needs only the lunar terminal's EIRP and the data rate: the band (S, X, Ka) or a typed
frequency sets the carrier, each antenna uses its own downlink G/T (DSN 810-005, JAXA Misasa specification, or an
estimate from the dish diameter), and the required Eb/N0 (9.6 dB) and margin (3 dB) have stated defaults. It returns
the Eb/N0 margin per antenna and the time the link is closed. `GET /api/v1/link/stations` lists the catalogue. The hard filters `comms_hours` / `max_blackout` use the combined contact series when the context
is built with `services.constraint_context(..., link_networks=[...])` (SW-2: pass the networks the user selected);
without it they keep using the Earth's line of sight alone.
**Files:** `logic/link.py`, `routers/link.py`, `schemas/link.py`, `tests/test_link.py`.

- `POST /api/v1/link` with `level` (team decision 2026-11-14: contact needs BOTH ends, so station visibility is
  part of level 1 and the link budget is level 2; each level includes the one before):
  1. Geometric contact. There is contact at an instant when (a) the site sees the Earth (at least
     `comms_min_fraction` of its disc above the local horizon, as the engine computes) AND (b) at least one
     antenna of the networks selected in the request (`networks`, plus optional user-defined antennas) sees the
     Moon above that antenna's minimum elevation. Needs the station coordinates and the Earth's orientation
     (NAIF kernels, see `docs/references.md`), precomputed by the pipeline as the Moon's elevation per station.
     A minimum elevation without a cited source is flagged in the response (`owner_estimate`), never silent.
  2. Link budget: EIRP, free-space loss with the real distance (`series.earth_dist_km`), receiver G/T, required
     Eb/N0, margin, achievable data rate. Contact then means margin >= a minimum margin given by the user.
     Every parameter has a unit and a source.
- Satellite relays in lunar orbit are out of scope for now (team decision 2026-11-14).
- The hard filters `comms_hours` and `max_blackout` use the combined contact series of level 1 when the
  `ConstraintContext` carries it (`ctx.contact`, filled by `services.constraint_context(link_networks=...)`).
- `logic/link.py` is pure: inputs are arrays and parameter dataclasses, outputs are arrays.

MECH integration guide (requests, fields to show, conventions, errors): `docs/api-guide-mech.md`.

## MECH · Radiation (moved from AERO-2, team decision 2026-11-14)

**Status:** done (on `main`). **Files:** `logic/radiation.py`, `logic/constraints/radiation.py`,
`db/radiation.py`, `routers/radiation.py`, `schemas/radiation.py`, `tests/test_radiation.py`,
`pipeline/lunarnav/crater_dose.py`, `data/radiation/crater_dosimeter_daily.json`.

- Data: LRO CRaTER dosimeter daily dose rate (2009-06-19 to 2013-04-30), free-space GCR equivalent, mGy(Si)/day.
- `POST /api/v1/radiation`: surface GCR dose = free-space x (open sky / 4π), sky from PGDA 69 (south of 65° S) or
  2π on a smooth sphere; mission dose as low / mean / high (5th, mean, 95th percentile daily rate);
  `basis="climatology"` (mission dates are outside the record). Effective dose in mSv and the share of the
  NASA-STD-3001 career limit (600 mSv) only when the caller gives `si_to_tissue_factor` and `quality_factor`
  (no cited value yet). Largest SPE day of the record reported for context (2012-03-08, 84 mGy in orbit).
- Si -> water conversion defaults to 1.333 (CRaTER team, NASA ISWA CRaTER page). `quality_factor` stays an
  input (MSL RAD cruise, Zeitlin et al. 2013, implies about 3.8: to verify in the paper).
- `risk` (with `quality_factor`): astronaut risk 1-10 = 1 + 3 log10(share of the 600 mSv career limit / 0.1 %),
  clipped; 0.1 % -> 1, 1 % -> 4, 10 % -> 7, 100 % -> 10 (a presentation scale, team decision). Also the index if
  the record's largest storm day hit the mission (storm with Q = 1, lower bound, isotropic approximation).
- Hard filter `max_dose`: threshold `{ "max_mgy_si": float }`, GCR only.
- Not modelled: albedo particles from the regolith (surface value is a lower bound), habitat shielding, SPE forecasts.

---

## MECH · Power levels

**Status:** done (on `main`). `site_id` or `lat`/`lon`. Every panel and battery parameter is a
required input (no cited default yet); `night_load_w` defaults to `load_w`. No educational/advanced switch in the
API: the frontend chooses what to show. Max 20 000 samples. Eclipses: array power x (1 - obscuration), where
obscuration is the fraction of the solar disc covered by the Earth (`logic/eclipse.py`); the engine's
`power_w_m2` alone ignores eclipses. Response adds `obscuration`, eclipse ranges and `eclipse_energy_loss_wh`. Shared request base `schemas/common.py`
(`WindowRequest`, `WindowResponse`) and helpers `routers/common.py`, reused by the next MECH endpoints.
**Files:** `logic/power.py`, `routers/power.py`, `routers/common.py`, `schemas/power.py`, `schemas/common.py`,
`tests/test_power.py`.

Contract = the team's API rules (2026-11-14), flat fields:

- Input, always: `site_id` or `lat` + `lon`, `start`, `duration_h`, `step_min`, `panel`, `level` (1-3).
  Height above the ground fixed at 2 m for panels, antenna and habitat in every MECH endpoint, `/sweep` included
  (team decision 2026-11-14: most panels sit on structures); `mast_m` is no longer an input, `mast_m_used` = 2.
  Level 2: `panel_area_m2`, `cell_efficiency`, `derating`. Level 3: `load_w`, `battery_capacity_wh`,
  `battery_initial_soc`, `battery_min_soc`, `charge_efficiency`, `discharge_efficiency`. Extra: `night_load_w`.
- Response, always: `level`, `horizon_kind`, `assumptions[]`. Level 1: `t[]`, `sun_fraction[]`, `sun_el_deg[]`,
  `sunlit_ranges[]`. Level 2 adds `irradiance_w_m2[]` (irradiance reaching the panel: solar irradiance x visible
  fraction x orientation factor x (1 - eclipse obscuration)), `power_w[]`, `mean_power_w`, `energy_wh`. Level 3 adds
  `net_power_w[]` (power - load), `battery_soc[]`, `min_soc`, `survives`, `first_depletion_at`, `longest_dark_h`,
  `energy_margin_wh` ((min_soc - battery_min_soc) x capacity when it survives, minus the unserved energy when not).
  Fields of a higher level are null at lower levels. Extras beyond the rules (eclipse ranges and loss, peak power,
  load profile, final SoC, depleted ranges, unserved / curtailed energy, usable capacity) may be ignored.
  Extra `mean_power_w_m2` (all levels): mean of `irradiance_w_m2` over the window, W/m2, for comparing places
  without a panel size; the same value as `/sweep` `mean_power_w_m2` for that landing.
- The same flat names are used by `/sweep` and by the `battery_survives` hard filter threshold.

Level 4, colony analysis (team decision 2026-11-14; an extension beyond the API rules). **Files:**
`logic/colony.py`, `logic/thermal.py` (`surface_implicit`), `tests/test_colony.py`.

- Input: levels 2-3 without `load_w`, plus `critical_load_w`, `deferrable_load_w`, `comms_load_w` (only while the
  Earth is visible; `comms_critical` false by default), `shed_soc` (deferrable loads off below it),
  `max_charge_w`, `max_discharge_w`, `habitat` (two-node model: `crew_count`, `t_set_k`, `t_min_k`, `ua_w_k`,
  `area_m2`, `skin_absorptivity`, `skin_emissivity`, `structure_mass_kg`, `structure_specific_heat_j_kgk`,
  `air_volume_m3`, `air_pressure_pa`, optional `metabolic_w_per_crew`); `regolith` optional (lunar default, Hayne et al. 2017).
  `duration_h` at least one synodic month (708.7 h); a year is recommended at the poles.
- Heating: interior held at `t_set_k`; skin solved each step against sunlight on 0.5 x area, ground view factor
  0.5 (both team decisions), ground infrared from the regolith model; heater = leak - crew heat - electrical load
  served inside (all of it ends as heat). Crew heat default 140.6 W per person = mean of the 40-year-old male and
  female rates of NASA BVAD Table 3-21 (team decision). Surplus heat is a cooling demand, without electrical cost.
- Failure = critical load (life support + holding heater, + comms if critical) not served; shedding the
  deferrable loads is degraded mode. Status: `failure_after_x_days` (simulated time), `survives_independently`
  (battery ends the last whole synodic month at least as full as it started, possibly after repeating the window
  from its end state, so the repeated window never fails) or `survives_window_declining`.
- Output, besides the levels 1-3 fields (taken from this model): status and failure time, SoC change per synodic
  month, critical and total demand, heater, cooling demand, interior / skin / ground temperatures, autonomy (hours
  on battery alone), sunrise margin (in the dark: stored energy minus what is needed until sunrise), degraded
  ranges and days, interior-below-minimum ranges, energy breakdown (conserved to 1e-6 Wh in tests), crew heat,
  heat capacity, unheated equilibrium and cold-soak hours at the coldest moment, and the smallest battery and
  array that survive independently (bisection, within 0.4 %). A year at one-hour steps takes about 1.5 s.

## MECH · Sun over a mission window

**Status:** done (on `main`). `POST /api/v1/sun` with the shared window request. Returns the state at
start (elevation, azimuth, visible fraction, skyline height in the Sun's direction), elevation / azimuth /
visible-fraction series, elevation stats, sunlit fraction, hours and ranges, longest sunlit and dark stretches,
next sunset or sunrise (to about one second) and hours to sunset, eclipses (Earth over the Sun: partial or total,
start, end, duration) with fraction and ranges. Check: the 2025-03-14 eclipse at Blue Ghost 1 comes out total,
05:01-09:51 UTC at a 1-minute step (4.85 h).
**Files:** `logic/sun.py`, `routers/sun.py`, `schemas/sun.py`, `tests/test_sun.py`.

## MECH · Earth over a mission window

**Status:** done (on `main`). `POST /api/v1/earth` with the shared window request plus
`comms_min_fraction` (default 0.5, team convention). Returns the state at start (elevation, azimuth, visible
fraction, skyline height, distance, angular radius), series, visibility windows (fraction, hours, ranges), longest
window and longest blackout, next Earthset or Earthrise and hours to Earthset, and the libration wander (azimuth and
elevation span over the window). Geometry only: the link budget is a separate model. Checks: equator at 0° E always
sees the Earth, 180° E never; Malapert 100 %, Shackleton floor 0 % in March 2027.
**Files:** `logic/earth.py`, `routers/earth.py`, `schemas/earth.py`, `tests/test_earth.py`.

## MECH · Replanning sweep

**Status:** done (on `main`). `POST /api/v1/sweep`: up to 25 places (`site_id` or `lat`/`lon`) x up to
2000 landing times (`first_landing`, `landings`, `landing_step_h`) for one `stay_h`. One series per place;
prefix sums for fractions, windows processed as a matrix for longest runs and the battery. Per landing:
sunlight, comms and both fractions, longest dark and blackout, eclipse hours, mean power per m2 (eclipses
included); with the panel fields (`panel_area_m2`, `cell_efficiency`, `derating`) the mean array power; adding
the battery fields of `/power` level 3, survival, minimum SoC and unserved energy.
GCR dose per stay (CRaTER climatology). Every window equals the single-window endpoints (tests). Measured:
21 sites x 365 landings x 14-day stay with battery in about 1 s.
**Files:** `logic/sweep.py`, `routers/sweep.py`, `schemas/sweep.py`, `tests/test_sweep.py`.

## MECH · Thermal model and maximum temperature

**Status:** done (on `main`). **Files:** `logic/thermal.py`, `logic/constraints/temperature.py`,
`routers/thermal.py`, `schemas/thermal.py`, `tests/test_thermal.py`.

- `POST /api/v1/thermal`: regolith surface temperature from 1-D conduction (constant properties, geometric grid
  from the diurnal skin depth, explicit sub-steps) forced by the absorbed solar flux on flat ground (horizon and
  eclipses included); optional lumped equipment node; optional `limits` (`max_k`, `min_k`, discrete or
  continuous) with fraction, longest run and ranges beyond each limit. Regolith defaults to lunar values
  (`logic/thermal.py` `LUNAR_REGOLITH`, team decision 2026-11-14): albedo 0.12, emissivity 0.95 and heat flow
  0.018 W/m2 from Hayne et al. 2017 Table A1, and k, rho, c as the one-layer equivalent of their global thermal
  inertia (55 at 273 K): c = c_p(273 K) = 719.7, rho = 1478, k = 2.84e-3. Equipment values stay inputs. With test inputs (albedo 0.12, eps 0.95, k 0.002, rho 1500, c 600) the equator gives 386 K at
  noon and 96 K at night. Not modelled: terrain infrared (shadowed floors come out too cold: Shackleton 24 K),
  temperature-dependent properties, slope, spin-up before the window.
- `max_temperature`: threshold `{ "max_k": float, "mode": "discrete" | "continuous", "max_hours_above": float,
  "regolith": {...}, "equipment": {...} optional }`.
  Discrete fails if the limit is exceeded at any sample; continuous fails if it stays exceeded longer than
  `max_hours_above` (use `engine.longest_run`). Fill `fraction` and `ranges` of the time above the limit.
- The temperature series comes from a model (state its assumptions) or from a measured dataset added through
  the dataset recipe. Say in the result which one (`basis`).

## MECH · Soft score

**Status:** verdict done on `feat/mech-power`; default weights (0.5 / 0.3 / 0.2) and bands (75 / 50) are still
the prototype's, not yet decided with a source. `POST /api/v1/verdict` (RF-11): runs the requested hard filters
(`hard_filters`: id -> threshold), then the soft score with visible, adjustable `weights`, `favourable_min`,
`marginal_min`. Verdict: `unfeasible` if any filter fails, `unknown` if any cannot be evaluated (unless
`unknown_passes`), else the score band. New hard filter `battery_survives` (`logic/constraints/power.py`,
threshold = the flat level-3 fields of `/power`), same model as `/power` level 3.
**Files:** `logic/scoring.py` (`overall_verdict`, band arguments), `routers/verdict.py`, `schemas/verdict.py`,
`logic/constraints/power.py`, `tests/test_verdict.py`.

## MECH · Validation report

**Status:** done (on `main`). `GET /api/v1/validation`: the pipeline's validation (`data/validation.json`:
ephemeris vs JPL Horizons and the Apollo tables, terrain vs LROC) plus 8 MECH model checks run live on the real
datasets, each with reference, source, computed value, tolerance and pass/fail: Blue Ghost eclipse 2025-03-14
(NASA GSFC), disc-overlap analytic case, near/far-side Earth visibility, thermal radiative equilibrium, dark
equipment balance, energy conservation of the battery model, sweep vs single window, radiation flat-ground
shielding and CRaTER record. First call about 0.6 s, then cached.
**Files:** `app/validation_checks.py`, `routers/validation.py`, `tests/test_validation.py`.

## MECH · Demo video and form texts

**Status:** texts updated to this product on 2026-11-15 (`docs/demo-script.md`, `docs/submission.md`); the video
(30 seconds or less) and the form's links and SI paragraph are the team's to finish.

## Mission design: suitability search

**Owner:** to be set (the role was not chosen when PR 1 was prepared). Spec: `docs/mission-design-spec.md` (API) and
`docs/mission-planner-ui-spec.md` (web).
**Status:** in progress. PR 1 (`logic/bounds.py`, the ephemeris visibility bound, no endpoint yet) is written, tested
and validated against the LOLA terrain masks; method and validation output in `docs/data-and-computation.md`
("Ephemeris visibility bound"). Stage A of the web mission design (the "Mission planner inputs" panel, live preview,
compare selected areas) is built against the existing `/api/v1/areas/search` and merged. The suitability API
(Stage B / PR 3 below) is not built: every Stage B input in the web panel is shown disabled with "Comes with the
suitability search".
**Files, PR 1 (done):** `api/app/logic/bounds.py`, `api/tests/test_bounds.py`, `api/tests/validation_bounds.py`.
**Files, PR 2 (crater shape, independent, to do):** `pipeline/lunarnav/crater_shape.py`, `pipeline/tests/test_crater_shape.py`,
`api/app/db/craters.py` (additive), `data/README.md`, `docs/references.md`.
**Files, PR 3 (suitability API, to do):** `api/app/schemas/suitability.py`, `api/app/logic/suitability.py`,
`api/app/suitability_search.py`, `api/app/routers/suitability.py`, `api/app/db/nomenclature.py`, `api/app/db/store.py`
(additive), `api/app/main.py` (additive), `api/tests/test_suitability_logic.py`, `api/tests/test_suitability.py`,
`api/tests/bench_suitability.py`.
**Files, web Stage A (done):** `web/src/mission/*`, plus additive edits to `app/NavigatorPage.tsx`, `globe/GlobeView.tsx`,
`globe/orbit.ts`, `terrain/TerrainView.tsx`, `terrain/cameraRig.ts`, `terrain/shaders.ts`, `terrain/engine.ts`,
`ui/Tip.tsx`, `ui/panels.css`, `map/markerArt.ts`, `map/markerSet.ts`, `map/useMapSites.ts`, `state/areas.ts`,
`scripts/copy_static_data.mjs`. `panels/MissionPanel.tsx` and `panels/missionFilters.ts` are left in place, unmounted.
**Files, web Stage B (to do, after PR 3):** the mission design spec's section 6 and the UI spec's section 9.
