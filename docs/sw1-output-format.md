# SW-1 endpoints: request and output format

Contract of the SW-1 endpoints (owner: Sergio), written so the main branch and the frontend can integrate
them without reading the code. The machine-readable source of truth is `/openapi.json`; this file explains
the meaning, units and edge cases. One section per endpoint, added as each one is finished.

| Endpoint | Status |
| --- | --- |
| `GET /api/v1/sites/{site_id}/state` | Done, validated (this file) |
| `GET /api/v1/sites/{site_id}/series` | Done, validated (this file) |
| `GET /api/v1/sites/{site_id}/horizon` | Done, validated (this file) |
| `GET /api/v1/points/state` | Done, validated (this file) |
| `GET /api/v1/points/series` | To do (same output as `sites/{id}/series`, `site_id: null`) |

Conventions in every response: Moon Mean-Earth frame (MOON_ME); angles in degrees; azimuth clockwise from
north, 0..360; times ISO 8601 UTC with a trailing `Z`; snake_case fields; `horizon_kind` always present.

---

## `GET /api/v1/sites/{site_id}/state`

Sun and Earth as seen from a catalogue site at one instant: where they are, how much of each disc is above the
local horizon, whether the Earth hides the Sun (eclipse), and how long until the next sunset/sunrise and
Earthset/Earthrise.

**No power numbers here, by design.** Irradiance, array power and energy belong to the MECH power endpoint
(`POST /api/v1/power`), so the merged API has one source for power and no two figures can disagree. This endpoint
gives the light geometry that power is built from (`sun.visible_fraction`, `sun_eclipsed_fraction`,
`sun.distance_km`, `sun.el`). The engine's `Series.power_w_m2` already includes the eclipse factor for MECH to use.

### Request

| Parameter | In | Type | Default | Range | Meaning |
| --- | --- | --- | --- | --- | --- |
| `site_id` | path | string | required | an id from `GET /api/v1/sites` | Catalogue site |
| `t` | query | ISO 8601 datetime | **required** | inside the ephemeris tables (2025-2035, 1969-1972) | Instant. No offset means UTC; offsets are converted (`13:00+01:00` = `12:00Z`) |
| `mast_m` | query | float, m | `0` | 0..20 | Panel/antenna height above the ground. **Absent, empty (`mast_m=`) or `null`/`none` (any case) = 0 m**, the ground itself. Terrain sites use the nearest stored mask (0, 2, 5, 10 m) |
| `comms_min_fraction` | query | float | `0.5` | 0..1 | Share of the Earth's disc above the horizon needed to count as direct-to-Earth comms |

The `comms_min_fraction` default is the engine default in `app/logic/engine.py`
(`AnalysisParams`). The `mast_m` default of 0 m is the owner's decision (Sergio, 2026-11-14): when the client
sends no mast, or a null one, the observer is on the ground. Any other non-number (`mast_m=abc`) is a 422.

Example:

```
GET /api/v1/sites/im-2/state?t=2026-11-20T12:00:00Z&mast_m=2
```

### Response 200

```json
{
  "site_id": "im-2",
  "lat": -84.78,
  "lon": 29.13,
  "ground_m": 5312.6,
  "t": "2026-11-20T12:00:00Z",
  "mast_m": 2.0,
  "mast_used_m": 2.0,
  "comms_min_fraction": 0.5,
  "horizon_kind": "terrain",
  "sun": {
    "az": 18.5089,
    "el": 6.4949,
    "horizon_el": 0.6102,
    "visible_fraction": 1.0,
    "visible": true,
    "angular_radius_deg": 0.26926,
    "distance_km": 148037935.2
  },
  "earth": {
    "az": 323.3216,
    "el": 7.9904,
    "horizon_el": -1.1293,
    "visible_fraction": 1.0,
    "visible": true,
    "angular_radius_deg": 0.96031,
    "distance_km": 380562.1
  },
  "eclipse": "none",
  "sun_eclipsed_fraction": 0.0,
  "next_sun_transition": { "kind": "set", "at": "2026-12-01T00:16:08Z", "in_hours": 252.269 },
  "next_earth_transition": { "kind": "set", "at": "2026-12-04T09:56:25Z", "in_hours": 333.940 },
  "transition_search_days": 45.0
}
```

(Real response of the server, rounded here for reading; the API returns full float precision.)

### Fields

| Field | Type | Unit | Meaning |
| --- | --- | --- | --- |
| `site_id` | string \| null | | Catalogue id; `null` in `/points/state` |
| `lat`, `lon` | float | deg | Planetocentric latitude; east-positive longitude -180..180 |
| `ground_m` | float | m | Ground height above the 1737.4 km sphere used in the computation |
| `ground_source` | `lola_site` \| `lola_grid` \| `reference_sphere` | | Where `ground_m` comes from: the pipeline's value at a catalogue terrain site, the LOLA elevation grid south of 60° S (960 m cells), or no data (0 m assumed). The ground only moves the observer for parallax, under 0.001° |
| `t` | string | UTC | The instant evaluated, normalised to `YYYY-MM-DDTHH:MM:SSZ` |
| `mast_m` | float | m | Mast height requested |
| `mast_used_m` | float | m | Mast of the horizon actually used: nearest stored terrain mask, or `mast_m` on a smooth sphere |
| `comms_min_fraction` | float | 0..1 | Echo of the comms threshold used |
| `horizon_kind` | `terrain` \| `smooth_sphere` | | `terrain`: LOLA ray-traced mask. `smooth_sphere`: geometric dip only. Real terrain differs **both ways**: crater floors and slopes see less sky; peaks see below the smooth horizon and get more light and comms (in 2027 at 2 m, IM-2 has 691 h of comms and Mons Malapert 2 743 h that a smooth sphere would not give) |
| `sun`, `earth` | object | | See below |
| `eclipse` | `none` \| `partial` \| `total` | | The Earth covering the Sun as seen from the site (what the Earth sees as a lunar eclipse) |
| `sun_eclipsed_fraction` | float | 0..1 | Share of the solar disc hidden behind the Earth: 0 with `none`, 1 with `total` |
| `next_sun_transition` | object \| null | | Next sunset (`kind: "set"`) if the Sun is visible now, otherwise next sunrise (`"rise"`) |
| `next_earth_transition` | object \| null | | Same for the Earth (comms threshold) |
| `transition_search_days` | float | days | How far ahead the transitions were searched; `null` transition = no change within it (or before the tables end) |

Body object (`sun`, `earth`):

| Field | Type | Unit | Meaning |
| --- | --- | --- | --- |
| `az` | float | deg | Azimuth of the disc centre, clockwise from north, 0..360 |
| `el` | float | deg | Elevation of the disc centre over the local horizontal; airless apparent (light time + stellar aberration) |
| `horizon_el` | float | deg | Elevation of the horizon at that azimuth. `el - horizon_el` is the clearance; useful for the panorama |
| `visible_fraction` | float | 0..1 | Fraction of the disc above the horizon, integrated against the horizon profile |
| `visible` | bool | | Sun: `visible_fraction > 0` ("sunlit"). Earth: `visible_fraction >= comms_min_fraction` ("comms") |
| `angular_radius_deg` | float | deg | Apparent radius of the disc (Sun ~0.27, Earth ~0.95) |
| `distance_km` | float | km | From the site to the body centre |

Transition object: `kind` (`set` = leaves view, `rise` = comes into view), `at` (UTC, resolved to ~1 s by
bisection), `in_hours` (hours from `t` to `at`).

### Errors

| Status | When | Body |
| --- | --- | --- |
| 404 | Unknown `site_id` | `{"detail": "Unknown site id 'x'; see GET /api/v1/sites"}` |
| 422 | `t` missing or not a date; `mast_m` outside 0..20 or not a number; `comms_min_fraction` outside 0..1 | FastAPI validation body |
| 400 | `t` outside the ephemeris tables | `{"detail": "t=2040-01-01T00:00:00Z is outside the ephemeris tables (…)"}` |

### Edge cases

- `next_*_transition.at` is rounded **up** to the whole second: the edge is refined to ~1 s and the published
  instant is already in the new state (`state` at `at` shows the change; 2 s earlier it does not).
- A null transition is a real answer, not a failure: near the sub-Earth point (Apollo 11) the Earth never sets.
- Sites without a terrain mask (Apollo, Blue Ghost, SLIM) answer with `horizon_kind: "smooth_sphere"`.
- During an eclipse `sun.visible` stays `true` (the disc is above the horizon: the team convention for
  "sunlit"); read `eclipse` and `sun_eclipsed_fraction` for the darkness.
- A `panel` parameter from an older client is ignored (unknown query parameters are not an error).
- The eclipsed share uses the area of overlap of two uniform discs (no limb darkening; the Earth's atmosphere,
  which bends some red light into the shadow, is ignored). When an eclipse coincides with the Sun crossing the
  skyline, horizon and Earth are combined as independent factors, which is exact whenever either is 0 or 1.

### How it was validated

Run `cd api && uv run python -m tests.sw1_validation` (pytest runs the same checks in `tests/test_state.py`):

1. **JPL Horizons through HTTP**: 32 comparisons (Sun and Earth, 16 dates 2027-2033) for IM-1, whose
   coordinates match a fixture case. Worst error 0.00042° against a 0.01° tolerance. That residual is the
   expected parallax of the site's 2.6 km ground height (the fixture is at 0 km): 2.6 / 380 000 rad ≈ 0.0004°.
2. **Physical invariants** on all 21 sites × 4 dates × 2 comms thresholds: ranges, distances, disc radius from
   distance, fraction consistent with `el - horizon_el`, `visible` consistent with the thresholds, `eclipse`
   consistent with `sun_eclipsed_fraction`, no power fields, transitions in the future and `in_hours = at - t`.
3. **Events**: each reported transition flips the state between 60 s before and 60 s after `at`.
4. **Eclipses against NASA's catalogue** (Espenak, GSFC, 25 lunar eclipses 2025-2035): at greatest eclipse
   of each of the 10 total ones the Sun is fully hidden (`sun_eclipsed_fraction` = 1); no penumbral one hides the whole
   Sun; every eclipse the engine finds at Apollo 11 in eleven years is a catalogue eclipse. The overlap formula
   has hand-worked tests (disjoint, inside, area ratio, two unit circles one radius apart = 0.391002), and the
   engine's power series is tested to fall through the partial phase and reach 0 in totality.
5. **The validator is tested**: tampered responses (a power field, wrong disc size, fraction out of range,
   eclipse inconsistent with the eclipsed share, wrong flag) are rejected.

---

## `GET /api/v1/sites/{site_id}/series`

Sun and Earth over a mission window at a catalogue site: per-sample arrays for charts and timelines, the stretches
of sunlight, direct-to-Earth comms and eclipse as time ranges with edges to the second, and summary metrics as
fractions of the time. Light and comms geometry only: no power (MECH's `/power`). Roadmap and decisions:
`docs/sw1-roadmap.md`.

### Request

| Parameter | In | Type | Default | Range | Meaning |
| --- | --- | --- | --- | --- | --- |
| `site_id` | path | string | required | an id from `GET /api/v1/sites` | Catalogue site |
| `start` | query | ISO 8601 datetime | **required** | window inside the ephemeris tables | First sample. No offset = UTC |
| `duration_h` | query | float, h | **required** | > 0 | Window length (the mission duration) |
| `step_min` | query | float, min | `10` | 1..1440 | Sample spacing of the arrays. Range edges are refined to ~1 s whatever the step |
| `mast_m` | query | float, m | `0` | 0..20 | As in `state`: absent, empty or `null` = 0 m |
| `comms_min_fraction` | query | float | `0.5` | 0..1 | As in `state` |

At most **20 000 samples** (`floor(duration_h × 60 / step_min) + 1`); above that, 422 with the count. A 14-day
mission at 10 min is 2 017 samples; a year needs `step_min` ≥ 27.

Example (a sunset inside a two-hour window):

```
GET /api/v1/sites/im-2/series?start=2026-11-30T20:00:00Z&duration_h=2&step_min=30
```

### Response 200

Real response, floats rounded here for reading:

```json
{
  "site_id": "im-2", "lat": -84.78, "lon": 29.13, "ground_m": 5312.6,
  "start": "2026-11-30T20:00:00Z", "end": "2026-11-30T22:00:00Z",
  "duration_h": 2.0, "step_min": 30.0, "samples": 5,
  "mast_m": 0.0, "mast_used_m": 0.0, "comms_min_fraction": 0.5, "horizon_kind": "terrain",
  "t": ["2026-11-30T20:00:00Z", "2026-11-30T20:30:00Z", "2026-11-30T21:00:00Z",
        "2026-11-30T21:30:00Z", "2026-11-30T22:00:00Z"],
  "sun": {
    "az": [252.8987, 252.6465, 252.3942, 252.142, 251.8897],
    "el": [-0.0622, -0.0843, -0.1064, -0.1285, -0.1505],
    "horizon_el": [0.1541, 0.1641, 0.1721, 0.1772, 0.1844],
    "visible_fraction": [0.0504, 0.0143, 0.0, 0.0, 0.0],
    "visible": [true, true, false, false, false]
  },
  "earth": {
    "az": [337.4225, 337.433, 337.4434, 337.4536, 337.4637],
    "el": [3.4681, 3.4361, 3.4041, 3.3722, 3.3403],
    "horizon_el": [-0.87, -0.87, -0.87, -0.87, -0.87],
    "visible_fraction": [1.0, 1.0, 1.0, 1.0, 1.0],
    "visible": [true, true, true, true, true]
  },
  "eclipse": ["none", "none", "none", "none", "none"],
  "sun_eclipsed_fraction": [0.0, 0.0, 0.0, 0.0, 0.0],
  "sunlit_ranges": [
    { "start": "2026-11-30T20:00:00Z", "end": "2026-11-30T20:50:42Z", "duration_h": 0.845,
      "starts_before_window": true, "ends_after_window": false }
  ],
  "comms_ranges": [
    { "start": "2026-11-30T20:00:00Z", "end": "2026-11-30T22:00:00Z", "duration_h": 2.0,
      "starts_before_window": true, "ends_after_window": true }
  ],
  "eclipse_ranges": [],
  "metrics": {
    "window_hours": 2.0, "sunlight_pct": 40.0, "comms_pct": 100.0, "both_pct": 40.0,
    "longest_dark_h": 1.5, "longest_blackout_h": 0.0,
    "continuous_light": false, "continuous_comms": true,
    "eclipse_minutes": 0.0, "eclipse_events": 0,
    "max_sun_el_deg": -0.0622, "min_sun_el_deg": -0.1505
  }
}
```

The Sun's centre is already below the horizon at 20:00, but the top of the disc still shows (fraction 0.05):
the disc, not the centre, decides "sunlit". It sets at 20:50:42, the same instant `state` announces.

### Fields

Window echo: `site_id`, `lat`, `lon`, `ground_m`, `ground_source`, `mast_m`, `mast_used_m`, `comms_min_fraction`, `horizon_kind` as
in `state`; `start` and `end` (first and last sample, UTC); `duration_h`, `step_min`; `samples` (length of every
array).

Arrays, one value per sample, aligned with `t`:

| Field | Type | Unit | Meaning |
| --- | --- | --- | --- |
| `t` | string[] | UTC | Sample instants, `start + i × step_min` |
| `sun.az`, `earth.az` | float[] | deg | Azimuth of the disc centre, clockwise from north, 0..360 |
| `sun.el`, `earth.el` | float[] | deg | Elevation of the disc centre (airless, apparent) |
| `sun.horizon_el`, `earth.horizon_el` | float[] | deg | Horizon elevation at the body's azimuth (draws the skyline under the track) |
| `sun.visible_fraction`, `earth.visible_fraction` | float[] | 0..1 | Share of the disc above the horizon |
| `sun.visible` | bool[] | | `visible_fraction > 0` ("sunlit") |
| `earth.visible` | bool[] | | `visible_fraction >= comms_min_fraction` ("comms") |
| `eclipse` | string[] | | `none` \| `partial` \| `total`: the Earth covering the Sun |
| `sun_eclipsed_fraction` | float[] | 0..1 | Share of the solar disc hidden by the Earth |

Ranges (`sunlit_ranges`, `comms_ranges`, `eclipse_ranges`), sorted and disjoint:

| Field | Type | Unit | Meaning |
| --- | --- | --- | --- |
| `start` | string | UTC | First instant in the state, refined to ~1 s and rounded up to the second; or the window start |
| `end` | string | UTC | First instant out of the state again, same rule; or the window end |
| `duration_h` | float | h | `end − start`. When cut by the window it is a lower bound |
| `starts_before_window` | bool | | Already in the state at the first sample: it may have begun earlier |
| `ends_after_window` | bool | | Still in the state at the last sample: it may go on after |

Metrics (from the samples, so at the grid's resolution):

| Field | Unit | Meaning |
| --- | --- | --- |
| `window_hours` | h | First to last sample |
| `sunlight_pct`, `comms_pct`, `both_pct` | % | Share of samples sunlit, with comms, with both |
| `longest_dark_h`, `longest_blackout_h` | h | Longest run of samples without Sun / without comms |
| `continuous_light`, `continuous_comms` | bool | Sun / comms at every sample |
| `eclipse_minutes`, `eclipse_events` | min, count | Time with any eclipse and number of separate eclipses |
| `max_sun_el_deg`, `min_sun_el_deg` | deg | Extremes of the solar elevation |

### Errors

| Status | When |
| --- | --- |
| 404 | Unknown `site_id` |
| 422 | `start` or `duration_h` missing or invalid; `duration_h` ≤ 0; `step_min` outside 1..1440; more than 20 000 samples (`detail` gives the count); `mast_m` or `comms_min_fraction` out of range |
| 400 | Any part of the window outside the ephemeris tables |

### Edge cases and reading notes

- **Fractions and ranges answer the same question at two resolutions.** Metrics count samples (above, 40 % of
  5 samples); ranges are exact to the second (0.845 h of 2 h = 42 %). For a decision use the ranges; for a chart
  the arrays.
- An event shorter than `step_min` that starts and ends between two samples is not seen. An event lasting D minutes is
  always caught when `step_min` < D (a 30 min occultation needs `step_min` below 30).
- During an eclipse `sun.visible` stays `true` (team convention); `eclipse_ranges` shows the darkness. Whether
  eclipses should count as dark in the light metrics is an open team question (`docs/sw1-roadmap.md`).
- Size: about 150 bytes per sample (30 days at 10 min ≈ 650 KB, ~0.2 s).

### How it was validated

`cd api && uv run python -m tests.sw1_validation` (pytest: `tests/test_series.py`):

1. **Equal to `state`**: sampled points of four windows (IM-2, Shackleton, Mons Malapert, Apollo 11, steps 5 to
   30 min) match `state` at the same instant to 1e-9 in every field.
2. **Edges flip `state`**: at each inner range edge, `state` is in the new state at the published instant and in
   the old one 2 s before. The first sunset and Earthset equal `state`'s `next_*_transition.at`. Edges are the same
   with a 5 min and a 60 min grid.
3. **JPL Horizons through `series`**: 32 comparisons for IM-1, worst 0.00042° (the site's height parallax).
4. **Ranges against samples and metrics**: ranges sorted, disjoint and inside the window; every sample inside a
   range is visible and every one outside is not; percentages, continuity flags, elevation extremes and eclipse
   counts recomputed from the arrays.
5. **NASA eclipse**: the 2029-06-26 total lunar eclipse is one eclipse range of 3 to 6 h containing NASA's
   greatest-eclipse instant (03:22:13 UTC).
6. **Guards**: 404, 422 cases including exactly 20 000 samples (accepted) and 52 561 (rejected), 400 for a window
   leaving the tables; 30 days answer in under 2 s (measured ~0.16 s).
7. **The validator is tested**: tampered series (wrong percentage, flipped flags, missing ranges, a power array)
   are rejected.

---

## `GET /api/v1/sites/{site_id}/horizon`

The 360° skyline of a catalogue site: the elevation of the terrain horizon at every half degree of azimuth, from
the LOLA masks the pipeline ray-traced to 175 km (`data/horizons.i16`). Optionally the same for the neighbours on
two rings around the site (`data/zones.i16`), which shows how much a few hundred metres change the sky. No time
dependence. This is the curve the panorama draws under the Sun and Earth tracks, and the `horizon_el` that
`state` and `series` report is this profile read at the body's azimuth.

### Request

| Parameter | In | Type | Default | Range | Meaning |
| --- | --- | --- | --- | --- | --- |
| `site_id` | path | string | required | an id from `GET /api/v1/sites` | Catalogue site |
| `mast_m` | query | float, m | `0` | 0..20 | As in `state`: absent, empty or `null` = 0 m. Terrain sites snap to the nearest stored mask |
| `include_zone` | query | bool | `false` | `true`/`false` | Also return the neighbours' masks (2 m mast only) |

```
GET /api/v1/sites/im-2/horizon?mast_m=2&include_zone=true
```

### Response 200

Real response, arrays shortened here (each has 720 values):

```json
{
  "site_id": "im-2", "lat": -84.78, "lon": 29.13, "ground_m": 5312.6,
  "mast_m": 2.0, "mast_used_m": 2.0, "masts_available_m": [0.0, 2.0, 5.0, 10.0],
  "horizon_kind": "terrain",
  "az_step_deg": 0.5,
  "az": [0.0, 0.5, 1.0, 1.5, 2.0, 2.5, "...", 359.5],
  "elevation_deg": [-0.47, -0.47, -0.47, -0.47, -0.5, -0.54, "...", -0.49],
  "max_deg": 4.01, "max_az_deg": 118.0,
  "min_deg": -1.46, "min_az_deg": 328.0,
  "mean_deg": 1.0188,
  "zone_available": true,
  "zone": {
    "mast_m": 2.0,
    "points": [
      { "bearing_deg": 0.0, "distance_m": 0.0, "lat": -84.78, "lon": 29.13, "ground_m": 5312.6,
        "elevation_deg": [-0.47, -0.47, -0.47, "..."],
        "max_deg": 4.01, "max_az_deg": 118.0, "min_deg": -1.46, "min_az_deg": 328.0, "mean_deg": 1.0188 },
      { "bearing_deg": 0.0, "distance_m": 500.0, "lat": -84.76351, "lon": 29.13, "ground_m": 5291.1,
        "elevation_deg": [-0.39, -0.39, -0.38, "..."],
        "max_deg": 4.02, "max_az_deg": 119.5, "min_deg": -1.4, "min_az_deg": 327.5, "mean_deg": 1.1919 },
      "... 15 more: bearings 0, 45, ..., 315 at 500 m, then the same at 1500 m"
    ]
  }
}
```

With `include_zone=true` the response is about 72 KB; without it about 9 KB.

### Fields

| Field | Type | Unit | Meaning |
| --- | --- | --- | --- |
| `site_id`, `lat`, `lon`, `ground_m` | | | As in `state` |
| `mast_m` | float | m | Mast requested |
| `mast_used_m` | float | m | Mast of the profile returned: nearest stored terrain mask, or `mast_m` on a smooth sphere |
| `masts_available_m` | float[] | m | Masts with a stored terrain mask; `[]` on a smooth sphere (any mast is computed exactly) |
| `horizon_kind` | `terrain` \| `smooth_sphere` | | Where the profile comes from |
| `az_step_deg` | float | deg | Azimuth spacing (0.5) |
| `az` | float[720] | deg | Azimuths, clockwise from north, 0 to 359.5 |
| `elevation_deg` | float[720] | deg | Skyline elevation at each azimuth. Stored to 0.01°. Between azimuths interpolate linearly, wrapping at 360° (the engine's rule) |
| `max_deg`, `max_az_deg` | float | deg | Highest skyline point and its azimuth (first one if repeated) |
| `min_deg`, `min_az_deg` | float | deg | Lowest skyline point and its azimuth |
| `mean_deg` | float | deg | Mean over the 720 azimuths |
| `zone_available` | bool | | The site has neighbour masks (the 13 terrain sites) |
| `zone` | object \| null | | `null` unless `include_zone=true` and `zone_available` |
| `zone.mast_m` | float | m | Always 2: the pipeline stores neighbours for the 2 m mast only, whatever `mast_m` asked |
| `zone.points[]` | object | | Site centre first (`distance_m` 0, the same mask as the site at 2 m), then 8 bearings at 500 m, then 8 at 1500 m. Each has `bearing_deg`, `distance_m`, `lat`, `lon`, `ground_m`, `elevation_deg` (720) and the same summary fields |

### Errors

| Status | When |
| --- | --- |
| 404 | Unknown `site_id` |
| 422 | `mast_m` outside 0..20 or not a number; `include_zone` not a boolean |

### Edge cases and reading notes

- Negative elevations are normal: from a raised point the horizon dips below the horizontal.
- A smooth-sphere site (Apollo, Blue Ghost, SLIM) returns a flat profile at `-acos(R / (R + mast))`
  (`-0.087°` at 2 m, `0` at 0 m), `masts_available_m: []` and no zone.
- Asking `mast_m=3` on a terrain site returns the 2 m mask (`mast_used_m: 2`); `state` and `series` do the same.
- The zone shows how sensitive the site is. At Mons Malapert the long-term sunlight across the 17 points ranges
  from 25 % to 73 %: a lander a few hundred metres off target sees a very different sky.

### How it was validated

`cd api && uv run python -m tests.sw1_validation` (pytest: `tests/test_horizon.py`):

1. **Bit-exact against the files**: every value (site at each mast, and all 17 zone points) equals an independent
   read of `horizons.i16` / `zones.i16` (int16 / 100) at the offsets in `sites.json`, without the API's own
   repository code. All 21 sites × masts 0, 2, 3, 10.
2. **Catalogue**: max and mean at 2 m equal `sites.json` (`horizon2mMaxDeg`, `horizon2mMeanDeg`).
3. **Physics and geometry**: a higher mast never sees a higher skyline (0 ≥ 2 ≥ 5 ≥ 10 m at all 720 azimuths, 13
   sites); the smooth sphere equals `-acos(R / (R + h))`; the zone centre is the site's 2 m mask; every
   neighbour is at its stated distance (< 1 m) and bearing (< 0.5°) by haversine; summaries recomputed.
4. **Consistency with `state`**: `state`'s `horizon_el` for the Sun and the Earth equals this profile
   interpolated at their azimuths (1e-9).
5. **Independent NASA product (PGDA product 69, Mazarico et al.)**: the engine runs 2025-2035 over each served
   zone mask; the mean visible solar-disc fraction and the share of time with any of the Earth's disc visible,
   taken across the 17 zone points, bracket PGDA's 18.6-year average (960 m cells) within ±0.02 at **13 of 13
   sites for the Sun and 13 of 13 for the Earth**. The six permanently shadowed craters are 0 in both. PGDA's
   Earth map counts "any part of the disc visible", so the comparison uses that definition; the comms flag
   (half the disc) reads lower.
6. **Open sky against NASA PGDA SKYV** (independent solid-angle map, 960 m cells): the open-sky solid angle
   integrated from each served 2 m mask, `∫ (1 − sin h) d(az)`, matches with a median error of 0.024 sr over the
   13 terrain sites (Shackleton 3.997 against 4.004 sr; a flat plain is 6.283). Largest gap Mons Malapert, 5.918
   against 6.222 sr: the cell averages the summit with its slopes. Criterion: median < 0.05 sr, every site
   < 0.35 sr.
7. **The validator is tested**: a value changed by 0.01°, a wrong azimuth of the maximum, a neighbour moved by
   0.01°, a reversed zone mask and a wrong `mast_used_m` are each rejected.

---

## `GET /api/v1/points/state`

`state` for any point typed in by the user instead of a catalogue site. Same output model (`StateResponse`), same
fields and meaning, built by the same function; what changes is where the horizon and the ground come from.

### Request

| Parameter | In | Type | Default | Range | Meaning |
| --- | --- | --- | --- | --- | --- |
| `lat` | query | float, deg | **required** | -89.9999..89.9999 | Planetocentric latitude. The exact poles are rejected: there "north", and so the azimuth, is undefined |
| `lon` | query | float, deg | **required** | -180..360 | East-positive longitude. 0..360 is accepted and normalised to -180..180 (`330` → `-30`, `180` → `-180`, the same meridian) |
| `t` | query | ISO 8601 | **required** | inside the tables | As in `state` |
| `mast_m` | query | float, m | `0` | 0..20 | As in `state` (null = 0). Used exactly: no stored masks to snap to |
| `comms_min_fraction` | query | float | `0.5` | 0..1 | As in `state` |

```
GET /api/v1/points/state?lat=-84.7906&lon=29.1957&t=2026-11-20T12:00:00Z&mast_m=2
```

### Response 200

The `state` model with `site_id: null`. Real response (floats rounded for reading):

```json
{
  "site_id": null,
  "lat": -84.7906, "lon": 29.1957,
  "ground_m": 5327.5, "ground_source": "lola_grid",
  "t": "2026-11-20T12:00:00Z",
  "mast_m": 2.0, "mast_used_m": 2.0, "comms_min_fraction": 0.5,
  "horizon_kind": "smooth_sphere",
  "sun":   { "az": 18.4425, "el": 6.4867, "horizon_el": -0.08694, "visible_fraction": 1.0, "visible": true,
             "angular_radius_deg": 0.26926, "distance_km": 148037935.5 },
  "earth": { "az": 323.2564, "el": 7.9783, "horizon_el": -0.08694, "visible_fraction": 1.0, "visible": true,
             "angular_radius_deg": 0.96031, "distance_km": 380562.5 },
  "eclipse": "none", "sun_eclipsed_fraction": 0.0,
  "next_sun_transition":   { "kind": "set", "at": "2026-12-01T02:40:48Z", "in_hours": 254.68 },
  "next_earth_transition": { "kind": "set", "at": "2026-12-03T11:42:53Z", "in_hours": 311.715 },
  "transition_search_days": 45.0
}
```

Fields: see `GET /api/v1/sites/{site_id}/state` above.

### What differs from a catalogue site

- **`horizon_kind` is always `smooth_sphere`**, at `-acos(R / (R + mast_m))` in every direction. No terrain mask
  exists for an arbitrary point, and computing one takes minutes per point.
- **The answer can err either way, not only optimistically.** In a crater or on a slope the real skyline is higher
  and the point overstates light and comms. On a summit it is lower and the point understates them. Same instant,
  IM-2 at 2 m: the site endpoint (terrain) has the Earth setting on 2026-12-04 09:56; the point at the same
  coordinates (smooth sphere) on 2026-12-03 11:42, almost a day earlier, because Mons Mouton's real skyline
  dips to -1.46°.
- **Ground**: from the LOLA grid south of 60° S (`ground_source: "lola_grid"`), else 0 m
  (`"reference_sphere"`). Typing a catalogue site's coordinates still gives the grid's height (960 m cells), not
  the site's pipeline value: 5 327.5 m here against 5 312.6 m for the IM-2 site.

### Errors

| Status | When |
| --- | --- |
| 422 | `lat` or `lon` missing, not a number or out of range (the exact poles included); `t`, `mast_m`, `comms_min_fraction` as in `state` |
| 400 | `t` outside the ephemeris tables |

### How it was validated

`cd api && uv run python -m tests.sw1_validation` (pytest: `tests/test_points.py`):

1. **JPL Horizons at every fixture place**: all 11 cases (both poles' regions, Shackleton, Malapert, Mons Mouton,
   IM-1, Chandrayaan-3, Apollo 11, Mare Crisium, far side, a +4 km site) asked as coordinates: 352 comparisons,
   worst 0.00086° (Mons Mouton, the parallax of the grid's 5.3 km ground against Horizons' 0 km).
2. **Equal to the site endpoint** at smooth-sphere catalogue sites (Apollo 11, Apollo 17, SLIM, Blue Ghost):
   identical responses except `site_id`.
3. **The lower skyline always sees more**: at IM-2, Mons Malapert, Nobile and Shackleton, over 2027, terrain
   (site) against smooth sphere (point): when the terrain is below the smooth dip across the whole disc it sees at
   least as much (687 cases), when above at most as much (1 201 cases). This replaces the claim that terrain can
   only shorten light, which the data refutes on peaks.
4. **Ground source** inside and outside the grid; **longitude** 0..360 and -180..180 give identical answers;
   **invariants** of `state` on points from 89.9999° S to 89.9999° N; **transitions** flip the state at the
   published second.
5. **The validator is tested**: a site response doctored to see the full Sun under a higher skyline is caught.

