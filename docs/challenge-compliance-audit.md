# Challenge compliance audit (2026-11-15)

Contrast of `main` (commit `c1d7cfa`, after PR #45) against three sources:

1. The challenge page, Details and Resources tabs, read on 2026-11-15:
   https://www.spaceappschallenge.org/2026/challenges/lunar-landing-site-navigator/
2. The Project Submission Guide, read on 2026-11-15:
   https://www.spaceappschallenge.org/resources/project-submission-guide/
3. The team's requirements catalogue ("Lunar Landing Site Navigator: catálogo de requisitos y datos", 2026-11-13),
   whose IDs are the ones in `docs/requirements.md`.

Question answered: is anything missing that could get the project **excluded from judging**, and is any challenge
objective skipped badly enough to cost points?

## Verdict

The product covers the challenge. The single mandatory objective (Sun and Earth relative to the horizon at a chosen
site and date, RF-06) is implemented and validated, and every "may consider" item has an answer.

**The project is not yet submittable.** Three eliminatory items are still open, all outside the code: the public
links (the repository is private and nothing is deployed), the demo video, and the submission form. These are what
can disqualify the team today; no code gap is.

## 1. Eliminatory rules (Submission Guide)

| Rule | State on `main` | Evidence | Action |
| --- | --- | --- | --- |
| Link to Final Project public, no login, permission or registration | **OPEN, blocking** | `gh repo view`: visibility `PRIVATE`. No GitHub Pages site (API 404), no deployment record, no hosting config for the API. | Make the repository public **or** deploy the site and the API to public hosts. Test every link in a private window. |
| Link to Project Demo public, no login | **OPEN, blocking** | `docs/submission.md`: `[public video URL ...]` placeholder. | Record, upload (YouTube unlisted or public), test in a private window. |
| Demo: video ≤ 30 s (or ≤ 7 slides). Over the limit = not eligible for Global Judging | **OPEN** | Script ready in `docs/demo-script.md` (6 beats, 0:00-0:30). | Check the exported file length, not the editor timeline. |
| English on the project page and every linked material; video in another language needs English subtitles | OK in the repository | No Spanish characters or words in `web/src`, `api/app`, `pipeline`, `data/*.json`, `docs`, `README.md`. | Keep the video in English or burn in English subtitles. |
| All required form fields completed (name, summary, demo link, final project link, detailed description, SI use, NASA data, partner data and references) | **OPEN** | `docs/submission.md` has every text ready; three placeholders remain: demo link, final project link, and the team's own SI paragraph. | Fill the placeholders, paste, press **Submit for Judging** (saving is not enough) and tick both boxes. |
| Press "Submit for Judging" before Sun 15 Nov 23:59 local time of the Local Event | **OPEN** | — | Submit early, then resubmit if anything changes; only the last saved submission is judged. |
| All team members confirmed at the same Local Event | Not checkable from the repository | — | Each member checks their status on the Space Apps site; waitlisted members contact the Local Lead. |
| No images, video, audio or likeness of people under 18 | OK in the app | No photographs of people in `web/public` or `web/src`; Educational mode is cubes and terrain. | Do not film anyone under 18 in the video. |
| At least one NASA data or resource (Global Award eligibility) | OK | LOLA (PGDA 90, 69, LDEM_16), JPL SPICE DE440, Horizons, LRO CRaTER, Lunar Prospector, Moon Trek, DSN 810-005. | — |
| SI use declared; code and data acknowledged in descriptive text and metadata; SI images/video watermarked | OK, one gap in the form | README "Use of AI", Data & methods page "Use of AI", 174 commits with a `Co-Authored-By: Claude` trailer. No AI images, video or audio. | Write the SI paragraph in `docs/submission.md` in the team's own words, including that the idea and the decisions are the team's (the rule says SI must not come up with the idea). |
| No NASA logos, flags or mission insignia in generated content | OK | Favicon is the team's own mark (circle, skyline, sun dot); no logo files or insignia found. | Do not put the NASA meatball or mission patches in the video. |
| Every external code, text and image listed, even if free | OK | `docs/references.md` lists the NASA data, the SVS star map (Hipparcos/Tycho), Moon Trek/LROC WAC, NAC DTMs, fonts and the open-source libraries. | Add any music or footage used in the video. |
| No CNSA datasets (NASA China restriction) | OK | No Chang'e, Yutu or CNSA references in the catalogue, data or code. | — |

## 2. Challenge objectives (Details tab) and the catalogue's IDs

Only RF-06 is an obligation; the rest are the judges' coverage list.

| ID | Objective | State | Where |
| --- | --- | --- | --- |
| RF-01 | Curated sites: Apollo, CLPS, commercial, other countries | Covered, one gap | 21 sites: Apollo 11-17, IM-1, IM-2, Blue Ghost 1, Chandrayaan-3, SLIM, 10 south-polar features. **No future CLPS target or Artemis III candidate region in the catalogue** (the challenge names "future CLPS mission targets"); Artemis regions appear only in Educational mode. |
| RF-02 | Custom lunar coordinates | Covered | `/points/*` with traced terrain horizon anywhere; coordinates button in the web. |
| RF-03 | Side-by-side or sequential comparison | Covered | Compare (live table, radar, timeline strips). |
| RF-04 | Landing date and time | Covered | Date pill, URL state. |
| RF-05 | Changes across lunar days and seasons | Covered | Site x month table, `/sweep` (21 places x 365 dates). |
| **RF-06** | **Sun and Earth relative to the horizon (mandatory)** | **Covered, validated** | `/sites/{id}/state`, horizon chart, first-person horizon view; Horizons agreement 0.000026°. |
| RF-07 | Time to sunset and Earthset | Covered | `next_transition`, place panel. |
| RF-08 | Solar elevation (power) | Covered | `/sun`, `/power` levels 1-4. |
| RF-09 | Sunlight duration | Covered | `/sun`, fraction and ranges. |
| RF-10 | Earth visibility windows | Covered | `/earth`, `/link` with DSN/ESA/JAXA stations. |
| RF-11 | Quick viability verdict | Covered | `/verdict`, mission area search. |
| RF-12 | 2D map | Covered | South-polar map with colour layers. |
| RF-13 | 3D surface | Covered | 3D LOLA relief with shadows, tiltable globe. |
| RF-14 | Animation or timeline | Covered | Playback and timeline. |
| RF-15 | Planners and educators/public | Covered | Planner mode plus Educational mode with twelve missions. |
| RF-16 | Moon vs Earth differences | Covered | Learn page and Educational missions. |
| RF-17 | Why small changes matter | Partly | Mission area search shows it spatially; the catalogue's "sensitivity map" (move the site 500 m) is not a dedicated view. |
| RF-18 | Ephemeris (Horizons or precomputed) | Covered | SPICE DE440 tables, Horizons as validation. |
| RF-19 | LOLA topography for horizons | Covered | 13 stored masks plus ray tracing anywhere. |
| RF-20 | Airless horizon: terrain plus sphere edge | Covered | No refraction; smooth-sphere edge plus terrain. |
| RF-21 | Libration and orbital variation | Covered | Earth libration wander in `/earth`. |
| RF-22 | Steep slopes and deep craters | Covered | Slope, permanent shadow layers, Robbins craters. |
| RF-23 | Science-engineering coordination: share and export | Partly | Shareable link (`?s=`). **No CSV or PDF export** of a scenario. |
| RF-24 | Fast replanning after delays | Covered | `/sweep`, date change re-evaluates in seconds. |

## 3. Non-functional items that affect judging

| ID | Item | State | Note |
| --- | --- | --- | --- |
| RNF-04 | Public link, no login | **Open** | See section 1. |
| RNF-05 | Everything in English | OK | See section 1. |
| RNF-07 | Fallback without WebGL | **Missing** | The globe and the polar map mount a React Three Fiber `<Canvas>` with no error boundary. On a browser without WebGL (locked-down or virtual machines) the whole page can go blank, so a judge would see nothing. A small error boundary with a message and a link to the Data & methods page and the API docs would avoid it. |
| RNF-09 | No live dependency on external APIs | Mostly OK | The browser engine fills the Sun and Earth panels without the API; power, mission search, radiation and link need the deployed API. Moon Trek tiles are fetched live. |
| RNF-11 | CI | Partly | GitHub Actions runs the web checks only; the API suite runs locally (not in CI). Not judged. |
| — | Licence | Open | README says "MIT (to be confirmed)" and there is no `LICENSE` file. Not required, but a public repository should state it. |
| — | FortiGuard classification | Optional | Recommended by the guide for a new website so judges' networks do not block it. |

## 4. What to do before 23:59, in order

1. **Public links** (blocking). Either make `Alvro237/SpaceApp-Lunatiks` public (the owner, in Settings) and use it as
   the Final Project link, or deploy: the web build (`base: '/SpaceApp-Lunatiks/'`, GitHub Pages works once the
   repository is public) with `VITE_API_URL` pointing at a public host running the API. The repository alone already
   satisfies "Link to Final Project"; the deployed app is what scores Presentation.
2. **Demo video** ≤ 30 s, English or English subtitles, public link (blocking).
3. **Form**: paste `docs/submission.md`, fill the three placeholders, write the SI paragraph in the team's words,
   press **Submit for Judging**, then re-test every link in a private window.
4. If time remains: WebGL error boundary (RNF-07), one future CLPS target in the catalogue (RF-01), CSV export of
   the compare table (RF-23), `LICENSE` file.
