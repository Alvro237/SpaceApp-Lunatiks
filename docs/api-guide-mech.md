# MECH endpoints: integration guide

For whoever builds the frontend or calls these endpoints. Branch `feat/mech-power` (PR #1). The exact contract
(every field, type and unit) is the OpenAPI document: run the API and open `/docs` or `/openapi.json`. This page
tells you which call to make for what, the minimum request, the fields you will usually show, and the traps.
Specification, owners and status: `docs/endpoints.md`.

```
cd api
.venv\Scripts\python.exe -m uvicorn app.main:app --port 8010     # or: uv run uvicorn app.main:app --port 8010
```

## Conventions (all MECH endpoints)

- **Place**: `site_id` from `GET /api/v1/sites`, **or** `lat` + `lon` (degrees, MOON_ME, east-positive,
  -180..180). Not both.
- **Window**: `start` (ISO 8601 UTC, e.g. `2027-10-05T00:00:00Z`), `duration_h`, `step_min` (default 60),
  `mast_m` (default 2; terrain masks exist for 0, 2, 5 and 10 m, `mast_m_used` says which one was used).
  At most 20 000 samples per request (`duration_h * 60 / step_min + 1`), else 422.
- **Times** come back as ISO 8601 UTC strings. `t[]` is the sample grid; every other array has the same length.
- **Ranges** are lists of `{start, end}` (ISO UTC).
- **`horizon_kind`** is in every response: `terrain` (LOLA horizon mask, 13 south-polar catalogue sites) or
  `smooth_sphere` (everything else, including manual coordinates). A smooth-sphere result is **an estimate, not
  a bound in either direction**: real terrain removes hours in craters and on slopes and adds hours on peaks and
  ridges. Show the kind to the user; do not rank or reject places assuming smooth sphere is optimistic.
- **`assumptions[]`** lists the idealisations behind the numbers; show it in the advanced view.
- **`null`** means unknown or not requested (for example level-2 fields at level 1, or a dose without sky data).
  Never replace a null with 0.
- Fields described as **"Extra"** in OpenAPI are beyond the team's API rules; use them or ignore them.
- **Educational vs advanced**: the API has no mode switch. Ask for what you need; the frontend chooses what to show.
- **Errors**: 404 unknown `site_id`; 422 invalid or missing input (the body says which field); 400 dates outside
  the ephemeris tables (2025-2035, 1969-1972 for Apollo).

## Which endpoint for what

| Question in the UI | Call | Main fields to show |
| --- | --- | --- |
| Where is the Sun, how long is it up, eclipses? | `POST /api/v1/sun` | `sun_el_deg[]`, `visible_fraction[]`, `sunlit_fraction`, `sunlit_ranges`, `longest_dark_h`, `next_transition`, `eclipses[]` |
| When can we talk to Earth? | `POST /api/v1/earth` | `earth_el_deg[]`, `visible_ranges`, `visible_window_fraction`, `longest_blackout_h`, `next_transition` |
| How much power, does the battery last? | `POST /api/v1/power` (`level` 1-3) | see below |
| How hot / cold? | `POST /api/v1/thermal` | `surface_k[]`, `surface.{max_k,min_k,mean_k}`, `above_max`, `below_min` |
| Radiation dose and astronaut risk | `POST /api/v1/radiation` | `risk.index` (1-10), `mission_gcr_dose_mgy_si`, `mission_effective_dose_msv`, `shielding_factor` |
| Is this place / date feasible? | `POST /api/v1/verdict` | `verdict`, `reasons[]`, `hard_filters[]`, `score.score` |
| Which landing date (and place) is best? | `POST /api/v1/sweep` | per place, per landing: `sunlight_fraction`, `comms_fraction`, `mean_power_w_m2`, `battery_survived` |
| How do we know it is right? | `GET /api/v1/validation` | `passed` / `total`, `model_checks[]` |

## POST /api/v1/power

Team API rules, flat fields. `level` decides what you must send and what comes back; fields of a higher level are
`null` at lower levels. `panel`: `tracking` | `vertical` (default) | `horizontal`.

| Level | Send (all required at that level) | Get |
| --- | --- | --- |
| 1 | place + window, `level`, `panel` | `t[]`, `sun_fraction[]`, `sun_el_deg[]`, `sunlit_ranges[]`, `longest_dark_h`, `mean_power_w_m2` |
| 2 | + `panel_area_m2`, `cell_efficiency`, `derating` | + `irradiance_w_m2[]`, `power_w[]`, `mean_power_w`, `energy_wh` |
| 3 | + `load_w`, `battery_capacity_wh`, `battery_initial_soc`, `battery_min_soc`, `charge_efficiency`, `discharge_efficiency` (optional `night_load_w`) | + `net_power_w[]`, `battery_soc[]`, `min_soc`, `survives`, `first_depletion_at`, `energy_margin_wh` |

- `irradiance_w_m2[]` = power reaching 1 m2 of panel: solar irradiance x visible fraction x orientation factor x
  (1 - eclipse obscuration).
- **`mean_power_w_m2`** (all levels) = mean of that over the window, W/m2. It needs no panel size, so use it to
  **compare places**. It equals `/sweep` `mean_power_w_m2` for the same landing.
- `energy_margin_wh` > 0: energy left above the battery floor at the worst moment; < 0: load energy that could not
  be served. `first_depletion_at` is null when the battery survives.
- No panel or battery value has a default (none has a cited source): the UI must send them. The viewer uses
  test values only (2 m2, 0.3, 0.9, 60 W, 3000 Wh, 1.0, 0.2, 0.95, 0.95).

```json
{"site_id": "mons-malapert", "start": "2027-10-05T00:00:00Z", "duration_h": 336, "step_min": 60, "level": 3,
 "panel": "vertical", "panel_area_m2": 2, "cell_efficiency": 0.3, "derating": 0.9, "load_w": 60,
 "battery_capacity_wh": 3000, "battery_initial_soc": 1, "battery_min_soc": 0.2,
 "charge_efficiency": 0.95, "discharge_efficiency": 0.95}
```

## POST /api/v1/sun and /api/v1/earth

Window request only (`/earth` also takes `comms_min_fraction`, default 0.5 = half the Earth's disc above the
horizon counts as a link). `now` is the state at `start`. `next_transition` is `{kind, at, in_hours}` or null when
there is none within 45 days. `/sun` `eclipses[]`: `{start, end, duration_h, kind: partial|total, max_obscuration}`.
`/earth` `libration`: how far the Earth wanders in the sky over the window.

## POST /api/v1/thermal

Window + `regolith` (all required, no cited defaults yet: `albedo`, `emissivity`, `conductivity_w_mk`,
`density_kg_m3`, `heat_capacity_j_kgk`, `geothermal_flux_w_m2`). Optional `equipment` (lumped box:
`absorptivity`, `emissivity`, `sun_area_m2`, `radiator_area_m2`, `ground_view_factor`, `heat_capacity_j_k`,
`internal_power_w`) and `limits` (`max_k`, `min_k`, `mode` discrete | continuous, `max_hours_beyond`). With
equipment, the limits apply to it (`limits_apply_to`). Known limit: no infrared from the surrounding terrain, so
shadowed floors come out too cold.

## POST /api/v1/radiation

Window + optional `quality_factor` (send it to get `risk`; about 3.8 from MSL RAD, still to verify) and
`si_to_tissue_factor` (default 1.333, CRaTER team). Galactic cosmic rays only, from the LRO CRaTER record
(2009-2013) as a climatology (`basis`). `risk.index` 1-10: 1 = 0.1 % of the 600 mSv career limit, 4 = 1 %,
7 = 10 %, 10 = 100 % (team presentation scale); `risk.index_with_worst_storm` adds the record's largest solar storm
day as a lower bound. `null` dose fields mean no sky data at that point.

## POST /api/v1/verdict

Window + `hard_filters` (filter id -> threshold), optional `weights` (`sunlight`, `comms`, `continuity`),
`favourable_min` (75), `marginal_min` (50), `unknown_passes` (false). `verdict`: `unfeasible` if a filter fails,
`unknown` if one cannot be evaluated, else `favourable` | `marginal` | `poor` from the score. Weights and bands are
prototype values, not yet decided with a source: show them as adjustable.

| Filter id | Threshold |
| --- | --- |
| `max_slope` | `{"max_deg": 10}` |
| `continuous_light` | `{"min_fraction": 0.7, "max_dark_h": null}` |
| `max_dose` | `{"max_mgy_si": 10}` |
| `max_temperature` | `{"max_k": 400, "mode": "discrete", "max_hours_above": 0, "regolith": {...}, "equipment": {...}}` |
| `battery_survives` | the level-3 flat fields of `/power` |

The numbers above are examples, not recommended limits. Full list: `GET /api/v1/meta/constraints`.

## POST /api/v1/sweep

`places` (1-25, each `site_id` or `lat`/`lon`), `first_landing`, `landings` (up to 2000), `landing_step_h`
(default 24), `stay_h`, `step_min` (must divide `landing_step_h` and `stay_h`), `panel`, `mast_m`,
`comms_min_fraction`, and optionally the `/power` panel fields (adds `mean_array_w`) and battery fields (adds
`battery_survived`, `battery_min_soc`, `unserved_energy_wh`). Response: `landings[]` (ISO UTC) and, per place,
one array per metric with one value per landing, plus `gcr_dose_mgy_si` for one stay. Good for a heatmap
(places x landing dates). 21 sites x 365 landings x 14 days with battery takes about 1 s.

## GET /api/v1/validation

No input. `model_checks[]`: `{id, model, description, reference, source, computed, tolerance, passed}`;
`pipeline`: the dataset validation (ephemeris vs JPL Horizons, terrain vs LROC). First call about 0.6 s, then
cached. Good for the data / methods page.
