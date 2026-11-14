"""Area search on a raster (mission mode): pure functions over NumPy arrays, no I/O.

The search paints which cells of a bounded region pass every filter the planner switched on, instead of testing
points one by one. It runs as a funnel so the expensive part stays small:

  1. static filters on every cell (slope, height, long-term light and Earth, shadow, sky, craters, past landings),
     each cell reduced from a sub-grid so a cell fails if any part of it fails (slope, shadow) or by its mean;
  2. the landing radius: a cell survives only if no failing cell lies within that radius (a disc dilation of the
     failures), so what is left is a place where a landing ellipse of that radius fits;
  3. mission-window filters (light, contact, blackout, Sun at landing...) on adaptive samples of the surviving
     cells (quadtree_samples: coarse tiles first, split where neighbours disagree), each sample with its own
     ray-traced horizon, its result shared by the cells of its tile;
  4. connected viable areas, ranked.

Codes per cell: 0 outside the region, 1 fails a static filter or the landing radius, 2 fails a window filter,
3 viable, 4 unknown (a filter has no data there and unknown does not pass).
"""
from __future__ import annotations

from collections import deque

import numpy as np

OUTSIDE, FAIL_STATIC, FAIL_WINDOW, VIABLE, UNKNOWN = 0, 1, 2, 3, 4


def disc(radius_cells: float) -> np.ndarray:
    """Boolean disc of the given radius in cells (always at least the centre cell)."""
    r = int(np.floor(max(0.0, radius_cells)))
    y, x = np.mgrid[-r:r + 1, -r:r + 1]
    return (x * x + y * y) <= radius_cells * radius_cells + 1e-9


def dilate(mask: np.ndarray, radius_cells: float) -> np.ndarray:
    """Cells within radius_cells of any True cell (disc dilation by FFT convolution; exact for 0/1 inputs)."""
    if radius_cells < 1.0 or not mask.any():
        return mask.copy()
    k = disc(radius_cells).astype(np.float64)
    ny, nx = mask.shape
    ky, kx = k.shape
    sy, sx = ny + ky - 1, nx + kx - 1
    f = np.fft.rfft2(mask.astype(np.float64), s=(sy, sx)) * np.fft.rfft2(k, s=(sy, sx))
    full = np.fft.irfft2(f, s=(sy, sx))
    oy, ox = ky // 2, kx // 2
    return full[oy:oy + ny, ox:ox + nx] > 0.5


def count_within(points: np.ndarray, radius_cells: float) -> np.ndarray:
    """Sum of a per-cell count over the disc around each cell (FFT convolution, rounded to integers)."""
    k = disc(radius_cells).astype(np.float64)
    ny, nx = points.shape
    ky, kx = k.shape
    sy, sx = ny + ky - 1, nx + kx - 1
    full = np.fft.irfft2(np.fft.rfft2(points.astype(np.float64), s=(sy, sx)) * np.fft.rfft2(k, s=(sy, sx)), s=(sy, sx))
    oy, ox = ky // 2, kx // 2
    return np.rint(full[oy:oy + ny, ox:ox + nx])


def label(mask: np.ndarray) -> tuple[np.ndarray, int]:
    """8-connected components of a boolean raster: labels 1..n (0 = background) and n."""
    labels = np.zeros(mask.shape, dtype=np.int32)
    ny, nx = mask.shape
    n = 0
    todo = deque()
    for i, j in zip(*np.nonzero(mask)):
        if labels[i, j]:
            continue
        n += 1
        labels[i, j] = n
        todo.append((i, j))
        while todo:
            a, b = todo.popleft()
            for da in (-1, 0, 1):
                for db in (-1, 0, 1):
                    c, d = a + da, b + db
                    if 0 <= c < ny and 0 <= d < nx and mask[c, d] and not labels[c, d]:
                        labels[c, d] = n
                        todo.append((c, d))
    return labels, n


# ---------------------------------------------------------------------------- adaptive window sampling

class Leaf:
    """A rectangle of cells [i0, i0 + h) x [j0, j0 + w) that shares the result of one sample cell."""
    __slots__ = ("i0", "j0", "h", "w", "sample")

    def __init__(self, i0: int, j0: int, h: int, w: int, sample: int):
        self.i0, self.j0, self.h, self.w, self.sample = i0, j0, h, w, sample

    @property
    def size(self) -> int:
        return max(self.h, self.w)


def _nearest_survivor(survivors: np.ndarray, i0: int, j0: int, h: int, w: int) -> tuple[int, int] | None:
    sub = survivors[i0:i0 + h, j0:j0 + w]
    ii, jj = np.nonzero(sub)
    if ii.size == 0:
        return None
    k = int(np.argmin((ii - (h - 1) / 2.0) ** 2 + (jj - (w - 1) / 2.0) ** 2))
    return i0 + int(ii[k]), j0 + int(jj[k])


def quadtree_samples(survivors: np.ndarray, evaluate, max_samples: int, proxies: tuple[np.ndarray, ...] = (),
                     proxy_tol: float = 0.1):
    """Adaptive sampling of an expensive per-cell test (the mission-window filters with a ray-traced horizon).

    Start with square tiles big enough that a quarter of the budget covers every tile holding survivors, one sample
    each (the survivor nearest the tile centre). Then split, largest first, every tile whose neighbourhood (the
    tile grown by one cell) holds survivors with a different pass/fail answer, into four, sampling the new parts,
    until the budget is spent or no tile on a boundary is larger than one cell. Boundaries of the painted areas
    end up at cell resolution where the budget allows; uniform interiors keep big tiles.

    proxies (optional, per cell, NaN = none): cheap maps that tend to change where the expensive answer changes
    (the long-term light and Earth maps for the window filters). A tile whose survivors span more than proxy_tol
    of any of them is split too once no boundary tile is left, so a small feature inside a big uniform tile is not
    hidden by its one sample when the budget allows.

    evaluate(rows, cols) -> (values: list, outcome: ints) for a batch of sample cells, outcome 1 pass, 0 fail,
    2 unknown (no data); a change of outcome between neighbours is a boundary.
    Returns (rows, cols, values, outcome, leaves, owner) with owner[i, j] = sample index of the cell (-1 = none).
    """
    ny, nx = survivors.shape
    if not survivors.any():
        return np.zeros(0, int), np.zeros(0, int), [], np.zeros(0, np.int8), [], np.full(survivors.shape, -1)
    budget = max(1, int(max_samples))
    tile = 1
    while True:
        bi, bj = np.nonzero(survivors)
        if np.unique((bi // tile) * ((nx + tile - 1) // tile) + bj // tile).size <= max(1, budget // 4) or tile > max(ny, nx):
            break
        tile *= 2
    rows: list[int] = []
    cols: list[int] = []
    values: list = []
    passes: list[int] = []
    leaves: list[Leaf] = []
    pending: list[tuple[Leaf, tuple[int, int]]] = []
    for i0 in range(0, ny, tile):
        for j0 in range(0, nx, tile):
            h, w = min(tile, ny - i0), min(tile, nx - j0)
            rc = _nearest_survivor(survivors, i0, j0, h, w)
            if rc is not None:
                pending.append((Leaf(i0, j0, h, w, -1), rc))

    def run(batch: list[tuple[Leaf, tuple[int, int]]]) -> None:
        if not batch:
            return
        r = np.array([rc[0] for _, rc in batch])
        c = np.array([rc[1] for _, rc in batch])
        v, p = evaluate(r, c)
        for (leaf, rc), vi, pi in zip(batch, v, p):
            leaf.sample = len(rows)
            rows.append(rc[0])
            cols.append(rc[1])
            values.append(vi)
            passes.append(int(pi))
            leaves.append(leaf)

    run(pending)
    while len(rows) < budget:
        owner = _owner(survivors.shape, leaves)
        pmap = np.where(owner >= 0, np.asarray(passes, dtype=np.int8)[np.maximum(owner, 0)], -1)
        edge = []
        for leaf in leaves:
            if leaf.size <= 1:
                continue
            a0, b0 = max(0, leaf.i0 - 1), max(0, leaf.j0 - 1)
            box = pmap[a0:leaf.i0 + leaf.h + 1, b0:leaf.j0 + leaf.w + 1]
            box = box[box >= 0]
            if box.size and box.min() != box.max():
                edge.append((0, leaf))
                continue
            sl = (slice(leaf.i0, leaf.i0 + leaf.h), slice(leaf.j0, leaf.j0 + leaf.w))
            for pmap_k in proxies:
                pv = pmap_k[sl][survivors[sl]]
                pv = pv[~np.isnan(pv)]
                if pv.size and pv.max() - pv.min() > proxy_tol:
                    edge.append((1, leaf))
                    break
        if not edge:
            break
        # boundaries first, largest first; proxy splits only once no boundary tile is left to refine (measured on
        # a 40 km region: spending part of each round on proxy splits lowered the agreement with a dense reference)
        kind = 0 if any(k == 0 for k, _ in edge) else 1
        edge = sorted((lf for k, lf in edge if k == kind), key=lambda lf: -lf.size)
        batch: list[tuple[Leaf, tuple[int, int]]] = []
        new_leaves: list[Leaf] = []
        spent = len(rows)
        split: set[int] = set()
        for leaf in edge:
            parts = []
            h1, w1 = (leaf.h + 1) // 2, (leaf.w + 1) // 2
            for di, hh in ((0, h1), (h1, leaf.h - h1)):
                for dj, ww in ((0, w1), (w1, leaf.w - w1)):
                    if hh > 0 and ww > 0:
                        parts.append((leaf.i0 + di, leaf.j0 + dj, hh, ww))
            pr, pc = rows[leaf.sample], cols[leaf.sample]
            todo = []
            keep = []
            for i0, j0, hh, ww in parts:
                if i0 <= pr < i0 + hh and j0 <= pc < j0 + ww:
                    keep.append(Leaf(i0, j0, hh, ww, leaf.sample))
                else:
                    rc = _nearest_survivor(survivors, i0, j0, hh, ww)
                    if rc is not None:
                        todo.append((Leaf(i0, j0, hh, ww, -1), rc))
            if spent + len(batch) + len(todo) > budget:
                break
            split.add(id(leaf))
            new_leaves.extend(keep)
            batch.extend(todo)
        if not split:
            break
        leaves[:] = [lf for lf in leaves if id(lf) not in split] + new_leaves
        run(batch)
    owner = _owner(survivors.shape, leaves)
    owner = np.where(survivors, owner, -1)
    return (np.asarray(rows, dtype=np.int64), np.asarray(cols, dtype=np.int64), values,
            np.asarray(passes, dtype=np.int8), leaves, owner)


def _owner(shape: tuple[int, int], leaves: list[Leaf]) -> np.ndarray:
    owner = np.full(shape, -1, dtype=np.int64)
    for lf in leaves:
        owner[lf.i0:lf.i0 + lf.h, lf.j0:lf.j0 + lf.w] = lf.sample
    return owner
