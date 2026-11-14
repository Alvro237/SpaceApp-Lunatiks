# Submission form: text ready to paste

> Written for the first static prototype (a React site whose engine lived in `web/src/core`). The method and
> the numbers still hold; the engine now lives in `api/app/logic`, the data in `data/` and the tests in
> `api/tests`. Paths under `web/` no longer exist in this repository.

Project Submission page, one field at a time. Fill the bracketed items. Everything must be in **English**.
Deadline: **Sunday 15 November 2026, 23:59 local time of your Local Event**. Press **Submit for Judging**
(saving is not enough), tick both boxes, and test every link in a private window.

## Project Name

Lunar Landing Site Navigator

## High-Level Project Summary

Lunar Landing Site Navigator lets mission planners, educators and the public compare landing sites and dates in
seconds. For any site and date it shows where the Sun and Earth sit over the real terrain horizon, how long sunlight
and a direct line to Earth last, when the next sunset and Earthset are, and a transparent viability score. A date
planner shows every landing day for 21 sites at once, so a launch delay can be answered at a glance. It runs entirely in
the browser on NASA LOLA topography and JPL ephemerides, validated to thousandths of a degree against Horizons.

## Link to Project Demo

[public video URL, 30 s or less]

## Link to Final Project

[public URL of the deployed site] · Source code: [public repository URL]

## Detailed Project Description

**What it does.** Choose one of 21 catalogued sites (Apollo 11-17, IM-1, IM-2, Blue Ghost 1, Chandrayaan-3, SLIM and ten
south-polar craters and massifs) or type coordinates, then a landing date and a stay. The tool shows the Sun and Earth
against the real horizon (a 360° panorama and a true-scale close-up), the time to sunset and Earthset, the share of the
stay in sunlight and with Earth in view, the longest darkness and communication blackout, solar-panel power, eclipses
caused by the Earth, and a 3D globe lit by the real Sun. A sensitivity panel evaluates 16 nearby points; a comparison
view ranks up to four scenarios and exports CSV; the date planner colours every landing day for every site over 6 to
18 months. Every scenario can be shared by URL. A Learn page explains why the Moon is hard to plan for.

**How it works.** A Python pipeline reads NASA/JPL SPICE kernels (DE440) and computes the Sun and Earth positions in the
Moon Mean-Earth frame (light time and stellar aberration corrected) into one compact table for 2025-2035 (and the Apollo
years). NASA LOLA elevation maps of the south pole (10 to 240 m per pixel) are read remotely and, for each site, a ray is
marched outward in 720 directions to 175 km in the plane through the Moon's centre, the observer and the terrain, so
lunar curvature is exact; the result is a 1.4 KB horizon mask. In the browser, the site's position is subtracted (parallax
up to 0.26° for the Earth), the Sun and Earth are integrated as discs against the horizon, and windows are answered from
prefix sums, which is what makes the planner instant.

**Validation.** 352 Sun and Earth directions against JPL Horizons: largest difference 0.000026° (we required 0.01°). 43 events
from six Apollo missions against NASA's Apollo Lunar Surface Journal: Sun elevation within 0.07°; the remaining Earth
offset equals the parallax that those 1970s tables ignored. LOLA sampling reproduces LROC's published elevations at IM-1
(2592 m against 2579 m) and Chandrayaan-3 (529 m against 532 m) and the 12° slope at IM-1. Algorithms are also tested
against analytic solutions. All of this is reproducible with one command and shown inside the app.

**Benefits.** Replanning after a delay needs minutes, not a tour of several expert tools. Science and engineering teams
can share the same scenario by link. Educators and the public get plain-language results and a Learn page. It is
keyboard accessible, has a data table behind every chart, works on phones and in light and dark themes, and sends no data
to third parties.

**What we hope to achieve.** Make site-and-date trade-offs understandable to anyone, and give planners a quick first
screening before detailed analysis in tools such as QuickMap, Moon Trek or Horizons.

**Tools and languages.** TypeScript, React, Vite, Vitest, axe-core; Python, NumPy, SpiceyPy (NAIF SPICE), rasterio (GDAL),
pyproj, Pillow, pytest; GitHub Actions; static hosting. Limits are listed in the app (terrain exists south of 60° S only;
no light reflected from terrain; idealised panel; direct line of sight only).

## Use of Super Intelligence (SI)

Yes. Claude (Anthropic) was used as a coding, testing and documentation assistant, working under the team's direction,
for: researching data sources and comparable tools, writing and testing the Python data pipeline and the TypeScript web
app, and drafting documentation. [Team: describe here, in your own words, which ideas and decisions were yours, because the
rules ask that SI is not used to come up with the idea of the solution.] AI-assisted code and documentation are
acknowledged in the README, in the app's "Data & validation" page and in `docs/`. No AI-generated images, audio or video
are used, so no watermark is needed.

## NASA Data

- NASA LRO/LOLA south-pole digital elevation models, PGDA products 90 (and 78 for background), 10-240 m per pixel: terrain horizon, ground height, slope, hillshade basemap. https://pgda.gsfc.nasa.gov/products/90
- NASA/JPL NAIF SPICE kernels (DE440 planetary ephemeris, lunar orientation `moon_pa_de440_200625.bpc`, frame kernel `moon_de440_250416.tf`, leapseconds, constants): Sun and Earth positions. https://naif.jpl.nasa.gov/pub/naif/generic_kernels/
- NASA/JPL Horizons System API: independent validation reference. https://ssd.jpl.nasa.gov/horizons/
- NASA NSSDCA Apollo landing site coordinates (LRO-derived): Apollo sites. https://nssdc.gsfc.nasa.gov/planetary/lunar/lunar_sites.html
- NASA Apollo Lunar Surface Journal Sun/Earth altitude-azimuth tables: historical validation. https://www.nasa.gov/wp-content/uploads/static/history/alsj/Scotti_AltAz.txt
- NASA/GSFC/Arizona State University LROC featured images: coordinates and elevations for IM-1, IM-2, Blue Ghost 1, Chandrayaan-3, SLIM. https://www.lroc.asu.edu/
- Background studied: NASA Moon Trek, QuickMap, VIPER lunar operations, Artemis III candidate regions.

## Space Agency Partner Data and Other References

Space Agency Partner data: none is used in the calculations yet. Chandrayaan-3 (ISRO) and SLIM (JAXA) landing sites are in the
catalogue, with coordinates published by LROC. Adding partner data (for example JAXA/Kaguya topography for mid-latitudes
or ESA/ISRO mission sites) is the first planned extension.

Other references and code: USGS/IAU Gazetteer of Planetary Nomenclature (crater centres); Mazarico et al. 2011 (horizon-based
illumination method); Barker et al. 2021 (LOLA south-pole topography); Wagner et al. 2017 (Apollo coordinates); open-source
software listed in `docs/references.md` (React, Vite, TypeScript, Vitest, axe-core, NumPy, SpiceyPy, rasterio, pyproj,
Pillow, pytest). No third-party images, fonts or music are used.
