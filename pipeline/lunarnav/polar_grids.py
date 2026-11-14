"""Coarse south-polar screening grids for the API's hard filters.

Why: the catalogue has exact terrain horizons for a handful of sites, but mission filters also need
values anywhere near the pole (slope, long-term illumination, Earth visibility, permanent shadow,
sky view). These grids are averages of NASA products, small enough to commit and load in memory.

Sources
  * LOLA slope / elevation (Barker et al.), PGDA product 90: read remotely from the overview
    (pre-averaged) levels of the Cloud-Optimized GeoTIFFs, no full download.
  * LOLA elevation of the cap south of 80 S at the full 240 m resolution (mode "window": only the blocks of
    that box are read): the near field of the API's ray-traced horizons for manual coordinates.
  * LOLA-derived illumination, Earth visibility, permanent shadow and sky visibility
    (Mazarico et al. 2011), PGDA product 69: plain GeoTIFFs downloaded once into
    ``data/raw/illumination`` and block-averaged here.

All grids share the LOLA south polar stereographic projection (true scale at the pole,
R = 1737.4 km, MOON_ME). Values are stored as int16 = round(value / scale), nodata -32768.
A coarser slope cell is a smoothed value of the slope at the SOURCE baseline, not the slope of
the smoothed terrain; ``grids.json`` records the source pixel so nobody mistakes one for the other.

Run:  uv run python -m lunarnav.polar_grids [grid_id ...]
"""
from __future__ import annotations

import json
import sys
import time
from datetime import datetime, timezone

import numpy as np
import rasterio
import requests
from rasterio.windows import Window

from .config import DATA_DIR, GRID_DIR, PGDA_ILLUMINATION_BASE, PGDA_LOLA_BASE
from .dem import GDAL_OPTIONS

NODATA = -32768
ILLUM_DIR = DATA_DIR / "illumination"
STRIP_ROWS = 256
ATTEMPTS = 8

# id -> spec. ``mode`` is "overview" (remote COG overview level), "window" (full resolution inside a box,
# remote) or "local" (downloaded file).
GRIDS: dict[str, dict] = {
    "lola_elevation_80s": {
        "mode": "window", "url": f"{PGDA_LOLA_BASE}/LDEM_60S_240MPP_ADJ.TIF", "half_width_m": 304_000.0,
        "unit": "m", "scale": 0.5, "product": "https://pgda.gsfc.nasa.gov/products/90",
        "description": "LOLA elevation above the 1737.4 km sphere at the full 240 m resolution, south of about "
                       "80 S (a 608 km box centred on the pole); near field of ray-traced horizons",
    },
    "lola_slope_60s": {
        "mode": "overview", "url": f"{PGDA_LOLA_BASE}/LDSM_60S_240MPP_ADJ.TIF", "factor": 4,
        "unit": "deg", "scale": 0.01, "clip_min": 0.0, "product": "https://pgda.gsfc.nasa.gov/products/90",
        "description": "Mean LOLA surface slope (240 m source pixels) south of 60 S",
    },
    "lola_elevation_60s": {
        "mode": "overview", "url": f"{PGDA_LOLA_BASE}/LDEM_60S_240MPP_ADJ.TIF", "factor": 4,
        "unit": "m", "scale": 0.5, "product": "https://pgda.gsfc.nasa.gov/products/90",
        "description": "Mean LOLA height above the 1737.4 km sphere south of 60 S",
    },
    "lola_slope_80s": {
        "mode": "overview", "url": f"{PGDA_LOLA_BASE}/LDSM_80S_80MPP_ADJ.TIF", "factor": 4,
        "unit": "deg", "scale": 0.01, "clip_min": 0.0, "product": "https://pgda.gsfc.nasa.gov/products/90",
        "description": "Mean LOLA surface slope (80 m source pixels) south of 80 S",
    },
    "sun_illumination_65s": {
        "mode": "local", "file": "AVGVISIB_65S_240M_201608.TIF", "factor": 4, "unit": "fraction", "scale": 0.0001,
        "product": "https://pgda.gsfc.nasa.gov/products/69",
        "description": "Average solar illumination over an 18.6-year lunar nutation cycle, south of 65 S",
    },
    "earth_visibility_65s": {
        "mode": "local", "file": "AVGVISIB_65S_240M_201608_EARTH.TIF", "factor": 4, "unit": "fraction", "scale": 0.0001,
        "product": "https://pgda.gsfc.nasa.gov/products/69",
        "description": "Average Earth visibility over 18.6 years (any part of the disc visible), south of 65 S",
    },
    "permanent_shadow_65s": {
        "mode": "local", "file": "LPSR_65S_240M_201608.TIF", "factor": 4, "unit": "fraction", "scale": 0.0001,
        "product": "https://pgda.gsfc.nasa.gov/products/69",
        "description": "Permanently shadowed regions, fraction of the cell, south of 65 S",
    },
    "sky_visibility_65s": {
        "mode": "local", "file": "SKYV_65S_240M.TIF", "factor": 4, "unit": "sr", "scale": 0.001,
        "product": "https://pgda.gsfc.nasa.gov/products/69",
        "description": "Sky visibility: solid angle of sky not obscured by topography, steradians (a flat plain sees 2 pi), south of 65 S",
    },
}


def _open_meta(path: str, **kw) -> dict:
    with rasterio.Env(**GDAL_OPTIONS):
        with rasterio.open(path, **kw) as ds:
            return {"width": ds.width, "height": ds.height, "transform": ds.transform, "crs": ds.crs.to_proj4(),
                    "nodata": ds.nodata, "dtype": ds.dtypes[0], "scale": ds.scales[0], "offset": ds.offsets[0],
                    "tags": ds.tags(1)}


def _read_strip(path: str, strip: Window, **kw) -> np.ndarray:
    last: Exception | None = None
    for attempt in range(ATTEMPTS):
        try:
            with rasterio.Env(**GDAL_OPTIONS):
                with rasterio.open(path, **kw) as ds:
                    return ds.read(1, window=strip).astype(np.float32)
        except Exception as exc:  # truncated HTTP ranges, timeouts
            last = exc
            time.sleep(min(30, 2 * (attempt + 1)))
    raise RuntimeError(f"could not read {path} rows {strip.row_off}+{strip.height}") from last


def read_overview(url: str, factor: int) -> tuple[np.ndarray, dict]:
    """Read the pre-averaged overview whose decimation is ``factor`` (2, 4, 8, ...)."""
    path = f"/vsicurl/{url}"
    with rasterio.Env(**GDAL_OPTIONS):
        with rasterio.open(path) as ds:
            level = ds.overviews(1).index(factor)
            full_px = ds.res[0]
    meta = _open_meta(path, overview_level=level)
    rows = []
    for r0 in range(0, meta["height"], STRIP_ROWS):
        h = min(STRIP_ROWS, meta["height"] - r0)
        rows.append(_read_strip(path, Window(0, r0, meta["width"], h), overview_level=level))
        print(f"  rows {r0 + h}/{meta['height']}", flush=True)
    meta["source_pixel_m"] = full_px
    return np.vstack(rows), meta


def read_box(url: str, half_width_m: float) -> tuple[np.ndarray, dict]:
    """Read the full-resolution pixels of a square box centred on the pole; only the blocks it touches."""
    path = f"/vsicurl/{url}"
    meta = _open_meta(path)
    t = meta["transform"]
    c0 = int(np.floor((-half_width_m - t.c) / t.a))
    c1 = int(np.ceil((half_width_m - t.c) / t.a))
    r0 = int(np.floor((t.f - half_width_m) / -t.e))
    r1 = int(np.ceil((t.f + half_width_m) / -t.e))
    rows = []
    for r in range(r0, r1, STRIP_ROWS):
        h = min(STRIP_ROWS, r1 - r)
        rows.append(_read_strip(path, Window(c0, r, c1 - c0, h)))
        print(f"  rows {r + h - r0}/{r1 - r0}", flush=True)
    a = np.vstack(rows)
    if meta["nodata"] is not None and np.isfinite(meta["nodata"]):
        a[a == meta["nodata"]] = np.nan
    a = a * (meta["scale"] or 1.0) + (meta["offset"] or 0.0)
    meta["source_pixel_m"] = t.a
    meta["transform"] = t * t.translation(c0, r0)
    meta["height"], meta["width"] = a.shape
    return a, meta


def block_mean(a: np.ndarray, factor: int) -> np.ndarray:
    """Mean over factor x factor blocks ignoring NaN; a block with no valid sample stays NaN."""
    h, w = (a.shape[0] // factor) * factor, (a.shape[1] // factor) * factor
    b = a[:h, :w].reshape(h // factor, factor, w // factor, factor)
    valid = np.isfinite(b)
    total = np.where(valid, b, 0.0).sum(axis=(1, 3))
    count = valid.sum(axis=(1, 3))
    return np.where(count > 0, total / np.maximum(count, 1), np.nan).astype(np.float32)


def read_local(file: str, factor: int) -> tuple[np.ndarray, dict]:
    path = str(ILLUM_DIR / file)
    meta = _open_meta(path)
    with rasterio.open(path) as ds:
        a = ds.read(1).astype(np.float32)
        px = ds.res[0]
    if meta["nodata"] is not None and np.isfinite(meta["nodata"]):
        a[a == meta["nodata"]] = np.nan
    a = a * (meta["scale"] or 1.0) + (meta["offset"] or 0.0)
    out = block_mean(a, factor)
    meta["source_pixel_m"] = px
    meta["transform"] = meta["transform"] * meta["transform"].scale(factor, factor)
    meta["height"], meta["width"] = out.shape
    return out, meta


def _head(url: str) -> dict:
    try:
        r = requests.head(url, timeout=60, allow_redirects=True)
        return {"bytes": int(r.headers.get("Content-Length", 0)) or None,
                "serverLastModified": r.headers.get("Last-Modified")}
    except requests.RequestException:
        return {"bytes": None, "serverLastModified": None}


def build(only: list[str] | None = None) -> None:
    GRID_DIR.mkdir(parents=True, exist_ok=True)
    index_path = GRID_DIR / "grids.json"
    index = json.loads(index_path.read_text(encoding="utf-8")) if index_path.exists() else {"format": 1, "grids": {}}
    index.update({
        "projection": "south polar stereographic, true scale at the pole, R = 1737400 m, MOON_ME; "
                      "x = r sin(lon), y = r cos(lon), r = 2R tan((90 + lat)/2)",
        "encoding": "npz with one int16 array 'values' [row][col]; value = raw * scale; raw -32768 = no data; "
                    "row 0 is the top (y = yTopM), column 0 is the left (x = xLeftM)",
    })
    for gid, spec in GRIDS.items():
        if only and gid not in only:
            continue
        print(gid, flush=True)
        if spec["mode"] == "window":
            values, meta = read_box(spec["url"], spec["half_width_m"])
            url, unit, scale = spec["url"], spec["unit"], spec["scale"]
            aggregation = "none: the source pixels inside the box"
        elif spec["mode"] == "overview":
            values, meta = read_overview(spec["url"], spec["factor"])
            url, unit, scale = spec["url"], spec["unit"], spec["scale"]
            # The producer's overviews are not plain means (the slope overview dips slightly below 0),
            # so quantities that cannot be negative are clipped and the index says how it was built.
            if spec.get("clip_min") is not None:
                values = np.where(np.isfinite(values), np.maximum(values, spec["clip_min"]), values)
            aggregation = (f"COG overview at decimation {spec['factor']} as published by the producer "
                           "(smoothing resampling, not a plain mean"
                           + ("; values below 0 clipped to 0)" if spec.get("clip_min") is not None else ")"))
        else:
            values, meta = read_local(spec["file"], spec["factor"])
            url = f"{PGDA_ILLUMINATION_BASE}/{spec['file']}"
            unit, scale = spec["unit"], spec["scale"]   # the GeoTIFF's own scale/offset is already applied
            aggregation = f"mean of {spec['factor']}x{spec['factor']} source pixels"
        finite = np.isfinite(values)
        raw = np.full(values.shape, NODATA, dtype=np.int16)
        raw[finite] = np.clip(np.rint(values[finite] / scale), -32767, 32767).astype(np.int16)
        np.savez_compressed(GRID_DIR / f"{gid}.npz", values=raw)
        t = meta["transform"]
        valid = values[finite]
        index["grids"][gid] = {
            "file": f"{gid}.npz", "description": spec["description"], "unit": unit, "scale": scale,
            "width": int(meta["width"]), "height": int(meta["height"]), "pixelM": float(t.a),
            "xLeftM": float(t.c), "yTopM": float(t.f), "sourcePixelM": float(meta["source_pixel_m"]),
            "aggregation": aggregation,
            "min": round(float(valid.min()), 4), "max": round(float(valid.max()), 4),
            "mean": round(float(valid.mean()), 4), "validFraction": round(float(valid.size / values.size), 4),
            "source": {"agency": "NASA GSFC PGDA (LRO / LOLA)", "url": url, "product": spec["product"], **_head(url)},
            "builtUtc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }
        index_path.write_text(json.dumps(index, indent=1), encoding="utf-8")
        print(f"  -> {gid}.npz {raw.shape} min {valid.min():.3f} max {valid.max():.3f}", flush=True)


if __name__ == "__main__":
    build(sys.argv[1:] or None)
