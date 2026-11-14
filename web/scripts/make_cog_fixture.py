"""Small Cloud Optimized GeoTIFF for the live-terrain tests (web/src/terrain/live/live.test.ts).

Same layout as the LOLA DEMs on PGDA (float32, 512 x 512 deflate blocks, floating-point predictor, overviews, LOLA
south polar stereographic on the 1737.4 km sphere), holding an exact plane so a test can check every value:
pixel (c, r) = 1000 + 0.5 c - 0.25 r metres. 1100 x 1100 pixels of 10 m, top-left corner at (-5500, 5500).

    uv run --project ../pipeline python scripts/make_cog_fixture.py
"""
from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import from_origin

OUT = Path(__file__).resolve().parents[1] / "src" / "terrain" / "live" / "__fixtures__" / "plane_cog.tif"
N, PX = 1100, 10.0
CRS = "+proj=stere +lat_0=-90 +lat_ts=-90 +lon_0=0 +x_0=0 +y_0=0 +R=1737400 +units=m +no_defs"

r, c = np.mgrid[0:N, 0:N]
values = (1000.0 + 0.5 * c - 0.25 * r).astype(np.float32)
profile = dict(driver="COG", width=N, height=N, count=1, dtype="float32", crs=CRS,
               transform=from_origin(-5500.0, 5500.0, PX, PX), compress="DEFLATE", predictor=3, blocksize=512,
               overview_resampling="average")
with rasterio.open(OUT, "w", **profile) as ds:
    ds.write(values, 1)
with rasterio.open(OUT) as ds:
    print(OUT.name, OUT.stat().st_size, "bytes", ds.profile["blockxsize"], ds.overviews(1), ds.tags(ns="IMAGE_STRUCTURE"))


# Second fixture: the real Moon Trek answer trek_shackleton_17.tif (17 x 18 px, one extra row as the client asks)
# with its row 16 set to 0.0, the fault Moon Trek shows on the last row of 257-row answers. The client must refuse it.
TREK = OUT.parent / "trek_shackleton_17.tif"
ZERO = OUT.parent / "trek_zero_row_17.tif"
with rasterio.open(TREK) as src:
    data = src.read(1)
    prof = src.profile
data[16, :] = 0.0
with rasterio.open(ZERO, "w", **prof) as dst:
    dst.write(data, 1)
print(ZERO.name, ZERO.stat().st_size, "bytes")
