# References

Every external resource used by the project: data, documents, code and tools. The submission form
asks for this list; keep it current when something is added.

## NASA data and services (used as the core of the solution)

| Resource | Used for | URL |
| --- | --- | --- |
| JPL SPICE kernels (NAIF): `de440s.bsp`, `moon_pa_de440_200625.bpc`, `moon_de440_250416.tf`, `naif0012.tls`, `pck00011.tpc` | Sun and Earth positions in the Moon Mean-Earth frame | https://naif.jpl.nasa.gov/pub/naif/generic_kernels/ |
| JPL Horizons System / API | Independent validation reference (never a runtime dependency) | https://ssd.jpl.nasa.gov/horizons/ , https://ssd.jpl.nasa.gov/api/horizons.api |
| LOLA south-pole digital elevation and slope models, PGDA product 90 (Barker et al.): `LDEM_*`, `LDSM_60S_240MPP_ADJ`, `LDSM_80S_80MPP_ADJ` | Terrain horizon, ground height, slope, hillshade basemap, slope and elevation screening grids | https://pgda.gsfc.nasa.gov/products/90 |
| LOLA high-resolution site topography, PGDA product 78 | Background on uncertainty (not yet read by the pipeline) | https://pgda.gsfc.nasa.gov/products/78 |
| Lunar polar illumination, PGDA product 69 (Mazarico et al.): `AVGVISIB_65S_240M_201608`, `AVGVISIB_65S_240M_201608_EARTH`, `LPSR_65S_240M_201608`, `SKYV_65S_240M` | Screening grids: long-term Sun illumination, Earth visibility, permanent shadow, sky visibility (`data/grids`); method reference | https://pgda.gsfc.nasa.gov/products/69 |
| NSSDCA Apollo landing site coordinates (Wagner et al. 2017) | Apollo catalogue coordinates | https://nssdc.gsfc.nasa.gov/planetary/lunar/lunar_sites.html |
| Apollo Lunar Surface Journal, Earth and Sun altitude/azimuth tables (E. Scotti) | Historical validation, 43 events | https://www.nasa.gov/wp-content/uploads/static/history/alsj/Scotti_AltAz.txt |
| LROC featured images: IM-1 (1360), IM-2 (1401), Blue Ghost (1400), Chandrayaan-3 (1314), SLIM (1358) | Landing coordinates and reference elevations | https://www.lroc.asu.edu/images/ |
| NASA GSFC Eclipse Web Site, total lunar eclipse of 2025-03-14 (F. Espenak) | Validation case for the eclipse detection at Blue Ghost 1 (`tests/test_sun.py`) | https://eclipse.gsfc.nasa.gov/LEplot/LEplot2001/LE2025Mar14T.pdf |
| LRO CRaTER dosimeter daily dose rate, as measured and corrected for lunar shielding (CRaTER Legacy Data Products, University of New Hampshire) | Galactic-cosmic-ray dose for `/radiation` and `max_dose` (`data/radiation`) | https://crater-products.sr.unh.edu/data/inst/dosim/table_dosimdrate.php |
| NASA ISWA, LRO CRaTER information page | Silicon-to-water dose conversion 1.333 used by the CRaTER team | https://iswa.gsfc.nasa.gov/iswa_data_tree/information/CRaTER.html |
| Zeitlin et al. (2013), Science 340, 1080-1084, MSL RAD cruise radiation (doi 10.1126/science.1235989) | Order of the GCR quality factor (about 3.8, to verify) | https://www.swri.org/newsroom/press-releases/swri-led-team-calculates-the-radiation-exposure-associated-trip-mars |
| LRO CRaTER Level 2 archive, PDS PPI node | Longer record (2009-2026), not yet used | https://pds-ppi.igpp.ucla.edu/data/lro-crater/ |
| NASA OCHMO, Radiation Protection technical brief (NASA-STD-3001) | Career effective dose limit 600 mSv | https://www.nasa.gov/wp-content/uploads/2023/03/radiation-protection-technical-brief-ochmo.pdf |
| Moon Trek, QuickMap | Context and cross-checks while designing | https://trek.nasa.gov/moon/ , https://quickmap.lroc.asu.edu/ |
| VIPER lunar operations, Artemis III candidate regions | Lessons on what real missions plan for | https://science.nasa.gov/mission/viper/lunar-operations/ , https://www.nasa.gov/news-release/nasa-identifies-candidate-regions-for-landing-next-americans-on-moon/ |

## Other data

| Resource | Used for | URL |
| --- | --- | --- |
| USGS / IAU Gazetteer of Planetary Nomenclature (Moon) | Centres of south-polar craters and massifs | https://planetarynames.wr.usgs.gov/ |
| Robbins (2018) Lunar Crater Database, USGS Astrogeology Science Center (built from NASA LRO LROC/LOLA and JAXA Kaguya Terrain Camera data) | Crater density for the hazard filter (`data/craters`) | https://astrogeology.usgs.gov/search/map/moon_crater_database_v1_robbins |

## Papers and documents consulted

- Mazarico, E., et al. (2011). Illumination conditions of the lunar polar regions using LOLA topography. Icarus 211, 1066-1081. https://ntrs.nasa.gov/citations/20120010094
- Robbins, S. J. (2018). A new global database of lunar impact craters >1-2 km: 1. Crater locations and sizes, comparisons with published databases, and global analysis. JGR Planets 124. doi:10.1029/2018JE005592
- Barker, M. K., et al. (2021). High-resolution LOLA topography for lunar south pole sites. Planetary and Space Science.
- Wagner, R. V., et al. (2017). Coordinates of anthropogenic features on the Moon. Icarus 283, 92-103.
- Steger, C. R., Steger, B., Schaer, C. (2022). HORAYZON: fast horizon and sky-view-factor computation. GMD 15, 6817. https://gmd.copernicus.org/articles/15/6817/2022/ (considered, not used)
- NASA NSSDCA/ NAIF documentation for lunar frames (MOON_ME / MOON_PA, about 875 m apart).
- Anderson, M. S., Ewert, M. K., Keener, J. F. (2018). Life Support Baseline Values and Assumptions Document
  (BVAD), NASA/TP-2015-218570 Rev 1, Table 3-21 "Human Metabolic Rates" (40-year-old male 12.996 and female
  11.292 MJ/CM-d): default crew metabolic heat of `/power` level 4 (mean, 140.6 W). https://ntrs.nasa.gov/citations/20180001338
- Incropera, F. P., DeWitt, D. P., Bergman, T. L., Lavine, A. S. Fundamentals of Heat and Mass Transfer, Table A.4
  (air at 300 K, c_p = 1.007 kJ/kg K): habitat air heat capacity, `/power` level 4.
- U.S. Standard Atmosphere, 1976 (NOAA/NASA/USAF): molar mass of dry air 28.9644 g/mol. CODATA 2018: gas constant
  R = 8.314462618 J/mol K and Stefan-Boltzmann constant.

## Software (all open source)

API: FastAPI, Starlette, Uvicorn, Pydantic, NumPy, pytest, httpx.
Pipeline: NumPy, SpiceyPy (NAIF CSPICE), rasterio (GDAL), pyproj (PROJ), requests, Pillow, pytest.
Exact versions: `api/uv.lock` and `pipeline/uv.lock`.

No third-party fonts, analytics, trackers or CDNs are loaded at runtime. No images other than the
hillshade generated by this project from LOLA data.

## AI assistance

Claude (Anthropic) assisted with research, code, tests and documentation under the team's direction.
See `README.md` and the "Use of AI" section inside the app. No AI-generated imagery or media.
