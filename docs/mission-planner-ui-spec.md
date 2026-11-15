# Mission Planner: panel, inputs and behaviour (changes)

**Implementation and validation specification.** Written 2026-11-15 by Opus for the model that implements it
(Claude Sonnet), from Sergio's review of the running app. Every decision is taken here: follow the steps in order,
copy what is given, run the checks, and stop to ask the person only where it says **ASK**.

Repository: `/Users/sergio_ini/Documents/NasaSpaceApps/repos/SpaceApp-Lunatiks` ("the repo"); paths are relative to
it. Checked against `main` at `f29c8a3`.

## 0. Relation to the first specification

`/Users/sergio_ini/Documents/NasaSpaceApps/docs/mission-design-spec.md` (the "first spec") stays valid for PR 1
(ephemeris bound, already implemented in the working tree, uncommitted) and PR 2 (crater shape). This document
**replaces** its section 9 (web) entirely and **amends** its section 8 (API) as written in section 6 here. Where
the two disagree, this document wins.

Work is split in two stages:

- **Stage A (web only, no API change):** the new panel, the region fix, the info bubbles, the camera behaviour, the
  past-landing pins, the redesigned inputs mapped onto today's `POST /api/v1/areas/search`, live preview, the heat
  colours and the results list on the right. Inputs that need new computations are shown but disabled with "Comes
  with the suitability search" until Stage B.
- **Stage B (after the first spec's PR 3, amended by section 6):** the client switches to
  `POST /api/v1/suitability/search`; every input is enabled; category priorities; top-10 sites with pros and cons.

## 1. Ground rules

Same as section 2 of the first spec. In short: Spanish to the person, English in the repo; no commits, pushes, or
pull requests unless the person says so; **ASK** before editing files owned by another role. This document edits
web files owned by SW-1/SW-2 (`app/NavigatorPage.tsx`, `panels/*`, `ui/Tip.tsx`, `globe/*`, `terrain/*`):
**ASK** the person to confirm the owners agree before starting. No threshold defaults except the region radius
(20 km, the person's decision on 2026-11-15) and the existing team parameter `comms_min_fraction` = 0.5.

Before writing code, check the base did not move: `git log --oneline f29c8a3..origin/main --
web/src/panels web/src/app web/src/ui/Tip.tsx web/src/globe web/src/terrain web/src/state api/app/area_search.py
api/app/schemas/areas.py`. If anything is listed, read those diffs and **ASK** before continuing.

## 2. What is wrong today (found on 2026-11-15)

| # | Problem | Cause (file:line on `f29c8a3`) |
| --- | --- | --- |
| P1 | The region cannot be changed | Mission mode opens on the globe. A click on the globe in mission mode only turns the Moon: `web/src/globe/GlobeView.tsx` `onPointerUp`, the `pendingClick` timeout does `if (mode === 'study') select(...) else orbit.turnTo(...)`. Only the polar map sets the centre (`web/src/terrain/TerrainView.tsx` `onPointerUp`, `useAreas.getState().set({ center })`). The panel only offers "Centre on <selected place>", and in mission mode nothing gets selected on the globe |
| P2 | The panel covers the timeline and the caption | `.mission-pop .pop-panel` (`ui/panels.css`) is 400 px wide and grows to 753 px: at 1440 × 900 it runs from y = 117 to 870, over the timeline (`.float-bottom`, y = 782) and the caption `.globe-caption` (y = 750) |
| P3 | Info notes push the content and can be cut | `ui/Tip.tsx` renders the note inline in the row (`.tip-note`) |
| P4 | The Moon turns by itself in mission mode | `globe/orbit.ts` `isSpinning`: spins after `IDLE_BEFORE_SPIN_MS` = 20 s unless the user pinned it |
| P5 | Inputs that are unclear or redundant | See section 4 |

Measured layout at 1440 × 900: header bottom y = 57; date pill (`.where-when`) x = 10, y = 67, 266 × 42 px.

## 3. The new layout

### 3.1 Left panel "Mission planner inputs"

- In mission mode the toolbar button "Mission filters" (`NavigatorPage.tsx`, the `<Popover label="Mission filters"
  …>` in `.toolstrip`) is **removed**. In its place, a floating panel is always shown on the left:
  `<section className="float float-left planner-panel" aria-labelledby=…>` rendered by `NavigatorPage` when
  `!blocks && mode === 'mission'`.
- **Width:** one CSS custom property `--planner-w: 320px` on `.navigator`. In mission mode the date pill group
  (`.where-when`) also takes `width: var(--planner-w)`, so the date and the panel line up as one column. (The person
  asked for "the same width as the date, a bit longer than now": 320 px is the interpretation; changing that one
  variable changes both.)
- **Top:** 8 px below the date pill. **Bottom:** 12 px above the highest of the elements at the bottom of the
  screen that overlap the panel's column: `.float-bottom` (timeline), `.globe-caption`, and the map's legend and
  stats (`.map-stats`, the legend of `terrain/Legend.tsx`). Compute it at runtime: a `useLayoutEffect` with a
  `ResizeObserver` and the same `MutationObserver` pattern as `useMeasureInsets` (`NavigatorPage.tsx`), taking
  `min(rect.top)` of those elements whose horizontal extent intersects `[10, 10 + --planner-w]`, and set
  `--planner-bottom` (px from the bottom of the window) on `.navigator`. CSS: `top: calc(<date pill bottom> + 8px);
  bottom: calc(var(--planner-bottom) + 12px)`. The panel never touches the text or bars below it.
- The panel body scrolls (`overflow-y: auto`); its header and its footer (the Simulate row, 3.4) stay fixed.
- The panel is a `.float` hugging the left edge, so `useMeasureInsets` already reports it as `left` inset and the
  map centres its view in the free area: nothing to add there.
- Header row: the title "Mission planner inputs", then on the right a checkbox "Past landings" (3.6) and a button
  "Hide panel" (chevron) that collapses the panel to its header (then the map gets the space back; the button
  becomes "Show panel").
- Phones (`max-width: 700px`, the existing breakpoint in `panels.css`): the panel stacks under the map like the
  other `.float` panels already do (no new rule beyond keeping `.float`).

### 3.2 Mandatory inputs ("Mission basics")

Always visible at the top of the body, in this order. Each label has an info button (3.5) with the text given.

| Input | Control | Default | Info bubble text |
| --- | --- | --- | --- |
| Landing date and time | The date pill's own fields, mirrored here (read and write the same store: `useApp` `startMs`) | the app's current start | "When the lander touches down (UTC). Sunlight and Earth contact are computed over the mission from this instant." |
| Mission duration | number + unit select (hours / days), same store (`durationH`) | the app's current duration | "How long the lander must work on the surface. Every time-based input is checked over this whole window." |
| Region centre | latitude and longitude fields (degrees, latitude ≤ −60), a "Pick on the Moon" button (crosshair), and a "Catalogue site" select (sites south of 60° S from `useCatalogue`) | none: the Simulate button stays disabled with "Choose a region centre" until set | "Centre of the area to search. Pick it on the Moon, type it, or choose a catalogue site. The search grids cover the south polar region (south of 60° S)." |
| Region radius | slider 5-100 km step 5 + number field | **20 km** | "Size of the area searched around the centre. Larger areas take longer." |
| Cell size | select: Auto, 240 m, 480 m, 960 m, 1.92 km, 3.84 km, 7.68 km | Auto | "Size of each square of the coloured map. Smaller cells show more detail but take longer. Auto picks the smallest size that keeps the map under 40 000 cells. Below the data's own resolution (320 m slope south of 80° S, 960 m elsewhere) smaller cells add no information." |

Rules:

- Auto = the smallest option with `ceil(2 × radius / cell)² ≤ 40 000` (at 20 km: 240 m, 27 889 cells). Options
  above the API limit (`ceil(2 × radius / cell)² > 360 000`) are disabled with "Too many cells for this radius".
  An option finer than the data resolution at the centre (320 m south of 80° S, 960 m otherwise) shows the suffix
  "(finer than the data here)".
- The radius slider maximum is `min(100, floor(sqrt(360000) × cell / 2))` for the chosen cell (Auto: 100).
- Latitude fields north of −60° show the error "The search covers south of 60° S" and do not update the centre.

### 3.3 Advanced inputs

Under the basics, a disclosure button "Advanced inputs ›" (`aria-expanded`). When open, it lists the categories of
section 4 as headings. Each heading row has, on the right, a switch (`role="switch"`, `aria-checked`) that turns
the category on or off. When on, the category's inputs appear under its heading; when off, they are hidden and not
sent.

- An input left empty in an active category is inactive: its field shows the placeholder "Inactive · type a value"
  and it is not sent. A category that is on but has no filled input still contributes its score (section 4).
- Inputs not available yet (Stage B or no data) are shown in their category, disabled, with the reason as their
  description ("Comes with the suitability search" or the data gap).
- The open/closed state of the disclosure and of each category is kept in the mission store (it survives closing
  and reopening the panel).

### 3.4 Live preview and Simulate

- Every change to an input (after it parses and validates) schedules a **preview** request 500 ms after the last
  keystroke: the same request with `max_window_samples: 60`. A newer change aborts the request in flight
  (`AbortController`; `api.areaSearch(body, signal)` already accepts a signal).
- The footer of the panel shows the state: "Preview · 0.4 s · 60 horizons" / "Full detail · 2.2 s · 300 horizons"
  / "Updating…" / the error. And a button **"Simulate full detail"** that sends the same request with
  `max_window_samples: 300` (today's default).
- With no window input active (only map inputs), the preview already is the full answer: the footer says "Up to
  date" and the button is disabled.
- Measured on `main` (20 km radius around −89.45, 137.3; 7-day window; slope ≤ 10°, sunlit ≥ 0.6, dark ≤ 48 h):
  map inputs only 0.01-0.07 s; with window inputs 0.43-0.63 s at 60 samples, 1.67-2.27 s at 300 samples (cells 960 m
  to 240 m). So the preview is near real time and the full run is a couple of seconds.
- The map colours and the results list (3.7) update as each answer arrives.

### 3.5 Info bubbles (every info button in the app)

Replace the inline note of `web/src/ui/Tip.tsx` with a floating bubble (same component name and props, so all six
files that use `<Tip>` change at once):

- Rendered in a portal on `document.body`, `position: fixed`, `max-width: 280px`, the panel surface colours and a
  1 px border, 10 px padding, radius 10 px, shadow as `.pop-panel`.
- Placed to the **right** of the button: `left = button.right + 12`, vertical centre on the button's centre
  (clamped to the window with 8 px margins). If it does not fit on the right, it goes to the left
  (`right = window.innerWidth − button.left + 12`).
- A pointer (a 10 px rotated square with the same border, or an SVG triangle) on the bubble's edge facing the
  button, at the button's centre height, so the bubble visibly points at the button that opened it.
- Closes on: a pointer down anywhere outside the bubble and its button, Escape (focus returns to the button), the
  button again, scroll of any ancestor of the button, window resize. One bubble open at a time (opening one closes
  the others: a small module-level store).
- Accessibility: the button keeps `aria-expanded` and `aria-controls`; the bubble has `role="note"` and an id; the
  text is never cut (it wraps; the bubble grows in height).
- Update `.tip-note` CSS accordingly (remove the inline layout rules).

### 3.6 Past landings on the map

- Header checkbox "Past landings" (default off). When on, the map and the globe draw a pin for each row of
  `data/external/sites/landing_sites.csv` with `coord_quality = measured_landing_point` inside the region (today
  south of 60° S: Lunar Prospector and LCROSS Centaur (impacts), Vikram (crash), Chandrayaan 3, Odysseus (IM-1),
  Intuitive Machines 2). Label: name and category ("landing" / "impact").
- Data access: the web already copies static data in `scripts/copy_static_data.mjs`; add this CSV to the copy
  list and parse it in `web/src/mission/landings.ts`. Pins reuse the existing marker drawing (`map/markerSet.ts`) with
  a distinct style (a small square, never colour alone: the label says "landing site" or "impact site").
- The input "Past landings" in the Science category (section 4) uses the same list.

### 3.7 Results on the right

- A floating right panel "Candidate areas" (Stage A) / "Candidate sites" (Stage B), using the existing
  `SidePanel` of `NavigatorPage.tsx`, shown in mission mode as soon as an answer exists (it replaces the place
  section drawer while in mission mode; the comparison keeps priority when Multiselect is on).
- Stage A content: the `areas` of the answer (move the existing `Results` component out of `MissionPanel.tsx`):
  per area its size in km², best and mean score in percent, the catalogue sites inside, and the buttons "Show" and
  "Study" (existing behaviour). On top: the cell counts (viable / failed by map inputs / failed by mission-window
  inputs / no data) in words and numbers.
- Stage B content: first spec section 9.7 (top sites with pros/cons, Save, Compare, radar).
- Same bottom rule as the left panel (never touches the timeline).

### 3.8 The Moon in the Mission Planner

- **No idle rotation in mission mode:** in `GlobeView.tsx`, call `orbit.setAnchored(useGlobe.getState().anchored
  || mode === 'mission')` whenever either changes (do not change the user's stored pin). Leaving mission mode
  restores the user's own choice.
- **Centred region:** when the centre changes (any of the three ways in 3.2, or a click on the Moon), the view flies
  to it: on the globe `orbit.turnTo(lat, lon)`; since the region is south of 60° S, then enter the polar map there
  (`useApp.getState().enterMap(lat, lon)`) and frame it with `useAreas.getState().look(lat, lon, radiusKm × 2.5)`.
  The centre stays in the middle of the free area (the insets already move the view centre off the panels).
- **Manual control stays:** dragging, wheel and keys move the view as today; nothing pulls the camera back except
  the centre changing or the button below.
- **"Centre on region" button:** in the map tools (the `toolslot`, both globe and map), an icon button with a
  crosshair, label "Centre on region", shortcut **C**, enabled when a centre exists: it repeats the fly-to of the
  previous point. Add the shortcut to the existing keyboard handlers of both views.
- **Picking on the Moon (fixes P1):** in mission mode, a single click on the globe surface or on the map sets the
  centre (globe: replace the `else orbit.turnTo(...)` branch by "if mission: set centre (if ≤ −60°) and fly; else
  turnTo"). A click north of 60° S shows a toast "The search covers south of 60° S" and does not change the centre.
  The "Pick on the Moon" button arms a one-shot pick mode (cursor crosshair, Escape cancels) for users who expect a
  button; a plain click works anyway.
- Draw the region ring on the globe too (today only on the map: `engine.setRegion`): a `THREE.LineLoop` of 128
  points on the sphere at the ring radius, 0.2 % above the surface, the same yellow as the map ring.

## 4. Study of every input (what changes and why)

Columns: today's filter (id in `web/src/panels/missionFilters.ts`), verdict, the new input (label, unit, control),
the info-bubble text, and how Stage A sends it to `/areas/search` (or "Stage B").

### 4.1 Verdicts

| Today | Verdict | Why |
| --- | --- | --- |
| Near or far side (`side`) | **Kept as an optional switch, off by default** (2026-11-15: Sergio wants to be able to pick border zones, where near and far side meet) | Off: no side filter, so the search can include the boundary between the two sides. On: a select (Near / Far) appears and filters as today. Near side means the Earth can be in the sky at some point of the lunar day; far side means never; at the south pole the two sides meet and libration moves the Earth across the limb, so this is a coarse screen, not a substitute for the Earth contact category, which computes real visibility for the mission dates and terrain |
| Away from past landings (`away_from_landings_km`) | **Reworked** into "Past landings: stay away from / go near, within X km" + the map pins (3.6) | Two real uses: keep clear of earlier hardware and its disturbed ground (protected heritage sites), or go near on purpose (revisit hardware, compare). One input, the direction chosen |
| Maximum slope | **Kept**, clearer text | Lander tip-over and landing-leg limits |
| Elevation range | **Removed** (shown in site details) | Height matters only through what it changes (light, Earth view, slope), which are inputs already |
| Crater density (`max_crater_density_per_km2` + radius + smallest diameter) | **Replaced** by "Crater cover in the landing area, at most X %" | "Craters per km² within R km counting from D km" is hard to read and three numbers for one idea. The planner's question is how much of the landing area lies inside craters. Stage B |
| Away from crater rims (`min_rim_distance_km` + smallest crater) | **Replaced** by "Margin from crater rims, at least N crater radii" (craters larger than the cell only) | A distance in km smaller than the cell does nothing, and the risk scales with the crater: rims are steep and rocks thrown out by the impact lie mostly within about one radius beyond the rim. Measuring the margin in crater radii keeps one number meaningful for all sizes. Stage B |
| Outside permanent shadow (0-1 share) | **Replaced** by a switch "Avoid permanently shadowed ground" | A share of the cell from 0 to 1 is an artefact of averaging 240 m pixels into 960 m cells. The planner's question is yes or no. The switch fails any cell that has any permanently shadowed pixel (`max_permanent_shadow: 0`, the worst of the sub-grid) |
| Sun height at landing (min/max) | **Kept**, in "Landing conditions" | Cameras and hazard detection during descent need the Sun within a range: too low gives long shadows, too high flattens relief |
| Earth in view at landing | **Kept**, in "Landing conditions" | Live telemetry during the landing |
| Long-term sunlight (18.6-year mean) | **Removed** as an input | Not tied to the mission dates; the mission window is computed exactly. It stays inside the method (quadtree proxy) and as a map layer |
| Sunlight during the mission (share 0-1) | **Removed** as a limit; becomes the **score** of Power and sunlight | "Lit at least 0.6 of the window" does not say whether the lander survives. Survival depends on the longest darkness against the battery, and on each sunlit stretch against the recharge time (next two rows). The share of the window in sunlight still ranks sites (more is better) |
| Longest darkness (`max_dark_h`) | **Renamed** "Battery autonomy (h)" | The longest darkness allowed is how long the battery keeps the lander alive without Sun. The planner knows that number |
| Light left after landing (`min_light_left_h`) | **Replaced** by "Recharge time (h)" | The real need: after landing and after every night the lander needs enough continuous sunlight to recharge. "Recharge time" says it once and is checked on every sunlit stretch, including the first one after landing. Stage B |
| Mean solar power (W/m²) | **Merged** into the optional detailed battery model (Stage B) | Power only matters through the battery state of charge, which MECH's model already simulates (`logic/constraints/power.py` `battery_survives`, same as `/power` level 3) |
| Battery lasts (unavailable today) | **Becomes** the detailed battery model inside Power and sunlight (Stage B) | Same model, run per window sample |
| Long-term Earth view | **Removed** as an input | Same reason as long-term sunlight |
| Direct-to-Earth time (share 0-1) | **Removed** as a limit; becomes the **score** of Earth contact | The operational limit is the longest blackout; the share ranks sites |
| Longest blackout | **Kept**, clearer text | Data storage and operations limit |
| Contact left after landing | **Removed** | Covered by "Earth in view at landing" plus the longest blackout |
| Sun and Earth together | **Removed** as an input (shown in site details) | Useful information, not a separate limit |
| Link margin, temperature, battery (old row), colony, solar storm risk, roughness, rocks | **Kept as disabled rows** with their reason, in their categories | The data gap stays visible (repo rule), without cluttering: one line each |
| Radiation dose | **Kept** | Mission dose over the window |
| Terrain shielding (open sky, sr) | **Removed** as an input | The dose already includes it (dose = CRaTER rate × open sky / 4π × days). Two inputs for one effect |
| Robust to a delay | **Kept**, in "Schedule" | The challenge's re-planning scenario |
| Near permanent shadow (km) | **Kept**, clearer text | Possible ice |
| Hydrogen (ppm) | **Kept**, with the region's range shown | Regional resource signal |
| (new) Near a named feature | **Added** (Stage B) | "Within X km of <IAU name>", with a name search over the 509 IAU features south of 60° S |
| Landing radius (in Region) | **Moved** to Topography as "Landing ellipse radius" | It belongs to landing safety, not to the region |

### 4.2 The categories and their inputs

Every input below: label, control and unit, info-bubble text, Stage A mapping. None has a default unless stated.
"Score" is what the category adds to the colours (Stage A: see 4.3; Stage B: section 6).

**Search area** · no score.

| Input | Control | Info bubble | Stage A |
| --- | --- | --- | --- |
| Near or far side | switch, revealing a select (Near / Far) when on | "Off: the search can include the boundary between the near and far side. On: keeps only the side chosen (near: longitude within 90° of the sub-Earth meridian). At the south pole the two sides meet, so this is a coarse screen; the Earth contact inputs compute real visibility for the mission dates." | off → not sent; on → `side` |

**Power and sunlight** · score: share of the mission window with any part of the Sun visible.

| Input | Control | Info bubble | Stage A |
| --- | --- | --- | --- |
| Battery autonomy | number, h | "How many hours the battery keeps the lander alive with no Sun. No stretch of darkness during the mission may be longer." | `max_dark_h` |
| Recharge time | number, h | "Hours of continuous sunlight needed to recharge the battery. Every sunlit stretch must be at least this long: the first one after landing and each one between two nights (a stretch cut by the end of the mission is not checked)." | Stage B |
| Avoid permanently shadowed ground | switch | "Leaves out any cell that contains ground the Sun never reaches (PGDA permanent shadow map, 240 m pixels)." | `max_permanent_shadow: 0` |
| Detailed battery model | sub-switch revealing: panel area (m²), cell efficiency (0-1), derating (0-1), battery capacity (Wh), state of charge at landing (%), lowest allowed state of charge (%), day load (W), night load (W), charge and discharge efficiency (0-1) | "Simulates the battery hour by hour with your panel and loads (the same model as the Power panel, level 3). When on, it replaces battery autonomy and recharge time." | Stage B |

**Earth contact** · score: share of the window with Earth contact.

| Input | Control | Info bubble | Stage A |
| --- | --- | --- | --- |
| Longest blackout | number, h | "The longest time without direct radio contact with Earth that the mission accepts (data storage, operations)." | `max_blackout_h` |
| Earth disc needed for contact | number 0-100 %, **default 50 %** (team parameter `comms_min_fraction`) | "How much of the Earth's disc must be above the horizon to count as contact." | `comms_min_fraction` |

**Topography and landing safety** · score (Stage B): margin to the slope limit.

| Input | Control | Info bubble | Stage A |
| --- | --- | --- | --- |
| Maximum slope | number, ° | "Steepest ground the lander can stand on. A cell fails if any part of it is steeper (LOLA slope: 320 m south of 80° S, 960 m elsewhere)." | `max_slope_deg` |
| Landing ellipse radius | number, km | "Radius of the area where the lander may come down. A spot is kept only if no failing cell lies within this distance." | `landing_radius_km` |
| Crater cover in the landing area | number, % | "Share of the landing ellipse (or of the cell, without an ellipse) that lies inside craters larger than the cell (Robbins 2018 catalogue)." | Stage B |
| Margin from crater rims | number, crater radii | "Keep at least this many crater radii away from the rim of every crater larger than the cell, inside or outside it. Rims are steep, and the rocks thrown out by the impact lie mostly within about one radius beyond the rim." | Stage B |
| Roughness · Rocks | disabled rows | reasons of the first spec 8.2 | — |

**Landing conditions** · no score.

| Input | Control | Info bubble | Stage A |
| --- | --- | --- | --- |
| Sun height at landing | two numbers, lowest and highest, ° | "Elevation of the Sun at touchdown. Descent cameras need light, but a very low Sun casts long shadows that hide hazards." | `min/max_sun_el_at_landing_deg` |
| Earth in view at landing | switch | "The Earth must be in contact at touchdown, for live telemetry." | `earth_visible_at_landing: true` |

**Science and resources** · score (Stage B): closeness to the targets set.

| Input | Control | Info bubble | Stage A |
| --- | --- | --- | --- |
| Near permanent shadow | number, km | "Within this distance of permanently shadowed ground, where water ice may be trapped." | `max_psr_distance_km` |
| Hydrogen | number, ppm (the field hint shows the min-max of the region from the last answer) | "Hydrogen in the top metre of soil (Lunar Prospector). Each value covers about 45 km, so it marks regions, not single spots." | `min_hydrogen_ppm` |
| Near a named feature | name search + number, km | "Within this distance of a named feature (IAU names)." | Stage B |
| Past landings | select "Stay away from" / "Go near" + number, km | "Keep clear of, or stay close to, earlier landing and impact sites in the region (shown with the Past landings switch)." | "Stay away" → `away_from_landings_km`; "Go near" → Stage B |

**Radiation** · score (Stage B): margin to the limit.

| Input | Control | Info bubble | Stage A |
| --- | --- | --- | --- |
| Maximum dose | number, mGy | "Cosmic-ray dose over the mission (LRO CRaTER, silicon), lower where the terrain hides more of the sky. Solar storms are not included." | `max_dose_mgy` |
| Thermal · Solar storms | disabled rows | "The thermal model runs on one spot: open a site, then the Power panel." / "No forecast exists for a future window." | — |

**Schedule** · no score.

| Input | Control | Info bubble | Stage A |
| --- | --- | --- | --- |
| Robust to a landing delay | number, h | "The site must still meet every mission-window input if the landing slips by this many hours." | `robust_delay_h` |

**Priorities** (Stage B only; listed last in Advanced inputs, no switch): the active categories that have a score,
in a list that can be reordered by dragging or with Move up / Move down buttons; the weights follow by rank order
centroid and are shown in percent (first spec 8.1 `roc_weights`, 9.5 for the interaction).

### 4.3 Colours in Stage A

`/areas/search` already returns `score_b64` (sunlight and Earth contact, equal weights; long-term maps when no
window input is on). Stage A paints viable cells with the red-yellow-green ramp of the first spec 9.6 (mode 1),
failed and unknown cells as today, and adds the legend with values 0, 0.33, 0.67, 1 and the words. The colour-blind
palette (mode 4) is a select in the legend. The other modes (bands, limiting factor) wait for Stage B.

## 5. Stage A: files and steps

New: `web/src/mission/PlannerPanel.tsx` (the left panel), `web/src/mission/PlannerBasics.tsx`,
`web/src/mission/AdvancedInputs.tsx`, `web/src/mission/plannerInputs.ts` (the categories and inputs of section 4 as
data, replacing the role of `missionFilters.ts` for this panel), `web/src/mission/usePlannerSearch.ts` (debounce,
abort, preview/full), `web/src/mission/landings.ts`, `web/src/mission/ResultsPanel.tsx`, `web/src/mission/planner.css`.

Edited: `app/NavigatorPage.tsx` (remove the Mission filters popover; render `PlannerPanel` and the results
`SidePanel` in mission mode), `state/areas.ts` (additive: `radiusKm` default 20, `cellMode: 'auto' | number`,
`advancedOpen`, `categoriesOn: Record<string, boolean>`, `showLandings`, `searchState`), `ui/Tip.tsx` +
`ui/panels.css` (3.5), `globe/GlobeView.tsx` (3.8: click, anchored, ring, button, key), `terrain/TerrainView.tsx`
(3.8: button, key; the click already sets the centre), `terrain/shaders.ts` and `terrain/engine.ts` (4.3: mode 1
and 4 ramps, `uAreaMode`), `terrain/Legend.tsx` (4.3), `scripts/copy_static_data.mjs` (3.6),
`map/markerSet.ts` (pin style for past landings).

Kept: `panels/MissionPanel.tsx` and `panels/missionFilters.ts` stay in the repo untouched (their `buildFilters`,
`EXAMPLE_MISSION` and tests still work) but are no longer mounted. Add "Load example mission" to the new panel
header menu using `EXAMPLE_MISSION` mapped to the new inputs: centre, radius 20, cell Auto, landing ellipse 0.1 km,
duration 7 days, Power on with battery autonomy 48 h, Earth contact on (no limit), Topography on with maximum slope
10°, and the note "Example values to try the planner, not mission requirements" (as today).

Steps:

1. `ui/Tip.tsx` bubble (3.5) and its test; run the whole web suite (it is used in six files).
2. Camera and picking (3.8), with the globe ring.
3. Panel shell and layout (3.1), with the bottom measurement; remove the popover.
4. Basics (3.2) wired to `useApp` and `useAreas`.
5. Advanced inputs and categories (3.3, 4.2) mapped to `/areas/search` fields; Stage B rows disabled.
6. Live preview and Simulate (3.4).
7. Past landings pins (3.6).
8. Results panel (3.7).
9. Colours and legend (4.3).
10. Tests and visual check (section 7).

## 6. Stage B: amendments to the first spec's API (section 8)

Apply these when building the first spec's PR 3:

1. **Catalogue (8.2) replaced by section 4 of this document.** New ids: `battery_autonomy_h` (= longest darkness ≤
   limit; bounded by the ephemeris bound like `longest_dark_h`), `recharge_h` (window: shortest sunlit stretch that
   is followed by darkness inside the window, or the stretch starting at landing, must be ≥ limit; not bounded),
   `avoid_psr` (flag: sub-grid max of `permanent_shadow_65s` must be 0), `battery_model` (window: the flat fields of
   `battery_survives` + panel orientation; passes when no load is unserved; replaces autonomy and recharge when
   present), `blackout_h`, `comms_fraction_needed` (request parameter), `max_slope_deg`, `landing_radius_km` (request
   parameter), `crater_cover_pct`, `rim_margin_radii`, `sun_el_at_landing_deg`, `earth_at_landing`,
   `psr_distance_km`, `hydrogen_ppm`, `target_distance_km`, `past_landings` (choice `away` / `near` + km), `dose_mgy`,
   `robust_delay_h` (request parameter). Removed ids: `side`, `elevation_m`, `crater_density_per_km2`,
   `elongated_crater_density_per_km2`, `rim_distance_km`, `permanent_shadow_fraction`, `long_term_sun`,
   `long_term_earth`, `sunlit_fraction`, `light_left_h`, `mean_power_w_m2`, `comms_fraction`, `contact_left_h`,
   `both_fraction`, `sky_sr`, `host_crater_depth_m` (crater depth stays in the site details).
2. **Roles and ideals removed from the request.** Every input is a hard limit. The score is per **category**:
   - Power and sunlight: share of the window sunlit (0-1).
   - Earth contact: share with contact (0-1).
   - Topography: `1 − slope / max_slope` (clipped 0-1), mean with `1 − cover / max_cover` when crater cover is set.
   - Science: mean of `1 − distance / limit` for each distance input set, and `(H − limit) / (H_best − limit)` for
     hydrogen, where `H_best` is the highest value among the cells passing every hard input in the region.
   - Radiation: `1 − dose / max_dose`.
   - A category with no input set but switched on scores with its natural measure when it has one (Power, Earth);
     otherwise it is left out of the score.
   Request field `categories: list[str]` (switched on) and `priority: list[str]` (rank order; ROC weights). Response
   `layers` become one per scored category (same uint8 encoding), so the browser re-weights instantly as before.
3. `crater_cover_pct`: rasterise every Robbins crater with diameter ≥ 2 × cell as a filled disc on the search grid
   (cell centres within the circle, using the stereographic scale factor), then take the mean over the landing
   ellipse disc (`A.count_within` over the disc divided by its cell count), or the cell itself without an ellipse;
   in percent. `rim_margin_radii`: for craters with diameter ≥ 2 × cell, `|distance to centre − R| / R`, minimum over
   craters within reach; passes when ≥ limit.
4. `recharge_h` on window samples: from the engine series `sunlit()`: runs of True; a run is checked if it is the
   first run (starts at sample 0) or it is followed by a False inside the window; value = the shortest checked run
   × step (h); infinite when no run is checked (shown as "no full night in the window").
5. `battery_model`: per window sample, `bal = energy_balance(t, array_power_w(series.power_w_m2, array) × (1 −
   obscuration(series)), load_series_w(series.sunlit(), load), battery)` (the same calls as
   `logic/constraints/power.py`), value = `bal.min_soc`, passes = `bal.survived`.
6. Everything else in the first spec's section 8 (funnel order, ephemeris bound, codes, quantised layers, site
   picking, tests) stays, with the criteria above.

## 7. Validation

Automatic (must pass): `cd web && npm run typecheck && npm run lint && npm test`; for Stage B also
`cd api && uv run pytest -q`.

New and updated tests (Stage A):

- `ui/Tip.test.tsx`: opens to the right with the pointer facing the button; flips left near the right edge; closes
  on outside pointer down, Escape (focus back to the button), second click; only one open at a time; long text
  wraps (bubble height grows, no overflow).
- `mission/plannerInputs.test.ts`: every Stage A input maps to the field in section 4.2; empty inputs are not sent;
  "Avoid permanently shadowed ground" sends `max_permanent_shadow: 0`; Earth disc 50 % sends `comms_min_fraction:
  0.5`; Auto cell picks 240 m at 20 km (`ceil(40/0.24)² = 167² = 27 889`) and 1.92 km at 100 km (960 m would give
  `ceil(200/0.96)² = 209² = 43 681` > 40 000; 1.92 km gives `105² = 11 025`).
- `mission/usePlannerSearch.test.ts` (fake timers): a burst of changes sends one preview after 500 ms; a newer
  change aborts the older request; Simulate sends `max_window_samples: 300`.
- `app/app.test.tsx`: replace the two "Mission filters" flows (lines 253 and 334 on `f29c8a3`) with the new panel:
  the panel is visible in mission mode without clicking a button; set the centre by typing −89.45 / 137.3; a
  preview request is sent; the results panel lists the areas.
- Globe picking test (component or unit on the click handler): in mission mode a click south of 60° S sets
  `useAreas` centre; north of it shows the toast and keeps the centre.
- Orbit test (`globe/orbit.test.ts`): anchored in mission mode → `isSpinning` false after 20 s idle.
- e2e (`e2e/navigator.spec.ts`): mission mode → the panel does not overlap the timeline or the caption
  (`boundingBox` comparisons at 1440 × 900 and 1280 × 720); axe passes.

Visual check with the session's browser pane (`preview_start` with a `.claude/launch.json` entry for the web dev
server; the API on another port with `API_PROXY`):

1. 1440 × 900 and 1280 × 720: the panel's bottom edge is ≥ 12 px above the caption and the timeline; the date pill
   and the panel have the same width.
2. Mission mode: the Moon does not turn after 30 s idle; in study mode it does again.
3. Click on the globe at about 85° S: the centre is set, the view flies into the map centred on it; drag away and
   press C (and the button): it comes back.
4. Type a latitude of −50: error shown, nothing changes.
5. Open Advanced inputs, switch Power on, type battery autonomy 48: within a second the colours change and the right
   panel updates; the footer says Preview; Simulate full detail turns it into Full detail.
6. Every info button: bubble on the right with its pointer, closes on clicking elsewhere, text not cut, also in the
   panels outside mission mode.
7. Past landings on: pins of IM-2 and Odysseus visible when the region contains them (centre −84.79, 29.20,
   radius 20).
8. Screenshots of each step, shown to the person.

## 8. Definition of done

- [ ] Section 2 problems P1-P5 are gone (checked in the browser).
- [ ] Every input of section 4 present with its info text; Stage B ones disabled with the reason.
- [ ] Tests of section 7 written and passing; whole web suite passing.
- [ ] No commit, push or pull request unless the person asked; changed files listed to the person.
