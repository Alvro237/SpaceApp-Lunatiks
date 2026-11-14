# Lunar Landing Site Navigator

Team Lunatiks · NASA Space Apps Challenge 2026 ·
[challenge page](https://www.spaceappschallenge.org/2026/challenges/lunar-landing-site-navigator/?tab=details)

Compare lunar landing sites and dates by sunlight, direct-to-Earth communication and mission constraints,
computed over the real terrain horizon from NASA's LOLA topography. An API computes everything; any frontend can
render it.

## What is here

- `api/` — FastAPI backend. Logic (`app/logic`, pure NumPy) is separate from data access (`app/db`).
- `data/` — the datasets the API serves, with provenance (`data/README.md`).
- `pipeline/` — Python package that rebuilds `data/` from NASA sources.
- `web/` — the frontend: polar map with 3D LOLA relief and live shadows, Sun and Earth panels, mission filters
  and comparison (`web/README.md`).
- `docs/` — status, endpoint specifications, requirements, method, references.

## Run it

Requires [uv](https://docs.astral.sh/uv/).

```
cd api
uv sync
uv run uvicorn app.main:app --reload
```

Open http://127.0.0.1:8000/docs for the interactive API. Tests: `uv run pytest -q`.

## Data

All inputs are public. The core is NASA data:

- JPL SPICE kernels (DE440) for the Sun and Earth positions, validated against the JPL Horizons System
  (better than 0.01 degrees).
- LRO LOLA topography and slope (NASA GSFC PGDA, Barker et al.) for terrain horizons, ground height and slope.
- LOLA-derived polar illumination, Earth visibility, permanent shadow and sky visibility (Mazarico et al. 2011).
- Robbins (2018) lunar crater database (USGS; LRO and JAXA Kaguya data).
- NASA NSSDCA, LROC and the USGS/IAU Gazetteer for site coordinates.

Sources, versions and transformations: `data/README.md`, `docs/references.md`, and `GET /api/v1/meta/datasets`.

## Known limits

Terrain horizons exist for 13 catalogue sites south of 60° S; other points use a smooth-sphere horizon. The
screening grids are coarse (320 m to 960 m). No boulder, temperature or radiation-dose dataset is included. The
ephemeris tables cover 2025-2035.

## Use of AI

Claude (Anthropic) assisted with research, code, tests, data processing scripts and documentation under the
team's direction. No AI-generated images, video or audio are used.

## Licence

Code: MIT (to be confirmed by the team). Data: derived from public NASA and USGS products, used with attribution.
