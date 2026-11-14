# Horizon tab: from silhouette to landscape (implementation plan)

Proposal, 2026-11-14 (MECH, for SW-1's area with Víctor's consent). **Built on `feat/mech-power` the same day**;
"As built" at the end says where the code is and where it departs from this plan.

**Goal.** The first-person Horizon view (`web/src/horizon/`) draws the real skyline from the site's mask, but fills
it with a flat grey gradient: a diagram, not a place. Make it read as a lunar landscape while every pixel stays
physically justified: the skyline, the ridges in front of it, the shading by the Sun and the Earth's phase all come
from LOLA heights and the ephemeris. Two layers:

- **Layer A (base, every point on the Moon):** several terrain planes at known distances, lit by the Sun, drawn on
  the existing 2D canvas. Needs one API addition and a rewrite of `drawTerrain`.
- **Layer B (on top, where fine tiles exist):** the Three.js terrain engine rendered from a camera standing on the
  ground, behind the same labels, tracks and scales. Only south of about 80 S (levels 4-7 of the tileset, 480 to
  60 m cells); elsewhere Layer A alone.

Both layers show the same skyline: Layer A's far plane is the skyline the API already computes (validated against
the catalogue masks), and Layer B is clipped to that skyline, so the 3D relief can never show terrain above the
line that the metrics use.

## What exists and is reused

| Piece | Where | Reused for |
| --- | --- | --- |
| Ray-marched skyline for any point: 720 azimuths, distances per ray, heights sampled on the LOLA grids | `api/app/logic/horizon.py` (`ray_distances`, `horizon_from_heights`, `ray_traced_horizon`), `routers/points.py` (`GET /points/horizon`) | Layer A: the same march yields the ridge distances for free |
| Catalogue masks (720 az, 0/2/5/10 m) | `data/horizons.i16`, `web/src/time/staticData` | Skyline of catalogue sites (unchanged) |
| 2D canvas view: projection, grid, Sun/Earth discs with phase, tracks, labels, compass | `web/src/horizon/{draw,project}.ts`, `HorizonView.tsx` | Everything except `drawTerrain` stays |
| Terrain engine: tileset, quadtree LOD, GPU cache, elevation/colour layers, Sun shadow pass | `web/src/terrain/engine.ts`, `TerrainView.tsx`, `shaders.ts`, `shadow.ts` | Layer B: a second camera on the same engine |
| Tileset levels 4-7 (480-60 m) south of about 80 S from the 80 m DEM; 0-3 (7680-960 m) over the 60 S disc | `web/public/tiles/tileset.json`, `docs/web-tileset.md` | Decides where Layer B is allowed |
| Moon Trek WMTS layers (WAC mosaic 100 m, LOLA colour shade 30 m), CORS open | `data/external/moon_trek/*.xml`, `terrain/live/config.ts` (`trekTileUrl`) | Optional albedo texture for Layer B |

## Layer A: distance-layered skyline on the 2D canvas

### A1. API: ridge planes per azimuth (`logic/horizon.py`, `schemas/points.py`, `routers/points.py`)

`horizon_from_heights` already has, for every azimuth, the elevation angle of every sample along the ray
(`elev[n_az, n_d]`) and its distance (`dist_m`). Add a pure function next to it:

```
ridge_planes(dist_m, elev, k=3) -> (plane_el[n_az, k], plane_dist[n_az, k])
```

Along each ray, a "ridge" is a sample whose elevation is a running maximum of everything closer (it is visible: nothing
nearer hides it) and after which the elevation falls by more than a small angle (it is a crest, not a slope). Keep
the skyline (the global maximum, already returned) plus the k-1 nearest such crests, sorted near to far; pad with
NaN when fewer exist. Cost: one `np.maximum.accumulate` per row on the array the function already holds; no new
sampling.

Response: `GET /points/horizon` gains

- `planes: list[{ distance_km: list[float|null], elevation_deg: list[float|null] }]` (k = 3; index 0 nearest), and
- `skyline_distance_km: list[float|null]` (distance of the skyline sample per azimuth).

Both optional in the schema, null on the smooth sphere. `horizon_kind`, `elevation_deg`, `method`, `validation`
unchanged, so nothing that exists breaks. Catalogue sites: the stored masks have no distances; `/sites/{id}/horizon`
gets the same fields by running the ray march at the site's coordinates once (the API already has the grids; the
result can be cached per site in `services`). Where the march is not available (north of 60 S), the fields are
null and the view falls back to today's single plane.

Tests (`api/tests/test_points.py` or a new `test_horizon_planes.py`): a synthetic height field with two known
ridges at 2 km and 15 km returns exactly those distances and the skyline; a flat field returns one plane at the
dip; planes are monotonic (nearer plane never above the skyline); Mons Malapert's skyline is unchanged.

### A2. Web: the terrain renderer (`web/src/horizon/draw.ts`, new `web/src/horizon/terrain2d.ts`)

Replace `drawTerrain` with a painter's loop from the far plane to the near one. For each plane:

1. **Shape.** Polygon under its elevation curve (as today), clipped to the planes behind it so a far ridge never
   paints over a nearer one.
2. **Shading from the Sun (physical, no atmosphere).** Each azimuth column gets a brightness from the angle between
   the surface facing the camera and the Sun. We do not have per-pixel normals on the 2D canvas, so use the two
   quantities we do have: the **local slope of the ridge line** (dEl/dAz, which tilts the visible face towards or
   away from the Sun's azimuth) and the **Sun elevation**. Brightness = clamp(cos(angle between face normal and Sun))
   with the face normal built from (slope across, assumed 20° tilt towards the camera). Below the Sun's elevation
   the face is in shadow: pure black with a faint Earthshine term when the Earth is up (Earthshine on the Moon is
   about 1/10 000 of sunlight; draw it as a deep grey so the ground is not invisible, and say so in the legend).
   The Sun hidden: everything black except the Earthshine term. No gradients towards the horizon (no air).
3. **Depth cue without haze.** Contrast falls with distance only through smaller apparent texture and the fact that
   far ridges subtend fewer pixels; keep albedo the same at every distance (airless). Use a slightly lower maximum
   brightness for planes beyond ~50 km to mimic the loss of resolution, and state it as a presentation choice.
4. **Texture.** Procedural regolith: a tiled value-noise pattern scaled by distance (nearer planes coarser grain),
   multiplied by the brightness. Albedo baseline 0.12 (Hayne 2017, the same value the thermal model uses), rendered
   with the display's gamma so the sunlit regolith looks mid grey, not white.
5. **Skyline line.** Keep the thin light line only in the "diagram" mode (see A4); in the landscape mode the
   boundary is the contrast itself.

Earth: `drawEarth` already draws the phase; add a soft blue-white Earthshine tint to the shadowed faces when the
Earth is above the horizon (the same term as step 2).

The Sun's disc gets a faint glare only inside its own disc radius ×1.5 (optics of the eye/camera, not atmosphere).

### A3. Data path in the view (`HorizonView.tsx`, `state/horizon.ts`)

- Points: use `usePointHorizon` (SW-1's hook for `/points/horizon`) and read `planes` when present.
- Catalogue sites: call `/sites/{id}/horizon` for planes; the mask keeps providing `horizonAt` immediately, planes
  arrive asynchronously and the view redraws (Layer A with one plane until then, so nothing waits).
- Keep the arrival descent: planes interpolate with the same `arrival` factor as the skyline.

### A4. Modes and accessibility

A segmented control in the Horizon toolbar: **Landscape** (default) and **Diagram** (today's drawing with the light
grey fill and the silhouette line). The accessible description already states where the Sun and the Earth are; add
"the ground is lit from the <compass>" or "the ground is in shadow". Reduced motion: no change.

### A5. Tests

- `project.test.ts` style unit tests for the shading function: Sun behind the camera → brighter faces towards the
  camera; Sun below the horizon → black with the Earthshine floor; symmetric slopes get symmetric brightness.
- A pixel test (Vitest + canvas mock already used by `draw`'s tests if any; otherwise a small deterministic render to
  an offscreen canvas in Playwright) checking that nothing is painted above the skyline.

## Layer B: 3D ground view from the terrain engine (where fine tiles exist)

### B1. Eligibility

`terrainHorizonAvailable(lat, lon)`: true when the tileset's finest level covering the point has `cellM <= 240`
(levels 5-7; from `tileset.json` levels and the point's polar XY). Today that is south of about 80 S where the 80 m
DEM was present at build time; the CI build without the DEM has no such tiles, so the check must read the tileset,
not assume latitude. Outside: Layer A only, and the Diagram/Landscape control explains "3D relief needs the 80 m
terrain (south of 80 S)".

### B2. Ground camera on the engine (`web/src/terrain/engine.ts`, new `web/src/horizon/GroundView.tsx`)

- Add to `TerrainEngine` a second render path `renderFromGround(camera)`: a perspective `THREE.PerspectiveCamera` at
  the point's polar XY, height = `heightAt(x, y) + 2 m` (fixed observer height, team decision), yaw/pitch/fov from
  `useHorizonCam` (same state the 2D view uses, so dragging moves both). Up vector = local vertical of the sphere at
  the point (the engine's world is the stereographic plane; near the camera the plane is flat enough, but the far
  terrain must curve: see B4).
- LOD selection for a ground camera: `selectTiles` is written for a map camera (distance to the camera in the plane).
  For the ground camera use the screen-space error of each tile's bounding box as seen from the camera, with the
  finest tiles within ~5 km and coarser beyond; cap at the same `GPU_TILE_CAPACITY`. First version: reuse
  `byDistanceTo(x, y)` with the camera's XY and a radius budget; refine later.
- Lighting: the terrain shader already shades by the Sun direction in the map view; pass the Sun's local direction
  vector (from az/el at the time) and the shadow texture (`shadowTarget`), so cast shadows from the Play are the
  same ones the map shows. No sky light, no fog, black clear colour.
- Earth: draw the Earth disc with phase as a billboard at infinity (reuse `earthPhase` from `project.ts` into a
  small canvas texture), and the Sun as a disc with a glare sprite. Both at their true angular radius.

### B3. Compositing with the 2D layer

Render Layer B to a WebGL canvas placed under the 2D canvas. The 2D canvas then draws only: the grid, the tracks,
the labels, the compass, and **a black mask above Layer A's skyline is not needed** because the 3D terrain renders
its own sky as black. What the 2D canvas must do is **clip the 3D terrain to the API skyline**: paint black on the
2D canvas everywhere above the skyline curve (the inverse of today's terrain polygon) with `destination-over`
disabled, i.e. paint the sky region opaque black over the WebGL output. Thus a 60 m tile can never raise the
horizon above the 20 m-mask line the metrics use, and the two always agree at the skyline to within the 2D line
width. Below the skyline the 3D relief shows through.

When Layer B is active, Layer A still draws its planes with 20 % opacity for the first 300 ms while tiles load,
then fades out (the engine reports `inFlight`).

### B4. Curvature and far terrain

The stereographic plane is flat; a ground camera 2 m up sees the real horizon dip (0.09°) and the far relief
curving below it. In the vertex shader, when the ground camera is active, lower each vertex by
`d² / (2R)` where d is its horizontal distance to the camera (the sagitta of the sphere; 250 km → 18 km drop). This
is one uniform and two lines in `TERRAIN_VERT`, guarded by a flag so the map view is untouched.

### B5. Texture (optional, after B1-B4 work)

Albedo from the Moon Trek LRO WAC mosaic (100 m, south of 60 S) through the existing live-layer loader: a new live
layer id `wac_albedo` (8-bit grey), sampled in the fragment shader as albedo instead of the flat 0.12. Attribution
in the legend and `docs/references.md`. Skip if the tile fetches prove slow in the demo network.

### B6. Tests

- `engine` unit test: `renderFromGround` with a flat synthetic tileset produces a horizon row at the expected
  pixel for the dip (0.09° at 2 m); with a single hill tile, the hill's apparent elevation matches `atan(h / d)`.
- Playwright: Mons Malapert, Horizon open, screenshot diff against a stored reference for both modes; axe check
  unchanged.

## Order of work and estimates

| Step | Owner | Time | Depends on |
| --- | --- | --- | --- |
| A1 API planes + tests | MECH | 2-3 h | – |
| A2 2D renderer (shading, planes, texture) | MECH or SW-1 | 3-4 h | A1 (can start with fake planes) |
| A3 data path + A4 modes | SW-1 | 1-2 h | A1, A2 |
| A5 tests | same as A2 | 1 h | A2 |
| B1 eligibility + B3 compositing skeleton | SW-1 | 2 h | A2 |
| B2 ground camera, LOD, lighting | SW-1 (engine owner) | 4-6 h | B1 |
| B4 curvature | SW-1 | 1 h | B2 |
| B6 tests | SW-1 | 1-2 h | B2 |
| B5 WAC albedo | optional | 2 h | B2 |

Layer A alone is a shippable improvement in one working day; Layer B is a second day. Freeze features by Sunday noon
(`WIKI/01_Challenge/Winning-Strategy.md`), so B is only worth starting if A is merged by Saturday night.

## Risks and how each is handled

- **Near field looks blobby at 60 m cells** (a 2 m camera sees the first 60 m as one flat facet). Mitigation: Layer A's
  nearest plane is drawn on top of Layer B within the first 200 m with the procedural grain; B contributes from
  200 m out. If it still looks wrong, raise that boundary.
- **Shadow texture is top-down**, not from the camera; self-shadowing of near slopes is approximate. Acceptable: it is
  the same approximation the map uses and is stated in the assumptions.
- **Skyline disagreement between tiles and masks** (`docs/web-tileset.md`: 960 m heights give a skyline 1.2° lower on
  average). Handled by the clip in B3: the mask wins, always.
- **GPU budget on integrated graphics**: a second render of the terrain each frame. Render Layer B only while the
  Horizon section is open (the map view is covered then, so the map render can pause), and at the fast shadow size
  while the time plays.
- **CI has no 80 m DEM**, so Layer B is invisible in CI and in a deploy built without the DEM. B1's tileset check keeps
  the app correct either way; the demo machine must run `npm run tiles` with the DEM.
- **Scope creep towards Quickmap's first-person view** (the WIKI warns against competing there). Layer B stays a
  backdrop: no walking, no free flight, the camera never leaves the point.

## Not in this plan

Rocks and boulders (no dataset), Earthshine photometry beyond a presentation floor, a star field (the sky is
black in daylight exposure; at night a faint star field could be added later from a catalogue), lens flares.

## As built (2026-11-14, `feat/mech-power`)

Layer A
- API: `logic/horizon.py` `ridge_planes` / `horizon_planes`; `services.point_horizon_planes` (same cached rays as the
  point skyline); `planes` and `skyline_distance_km` on `GET /points/horizon` and `GET /sites/{id}/horizon`
  (`routers/horizon.py` `planes_fields`). Tests: `api/tests/test_horizon_planes.py` (11).
- Web: `web/src/horizon/terrain2d.ts` (painter, light, grain, `planesFromApi`), `draw.ts` (style switch),
  `HorizonView.tsx` (Landscape / Diagram, data path), `api/hooks.ts` `useHorizonPlanes`. Tests:
  `horizon/terrain2d.test.ts` (13), including "nothing above the skyline".
- Departures: the layers are painted per pixel into a buffer (not canvas polygons), so edges are antialiased and
  the grain is in world coordinates; the buffer shrinks to keep a frame near 20 ms. Crests seen over fewer than
  three azimuth samples are dropped and crest ends merge into the layer behind over six samples. Earthshine uses the
  Earth's Bond albedo 0.306 (NASA Earth Fact Sheet) x angular radius squared x lit fraction, under a display floor.
  The typed client was not regenerated (`npm run gen:api` renames the MECH `Transition` schema and breaks
  `api/types.ts`); the new fields are typed by hand in `api/types.ts`.

Layer B
- `web/src/terrain/ground.ts`: availability (`terrainHorizonAvailable`: 240 m cells or finer, static or live
  levels), the observer's frame, the direction of a terrain point (the API's skyline formula, rearranged for
  32-bit floats) and the tile-selection camera. `shaders.ts`: the same steps in the vertex shader (ground branch)
  and physical light in the fragment shader. `engine.ts`: `setGround`, `groundHeightAt`, `groundCamera`.
  `state/ground.ts`: hand-over between `HorizonView` and the engine's frame loop in `TerrainView.tsx`.
  Tests: `terrain/ground.test.ts` (14).
- Departures from B2-B4:
  - **No perspective camera and no `d^2 / 2R` term.** The horizon view is an angular (equirectangular) screen, so a
    perspective picture under it would only match at the centre. Each vertex is instead turned into its true
    direction on the sphere and placed with the horizon view's own projection: exact curvature, and pixel
    agreement with the mask, the discs and the scales.
  - **No separate `GroundView.tsx` canvas.** The existing terrain canvas under the horizon view draws the ground
    view (same engine, tiles and shadow pass); the horizon canvas is clear below the skyline and black above it.
  - **The Sun and the Earth stay on the 2D canvas** (drawn inside the sky region), not as billboards.
  - Levels finer than 25 m cells are not requested (megabytes of live tiles for a few pixels of grazing ground).
  - The painted foreground stays within 120 m of the observer and fades out by 300 m. From a 2 m eye that is
    everything more than about 1 degree below the horizon, so the 3D tiles show in the band near the horizon and
    in the relief above it: hills, crater walls, ridges.
- B5 (WAC albedo) not done. B6: the geometry twins are unit-tested; the GLSL was checked on screen at IM-2 (tiles
  from Moon Trek's 30 m DEM); no Playwright screenshot test was added.
- Only over the polar map (the globe has no tiles) and on screens wider than 760 px.
