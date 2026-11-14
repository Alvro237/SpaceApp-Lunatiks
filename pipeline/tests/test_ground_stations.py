"""Pure helpers of the ground-station build (no network, no SPICE)."""
from __future__ import annotations

import pytest

from lunarnav.ground_stations import resample_nodes


def test_resample_nodes_is_piecewise_linear_and_wraps_around_north():
    # nodes at 0, 90 and 180 deg; the mask returns to the first node's value at 360
    grid = resample_nodes([0, 90, 180], [10.0, 0.0, 5.0])
    assert len(grid) == 360
    assert grid[0] == 10.0 and grid[90] == 0.0 and grid[180] == 5.0
    assert grid[45] == pytest.approx(5.0)                      # half-way between 10 and 0
    assert grid[270] == pytest.approx(7.5)                     # half-way from 5 (at 180) back to 10 (at 360)
    assert grid[359] == pytest.approx(5.0 + 5.0 * 179 / 180, abs=0.01)   # on the way back to 10; values are rounded to 0.01


def test_resample_nodes_sorts_unordered_input():
    a = resample_nodes([180, 0, 90], [5.0, 10.0, 0.0])
    b = resample_nodes([0, 90, 180], [10.0, 0.0, 5.0])
    assert a == b
