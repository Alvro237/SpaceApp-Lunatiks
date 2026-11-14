# SW-1 roadmap (Sergio)

The plan for the five SW-1 endpoints, in the order they are built: one endpoint finished, validated and
documented before the next starts. Output formats for integration live in `docs/sw1-output-format.md`; this file
holds the order, the decisions and the validation plan. Branch: `seryitron-branchito`.

## Order and status

| # | Endpoint | Why in this position | Status |
| --- | --- | --- | --- |
| 1 | `GET /api/v1/sites/{site_id}/state` | The only mandatory objective of the challenge; its pieces (body state, transitions) are reused by all the others | Done, validated |
| 2 | `GET /api/v1/sites/{site_id}/series` | The mission window: timeline, Gantt, fractions and ranges; the hard filters and `/power` build on the same engine series | Done, validated |
| 3 | `GET /api/v1/sites/{site_id}/horizon` | The 360° skyline for the panorama; no time dependence, small | To do |
| 4 | `GET /api/v1/points/state` | `state` with `lat`/`lon` instead of an id (smooth-sphere horizon); reuses `state_response` | To do |
| 5 | `GET /api/v1/points/series` | `series` with `lat`/`lon`; reuses the series builder | To do |

`GET /api/v1/points/info` is listed under SW-1 in `docs/endpoints.md` but has no owner in the team's endpoint
table; it is not part of this roadmap until someone assigns it.

## Decisions that apply to every SW-1 endpoint

- **No power numbers.** Irradiance, array power and energy belong to MECH's `POST /api/v1/power`; SW-1 responses
  carry the light geometry power is built from (visible fraction, eclipsed fraction, Sun distance and elevation).
  One source for power in the merged API. (Owner's decision, 2026-11-14.)
- **`mast_m` absent, empty or null = 0 m.** (Owner's decision, 2026-11-14.)
- **Eclipses** are reported (`eclipse`, `sun_eclipsed_fraction`) but do not change "sunlit": the team convention is
  "any part of the solar disc above the horizon". Whether an eclipse should count as dark for the light metrics is
  an open team question; until it is decided, series reports eclipse ranges separately so the client can see them.
- Errors: 404 unknown id, 422 invalid input, 400 outside the ephemeris tables (`CLAUDE.md`).
- Validation runs through the HTTP layer (`api/tests/sw1_validation.py`, also runnable as
  `cd api && uv run python -m tests.sw1_validation`).

## 2. `GET /api/v1/sites/{site_id}/series`: plan (done; as built in `docs/sw1-output-format.md`)

### Request

| Parameter | Default | Bounds | Notes |
| --- | --- | --- | --- |
| `start` | required | ISO 8601, no offset = UTC | First sample |
| `duration_h` | required | > 0 | Mission window length; no default because it is a mission input |
| `step_min` | 10 | 1..1440 | Sample spacing of the arrays. Proposed default: 10 min resolves a sunrise to the minute after edge refinement and keeps a 14-day mission at 2 017 samples. Range edges do not depend on it (see below) |
| `mast_m` | 0 | 0..20, null = 0 | As in `state` |
| `comms_min_fraction` | 0.5 | 0..1 | As in `state` |

Guards: at most **20 000 samples** per request (the cap suggested in `docs/endpoints.md`), otherwise 422 with the
count; the whole window `[start, start + duration_h]` must be inside the ephemeris tables, otherwise 400.

### Response

- Echo: `site_id`, `lat`, `lon`, `ground_m`, `start`, `end`, `duration_h`, `step_min`, `samples`, `mast_m`,
  `mast_used_m`, `comms_min_fraction`, `horizon_kind`.
- **Arrays** (column format, one value per sample, same length as `t`): `t`; `sun` and `earth` each with `az`,
  `el`, `horizon_el`, `visible_fraction`, `visible`; `eclipse` and `sun_eclipsed_fraction`. Column format keeps
  the JSON small and maps directly onto chart libraries.
- **Ranges** (the "time ranges" answer): `sunlit_ranges`, `comms_ranges`, `eclipse_ranges`, each a list of
  `{start, end, duration_h, starts_before_window, ends_after_window}`.
- **Metrics** (the "fraction of time" answer): the engine's `Metrics` without `mean_power_w_m2` (power is MECH's):
  sunlight %, comms %, both %, longest dark and longest blackout (hours), continuous light/comms, eclipse minutes
  and events, max and min solar elevation.

### Range edges refined to the second

The engine's `visibility_ranges` gives ranges at the grid's resolution (an edge is only known to within one step).
A new engine function bisects each edge between the last sample before and the first sample after, to about one
second, the same method as `next_transition` in `state`. Edges at the window boundaries stay at the boundary and
are flagged (`starts_before_window` / `ends_after_window`), so a night cut by the window reads as "at least".
Cost: about 12 single-instant evaluations per edge; a 30-day window has a few dozen edges.

### Validation plan

1. **Consistency with `state`**: the sample at any `t` of the series equals `state` at that `t` (same engine, same
   horizon); every refined range edge agrees with `state`'s `next_*_transition.at` to within 2 s.
2. **JPL Horizons through `series`**: the IM-1 fixture times as series starts, same 0.01° tolerance as `state`.
3. **Ranges and metrics agree**: ranges sorted, disjoint, inside the window; every sample inside a range is
   visible and every sample outside is not; `sunlight_pct` equals the share of visible samples; summed range
   durations match the sample fraction to within one step per edge.
4. **Physical invariants** per sample (the `state` checks, vectorised) on several sites and windows.
5. **Eclipses**: the 2029-06-26 total eclipse appears in `eclipse_ranges` around NASA's greatest-eclipse time.
6. **Errors and guards**: 404, 422 (missing `start`/`duration_h`, `step_min` out of range, over 20 000 samples),
   400 (window leaving the tables).
7. **Speed**: a 30-day window at 10 minutes (4 321 samples) answers in well under a second.

### What the build changed against this plan

- Published edges are rounded **up** to the whole second, in `series` ranges and in `state` transitions alike.
  The validator found that truncating printed an instant still in the old state (a sunrise at 18:53:50.7 shown
  as 18:53:50, when the Sun was not yet up). `state`'s transition check is now "2 s before / at the instant".

