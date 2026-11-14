# SW-1 roadmap (Sergio)

The plan for the five SW-1 endpoints, in the order they are built: one endpoint finished, validated and
documented before the next starts. Output formats for integration live in `docs/sw1-output-format.md`; this file
holds the order, the decisions and the validation plan. Branch: `seryitron-branchito`. Discrepancies with the
frontend and the MECH branch, to fix at merge time: `docs/sw1-integration-notes.md`.

## Order and status

| # | Endpoint | Why in this position | Status |
| --- | --- | --- | --- |
| 1 | `GET /api/v1/sites/{site_id}/state` | The only mandatory objective of the challenge; its pieces (body state, transitions) are reused by all the others | Done, validated |
| 2 | `GET /api/v1/sites/{site_id}/series` | The mission window: timeline, Gantt, fractions and ranges; the hard filters and `/power` build on the same engine series | Done, validated |
| 3 | `GET /api/v1/sites/{site_id}/horizon` | The 360° skyline for the panorama; no time dependence, small | Done, validated |
| 4 | `GET /api/v1/points/state` | `state` with `lat`/`lon` instead of an id (smooth-sphere horizon); reuses `state_response` | Done, validated |
| 5 | `GET /api/v1/points/series` | `series` with `lat`/`lon`; reuses the series builder | Done, validated |

`GET /api/v1/points/info` is listed under SW-1 in `docs/endpoints.md` but has no owner in the team's endpoint
table; it is not part of this roadmap until someone assigns it.

## Decisions that apply to every SW-1 endpoint

- **Eclipses in power belong to MECH.** The engine's `power_w_m2` carries horizon and panel factors only; MECH's
  `/power`, thermal and battery code apply `(1 − obscuration)` once. A first version of this branch put the factor
  in the engine; it was removed on 2026-11-14 when `feat/mech-power` showed it would count every eclipse twice.
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

## 3. `GET /api/v1/sites/{site_id}/horizon`: plan (done; as built in `docs/sw1-output-format.md`)

The skyline the frontend draws under the Sun and Earth tracks, and the evidence of how much the terrain decides:
the 360° LOLA horizon mask of a site and, on request, the masks of its neighbours a few hundred metres away.
No time dependence and no new physics: the masks are precomputed by the pipeline (`data/horizons.i16`,
`data/zones.i16`); the endpoint decodes, summarises and returns them. Files: `routers/horizon.py`,
`schemas/horizon.py`, `tests/test_horizon.py` (one router per endpoint group, registered in `main.py`).

### Request

| Parameter | Default | Bounds | Notes |
| --- | --- | --- | --- |
| `mast_m` | 0 | 0..20, null = 0 | As in `state`; terrain sites snap to the nearest stored mask (0, 2, 5, 10 m) |
| `include_zone` | false | bool | Also return the neighbours' masks (site centre plus 16 points: 8 bearings × 500 m and 1.5 km). They exist only for the 2 m mast; the response says so |

### Response

- Echo and context: `site_id`, `lat`, `lon`, `ground_m`, `mast_m`, `mast_used_m`, `masts_available_m`,
  `horizon_kind`.
- The profile: `az_step_deg` (0.5), `az` (720 azimuths, 0 to 359.5, clockwise from north) and `elevation_deg`
  (720 values, degrees). Linear interpolation between azimuths, wrapping at 360°, is the engine's rule.
- Summary: `max_deg`, `max_az_deg`, `min_deg`, `min_az_deg`, `mean_deg`.
- `zone`: `null` unless requested and available. Otherwise `{mast_m: 2, points: [...]}` with, per point,
  `bearing_deg`, `distance_m`, `lat`, `lon`, `ground_m`, `elevation_deg` (720) and the same summary.
  `zone_available` says whether the site has neighbour masks (13 terrain sites yes, smooth-sphere sites no).

### Validation plan

1. **Bit-exact decode**: the API's values equal an independent read of `horizons.i16` / `zones.i16` (int16 / 100)
   at the documented offsets.
2. **Catalogue summary**: max and mean at 2 m equal `sites.json` (`horizon2mMaxDeg`, `horizon2mMeanDeg`).
3. **Physics**: a higher mast never sees a higher skyline (mask at 0 ≥ 2 ≥ 5 ≥ 10 m at every azimuth, checked on
   all 13 sites); the smooth sphere equals `-acos(R / (R + h))` by hand; the zone centre equals the site's 2 m
   mask; neighbour coordinates lie at their stated distance and bearing (haversine, R = 1737.4 km).
4. **Consistency with `state`**: `state`'s `horizon_el` equals this profile interpolated at the Sun's and the
   Earth's azimuth.
5. **Independent NASA product** (PGDA product 69, Mazarico et al., 18.6-year averages, 960 m cells): over
   2025-2035 the engine with these masks gives a mean visible solar-disc fraction, and a share of time with any
   of the Earth's disc visible, whose range across the zone points contains PGDA's value (±0.02) at all 13
   terrain sites. Measured during planning: Sun 13/13, Earth 13/13 once the definitions match (PGDA's Earth map
   counts "any part of the disc visible"; the engine's comms flag uses half the disc, which reads lower).
6. **Errors**: 404 unknown id, 422 bad `mast_m`.

## 4. `GET /api/v1/points/state`: plan (done; as built in `docs/sw1-output-format.md`)

`state` for any point typed in by the user. Same engine, same response model, same validation; only the site
model changes: `services.model_for_point` instead of `model_for_site`. Files: `routers/points.py`,
`tests/test_points.py` (no new schema: the response is `StateResponse` with `site_id: null`).

### Housekeeping first

The query parameters shared by every SW-1 endpoint (`t`, `mast_m` with null = 0, `comms_min_fraction`, the
window parameters) move from `routers/state.py` to `routers/params.py`, so `horizon` and `points` stop importing
one another. The response builders (`state_response`, `series_response`) stay in `routers/state.py` and are
reused, so a point and a site can never be shaped differently.

### Request

| Parameter | Default | Bounds | Notes |
| --- | --- | --- | --- |
| `lat` | required | -89.9999..89.9999 | Planetocentric, degrees. The exact poles are excluded: there "north" (and so the azimuth) is undefined (team spec: latitude ≥ -89.9999) |
| `lon` | required | -180..360 | East-positive. 0..360 is accepted and normalised to -180..180 (330 → -30; 180 → -180, the same meridian) |
| `t`, `mast_m`, `comms_min_fraction` | as in `state` | | |

### What is different from a catalogue site

- **Horizon**: always `smooth_sphere` (`-acos(R / (R + mast))`). No terrain mask exists for an arbitrary point and
  computing one takes minutes (`CLAUDE.md`, known data gaps). `mast_used_m` = `mast_m`.
  **Correction found while building this:** `CLAUDE.md` says real terrain "can only shorten light and
  communication", so a smooth-sphere answer would be an upper bound. That holds on crater floors and low ground,
  not on peaks: from a summit the real skyline drops below the smooth one. Over 2027 at 2 m, the terrain gives IM-2
  691 h of Earth contact and 52 h of Sun, Mons Malapert 2 743 h and 145 h, Nobile 470 h of Sun that the smooth
  sphere does not. A manual point is therefore an estimate that can err either way, not a bound.
- **Ground height**: from the LOLA elevation grid south of 60° S (960 m cells); elsewhere there is no height in
  the repository and the reference sphere (0 m) is used. A new field, `ground_source`, says which:
  `lola_site` (catalogue site with terrain, pipeline value), `lola_grid` (screening grid), `reference_sphere`
  (no data: 0 m assumed). The ground only moves the observer for parallax (about 0.00015° of Earth direction per
  km), so the assumption costs well under the 0.01° budget; the field is there so the 0 is never read as a
  measurement. Added to `state` and `series` for sites too (additive).

### Validation plan

1. **JPL Horizons at every fixture point**: all 11 fixture cases (south pole to north pole, near and far side, a
   +4 km site), not only IM-1, because a point can sit exactly where Horizons was asked. Tolerance 0.01°.
2. **Same as the site endpoint where they must agree**: at a smooth-sphere catalogue site (Apollo 11) the point
   response equals the site response except `site_id`; at a terrain site (IM-2) the Sun and Earth directions
   agree to within the parallax of the ground difference.
3. **The lower skyline sees more**: at the terrain sites' coordinates, compare the site (terrain) with the point
   (smooth sphere) at many instants. Where the terrain profile across the whole disc is below the smooth dip, the
   terrain's visible fraction is at least the point's; where it is entirely above, at most. (Replaces "terrain
   only shortens", which the data refutes on peaks.)
4. **Longitude normalisation**: `lon=330` and `lon=-30` give the same response; `lon=180` and `lon=-180` too.
5. **Ground**: inside the grid it equals the grid sample and says `lola_grid`; outside it is 0 with
   `reference_sphere`; catalogue terrain sites say `lola_site`, the others `reference_sphere`.
6. **State invariants** (the `state` validator) on a sweep of points, and transitions that flip the state.
7. **Errors**: 422 for missing or out-of-range `lat`/`lon` (including the poles), 400 outside the tables.

## 5. `GET /api/v1/points/series`: plan (done; as built in `docs/sw1-output-format.md`)

`series` for manual coordinates, plus the terrain reference that tells the user which way the smooth sphere errs
at that point (part C of the validated fix for the terrain-horizon rule). Files: `routers/points.py`,
`schemas/points.py` (now needed: the point responses add one field), `tests/test_points.py`.

### Request

`lat`, `lon` as in `points/state`; `start`, `duration_h`, `step_min`, `mast_m`, `comms_min_fraction` as in
`series` (same parameters from `routers/params.py`, same 20 000-sample cap).

### Response

`series`' model with `site_id: null`, `horizon_kind: "smooth_sphere"`, `ground_source`, built by
`series_response`. Both point endpoints (`points/state` and `points/series`) gain `terrain_reference`.

### `terrain_reference`

What real terrain does at this point according to NASA, against what the smooth sphere gives there:

- `pgda`: the 18.6-year average from PGDA product 69 (Mazarico et al., terrain-aware, 960 m cells) at the point.
- `smooth_sphere`: the same quantity from the engine over the smooth sphere at the point, 2025-2035 every 6 h
  (16 053 samples, a few milliseconds).
- `difference` = `pgda - smooth_sphere`. Negative: the smooth sphere overstates (crater, slope). Positive: it
  understates (summit, ridge facing the body).
- For the Sun the quantity is the mean visible fraction of the disc; for the Earth, the share of time with any part
  of the disc visible (PGDA's own definitions; the comms threshold is not used here).
- `null` north of 65° S, where PGDA has no map. No label or threshold is added: the numbers are the answer.

Measured during planning (engine with our terrain masks vs smooth sphere, against PGDA vs smooth sphere): the sign
agrees at all 13 terrain sites wherever the terrain effect exceeds 0.05, e.g. IM-2 Earth +0.141 measured,
+0.128 PGDA; Shackleton Sun -0.515 both; Mons Malapert Earth +0.238 measured, +0.046 PGDA (the 960 m cell
dilutes the summit).

### Validation plan

1. **Equal to `points/state`**: sampled instants match; every inner range edge flips `points/state` at the
   published second.
2. **Equal to `sites/{id}/series`** at smooth-sphere catalogue sites, except `site_id` (and `terrain_reference`,
   absent from site responses).
3. **Series invariants** (arrays, ranges against samples, metrics) on points from pole to pole.
4. **JPL Horizons through `points/series`** at all 11 fixture places (first sample of a window starting at each
   fixture time).
5. **Terrain reference**: at the 13 terrain sites, the sign of `difference` matches the sign measured with our own
   terrain masks wherever that effect exceeds 0.05; `smooth_sphere` recomputed independently; `null` north of
   65° S; identical in `points/state` and `points/series`.
6. **Errors**: 422 (coordinates, window, cap), 400 (window outside the tables).

