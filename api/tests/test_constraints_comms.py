"""Hard filters ``comms_hours`` and ``max_blackout``: a hand-worked case, validation and a real site."""
from __future__ import annotations

import dataclasses
from datetime import datetime, timezone

import numpy as np
import pytest

from app import services
from app.db.store import get_store
from app.logic.constraints import REGISTRY, ConstraintContext, evaluate_constraints
from app.logic.engine import DEFAULT_PARAMS, Series, compute_metrics

HOUR_MS = 3_600_000.0
T0 = services.to_ms(datetime(2027, 3, 1, tzinfo=timezone.utc))

# Ten hourly samples. Earth disc fraction above the horizon, with the default 0.5 threshold:
#   hour      0    1    2    3    4    5    6    7    8    9
#   fraction  1.0  1.0  0.5  0.0  0.0  0.49 1.0  1.0  0.0  1.0
#   contact   yes  yes  yes  no   no   no   yes  yes  no   yes
# Contact samples: 6 of 10 -> fraction 0.6; window = 9 h -> 0.6 x 9 = 5.4 h of contact.
# Blackout runs: hours 3-5 (3 samples = 3 h) and hour 8 (1 h) -> longest blackout 3 h.
EARTH_FRAC = np.array([1.0, 1.0, 0.5, 0.0, 0.0, 0.49, 1.0, 1.0, 0.0, 1.0])


def _ctx() -> ConstraintContext:
    n = EARTH_FRAC.size
    # Every Series field is zero except the two this test controls; built from the dataclass fields so a field
    # added to Series by another branch does not break the test.
    values = {f.name: np.zeros(n) for f in dataclasses.fields(Series)}
    values["eclipse"] = np.zeros(n, dtype=np.uint8)
    values["t_ms"] = T0 + HOUR_MS * np.arange(n)
    values["earth_frac"] = EARTH_FRAC
    series = Series(**values)
    return ConstraintContext(site_id=None, lat=-89.0, lon=0.0, start_ms=T0, duration_h=9.0, series=series,
                             metrics=compute_metrics(series), params=DEFAULT_PARAMS, horizon_kind="smooth_sphere")


def test_both_filters_are_registered():
    assert {"comms_hours", "max_blackout"} <= set(REGISTRY)


def test_comms_hours_hand_worked_case():
    ctx = _ctx()
    ok = evaluate_constraints(ctx, {"comms_hours": {"min_hours": 5.0}})[0]
    assert ok.passed is True and ok.value == pytest.approx(5.4) and ok.margin == pytest.approx(0.4)
    assert ok.unit == "hours" and ok.comparator == ">=" and ok.basis == "computed"
    assert ok.fraction == pytest.approx(0.6)
    assert ok.ranges == [(T0, T0 + 2 * HOUR_MS), (T0 + 6 * HOUR_MS, T0 + 7 * HOUR_MS), (T0 + 9 * HOUR_MS, T0 + 9 * HOUR_MS)]
    assert evaluate_constraints(ctx, {"comms_hours": {"min_hours": 6.0}})[0].passed is False


def test_comms_hours_as_a_fraction():
    ctx = _ctx()
    ok = evaluate_constraints(ctx, {"comms_hours": {"min_fraction": 0.6}})[0]
    assert ok.passed is True and ok.value == pytest.approx(0.6) and ok.unit == "fraction of mission time"
    assert evaluate_constraints(ctx, {"comms_hours": {"min_fraction": 0.61}})[0].passed is False


def test_max_blackout_hand_worked_case():
    ctx = _ctx()
    ok = evaluate_constraints(ctx, {"max_blackout": {"max_hours": 3.0}})[0]
    assert ok.passed is True and ok.value == pytest.approx(3.0) and ok.margin == pytest.approx(0.0)
    assert ok.comparator == "<=" and ok.fraction == pytest.approx(0.4)
    assert ok.ranges == [(T0 + 3 * HOUR_MS, T0 + 5 * HOUR_MS), (T0 + 8 * HOUR_MS, T0 + 8 * HOUR_MS)]
    bad = evaluate_constraints(ctx, {"max_blackout": {"max_hours": 2.9}})[0]
    assert bad.passed is False and bad.margin == pytest.approx(-0.1)


def test_comms_min_fraction_parameter_is_respected():
    ctx = _ctx()
    strict = ConstraintContext(**{**ctx.__dict__, "params": type(ctx.params)(comms_min_fraction=1.0)})
    # only the five samples with the whole disc above the horizon count now: 5 of 10
    assert evaluate_constraints(strict, {"comms_hours": {"min_fraction": 0.5}})[0].value == pytest.approx(0.5)


@pytest.mark.parametrize("filter_id, threshold", [
    ("comms_hours", {}),                                       # no limit given: never defaulted
    ("comms_hours", {"min_hours": 1.0, "min_fraction": 0.5}),  # ambiguous
    ("comms_hours", {"min_fraction": 1.5}),                    # a fraction above 1
    ("comms_hours", {"min_hours": -1}),
    ("comms_hours", {"min_hours": "many"}),
    ("max_blackout", {}),
    ("max_blackout", {"max_hours": -2}),
])
def test_invalid_thresholds_raise_value_error(filter_id, threshold):
    with pytest.raises(ValueError):
        evaluate_constraints(_ctx(), {filter_id: threshold})


def test_smooth_sphere_note_does_not_claim_a_direction():
    note = evaluate_constraints(_ctx(), {"comms_hours": {"min_hours": 1.0}})[0].note
    assert "smooth-sphere" in note and "shorten or lengthen" in note


def test_matches_the_engine_on_a_real_site():
    store = get_store()
    site = store.sites.get("mons-malapert")                    # LOLA terrain horizon
    ctx = services.constraint_context(store, services.model_for_site(store, site, 2.0), T0, 24 * 14, site=site)
    hours, blackout = evaluate_constraints(ctx, {"comms_hours": {"min_hours": 1.0}, "max_blackout": {"max_hours": 400.0}})
    assert hours.fraction == pytest.approx(ctx.metrics.comms_pct / 100.0)
    assert hours.value == pytest.approx(ctx.metrics.comms_pct / 100.0 * ctx.metrics.window_hours)
    assert blackout.value == pytest.approx(ctx.metrics.longest_blackout_h)
    assert "smooth-sphere" not in hours.note                    # terrain horizon: no caveat needed


# ------------------------------------------------------------------------------ radio-link contact series (AERO-2)

def test_filters_use_the_contact_series_when_the_context_carries_one():
    """Same Earth line of sight as above, but the antennas leave a gap: contact flags are 1,1,0,0,0,0,1,0,0,1 (hours
    0-1, 6 and 9) -> 4 contact hours' worth of samples (0.4), longest blackout hours 2-5 = 4 h."""
    base = _ctx()
    contact = np.array([1, 1, 0, 0, 0, 0, 1, 0, 0, 1], dtype=bool)
    ctx = ConstraintContext(**{**base.__dict__, "contact": contact})
    hours = evaluate_constraints(ctx, {"comms_hours": {"min_hours": 3.0}})[0]
    assert hours.fraction == pytest.approx(0.4) and hours.value == pytest.approx(0.4 * 9.0)       # 3.6 h
    assert hours.passed is True and "ground antenna" in hours.note
    assert evaluate_constraints(ctx, {"comms_hours": {"min_hours": 3.7}})[0].passed is False
    blackout = evaluate_constraints(ctx, {"max_blackout": {"max_hours": 4.0}})[0]
    assert blackout.value == pytest.approx(4.0) and blackout.passed is True
    assert evaluate_constraints(ctx, {"max_blackout": {"max_hours": 3.9}})[0].passed is False
    # without the series the same context falls back to the Earth's line of sight (unchanged behaviour)
    plain = evaluate_constraints(base, {"max_blackout": {"max_hours": 3.0}})[0]
    assert plain.value == pytest.approx(3.0) and "line of sight only" in plain.note


def test_constraint_context_with_link_networks_on_a_real_site():
    store = get_store()
    site = store.sites.get("mons-malapert")
    model = services.model_for_site(store, site, 2.0)
    plain = services.constraint_context(store, model, T0, 24 * 14, site=site)
    linked = services.constraint_context(store, model, T0, 24 * 14, site=site, link_networks=["dsn"])
    assert plain.contact is None and linked.contact is not None and linked.contact.shape == plain.series.t_ms.shape
    assert linked.contact.all()                                   # the Earth is always up here and the DSN covers the Moon
    one_complex = services.constraint_context(store, model, T0, 24 * 14, site=site, link_networks=["jaxa"])
    assert one_complex.contact.mean() < 1.0                       # a single country cannot see the Moon all day
    res = evaluate_constraints(one_complex, {"comms_hours": {"min_fraction": 0.99}, "max_blackout": {"max_hours": 6.0}})
    assert res[0].fraction == pytest.approx(float(one_complex.contact.mean()))
    assert res[0].passed is False and res[1].value > 6.0 and res[1].passed is False
    with pytest.raises(KeyError):
        services.constraint_context(store, model, T0, 24, site=site, link_networks=["nasa"])
