"""Global LOLA elevation grid for the ray-traced horizon anywhere on the Moon.

The point horizon (api services.point_horizon) marches rays over the LOLA elevation grids; those are south
polar stereographic and stop at 60 S, so every point north of them fell back to the smooth sphere. This module
writes a whole-Moon elevation grid the tracer can read as its coarsest level.

Source: LRO LOLA Gridded Data Record LDEM_16 (PDS data set LRO-L-LOLA-4-GDR-V1.0, product version 3.1), NASA
PDS Geosciences Node: 5760 x 2880 int16, 16 pixels per degree, simple cylindrical, Mean Earth / polar axis
frame, height = DN x 0.5 m above the 1737.4 km sphere - the same source, frame and datum as the web globe
(lunarnav.globe), whose label checks are reused here.

Normalisation:
1. The PDS label must declare the frame, sphere, scaling and size (globe._check_label), or the build stops.
2. 2 x 2 area mean to 8 pixels per degree (2880 x 1440, about 3.8 km per pixel at the equator): the committed
   file stays a few megabytes and the horizon it yields is honest about its scale (grids.json carries the cell
   size, and the API reports it as ``near_cell_m``). South of 60 S the tracer still reads the finer polar grids.
3. Heights stay metres above the 1737.4 km sphere, stored as int16 = round(height / 0.5) like every other grid
   (npz, nodata -32768; LDEM_16 has full coverage, so no cell is nodata).
4. Validation stored in the sidecar: height at each catalogue site with terrain against its groundHeightM.

Output: ``data/grids/lola_elevation_global.npz`` and its entry in ``data/grids/grids.json`` with
``"projection": "equirectangular"`` (row 0 centred at 90 N minus half a pixel, column 0 centred at longitude
0 plus half a pixel, longitude grows east 0..360), which api/app/db/grids.py dispatches on.

Run:  uv run python -m lunarnav.global_grid      (downloads LDEM_16 into data/raw/lola_global if missing, 33 MB)
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

import numpy as np

from .config import DATASET_DIR, GRID_DIR
from .globe import COLS, PDS_BASE, PPD, PRODUCT, ROWS, _check_label, _fetch

GRID_ID = "lola_elevation_global"
FACTOR = 2                                  # 16 -> 8 pixels per degree
OUT_PPD = PPD // FACTOR
SCALE = 0.5                                 # stored int16 = round(metres / SCALE), as the other grids
MOON_R_M = 1_737_400.0


def build() -> dict:
    label = _fetch(f"{PRODUCT}.lbl").decode("ascii", "replace")
    _check_label(label)
    dn = np.frombuffer(_fetch(f"{PRODUCT}.img"), dtype="<i2")
    if dn.size != ROWS * COLS:
        raise ValueError(f"{PRODUCT}.img: {dn.size} samples, expected {ROWS * COLS}")
    height = dn.reshape(ROWS, COLS).astype(np.float64) * 0.5
    coarse = height.reshape(ROWS // FACTOR, FACTOR, COLS // FACTOR, FACTOR).mean(axis=(1, 3))

    GRID_DIR.mkdir(parents=True, exist_ok=True)
    raw = np.clip(np.rint(coarse / SCALE), -32767, 32767).astype(np.int16)
    np.savez_compressed(GRID_DIR / f"{GRID_ID}.npz", values=raw)

    sites = json.loads((DATASET_DIR / "sites.json").read_text(encoding="utf-8"))["sites"]
    checks = []
    for s in sites:
        t = s.get("terrain", {})
        if not t.get("available"):
            continue
        row = min(int((90.0 - s["lat"]) * OUT_PPD), coarse.shape[0] - 1)
        col = int((s["lon"] % 360.0) * OUT_PPD) % coarse.shape[1]
        checks.append({"site": s["id"], "catalogueGroundM": t["groundHeightM"],
                       "gridM": round(float(coarse[row, col]), 1),
                       "differenceM": round(float(coarse[row, col]) - t["groundHeightM"], 1)})

    pixel_m = 2.0 * np.pi * MOON_R_M / (360.0 * OUT_PPD)
    index_path = GRID_DIR / "grids.json"
    index = json.loads(index_path.read_text(encoding="utf-8")) if index_path.exists() else {"format": 1, "grids": {}}
    index["grids"][GRID_ID] = {
        "file": f"{GRID_ID}.npz",
        "description": "Mean LOLA height above the 1737.4 km sphere, whole Moon (coarsest level of the "
                       "ray-traced point horizon; the south polar grids are finer south of 60 S)",
        "unit": "m", "scale": SCALE,
        "width": int(coarse.shape[1]), "height": int(coarse.shape[0]),
        "projection": "equirectangular",
        "ppd": OUT_PPD,
        "pixelM": round(float(pixel_m), 1),
        "layout": "simple cylindrical; row 0 centred at 90 N minus half a pixel, column 0 centred at longitude "
                  "1/16 deg, longitude grows east 0..360; pixelM is the meridional pixel size (and the "
                  "east-west size at the equator; east-west shrinks with cos(latitude))",
        "sourcePixelM": round(float(pixel_m / FACTOR), 1),
        "aggregation": f"{FACTOR} x {FACTOR} area mean of LDEM_16 (16 ppd) to {OUT_PPD} ppd",
        "min": round(float(coarse.min()), 4), "max": round(float(coarse.max()), 4),
        "mean": round(float(coarse.mean()), 4), "validFraction": 1.0,
        "source": {
            "agency": "NASA PDS Geosciences Node (LRO LOLA team, Smith et al.)",
            "product": "LRO LOLA Gridded Data Record LDEM_16, version 3.1 (LRO-L-LOLA-4-GDR-V1.0)",
            "url": f"{PDS_BASE}/{PRODUCT}.img",
            "bytes": int(dn.size * 2),
        },
        "citation": "Smith, D. E., et al. (2010). The Lunar Orbiter Laser Altimeter investigation on the "
                    "Lunar Reconnaissance Orbiter mission. Space Sci. Rev. 150, 209-241.",
        "validation": {"siteHeights": checks,
                       "maxAbsSiteDifferenceM": max((abs(c["differenceM"]) for c in checks), default=None),
                       "note": "groundHeightM is the finest DEM at each site; the grid pixel is a 3.8 km-wide mean."},
        "builtUtc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "builtBy": "pipeline/lunarnav/global_grid.py",
    }
    index_path.write_text(json.dumps(index, indent=1), encoding="utf-8")
    return index["grids"][GRID_ID]


if __name__ == "__main__":
    m = build()
    size = (GRID_DIR / m["file"]).stat().st_size
    print(f"wrote {m['file']} {m['width']}x{m['height']} ({size / 1e6:.1f} MB), heights {m['min']}..{m['max']} m; "
          f"site check max |difference| {m['validation']['maxAbsSiteDifferenceM']} m")
