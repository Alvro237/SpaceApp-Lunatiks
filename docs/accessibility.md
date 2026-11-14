# Accessibility

> First written for an earlier static prototype; the measures below apply to the current `web/` app, which
> keeps them. Audit rows from 2026-11-14 (afternoon) on are for this app.

Target: **WCAG 2.2 level AA**. This page lists what the design does, how it is checked and what is
known to fall short. Update the audit table whenever it is re-run.

## What the design does

| Area | Measure |
| --- | --- |
| Structure | One `h1`, ordered headings, landmarks (`header`, `nav` "Main", `main`, `footer`), skip link, `lang="en"`. |
| Map | The map fills the window and the panels float over it; each panel can be folded with a button that states its state (`aria-expanded`). The 3D map is a focusable `application` with a described key set (arrows move, + and − zoom, T tilts, Q and E rotate, R resets, Space plays). Site markers are real buttons over the canvas. Everything the map shows (Sun, Earth, horizon, layers' values) is also text in the panels, the legend and the tables. |
| Keyboard | Everything works without a mouse: tabs, forms, the time slider, the site maps (each site is a button), the **date planner grid** (arrow keys move, Shift+arrows jump a week, Enter opens the scenario), compare table buttons. Focus is moved to `main` and announced when the view changes. |
| Focus | Visible 3 px outline in a colour that contrasts with both themes (`:focus-visible`). |
| Names and labels | Every control has a visible `label`; errors use `aria-invalid` + `role="alert"`; buttons that act on an item name it ("Remove IM-1 2027-02-01"). |
| Charts | Each chart is `role="img"` with a text summary, **and** a disclosure with the same numbers as a real `<table>` (`caption`, `scope`). The canvas heat map and the globe have equivalent text and tables. |
| Colour | Never the only carrier: verdicts are symbol + word + colour; the Sun/Earth lines differ by dash pattern; strips use hatching; zone scores are numbers on colour. Palettes are Okabe-Ito based and a viridis-like ramp for the planner. |
| Contrast | Text and UI colours chosen for AA in both themes (dark default, light via `prefers-color-scheme`); checked in a real browser, see below. |
| Motion | `prefers-reduced-motion` respected; playback is only started by the user and never autoplays. |
| Zoom and reflow | Text uses relative units; layout reflows to one column; wide charts scroll horizontally inside their own region (focusable) instead of shrinking text to illegibility. Works at 200 % zoom. |
| Target size | Buttons and inputs are at least 40 px tall (small buttons 32 px, above the 24 px minimum of WCAG 2.2 SC 2.5.8). |
| Forced colours | A `forced-colors` block keeps borders and the current tab visible. |
| Language | Plain wording, units written out, a glossary in *Learn*; no jargon without explanation. |
| Privacy and safety | No third-party requests, no cookies, no analytics. Strict CSP. |

## How it is checked

1. **axe-core in the test-suite** (`web/tests/a11y.test.tsx`): every view (explore, compare, planner, learn, data)
   is rendered and audited with the WCAG 2 A/AA, 2.1 and 2.2 AA and best-practice rule sets. Colour
   contrast cannot run in jsdom.
2. **axe-core in a real browser**, both colour schemes, including colour contrast (below).
3. **Explicit assertions**: single `h1`, skip link, labelled controls, text alternative and table for each chart,
   verdict not colour-only, announcements, alert on invalid input.
4. Manual keyboard pass over the main flows.

## Audit log

| Date | Method | Result |
| --- | --- | --- |
| 2026-11-13 | axe-core in jsdom (`npm test`), five views, WCAG 2 A/AA, 2.1, 2.2 AA, best practice | 0 violations after fixing one real defect (`<dl>` groups contained a `<p>`) |
| 2026-11-14 | Current `web/` app: axe-core in jsdom (`npm test`, `src/app/app.test.tsx`), navigator in both modes, Data & methods, Learn | 0 violations after fixing one real defect: the hour-step buttons' visible text was not part of their accessible name (WCAG 2.5.3) |
| 2026-11-14 | Current `web/` app: axe-core 4.14 via Playwright in Chromium (`npm run test:e2e`), 1440 px, navigator, Data & methods, Learn, dark and light schemes, colour contrast included | 0 violations |
| 2026-11-14 | Full-screen map layout with floating panels, axe-core 4.14 via Playwright, both schemes | 0 violations after fixing two real defects: map markers whose name was hidden with the label, and markers overlapping below the 24 px target size near the pole (now hidden when crowded, selected and compared ones first; every site stays reachable from the list) |
| 2026-11-14 | Current `web/` app: text colour on the site × month table computed per cell (`textOn`), checked over 101 points of each colour map | ≥ 4.5:1 everywhere (test in `src/app/app.test.tsx`) |
| 2026-11-14 | axe-core 4.14 in Chromium, dark theme, 1280 px, five views | 0 violations. `color-contrast` reported "incomplete" for SVG text over SVG backgrounds (axe cannot resolve those); verified by computing the ratios below |
| 2026-11-14 | axe-core in Chromium, light theme, 1280 px, five views | 0 violations |
| 2026-11-14 | axe-core in Chromium, 375 px wide (phone), five views | 0 violations. Found and fixed: a chart's 640 px minimum widened the whole page (grid track needed `minmax(0, 1fr)`); `role="group"` on `<figure>` is not allowed |
| 2026-11-14 | Contrast ratios computed from the real design tokens, both themes | Text 7.4:1 to 17:1 (AA needs 4.5:1); graphics (Sun, Earth, terrain, eclipse, focus ring) 3.1:1 to 11:1 (needs 3:1). The terrain fill was 2.9:1 (dark) and 2.6:1 (light) and was darkened to 3.6:1 and 3.9:1 |
| 2026-11-14 | Keyboard on the date planner | Arrow keys move the selection, Shift+arrows a week, Enter opens the scenario in Explore; the first cell is the current site |

## Known gaps and honest limits

- No screen-reader session with a real assistive technology has been run yet; the semantics are standard but unverified by a human user.
- The panorama and close-up are visual by nature. Their text summaries state elevations and azimuths and the horizon table gives the full profile, but a blind user cannot reproduce "a ridge hides half the Sun" beyond the stated percentage.
- The globe is a canvas; its description gives the sub-solar and sub-Earth points and whether the site is in daylight.
- Wide charts need horizontal scroll on phones.
- The interface is in English only (the challenge requires it); translations are future work.
