"""LROC WAC photo base for the web globe, shipped with the app so that the globe opens in photo mode at once.

Without it the globe showed the bare grey LOLA relief first and the photo arrived a few seconds later, tile by tile,
from NASA Moon Trek (the 32 base tiles of level 1 in ``web/src/globe/detail``, asked for after the relief tiles).

Source: LROC WAC global morphologic mosaic ``LRO_WAC_Mosaic_Global_303ppd_v02`` (100 m, 303 px/deg; Speyerer et al.
2011), the pre-cut 256 x 256 JPEG tiles of NASA Moon Trek's WMTS cache. These are the exact tiles the globe reads at
its photo base level (level 1, 45 degree tiles, WMTS matrix 2): 8 columns from 180 W eastward, 4 rows from 90 N.

Normalisation:
1. Each of the 32 tiles must be 256 x 256 and grey (red = green = blue within 2 counts), or the build stops.
2. The tiles are placed side by side, unchanged, into one 2048 x 1024 grey image: simple cylindrical, row 0 at
   90 N, column 0 at 180 W, longitude growing east, 45 / 256 = 0.176 degrees (5.3 km at the equator) per pixel.
3. Written as a grey JPEG (quality 90). No brightness or contrast change: the browser cuts it back into the same
   32 tiles it would otherwise download one by one.
4. Validation stored in the sidecar: mean and spread of each tile, and that no tile is blank (spread > 5 counts).

Output: ``data/globe/wac_global_level1.jpg`` and ``data/globe/globe_photo.json`` (source, layout, build).

Run:  uv run python -m lunarnav.globe_photo      (downloads the 32 tiles, about 0.8 MB, into data/raw/wac_global)
"""
from __future__ import annotations

import io
import json
from datetime import datetime, timezone

import numpy as np
import requests
from PIL import Image

from .config import DATA_DIR, DATASET_DIR

LAYER = "LRO_WAC_Mosaic_Global_303ppd_v02"
WMTS = f"https://trek.nasa.gov/tiles/Moon/EQ/{LAYER}/1.0.0/default/default028mm/"
CAPABILITIES = f"https://trek.nasa.gov/tiles/Moon/EQ/{LAYER}/1.0.0/WMTSCapabilities.xml"
MATRIX = 2                                   # WMTS matrix of the globe's photo base level 1 (matrix = level + 1)
COLS, ROWS, N = 8, 4, 256
RAW_DIR = DATA_DIR / "wac_global"
OUT_DIR = DATASET_DIR / "globe"
OUT_FILE = "wac_global_level1.jpg"
JPEG_QUALITY = 90


def fetch_tile(row: int, col: int) -> np.ndarray:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    path = RAW_DIR / f"{MATRIX}_{row}_{col}.jpg"
    if not path.exists():
        for attempt in range(3):
            try:
                r = requests.get(f"{WMTS}{MATRIX}/{row}/{col}.jpg", timeout=60)
                r.raise_for_status()
                path.write_bytes(r.content)
                break
            except requests.RequestException:
                if attempt == 2:
                    raise
    rgb = np.asarray(Image.open(io.BytesIO(path.read_bytes())).convert("RGB"), dtype=np.int16)
    if rgb.shape != (N, N, 3):
        raise SystemExit(f"tile {MATRIX}/{row}/{col} is {rgb.shape[1]} x {rgb.shape[0]}, expected {N} x {N}")
    if np.abs(rgb[..., 0] - rgb[..., 1]).max() > 2 or np.abs(rgb[..., 0] - rgb[..., 2]).max() > 2:
        raise SystemExit(f"tile {MATRIX}/{row}/{col} is not grey")
    return rgb[..., 0].astype(np.uint8)


def main() -> None:
    image = np.zeros((ROWS * N, COLS * N), dtype=np.uint8)
    tiles = []
    for row in range(ROWS):
        for col in range(COLS):
            grey = fetch_tile(row, col)
            image[row * N:(row + 1) * N, col * N:(col + 1) * N] = grey
            spread = float(grey.std())
            if spread <= 5:
                raise SystemExit(f"tile {MATRIX}/{row}/{col} is blank (spread {spread:.1f})")
            tiles.append({"row": row, "col": col, "mean": round(float(grey.mean()), 2), "std": round(spread, 2)})
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    Image.fromarray(image, mode="L").save(OUT_DIR / OUT_FILE, quality=JPEG_QUALITY, optimize=True)
    size = (OUT_DIR / OUT_FILE).stat().st_size
    meta = {
        "format": 1,
        "file": OUT_FILE,
        "width": COLS * N,
        "height": ROWS * N,
        "tileCells": N,
        "level": MATRIX - 1,
        "layout": "simple cylindrical; row 0 is 90 N, column 0 starts at 180 W, longitude grows east; "
                  "tile (x, y) of the globe's level 1 is the 256 x 256 block at column 256 x, row 256 y",
        "encoding": "grey JPEG (quality 90), brightness as in the source tiles (0-255)",
        "transformation": "the 32 WMTS tiles of matrix 2 placed side by side, unchanged",
        "bytes": size,
        "source": {
            "product": f"LROC WAC global morphologic mosaic {LAYER} (100 m, 303 px/deg)",
            "url": f"{WMTS}{MATRIX}/{{row}}/{{col}}.jpg",
            "capabilities": CAPABILITIES,
            "agency": "NASA / LRO Camera team (Arizona State University), served by NASA Moon Trek (JPL)",
        },
        "citation": "Speyerer, E. J., et al. (2011). Lunar Reconnaissance Orbiter Camera global morphological map of "
                    "the Moon. Lunar and Planetary Science Conference XLII, abstract 2387.",
        "validation": {"rule": "every tile 256 x 256, grey, spread > 5 counts", "tiles": tiles},
        "built": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    (OUT_DIR / "globe_photo.json").write_text(json.dumps(meta, indent=1), encoding="utf-8")
    print(f"wrote {OUT_FILE} ({size // 1024} KB, {COLS * N} x {ROWS * N}); tile means "
          f"{min(t['mean'] for t in tiles)}-{max(t['mean'] for t in tiles)}")


if __name__ == "__main__":
    main()
