"""FastAPI application. Run from the ``api`` folder:  uv run uvicorn app.main:app --reload

Interactive docs: http://127.0.0.1:8000/docs   OpenAPI: http://127.0.0.1:8000/openapi.json
"""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import config
from .db.store import get_store
from .routers import (areas, earth, horizon, link, meta, points, power, radiation, sites, state, sun, sweep,
                      thermal, validation, verdict)


@asynccontextmanager
async def lifespan(_: FastAPI):
    get_store()   # load the datasets before the first request
    yield


def create_app() -> FastAPI:
    app = FastAPI(
        title="Lunar Landing Site Navigator API",
        version=config.API_VERSION,
        description=("Compare lunar landing sites and dates by sunlight, direct-to-Earth communication and "
                     "mission constraints over the real LOLA terrain horizon. NASA Space Apps Challenge 2026. "
                     "Frame: Moon Mean-Earth; angles in degrees; times in UTC (ISO 8601)."),
        lifespan=lifespan,
    )
    app.add_middleware(CORSMiddleware, allow_origins=config.CORS_ORIGINS, allow_methods=["GET", "POST"],
                       allow_headers=["*"])
    app.include_router(meta.health_router)
    # One router per endpoint group; register new ones here (see CLAUDE.md, "Adding an endpoint").
    app.include_router(sites.router, prefix=config.API_PREFIX)
    app.include_router(state.router, prefix=config.API_PREFIX)
    app.include_router(horizon.router, prefix=config.API_PREFIX)
    app.include_router(points.router, prefix=config.API_PREFIX)
    app.include_router(meta.router, prefix=config.API_PREFIX)
    app.include_router(power.router, prefix=config.API_PREFIX)
    app.include_router(sun.router, prefix=config.API_PREFIX)
    app.include_router(earth.router, prefix=config.API_PREFIX)
    app.include_router(radiation.router, prefix=config.API_PREFIX)
    app.include_router(sweep.router, prefix=config.API_PREFIX)
    app.include_router(thermal.router, prefix=config.API_PREFIX)
    app.include_router(verdict.router, prefix=config.API_PREFIX)
    app.include_router(validation.router, prefix=config.API_PREFIX)
    app.include_router(areas.router, prefix=config.API_PREFIX)
    app.include_router(link.router, prefix=config.API_PREFIX)
    return app


app = create_app()
