"""Finer height levels for the web tileset from the LOLA 80 m south-pole DEM (LDEM_80S_80MPP_ADJ, PGDA product 90).

Adds levels z = 4 .. 7 (cells of 480, 240, 120 and 60 m) to the preview pyramid built from the 960 m grids, only
where they add detail: the four children of every tile that holds valid DEM pixels (the DEM is a 608 km square
around the pole, x and y within +-304 km, so it reaches 80 S on its axes and about 77.5 S in its corners). The
engine refines a tile only when its four children exist, so the rest of the disc keeps the 960 m level.

Normalisation (docs/web-tileset.md):
1. The GeoTIFF must be the LOLA south polar stereographic projection on the 1737.4 km sphere, or the build stops.
2. The file's own scale and offset are applied; heights are metres above the 1737.4 km sphere.
3. Gaps (outside the DEM) take the 960 m level's value, never zeros.
4. Cells coarser than 80 m are area means of the DEM (blocks of 6, 3 and 2 pixels for the 480, 240 and 120 m
   levels) before bilinear sampling; the 60 m level samples the 80 m pixels bilinearly, so it shows the DEM's full
   detail and nothing finer.
5. Vertex positions come from global integer indices, so neighbouring tiles compute their shared edge identically.

Needs rasterio (pipeline environment): uv run --project ../pipeline python scripts/build_preview_tiles.py
"""
from __future__ import annotations

from pathlib import Path

import numpy as np

FINE_LEVELS = (4, 5, 6, 7)
SOURCE_URL = "https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_80MPP_ADJ.TIF"


def load_dem(path: Path, sphere_m: float) -> dict:
    import rasterio  # only needed for the fine levels

    with rasterio.open(path) as ds:
        proj = ds.crs.to_proj4() if ds.crs else ""
        # LOLA's south polar stereographic on the IAU 2015 Moon sphere: +proj=stere +lat_0=-90 +lat_ts=-90
        # +lon_0=0 +x_0=0 +y_0=0 +R=1737400 +units=m
        expected = ("+proj=stere", "+lat_0=-90", "+lat_ts=-90", "+lon_0=0", "+x_0=0", "+y_0=0",
                    f"+R={int(sphere_m)}", "+units=m")
        if any(term not in proj.split() and term + ".0" not in proj.split() for term in expected):
            raise ValueError(f"{path.name}: unexpected projection {proj!r}")
        a = ds.read(1, out_dtype="float32")
        nodata = ds.nodata
        scale = ds.scales[0] if ds.scales and ds.scales[0] else 1.0
        offset = ds.offsets[0] if ds.offsets and ds.offsets[0] else 0.0
        t = ds.transform
        if abs(t.b) > 1e-9 or abs(t.d) > 1e-9 or abs(abs(t.e) - t.a) > 1e-6:
            raise ValueError(f"{path.name}: rotated or non-square pixels")
        meta = {"x0": t.c, "ytop": t.f, "px": t.a, "width": ds.width, "height": ds.height, "crs": proj}
    if nodata is not None and not np.isnan(nodata):   # this product declares NaN, which is already NaN
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


def rect_has_data(xs: np.ndarray, ys: np.ndarray, x0: float, y0: float, x1: float, y1: float) -> bool:
    """Whether any of the valid-pixel sample points (xs, ys) lies inside the rectangle."""
    return bool(np.any((xs >= x0) & (xs <= x1) & (ys >= y0) & (ys <= y1)))


def quantise(block: np.ndarray) -> np.ndarray:
    """What the browser decodes from a height tile (16 bits between the tile's min and max)."""
    lo, hi = float(block.min()), float(block.max())
    span = hi - lo if hi > lo else 1.0
    return lo + np.round((block - lo) / span * 65535.0) / 65535.0 * span


def add_fine_levels(dem_path: Path, coarse_vert: np.ndarray, half_extent: float, tile: int, sphere_m: float,
                    tiles_index: dict, out_dir: Path, pack_height, write_png) -> dict:
    """Write height tiles for FINE_LEVELS; `coarse_vert` is the finest existing vertex grid (fills the gaps)."""
    dem = load_dem(dem_path, sphere_m)
    px = dem["px"]
    # where the DEM has data: centres of every 8th valid pixel (640 m apart), from the file itself
    stride = 8
    valid = ~np.isnan(dem["values"])
    rows, cols = np.nonzero(valid[::stride, ::stride])
    xs = dem["x0"] + (cols * stride + 0.5) * px
    ys = dem["ytop"] - (rows * stride + 0.5) * px
    cover_r = float(np.max(np.hypot(xs, ys)))
    bounds = [float(xs.min()), float(ys.min()), float(xs.max()), float(ys.max())]
    margin = stride * px / 2

    smoothed: dict[int, np.ndarray] = {}
    factor: dict[int, int] = {}
    n_coarse = coarse_vert.shape[0] - 1
    coarse_cell = 2 * half_extent / n_coarse
    written = {z: 0 for z in FINE_LEVELS}
    from_dem = {z: 0 for z in FINE_LEVELS}       # tiles with at least one vertex taken from the DEM
    edge_mismatches = 0

    def tile_block(z: int, tx: int, ty: int) -> tuple[np.ndarray, bool]:
        """Heights at the (tile + 1)^2 vertices of tile (z, tx, ty); DEM where it has data, 960 m level elsewhere."""
        cell = 2 * half_extent / (tile * 2 ** z)
        grid, gpx = smoothed[factor[z]], px * factor[z]
        i = np.arange(tile + 1) + tx * tile
        j = np.arange(tile + 1) + ty * tile
        X = -half_extent + i * cell
        Y = half_extent - j * cell
        fine = bilinear(grid, (X - dem["x0"]) / gpx - 0.5, (dem["ytop"] - Y) / gpx - 0.5)
        gap = np.isnan(fine)
        if not gap.any():
            return fine, True
        coarse = bilinear(coarse_vert, (X + half_extent) / coarse_cell, (half_extent - Y) / coarse_cell)
        return np.where(gap, coarse, fine), not gap.all()

    parents = {(tx, ty) for tx in range(8) for ty in range(8)}          # z = 3
    for z in FINE_LEVELS:
        cell = 2 * half_extent / (tile * 2 ** z)
        f = max(1, int(round(cell / px))) if cell > 1.25 * px else 1
        factor[z] = f
        if f not in smoothed:
            smoothed[f] = block_mean(dem["values"], f)
        size = 2 * half_extent / 2 ** (z - 1)                           # parent tile side
        right: dict[tuple[int, int], np.ndarray] = {}
        bottom: dict[tuple[int, int], np.ndarray] = {}
        left: dict[tuple[int, int], np.ndarray] = {}
        top: dict[tuple[int, int], np.ndarray] = {}
        next_parents = set()
        for (ptx, pty) in sorted(parents):
            pminx = -half_extent + ptx * size
            pmaxy = half_extent - pty * size
            if not rect_has_data(xs, ys, pminx - margin, pmaxy - size - margin, pminx + size + margin, pmaxy + margin):
                continue
            for cx in (0, 1):
                for cy in (0, 1):
                    tx, ty = 2 * ptx + cx, 2 * pty + cy
                    block, has_dem = tile_block(z, tx, ty)
                    rgb, lo, hi = pack_height(block)
                    write_png(out_dir / "height" / str(z) / str(tx) / f"{ty}.png", rgb, 2)
                    tiles_index[f"{z}/{tx}/{ty}"] = [round(lo, 2), round(hi, 2)]
                    written[z] += 1
                    from_dem[z] += int(has_dem)
                    next_parents.add((tx, ty))
                    left[(tx, ty)], right[(tx, ty)] = block[:, 0].copy(), block[:, -1].copy()
                    top[(tx, ty)], bottom[(tx, ty)] = block[0].copy(), block[-1].copy()
        for (tx, ty), edge in right.items():                            # neighbours share identical edges
            if (tx + 1, ty) in left:
                edge_mismatches += int(np.count_nonzero(edge != left[(tx + 1, ty)]))
        for (tx, ty), edge in bottom.items():
            if (tx, ty + 1) in top:
                edge_mismatches += int(np.count_nonzero(edge != top[(tx, ty + 1)]))
        parents = next_parents
    finest_z = FINE_LEVELS[-1]
    finest_tiles = {tuple(map(int, k.split("/")[1:])) for k in tiles_index if k.startswith(f"{finest_z}/")}

    def height_at(x: float, y: float) -> tuple[float, int] | None:
        """Height the finest level's tile decodes to at a map point (quantisation included), for validation.
        None outside the DEM's data."""
        if np.isnan(bilinear(smoothed[1], np.array([(x - dem["x0"]) / px - 0.5]),
                             np.array([(dem["ytop"] - y) / px - 0.5]))[0, 0]):
            return None
        size = 2 * half_extent / 2 ** finest_z
        tx, ty = int((x + half_extent) // size), int((half_extent - y) // size)
        if (tx, ty) not in finest_tiles:
            return None
        decoded = quantise(tile_block(finest_z, tx, ty)[0])
        cell = size / tile
        fx = (x - (-half_extent + tx * size)) / cell
        fy = ((half_extent - ty * size) - y) / cell
        return float(bilinear(decoded, np.array([fx]), np.array([fy]))[0, 0]), finest_z

    return {"written": written, "fromDem": from_dem, "coverRadiusM": round(cover_r, 1),
            "boundsM": [round(b, 1) for b in bounds], "pixelM": px, "crs": dem["crs"],
            "width": dem["width"], "height": dem["height"], "smoothingPixels": {str(z): factor[z] for z in FINE_LEVELS},
            "sharedEdgeMismatches": edge_mismatches, "heightAt": height_at}
