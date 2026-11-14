"""Golden values for the polar stereographic projection, computed by pyproj on the PGDA GeoTIFF's
own CRS. The browser's closed-form projection is tested against them (web/tests/projection.test.ts).

Run once (needs network, reads only the file header): ``uv run python -m lunarnav.make_fixtures_projection``
"""
from __future__ import annotations

import json

import rasterio
from pyproj import CRS, Transformer

from .config import FIXTURE_DIR, PGDA_LOLA_BASE
from .dem import GDAL_OPTIONS

POINTS = [(-90.0, 0.0), (-89.67, 129.78), (-85.98, -1.67), (-80.13, 1.44), (-70.0, 90.0), (-65.0, -90.0),
          (-60.0, 180.0), (-75.5, 33.3), (-62.0, -150.0), (-88.0, 45.0)]


def main() -> None:
    url = f"/vsicurl/{PGDA_LOLA_BASE}/LDEM_60S_240MPP_ADJ.TIF"
    with rasterio.Env(**GDAL_OPTIONS):
        with rasterio.open(url) as ds:
            wkt = ds.crs.to_wkt()
            bounds = list(ds.bounds)
    crs = CRS.from_wkt(wkt)
    tf = Transformer.from_crs(crs.geodetic_crs, crs, always_xy=True)
    out = []
    for lat, lon in POINTS:
        x, y = tf.transform(lon, lat)
        out.append({"lat": lat, "lon": lon, "xKm": x / 1000.0, "yKm": y / 1000.0})
    FIXTURE_DIR.mkdir(parents=True, exist_ok=True)
    (FIXTURE_DIR / "projection_reference.json").write_text(json.dumps({
        "source": "pyproj on the CRS of LDEM_60S_240MPP_ADJ.TIF (NASA PGDA); kilometres from the pole",
        "crsName": crs.name, "boundsM": bounds, "points": out}, indent=1))
    print("wrote projection_reference.json:", [(p["lat"], p["lon"], round(p["xKm"], 2), round(p["yKm"], 2)) for p in out[:4]])


if __name__ == "__main__":
    main()
