# Submission form: text ready to paste

Project Submission page, one field at a time. Everything must be in **English**. Fill the bracketed items.
Deadline: **Sunday 15 November 2026, 23:59 local time of your Local Event**. Press **Submit for Judging**
(saving is not enough), tick both boxes, and test every link in a private window (no login may be needed).

Numbers below are measured (`data/validation.json`, `GET /api/v1/validation`, the test suites); keep them in sync if
something changes. Test counts on `main` when this was written (2026-11-15): API 393, web 234, pipeline 28.

## Project Name

Lunar Landing Site Navigator

## High-Level Project Summary

Lunar Landing Site Navigator lets mission planners, educators and the public compare lunar landing sites and dates in
seconds. For any place on the Moon and any date it shows where the Sun and Earth sit over the real terrain horizon,
how long sunlight and a direct line to Earth last, the power a solar array would give and the radiation dose. In
mission mode it paints the areas of a region that meet every requirement the planner sets, instead of testing points
one by one. A FastAPI backend computes everything from NASA LOLA topography and JPL ephemerides, validated against
JPL Horizons to a few millionths of a degree.

## Link to Project Demo

[public video URL, 30 s or less, English or English subtitles]

## Link to Final Project

[public URL of the deployed site] · API: [public URL of the API]/docs · Source code: [public repository URL]

## Detailed Project Description

**What it does.**
- *A real Moon to explore.* The app opens on the whole Moon (LOLA global topography, lit by the Sun at the chosen
  instant, optional LROC WAC photo view) and dives into a south-polar map with 3D LOLA relief, live terrain shadows,
  colour layers (slope, long-term illumination, Earth visibility, permanent shadow) and the Robbins crater catalogue.
- *Study a place.* Pick one of 21 catalogued sites (Apollo 11-17, IM-1, IM-2, Blue Ghost 1, Chandrayaan-3, SLIM and
  south-polar craters and massifs) or click anywhere. The place panel gives the Sun and Earth over the horizon, time to
  the next sunset and Earthset, a first-person horizon view with the Sun and Earth tracks and the real stars, the solar
  power at four levels (sunlight on the panel, array output, battery balance, and a colony level with habitat heating),
  the cosmic-ray dose and the Earth contact. A timeline plays the mission window; Compare puts several places side by
  side.
- *Plan a mission.* Mission mode searches a region (a disc the planner places on the map) with filters in nine
  families: search area, terrain and landing, light and power, Earth contact, temperature, radiation, mission window,
  colony and science. It paints the cells that pass, outlines the connected areas and lists them with a "Study" button
  that opens the best spot. Filters the data cannot answer (rocks, roughness without confirmed units, link margin,
  solar storm risk) are listed with the reason instead of being faked.
- *Learn.* An Educational mode turns the same places and times into a world of cubes with missions for children.
- *For other tools.* Every number comes from a documented REST API: sites and manual points (state, series,
  horizon), `/sun`, `/earth`, `/power`, `/radiation`, `/thermal`, `/sweep` (replanning landing dates), `/verdict`,
  `/areas/search`, `/link` (geometric contact with DSN, ESA and JAXA antennas) and `/validation`.

**How it works.** A Python pipeline reads NASA/JPL SPICE kernels (DE440) and computes the Sun and Earth positions in
the Moon Mean-Earth frame (light time and stellar aberration corrected) into compact tables for 2025-2035 and the
Apollo years. The terrain horizon is ray-traced: 720 azimuths, exact lunar curvature, over LOLA elevation grids
(240 m and 960 m south of 60° S, a 3.8 km global grid elsewhere); the 13 south-polar catalogue sites carry masks from
LOLA maps of 10 to 240 m. The Sun and Earth are integrated as discs against that skyline after subtracting the site's
position (Earth parallax up to 0.26°). The mission search runs as a funnel: map filters on every cell (each cell reads
every grid pixel inside it), a landing-radius check, then the mission-window filters on samples placed by a quadtree
that refines where neighbouring results disagree, each sample with its own traced horizon.

**Validation.**
- 352 Sun and Earth directions at 11 sites against JPL Horizons: largest difference 0.000026° in elevation and
  0.000001° in azimuth (tolerance 0.01°).
- 43 events from six Apollo missions against NASA's Apollo Lunar Surface Journal tables: Sun elevation within 0.066°,
  azimuth within 0.03°; Earth within 0.075° once the parallax those 1970s tables ignored is removed.
- LOLA heights against LROC: IM-1 2592 m against 2579 m, Chandrayaan-3 529 m against 532 m.
- Ray-traced horizon of any point against the 13 catalogue masks: median RMS 0.21°, 11 of 13 within 0.5°.
- Mission search: with 300 traced horizons, 91 % of the cells agree with a 1718-sample reference over a 40 km region.
- Ground-antenna geometry for the radio link against SPICE: worst 0.0024°.

All of it is reproducible with the test suites and shown in the app's "Data & methods" page and in
`GET /api/v1/validation`.

**Benefits.** Replanning after a delay, or finding where a lander can go at all, takes minutes instead of a tour of
several expert tools. Teams can share the same scenario by link. Educators and the public get plain-language results.
The interface is keyboard accessible, has a table behind every chart and map result, never relies on colour alone,
works on phones and in light and dark themes, and has no analytics or tracking.

**What we hope to achieve.** Make site-and-date trade-offs understandable to anyone, and give planners a quick,
honest first screening (every result says which horizon and data it used, and what is unknown) before detailed
analysis in tools such as QuickMap, Moon Trek or Horizons.

**Tools and languages.** Python, FastAPI, Pydantic, NumPy, SpiceyPy (NAIF SPICE), rasterio (GDAL), pyproj, Pillow,
pytest, uv; TypeScript, React, Vite, React Three Fiber (Three.js), Zustand, TanStack Query, D3 colour scales, Vitest,
Playwright, axe-core; GitHub Actions. Limits are listed in the app: the global horizon grid is 3.8 km (coarse outside
the south pole), no light reflected from terrain, idealised panels, no boulder or roughness data, direct line of sight
only (no link budget yet).

## Use of Super Intelligence (SI)

Yes. Claude (Anthropic) was used as a coding, testing and documentation assistant, working under the team's direction,
for: researching data sources and comparable tools, writing and testing the Python data pipeline, the FastAPI backend
and the web interface, and drafting documentation. [Team: describe here, in your own words, which ideas and decisions
were yours, because the rules ask that SI is not used to come up with the idea of the solution.] AI-assisted code and
documentation are acknowledged in the README, in the app's "Data & methods" page and in `docs/`. No AI-generated
images, audio or video are used, so no watermark is needed.

## NASA Data

- NASA LRO/LOLA south-pole elevation and slope models, PGDA product 90 (Barker et al.), 10-240 m per pixel: terrain
  horizons, ground height, slope, map relief. https://pgda.gsfc.nasa.gov/products/90
- NASA LRO/LOLA Gridded Data Record LDEM_16 (PDS): the globe and the 3.8 km global horizon grid.
  https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img/
- LOLA-derived polar illumination, Earth visibility, permanent shadow and sky visibility, PGDA product 69
  (Mazarico et al. 2011): screening maps and validation. https://pgda.gsfc.nasa.gov/products/69
- NASA/JPL NAIF SPICE kernels (DE440, lunar orientation and frames, leap seconds, DSN station kernels): Sun, Earth and
  antenna positions. https://naif.jpl.nasa.gov/pub/naif/generic_kernels/
- NASA/JPL Horizons System API: independent validation reference. https://ssd.jpl.nasa.gov/horizons/
- LRO CRaTER daily dose rate (CRaTER Legacy Data Products): cosmic-ray dose.
  https://crater-products.sr.unh.edu/data/inst/dosim/table_dosimdrate.php
- Lunar Prospector neutron spectrometer hydrogen map (Feldman et al. 2001; PDS Geosciences Node special products):
  the hydrogen filter. https://pds-geosciences.wustl.edu/missions/lunarp/reduced_special.html
- NASA/JPL DSN Telecommunications Link Design Handbook 810-005, module 301, and its horizon masks: elevation limits
  of the DSN antennas. https://deepspace.jpl.nasa.gov/dsndocs/810-005/
- NASA Moon Trek (JPL): live LOLA terrain tiles and the LROC WAC mosaic (photo view and horizon-view ground texture).
  https://trek.nasa.gov/moon/
- NASA NSSDCA landing-site coordinates, NASA Apollo Lunar Surface Journal, NASA/GSFC/ASU LROC featured images:
  site coordinates, past landings and historical validation.

## Space Agency Partner Data and Other References

Space Agency Partner data:
- JAXA: Misasa, Usuda and Uchinoura station positions and horizon masks (JAXA station coordinates page) for the
  radio link; the Robbins crater catalogue is built in part from JAXA Kaguya Terrain Camera data; SLIM landing site.
- ESA: ESTRACK deep-space stations (Cebreros, Malargüe, New Norcia) for the radio link, positions from their IGS site
  logs (ESA publishes no elevation mask; a 6° estimate is used and flagged in every response).
- ISRO: Chandrayaan-3 landing site in the catalogue, with coordinates published by LROC.

No CNSA data is used.

Other references and code: USGS/IAU Gazetteer of Planetary Nomenclature (crater centres); Robbins (2018) crater
database (USGS); Mazarico et al. 2011; Barker et al. 2021; Wagner et al. 2017; Feldman et al. 2001; open-source
software listed in `docs/references.md`. No third-party images, fonts or music are used other than the NASA mosaics
above. The full list with versions and URLs is `docs/references.md`.
