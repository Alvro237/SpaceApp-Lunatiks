"""Preview terrain tileset for the web terrain engine, built from the screening grids committed in data/grids.

The full-resolution tileset (LOLA 240 m, 80 m and 20 m DEMs) is produced by pipeline/lunarnav/terrain_tiles.py
(AERO-1). Until it exists, this script writes a tileset with the same contract (docs/web-tileset.md) from the
960 m LOLA grids already in the repository, so the engine, the layers and the shadows run today and the fine
tiles only add levels. Nothing here is new physics: it resamples and packs NASA data.

Run from web/ (writes web/public/tiles, git-ignored):

    uv run --project ../pipeline python scripts/build_preview_tiles.py

Normalisation (the plan's steps, as far as the 960 m grids need them):
1. Check every grid declares the same south polar stereographic projection on the 1737.4 km sphere.
2. Heights are already metres above the 1737.4 km sphere (the API's datum); nothing to convert.
3. No-data cells are filled from the next coarser level of the pyramid, never with zeros.
4. One source product per layer, so there is no seam between products to blend.
5. Coarser levels are area means of 2 x 2 cells; the 65 S grids (half a cell offset) are resampled bilinearly.
6. Each height tile is normalised to 0..1 with its own minimum and maximum (stored in tileset.json):
   height = min + value x (max - min), 16 bits packed in the red (high byte) and green (low byte) channels.
7. Validation: tile height at each catalogue site with terrain against its groundHeightM, and equality of the
   shared edges of neighbouring tiles. Results are written into tileset.json, not asserted from memory.
"""
from __future__ import annotations

import json
import math
import struct
import sys
import zlib
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
OUT = ROOT / "web" / "public" / "tiles"

R_M = 1737400.0
TILE = 256                      # cells per tile side; 257 vertex samples, the edge is shared with the neighbour
LEVELS = 4                      # z = 0 .. 3; z = 3 is the native 960 m cell of the source grids
CELL_FINEST_M = 960.0
HALF_EXTENT_M = CELL_FINEST_M * TILE * 2 ** (LEVELS - 1) / 2    # 983 040 m: the whole cap south of 60 S
DISC_LAT = -60.0                # the map is drawn as the disc south of this latitude (the grids' coverage)
NODATA = -32768

HEIGHT_GRID = "lola_elevation_60s"
DEM80 = ROOT / "data" / "raw" / "dem_full" / "LDEM_80S_80MPP_ADJ.TIF"   # optional, 189 MB from PGDA
LAYERS = {
    # layer id: (grid id, display name, colour map) -- colour maps are colour-blind safe (see the plan)
    "slope": ("lola_slope_60s", "Slope", "magma"),
    "sun_illumination": ("sun_illumination_65s", "Mean sunlight (18.6-year average)", "inferno"),
    "earth_visibility": ("earth_visibility_65s", "Mean Earth visibility (18.6-year average)", "viridis"),
    "permanent_shadow": ("permanent_shadow_65s", "Permanent shadow (fraction of cell)", "cividis"),
}


# ------------------------------------------------------------------------------------------------ PNG

def _chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)


def write_png(path: Path, pixels: np.ndarray, color_type: int) -> None:
    """8-bit PNG, filter 0 on every row. color_type 2 = RGB (h, w, 3), 4 = grey + alpha (h, w, 2).
    No gamma or colour-space chunk: the browser decoder reads the bytes exactly."""
    h, w = pixels.shape[:2]
    raw = np.concatenate([np.zeros((h, 1), dtype=np.uint8), pixels.reshape(h, -1).astype(np.uint8)], axis=1)
    png = b"\x89PNG\r\n\x1a\n" + _chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, color_type, 0, 0, 0))
    png += _chunk(b"IDAT", zlib.compress(raw.tobytes(), 9)) + _chunk(b"IEND", b"")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)


def pack_height(values: np.ndarray) -> tuple[np.ndarray, float, float]:
    lo, hi = float(values.min()), float(values.max())
    span = hi - lo if hi > lo else 1.0
    q = np.round((values - lo) / span * 65535.0).astype(np.uint16)
    rgb = np.zeros(values.shape + (3,), dtype=np.uint8)
    rgb[..., 0] = q >> 8
    rgb[..., 1] = q & 0xFF
    return rgb, lo, hi


def unpack_height(rgb: np.ndarray, lo: float, hi: float) -> np.ndarray:
    q = rgb[..., 0].astype(np.float64) * 256.0 + rgb[..., 1]
    return lo + q / 65535.0 * (hi - lo)


# ------------------------------------------------------------------------------------------------ grids

def load_grid(index: dict, grid_id: str) -> tuple[dict, np.ndarray]:
    meta = index["grids"][grid_id]
    raw = np.load(DATA / "grids" / meta["file"])["values"]
    values = np.where(raw == NODATA, np.nan, raw.astype(np.float64) * meta["scale"])
    return meta, values


def resample_to_finest(meta: dict, values: np.ndarray) -> np.ndarray:
    """Bilinear sample of a cell-centred grid at the cell centres of the finest pyramid level.
    NaN where the source has no data or does not cover the point."""
    n = TILE * 2 ** (LEVELS - 1)
    xs = -HALF_EXTENT_M + (np.arange(n) + 0.5) * CELL_FINEST_M      # column centres, west to east
    ys = HALF_EXTENT_M - (np.arange(n) + 0.5) * CELL_FINEST_M       # row centres, top (max y) first
    fx = (xs - meta["xLeftM"]) / meta["pixelM"] - 0.5               # fractional source column of each target x
    fy = (meta["yTopM"] - ys) / meta["pixelM"] - 0.5                # fractional source row of each target y
    c0 = np.floor(fx).astype(int)
    r0 = np.floor(fy).astype(int)
    tx, ty = fx - c0, fy - r0
    h, w = values.shape

    def take(r, c):
        ok = (r[:, None] >= 0) & (r[:, None] < h) & (c[None, :] >= 0) & (c[None, :] < w)
        out = np.full((r.size, c.size), np.nan)
        rr = np.clip(r, 0, h - 1)[:, None]
        cc = np.clip(c, 0, w - 1)[None, :]
        out[ok] = values[rr, cc][ok]
        return out

    v00, v01 = take(r0, c0), take(r0, c0 + 1)
    v10, v11 = take(r0 + 1, c0), take(r0 + 1, c0 + 1)
    wx, wy = tx[None, :], ty[:, None]
    return (v00 * (1 - wx) * (1 - wy) + v01 * wx * (1 - wy) + v10 * (1 - wx) * wy + v11 * wx * wy)


def block_mean(cells: np.ndarray) -> np.ndarray:
    """2 x 2 area mean ignoring NaN; NaN only where all four are missing."""
    n = cells.shape[0] // 2
    blocks = cells.reshape(n, 2, n, 2)
    count = np.sum(~np.isnan(blocks), axis=(1, 3))
    total = np.nansum(blocks, axis=(1, 3))
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(count > 0, total / np.maximum(count, 1), np.nan)


def pyramid(finest: np.ndarray) -> list[np.ndarray]:
    """Cell grids for z = 0 .. LEVELS-1, coarsest first; holes in a level are filled from the coarser one."""
    levels = [finest]
    for _ in range(LEVELS - 1):
        levels.insert(0, block_mean(levels[0]))
    for z in range(1, LEVELS):                      # step 3: gaps take the coarser level's value
        coarse_up = np.kron(levels[z - 1], np.ones((2, 2)))
        levels[z] = np.where(np.isnan(levels[z]), coarse_up, levels[z])
    return levels


def vertices(cells: np.ndarray) -> np.ndarray:
    """Values at cell corners (n + 1)^2: mean of the up to four cells that touch each corner."""
    p = np.pad(cells, 1, mode="edge")
    return (p[:-1, :-1] + p[:-1, 1:] + p[1:, :-1] + p[1:, 1:]) / 4.0


def polar_xy(lat: float, lon: float) -> tuple[float, float]:
    r = 2.0 * R_M * math.tan(math.radians(90.0 + lat) / 2.0)
    return r * math.sin(math.radians(lon)), r * math.cos(math.radians(lon))


# ------------------------------------------------------------------------------------------------ build

def main() -> int:
    index = json.loads((DATA / "grids" / "grids.json").read_text(encoding="utf-8"))
    projection = index.get("projection", "")
    if "stereographic" not in str(projection).lower() or "1737" not in str(projection):     # step 1
        print(f"unexpected projection in grids.json: {projection!r}", file=sys.stderr)
        return 1

    tiles_index: dict[str, list[float]] = {}
    height_meta, height_src = load_grid(index, HEIGHT_GRID)
    finest = resample_to_finest(height_meta, height_src)
    # The square extent reaches past the grid (60 S) in its corners. Those cells lie outside the map's disc and
    # are never drawn; they repeat the nearest edge value so that no tile holds a gap or a made-up zero.
    inside = ~np.isnan(finest)
    if not inside.any():
        print("the height grid does not cover the tileset extent", file=sys.stderr)
        return 1
    rows, cols = np.where(inside)
    r0, r1, c0, c1 = rows.min(), rows.max(), cols.min(), cols.max()
    core = finest[r0:r1 + 1, c0:c1 + 1]
    if np.isnan(core).any():
        print("the height grid has gaps inside its coverage", file=sys.stderr)
        return 1
    finest = np.pad(core, ((r0, finest.shape[0] - 1 - r1), (c0, finest.shape[1] - 1 - c1)), mode="edge")
    h_levels = pyramid(finest)

    vert_levels = []
    for z, cells in enumerate(h_levels):
        vert = vertices(cells)
        vert_levels.append(vert)
        for ty in range(2 ** z):
            for tx in range(2 ** z):
                block = vert[ty * TILE: ty * TILE + TILE + 1, tx * TILE: tx * TILE + TILE + 1]
                rgb, lo, hi = pack_height(block)
                write_png(OUT / "height" / str(z) / str(tx) / f"{ty}.png", rgb, 2)
                tiles_index[f"{z}/{tx}/{ty}"] = [round(lo, 2), round(hi, 2)]

    # Overview for the shadow pass: the finest level as one image (1025 x 1025 vertices).
    top = vert_levels[-1]
    rgb, olo, ohi = pack_height(top)
    write_png(OUT / "overview.png", rgb, 2)

    # Finer levels from the LOLA 80 m DEM around the pole, when it has been downloaded (fine_levels.py).
    fine = None
    if DEM80.exists():
        from fine_levels import SOURCE_URL, add_fine_levels
        fine = add_fine_levels(DEM80, top, HALF_EXTENT_M, TILE, R_M, tiles_index, OUT, pack_height, write_png)
        fine["sourceUrl"] = SOURCE_URL
        print(f"80 m DEM: added {sum(fine['written'].values())} tiles {fine['written']}, coverage radius {fine['coverRadiusM'] / 1000:.0f} km")
    else:
        print(f"no {DEM80.relative_to(ROOT)}: preview levels only (download it to add the 480-60 m levels)")
    max_z = max(int(k.split("/")[0]) for k in tiles_index)

    layers_out = {}
    for layer_id, (grid_id, name, cmap) in LAYERS.items():
        meta, src = load_grid(index, grid_id)
        levels = pyramid(resample_to_finest(meta, src))
        lo, hi = float(meta["min"]), float(meta["max"])
        for z, cells in enumerate(levels):
            for ty in range(2 ** z):
                for tx in range(2 ** z):
                    block = cells[ty * TILE:(ty + 1) * TILE, tx * TILE:(tx + 1) * TILE]
                    la = np.zeros((TILE, TILE, 2), dtype=np.uint8)
                    ok = ~np.isnan(block)
                    la[..., 0] = np.where(ok, np.round((np.nan_to_num(block) - lo) / (hi - lo) * 255.0), 0).clip(0, 255)
                    la[..., 1] = np.where(ok, 255, 0)
                    write_png(OUT / "layers" / layer_id / str(z) / str(tx) / f"{ty}.png", la, 4)
        layers_out[layer_id] = {
            "name": name, "unit": meta["unit"], "min": lo, "max": hi, "colormap": cmap, "levels": LEVELS,
            "encoding": "8-bit grey + alpha PNG per tile, 256 x 256 cells; value = min + grey / 255 x (max - min); alpha 0 = no data",
            "description": meta["description"], "source": meta["source"], "cellM": meta["pixelM"],
            "sourcePixelM": meta.get("sourcePixelM"),
        }

    # Step 7: validation, measured and stored.
    sites = json.loads((DATA / "sites.json").read_text(encoding="utf-8"))["sites"]
    checks = []
    n = top.shape[0] - 1
    cell = 2 * HALF_EXTENT_M / n
    for s in sites:
        terrain = s.get("terrain", {})
        if not terrain.get("available"):
            continue
        x, y = polar_xy(s["lat"], s["lon"])
        fx, fy = (x + HALF_EXTENT_M) / cell, (HALF_EXTENT_M - y) / cell
        if not (0 <= fx < n and 0 <= fy < n):
            continue
        c, r = int(fx), int(fy)
        u, v = fx - c, fy - r
        tile_h = (top[r, c] * (1 - u) * (1 - v) + top[r, c + 1] * u * (1 - v)
                  + top[r + 1, c] * (1 - u) * v + top[r + 1, c + 1] * u * v)
        level = "960 m"
        if fine is not None and (h80 := fine["heightAt"](x, y)) is not None:
            tile_h, level = h80, "80 m DEM"
        checks.append({"site": s["id"], "catalogueGroundM": terrain["groundHeightM"], "finestLevel": level,
                       "tileM": round(float(tile_h), 1), "differenceM": round(float(tile_h) - terrain["groundHeightM"], 1)})
    edge_errors = 0
    for z, vert in enumerate(vert_levels):           # decoded neighbours must share identical edges
        for ty in range(2 ** z):
            for tx in range(2 ** z - 1):
                a = vert[ty * TILE: ty * TILE + TILE + 1, tx * TILE + TILE]
                b = vert[ty * TILE: ty * TILE + TILE + 1, (tx + 1) * TILE]
                edge_errors += int(np.count_nonzero(a != b))
    quantisation_m = max(hi - lo for lo, hi in tiles_index.values()) / 65535.0

    doc = {
        "format": 1,
        "kind": "preview",
        "note": ("Levels 0-3 from the 960 m screening grids in data/grids; levels 4-7 (480 to 60 m cells) from the "
                 "LOLA 80 m DEM south of about 80 S when it was available to the build."),
        "projection": {"name": "south polar stereographic", "sphereRadiusM": R_M, "frame": "MOON_ME",
                       "formula": "x = r sin(lon), y = r cos(lon), r = 2R tan((90 + lat) / 2)"},
        "extentM": [-HALF_EXTENT_M, -HALF_EXTENT_M, HALF_EXTENT_M, HALF_EXTENT_M],
        "discLatDeg": DISC_LAT,
        "discRadiusM": round(2.0 * R_M * math.tan(math.radians(90.0 + DISC_LAT) / 2.0), 1),
        "tileCells": TILE,
        "tileSamples": TILE + 1,
        "levels": [{"z": z, "tiles": 2 ** z, "cellM": 2 * HALF_EXTENT_M / (TILE * 2 ** z)} for z in range(max_z + 1)],
        "height": {
            "path": "height/{z}/{x}/{y}.png",
            "encoding": "RGB PNG, 16-bit value in red (high byte) and green (low byte); height = min + value / 65535 x (max - min), metres above the 1737.4 km sphere",
            "tiles": tiles_index,
            "sources": [{"id": HEIGHT_GRID, "description": height_meta["description"], "source": height_meta["source"],
                         "cellM": height_meta["pixelM"], "sourcePixelM": height_meta.get("sourcePixelM"),
                         "builtUtc": height_meta.get("builtUtc"), "levels": list(range(LEVELS))}]
            + ([{"id": "LDEM_80S_80MPP_ADJ", "description": "LOLA DEM south of about 80 S, 80 m pixels",
                 "source": {"agency": "NASA GSFC PGDA (LRO / LOLA)", "url": fine["sourceUrl"],
                            "product": "https://pgda.gsfc.nasa.gov/products/90"},
                 "cellM": fine["pixelM"], "levels": sorted(fine["written"]), "coverRadiusM": fine["coverRadiusM"],
                 "tilesPerLevel": {str(k): v for k, v in fine["written"].items()}}] if fine else []),
        },
        "overview": {"path": "overview.png", "samples": n + 1, "min": round(olo, 2), "max": round(ohi, 2),
                     "encoding": "same as height tiles; the finest level as one image, for the shadow pass"},
        "layers": layers_out,
        "validation": {
            "siteHeights": checks,
            "maxAbsSiteDifferenceM": max((abs(c["differenceM"]) for c in checks), default=None),
            "sharedEdgeMismatches": edge_errors,
            "maxQuantisationM": round(quantisation_m, 3),
            "note": ("Catalogue groundHeightM comes from the finest DEM at each site (down to 10 m). Sites inside the "
                     "80 m DEM are checked against it; elsewhere against the 960 m cell means, where tens of metres "
                     "of difference are expected on slopes."),
        },
        "builtUtc": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "builtBy": "web/scripts/build_preview_tiles.py",
    }
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "tileset.json").write_text(json.dumps(doc, indent=1), encoding="utf-8")
    total = sum(p.stat().st_size for p in OUT.rglob("*") if p.is_file())
    print(f"wrote {len(tiles_index)} height tiles, {len(layers_out)} layers, {total / 1e6:.1f} MB to {OUT}")
    print(f"site height check: max |difference| {doc['validation']['maxAbsSiteDifferenceM']} m; "
          f"shared-edge mismatches {edge_errors}; quantisation {quantisation_m:.3f} m")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
