# Data sources and computation

> Written for the first static prototype (a React site whose engine lived in `web/src/core`). The method and
> the numbers still hold; the engine now lives in `api/app/logic`, the data in `data/` and the tests in
> `api/tests`. Paths under `web/` no longer exist in this repository.

Status words: **verified** = checked live and used; **search** = found through a web search summary, page not opened;
**unverified** = recommended, not used yet. Last full update: 2026-11-13 (implementation day).

## Data sources

| Source | Agency | Use | Status |
| --- | --- | --- | --- |
| NAIF SPICE kernels `de440s.bsp` (32.7 MB), `moon_pa_de440_200625.bpc` (12.9 MB), `moon_de440_250416.tf`, `naif0012.tls`, `pck00011.tpc` — `https://naif.jpl.nasa.gov/pub/naif/generic_kernels/` | NASA/JPL | Sun and Earth positions in MOON_ME | **verified, used** |
| JPL Horizons API `https://ssd.jpl.nasa.gov/api/horizons.api` | NASA/JPL | Independent validation reference (fixtures) | **verified, used** |
| LOLA south-pole DEMs, PGDA product 90, `https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/` (COGs) | NASA GSFC | Terrain horizon, ground height, slope, hillshade | **verified, used** |
| PGDA product 78 (5 m LOLA site DEMs, height uncertainty) | NASA GSFC | Background; **not read by the pipeline yet** | verified (page), not used |
| PGDA product 69 (18.6-year average illumination and Earth visibility) | NASA GSFC | Method reference | verified (page), not used |
| NSSDCA Apollo landing-site coordinates (Wagner et al. 2017) | NASA | Apollo catalogue | **verified, used** |
| Apollo Lunar Surface Journal `Scotti_AltAz.txt` | NASA | Historical validation (43 events) | **verified, used** |
| LROC featured images 1360, 1401, 1400, 1314, 1358 | NASA/GSFC/ASU | Recent landing coordinates and reference elevations | **verified, used** |
| USGS/IAU Gazetteer of Planetary Nomenclature (via its search form) | USGS | Centres of south-polar craters and massifs | **verified, used** |
| Moon Trek WMTS tiles, QuickMap | NASA | Not used at runtime | verified (reachable), not used |
| LROC mosaics / PSR atlas, Diviner, SVS CGI Moon Kit, DSN station coordinates | NASA | Possible extensions | unverified |
| SLDEM2015 (LOLA + Kaguya) | NASA/JAXA | Mid-latitude topography (would give terrain at SLIM, Apollo) | unverified |
| Chandrayaan-2 data | ISRO | Possible extension | unverified |
| ShadowCam (Danuri) | KASA/NASA | Possible extension | unverified |
| ESTRACK / Madrid DSN complex | ESA / Spanish Space Agency | Per-station communication windows | unverified |

No Space Agency Partner dataset is used in the calculations yet. That is stated openly in the submission text.

### Facts verified live on 2026-11-13

- **Horizons for lunar surface sites**: `CENTER='coord@301'`, `COORD_TYPE='GEODETIC'`, `SITE_COORD='<E-lon>,<lat>,<alt km>'`,
  `QUANTITIES='4'`, `COMMAND='10'` (Sun) or `'399'` (Earth). Header: `MEAN_ME (high precision)`, radii 1737.4 km,
  `Atmos refraction: NO (AIRLESS)`. The azimuth/elevation column is "airless **apparent**": light time **and stellar
  aberration** corrected. Reproduced exactly by SPICE `spkpos(..., 'MOON_ME', 'LT+S', 'MOON')`; with `NONE` or `LT` the
  azimuth is off by 0.0056°.
- **Horizons has no CORS** and neither does PGDA: only the pipeline can read them; the browser never does.
- **PGDA COGs**: float32, metres above the 1737.4 km sphere, NaN nodata, 512-pixel blocks with overviews 2/4/8/16, answer
  `206` to range requests, CRS "Moon (2015) - Sphere / Ocentric / South Polar" (polar stereographic, true scale at the pole).
  File names: `LDEM_{83S,80S,75S,60S}_{10,20,30,40,80,120,240}MPP_ADJ.TIF`. Coverage is by latitude band.
- The server sometimes returns **truncated range responses** ("got 58796 bytes, expected 660973"). The pipeline reads
  windows in 400-row strips and retries each with a fresh handle (up to 8 times).
- **Current lunar frame kernel is `moon_de440_250416.tf`**; `moon_de440_220930.tf` is archived (404 at the top level).
  MOON_ME and MOON_PA differ by ~0.02886°, about 875 m on the surface.

## Normalization

1. **One frame**: MOON_ME everywhere (LOLA products and Horizons surface sites use it). The DEMs are tied to the DE421
   Mean-Earth frame and our ephemerides to DE440; the difference is far smaller than a pixel.
2. **Conventions**: longitude -180..180 east positive, planetocentric latitude, radius 1737.4 km, heights in metres above
   that sphere, azimuth clockwise from north, UTC outside and TDB inside SPICE.
3. **Time grid**: samples at calendar-UTC instants `start + i*step` made with plain datetime arithmetic, which is exactly
   what JavaScript's `Date` does; each instant is converted to ET individually with `str2et`. No leap-second bookkeeping
   in the browser. (Attempting a uniform ET grid failed across the 1972 leap seconds and TDB-TT periodic terms.)
4. **Projection**: south polar stereographic from the GeoTIFF's own CRS through pyproj; the browser's closed form
   (`x = rho sin(lon)`, `y = rho cos(lon)`, `rho = 2 R tan(colat/2)`) is tested against pyproj to 1 m.
5. **Real horizon** (below), **discs not points**, **parallax** (the site vector is always subtracted).
6. **Provenance**: `provenance.json` lists, per dataset, URL, size, SHA-256 for kernels, server date, use and transformation.
7. **Validation**: `validation.json` (pipeline) and `validation_browser.json` (browser engine) are generated by code.

## Computation design

### Ephemeris tables

- Hourly Sun and Earth vectors from the Moon's centre, MOON_ME, `LT+S`, stored as float32: `ephemeris_2025_2035.f32` (96,409
  samples, 2.31 MB) and `ephemeris_apollo_1969_1972.f32` (35,065 samples, 0.84 MB). Float32 quantisation error: 2.7e-6°.
- Browser: for a site at (lat, lon, height) the site position and east/north/up basis are built; the body direction is
  `body - site` (parallax); elevation `asin(up·d)`, azimuth `atan2(east·d, north·d)`.
- **Interpolation: 4-point cubic Lagrange** between hourly samples (the Sun moves 0.5°/h; linear would give ~0.0006°).
  Rebuilding samples from a table with *twice* the step gives a maximum error of 2.3e-6°.
- Table coverage is checked; outside it the app reports it instead of extrapolating.

### Terrain horizon mask (pipeline)

- 720 azimuths (0.5°). Distance schedule: 10 m steps to 3 km (the limb dip for a 2 m mast peaks at ~2.6 km), then ×1.006
  per step to 175 km (≈ `sqrt(2 R H)` for an 8.8 km relief).
- Elevation angle of a sample, exact curvature: observer `(0, R+g+m)`, sample `(R_s sin θ, R_s cos θ)`,
  `elev = atan2(R_s cos θ − R_o, R_s sin θ)`; the horizon is the maximum over the ray. NaN samples are ignored.
- DEM stack, finest valid level wins at every point: 10 m (83S, 6 km window), 20 m (80S, 20 km), 30 m (75S, 40 km),
  80 m (80S, 100 km), 120 m (60S, 120 km), 240 m (60S, 190 km). Bilinear sampling; windows cached on disk.
- Output per terrain site and antenna height (0, 2, 5, 10 m): 720 × int16 hundredths of a degree (1.4 KB).
- Sensitivity: horizons at the site and at 16 points (8 bearings × rings at 500 m and 1.5 km), 2 m mast, with each
  point's own ground height.
- **Slope** is from central differences over a 100 m baseline in the finest DEM.
- Sites north of 60° S have **no terrain data**: `terrain.available = false`, smooth-sphere horizon `-acos(R/(R+mast))`.

### Visibility, power, windows

- Disc fraction: closed-form circular segment for a flat horizon; for terrain the disc is cut into 7 azimuth slices, each
  using the horizon at its own azimuth.
- Sunlit = any part of the Sun above the horizon; Earth link = at least `commsMinFraction` (default 50 %, i.e. the centre)
  of the Earth disc above it. Eclipse = Earth's disc overlapping the Sun's as seen from the site.
- Power per m² of panel: `1361 W/m² × (1 au / r)² × visible fraction × cosine factor`, factor 1 (always faces the Sun),
  `cos(el)` (vertical panel that turns in azimuth, default) or `sin(el)` (flat panel).
- Score: `100 × (w_sun·sunlit + w_comms·comms + w_cont·continuity) / Σw`, continuity `= 1 − longest darkness / window`.
  Default weights 0.5 / 0.3 / 0.2; favourable ≥ 75, marginal ≥ 50. Weights are user-adjustable and the formula is shown.
- Planner: one hourly series per site over the whole period; prefix sums for sunlit and Earth-link counts and run lists for
  darkness and blackout make every (landing day, stay) window an O(1)-ish query; verified to equal the direct computation
  to 1e-9 (`tests/core.test.ts`). No Web Worker is needed: the whole planner (21 sites × 365 days) is computed on the
  main thread in about 0.3 s (283 ms measured), so a worker would add complexity for no visible gain.

### Area search (mission mode, API)

- The planner bounds the search to a disc (centre and radius) and a cell size; the API paints which cells pass
  instead of testing points one by one (`api/app/area_search.py`, method in `api/app/logic/areas.py`).
- Map filters read, for each cell, every pixel of the finest grid inside it (k x k samples); slope and permanent
  shadow take the worst sample (a cell fails if any part of it fails), heights and long-term maps the mean.
- Landing radius: a cell survives only if no cell failing a map filter lies within the radius (disc dilation by FFT).
- Window filters: each sample gets its own horizon, ray-traced like the point horizon (exact curvature, finest LOLA
  grid at each ray point, quarter-cell steps near the observer) every 0.5° out to 150 km by default, with 2 % range
  growth instead of 0.8 %: against the point tracer, mean difference 0.003-0.008°, max 0.06-0.13° at 5 test points.
  Samples are placed by a quadtree: coarse tiles (a quarter of the budget), then tiles whose neighbourhood mixes pass
  and fail are split, largest first; when no boundary is left, tiles whose long-term Sun or Earth map (PGDA 69) spans
  more than 0.1 are split too. Measured on a 40 km region at 0.96 km cells (2027-01-10, 240-336 h windows): 300
  samples agree with a 1718-sample reference on 91 % of the cells reaching the window stage (82 % at 100 samples);
  boundary-only splitting beat mixing in the proxy splits at the same budget (91.2 % vs 89.7 %). Speed: about 20
  samples per second on 8 threads (300 samples in 13 s for a 150 km region).

## Verified results (2026-11-13)

| Check | Result |
| --- | --- |
| SPICE `LT+S` vs Horizons at the sample site | identical to 6 decimals |
| 352 Sun/Earth directions vs Horizons, browser engine | max 0.000026° elevation, 0.000002° azimuth (tolerance 0.01°) |
| 43 Apollo events vs ALSJ tables | Sun elevation ≤ 0.066°, azimuth ≤ 0.031°; Earth elevation ≤ 0.075° once parallax is ignored as the source did |
| LOLA ground height vs LROC | IM-1 2592 m vs 2579 m (+13 m); Chandrayaan-3 529.2 m vs 532 m (−2.8 m) |
| Slope at IM-1 from the DEM | 12.5° (LROC: "sporty 12°") |
| Shackleton crater centre | ground −2789 m, horizon mean 21° and a 0 % sunlit stay: the floor of a ~21 km wide, several-km-deep crater is in permanent shadow, as expected |
| Polar projection vs pyproj | within 1 m at 10 points |

## Limits to keep in mind

- No terrain south of 60° S excluded sites (Apollo, SLIM, Blue Ghost): smooth sphere, stated in the UI.
- Height uncertainty (0.3-0.5 m at the best 5 m maps, more elsewhere; ~90 % of pixels interpolated) is **not yet propagated**
  to a confidence band on the windows.
- Uniform solar disc, no limb darkening, no reflected light, no Earthshine; idealised panel; level lander.
- "Earth in view" is line of sight only (no DSN station availability, antenna limits or link margin).
- The hillshade basemap is decorative.
- Custom coordinates get the smooth-sphere horizon: a terrain-on-demand service (FastAPI reading DEM windows) was designed
  but not built.
