# References

Every external resource used by the project: data, documents, code and tools. The submission form
asks for this list; keep it current when something is added.

## NASA data and services (used as the core of the solution)

| Resource | Used for | URL |
| --- | --- | --- |
| JPL SPICE kernels (NAIF): `de440s.bsp`, `moon_pa_de440_200625.bpc`, `moon_de440_250416.tf`, `naif0012.tls`, `pck00011.tpc` | Sun and Earth positions in the Moon Mean-Earth frame | https://naif.jpl.nasa.gov/pub/naif/generic_kernels/ |
| JPL Horizons System / API | Independent validation reference (never a runtime dependency) | https://ssd.jpl.nasa.gov/horizons/ , https://ssd.jpl.nasa.gov/api/horizons.api |
| LOLA south-pole digital elevation and slope models, PGDA product 90 (Barker et al.): `LDEM_*`, `LDSM_60S_240MPP_ADJ`, `LDSM_80S_80MPP_ADJ` | Terrain horizon, ground height, slope, hillshade basemap, slope and elevation screening grids; the map's live slope layer (80 m and 240 m, read block by block through the PGDA proxy) | https://pgda.gsfc.nasa.gov/products/90 |
| LOLA 80 m south-pole DEM `LDEM_80S_80MPP_ADJ.TIF`, PGDA product 90 (Barker et al.) | Web terrain tiles z4-z7 (480 to 60 m cells) within about 300 km of the pole; downloaded to `data/raw/dem_full/`, not committed | https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_80MPP_ADJ.TIF , https://pgda.gsfc.nasa.gov/products/90 |
| LOLA south-pole DEMs `LDEM_80S_20MPP_ADJ.TIF` (20 m) and `LDEM_83S_10MPP_ADJ.TIF` (10 m), PGDA product 90 (Barker et al.) | Live terrain levels z8-z10 (30, 15, 7.5 m cells): Cloud Optimized GeoTIFFs read block by block by the browser through a CORS proxy | https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_20MPP_ADJ.TIF , https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_83S_10MPP_ADJ.TIF |
| NASA Moon Trek (JPL) ArcGIS ImageServer: LOLA DEMs `LRO_LOLA_DEM_SPole45_100mp_v04` (100 m), `LRO_LOLA_DEM_SPole75_30mp_v04` (30 m), `LRO_LOLA_DEM_SPole875_5mp_v04` (5 m) | Live terrain levels z4-z7 outside the 80 m DEM and z11 (3.75 m) near the pole, read by the browser with `exportImage` | https://trek.nasa.gov/moon/trekarcgis/rest/services/ , https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=moon |
| NASA Moon Trek (JPL): ImageServer DEMs `LRO_LOLA_DEM_Global_256ppd_v06` (LOLA, 256 px/deg, 118 m), `LRO_LOLA_DEM_SPole45_100mp_v04_EQ` and `LRO_LOLA_DEM_NPole45_100mp_v04_EQ` (LOLA polar DEMs, 100 m, geographic), and the WMTS tiles of `LRO_WAC_Mosaic_Global_303ppd_v02` (LROC WAC global morphologic mosaic, 303 px/deg, 100 m; Speyerer et al. 2011, LPSC XLII abstract 2387) | Live detail tiles of the web globe while zooming (`web/src/globe/detail`): DEMs for the relief shading (global between 45° S and 45° N, polar beyond), WAC mosaic for the optional photo view. Measured on 2026-11-14: tile means within 0.25 m (global) and 13 m (south polar) of LDEM_16 over the same boxes | https://trek.nasa.gov/moon/trekarcgis/rest/services/ , https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/WMTSCapabilities.xml |
| LOLA Gridded Data Record `LDEM_16` v3.1 (PDS `LRO-L-LOLA-4-GDR-V1.0`), NASA PDS Geosciences Node | Global topography of the web globe (`data/globe`, 4 px/deg) | https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img/ |
| LOLA high-resolution site topography, PGDA product 78 | Background on uncertainty (not yet read by the pipeline) | https://pgda.gsfc.nasa.gov/products/78 |
| Lunar polar illumination, PGDA product 69 (Mazarico et al.): `AVGVISIB_65S_240M_201608`, `AVGVISIB_65S_240M_201608_EARTH`, `LPSR_65S_240M_201608`, `SKYV_65S_240M` | Screening grids: long-term Sun illumination, Earth visibility, permanent shadow, sky visibility (`data/grids`); the map's live 240 m colour layers (read block by block through the PGDA proxy); method reference; independent validation of the terrain horizon masks (`api/tests/sw1_validation.py`); `terrain_reference` of the manual-coordinates endpoints | https://pgda.gsfc.nasa.gov/products/69 |
| NSSDCA Apollo landing site coordinates (Wagner et al. 2017) | Apollo catalogue coordinates | https://nssdc.gsfc.nasa.gov/planetary/lunar/lunar_sites.html |
| Apollo Lunar Surface Journal, Earth and Sun altitude/azimuth tables (E. Scotti) | Historical validation, 43 events | https://www.nasa.gov/wp-content/uploads/static/history/alsj/Scotti_AltAz.txt |
| LROC featured images: IM-1 (1360), IM-2 (1401), Blue Ghost (1400), Chandrayaan-3 (1314), SLIM (1358) | Landing coordinates and reference elevations | https://www.lroc.asu.edu/images/ |
| NASA GSFC lunar eclipse decade tables 2021-2030 and 2031-2040 (F. Espenak) | Validation of the eclipse detection and of zero power in totality (`api/tests/fixtures/nasa_lunar_eclipses_2025_2035.json`) | https://eclipse.gsfc.nasa.gov/LEdecade/LEdecade2021.html , https://eclipse.gsfc.nasa.gov/LEdecade/LEdecade2031.html |
| NASA GSFC Eclipse Web Site, total lunar eclipse of 2025-03-14 (F. Espenak) | Validation case for the eclipse detection at Blue Ghost 1 (`tests/test_sun.py`) | https://eclipse.gsfc.nasa.gov/LEplot/LEplot2001/LE2025Mar14T.pdf |
| LRO CRaTER dosimeter daily dose rate, as measured and corrected for lunar shielding (CRaTER Legacy Data Products, University of New Hampshire) | Galactic-cosmic-ray dose for `/radiation` and `max_dose` (`data/radiation`) | https://crater-products.sr.unh.edu/data/inst/dosim/table_dosimdrate.php |
| NASA ISWA, LRO CRaTER information page | Silicon-to-water dose conversion 1.333 used by the CRaTER team | https://iswa.gsfc.nasa.gov/iswa_data_tree/information/CRaTER.html |
| Zeitlin et al. (2013), Science 340, 1080-1084, MSL RAD cruise radiation (doi 10.1126/science.1235989) | Order of the GCR quality factor (about 3.8, to verify) | https://www.swri.org/newsroom/press-releases/swri-led-team-calculates-the-radiation-exposure-associated-trip-mars |
| LRO CRaTER Level 2 archive, PDS PPI node | Longer record (2009-2026), not yet used | https://pds-ppi.igpp.ucla.edu/data/lro-crater/ |
| NASA OCHMO, Radiation Protection technical brief (NASA-STD-3001) | Career effective dose limit 600 mSv | https://www.nasa.gov/wp-content/uploads/2023/03/radiation-protection-technical-brief-ochmo.pdf |
| NAIF station SPK `earthstns_itrf93_260814.bsp` and topocentric frame kernel `earth_topo_260814.tf` (DSN stations DSS-14/15/24/25/26 Goldstone, DSS-34/35/36/43/45 Canberra, DSS-54/55/63/65 Madrid, as listed in the kernel comments) | Ground-station dataset for the radio link: position of each deep-space antenna in the Earth-fixed frame (`pipeline` downloads to `data/raw/kernels`, not committed) | https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/stations/ , https://naif.jpl.nasa.gov/pub/naif/generic_kernels/fk/stations/ |
| NAIF Earth orientation binary PCKs `earth_000101_270208_261113.bpc` (high precision, to 2027-02-08) and `earth_2026_260806_2126_predict.bpc` (predicted, lower accuracy, to 2126) | Where each station is relative to the Moon at a given time (Earth rotation and polar motion); needed to decide when the Moon is above a station's horizon | https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/ |
| Moon Trek, QuickMap | Context and cross-checks while designing | https://trek.nasa.gov/moon/ , https://quickmap.lroc.asu.edu/ |
| VIPER lunar operations, Artemis III candidate regions | Lessons on what real missions plan for | https://science.nasa.gov/mission/viper/lunar-operations/ , https://www.nasa.gov/news-release/nasa-identifies-candidate-regions-for-landing-next-americans-on-moon/ |

## Other data

| Resource | Used for | URL |
| --- | --- | --- |
| USGS / IAU Gazetteer of Planetary Nomenclature (Moon) | Centres of south-polar craters and massifs | https://planetarynames.wr.usgs.gov/ |
| Robbins (2018) Lunar Crater Database, USGS Astrogeology Science Center (built from NASA LRO LROC/LOLA and JAXA Kaguya Terrain Camera data) | Crater density for the hazard filter (`data/craters`) | https://astrogeology.usgs.gov/search/map/moon_crater_database_v1_robbins |

## Ground-station sources consulted (radio link; values not yet in the dataset)

| Resource | Used for | URL |
| --- | --- | --- |
| ESA ESOC, ground stations (Cebreros, Malargüe, New Norcia) and ESA press release on the New Norcia 3 antenna (2025) | Which ESTRACK antennas are deep-space (35 m) and their bands; official coordinates still to be sourced | https://esoc.esa.int/explore-our-ground-stations , https://www.esa.int/Enabling_Support/Operations/ESA_Ground_Stations/Estrack_ground_stations , https://www.esa.int/enabling_support/operations/esa_inaugurates_deep_space_antenna_in_australia |
| JAXA ISAS, Misasa Deep Space Station overview; JAXA station coordinates page (updated 2026-01-11), which gives ITRF2014 positions and horizon-mask spreadsheets `Misasa_horizon_mask.xls`, `UDSC_horizon_mask.xls`, `USC_horizon_mask.xls`; Misasa 54 m is DSS-30 and Usuda 64 m is DSS-48 in DSN numbering | JAXA deep-space antennas (Misasa 54 m, Usuda 64 m, Uchinoura 34 m): coordinates and official per-azimuth horizon masks | https://www.isas.jaxa.jp/home/great/english/profile1001en.html , https://ddor.nav.isas.jaxa.jp/station_coordinates |
| NASA, LunaNet Interoperability Specification v5 | Frequency plan for direct-with-Earth links (to confirm band by band) | https://www.nasa.gov/wp-content/uploads/2025/02/lunanet-interoperability-specification-v5-baseline.pdf |
| NASA/JPL DSN Telecommunications Link Design Handbook, 810-005, module 301 Rev. N (Coverage and Geometry), sections 2.2 to 2.2.4: mechanical elevation limit about 6 deg for az-el antennas; generic limits 6.0 deg receive, 10.0 low-power and 13.5 deg high-power transmit | Minimum elevation of the DSN antennas | https://deepspace.jpl.nasa.gov/dsndocs/810-005/301/301N.pdf |
| NASA/JPL DSN 810-005 module 301 Horizon Mask Spreadsheet (V2, for 301-O, effective 2024-05-01, S. Slobin): per-azimuth receive, low-power and high-power transmit elevation limits for DSS-14, 24, 25, 26, 34, 35, 36, 43, 54, 55, 63, 65 and planned antennas | Per-antenna horizon masks for the DSN stations of the radio-link dataset (the separate "Coverage and Visibility" spreadsheet uses generic limits and is not used for masks) | https://deepspace.jpl.nasa.gov/dsndocs/810-005/301/Horizon-Masks-Download-V2-301O.xlsx , https://deepspace.jpl.nasa.gov/dsndocs/810-005/downloads/ |
| IGS site logs of the ESA stations CEBR (Cebreros), MGUE (Malargüe), NNOR (New Norcia) | Public coordinates of the ESA deep-space sites (km-level accuracy is enough to decide Moon visibility) | https://files.igs.org/pub/station/log/ , https://files.igs.org/pub/station/oldlog/cebr_20201019.log , https://files.igs.org/pub/station/log/nnor00aus_20251107.log |

## Papers and documents consulted

- Smith, D. E., et al. (2010). The Lunar Orbiter Laser Altimeter investigation on the Lunar Reconnaissance
  Orbiter mission. Space Science Reviews 150, 209-241. doi:10.1007/s11214-009-9512-y (LOLA global DEM)
- van der Walt, S., Smith, N. (2015). viridis, magma, inferno colour maps for matplotlib (perceptually uniform,
  readable with colour-vision deficiencies); used through d3-scale-chromatic. https://bids.github.io/colormap/
- Nuñez, J. R., Anderton, C. R., Renslow, R. S. (2018). Optimizing colormaps with consideration for color vision
  deficiency (cividis). PLoS ONE 13(7). doi:10.1371/journal.pone.0199239
- W3C (2023). Web Content Accessibility Guidelines (WCAG) 2.2. https://www.w3.org/TR/WCAG22/
- Cesium community forum threads on polar tiling artefacts and LOLA height offsets, read when choosing the 3D
  engine (Three.js on polar-stereographic tiles instead of a geographic globe). https://community.cesium.com/

- Mazarico, E., et al. (2011). Illumination conditions of the lunar polar regions using LOLA topography. Icarus 211, 1066-1081. https://ntrs.nasa.gov/citations/20120010094
- Robbins, S. J. (2018). A new global database of lunar impact craters >1-2 km: 1. Crater locations and sizes, comparisons with published databases, and global analysis. JGR Planets 124. doi:10.1029/2018JE005592
- Barker, M. K., et al. (2021). High-resolution LOLA topography for lunar south pole sites. Planetary and Space Science.
- Wagner, R. V., et al. (2017). Coordinates of anthropogenic features on the Moon. Icarus 283, 92-103.
- Steger, C. R., Steger, B., Schaer, C. (2022). HORAYZON: fast horizon and sky-view-factor computation. GMD 15, 6817. https://gmd.copernicus.org/articles/15/6817/2022/ (considered, not used)
- Weisstein, E. W. "Circle-Circle Intersection." MathWorld. https://mathworld.wolfram.com/Circle-CircleIntersection.html (lens area for the eclipsed share of the solar disc)
- NASA NSSDCA/ NAIF documentation for lunar frames (MOON_ME / MOON_PA, about 875 m apart).
- Anderson, M. S., Ewert, M. K., Keener, J. F. (2018). Life Support Baseline Values and Assumptions Document
  (BVAD), NASA/TP-2015-218570 Rev 1, Table 3-21 "Human Metabolic Rates" (40-year-old male 12.996 and female
  11.292 MJ/CM-d): default crew metabolic heat of `/power` level 4 (mean, 140.6 W). https://ntrs.nasa.gov/citations/20180001338
- Incropera, F. P., DeWitt, D. P., Bergman, T. L., Lavine, A. S. Fundamentals of Heat and Mass Transfer, Table A.4
  (air at 300 K, c_p = 1.007 kJ/kg K): habitat air heat capacity, `/power` level 4.
- U.S. Standard Atmosphere, 1976 (NOAA/NASA/USAF): molar mass of dry air 28.9644 g/mol. CODATA 2018: gas constant
  R = 8.314462618 J/mol K and Stefan-Boltzmann constant.

Mission facts told in Block Moon's mission log (`web/src/blocks/story.ts`); every number in its answers comes from
the engine, these only support the short historical texts:

- NASA SP-4214, *Where No Man Has Gone Before*, ch. 6 "Mission and science planning": sun elevation at landing as
  the main driver of Apollo launch times, landings near the sunrise terminator.
  https://www.nasa.gov/wp-content/uploads/static/history/SP-4214/ch6-2.html
- ISRO, Chandrayaan-3 mission page (landing on 23 August 2023 near 69.37 S, 32.32 E).
  https://www.isro.gov.in/Chandrayaan3_Details.html; rover and lander put to sleep on 2 and 4 September 2023 and no
  signal after the next sunrise (ISRO statement of 22 September 2023, reported by The Wire:
  https://thewire.in/space/isro-attempts-to-revive-communication-with-vikram-lander-pragyan-rover)
- Spaceflight Now (7 March 2025), "Intuitive Machines' IM-2 Moon mission ends with lander on its side": Athena on
  its side in a crater on Mons Mouton; Sun direction, panel orientation and cold meant no recharge.
  https://spaceflightnow.com/2025/03/07/intuitive-machines-im-2-mission-ends-with-lander-on-its-side-on-the-moon/
- NASA, LCROSS mission (impact in Cabeus crater, 9 October 2009, water in the ejecta plume).
  https://science.nasa.gov/mission/lcross/ ; Colaprete, A., et al. (2010). Detection of water in the LCROSS ejecta
  plume. Science 330, 463-468. doi:10.1126/science.1186986
- NASA Scientific Visualization Studio, Moon Phase and Libration 2026 (south up). https://svs.gsfc.nasa.gov/5588

## Software (all open source)

API: FastAPI, Starlette, Uvicorn, Pydantic, NumPy, pytest, httpx.
Fonts (self-hosted, SIL Open Font License): Space Grotesk (Florian Karsten), IBM Plex Mono (IBM), via the Fontsource packages.
Web: Vite, React, React Router, TypeScript, Three.js, React Three Fiber, Zustand, TanStack Query,
d3-scale-chromatic, geotiff.js (reads the live DEM blocks; https://github.com/geotiffjs/geotiff.js),
openapi-typescript (code generation), Vitest, Testing Library, axe-core, Playwright with @axe-core/playwright,
oxlint. Exact versions: `web/package-lock.json`. Cloudflare Workers (https://developers.cloudflare.com/workers/)
hosts the CORS proxy for the live terrain levels once the team deploys it (`web/proxy/wrangler.toml`).
Pipeline: NumPy, SpiceyPy (NAIF CSPICE), rasterio (GDAL), pyproj (PROJ), requests, Pillow, pytest.
Exact versions: `api/uv.lock` and `pipeline/uv.lock`.

No third-party fonts, analytics, trackers or CDNs are loaded at runtime. The only external data read at
runtime is the live terrain levels: byte ranges of the two NASA PGDA DEMs above, through the project's proxy, and
tiles cut by NASA Moon Trek's ImageServer (polar DEMs for the map; the global LOLA DEM and LROC WAC mosaic for the
globe). The only photographic image shown is the LROC WAC mosaic in the globe's optional photo view, labelled as
such; everything else is hillshade generated by this project from LOLA data.

## AI assistance

Claude (Anthropic) assisted with research, code, tests and documentation under the team's direction.
See `README.md` and the "Use of AI" section inside the app. No AI-generated imagery or media.
