# Web

Frontend of the Lunar Landing Site Navigator. It opens on the whole Moon (global LOLA topography, lit by the Sun
at the chosen instant): drag to turn it, wheel or double click to come closer, and anywhere on it the view tilts
into 3D (the 3D button or T; shift-drag or right-drag turns and tilts it, Q and E turn it, R sets it straight), with
the relief of the ground drawn by dense grids around the place in view (`src/globe/patch.ts`). A click on the south-polar cap (or zooming in over
it) dives into the polar map: the lunar south pole (south of 60° S) seen from above, with more detail the
closer you get, dragged to move, tilting into 3D LOLA relief, with shadows from the Sun at the chosen instant;
zooming far out returns to the globe. Panels
float over it: where and when (or mission filters) on the left, the chosen place on the right (Sun and Earth over
its horizon, horizon chart, power, link), playback along the bottom. With Compare on, every place picked on the
map or in the list joins a live comparison table, numbered as on the map. Vite, React, TypeScript, React Three
Fiber (Three.js), Zustand, TanStack Query, D3 colour scales. Plan: "Plan de implementación del frontend"
(2026-11-14).

```
cd web
npm install
npm run tiles        # preview terrain tiles from data/grids (needs uv); about 3 s
npm run dev          # http://localhost:5173/SpaceApp-Lunatiks/ ; /api is proxied to http://127.0.0.1:8000
npm test             # Vitest: engine vs JPL Horizons, LOD, PNG decoding, shadows, URL, components + axe
npm run test:e2e     # Playwright: WebGL rendering, keyboard, axe with contrast in both themes
npm run lint && npm run typecheck && npm run build
npm run gen:api      # regenerate src/api/schema.gen.ts from the API's OpenAPI document
```

Start the API first (`cd api && uv run uvicorn app.main:app --reload`). `API_PROXY=http://127.0.0.1:8010` points
the dev proxy elsewhere; in production set `VITE_API_URL` to the API's public URL.

## Where the numbers come from

- **The API** computes everything it exposes. Views use `/sites`, `/meta/*` today and call `/state`, `/series`,
  `/points/*`, `/candidates/search`, `/power` and `/craters` as soon as they are deployed (they are being built
  in parallel). A route that does not exist yet is reported on screen as "not deployed yet", never faked.
- **The browser engine** (`src/time/engine.ts`) is a line-by-line port of the API's validated engine. It moves
  the Sun every frame during playback (the plan's "posición del Sol en el navegador") and fills the panels
  while an endpoint is missing. It reads the same tables and masks (`data/ephemeris_*.f32`, `data/horizons.i16`,
  copied to `public/data` by `scripts/copy_static_data.mjs`) and is tested against the same JPL Horizons fixture
  (0.01°). Every value says which source it came from ("API" or "Browser engine").
- **Terrain tiles** follow `docs/web-tileset.md`. The preview set comes from the 960 m LOLA grids already in the
  repository; `pipeline/lunarnav/terrain_tiles.py` (AERO-1) adds the 240, 80 and 20 m levels without changes here.

## Layout

| Folder | What |
| --- | --- |
| `src/app` | Router (hash, for static hosting), header, the navigator screen |
| `src/state` | Zustand store (mode, view, instant, layers, place, comparison) and the shareable URL (`?s=`) |
| `src/api` | Client generated from `/openapi.json` (`schema.gen.ts`), hand-typed pending endpoints, query hooks |
| `src/map` | Places on the map and globe: which ones (search and screening filters), drawn in WebGL as pins, crater outlines (IAU diameter) or crosses |
| `src/globe` | The whole Moon: orbit controller with tilt and heading, globe shaders, relief grids around the place in view, entry into the polar map |
| `src/terrain` | Engine: tileset, quadtree LOD, decode worker, GPU cache, shaders, shadow pass, camera, map |
| `src/time` | Browser engine (ephemeris, horizon, disc fractions), playback clock, static data loaders |
| `src/panels` | Where, when, the chosen place (Sun and Earth now, power, link), mission filters |
| `src/charts` | Horizon chart, timeline, site × month table; every chart has a table |
| `src/compare` | Live comparison of up to four places, and the site × month table |
| `src/pages` | Data & methods, Learn (Lunar Quest hub and the ideas behind it) |
| `src/learn` | Lunar Quest: challenges that set up a real scene in the navigator and check the answer with the browser engine |
| `src/blocks` | Learn mode (the "Learn" switch in the top bar): the same place and time as a world of cubes built from the LOLA heights (whole Moon, or the ground around any place, polar map or global grid, with the Sun and Earth at their real azimuth and stretched elevation), laid out with the navigator's own top bars and panels, and a mission log: six chapters on real missions (Apollo 11, Chandrayaan-3, IM-2, Artemis regions, Earth contact, your own landing) that answer with the engine's own numbers |
| `src/ui` | Design tokens (`theme.css`: monochrome plus Sun amber and Earth blue), brand mark |
| `e2e` | Playwright tests |

## Accessibility and performance

WCAG 2.2 AA target (`docs/accessibility.md`): everything on the map is also text in the panels; site markers
are buttons; keyboard map control (arrows, + and −, T to tilt, Q and E to rotate, R to reset, Space to play);
verdicts carry a symbol and a word; reduced motion makes playback jump in 6-hour steps. The LOD refines a tile
above 2 px of screen error and merges it below 1.5 px, loads at most 6 tiles at a time
from each server (8 from the PGDA proxy), asks again up to three times for a tile that failed, and keeps up to 300 tiles in GPU memory. The map and the globe
draw a frame only when the picture changes (camera, Sun, tiles, places), plus two a second as a safety net. Below 45 fps the map steps its quality down
(coarser LOD, then a pixel ratio of 1.5) and steps back up once after ten fast seconds; the globe lowers its pixel ratio. The map uses multisampling
only on screens with one device pixel per CSS pixel.

Code written with Claude (Anthropic) assistance under the team's direction; declared in the app's Data & methods
page and in the repository README.
