"""Mission mode: POST /api/v1/areas/search paints which cells of a bounded region pass the planner's filters.

No physics here: check the window against the ephemeris tables, run app.area_search, keep the last answers.
"""
from __future__ import annotations

from collections import OrderedDict
from threading import Lock

from fastapi import APIRouter, Depends, HTTPException

from .. import services
from ..area_search import SearchTooLarge, search
from ..db.store import DataStore, get_store
from ..schemas.areas import AreaSearchRequest, AreaSearchResponse

router = APIRouter(prefix="/areas", tags=["areas"])

# The same search asked again (the planner going back and forth between two sets of filters) is answered from
# memory. A response is a few hundred kilobytes at most (two uint8 rasters in base64).
_CACHE: OrderedDict[str, AreaSearchResponse] = OrderedDict()
_CACHE_SIZE = 16
_LOCK = Lock()


@router.post("/search", response_model=AreaSearchResponse,
             summary="Paint the cells of a region that pass every filter switched on, and the connected areas")
def area_search(req: AreaSearchRequest, store: DataStore = Depends(get_store)) -> AreaSearchResponse:
    if req.start is not None:
        start_ms = services.to_ms(req.start)
        end_ms = start_ms + ((req.duration_h or 0.0) + (req.filters.robust_delay_h or 0.0)) * 3_600_000.0
        if not (store.ephemeris.covers(start_ms) and store.ephemeris.covers(end_ms)):
            raise HTTPException(status_code=400, detail=(
                "The window is outside the ephemeris tables (2025-2035, 1969-1972 for Apollo); see GET /api/v1/meta/datasets"))
    key = req.model_dump_json()
    with _LOCK:
        if key in _CACHE:
            _CACHE.move_to_end(key)
            return _CACHE[key]
    try:
        res = search(store, req)
    except SearchTooLarge as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    with _LOCK:
        _CACHE[key] = res
        while len(_CACHE) > _CACHE_SIZE:
            _CACHE.popitem(last=False)
    return res
