"""Mission design: POST /api/v1/suitability/search scores the cells of a region for a mission and proposes the best
landing sites; GET /api/v1/suitability/criteria lists what the search accepts; GET /api/v1/suitability/features finds
IAU feature names for the "near a named feature" criterion.

No physics here: check the window against the ephemeris tables, run app.suitability_search, keep the last answers.
"""
from __future__ import annotations

from collections import OrderedDict
from threading import Lock

from fastapi import APIRouter, Depends, HTTPException, Query

from .. import services
from ..area_search import SearchTooLarge
from ..db.store import DataStore, get_store
from ..logic import suitability as S
from ..schemas.suitability import (CategoryInfo, CriteriaCatalogue, CriterionInfo, FeatureList, FeatureMatch, FixedInput,
                                   ParamInfo, SuitabilityRequest, SuitabilityResponse)
from ..suitability_search import SuitabilityInputError, search

router = APIRouter(prefix="/suitability", tags=["suitability"])

_CACHE: OrderedDict[str, SuitabilityResponse] = OrderedDict()
_CACHE_SIZE = 16
_LOCK = Lock()


@router.post("/search", response_model=SuitabilityResponse,
             summary="Score the cells of a region for a mission and propose the best landing sites")
def suitability_search(req: SuitabilityRequest, store: DataStore = Depends(get_store)) -> SuitabilityResponse:
    start_ms = services.to_ms(req.start)
    end_ms = start_ms + (req.duration_h + (req.robust_delay_h or 0.0)) * 3_600_000.0
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
    except SuitabilityInputError as e:
        raise HTTPException(status_code=422, detail=e.errors) from e
    except SearchTooLarge as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    with _LOCK:
        _CACHE[key] = res
        while len(_CACHE) > _CACHE_SIZE:
            _CACHE.popitem(last=False)
    return res


@router.get("/criteria", response_model=CriteriaCatalogue,
            summary="Criteria the mission design can use, with units, categories, parameters and coverage")
def suitability_criteria(store: DataStore = Depends(get_store)) -> CriteriaCatalogue:
    crits = []
    for c in S.CATALOGUE_LIST:
        reason = None
        if c.id == "target_distance_km" and not (store.nomenclature and store.nomenclature.available):
            reason = "The IAU nomenclature file is not loaded."
        if c.id in ("crater_cover_pct", "rim_margin_radii") and not store.craters.available:
            reason = "The Robbins (2018) crater catalogue is not loaded."
        crits.append(CriterionInfo(
            id=c.id, category=c.category, label=c.label, unit=c.unit, kind=c.kind, comparator=c.comparator,
            options=list(c.options), stage=c.stage,
            params=[ParamInfo(key=p.key, label=p.label, unit=p.unit, kind=p.kind, min=p.min, max=p.max, required=p.required)
                    for p in c.params],
            coverage=c.coverage, source=c.source, tip=c.tip, available=reason is None, unavailable_reason=reason))
    for cid, (cat, label, reason) in S.UNAVAILABLE.items():
        crits.append(CriterionInfo(id=cid, category=cat, label=label, unit=None, kind="flag", comparator=None, options=[],
                                   stage="medium", params=[], coverage="none", source="none", tip="", available=False,
                                   unavailable_reason=reason))
    return CriteriaCatalogue(
        categories=[CategoryInfo(id=i, title=t, score=s) for i, t, s in S.CATEGORIES],
        fixed_inputs=[FixedInput(id=i, label=lb, tip=tp) for i, lb, tp in S.FIXED_INPUTS],
        request_parameters=[FixedInput(id=i, label=lb, tip=tp) for i, lb, tp in S.REQUEST_PARAMETERS],
        criteria=crits)


@router.get("/features", response_model=FeatureList,
            summary="IAU feature names south of 55 S that contain the query (for the named-feature criterion)")
def suitability_features(q: str = Query("", max_length=80, description="Part of the name, case-insensitive"),
                         limit: int = Query(20, ge=1, le=100, description="Most names returned"),
                         store: DataStore = Depends(get_store)) -> FeatureList:
    if not store.nomenclature or not store.nomenclature.available:
        return FeatureList(features=[])
    a = store.nomenclature.arrays()
    out = []
    for i in store.nomenclature.search(q, -55.0, limit):
        d = a["diameter_km"][i]
        out.append(FeatureMatch(name=str(a["name"][i]), lat=round(float(a["lat"][i]), 4), lon=round(float(a["lon"][i]), 4),
                                diameter_km=None if d != d else round(float(d), 3), type=str(a["type"][i])))
    return FeatureList(features=out)
