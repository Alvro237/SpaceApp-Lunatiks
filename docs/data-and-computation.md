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

### Ephemeris visibility bound (mission design, `api/app/logic/bounds.py`)

A conservative bound that proves, from the ephemeris and the elevation range alone, where a mission-window criterion
must fail, so that whole tiles of 4-60 km are dropped before any raster is read at full resolution or any horizon is
traced. It orders the funnel by spatial scale: Sun and Earth visibility change slowly over the surface (1 degree of
elevation per 30.3 km of ground), slope changes from cell to cell and is checked last. The order changes the speed,
never the result. Smooth-sphere results are never bounds (repo rule): this bound is not a smooth sphere, it is the
lowest skyline that any terrain at or above the lowest LOLA height can produce.

**Statement and proof.** Observer O at radius `r_o = R + top`, `top` = ground height + mast (m). Every terrain point has
radius at least `r_s = R + h_min`. The engine's skyline in an azimuth is the maximum, over the ray samples `d_i`
(surface distance), of the elevation of the terrain point at `d_i` (`logic.horizon.skyline_from_heights`). The elevation
of a point at central angle `theta_i = d_i / R` and radius `r` is `atan((r cos theta_i - r_o) / (r sin theta_i))`,
increasing in `r`. So the skyline is at least `floor = max_i atan((r_s cos theta_i - r_o) / (r_s sin theta_i))`, whatever
the terrain. A body whose highest point is below `floor` is hidden for sure. If the engine had infinite rays this floor
tends to `-arccos(r_s / r_o)` (the tangent to the lowest sphere), so the same floor is also a physical bound. For a
tile, the local vertical of any cell differs from the tile centre's by at most the central angle `theta_tile` of the
half-diagonal, so the elevation of a body at any cell is at most the centre value plus `theta_tile`.

**Possible visibility at a sample:** `el_centre + ang_radius + theta_tile + MARGIN_DEG > floor(top_tile)`, where
`top_tile` is the highest ground height in and around the tile plus the mast plus `ELEV_MARGIN_M`, and
`h_min = min(grid minima) - ELEV_MARGIN_M`. If it is false at a sample, no part of the body is visible from any cell of
the tile at that sample, for any terrain consistent with the grids. Everything derived (upper bound of a visible share,
lower bound of a longest hidden run, upper bound of the run from the start, two-sided interval of the Sun elevation at
the first sample) follows sample by sample on the same time grid as the engine (`engine.time_grid`). The floor uses the
same ray samples as the engine (240 m and 960 m cells, 150 km, 2 % growth) and is the lowest of the two sets: truncating
rays lowers the floor, so the engine's sampled horizons can be lower than the physical tangent.

**Constants** (method parameters, not criterion thresholds):

| Constant | Value | Why |
| --- | --- | --- |
| `ELEV_MARGIN_M` | 500 m | The 960 m elevation grid is smoothed and hides relief: against the 240 m pixels over 399 424 fully covered cells the 240 m maximum exceeds the 960 m value by up to 329 m (99.9th percentile 284 m) and the 960 m value exceeds the 240 m minimum by up to 337 m. Added to the observer height and subtracted from the lowest height. A test re-measures both and fails above 450 m. |
| `MARGIN_DEG` | 0.05 deg | Earth parallax over a tile (< 0.005 deg at 30 km), float32 ephemeris, the engine's disc sampling (7 slices), ray sample spacing near the optimum (< 0.001 deg). |
| `h_min` | -9608 m | Lowest grid height (`lola_elevation_60s` -9108 m, `lola_elevation_80s` -7286.5 m) minus the margin. |

**Validation** (`cd api && uv run python tests/validation_bounds.py`). Part 1 checks the bound against the LOLA terrain
masks of the 13 catalogue terrain sites x 17 zone points (221 masks, 2 m mast, 720 azimuths) at every hourly sample
2025-2035 with theta = 0: real visibility is `el + true_radius > mask(az)`, mask read at the nearest azimuth. Part 2
recomputes the discard table (tiles of 61.44, 30.72, 7.68 and 3.84 km over the cap south of 60 S, tile top from the
960 m grid maximum over the tile and a ring of one cell, mast 2 m, margin; shares weighted by true area; window from
2027-01-10T00:00Z, hourly, threshold 70 %). Pass criteria: 0 violations for both bodies, smallest margin (real skyline
minus floor, over the samples where the body is visible) at least 1.5 deg, discard shares not above the prototype's
measurement by more than 3 percentage points (lower is allowed: the final bound is more conservative). Output of the run
of 2026-11-15:

```
== Part 1: bound vs real LOLA masks (96409 hourly samples 2025-2035, 221 zone points, theta = 0)
site              Sun visible  Sun bound  viol   Earth visible Earth bound  viol
im-1                   40.54%     78.91%     0          94.95%     100.00%     0
im-2                   43.02%    100.00%     0          85.05%     100.00%     0
chandrayaan-3          48.42%     61.05%     0         100.00%     100.00%     0
mons-malapert          42.80%    100.00%     0          66.10%     100.00%     0
shackleton              0.00%    100.00%     0           0.00%      83.69%     0
haworth                 0.00%    100.00%     0           6.12%     100.00%     0
faustini                0.00%    100.00%     0           3.66%      90.66%     0
amundsen               14.69%     88.96%     0          24.47%      93.01%     0
nobile                 34.81%    100.00%     0          27.54%     100.00%     0
de-gerlache             0.05%    100.00%     0           0.00%      95.76%     0
cabeus                  0.01%     93.92%     0           3.37%     100.00%     0
shoemaker               0.00%    100.00%     0          25.74%      99.39%     0
sverdrup                0.00%    100.00%     0           5.60%      73.45%     0
TOTAL sun  : samples with any part visible 3,676,868; bound said impossible 0; smallest margin (real skyline - floor) 3.253 deg -> PASS  [1 s]
TOTAL earth: samples with any part visible 7,253,974; bound said impossible 0; smallest margin (real skyline - floor) 4.536 deg -> PASS  [1 s]

== Part 2: share of the area south of 60 S proven to fail (%), Sun >= 70 % / Earth >= 70 %
  tiles of 61.44 km:     722 tiles,   0.0 s
  tiles of 30.72 km:    2889 tiles,   0.2 s
  tiles of  7.68 km:   46163 tiles,   2.3 s
  tiles of  3.84 km:  184701 tiles,   9.5 s

By latitude band, tiles of 7.68 km (final bound | specification 3.2):
band               Sun 14 d      Sun 29.53 d       Earth 14 d    Earth 29.53 d
60-70 S        59.4 |  60.0    100.0 | 100.0     37.6 |  38.3     44.9 |  45.4
70-80 S        52.8 |  54.5     83.1 |  90.9     29.7 |  30.9     42.6 |  43.5
80-85 S        22.9 |  26.6      1.0 |   4.6      3.3 |   5.0     38.3 |  39.8
85-88 S         0.0 |   0.0      0.0 |   0.0      0.0 |   0.0     18.7 |  22.4
88-90 S         0.0 |   0.0      0.0 |   0.0      0.0 |   0.0      0.0 |   0.0

By tile size, whole cap, Sun >= 70 % over 29.53 d (final bound | specification 3.2):
  61.44 km:  72.3 |  77.3 -> PASS
  30.72 km:  77.9 |  82.0 -> PASS
   7.68 km:  83.1 |  86.8 -> PASS
   3.84 km:  84.1 |  87.6 -> PASS

OVERALL: PASS  [14 s]
```

The prototype found 3 676 764 Sun and 7 252 663 Earth samples with a visible part and margins of 2.369 and 3.649 deg;
the final bound, with a lower floor, per-sample disc radii and the extra 0.05 deg, finds 0 violations and larger
margins. The visible-sample counts differ by about 100 because the real mask is read at the nearest azimuth here.
`tests/test_bounds.py` repeats part 1 at every 6th hour plus the other checks (reference floors, floor below every
random terrain skyline, run helpers, tile bound contains every cell of the tile, the engine's own traced horizons stay
above the floor, the elevation margin still covers the grids).

**Limitation.** Within about 5 degrees of the pole the Sun stays near the horizon and the bound discards nothing for the
Sun (0 % at 85-90 S): only the terrain decides there, so window samples stay necessary. Earth contact is still
discarded up to 88 S over a full lunation. Slope cannot be decided by tiles (no tile above a few km is uniformly passing
or failing), so it is checked last, at full resolution, on what survives; hydrogen can (45 km footprint).

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

- Outside the polar grids (north of 60° S: Apollo, SLIM, Blue Ghost, any manual point there) the ray-traced
  horizon reads the whole-Moon LOLA grid at 8 px/deg (`lola_elevation_global`, ~3.8 km cells): real large-scale
  relief (basin rims, mountain ranges), but anything narrower than a few cells is smoothed away in both
  directions. The UI and the API report the DEM cell size (`near_cell_m`) with every traced skyline.
- Height uncertainty (0.3-0.5 m at the best 5 m maps, more elsewhere; ~90 % of pixels interpolated) is **not yet propagated**
  to a confidence band on the windows.
- Uniform solar disc, no limb darkening, no reflected light, no Earthshine; idealised panel; level lander.
- "Earth in view" is line of sight only (no DSN station availability, antenna limits or link margin).
- The hillshade basemap is decorative.
- Custom coordinates get the smooth-sphere horizon: a terrain-on-demand service (FastAPI reading DEM windows) was designed
  but not built.
