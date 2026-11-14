"""Read LOLA south-pole elevation windows remotely and sample them with bilinear interpolation.

The PGDA products are Cloud-Optimized GeoTIFFs in south polar stereographic metres (Moon
2015 sphere, MOON_ME). GDAL's ``/vsicurl/`` reads only the blocks that a window touches, so a
site needs megabytes, not the multi-gigabyte files. Windows are cached on disk so the build is
repeatable offline after the first run.

Several resolutions are stacked: for every query point the finest level that has valid data is
used. Fine levels cover only a small radius around the site; coarse levels reach the far field
(about 170 km is the distance at which an 8 km relief still pokes above the lunar limb).
"""
from __future__ import annotations

import hashlib
import json
import time
from dataclasses import dataclass

import numpy as np
import rasterio
from pyproj import CRS, Transformer
from rasterio.windows import Window, from_bounds

from .config import DEM_CACHE_DIR, PGDA_LOLA_BASE


@dataclass(frozen=True)
class LevelSpec:
    file: str          # PGDA file name
    pixel_m: float     # nominal resolution
    radius_m: float    # half-width of the window read around the site


# Finest first. Not every level exists for every site (coverage is by latitude band); levels
# that do not intersect the window are skipped.
LEVELS: tuple[LevelSpec, ...] = (
    LevelSpec("LDEM_83S_10MPP_ADJ.TIF", 10.0, 6_000.0),
    LevelSpec("LDEM_80S_20MPP_ADJ.TIF", 20.0, 20_000.0),
    LevelSpec("LDEM_75S_30MPP_ADJ.TIF", 30.0, 40_000.0),
    LevelSpec("LDEM_80S_80MPP_ADJ.TIF", 80.0, 100_000.0),
    LevelSpec("LDEM_60S_120MPP_ADJ.TIF", 120.0, 120_000.0),
    LevelSpec("LDEM_60S_240MPP_ADJ.TIF", 240.0, 190_000.0),
)

GDAL_OPTIONS = {
    "GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR",
    "CPL_VSIL_CURL_ALLOWED_EXTENSIONS": ".TIF,.tif",
    "GDAL_HTTP_MAX_RETRY": "4",
    "GDAL_HTTP_RETRY_DELAY": "2",
    "GDAL_HTTP_MERGE_CONSECUTIVE_RANGES": "YES",
    "GDAL_HTTP_MULTIPLEX": "YES",
    "VSI_CACHE": "TRUE",
    "VSI_CACHE_SIZE": "134217728",
    "GDAL_HTTP_TIMEOUT": "120",
}


class DemWindow:
    """One in-memory elevation window with bilinear sampling. Heights are metres above the
    1737.4 km reference sphere; NaN means no data."""

    def __init__(self, spec: LevelSpec, data: np.ndarray, left: float, top: float, res_x: float,
                 res_y: float, wkt: str):
        self.spec = spec
        self.data = data
        self.left = left
        self.top = top
        self.res_x = res_x
        self.res_y = res_y
        self.wkt = wkt
        crs = CRS.from_wkt(wkt)
        self.to_xy = Transformer.from_crs(crs.geodetic_crs, crs, always_xy=True)

    def xy(self, lat_rad: np.ndarray, lon_rad: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        return self.to_xy.transform(np.degrees(lon_rad), np.degrees(lat_rad))

    def sample_xy(self, x: np.ndarray, y: np.ndarray) -> np.ndarray:
        fx = (x - self.left) / self.res_x - 0.5
        fy = (self.top - y) / self.res_y - 0.5
        rows, cols = self.data.shape
        j0 = np.floor(fx).astype(np.int64)
        i0 = np.floor(fy).astype(np.int64)
        inside = (j0 >= 0) & (i0 >= 0) & (j0 < cols - 1) & (i0 < rows - 1)
        j0c = np.clip(j0, 0, cols - 2)
        i0c = np.clip(i0, 0, rows - 2)
        tx = fx - j0c
        ty = fy - i0c
        d = self.data
        v00 = d[i0c, j0c]
        v01 = d[i0c, j0c + 1]
        v10 = d[i0c + 1, j0c]
        v11 = d[i0c + 1, j0c + 1]
        out = (v00 * (1 - tx) * (1 - ty) + v01 * tx * (1 - ty) + v10 * (1 - tx) * ty + v11 * tx * ty)
        out = np.where(inside, out, np.nan)
        return out.astype(np.float64)


STRIP_ROWS = 400
READ_ATTEMPTS = 8


def _read_strip(url: str, strip: Window) -> np.ndarray:
    """Read one strip with a fresh dataset handle per attempt. NASA's server occasionally returns a
    truncated range ("got 58796 bytes, expected 660973"); a new handle drops the bad cached block."""
    last: Exception | None = None
    for attempt in range(READ_ATTEMPTS):
        try:
            with rasterio.Env(**GDAL_OPTIONS):
                with rasterio.open(url) as ds:
                    return ds.read(1, window=strip).astype(np.float32)
        except Exception as exc:  # rasterio raises several error types for network trouble
            last = exc
            time.sleep(min(30, 2 * (attempt + 1)))
    raise RuntimeError(f"could not read {url} rows {strip.row_off}+{strip.height} after {READ_ATTEMPTS} attempts") from last


def _cache_path(spec: LevelSpec, bounds: tuple[float, float, float, float]):
    key = hashlib.sha1(f"{spec.file}|{[round(b, 1) for b in bounds]}".encode()).hexdigest()[:16]
    return DEM_CACHE_DIR / f"{spec.file.replace('.TIF', '')}_{key}"


def read_window(spec: LevelSpec, lat_deg: float, lon_deg: float) -> DemWindow | None:
    """Read (or load from cache) the window of ``spec`` centred on a site; None if the raster does
    not cover the site's neighbourhood at all."""
    DEM_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    url = f"/vsicurl/{PGDA_LOLA_BASE}/{spec.file}"
    with rasterio.Env(**GDAL_OPTIONS):
        with rasterio.open(url) as ds:
            wkt = ds.crs.to_wkt()
            crs = CRS.from_wkt(wkt)
            x0, y0 = Transformer.from_crs(crs.geodetic_crs, crs, always_xy=True).transform(lon_deg, lat_deg)
            r = spec.radius_m
            b = ds.bounds
            # skip levels whose raster does not contain the site itself
            if not (b.left <= x0 <= b.right and b.bottom <= y0 <= b.top):
                return None
            cache = _cache_path(spec, (x0 - r, y0 - r, x0 + r, y0 + r))
            meta_file = cache.with_suffix(".json")
            npy_file = cache.with_suffix(".npy")
            if meta_file.exists() and npy_file.exists():
                meta = json.loads(meta_file.read_text())
                data = np.load(npy_file)
                return DemWindow(spec, data, meta["left"], meta["top"], meta["res_x"], meta["res_y"], wkt)
            win = from_bounds(x0 - r, y0 - r, x0 + r, y0 + r, ds.transform).round_offsets().round_lengths()
            win = win.intersection(Window(0, 0, ds.width, ds.height))
            data = np.empty((int(win.height), int(win.width)), dtype=np.float32)
            for r0 in range(0, int(win.height), STRIP_ROWS):
                h = min(STRIP_ROWS, int(win.height) - r0)
                strip = Window(win.col_off, win.row_off + r0, win.width, h)
                data[r0:r0 + h] = _read_strip(url, strip)
            tr = ds.window_transform(win)
            meta = {"left": tr.c, "top": tr.f, "res_x": tr.a, "res_y": -tr.e, "file": spec.file,
                    "window": [int(win.col_off), int(win.row_off), int(win.width), int(win.height)]}
            np.save(npy_file, data)
            meta_file.write_text(json.dumps(meta))
            return DemWindow(spec, data, tr.c, tr.f, tr.a, -tr.e, wkt)


class DemStack:
    """Finest-valid-level elevation lookup around one site."""

    def __init__(self, lat_deg: float, lon_deg: float, levels: tuple[LevelSpec, ...] = LEVELS,
                 verbose: bool = True):
        self.lat_deg, self.lon_deg = lat_deg, lon_deg
        self.windows: list[DemWindow] = []
        for spec in levels:
            w = read_window(spec, lat_deg, lon_deg)
            if w is None:
                if verbose:
                    print(f"    - {spec.file}: does not cover the site")
                continue
            if verbose:
                print(f"    + {spec.file}: window {w.data.shape[1]}x{w.data.shape[0]} px, "
                      f"{np.isfinite(w.data).mean()*100:.0f}% valid")
            self.windows.append(w)

    @property
    def covered(self) -> bool:
        return len(self.windows) > 0

    def height(self, lat_rad: np.ndarray, lon_rad: np.ndarray) -> np.ndarray:
        """Heights (m above the reference sphere) at arbitrary points; NaN outside all levels."""
        lat_rad = np.asarray(lat_rad, dtype=np.float64)
        lon_rad = np.asarray(lon_rad, dtype=np.float64)
        out = np.full(lat_rad.shape, np.nan)
        # All levels share one CRS in practice, but keep one transformer per window to be safe.
        cache: dict[str, tuple[np.ndarray, np.ndarray]] = {}
        for w in self.windows:
            if w.wkt not in cache:
                cache[w.wkt] = w.xy(lat_rad, lon_rad)
            x, y = cache[w.wkt]
            missing = np.isnan(out)
            if not missing.any():
                break
            vals = w.sample_xy(x[missing], y[missing])
            out[missing] = vals
        return out

    def ground_height(self) -> float:
        h = self.height(np.array([np.radians(self.lat_deg)]), np.array([np.radians(self.lon_deg)]))[0]
        return float(h)
