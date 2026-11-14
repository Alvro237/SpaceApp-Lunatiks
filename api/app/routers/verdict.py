"""RF-11 viability verdict (MECH): POST /api/v1/verdict. Hard filters first, then the soft score."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from .. import services
from ..db.store import DataStore, get_store
from ..logic.constraints import REGISTRY, evaluate_constraints
from ..logic.engine import AnalysisParams
from ..logic.scoring import overall_verdict, score_metrics
from ..schemas.common import TimeRange
from ..schemas.verdict import FilterResult, ScoreOut, VerdictRequest, VerdictResponse
from .common import resolve_model, window_fields, window_ms

router = APIRouter(prefix="/verdict", tags=["verdict"])

ASSUMPTIONS = [
    "A site-date that fails any hard filter is unfeasible whatever its score; the score only ranks the ones that pass.",
    "Score = 100 x sum(w_i x c_i) / sum(w_i), criteria scaled 0..1; weights and bands are visible and adjustable.",
]


@router.post("", response_model=VerdictResponse, summary="Viability verdict for one site and mission window")
def verdict(req: VerdictRequest, store: DataStore = Depends(get_store)) -> VerdictResponse:
    unknown = sorted(set(req.hard_filters) - set(REGISTRY))
    if unknown:
        raise HTTPException(status_code=422, detail=f"Unknown hard filter(s) {unknown}; available: {sorted(REGISTRY)}")
    model = resolve_model(req, store)
    start_ms = window_ms(req, store)
    site = store.sites.get(req.site_id) if req.site_id else None
    params = AnalysisParams(panel=req.panel, comms_min_fraction=req.comms_min_fraction)
    ctx = services.constraint_context(store, model, start_ms, req.duration_h, site=site, step_min=req.step_min,
                                      params=params)
    try:
        results = evaluate_constraints(ctx, req.hard_filters)
    except (KeyError, TypeError, ValueError) as e:
        raise HTTPException(status_code=422, detail=f"Invalid hard filter threshold: {e!r}") from e
    sc = score_metrics(ctx.metrics, req.weights, req.favourable_min, req.marginal_min)
    v = overall_verdict([r.passed for r in results], sc, req.unknown_passes)
    reasons = [f"{r.id} failed: {r.note}".rstrip(": ") for r in results if r.passed is False]
    reasons += [f"{r.id} could not be evaluated: {r.note}".rstrip(": ") for r in results if r.passed is None]
    if v in ("favourable", "marginal", "poor"):
        reasons.append(f"score {sc.score:.1f} (favourable >= {req.favourable_min:g}, marginal >= {req.marginal_min:g})")
    return VerdictResponse(
        **window_fields(req, model, store, start_ms, ctx.series.t_ms, ASSUMPTIONS), verdict=v, reasons=reasons,
        hard_filters=[FilterResult(id=r.id, passed=r.passed, value=r.value, threshold=r.threshold, unit=r.unit,
                                   comparator=r.comparator, basis=r.basis, margin=r.margin, fraction=r.fraction,
                                   ranges=None if r.ranges is None else [TimeRange(start=services.iso_utc(a),
                                                                                   end=services.iso_utc(b))
                                                                         for a, b in r.ranges], note=r.note)
                      for r in results],
        score=ScoreOut(score=sc.score, parts=sc.parts, weights=sc.weights,
                       formula="100 * sum(w_i * c_i) / sum(w_i); continuity = 1 - longest dark / window"))
