# Data dictionary

Everything here is derived from public NASA (and partner) sources by `pipeline/lunarnav`, committed
so the API runs with no network access. `raw/` is git-ignored: downloads and caches used to rebuild.

Frame for all of it: **Moon Mean-Earth / polar axis (MOON_ME)**, sphere of 1737.4 km, east-positive
longitude, planetocentric latitude, degrees. The API reads these files only through `api/app/db`.

## Files

| File | Content | Encoding | Built by |
| --- | --- | --- | --- |
| `sites.json` | 21 sites: Apollo, recent landers, south-polar features; each coordinate cites its page. Terrain block for the 13 sites south of 60 S | JSON, camelCase keys | `lunarnav.build_sites` |
| `ephemeris.json` | Index of the vector tables, SPICE kernels with SHA-256 | JSON | `lunarnav.ephemeris` |
| `ephemeris_2025_2035.f32` | Sun and Earth position from the Moon centre, hourly | float32 little-endian `[sample][body][x,y,z]` km; body 0 Sun, 1 Earth | `lunarnav.ephemeris` |
| `ephemeris_apollo_1969_1972.f32` | Same, for the Apollo validation | same | `lunarnav.ephemeris` |
| `horizons.i16` | Terrain horizon mask per site and mast height (0, 2, 5, 10 m) | int16 little-endian, hundredths of a degree, `[terrainSite][mast][azimuth]`, 720 azimuths (0.5 degrees, clockwise from north) | `lunarnav.build_sites` |
| `zones.i16` | Horizon masks at the site centre and at neighbours on rings around it, 2 m mast | same unit, `[terrainSite][zonePoint][azimuth]` | `lunarnav.build_sites` |
| `grids/grids.json` | Index of the screening grids: georeference, unit, scale, source, statistics | JSON | `lunarnav.polar_grids` |
| `grids/*.npz` | Screening grids (table below) | NumPy npz, one int16 array `values[row][col]`; value = raw × scale; raw -32768 = no data | `lunarnav.polar_grids` |
| `craters/robbins_2018.npz` | 1 296 796 craters: `lat`, `lon`, `diam_km`, sorted by latitude | NumPy npz, float32 | `lunarnav.craters` |
| `craters/craters.json` | Source, citation, counts, completeness | JSON | `lunarnav.craters` |
| `globe/lola_global_4ppd.png`, `globe/globe.json` | Global LOLA topography for the web globe: 1440 x 720, 4 px/deg, simple cylindrical (row 0 = 90 N, column 0 = longitude 0, east-positive), metres above the 1737.4 km sphere | 16-bit value in the red and green bytes of a PNG; height = min + v / 65535 x (max - min) (min, max in the sidecar) | `lunarnav.globe` |
| `basemap_south.png`, `.json` | Hillshade of the south pole with its georeference (for maps) | PNG + JSON | `lunarnav.basemap` |
| `provenance.json` | Source, version, size, terms and transformation of the ephemeris, DEM and catalogue inputs | JSON | `lunarnav.provenance` |
| `validation.json` | Pipeline validation against JPL Horizons and the Apollo tables | JSON | `lunarnav.validate` |

## Screening grids

South polar stereographic, true scale at the pole: `x = r sin(lon)`, `y = r cos(lon)`,
`r = 2R tan((90 + lat)/2)`. Row 0 is the top (`yTopM`), column 0 the left (`xLeftM`).

| Grid | Unit | Cell | Coverage | Source |
| --- | --- | --- | --- | --- |
| `lola_slope_60s` | degrees | 960 m | south of 60 S | LOLA `LDSM_60S_240MPP_ADJ`, PGDA product 90 |
| `lola_slope_80s` | degrees | 320 m | south of 80 S | LOLA `LDSM_80S_80MPP_ADJ`, PGDA product 90 |
| `lola_elevation_60s` | metres above the sphere | 960 m | south of 60 S | LOLA `LDEM_60S_240MPP_ADJ`, PGDA product 90 |
| `sun_illumination_65s` | fraction of time, 0..1 | 960 m | south of 65 S | `AVGVISIB_65S_240M_201608`, PGDA product 69 |
| `earth_visibility_65s` | fraction of time, 0..1 | 960 m | south of 65 S | `AVGVISIB_65S_240M_201608_EARTH`, PGDA product 69 |
| `permanent_shadow_65s` | fraction of the cell, 0..1 | 960 m | south of 65 S | `LPSR_65S_240M_201608`, PGDA product 69 |
| `sky_visibility_65s` | steradians of open sky | 960 m | south of 65 S | `SKYV_65S_240M`, PGDA product 69 |

## Caveats that matter when you use them

- **Slope grids** are the producer's overview levels (a smoothing resampling, not a plain mean). A few cells
  dipped below zero and were clipped to 0 (1 270 of 3.76 million at 60 S, 494 of 3.61 million at 80 S). They are
  the slope at the source pixel scale (240 m or 80 m) smoothed over the cell, not lander-scale slope. Catalogue
  sites with terrain carry their own slope from the finest DEM at a 100 m baseline (`terrain.slopeDeg`).
- **Illumination, Earth visibility, permanent shadow and sky visibility** are means of 4 × 4 source pixels
  (240 m). Averaging hides small features: the best-lit 240 m pixel in the source reaches 0.93, the best 960 m
  cell 0.60. Use them to screen areas, then evaluate a point with the engine.
- **Illumination and Earth visibility are 18.6-year averages** (Mazarico et al. 2011), not values for a given
  mission date; the engine gives those. The Earth counts as visible there when any part of its disc is.
- **Sky visibility** is in steradians; a flat plain sees 2π ≈ 6.28, peaks slightly more, crater floors less.
- **Crater catalogue**: complete above about 1-2 km diameter. No boulders, no small craters.
- **Terrain horizons** were ray-marched to 175 km over LOLA DEMs from 20 m to 240 m per pixel, with exact lunar
  curvature (`docs/data-and-computation.md`).
- **Ephemeris tables** use SPICE correction `LT+S` (matches Horizons "airless apparent"); 4-point cubic Lagrange
  interpolation between hourly samples.

## Rebuilding

`data/raw/` holds the SPICE kernels (44 MB), the four PGDA product 69 GeoTIFFs (140 MB), the Robbins zip
(96 MB, 320 MB unpacked) and the DEM window cache (about 1.2 GB after a full build). None of it is needed to run the API.

```
cd pipeline
uv run python -m lunarnav.download        # SPICE kernels
uv run python -m lunarnav.build           # ephemeris, sites, horizons, basemap, provenance, validation
uv run python -m lunarnav.polar_grids     # screening grids
uv run python -m lunarnav.craters         # crater catalogue
uv run python -m lunarnav.globe           # global LOLA topography for the web globe (downloads LDEM_16, 33 MB)
```

The four product 69 GeoTIFFs are fetched by hand into `data/raw/illumination/` from
https://pgda.gsfc.nasa.gov/products/69 (the "TIF" links; the "COG" links were not served on 2026-11-14).
