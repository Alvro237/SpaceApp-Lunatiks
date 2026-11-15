"""Pure helpers of the suitability search (logic/suitability.py), hand-worked cases."""
from __future__ import annotations

from types import SimpleNamespace

import numpy as np
import pytest

from app.logic import suitability as S


def crit(id, **kw):
    return SimpleNamespace(id=id, limit=kw.get("limit"), min=kw.get("min"), max=kw.get("max"), choice=kw.get("choice"),
                           params=kw.get("params", {}))


def test_roc_weights():
    assert np.allclose(S.roc_weights(1), [1.0])
    assert np.allclose(S.roc_weights(2), [0.75, 0.25])
    assert np.allclose(S.roc_weights(3), [11 / 18, 5 / 18, 2 / 18])
    for n in range(1, 11):
        w = S.roc_weights(n)
        assert w.sum() == pytest.approx(1.0)
        assert np.all(np.diff(w) < 0) or n == 1


def test_utility_and_quantize():
    u = S.utility([0.0, 5.0, 10.0, 20.0, np.nan], limit=10.0, ideal=0.0)
    assert np.allclose(u[:4], [1.0, 0.5, 0.0, 0.0]) and np.isnan(u[4])
    q = S.quantize_utility(np.array([0.0, 0.5, 1.0, np.nan]))
    assert q.tolist() == [0, 125, 250, 255]


def test_score_from_quantized_hand_case():
    q1 = np.array([250, 0, 255], np.uint8)
    q2 = np.array([125, 125, 125], np.uint8)
    score, cov = S.score_from_quantized([q1, q2], np.array([0.75, 0.25]))
    assert np.allclose(score, [0.875, 0.125, 0.5])
    assert np.allclose(cov, [1.0, 1.0, 0.25])
    assert S.score_from_quantized([], np.zeros(0)) == (None, None)


def test_score_u8_rounding():
    out = S.score_u8(np.array([0.5, 0.0, 0.7]), np.array([True, True, False]))
    assert out.tolist() == [128, 1, 0]


def test_edt_cells_matches_brute_force():
    rng = np.random.default_rng(3)
    for _ in range(30):
        m = rng.random((14, 17)) < rng.uniform(0.0, 0.15)
        cap = float(rng.uniform(1, 12))
        d = S.edt_cells(m, cap)
        pts = np.argwhere(m)
        for i in range(m.shape[0]):
            for j in range(m.shape[1]):
                ref = np.inf if pts.size == 0 else float(np.min(np.hypot(pts[:, 0] - i, pts[:, 1] - j)))
                ref = ref if ref <= cap else np.inf
                assert d[i, j] == pytest.approx(ref) if np.isfinite(ref) else np.isinf(d[i, j])


def test_min_filter_square_matches_brute_force():
    rng = np.random.default_rng(5)
    a = rng.random((9, 11))
    a[rng.random(a.shape) < 0.2] = np.nan
    for r in (0, 1, 2, 5):
        out = S.min_filter_square(a, r)
        for i in range(a.shape[0]):
            for j in range(a.shape[1]):
                blk = a[max(0, i - r):i + r + 1, max(0, j - r):j + r + 1]
                ref = np.nan if np.all(np.isnan(blk)) else np.nanmin(blk)
                assert (np.isnan(out[i, j]) and np.isnan(ref)) or out[i, j] == pytest.approx(ref)


def test_pick_sites_separation_and_order():
    score = np.array([[0.9, 0.8, 0.1], [0.7, np.nan, 0.95], [0.2, 0.3, 0.4]])
    x, y = np.meshgrid(np.arange(3) * 1000.0, -np.arange(3) * 1000.0)
    k = np.ones((3, 3))
    picks = S.pick_sites(score, np.zeros((3, 3)), x, y, k, 1500.0, 5)
    assert picks[0] == (1, 2) and picks[1] == (0, 0)
    for a in range(len(picks)):
        for b in range(a + 1, len(picks)):
            (i1, j1), (i2, j2) = picks[a], picks[b]
            assert np.hypot(i1 - i2, j1 - j2) * 1000.0 >= 1500.0
    assert len(S.pick_sites(score, np.zeros((3, 3)), x, y, k, 1.0, 50)) == 8


def test_pros_cons():
    entries = [{"id": "power", "utility": 0.9, "weight": 0.5}, {"id": "earth", "utility": 0.6, "weight": 0.3},
               {"id": "topography", "utility": 0.1, "weight": 0.2}, {"id": "science", "utility": None, "weight": 0.1}]
    pros, cons = S.pros_cons(entries)
    assert pros == ["power", "earth"] and cons == ["topography"]


def test_shortest_checked_run():
    T, F = True, False
    assert S.shortest_checked_run([T, T, T, F, F, T, F, T, T]) == 1      # first run 3, middle run 1, last run cut by the end
    assert S.shortest_checked_run([F, T, T, T, T]) is None                # only a run cut by the end
    assert S.shortest_checked_run([T, T, T, T]) == 4                      # first run counts even when it fills the window
    assert S.shortest_checked_run([F, F]) is None


def test_passes_and_margin():
    spec = S.CATALOGUE["battery_autonomy_h"]
    assert S.passes(spec, np.array([10.0, 60.0]), crit("battery_autonomy_h", limit=48)).tolist() == [True, False]
    assert S.margin(spec, 10.0, crit("battery_autonomy_h", limit=48)) == 38.0
    pl = S.CATALOGUE["past_landings"]
    assert S.passes(pl, np.array([5.0]), crit("past_landings", limit=10, choice="away")).tolist() == [False]
    assert S.passes(pl, np.array([5.0]), crit("past_landings", limit=10, choice="near")).tolist() == [True]
    rg = S.CATALOGUE["sun_el_at_landing_deg"]
    c = crit("sun_el_at_landing_deg", min=-2.0, max=10.0)
    assert S.passes(rg, np.array([-3.0, 0.0, 11.0]), c).tolist() == [False, True, False]
    assert S.margin(rg, 8.0, c) == 2.0


@pytest.mark.parametrize("bad,good", [
    ([crit("rocks")], [crit("max_slope_deg", limit=10)]),                                   # unavailable
    ([crit("max_slope_deg", limit=10), crit("max_slope_deg", limit=12)], [crit("max_slope_deg", limit=10)]),  # twice
    ([crit("max_slope_deg")], [crit("max_slope_deg", limit=10)]),                            # limit required
    ([crit("max_slope_deg", limit=95)], [crit("max_slope_deg", limit=10)]),                  # outside 0..90
    ([crit("sun_el_at_landing_deg")], [crit("sun_el_at_landing_deg", min=0)]),               # range needs a bound
    ([crit("sun_el_at_landing_deg", min=10, max=5)], [crit("sun_el_at_landing_deg", min=5, max=10)]),
    ([crit("side", choice="up")], [crit("side", choice="near")]),
    ([crit("target_distance_km", limit=10)], [crit("target_distance_km", limit=10, params={"feature": "Shackleton"})]),
    ([crit("battery_model", params={"panel_area_m2": 2})], [crit("avoid_psr")]),
    ([crit("battery_model", params={k: 0.5 for k in S.POWER_FLAT_KEYS}), crit("recharge_h", limit=5)],
     [crit("battery_model", params={k: 0.5 for k in S.POWER_FLAT_KEYS})]),
])
def test_validate_inputs(bad, good):
    cats = list(S.CATEGORY_IDS)
    assert S.validate_inputs(cats, bad, None)
    assert S.validate_inputs(cats, good, None) == []


def test_validate_category_and_priority():
    assert S.validate_inputs(["power"], [crit("max_slope_deg", limit=10)], None)    # topography is off
    assert S.validate_inputs(["power"], [], ["landing"])                            # landing has no score
    assert S.validate_inputs(["power"], [], ["power", "power"])
    assert S.validate_inputs(["power", "earth"], [], ["earth", "power"]) == []
    assert S.ordered_scored(["power", "earth", "topography"], ["earth"], {"power", "earth"}) == ["earth", "power"]
