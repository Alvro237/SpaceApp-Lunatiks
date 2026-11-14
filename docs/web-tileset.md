# Web terrain tileset: contract

What the web terrain engine (`web/src/terrain`) reads, so that `pipeline/lunarnav/terrain_tiles.py` (AERO-1) and the
horizon maps (AERO-2) can be produced independently. The preview tileset built today by
`web/scripts/build_preview_tiles.py` from the 960 m grids in `data/grids` follows this contract; the full tileset
only adds finer levels and the horizon maps.

Files are static, served next to the web app under `tiles/` and kept out of git. `npm run tiles` rebuilds them in
the pipeline environment (rasterio): about 100 s and 1.2 GB of memory with the LOLA 80 m DEM in
`data/raw/dem_full/`, a few seconds without it (then only the 960 m levels are written).

## Projection and frame

South polar stereographic on the 1737.4 km sphere, MOON_ME, metres: `x = r sin(lon)`, `y = r cos(lon)`,
`r = 2R tan((90 + lat) / 2)`. Longitude 0 is up the map (+y), 90° E is +x. Heights are metres above the
1737.4 km sphere, the API's datum. The build stops if a source product declares anything else.

## `tiles/tileset.json`

| Field | Meaning |
| --- | --- |
| `format` | `1` |
| `kind` | `preview` or `full` |
| `extentM` | `[xMin, yMin, xMax, yMax]`, a square centred on the pole |
| `discLatDeg`, `discRadiusM` | optional: the map is the disc south of this latitude (projected radius in metres); outside it nothing is drawn |
| `tileCells`, `tileSamples` | 256 cells per side, 257 samples (each tile shares its edge samples with its neighbour) |
| `levels[]` | `{ z, tiles, cellM }`: level z has 2^z × 2^z tiles; cell size in metres |
| `height.path` | `height/{z}/{x}/{y}.png`; x grows east, y grows south (row 0 is the top of the map) |
| `height.tiles` | `"z/x/y" → [min, max]` metres. A tile that is absent here is not requested |
| `height.sources[]` | source product, URL, cell size and build date of each DEM used |
| `overview` | `{ path, samples, min, max }`: the finest level as one image, used by the shadow pass |
| `layers.<id>` | `{ name, unit, min, max, colormap, levels, encoding, description, source, cellM, sourcePixelM }` |
| `validation` | measured checks (below) |
| `builtUtc`, `builtBy` | provenance |

The quadtree refines a tile only when all four children are listed in `height.tiles`, so a level may cover part
of the extent (for example 20 m only around the catalogue sites).

## Height tiles

Lossless RGB PNG, 8 bits per channel, no gamma or colour-space chunk. The 16-bit value `v = R × 256 + G` maps to
`height = min + v / 65535 × (max − min)` with the tile's own `[min, max]`. Quantisation is at most
`(max − min) / 65535` (0.226 m measured in the build of 2026-11-14). Rows use the PNG standard's adaptive scanline
filters (None, Sub, Up, Average, Paeth per row): still lossless, and the 60 m tiles are about 40 % smaller than
unfiltered, because the low byte is near-random but its difference from the neighbouring sample is small.

## Layer tiles

`layers/<id>/{z}/{x}/{y}.png`, grey + alpha PNG, 256 × 256 cells (cell-centred, not shared edges).
`value = min + grey / 255 × (max − min)`; alpha 0 means no data (drawn without colour). A layer may have fewer
levels than the heights: deeper tiles reuse the deepest ancestor's layer tile.

Colour maps: `inferno` (light), `viridis` (Earth), `magma` (slope), `cividis` (elevation and permanent shadow).

## Normalisation (in order)

1. Same projection, sphere and frame for every product, or stop.
2. Metres above the 1737.4 km sphere.
3. Gaps filled from the next coarser level, never with zeros.
4. Mosaic per tile with the finest product available and a smooth transition at product borders (full tileset).
5. Coarser levels by area mean; finer resampling bilinear.
6. Each tile normalised to its own `[min, max]`.
7. Validation written into `tileset.json`: tile height at each catalogue site with terrain against its
   `groundHeightM`; equality of shared edges between neighbours.

## Levels and coverage (build of 2026-11-14)

The disc south of 60° S (`discLatDeg`, `discRadiusM`; the square's corners repeat the nearest edge value and are
never drawn). Levels 0-3 come from the 960 m elevation grid in `data/grids` (`lola_elevation_60s`); levels 4-7
from the LOLA 80 m south-pole DEM `LDEM_80S_80MPP_ADJ` (PGDA product 90, float32 metres above the 1737.4 km sphere,
7 600 × 7 600 pixels, CRS `+proj=stere +lat_0=-90 +lat_ts=-90 +lon_0=0 +x_0=0 +y_0=0 +R=1737400 +units=m`,
checked by the build). The DEM is a square of ±304 km around the pole: it reaches 80° S on the map's axes and about
77.5° S in its corners. A fine level is written as the four children of every parent tile that holds DEM pixels;
where a child reaches past the DEM, the 960 m level fills it.

| z | Cell | Source | Tiles written | Size |
| --- | --- | --- | --- | --- |
| 0-3 | 7 680, 3 840, 1 920, 960 m | 960 m grid | 1, 4, 16, 64 (whole extent) | 9.3 MB |
| 4 | 480 m | 80 m DEM, 6 × 6 pixel means | 64 (36 with DEM data) | 7.1 MB |
| 5 | 240 m | 80 m DEM, 3 × 3 pixel means | 144 (100 with DEM data) | 15.0 MB |
| 6 | 120 m | 80 m DEM, 2 × 2 pixel means | 400 | 41.5 MB |
| 7 | 60 m | 80 m DEM pixels, bilinear | 1 600 | 161.4 MB |

Sizes are the sum of file sizes (1 MB = 10^6 bytes). With the layers (9.5 MB), the overview (6.2 MB) and
`tileset.json` (0.1 MB): 2 293 height tiles and 250.1 MB in 2 635 files, the top of the plan's 150-250 MB budget, so the 60 m level is kept. The 60 m level samples the
80 m pixels and adds no information below 80 m; it exists so that the quadtree's 2 px refinement rule shows each
DEM pixel at full size.

Validation of this build (`validation` in `tileset.json`): shared-edge mismatches 0 in every level; quantisation
at most 0.226 m. Site heights against the catalogue `groundHeightM` (which comes from the finest DEM at each
site), read from the decoded 60 m tile: IM-1 −0.1 m, IM-2 −0.1, Mons Malapert +3.3, Shackleton +0.6,
Haworth +3.6, Faustini −2.2, Amundsen +2.1, Nobile −0.3, de Gerlache −1.4, Cabeus +0.8, Shoemaker −2.7,
Sverdrup +0.8. Chandrayaan-3 (69.4° S) is outside the 80 m DEM and differs by +3.5 m on the 960 m level.
Before the 80 m levels the sites differed by up to 52 m.

The CI job (`.github/workflows/web.yml`) has no copy of the DEM, so it builds and checks the 960 m levels only; a
deploy that should show the 80 m detail needs the DEM (189 MB) downloaded before `npm run tiles`.

## Live levels (read on demand)

Wherever the static tiles stop, the engine adds tiles that are not files on our host: the browser reads them from
NASA servers while you zoom (`web/src/terrain/live/`). A tile gets live children only where its children are not
static and it lies inside a source of the next level; within a level the finest source that contains it wins.

| z | Cell | Source | Coverage |
| --- | --- | --- | --- |
| 4-6 | 480, 240, 120 m | Moon Trek `LRO_LOLA_DEM_SPole45_100mp_v04`, 100 m | the whole map outside the 80 m DEM square |
| 7 | 60 m | Moon Trek `LRO_LOLA_DEM_SPole75_30mp_v04`, 30 m | outside the 80 m square, inside ±457 380 m (about 75 S) |
| 8 | 30 m | PGDA `LDEM_80S_20MPP_ADJ.TIF`, 20 m, 30 400 × 30 400 px, 2.70 GB; Moon Trek 30 m in the ring outside it | inside ±303 960 m (20 m), then to about 75 S (30 m) |
| 9 | 15 m | PGDA `LDEM_83S_10MPP_ADJ.TIF`, 10 m, 43 280 × 43 280 px, 5.12 GB | inside ±216 380 m |
| 10 | 7.5 m | same 10 m DEM | inside ±216 380 m |
| 11 | 3.75 m | Moon Trek `LRO_LOLA_DEM_SPole875_5mp_v04`, 5 m | inside ±75 830 m (about 87.5 S) |

With the build of 2026-11-14 that is 105 904 possible live tiles; listing them takes 210-280 ms when the map opens
(measured). Unit-tested counts: 192 at z4, 5 776 PGDA tiles at z8, 12 544 at z9, 50 176 at z10, 24 336 at z11.

- **Moon Trek.** NASA's Moon Trek (JPL) serves these DEMs through an ArcGIS ImageServer that sends
  `Access-Control-Allow-Origin: *`, so the browser calls it directly, without our proxy. One `exportImage` request
  per tile returns a float32 GeoTIFF of 257 × 257 pixels whose centres are the tile's vertices (the box is widened
  by half a cell), resampled bilinearly on the server; the client checks its size, georeference and no-data before
  using or caching it (`trek.ts`). Measured on 2026-11-14: about 1.1 s and 197 KB per 257 × 257 tile at 5 m
  (LZ77), 112 KB at 3.75 m; two neighbouring tiles share bit-identical edges (257 of 257 values). Against the
  catalogue's `groundHeightM`: 5 m DEM within 0.86 m at the 4 sites it covers, 30 m within 4.70 m (12 sites),
  100 m within 6.56 m (13 sites; the largest at Cabeus, on a steep wall). Moon Trek also offers a Chang'e-2 DEM
  (`CE2_DEM_20m_SP`); it is not used (no CNSA data).

- **How.** Both DEMs are Cloud Optimized GeoTIFFs (float32, 512 × 512 deflate blocks, floating-point predictor,
  overviews; read from their headers on 2026-11-14). The decode worker opens a file once with geotiff.js, reads
  only the pixel window under a tile with HTTP Range requests, and samples the 257 × 257 vertices exactly as
  `web/scripts/fine_levels.py` does (bilinear on pixel centres, global vertex indices, so shared edges are
  identical; unit-tested). One source per level, so neighbouring tiles never mix DEMs. Heights need no
  conversion: both DEMs are metres above the 1737.4 km sphere in the same projection. Measured at the 12
  catalogue sites inside them, the 10 m DEM differs from the catalogue's `groundHeightM` by at most 0.05 m and
  the 20 m DEM by at most 0.61 m.
- **Proxy.** PGDA answers Range requests (206) but sends no `Access-Control-Allow-Origin` (checked 2026-11-14), so
  a browser cannot read it directly. Development uses the Vite proxy `/pgda/`; production needs the Cloudflare
  Worker in `web/src/proxy/pgdaProxy.ts` (`web/proxy/wrangler.toml`), deployed by the team and passed to the build
  as `VITE_PGDA_PROXY`. The Worker forwards only the two files above, only single ranges up to 16 MiB, checks that
  the answer matches the range (PGDA sometimes truncates them) and keeps each range in the edge cache. Without
  `VITE_PGDA_PROXY` a production build has no live levels and the map ends at z7 (60 m).
- **Deployed proxy** (2026-11-14, version `28147e49`): `https://lunatiks-pgda-proxy.lunatiks-spaceapps.workers.dev/`,
  `ALLOWED_ORIGINS = "*"` until the site's public URL is known. `web/.env.production` sets `VITE_PGDA_PROXY` to it,
  so every production build (CI included) has the live levels; `VITE_PGDA_PROXY=off npm run build` builds without
  them. The file is committed on purpose although the root `.gitignore` ignores `.env.*`: it holds a public URL,
  no secret. Measured with that build (`vite preview`, same zoom): 20 requests to the Worker, all 206, 13.4 MB,
  no page errors. Checked with curl:
  preflight 204 with CORS; a 64 KiB range 206 with the same bytes as PGDA; the same range again served from the
  edge cache (`x-proxy-cache: hit`, 0.88 s then 0.17 s and 0.08 s), so the Workers cache does work on
  `workers.dev`; another file 404, no range 416, POST 405, a 100 MB range 416. Through it, the map at the same
  zoom as below drew 16 tiles of z10 and 1 of z9, loaded 43 live tiles with 0 failures, 21 requests (20 answered
  206, one 502 when PGDA truncated a range, retried by the client), 13.4 MB.
- **Cache in the browser.** Blocks of 64 KiB are stored in IndexedDB (`lunatiks-dem-blocks`). After writes, at
  most every 5 s, the cache reads `navigator.storage.estimate()`; above 45 % of this site's quota it deletes the
  least recently used blocks down to 35 %. The quota is set by each browser, so the rule is a share, not a size.
  geotiff.js keeps another 16 MiB of blocks in memory.
- **Failure.** A tile whose blocks cannot be read is retried three times, then left out for the session; its
  parent stays on screen. Measured with PGDA blocked: 70 live tiles failed, the 60 m tiles stayed, no page errors.
- **Measured with Moon Trek on 2026-11-14** (headless Chromium): at Chandrayaan-3 (69.4 S, where the static tiles
  stop at 960 m) the map drew z6 (120 m) from the 100 m DEM, 21 live tiles, 0 failed, 21 requests to Moon Trek
  (4.9 MB); with Moon Trek and the proxy blocked it stayed at z3. Zoomed in fully at the pole: 27 tiles of z11
  (3.75 m), 4 of z10 and 1 of z9 drawn, 72 live tiles, 0 failed (36 requests to Moon Trek, 5.6 MB; 18 to the
  PGDA proxy).
- **Measured on 2026-11-14** (headless Chromium, development proxy, zoomed in at the pole near Shackleton, 20 zoom
  steps): 16 tiles of z10 and 1 of z9 drawn, 42 live tiles loaded, 0 failed; 16 requests to PGDA, 13.4 MB.
  Reloading with the same browser profile: 5 requests and 3.3 MB on the second run, 0 on the third (the rest
  came from IndexedDB, 18 MB on disk).

## Shadows and horizon maps

The engine computes shadows on the GPU from `overview` (ray march toward the Sun with the curvature drop, 175 km,
then the visible share of the solar disc, as the API). Measured against the LOLA masks at the 13 terrain sites
(72 azimuths, 2 m mast), the horizon from the 960 m heights is 1.2° lower on average
(`web/src/terrain/shadowVsMasks.test.ts`). Precomputed horizon maps (AERO-2) can replace the live march: 16
directions per pixel at a quarter of the height resolution, as 4 RGBA textures per tile,
`horizon/{z}/{x}/{y}_{k}.png` with k = 0..3, each channel one direction (k × 4 + channel) × 22.5° clockwise from
north, value = elevation in degrees mapped from [−10, 40] to 0..255. The engine will read them when
`tileset.json` gains a `horizon` block with that `path`.
