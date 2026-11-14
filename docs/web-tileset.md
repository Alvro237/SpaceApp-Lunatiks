# Web terrain tileset: contract

What the web terrain engine (`web/src/terrain`) reads, so that `pipeline/lunarnav/terrain_tiles.py` (AERO-1) and the
horizon maps (AERO-2) can be produced independently. The preview tileset built today by
`web/scripts/build_preview_tiles.py` from the 960 m grids in `data/grids` follows this contract; the full tileset
only adds finer levels and the horizon maps.

Files are static, served next to the web app under `tiles/` and kept out of git (`npm run tiles` rebuilds the
preview in about 3 seconds).

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
`(max − min) / 65535` (0.21 m in the preview; about 0.1 m for a tile with 6 km of relief).

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

Preview build of 2026-11-14: the disc south of 60° S (`discLatDeg`, `discRadiusM`; the square's corners repeat the
nearest edge value and are never drawn), 85 height tiles in 4 levels (7 680, 3 840, 1 920, 960 m), 4 layers,
30 MB; shared-edge mismatches 0; site heights within 52 m of the catalogue (960 m cell means against the finest
DEM at each site).

## Shadows and horizon maps

The engine computes shadows on the GPU from `overview` (ray march toward the Sun with the curvature drop, 175 km,
then the visible share of the solar disc, as the API). Measured against the LOLA masks at the 13 terrain sites
(72 azimuths, 2 m mast), the horizon from the 960 m heights is 1.2° lower on average
(`web/src/terrain/shadowVsMasks.test.ts`). Precomputed horizon maps (AERO-2) can replace the live march: 16
directions per pixel at a quarter of the height resolution, as 4 RGBA textures per tile,
`horizon/{z}/{x}/{y}_{k}.png` with k = 0..3, each channel one direction (k × 4 + channel) × 22.5° clockwise from
north, value = elevation in degrees mapped from [−10, 40] to 0..255. The engine will read them when
`tileset.json` gains a `horizon` block with that `path`.
