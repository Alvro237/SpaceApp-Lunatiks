"""South-polar hillshade basemap derived from NASA LOLA topography (LDEM 60S, 240 m per pixel).

The PGDA product is a Cloud-Optimized GeoTIFF with overviews, so reading it at reduced size pulls
only a few megabytes. The picture is decorative context under the site markers; every number in
the app comes from the DEM windows and the ephemerides, not from this image.
"""
from __future__ import annotations

import json
import time

import numpy as np
import rasterio
from PIL import Image

from .config import PGDA_LOLA_BASE, WEB_DATA_DIR
from .dem import GDAL_OPTIONS

SOURCE = "LDEM_60S_240MPP_ADJ.TIF"
OUT_PX = 900             # shown at <= 380 css px (760 device px on retina); keeps the file around 1 MB
AZIMUTH_DEG = 315.0      # light from the upper left of the picture
ALTITUDE_DEG = 32.0
VERTICAL_EXAGGERATION = 2.5
LAT_LIMIT = -60.0        # picture is masked to the 60 S circle


def hillshade(z: np.ndarray, pixel_m: float) -> np.ndarray:
    dzdy_rows, dzdx = np.gradient(z, pixel_m)
    dzdy = -dzdy_rows  # image rows grow downwards, +y points up
    zf = VERTICAL_EXAGGERATION
    nx, ny, nz = -dzdx * zf, -dzdy * zf, np.ones_like(z)
    norm = np.sqrt(nx**2 + ny**2 + nz**2)
    az, alt = np.radians(AZIMUTH_DEG), np.radians(ALTITUDE_DEG)
    lx, ly, lz = np.cos(alt) * np.sin(az), np.cos(alt) * np.cos(az), np.sin(alt)
    shade = (nx * lx + ny * ly + nz * lz) / norm
    return np.clip(shade, 0, 1)


def build_basemap() -> dict:
    url = f"/vsicurl/{PGDA_LOLA_BASE}/{SOURCE}"
    last: Exception | None = None
    for attempt in range(8):  # NASA's server sometimes truncates range responses; retry with a fresh handle
        try:
            with rasterio.Env(**GDAL_OPTIONS):
                with rasterio.open(url) as ds:
                    b = ds.bounds
                    z = ds.read(1, out_shape=(OUT_PX, OUT_PX), resampling=rasterio.enums.Resampling.average).astype(np.float64)
                    width_m = b.right - b.left
            break
        except Exception as exc:  # noqa: BLE001
            last = exc
            time.sleep(2 * (attempt + 1))
    else:
        raise RuntimeError("could not read the 60S DEM for the basemap") from last
    z = np.where(np.isfinite(z), z, np.nanmedian(z))
    pixel_m = width_m / OUT_PX
    shade = hillshade(z, pixel_m)
    # mask outside the 60 S circle (radius = 2 R tan(15 deg) = 931 km)
    rho_km = 2 * 1737.4 * np.tan(np.radians((90 + LAT_LIMIT) / 2))
    yy, xx = np.mgrid[0:OUT_PX, 0:OUT_PX]
    cx = (b.left + b.right) / 2 + 0.0
    x_m = b.left + (xx + 0.5) * pixel_m - 0.0
    y_m = b.top - (yy + 0.5) * pixel_m
    inside = np.hypot(x_m, y_m) <= rho_km * 1000.0
    # gentle tone: light grey surface, darker where facing away from the Sun
    g = (60 + 175 * shade).astype(np.uint8)
    rgba = np.dstack([g, g, g, np.where(inside, 255, 0).astype(np.uint8)])
    WEB_DATA_DIR.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgba, "RGBA").save(WEB_DATA_DIR / "basemap_south.png", optimize=True)
    meta = {
        "file": "basemap_south.png",
        "extentM": [b.left, b.bottom, b.right, b.top],
        "pixels": OUT_PX,
        "source": f"{PGDA_LOLA_BASE}/{SOURCE}",
        "credit": "NASA LRO/LOLA topography (PGDA, Barker et al.), hillshade by this project",
        "method": f"area-averaged to {OUT_PX} px, hillshade azimuth {AZIMUTH_DEG} deg, altitude {ALTITUDE_DEG} deg, "
                  f"vertical exaggeration x{VERTICAL_EXAGGERATION}; masked to the 60 S circle",
    }
    (WEB_DATA_DIR / "basemap_south.json").write_text(json.dumps(meta, indent=1))
    size_kb = (WEB_DATA_DIR / "basemap_south.png").stat().st_size / 1024
    print(f"basemap_south.png: {OUT_PX}x{OUT_PX}, {size_kb:.0f} KB, extent {meta['extentM']}")
    return meta


if __name__ == "__main__":
    build_basemap()
