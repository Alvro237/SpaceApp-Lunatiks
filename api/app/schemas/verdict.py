"""Request and response models of POST /api/v1/verdict (MECH): RF-11 viability verdict for one site and date."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

from .common import TimeRange, WindowRequest, WindowResponse


class VerdictRequest(WindowRequest):
    panel: Literal["tracking", "vertical", "horizontal"] = "vertical"
    comms_min_fraction: float = Field(0.5, gt=0.0, le=1.0, description="Share of the Earth's disc needed for a link")
    hard_filters: dict[str, dict] = Field(default_factory=dict, description=(
        "Hard filter id -> its threshold object (ids and shapes: GET /api/v1/meta/constraints and docs/endpoints.md)"))
    weights: dict[str, float] | None = Field(None, description="Soft-score weights by criterion; default the team's weights")
    favourable_min: float = Field(75.0, ge=0.0, le=100.0, description="Score at or above which the verdict is favourable")
    marginal_min: float = Field(50.0, ge=0.0, le=100.0, description="Score at or above which the verdict is marginal")
    unknown_passes: bool = Field(False, description="Treat a hard filter that cannot be evaluated as passed")

    @model_validator(mode="after")
    def _bands(self) -> "VerdictRequest":
        if self.marginal_min > self.favourable_min:
            raise ValueError("marginal_min must not exceed favourable_min")
        return self


class FilterResult(BaseModel):
    id: str
    passed: bool | None = Field(description="null = could not be evaluated here")
    value: float | None
    threshold: float | None
    unit: str
    comparator: str
    basis: str
    margin: float | None = Field(description="Positive = passes with room to spare")
    fraction: float | None = None
    ranges: list[TimeRange] | None = None
    note: str = ""


class ScoreOut(BaseModel):
    score: float = Field(description="0..100, weighted mean of the criteria")
    parts: dict[str, float] = Field(description="Each criterion's value, 0..1 (higher is better)")
    weights: dict[str, float] = Field(description="Weights actually used")
    formula: str


class VerdictResponse(WindowResponse):
    verdict: Literal["favourable", "marginal", "poor", "unfeasible", "unknown"]
    reasons: list[str] = Field(description="Why: failed or unknown hard filters, or the score band")
    hard_filters: list[FilterResult]
    score: ScoreOut
