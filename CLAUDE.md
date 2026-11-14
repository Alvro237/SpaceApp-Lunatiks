# Lunar Landing Site Navigator — team Lunatiks

NASA Space Apps Challenge 2026 entry for the challenge
["Lunar Landing Site Navigator"](https://www.spaceappschallenge.org/2026/challenges/lunar-landing-site-navigator/?tab=details).
Five people work in this repository at the same time, each with their own Claude session.

**Start of every session**

1. **Invoke the `develop-endpoint` skill** (`.claude/skills/develop-endpoint/SKILL.md`) before doing anything
   else. It is the team's workflow: feature branch, layer rules, tests, pull request.
2. Read `docs/STATUS.md` (what is done, what is open).
3. Ask the person which role they are and which endpoint or model they are building, then read that
   section of `docs/endpoints.md`. Work only inside the files that section names.

**This file is written only when an endpoint or filter is finished**: the pull request that completes it adds
one row to "Implemented endpoints and filters" below, and nothing else. Work in progress is tracked in the
Status line of your own section of `docs/endpoints.md`. Any other change to this file is a team decision in its
own pull request.

The team chats in Spanish: answer them in Spanish. Everything written to the repository is English.

## Hard constraints

- **Deadline: Sunday 2026-11-15, 23:59 local time** of the team's Local Event. Nothing saved later is judged.
- **Everything shipped is in English**: code, comments, API fields, docs, commit messages, UI.
- **AI use is declared.** Code and data produced with AI assistance are acknowledged in `README.md` and in the
  product's data page. AI-generated images or video need a visible watermark. No NASA logos or mission insignia.
- **Every external resource is listed** in `docs/references.md` when it is added (the submission form needs it).
- Final project link and demo link open with no login. Demo: video of **30 s or less**, English or English
  subtitles. No images or likeness of people under 18.
- **No CNSA datasets** (NASA's China restriction).
- **One branch per functionality; `main` changes only through a reviewed pull request.** Never commit or push to
  `main`, never merge your own pull request. Ask the person before you push, deploy, publish or open a pull
  request.
- **Do not claim a number you did not measure.** Thresholds and defaults need a cited source or the owner's
  explicit decision; a value that no dataset provides is reported as unknown (`null`), never guessed.

## The challenge in short

Missions to the lunar south pole depend on the Sun (power, thermal) and the Earth (direct communication) as seen
over the local horizon. Tools that compute this exist (QuickMap, Moon Trek, JPL Horizons) but none lets a planner
compare sites and dates at a glance or re-plan quickly when a schedule slips. The challenge asks for an intuitive
tool for mission planners, educators and the public. Only one objective is written as an obligation: show the Sun
and the Earth relative to the horizon at a chosen site and date. The rest ("may consider") is the judges'
coverage checklist: curated sites and custom coordinates, side-by-side comparison, date and time selection, time
to sunset and Earthset, solar elevation, sunlight duration, Earth visibility windows, 2D/3D views, timelines,
real LOLA topography, airless horizon, libration, steep polar terrain, support for science-engineering
coordination. Full list with IDs: `docs/requirements.md`.

Judging, 1 to 5 each: **Impact, Creativity, Validity, Relevance, Presentation.** Relevance scores NASA data used
as the core of the solution. The team's priority is data: number and quality of sources and a visible, rigorous
normalisation process. Every dataset therefore carries provenance and every response says what it is based on.

## What we are building (the team's design)

An **API-first** product. A FastAPI backend computes everything; the frontend only renders and can be built with
anything, because the contract is the OpenAPI document served at `/openapi.json`. The frontend approach is not
decided yet: do not create frontend code until the team says how.

The user flow the API must serve:

1. **Choose where.** Pick a catalogue site, type manual coordinates, or configure mission filters and get the
   points that are viable for study.
2. **Choose when.** For any site, choose a date and time and get the Sun/Earth state, the time to sunset and
   Earthset, and the series over the mission window.
3. **Assess.** Levels of calculation for power and for the radio link.

### Mission analysis model

**Hard filters (pass or fail).** Each restriction is one function with a threshold set by the user's inputs.
A site that fails any hard filter is out; it does not just score lower.

| Hard filter | Based on | State |
| --- | --- | --- |
| Maximum slope | LOLA slope (site value or screening grid) | Implemented: `max_slope` |
| Continuous light during the mission duration | Engine series over the terrain horizon | Implemented: `continuous_light` |
| Direct-communication hours and maximum blackout | Engine series (Earth disc fraction) | To build |
| Solar elevation at landing | Engine state at the landing instant | To build |
| Craters | Robbins (2018) crater density | Data loaded, filter to build |
| Rocks | **No dataset in the repository** | Report as unavailable; see "Known data gaps" |
| Maximum temperature, continuous or discrete | Thermal model or Diviner data | To build; data not loaded |
| Radiation | Sky-visibility grid as a shielding proxy; no dose dataset | To build; data gap |

**Soft score among the sites that pass.** A weighted mean with weights that the user sees and can adjust
(`app/logic/scoring.py`). Never hide a weight and never fold a hard filter into the score.

**Time answers come in two forms.** Any time-based result is given both as a **fraction of the time** and as
**time ranges** (`fraction` and `ranges` in `ConstraintResult`; `visibility_ranges()` in the engine).

**Temperature limits have two readings**: *discrete* (the limit is exceeded at any instant) and *continuous*
(it stays exceeded for longer than N hours). The request says which one applies.

## Repository layout

```
api/                     FastAPI backend (uv project)
  app/
    main.py              app factory; register routers here
    config.py            settings from environment variables
    routers/             HTTP only: validate, call, shape the response. One file per endpoint group.
    schemas/             Pydantic request and response models. snake_case JSON.
    services.py          glue shared by several routers: build a site model, look up datasets at a point
    logic/               THE LOGIC. Pure functions over NumPy arrays. No files, no network, no FastAPI.
      engine.py          Sun/Earth over a horizon across time: evaluate, metrics, ranges, next transition
      ephemeris.py geometry.py horizon.py visibility.py projection.py constants.py
      scoring.py         soft score
      constraints/       hard filters: base.py (contract + registry), one module per filter
    db/                  THE DATA ACCESS. Reads data/ and returns arrays or plain objects. No physics.
      store.py           DataStore: the single entry point (Depends(get_store))
      sites.py ephemeris.py horizons.py grids.py craters.py
  tests/                 pytest; fixtures/ holds the Horizons and Apollo reference data
data/                    THE DATASETS, committed, ~42 MB. Dictionary and caveats: data/README.md
  raw/                   git-ignored downloads and caches (SPICE kernels, source rasters, crater zip)
pipeline/                Python package `lunarnav` that regenerates data/ from NASA sources
docs/                    STATUS, endpoints (specs and owners), requirements, data-and-computation,
                         references, submission, demo-script, accessibility
.claude/skills/develop-endpoint/   the team's development workflow, invoked at the start of every session
.github/pull_request_template.md   the checklist every pull request fills
```

### Layer rules (do not bend them)

- `logic/` never imports from `db/`, `routers/`, `schemas/` or FastAPI, and never opens a file. It receives
  arrays and plain values and returns arrays or dataclasses. That is what makes it testable by an engineer with a
  hand-worked case.
- `db/` never computes physics. It decodes files into arrays and objects. A new dataset gets a repository class
  there and a field in `DataStore`.
- `routers/` hold no formulas. If a router needs data and logic combined, put that in `services.py`.
- `schemas/` are the contract. Field names are snake_case, units are in the field description, times are
  ISO 8601 UTC strings on the wire and Unix milliseconds inside `logic/`.
- Shared files (`main.py`, `services.py`, `logic/engine.py`, `db/store.py`): additive edits only, and tell the
  team. One owner per other file; do not edit a file that belongs to another role without asking them.

## Implemented endpoints and filters

**The only section of this file edited during development.** Add a row in the pull request that finishes the
work: merged, tested, called on a running server. Not before.

| Kind | Name | Files | Owner | Notes |
| --- | --- | --- | --- | --- |
| Endpoint | `GET /health` | `routers/meta.py` | scaffold | Liveness and what data is loaded |
| Endpoint | `GET /api/v1/sites` | `routers/sites.py` | scaffold | Catalogue; filters `group`, `terrain_only` |
| Endpoint | `GET /api/v1/sites/{site_id}` | `routers/sites.py` | scaffold | Site with source and terrain summary |
| Endpoint | `GET /api/v1/meta/datasets` | `routers/meta.py` | scaffold | Provenance of every dataset |
| Endpoint | `GET /api/v1/meta/constraints` | `routers/meta.py` | scaffold | Registered hard filters, default score weights |
| Hard filter | `max_slope` | `logic/constraints/slope.py` | scaffold | Dataset-based reference; AERO-1 to review |
| Hard filter | `continuous_light` | `logic/constraints/light.py` | scaffold | Time-based reference; AERO-1 to review |
| Soft score | sunlight, comms, continuity | `logic/scoring.py` | scaffold | Visible weights; MECH to set criteria and defaults |
| Endpoint | `POST /api/v1/power` | `routers/power.py`, `logic/power.py` | MECH | Levels 1-3 (Sun fraction, array W, battery SoC); every parameter an input, no unsourced defaults |
| Endpoint | `POST /api/v1/sun` | `routers/sun.py`, `logic/sun.py` | MECH | Solar elevation, sunlight hours and ranges, next sunset/sunrise, eclipses |
| Endpoint | `POST /api/v1/earth` | `routers/earth.py`, `logic/earth.py` | MECH | Earth visibility windows, longest blackout, next Earthset/rise, libration wander |
| Endpoint | `POST /api/v1/radiation` | `routers/radiation.py`, `logic/radiation.py`, `db/radiation.py` | MECH | GCR dose from LRO CRaTER x open sky / 4π; climatology; mSv only with given factors |
| Hard filter | `max_dose` | `logic/constraints/radiation.py` | MECH | Mission GCR dose in mGy(Si) at the point |
| Endpoint | `POST /api/v1/sweep` | `routers/sweep.py`, `logic/sweep.py` | MECH | Places x landing dates for one stay: light, comms, power, battery, dose; ~1 s for 21 x 365 |
| Endpoint | `POST /api/v1/thermal` | `routers/thermal.py`, `logic/thermal.py` | MECH | 1-D regolith conduction + equipment node; limits discrete/continuous; all properties inputs |
| Hard filter | `max_temperature` | `logic/constraints/temperature.py` | MECH | Surface or equipment temperature vs `max_k`, discrete or continuous |
| Hard filter | `battery_survives` | `logic/constraints/power.py` | MECH | Battery carries the load all mission (same model as `/power` level 3) |
| Endpoint | `POST /api/v1/verdict` | `routers/verdict.py`, `logic/scoring.py` | MECH | RF-11: hard filters then soft score; unfeasible / unknown / favourable / marginal / poor |
| Endpoint | `GET /api/v1/validation` | `routers/validation.py`, `app/validation_checks.py` | MECH | Pipeline validation + 8 live model checks with reference, source, tolerance |

Also in place and verified: the engine in `app/logic` (ephemeris, geometry, horizon, disc-visible fraction,
series, metrics, time ranges, next sunset/Earthset; reproduces JPL Horizons to better than 0.01 degrees) and the
data access in `app/db` for every dataset in `data/`. Everything else in `docs/endpoints.md` is to build.

## Who builds what

Roles (the names are in `docs/endpoints.md`):

| Role | Builds |
| --- | --- |
| SW-1 | `/sites/{id}/state`, `/sites/{id}/series`, `/sites/{id}/horizon`, `/points` (manual coordinates); keeps the engine |
| SW-2 | `/candidates/search` (hard filters then soft score), `/compare`, `/mission-profiles`; frontend client, CI, deploy |
| AERO-1 | Hard filters `sun_elevation_at_landing`, `crater_density`, rocks gap; reviews `max_slope`, `continuous_light`; validation cases |
| AERO-2 | Hard filters `comms_hours`, `max_blackout`; radio-link levels (`/link`); radiation |
| MECH | Power levels (`/power`); thermal model and `max_temperature`; soft-score criteria and default weights; video and form texts |

## Recipes

**Adding an endpoint**

1. Schema: request and response models in `app/schemas/<group>.py`, units in the field descriptions.
2. Logic: pure functions in `app/logic/<topic>.py` with a docstring that states the formula and its source.
3. Glue: anything that combines data and logic goes in `app/services.py`.
4. Router: `app/routers/<group>.py`, copy the shape of `routers/sites.py`; register it in `app/main.py`.
5. Tests: `tests/test_<group>.py` with a happy path, a validation error (422), an unknown id (404) and, for a
   model, at least one hand-worked numerical case.
6. Update `docs/endpoints.md` (status of your section) and `docs/references.md` (any new source). When it is
   finished, add its row to "Implemented endpoints and filters" in this file.

**Adding a hard filter**

1. `app/logic/constraints/<name>.py`: a function `(ctx: ConstraintContext, threshold: dict) -> ConstraintResult`
   decorated with `@register("<id>")`. Copy `slope.py` (dataset-based) or `light.py` (time-based).
2. Import the module in `app/logic/constraints/__init__.py`.
3. If it needs a dataset value at the point, add the key to `point_lookups()` in `app/services.py`.
4. Return `passed=None, basis="unavailable"` when the data does not exist there. Time-based filters fill
   `fraction` and `ranges`.
5. Test it in `tests/test_constraints_<name>.py`. It then shows up in `GET /api/v1/meta/constraints`.

**Adding a dataset**

1. A script in `pipeline/lunarnav/` downloads into `data/raw/<name>/` (git-ignored) and writes a compact,
   documented file under `data/` with a JSON sidecar: source URL, citation, units, transformation, build date.
2. A repository class in `app/db/` and a field in `DataStore`.
3. Document it in `data/README.md` and `docs/references.md`. Keep committed files small (a few megabytes).

## Conventions that must not drift

- Frame: **Moon Mean-Earth / polar axis (MOON_ME)**, the frame of LOLA products and of Horizons surface sites.
- Longitude east-positive -180..180, planetocentric latitude, radius 1737.4 km, heights in metres above that sphere.
- Azimuth clockwise from north; angles in degrees in files and in the API.
- Time: UTC on the wire (ISO 8601 with `Z`), Unix milliseconds inside the logic, TDB only inside SPICE.
  Use `services.to_ms`, `services.from_ms`, `services.iso_utc` (not `datetime.fromtimestamp`, which fails
  before 1970 on Windows).
- The Sun and the Earth are discs (0.53 and about 1.9 degrees wide), integrated against the horizon.
- Always subtract the site position before computing angles (Earth parallax up to 0.26 degrees).
- "Sunlit" means any part of the solar disc above the horizon; "comms" means at least `comms_min_fraction`
  (default 0.5) of the Earth's disc above it. Both are parameters, not constants.
- Every response that depends on a horizon says which kind it used: `terrain` or `smooth_sphere`.
- Errors: 404 for an unknown id, 422 for invalid input (FastAPI default), 400 with a clear message when the date
  is outside the ephemeris tables.

## Data in the repository

| Dataset | Source | What it gives |
| --- | --- | --- |
| `sites.json` | NASA NSSDCA, LROC, USGS/IAU Gazetteer | 21 sites with cited coordinates; 13 have LOLA terrain |
| `ephemeris_*.f32` | JPL SPICE kernels (DE440) | Sun and Earth vectors, hourly, 2025-2035 and 1969-1972 |
| `horizons.i16`, `zones.i16` | LOLA DEMs, PGDA product 90 | 720-azimuth terrain horizon masks, 4 mast heights, plus neighbours |
| `grids/lola_slope_*`, `lola_elevation_60s` | LOLA, PGDA product 90 | Slope and height anywhere south of 60 S (80 S finer) |
| `grids/sun_illumination_65s`, `earth_visibility_65s`, `permanent_shadow_65s`, `sky_visibility_65s` | LOLA-derived, PGDA product 69 | 18.6-year averages south of 65 S |
| `craters/robbins_2018.npz` | Robbins (2018), USGS; LRO and JAXA Kaguya data | 1.3 million craters above about 1-2 km |
| `provenance.json`, `validation.json` | Pipeline | Source, version and transformation of each dataset; validation results |

Units, encodings and caveats: `data/README.md`. Method: `docs/data-and-computation.md`.

## Known data gaps (say so in the product, do not paper over them)

- **Rocks**: no boulder dataset. The Robbins catalogue stops at about 1-2 km and says nothing at lander scale.
- **Temperature**: no Diviner product is loaded. A thermal model from the engine's irradiance is an option; any
  measured dataset must be added through the dataset recipe.
- **Radiation**: no dose dataset. `sky_visibility_65s` (solid angle of open sky) can scale an open-sky dose rate,
  which needs a cited source.
- **Terrain horizons** exist for 13 catalogue sites south of 60 S. Everywhere else, including manual coordinates,
  the horizon is a smooth sphere: real terrain can only shorten light and communication. Computing a new terrain
  mask takes minutes per point (the pipeline reads NASA rasters remotely).
- **Screening grids are coarse** (320 m to 960 m cells). The slope cells are smoothed values, and the illumination
  cells are means that hide small, well-lit ridges. They screen areas; they do not certify a landing ellipse.
- **Ephemeris tables** cover 2025-2035 (and 1969-1972 for Apollo validation).

## Commands (Windows 11, Git Bash or PowerShell)

```
cd api
uv sync                                   # first time
uv run uvicorn app.main:app --reload      # http://127.0.0.1:8000/docs
uv run pytest -q                          # must pass before every push

cd pipeline
uv run pytest -q
uv run python -m lunarnav.polar_grids     # rebuild data/grids (needs data/raw/illumination)
uv run python -m lunarnav.craters         # rebuild data/craters
uv run python -m lunarnav.build           # rebuild ephemeris, sites and horizons (about 25 minutes)
```

- Python is 3.13 through `uv`; the bare `python` on some machines is the Microsoft Store stub. Use `uv run`.
- **Never rewrite source files with PowerShell `Get-Content`/`Set-Content`**: PowerShell 5.1 double-encodes
  UTF-8. Use the editor tools or Python with `encoding="utf-8"`.
- JPL Horizons and NASA PGDA do not allow browser (CORS) access, and PGDA sometimes truncates range responses;
  the pipeline retries. The API never calls them at request time.

## Git workflow

The `develop-endpoint` skill carries the commands; these are the rules.

1. **One branch per functionality**, created from an up-to-date `main`: `feat/<role>-<topic>`
   (for example `feat/sw1-site-state`, `feat/aero2-comms-filters`). Two functionalities, two branches.
2. **Nothing reaches `main` without a pull request reviewed and approved by another team member.** No direct
   commits or pushes to `main`, no merging your own pull request, no force-push to a branch someone else pulled.
3. Before opening the pull request: rebase on `origin/main`, run `uv run pytest -q` in `api`, fill the template
   in `.github/pull_request_template.md`.
4. Keep pull requests small: one endpoint or one filter, its tests and its docs.
5. Commit messages in English, imperative, one topic per commit.
6. Do not commit anything under `data/raw/`, virtual environments or secrets.
7. `docs/STATUS.md` records team decisions; it is updated on `main` by whoever merges, not in feature branches.

The only commit made directly on `main` is the initial scaffold (an empty repository has nothing to open a pull
request against).

## Quality bar

- Every endpoint: OpenAPI summary and field descriptions with units, tests as in the recipe.
- Every model (power, link, thermal, radiation): formula and source in the docstring, parameters with units,
  three hand-worked cases as tests, and a note of what it leaves out.
- The frontend, when it exists, targets WCAG 2.2 AA (`docs/accessibility.md`): keyboard, text alternatives, a
  table behind every chart, never colour alone, reduced motion.
