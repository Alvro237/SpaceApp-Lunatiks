# SW-1 endpoints: request and output format

Contract of the SW-1 endpoints (owner: Sergio), written so the main branch and the frontend can integrate
them without reading the code. The machine-readable source of truth is `/openapi.json`; this file explains
the meaning, units and edge cases. One section per endpoint, added as each one is finished.

| Endpoint | Status |
| --- | --- |
| `GET /api/v1/sites/{site_id}/state` | Done, validated (this file) |
| `GET /api/v1/sites/{site_id}/series` | To do |
| `GET /api/v1/sites/{site_id}/horizon` | To do |
| `GET /api/v1/points/state` | To do (same output as `sites/{id}/state`, `site_id: null`) |
| `GET /api/v1/points/series` | To do |

Conventions in every response: Moon Mean-Earth frame (MOON_ME); angles in degrees; azimuth clockwise from
north, 0..360; times ISO 8601 UTC with a trailing `Z`; snake_case fields; `horizon_kind` always present.

---

## `GET /api/v1/sites/{site_id}/state`

Sun and Earth as seen from a catalogue site at one instant: where they are, how much of each disc is above the
local horizon, the solar power it gives, and how long until the next sunset/sunrise and Earthset/Earthrise.

### Request

| Parameter | In | Type | Default | Range | Meaning |
| --- | --- | --- | --- | --- | --- |
| `site_id` | path | string | required | an id from `GET /api/v1/sites` | Catalogue site |
| `t` | query | ISO 8601 datetime | **required** | inside the ephemeris tables (2025-2035, 1969-1972) | Instant. No offset means UTC; offsets are converted (`13:00+01:00` = `12:00Z`) |
| `mast_m` | query | float, m | `0` | 0..20 | Panel/antenna height above the ground. **Absent, empty (`mast_m=`) or `null`/`none` (any case) = 0 m**, the ground itself. Terrain sites use the nearest stored mask (0, 2, 5, 10 m) |
| `panel` | query | `tracking` \| `vertical` \| `horizontal` | `vertical` | | Solar array model for `power_w_m2` (cos factor 1, cos(el), max(0, sin(el))) |
| `comms_min_fraction` | query | float | `0.5` | 0..1 | Share of the Earth's disc above the horizon needed to count as direct-to-Earth comms |

Defaults for `panel` and `comms_min_fraction` are the engine defaults in `app/logic/engine.py`
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
  "panel": "vertical",
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
  "irradiance_w_m2": 1389.83,
  "power_w_m2": 1380.91,
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
| `ground_m` | float | m | Ground height above the 1737.4 km sphere (0 where no terrain data was read) |
| `t` | string | UTC | The instant evaluated, normalised to `YYYY-MM-DDTHH:MM:SSZ` |
| `mast_m` | float | m | Mast height requested |
| `mast_used_m` | float | m | Mast of the horizon actually used: nearest stored terrain mask, or `mast_m` on a smooth sphere |
| `panel`, `comms_min_fraction` | | | Echo of the parameters used |
| `horizon_kind` | `terrain` \| `smooth_sphere` | | `terrain`: LOLA ray-traced mask. `smooth_sphere`: geometric dip only; real terrain can only shorten light and comms |
| `sun`, `earth` | object | | See below |
| `eclipse` | `none` \| `partial` \| `total` | | The Earth covering the Sun as seen from the site (what the Earth sees as a lunar eclipse) |
| `sun_eclipsed_fraction` | float | 0..1 | Share of the solar disc hidden behind the Earth: 0 with `none`, 1 with `total` |
| `irradiance_w_m2` | float | W/m² | 1361 / r_AU², normal to the rays, before horizon and panel factors |
| `power_w_m2` | float | W/m² | `irradiance_w_m2 × sun.visible_fraction × (1 − sun_eclipsed_fraction) × panel factor`, per m² of array, before cell efficiency. 0 during a total eclipse |
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
| 422 | `t` missing or not a date; `mast_m` outside 0..20; unknown `panel`; `comms_min_fraction` outside 0..1 | FastAPI validation body |
| 400 | `t` outside the ephemeris tables | `{"detail": "t=2040-01-01T00:00:00Z is outside the ephemeris tables (…)"}` |

### Edge cases

- A null transition is a real answer, not a failure: near the sub-Earth point (Apollo 11) the Earth never sets.
- Sites without a terrain mask (Apollo, Blue Ghost, SLIM) answer with `horizon_kind: "smooth_sphere"`.
- During an eclipse `sun.visible` stays `true` (the disc is above the horizon: the team convention for
  "sunlit") while `power_w_m2` drops; read `eclipse` and `sun_eclipsed_fraction` for the darkness.
- The eclipsed share uses the area of overlap of two uniform discs (no limb darkening; the Earth's atmosphere,
  which bends some red light into the shadow, is ignored). When an eclipse coincides with the Sun crossing the
  skyline, horizon and Earth are combined as independent factors, which is exact whenever either is 0 or 1.

### How it was validated

Run `cd api && uv run python -m tests.sw1_validation` (pytest runs the same checks in `tests/test_state.py`):

1. **JPL Horizons through HTTP**: 32 comparisons (Sun and Earth, 16 dates 2027-2033) for IM-1, whose
   coordinates match a fixture case. Worst error 0.00042° against a 0.01° tolerance. That residual is the
   expected parallax of the site's 2.6 km ground height (the fixture is at 0 km): 2.6 / 380 000 rad ≈ 0.0004°.
2. **Physical invariants** on all 21 sites × 4 dates × 3 panel models: ranges, disc radius from distance,
   irradiance = 1361 / r_AU², power = irradiance × fraction × panel factor, fraction consistent with
   `el - horizon_el`, `visible` consistent with the thresholds, transitions in the future and `in_hours = at - t`.
3. **Events**: each reported transition flips the state between 60 s before and 60 s after `at`.
4. **Eclipses against NASA's catalogue** (Espenak, GSFC, 25 lunar eclipses 2025-2035): at greatest eclipse
   of each of the 10 total ones the Sun is fully hidden and `power_w_m2` is 0; no penumbral one hides the whole
   Sun; every eclipse the engine finds at Apollo 11 in eleven years is a catalogue eclipse. The overlap formula
   has hand-worked tests (disjoint, inside, area ratio, two unit circles one radius apart = 0.391002).
5. **The validator is tested**: tampered responses (wrong power, disc size, irradiance, eclipse, flag) are
   rejected.
