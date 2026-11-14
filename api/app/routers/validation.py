"""Validation report (MECH): GET /api/v1/validation. The pipeline's checks plus the MECH model checks, run live."""
from __future__ import annotations

from dataclasses import asdict

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from ..db.store import DataStore, get_store
from ..validation_checks import run_all

router = APIRouter(prefix="/validation", tags=["validation"])


class CheckOut(BaseModel):
    id: str
    model: str = Field(description="Which part of the product the check covers")
    description: str
    reference: str = Field(description="The value we compare with")
    source: str = Field(description="Where the reference comes from")
    computed: str = Field(description="What our code gives")
    tolerance: str
    passed: bool


class ValidationReport(BaseModel):
    all_passed: bool
    passed: int
    total: int
    model_checks: list[CheckOut]
    pipeline: dict = Field(description="Ephemeris vs JPL Horizons and Apollo tables, terrain vs LROC (data/validation.json)")


_CACHE: dict[int, tuple] = {}


@router.get("", response_model=ValidationReport, summary="Validation of the models against references (live)")
def validation(store: DataStore = Depends(get_store)) -> ValidationReport:
    """The checks run once per loaded data store (about a second) and are then served from memory."""
    if id(store) not in _CACHE:
        _CACHE[id(store)] = tuple(run_all(store))
    checks = _CACHE[id(store)]
    out = [CheckOut(**asdict(c)) for c in checks]
    n = sum(c.passed for c in checks)
    return ValidationReport(all_passed=n == len(checks), passed=n, total=len(checks), model_checks=out,
                            pipeline=store.validation)
