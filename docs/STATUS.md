# Status

Team-level state and decisions. It is updated on `main` by whoever merges a pull request (one dated line in the
log), not inside feature branches, so that five branches never conflict on it. Work in progress lives in the
Status line of each section of `docs/endpoints.md`.

## Current state (2026-11-15)

**Phase: feature-complete on `main`; deployment, demo video and submission form remain.**
Deadline: Sunday 2026-11-15 23:59 local.

On `main` (all tests pass: API 393, web 234, pipeline 28; CI green): every endpoint in the table of `CLAUDE.md`
("Implemented endpoints and filters"), the web app (globe, polar map with 3D relief and shadows, study, compare,
horizon view, power levels 1-4, mission area search, Educational mode), and the datasets in `data/README.md`
(including the Lunar Prospector hydrogen grid, the 3.8 km global elevation grid and the ground-station dataset).

Still open for the submission: public hosting of the site and the API (both with no login) and a public repository;
the demo video (`docs/demo-script.md`); the form (`docs/submission.md`: links and the team's own SI paragraph).

Earlier snapshot (2026-11-14), kept for the record:

Works and is tested (15 API tests, 22 pipeline tests):

- Engine in `api/app/logic`: ephemeris, geometry, horizon, disc-visible fraction, series, metrics, time ranges,
  next sunset/Earthset. Matches JPL Horizons within 0.01 degrees.
- Data access in `api/app/db` for every dataset in `data/`.
- Endpoints: `GET /health`, `/api/v1/sites`, `/api/v1/sites/{id}`, `/api/v1/meta/datasets`, `/api/v1/meta/constraints`.
- Hard filters `max_slope` and `continuous_light`; soft score with visible weights.
- Datasets: 21-site catalogue with 13 LOLA terrain horizons, Sun/Earth tables 2025-2035, seven south-polar
  screening grids (slope, elevation, Sun illumination, Earth visibility, permanent shadow, sky visibility),
  Robbins crater catalogue.

## Open decisions (ask the team, do not assume)

1. Branch protection on GitHub for `main` (require a pull request and one approval): the repository owner sets it
   in Settings, Branches. The rule is already the team's workflow (`CLAUDE.md`, "Git workflow").
2. Names behind the five roles (`docs/endpoints.md`).
3. Frontend approach (the team will say). The earlier static prototype is not in this repository.
4. Host for the API and for the frontend; both must open with no login.
5. Thresholds and defaults for every hard filter, power, link and thermal parameter: each needs a source.
6. Data for rocks, temperature and radiation (see "Known data gaps" in `CLAUDE.md`).
7. Project name, tagline, licence (MIT assumed), and the AI-use statement for the submission form.

## Next steps

1. Agree the request and response shapes in `docs/endpoints.md`, then each role builds its section on its own
   branch.
2. SW-1: `/sites/{id}/state` first (everything else in the frontend depends on it).
3. SW-2: `/candidates/search` against the two reference filters, so new filters plug in as they arrive.
4. Evening checkpoint: decide what ships. Sunday: video, form, links tested in a private window.

## Log

- 2026-11-15 — Merged #21 (mission area search, hydrogen grid), #22-#26 (Block Moon, audit fixes, globe), #27 (terrain
  horizon anywhere on the Moon), #28 (Educational missions), #29 (horizon-view ground texture), #30 (example
  mission), #31 (radio link level 1). Docs brought up to date: `docs/submission.md`, `docs/demo-script.md`, the
  implemented table in `CLAUDE.md`, section statuses in `docs/endpoints.md`.

- 2026-11-14 — Repository created from the first prototype's pipeline and data. Engine ported from TypeScript to
  Python and validated against the Horizons fixture. Added screening grids from PGDA products 90 and 69 and the
  Robbins crater catalogue. Reference endpoints, two hard filters, soft score, docs.
- 2026-11-14 — Workflow fixed by the team: one branch per functionality, `main` only through reviewed pull
  requests, `CLAUDE.md` edited only when an endpoint is finished. Added the `develop-endpoint` skill and the pull
  request template. Initial scaffold committed to `main`.
