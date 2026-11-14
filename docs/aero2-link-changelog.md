# AERO-2 radio link: change log, branch history and notices

Written 2026-11-14 by the AERO-2 session. Read this first if you pick up the radio-link work, or if you notice that
`feat/aero2-ground-stations` looks different from what you pulled earlier.

## 1. History rewrite of `feat/aero2-ground-stations` (2026-11-14)

The branch had been pushed on top of `main` at `b42df38`. `main` then received PR #15 (the `comms_hours` and
`max_blackout` filters, `feat/aero2-comms-filters`), so the branch was **rebased onto `main` at `32a0b07`** and
force-pushed (`--force-with-lease`, nobody else had the branch). No file content was dropped: the four commits carry
the same changes, only their parent and hashes changed. If you had the old branch checked out, re-fetch it and reset
to the new tip (`git fetch origin && git switch feat/aero2-ground-stations && git reset --hard origin/feat/aero2-ground-stations`).

| Old commit (removed from the branch) | New commit | Subject |
| --- | --- | --- |
| `0a0f9be` | `e4d2027` | Add NAIF station and Earth-orientation kernels to the pipeline downloads |
| `9b084e1` | `18cd3ec` | Redefine the link levels: station visibility belongs to level 1 |
| `fa0a306` | `06226dd` | Reference the DSN horizon masks, JAXA masks and ESA site logs |
| `c54e508` | `2b81990` | Add the ground-station dataset and the Moon-from-antenna geometry |

A fifth commit on the new branch adds this file.

## 2. Branch layout

- `feat/aero2-comms-filters`: merged (PR #15). Hard filters `comms_hours`, `max_blackout` (Earth line of sight only).
- `feat/aero2-ground-stations`: the ground-station dataset and the geometry of the Moon seen from an antenna.
- `feat/aero2-link-level1`: stacked on the previous one. `POST /api/v1/link` (level 1) and `GET /api/v1/link/stations`.

## 3. Decisions taken with the owner, with the reason

- **Contact needs both ends.** Level 1 = the lunar site sees the Earth AND a selected antenna sees the Moon above its
  elevation limit. The link budget is level 2 (it was level 3 in the first draft of `docs/endpoints.md`).
- **Networks the user can select:** `dsn`, `estrack`, `jaxa`. Only antennas documented as deep-space antennas are in
  the catalogue. The user can also add an antenna by giving position and a minimum elevation.
- **Elevation limits:** DSN and JAXA use their published per-azimuth horizon masks. ESA publishes none, so its three
  antennas use 6 deg, flagged `owner_estimate` (6 deg is the mechanical limit the DSN handbook gives for azimuth-elevation
  antennas, module 301 section 2.2.2). Every response lists `estimated_limits`.
- **One Moon table for every antenna:** hourly geocentric Moon vector in ITRF93 (`data/moon_itrf_2025_2035.f32`);
  the azimuth and elevation from any antenna, catalogue or user-defined, are computed from it in NumPy. Validated
  against SPICE's own DSN topocentric frames at 24 off-grid instants: worst 0.0024 deg.
- **Left out on purpose:** satellite relays in lunar orbit (too complex for the deadline); interpolating the mast
  height between the stored 0, 2, 5 and 10 m horizon masks (a leave-one-out test on the 13 terrain sites gave a mean
  error of 0.05 to 0.16 deg and worst cases of 1.2 to 2.4 deg, so it was not adopted); antenna scheduling (visible does
  not mean available).
- **Known local issue:** CSPICE cannot open files under a path with non-ASCII characters on Windows. The new pipeline
  module `lunarnav/ground_stations.py` loads kernels by relative name; the older pipeline code does not, so build the
  data from a path without accents.

## 3b. Additive edits to shared backend files (team notice)

Nothing was renamed or removed; callers that do not use the new options behave exactly as before.

- `api/app/db/store.py`: new optional field `DataStore.stations` (and one line in `load_store`).
- `api/app/logic/constraints/base.py`: new optional field `ConstraintContext.contact` (bool series, default `None`).
- `api/app/services.py`: new functions `link_stations`, `link_views`, `link_contact` (end of file) and two optional
  parameters of `constraint_context`, `link_networks` and `link_direction`. SW-2: pass `link_networks=[...]` when the
  user selected antenna networks and `comms_hours` / `max_blackout` will use ground-antenna contact instead of the
  Earth's line of sight alone.
- `api/app/main.py`: one import and one `include_router` line for the link router.

## 4. Notice for the frontend (nothing under `web/` was touched)

`web/src/panels/LinkPanel.tsx` currently shows only the Earth's disc from the browser engine and the text
"Ground stations and link budget: pending the AERO-2 model". When you are ready:

- `GET /api/v1/link/stations` lists the networks and antennas (with `limit_source`: `cited` or `owner_estimate`).
- `POST /api/v1/link` takes the usual window request (`site_id` or `lat`/`lon`, `start`, `duration_h`, `step_min`,
  `mast_m`) plus `networks`, `custom_stations`, `direction` and `comms_min_fraction`, and returns `contact`
  (one boolean per sample), `contact_ranges`, `contact_hours`, `longest_blackout_h`, a `stations` list with each
  antenna's own windows, and `estimated_limits`.
- Show `estimated_limits` to the user when it is not empty: the result then depends on a value that is not an
  operator figure.
- Level 2: send `"level": 2` and a `budget` object (`frequency_ghz`, `transmit_eirp_dbw`, `receive_gt_db_per_k`,
  `data_rate_bps`, `required_ebn0_db`, optional `other_losses_db` and `min_margin_db`). The response then carries
  `budget.link` (one boolean per sample), `budget.link_ranges`, `budget.best_margin_db`, and `stations[].budget` with the
  margin, free-space loss and the highest data rate each antenna supports. No catalogue publishes EIRP or G/T for these
  antennas, so the user must provide them; do not prefill invented values.
- The generated types (`web/src/api/schema.gen.ts`) need regenerating from `/openapi.json` to see the new models.
- Everything added to the API is new: no existing field was renamed or removed.
