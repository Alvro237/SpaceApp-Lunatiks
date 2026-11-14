# Requirements

Source: challenge page, its Resources tab, the Judging & Awards Guide and the Project Submission
Guide, all read on 2026-11-13. Only RF-06 is written as an obligation in the challenge; the rest
are "may consider" items that judges will use as a coverage checklist.

## Functional requirements

| ID | Group | Requirement | Priority |
| --- | --- | --- | --- |
| RF-01 | Sites | Curated catalogue: Apollo, CLPS, commercial missions, other countries' programmes | High |
| RF-02 | Sites | Custom lunar coordinates | High |
| RF-03 | Sites | Side-by-side or sequential comparison of several sites | High |
| RF-04 | Time | Landing date and time selection | High |
| RF-05 | Time | Explore change across lunar days and seasons | Medium |
| RF-06 | Sun and Earth | Sun and Earth position relative to the horizon | **Mandatory** |
| RF-07 | Sun and Earth | Time remaining until sunset and Earthset | High |
| RF-08 | Power | Solar elevation angle shown prominently | High |
| RF-09 | Power | Duration of sunlight | High |
| RF-10 | Comms | Earth visibility windows (direct-to-Earth) | High |
| RF-11 | Power and comms | Quick viability verdict per site-date combination | High |
| RF-12 | Visualization | 2D map | High |
| RF-13 | Visualization | 3D surface (keep simple: globe with site marker) | Medium |
| RF-14 | Visualization | Animation or timeline over one or several lunar days | High |
| RF-15 | Audiences | Technical detail for planners and an explanatory mode for educators and the public | Medium |
| RF-16 | Audiences | Make Moon-versus-Earth differences evident | Medium |
| RF-17 | Audiences | Explain why small site or date changes have a large impact | Medium |
| RF-18 | Data | Ephemerides from Horizons or precomputed data | High |
| RF-19 | Data | LOLA topography for a realistic horizon | High |
| RF-20 | Data | Airless horizon: local terrain plus the limb of the lunar sphere | High |
| RF-21 | Data | Libration and orbital variations | Medium |
| RF-22 | Data | Represent south-pole slopes and craters (extreme shadows) | Medium |
| RF-23 | Collaboration | Support science-engineering coordination: share and export scenarios | Medium |
| RF-24 | Collaboration | Fast replanning when the schedule slips | High |

## Non-functional requirements

| ID | Requirement | Origin |
| --- | --- | --- |
| RNF-01 | Intuitive and fast: a scenario evaluated in seconds | Challenge text |
| RNF-02 | Demonstrable scientific rigour through validation against Horizons | Validity criterion |
| RNF-03 | NASA data as the core, not decoration | Relevance criterion |
| RNF-04 | Public link with no login, registration or permission | Submission guide |
| RNF-05 | Everything in English | Submission guide |
| RNF-06 | Accessibility WCAG 2.2 AA (keyboard, contrast, colour-blind-safe, table alternative to charts and 3D, reduced motion, screen reader) | Good practice |
| RNF-07 | Performance: load under 3 s, 3D with levels of detail, fallback without WebGL | Good practice |
| RNF-08 | Responsive on mobile and desktop | Challenge text (general public) |
| RNF-09 | No live dependency on external APIs during judging | Risk |
| RNF-10 | Reproducible data pipeline with provenance, version and licence per dataset | Relevance criterion |
| RNF-11 | Quality: typing, numerical tests, UI and accessibility tests, CI | Good practice |
| RNF-12 | Security: input validation, no secrets, no personal data | Good practice |
| RNF-13 | Documentation: README, architecture, data catalogue | Presentation criterion |

## Submission rules (eliminatory)

- Form fields: project name, high-level summary, link to demo, link to final project, detailed
  description, use of AI ("Super Intelligence"), NASA data, partner-agency data and references.
- Demo: video of 30 s or less (chosen) or 7 slides. Exceeding the limit disqualifies.
- At least one NASA dataset or resource to be eligible for a global award.
- All external code, text and images listed in References.
- AI use declared in text and metadata; AI images and video watermarked; AI must not originate
  the idea of the solution. No NASA branding in generated content.
- English everywhere. A video may be spoken in another language only with English subtitles.
- Team of at most 6, all registered in the same local event.
- Recommended for a new website: request a FortiGuard Web Filter classification so judges can
  open it.

Suggested video structure from the guide: team (0:00), challenge (0:02), name and tagline (0:05),
how it works and which NASA data make it possible (0:10), future vision (0:20–0:30).

## Judging criteria (1–5 each)

| Criterion | What a 5 needs | How we cover it |
| --- | --- | --- |
| Impact | Significant problem, wide reach | Fast replanning after schedule slips, plus educational use |
| Creativity | New approach or real improvement | Site-by-date heat map and horizon panorama, which existing tools lack |
| Validity | Scientifically sound, complete, usable | Validation against Horizons and against real mission events |
| Relevance | Answers the challenge with NASA data at the core | Horizon from LOLA, JPL ephemerides, visible provenance |
| Presentation | Clear, structured story | 30 s video and a careful project page |

## Proposed improvements, by potential

Proposals for the team to decide; the concept must be theirs.

1. Site-by-date heat map: sunlight and comms hours for every landing date over 12–18 months.
2. 360° horizon panorama with Sun and Earth paths over the real terrain profile.
3. Adjustable mast height (2 m versus 10 m changes weeks of light at the pole).
4. Sensitivity map: move the site 500 m and see the change; doubles as landing-zone evaluation.
5. Ground stations: which antenna (Madrid, Goldstone, Canberra) sees the Moon in each window.
6. Validation against real missions shown inside the app.
7. Shareable scenarios by URL, export to PDF and CSV.
8. Explorer mode: guided tour and comparison with an Earth day.

## Lessons from comparable tools and real missions

| # | Lesson | Source | Effect on scope |
| --- | --- | --- | --- |
| 1 | Sun and Earth matter together | VIPER: Earth is out of view two full weeks a month at the pole; "safe havens" keep light during the blackout | Metrics: longest continuous shadow, longest comms blackout, hours with both visible |
| 2 | Mission duration is an input | Artemis III required 6.5 days of continuous sunlight | "Mission duration" field; verdict is continuous light from landing for N days |
| 3 | Site is coupled to the launch window | Artemis III keeps several regions to launch all year | Already covered by the heat map |
| 4 | A site is a zone, not a point | Artemis III: 15 × 15 km regions, 100 m radius sites | Evaluate surrounding points, show worst case (merged with the sensitivity map) |
| 5 | Slope and orientation decide real power | IM-2 ended on its side in a cold crater (press report, unconfirmed) | Show LOLA slope at the site with a warning |
| 6 | Eclipses cut power for hours | Blue Ghost ran about five hours on battery during the 2025-03-14 eclipse (press report, unconfirmed) | Mark Earth-occults-Sun events on the timeline |
| 7 | Landing-time lighting has its own limits | Apollo required a low Sun, 5–14° per secondary sources (unconfirmed) | Solar elevation at landing time indicator |
| 8 | Offer alternatives, not one answer | VIPER's planner presents several options (search summary, unconfirmed) | Ranked alternatives with visible, adjustable weights |
| 9 | Height above ground and terrain error change the result | LOLA studies at PGDA: 1 m versus 5 m | Already covered: mast height and uncertainty band |

## Proposed order of work

1. Fri 13 evening: repository, minimal pipeline, one site validated against Horizons.
2. Sat 14 morning: RF-06 to RF-11 with real horizon for 10–15 sites.
3. Sat 14 afternoon: comparison, site-by-date heat map, lessons 1, 2, 5, 6, 7, 8, first public deploy.
4. Sun 15 morning: simple 3D globe, Explorer mode, export, zone evaluation, accessibility pass.
5. Sun 15 afternoon: freeze code, record video, fill the form, test links in a private window.
