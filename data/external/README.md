# External datasets added by hand

Small public NASA/USGS files that were downloaded outside the pipeline and are **not** rebuilt by
`pipeline/lunarnav`. They sit apart from the derived data in `data/` so nothing here is mistaken for pipeline
output. Large originals (DEMs, 60-120 m illumination, SPICE kernels) stay out of git; see the table.

| Folder | Content | Source | Size |
| --- | --- | --- | --- |
| `horizons_reference/` | JPL Horizons airless apparent az/el of the Sun and Earth, hourly, 2026-11-01 to 2027-01-01, for the IM-2 site (84.7906 S, 29.1957 E) and Shackleton (89.67 S, 129.78 E). Columns: azimuth, elevation, distance. Frame MEAN_ME, `coord@301`, height 0 | https://ssd.jpl.nasa.gov/api/horizons.api | 0.5 MB |
| `sites/landing_sites.csv` | 53 sites: measured landing points from the NSSDCA lunar artifact table, plus the 9 Artemis III regions and south-polar references. Artemis III rows are the centre of the named IAU feature (`coord_quality = approx_iau_feature_center`), not the region | https://nssdc.gsfc.nasa.gov/planetary/lunar/lunar_artifact_impacts.html , IAU gazetteer | 12 KB |
| `nomenclature/moon_nomenclature.csv` | 9 087 IAU lunar features: name, centre, diameter, type | https://planetarynames.wr.usgs.gov/ | 3 MB |
| `lola_roughness_1km/` | LOLA roughness classes at 1 km south of 80 S (`AVGROUGH`, `CLASS`, `SPSLP`), GeoTIFF | PGDA product 90, `LDRM_80S_1000MPP_ADJ_*` | 3.6 MB |
| `lola_psr/` | Permanently shadowed regions larger than 1 km² south of 80 S (1 531 polygons), shapefile | PGDA product 90, `LPSR_80S_20MPP_ADJ_1km2` | 21 MB |
| `moon_trek/` | WMTS capabilities of south-pole layers and the tile URL template (CORS open) | https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=moon | 36 KB |

## Not added (too large for git or fetched by the pipeline)

- LOLA DEMs `LDEM_80S_40MPP_ADJ` (716 MB) and `LDEM_80S_80MPP_ADJ` (189 MB), 100 m slope baseline (620 MB), hillshade (88 MB).
- Global LOLA `ldem_4/16/64` from PDS (2 / 33 / 531 MB).
- PGDA product 69 at 75 S (120 m) and 85 S (60 m): Sun and Earth visibility.
- SPICE kernels (the pipeline downloads them).

Moon Trek also serves Chang'e-2 (CE2) layers: do not use them (no CNSA datasets).
