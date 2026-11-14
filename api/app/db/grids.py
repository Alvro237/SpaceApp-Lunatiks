"""South-polar screening grids (data/grids): LOLA slope and elevation, long-term Sun illumination,
Earth visibility, permanent shadow and sky visibility. See data/README.md for units and caveats."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from ..logic.projection import south_polar_xy

NODATA = -32768


class GridRepository:
    def __init__(self, data_dir: Path):
        self._dir = data_dir / "grids"
        index_path = self._dir / "grids.json"
        self.index: dict = json.loads(index_path.read_text(encoding="utf-8")) if index_path.exists() else {"grids": {}}
        self._arrays: dict[str, np.ndarray] = {}

    def ids(self) -> list[str]:
        return list(self.index["grids"])

    def meta(self, grid_id: str) -> dict:
        return self.index["grids"][grid_id]

    def _array(self, grid_id: str) -> np.ndarray:
        if grid_id not in self._arrays:   # loaded on first use, kept in memory
            self._arrays[grid_id] = np.load(self._dir / self.meta(grid_id)["file"])["values"]
        return self._arrays[grid_id]

    def sample(self, grid_id: str, lat: float, lon: float) -> float | None:
        """Value of the cell that contains the point, or None outside the grid or where there is no data."""
        v = self.sample_many(grid_id, np.array([lat]), np.array([lon]))[0]
        return None if np.isnan(v) else float(v)

    def sample_many(self, grid_id: str, lat, lon) -> np.ndarray:
        """Vectorised look-up; NaN outside the grid or where there is no data."""
        if grid_id not in self.index["grids"]:
            return np.full(np.shape(lat), np.nan)
        m = self.meta(grid_id)
        x, y = south_polar_xy(lat, lon)
        col = np.floor((x - m["xLeftM"]) / m["pixelM"]).astype(np.int64)
        row = np.floor((m["yTopM"] - y) / m["pixelM"]).astype(np.int64)
        inside = (col >= 0) & (col < m["width"]) & (row >= 0) & (row < m["height"])
        raw = np.full(np.shape(col), NODATA, dtype=np.int64)
        arr = self._array(grid_id)
        raw[inside] = arr[row[inside], col[inside]]
        return np.where(raw == NODATA, np.nan, raw * m["scale"])

    def bilinear_many(self, grid_id: str, lat, lon) -> np.ndarray:
        """Bilinear interpolation between the four nearest cell centres (any array shape, degrees); NaN outside the
        grid or where one of the four cells has no data. For continuous fields such as heights (ray tracing)."""
        if grid_id not in self.index["grids"]:
            return np.full(np.shape(lat), np.nan)
        m = self.meta(grid_id)
        x, y = south_polar_xy(lat, lon)
        fx = (x - m["xLeftM"]) / m["pixelM"] - 0.5
        fy = (m["yTopM"] - y) / m["pixelM"] - 0.5
        c0 = np.floor(fx).astype(np.int64)
        r0 = np.floor(fy).astype(np.int64)
        tx = fx - c0
        ty = fy - r0
        inside = (c0 >= 0) & (c0 + 1 < m["width"]) & (r0 >= 0) & (r0 + 1 < m["height"])
        arr = self._array(grid_id)
        c = np.where(inside, c0, 0)
        r = np.where(inside, r0, 0)
        q = [arr[r, c], arr[r, c + 1], arr[r + 1, c], arr[r + 1, c + 1]]
        nodata = (q[0] == NODATA) | (q[1] == NODATA) | (q[2] == NODATA) | (q[3] == NODATA)
        top = q[0] * (1.0 - tx) + q[1] * tx
        bottom = q[2] * (1.0 - tx) + q[3] * tx
        v = (top * (1.0 - ty) + bottom * ty) * m["scale"]
        return np.where(inside & ~nodata, v, np.nan)

    def cell_centres(self, grid_id: str, step: int = 1) -> tuple[np.ndarray, np.ndarray]:
        """Projected x, y (metres) of cell centres, every ``step`` cells: use with
        ``logic.projection.south_polar_latlon`` to sweep an area for candidate points."""
        m = self.meta(grid_id)
        xs = m["xLeftM"] + (np.arange(0, m["width"], step) + 0.5) * m["pixelM"]
        ys = m["yTopM"] - (np.arange(0, m["height"], step) + 0.5) * m["pixelM"]
        return np.meshgrid(xs, ys)
