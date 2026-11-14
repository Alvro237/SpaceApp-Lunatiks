# References

Every external resource used by the project: data, documents, code and tools. The submission form
asks for this list; keep it current when something is added.

## NASA data and services (used as the core of the solution)

| Resource | Used for | URL |
| --- | --- | --- |
| JPL SPICE kernels (NAIF): `de440s.bsp`, `moon_pa_de440_200625.bpc`, `moon_de440_250416.tf`, `naif0012.tls`, `pck00011.tpc` | Sun and Earth positions in the Moon Mean-Earth frame | https://naif.jpl.nasa.gov/pub/naif/generic_kernels/ |
| JPL Horizons System / API | Independent validation reference (never a runtime dependency) | https://ssd.jpl.nasa.gov/horizons/ , https://ssd.jpl.nasa.gov/api/horizons.api |
| LOLA south-pole digital elevation and slope models, PGDA product 90 (Barker et al.): `LDEM_*`, `LDSM_60S_240MPP_ADJ`, `LDSM_80S_80MPP_ADJ` | Terrain horizon, ground height, slope, hillshade basemap, slope and elevation screening grids | https://pgda.gsfc.nasa.gov/products/90 |
| LOLA 80 m south-pole DEM `LDEM_80S_80MPP_ADJ.TIF`, PGDA product 90 (Barker et al.) | Web terrain tiles z4-z7 (480 to 60 m cells) within about 300 km of the pole; downloaded to `data/raw/dem_full/`, not committed | https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_80MPP_ADJ.TIF , https://pgda.gsfc.nasa.gov/products/90 |
| LOLA south-pole DEMs `LDEM_80S_20MPP_ADJ.TIF` (20 m) and `LDEM_83S_10MPP_ADJ.TIF` (10 m), PGDA product 90 (Barker et al.) | Live terrain levels z8-z10 (30, 15, 7.5 m cells): Cloud Optimized GeoTIFFs read block by block by the browser through a CORS proxy | https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_20MPP_ADJ.TIF , https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_83S_10MPP_ADJ.TIF |
| NASA Moon Trek (JPL) ArcGIS ImageServer: LOLA DEMs `LRO_LOLA_DEM_SPole45_100mp_v04` (100 m), `LRO_LOLA_DEM_SPole75_30mp_v04` (30 m), `LRO_LOLA_DEM_SPole875_5mp_v04` (5 m) | Live terrain levels z4-z7 outside the 80 m DEM and z11 (3.75 m) near the pole, read by the browser with `exportImage` | https://trek.nasa.gov/moon/trekarcgis/rest/services/ , https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=moon |
| NASA Moon Trek (JPL): ImageServer DEMs `LRO_LOLA_DEM_Global_256ppd_v06` (LOLA, 256 px/deg, 118 m), `LRO_LOLA_DEM_SPole45_100mp_v04_EQ` and `LRO_LOLA_DEM_NPole45_100mp_v04_EQ` (LOLA polar DEMs, 100 m, geographic), and the WMTS tiles of `LRO_WAC_Mosaic_Global_303ppd_v02` (LROC WAC global morphologic mosaic, 303 px/deg, 100 m; Speyerer et al. 2011, LPSC XLII abstract 2387) | Live detail tiles of the web globe while zooming (`web/src/globe/detail`): DEMs for the relief shading (global between 45° S and 45° N, polar beyond), WAC mosaic for the optional photo view. Measured on 2026-11-14: tile means within 0.25 m (global) and 13 m (south polar) of LDEM_16 over the same boxes | https://trek.nasa.gov/moon/trekarcgis/rest/services/ , https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/WMTSCapabilities.xml |
| LOLA Gridded Data Record `LDEM_16` v3.1 (PDS `LRO-L-LOLA-4-GDR-V1.0`), NASA PDS Geosciences Node | Global topography of the web globe (`data/globe`, 4 px/deg) | https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img/ |
| LOLA high-resolution site topography, PGDA product 78 | Background on uncertainty (not yet read by the pipeline) | https://pgda.gsfc.nasa.gov/products/78 |
| Lunar polar illumination, PGDA product 69 (Mazarico et al.): `AVGVISIB_65S_240M_201608`, `AVGVISIB_65S_240M_201608_EARTH`, `LPSR_65S_240M_201608`, `SKYV_65S_240M` | Screening grids: long-term Sun illumination, Earth visibility, permanent shadow, sky visibility (`data/grids`); method reference | https://pgda.gsfc.nasa.gov/products/69 |
| NSSDCA Apollo landing site coordinates (Wagner et al. 2017) | Apollo catalogue coordinates | https://nssdc.gsfc.nasa.gov/planetary/lunar/lunar_sites.html |
| Apollo Lunar Surface Journal, Earth and Sun altitude/azimuth tables (E. Scotti) | Historical validation, 43 events | https://www.nasa.gov/wp-content/uploads/static/history/alsj/Scotti_AltAz.txt |
| LROC featured images: IM-1 (1360), IM-2 (1401), Blue Ghost (1400), Chandrayaan-3 (1314), SLIM (1358) | Landing coordinates and reference elevations | https://www.lroc.asu.edu/images/ |
| Moon Trek, QuickMap | Context and cross-checks while designing | https://trek.nasa.gov/moon/ , https://quickmap.lroc.asu.edu/ |
| VIPER lunar operations, Artemis III candidate regions | Lessons on what real missions plan for | https://science.nasa.gov/mission/viper/lunar-operations/ , https://www.nasa.gov/news-release/nasa-identifies-candidate-regions-for-landing-next-americans-on-moon/ |

## Other data

| Resource | Used for | URL |
| --- | --- | --- |
| USGS / IAU Gazetteer of Planetary Nomenclature (Moon) | Centres of south-polar craters and massifs | https://planetarynames.wr.usgs.gov/ |
| Robbins (2018) Lunar Crater Database, USGS Astrogeology Science Center (built from NASA LRO LROC/LOLA and JAXA Kaguya Terrain Camera data) | Crater density for the hazard filter (`data/craters`) | https://astrogeology.usgs.gov/search/map/moon_crater_database_v1_robbins |

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
- NASA NSSDCA/ NAIF documentation for lunar frames (MOON_ME / MOON_PA, about 875 m apart).

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
