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

- **Level 2 asks for the least possible (owner decision, 2026-11-15):** only the lunar terminal's EIRP and the data
  rate are required. The band (S, X or Ka, default X) picks the frequency, or the user types one. Each antenna uses
  its own downlink G/T: DSN from 810-005, Misasa from JAXA's specification, and the rest (ESA, Usuda, Uchinoura, DSS-36
  in Ka, custom dishes with a diameter) scaled from the DSN 34 m mean by 20 log10(D / 34 m), flagged `estimated`.
  Defaults: required Eb/N0 9.6 dB (uncoded BPSK at BER 1e-5, conservative), minimum margin 3 dB.
- **No warning icon for the ESA elevation estimate in the interface (owner decision).** The API still returns
  `estimated_limits` and the per-antenna `limit_source` / `gt_basis`, so the information is there if it is needed.

## 3b. Additive edits to shared backend files (team notice)

Nothing was renamed or removed; callers that do not use the new options behave exactly as before.

- `api/app/db/store.py`: new optional field `DataStore.stations` (and one line in `load_store`).
- `api/app/logic/constraints/base.py`: new optional field `ConstraintContext.contact` (bool series, default `None`).
- `api/app/services.py`: new functions `link_stations`, `link_views`, `link_contact` (end of file) and two optional
  parameters of `constraint_context`, `link_networks` and `link_direction`. SW-2: pass `link_networks=[...]` when the
  user selected antenna networks and `comms_hours` / `max_blackout` will use ground-antenna contact instead of the
  Earth's line of sight alone.
- `api/app/main.py`: one import and one `include_router` line for the link router.

## 4. Frontend (branch `feat/aero2-link-panel`)

The link is now in the interface. The section is still opened with the "Earth link" button of the map tool bar
(`panels/PlacePanel.tsx`, unchanged); what it shows is new.

- `panels/LinkPanel.tsx` (rewritten): a Geometry / Budget switch; one status line (link now or why not, and when it
  changes); four figures (link time, longest gap, Earth up, antennas or margin); the networks as checkboxes (all three
  selected by default, so all their antennas are used); the best three antennas; a table with every antenna behind a
  `<details>`; at Budget level the band (S, X, Ka), the lunar EIRP and the data rate, with the other budget fields
  under "More options" and empty (the API's stated defaults apply); direction and the user's own antennas under
  "Direction and own antennas". The answer updates by itself after each valid change (a short pause while typing); the previous
  answer stays on screen, marked "updating", until the new one arrives. While the budget is incomplete the geometry is
  asked instead, so the panel and the timeline keep showing the contact and the panel says what is missing.
- `charts/Timeline.tsx`: the single-place strips are now `Sunlit`, optionally `Earth up`, and `Link` (bars only where
  there is real link). At Budget level a `Margin` chart goes under them: the best Eb/N0 margin at each sample as a line
  against a dashed line at the margin the user asks for; the link is closed where the line is at or above the dashed one,
  and a break in the line means no antenna is in contact. The Earth row is hidden while the link answer is available and
  appears in its place if the API does not answer.
- Comparison (Multiselect), `charts/Timeline.tsx` and `compare/ComparePanel.tsx`: the Sunlit / Earth switch is now
  Sunlit / Link, and each place's strip shows only real link (nothing while the budget is incomplete); no margin chart
  here. The radar axes "Earth contact" and "Steady contact" became **Link** (share of the window with link) and
  **Steady link** (longest unbroken link ÷ window length; before it was 1 − longest blackout ÷ window). "Link" means
  the same as the strip: the Earth is in view, an antenna of the chosen networks sees the Moon and, at Budget level,
  the margin reaches the one asked for (at Geometry level, just the contact). While the link is not available the two
  axes read "not available" and sit at 0, and the form's problem is written above the radar. The same settings as the
  single place (level, networks, budget, direction, own antennas) are under "Link settings" in the panel.
  `LinkSummary.longestLinkH` is new.
- The "Filters" button of the top bar was removed; the `Earth up` row only appears as the fallback when the link
  answer is missing.
- `panels/linkModel.ts` (pure, tested in `linkModel.test.ts`), `state/link.ts` (form state and the shared request),
  `api/client.ts`, `api/hooks.ts`, `api/types.ts`: the client, hooks and types of `/api/v1/link`.
- `api/schema.gen.ts` was regenerated with `npm run gen:api` (the committed one was behind the API); `types.ts`
  `Transition` now points at `app__schemas__state__Transition`, the name the generator gives it.
- Owner decisions of 2026-11-15: the "Earth contact" slider is gone (the 0.5 stays); the budget level requires what
  characterises the user's own radio and antennas: lunar EIRP, data rate, the Eb/N0 needed, the lunar G/T for an uplink,
  and for each own antenna its G/T or its dish diameter. Only generic values keep a default (band X, margin 3 dB, other
  losses 0 dB). The note under the antenna table was removed. The timeline's Link row draws only real link: with no link,
  or while the budget is incomplete, it stays empty.
- Nothing is pre-filled except the networks. The ESA elevation warning is not shown (owner decision); `estimated_limits`
  and `gt_basis` stay in the API response.
- Shared frontend files touched, additions only apart from the rewrite of `LinkPanel.tsx` and the strip of
  `Timeline.tsx`: `app/Layout.tsx` (one component), `ui/panels.css` (new classes at the end), `api/*`.