# SW-1 integration notes: discrepancies to fix when merging

Written 2026-11-14 for the merge of `seryitron-branchito` (SW-1, Sergio: `sites/{id}/state`, `sites/{id}/series`,
`sites/{id}/horizon`, `points/state`, `points/series`) with `main` and the other feature branches.
**Owner of the fixes: Pedro (SW-2)**, coordinating with Álvaro (MECH) for the items in his branch.

The contract of the SW-1 endpoints is `docs/sw1-output-format.md` (meaning, units, examples) and the server's
`/openapi.json` (machine-readable). The decisions behind it are in `docs/sw1-roadmap.md`. Where this file and the
older `docs/endpoints.md` spec disagree, the SW-1 contract wins: the owner changed it on purpose (sections below).

State checked against `main` at `b7d172c` and `origin/feat/mech-power` at `ace1e15`.

---

## 1. Frontend (`web/`, main) against the SW-1 contract

`web/src/api/types.ts` was written from the first `docs/endpoints.md` draft ("pending" types). The SW-1 endpoints
answer differently. Nothing breaks today because the endpoints are not deployed and the web falls back to its
browser engine; it breaks as soon as the API is connected.

**Quickest fix:** check out `seryitron-branchito` (or main after its merge), run `npm run gen:api` in `web/`
(regenerates `schema.gen.ts` from `/openapi.json`), then replace the hand-written SW-1 types in `types.ts` with the
generated ones and update the readers below.

### 1.1 Field-by-field

| Frontend expects (`web/src/api/types.ts`) | SW-1 returns | Why |
| --- | --- | --- |
| `BodyState.az_deg`, `el_deg` (lines 38-39) | `az`, `el` | Names of `docs/endpoints.md`; units are in the OpenAPI descriptions |
| `SiteState.eclipse: number` (line 56) | `eclipse: "none" \| "partial" \| "total"` and `sun_eclipsed_fraction` (0..1) | Readable enum; the fraction gives the depth |
| `SiteState.irradiance_w_m2`, `power_w_m2` (lines 57-58) | **removed** | Owner's decision: power belongs to MECH's `/power` only, so the merged API has one power figure |
| `SiteSeries.sun_az`, `sun_el`, `sun_fraction`, `earth_*` (flat arrays, lines 73-78) | `sun: {az[], el[], horizon_el[], visible_fraction[], visible[]}`, same for `earth` | Grouped per body, like `state` |
| `SiteSeries.power_w_m2[]` (line 79) | **removed** | As above |
| `SiteSeries.metrics: Record<…>` | same keys **minus** `mean_power_w_m2` | As above |
| — | New: `ground_source`, `horizon_el`, `visible`, `eclipse_ranges`, `starts_before_window` / `ends_after_window` on ranges, `transition_search_days`, `comms_min_fraction` echo | See `docs/sw1-output-format.md` |
| — | New on `points/*` only: `terrain_reference` | Tells which way the smooth-sphere estimate errs at the point (NASA PGDA); `null` north of 65° S |
| `TimeRange {start, end}` | same, plus `duration_h` and the two window flags | Compatible |

### 1.2 Request parameters

| Frontend sends (`web/src/api/client.ts`) | SW-1 accepts |
| --- | --- |
| `panel` (lines 83 and 92; `Timeline.tsx` line 46) | **Not a parameter any more.** It is ignored (no error), so nothing fails, but it has no effect: send it to `/power` |
| `mast_m` always sent | Fine. If omitted, empty or `null` it means **0 m** (owner's decision), not 2 m |
| `lat`/`lon` for points | -89.9999..89.9999 (exact poles rejected, 422) and -180..360 (0..360 normalised) |

### 1.3 Code that reads the old fields

- `web/src/panels/useNow.ts` lines 38-40 (`fromApiBody`): `b.az_deg`, `b.el_deg` → `b.az`, `b.el`.
- `web/src/panels/useNow.ts` lines 54-56 (`fromApi`): `s.eclipse` is now a string (map `none/partial/total` to the
  0/1/2 the browser engine uses, or switch the view to the string); `s.irradiance_w_m2` and `s.power_w_m2` no longer
  exist: take power from `POST /api/v1/power` (MECH) or keep the browser engine's value, and label which one.
- `web/src/charts/Timeline.tsx` lines 53-66: **already compatible** (uses `sunlit_ranges`, `comms_ranges` and the
  metrics `sunlight_pct`, `comms_pct`, `longest_dark_h`, `longest_blackout_h`, which keep their names). Only drop
  `panel` from `apiParams` (line 46).

---

## 2. MECH branch (`feat/mech-power`, not merged) against SW-1

### 2.1 Eclipse factor in the engine: resolved in SW-1, keep it that way

The engine's `Series.power_w_m2` carries **no** eclipse factor. MECH applies `(1 − obscuration)` once, in its power,
battery and thermal code (`logic/eclipse.py`). An earlier SW-1 commit had folded the factor into the engine; it was
removed (commit "Leave the eclipse factor to the power model, not the engine") because with both branches merged
every eclipse would have counted twice (an eclipse hiding 80 % of the Sun would have left 4 % of the power, not 20 %).

- SW-1's `sun_eclipsed_fraction` (in `Series` and in the responses) and MECH's `obscuration` are the same geometry
  and agree to 4e-12 over four eclipses at three sites (minute steps). Optional clean-up after both merge: one
  function, e.g. MECH's `obscuration` returning `series.sun_eclipsed_fraction`.
- Merge conflict to expect in `api/app/logic/engine.py`: SW-1 **added** `sun_eclipsed_fraction` to `Series` and
  `refined_ranges` at the end of the file (additive). Keep both sides.

### 2.2 Naming and defaults

| Item | SW-1 | MECH (`docs/api-guide-mech.md`) | Suggested |
| --- | --- | --- | --- |
| Mast actually used | `mast_used_m` | `mast_m_used` | One name across the API; `mast_used_m` keeps the unit as suffix like `duration_h`, `step_min` |
| Default mast | **0 m**; absent/empty/`null` = 0 (owner's decision) | 2 m | Same default everywhere; agree it in the team |
| Angles | `az`, `el` inside `sun`/`earth` objects | `sun_el_deg[]` flat | Either is fine inside one endpoint; the frontend must not mix them by accident |

### 2.3 Overlapping endpoint: `POST /api/v1/sun` (MECH) vs `state` / `series` (SW-1)

MECH's `/sun` returns Sun elevation, visible fraction, sunlit ranges, `next_transition` and eclipses: the same
quantities as SW-1's `series` (`sunlit_ranges`, `eclipse_ranges`) and `state` (`next_sun_transition`). Two
implementations can give different numbers. Notably SW-1 refines range edges and transitions to the second and
publishes them rounded **up** (the printed instant is already in the new state); check what `/sun` does.
Team decision needed: keep one, or make `/sun` call `services.series_window` / `services.state_at`.

---

## 3. Other notes for whoever merges

- **Shared files touched by SW-1 (additive):** `api/app/main.py` (router registration),
  `api/app/services.py` (state, series, horizon, point glue), `api/app/logic/engine.py` (`sun_eclipsed_fraction`,
  `refined_ranges`), `api/app/logic/visibility.py` (`disc_overlap_fraction`).
- **New files:** `api/app/routers/{state,horizon,points,params}.py`, `api/app/schemas/{state,horizon,points}.py`,
  `api/tests/{test_state,test_series,test_horizon,test_points,test_eclipse,sw1_validation}.py`,
  `api/tests/fixtures/nasa_lunar_eclipses_2025_2035.json`, `docs/sw1-*.md`.
- **`CLAUDE.md`:** after the merge, add the SW-1 rows to "Implemented endpoints and filters" (not done in the
  branch: the table is updated when the work is merged).
- **AERO-1:** `api/app/logic/constraints/light.py:30` still says "real terrain can only shorten the light"; the
  rule was corrected in `CLAUDE.md` on main (commit 7e3102c). Suggested text: "smooth-sphere horizon: an estimate,
  real terrain can shorten or lengthen the light".
- **`docs/endpoints.md`:** the SW-1 sections on the branch already describe the contract as built.
- **How to check after the merge:** `cd api && uv run pytest -q` (240 tests) and
  `uv run python -m tests.sw1_validation` (15 blocks: JPL Horizons, NASA eclipse catalogue, NASA PGDA maps, internal
  consistency between endpoints). Every block must print PASS.
