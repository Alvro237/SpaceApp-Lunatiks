"""Finer height levels for the web tileset from the LOLA 80 m south-pole DEM (LDEM_80S_80MPP_ADJ, PGDA product 90).

Adds levels z = 4 .. 7 (cells of 480, 240, 120 and 60 m) to the preview pyramid built from the 960 m grids, only
where they add detail: the tiles whose parent reaches the DEM's coverage (south of about 80 S). The engine refines a
tile only when its four children exist, so the rest of the disc keeps the 960 m level.

Normalisation (docs/web-tileset.md):
1. The GeoTIFF must be the LOLA south polar stereographic projection on the 1737.4 km sphere, or the build stops.
2. The file's own scale and offset are applied; heights are metres above the 1737.4 km sphere.
3. Gaps (outside the DEM) take the 960 m level's value, never zeros.
4. Cells coarser than 80 m are area means of the DEM (blocks of 3 or 6 pixels) before bilinear sampling; the 60 m
   level samples the 80 m pixels bilinearly, so it shows the DEM's full detail and nothing finer.
5. Vertex positions come from global integer indices, so neighbouring tiles compute their shared edge identically.

Needs rasterio (pipeline environment): uv run --project ../pipeline python scripts/build_preview_tiles.py
"""
from __future__ import annotations

import math
from pathlib import Path

import numpy as np

FINE_LEVELS = (4, 5, 6, 7)
SOURCE_URL = "https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_80MPP_ADJ.TIF"


def load_dem(path: Path, sphere_m: float) -> dict:
    import rasterio  # only needed for the fine levels

    with rasterio.open(path) as ds:
        proj = ds.crs.to_proj4() if ds.crs else ""
        if "+proj=stere" not in proj or "+lat_0=-90" not in proj or str(int(sphere_m)) not in proj:
            raise ValueError(f"{path.name}: unexpected projection {proj!r}")
        a = ds.read(1, out_dtype="float32")
        nodata = ds.nodata
        scale = ds.scales[0] if ds.scales and ds.scales[0] else 1.0
        offset = ds.offsets[0] if ds.offsets and ds.offsets[0] else 0.0
        t = ds.transform
        if abs(t.b) > 1e-9 or abs(t.d) > 1e-9 or abs(abs(t.e) - t.a) > 1e-6:
            raise ValueError(f"{path.name}: rotated or non-square pixels")
        meta = {"x0": t.c, "ytop": t.f, "px": t.a, "width": ds.width, "height": ds.height, "crs": proj}
    if nodata is not None:
        a[a == nodata] = np.nan
    a = a * np.float32(scale) + np.float32(offset)
    med = float(np.nanmedian(np.abs(a)))
    if med < 50.0:                       # the product would be in kilometres
        raise ValueError(f"{path.name}: heights look like kilometres (median |h| = {med}); expected metres")
    meta["values"] = a
    return meta


def block_mean(a: np.ndarray, f: int) -> np.ndarray:
    if f == 1:
        return a
    h, w = (a.shape[0] // f) * f, (a.shape[1] // f) * f
    blocks = a[:h, :w].reshape(h // f, f, w // f, f)
    with np.errstate(invalid="ignore"):
        return np.nanmean(blocks, axis=(1, 3)).astype(np.float32)


def bilinear(values: np.ndarray, fx: np.ndarray, fy: np.ndarray) -> np.ndarray:
    """Sample a grid at fractional (column fx, row fy) given as 1-D vectors; outer product; NaN outside."""
    h, w = values.shape
    c0 = np.floor(fx).astype(int)
    r0 = np.floor(fy).astype(int)
    tx = (fx - c0)[None, :]
    ty = (fy - r0)[:, None]

    def take(r, c):
        ok = (r[:, None] >= 0) & (r[:, None] < h) & (c[None, :] >= 0) & (c[None, :] < w)
        out = np.full((r.size, c.size), np.nan, dtype=np.float64)
        out[ok] = values[np.clip(r, 0, h - 1)[:, None], np.clip(c, 0, w - 1)[None, :]][ok]
        return out

    return (take(r0, c0) * (1 - tx) * (1 - ty) + take(r0, c0 + 1) * tx * (1 - ty)
            + take(r0 + 1, c0) * (1 - tx) * ty + take(r0 + 1, c0 + 1) * tx * ty)


def rect_meets_disc(x0: float, y0: float, x1: float, y1: float, r: float) -> bool:
    dx = max(x0, 0.0, -x1) if not (x0 <= 0 <= x1) else 0.0
    dy = max(y0, 0.0, -y1) if not (y0 <= 0 <= y1) else 0.0
    return math.hypot(dx, dy) <= r


def add_fine_levels(dem_path: Path, coarse_vert: np.ndarray, half_extent: float, tile: int, sphere_m: float,
                    tiles_index: dict, out_dir: Path, pack_height, write_png) -> dict:
    """Write height tiles for FINE_LEVELS; `coarse_vert` is the finest existing vertex grid (fills the gaps)."""
    dem = load_dem(dem_path, sphere_m)
    px = dem["px"]
    # radius of the DEM's coverage around the pole (its valid pixels), from its own data
    valid = ~np.isnan(dem["values"])
    rows, cols = np.nonzero(valid[:: 16, :: 16])
    xs = dem["x0"] + (cols * 16 + 0.5) * px
    ys = dem["ytop"] - (rows * 16 + 0.5) * px
    cover_r = float(np.max(np.hypot(xs, ys)))

    smoothed: dict[int, np.ndarray] = {}
    n_coarse = coarse_vert.shape[0] - 1
    coarse_cell = 2 * half_extent / n_coarse
    written = {z: 0 for z in FINE_LEVELS}

    parents = {(3, tx, ty) for tx in range(8) for ty in range(8)}
    for z in FINE_LEVELS:
        cell = 2 * half_extent / (tile * 2 ** z)
        f = max(1, int(round(cell / px))) if cell > 1.25 * px else 1
        if f not in smoothed:
            smoothed[f] = block_mean(dem["values"], f)
        grid = smoothed[f]
        gpx = px * f
        size = 2 * half_extent / 2 ** (z - 1)
        next_parents = set()
        for (_, ptx, pty) in parents:
            pminx = -half_extent + ptx * size
            pmaxy = half_extent - pty * size
            if not rect_meets_disc(pminx, pmaxy - size, pminx + size, pmaxy, cover_r):
                continue
            for cx in (0, 1):
                for cy in (0, 1):
                    tx, ty = 2 * ptx + cx, 2 * pty + cy
                    i = np.arange(tile + 1) + tx * tile
                    j = np.arange(tile + 1) + ty * tile
                    X = -half_extent + i * cell
                    Y = half_extent - j * cell
                    fine = bilinear(grid, (X - dem["x0"]) / gpx - 0.5, (dem["ytop"] - Y) / gpx - 0.5)
                    coarse = bilinear(coarse_vert, (X + half_extent) / coarse_cell, (half_extent - Y) / coarse_cell)
                    block = np.where(np.isnan(fine), coarse, fine)
                    rgb, lo, hi = pack_height(block)
                    write_png(out_dir / "height" / str(z) / str(tx) / f"{ty}.png", rgb, 2)
                    tiles_index[f"{z}/{tx}/{ty}"] = [round(lo, 2), round(hi, 2)]
                    written[z] += 1
                    next_parents.add((z, tx, ty))
        parents = next_parents

    def height_at(x: float, y: float) -> float | None:
        """Height the finest fine level holds at a map point (for validation)."""
        g = smoothed[1]
        v = bilinear(g, np.array([(x - dem["x0"]) / px - 0.5]), np.array([(dem["ytop"] - y) / px - 0.5]))[0, 0]
        return None if np.isnan(v) else float(v)

    return {"written": written, "coverRadiusM": round(cover_r, 1), "pixelM": px, "crs": dem["crs"],
            "width": dem["width"], "height": dem["height"], "heightAt": height_at}
