"""The real sky behind the web globe: NASA SVS Deep Star Maps 2020 in celestial coordinates.

Source: NASA Scientific Visualization Studio, "Deep Star Maps 2020" (visualization 4851, Ernie Wright, released
2020-09-09, updated 2022-08-12), https://svs.gsfc.nasa.gov/4851/. An all-sky map of about 1.7 billion stars from the
Hipparcos-2, Tycho-2 and Gaia DR2 catalogues, the Milky Way included. Input: ``starmap_2020_8k.exr`` (8192 x 4096,
half-float linear RGB in 0..1, equirectangular, J2000 right ascension and declination; centred on 0 h right
ascension, right ascension growing to the LEFT, row 0 at declination +90).

Normalisation:
1. The EXR must have the size and value range used below, or the build stops.
2. Linear values are encoded with the sRGB transfer curve (no other tone mapping, no exposure change): the globe's
   renderer writes colours to the screen as they are, so the file holds what is displayed. Brightness on screen is
   set by the renderer (a presentation choice, written in the frontend), not baked in here.
3. Two sizes are written as JPEG (quality 75 and 85): 8192 x 4096 for screens whose GPU accepts large textures and a
   2 x 2 area mean to 4096 x 2048 for the rest (phones).
4. Validation stored in the sidecar: the 25 brightest stars of the Bright Star Catalogue (``web/src/horizon/stars.json``,
   the points the globe already draws) are looked up in the map with the same right ascension / declination to pixel
   rule the frontend uses. Each must sit on a pixel at least 10 x brighter than the sky median and within 2 pixels
   (0.09 degrees at 8k) of the brightness-weighted centroid around it; otherwise the build stops. This proves the map's orientation
   (right ascension to the left, centre at 0 h) matches the catalogue the app already validates.

Output: ``data/sky/starmap_8k.jpg``, ``data/sky/starmap_4k.jpg`` and ``data/sky/sky.json`` (source, layout, build).

Run:  uv run --with openexr python -m lunarnav.sky    (downloads the 8k EXR into data/raw/starmap if missing, 125 MB;
      OpenEXR is needed by this step only, so it is not a pipeline dependency)
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

import numpy as np
import requests
from PIL import Image

from .config import DATA_DIR, DATASET_DIR, ROOT

SVS_PAGE = "https://svs.gsfc.nasa.gov/4851/"
EXR_URL = "https://svs.gsfc.nasa.gov/vis/a000000/a004800/a004851/starmap_2020_8k.exr"
RAW_DIR = DATA_DIR / "starmap"
OUT_DIR = DATASET_DIR / "sky"
STARS_JSON = ROOT / "web" / "src" / "horizon" / "stars.json"
W, H = 8192, 4096
JPEG_QUALITY = {"8k": 75, "4k": 85}   # 8k kept near 3.5 MB for the repository and the download
CHECK_STARS = 25
CHECK_MIN_CONTRAST = 10.0      # star pixel over sky median
CHECK_MAX_OFFSET_PX = 2        # at 8k: 2 px = 0.088 degrees


def fetch_exr() -> np.ndarray:
    """Linear RGB, float32, (H, W, 3), row 0 at declination +90."""
    import OpenEXR  # only this step needs it

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    path = RAW_DIR / "starmap_2020_8k.exr"
    if not path.exists():
        with requests.get(EXR_URL, stream=True, timeout=300) as r:
            r.raise_for_status()
            tmp = path.with_suffix(".part")
            with open(tmp, "wb") as fh:
                for chunk in r.iter_content(1 << 20):
                    fh.write(chunk)
            tmp.rename(path)
    rgb = OpenEXR.File(str(path)).channels()["RGB"].pixels.astype(np.float32)
    if rgb.shape != (H, W, 3):
        raise SystemExit(f"unexpected EXR size {rgb.shape}, expected {(H, W, 3)}")
    if rgb.min() < 0 or rgb.max() > 1.0001:
        raise SystemExit(f"unexpected EXR range {rgb.min()}..{rgb.max()}, expected 0..1")
    return rgb


def srgb(linear: np.ndarray) -> np.ndarray:
    """IEC 61966-2-1 sRGB transfer curve, 0..1 in, 0..255 uint8 out."""
    x = np.clip(linear, 0.0, 1.0)
    y = np.where(x <= 0.0031308, 12.92 * x, 1.055 * np.power(x, 1 / 2.4) - 0.055)
    return np.round(y * 255).astype(np.uint8)


def pixel_of(ra_deg: float, dec_deg: float, w: int = W, h: int = H) -> tuple[int, int]:
    """Column and row of a J2000 direction: centre column at 0 h, right ascension growing to the left."""
    u = (0.5 - ra_deg / 360.0) % 1.0
    v = (90.0 - dec_deg) / 180.0
    return min(int(u * w), w - 1), min(int(v * h), h - 1)


def check_alignment(rgb: np.ndarray) -> list[dict]:
    lum = rgb.mean(axis=2)
    median = float(np.median(lum))
    stars = json.loads(STARS_JSON.read_text(encoding="utf-8"))["stars"][:CHECK_STARS]
    out = []
    for ra, dec, vmag, _bv in stars:
        x, y = pixel_of(ra, dec)
        # sub-pixel prediction (pixel centres at +0.5) against the brightness-weighted centroid around it: the
        # brightest stars are saturated plateaus, so the single brightest pixel is not a position
        px = ((0.5 - ra / 360.0) % 1.0) * W - 0.5
        py = (90.0 - dec) / 180.0 * H - 0.5
        r = 4
        ys = np.arange(y - r, y + r + 1).clip(0, H - 1)
        xs = np.arange(x - r, x + r + 1) % W
        win = lum[np.ix_(ys, xs)] - median
        win = np.clip(win, 0, None)
        gy, gx = np.mgrid[-r:r + 1, -r:r + 1]
        cy = y + float((win * gy).sum() / win.sum())
        cx = x + float((win * gx).sum() / win.sum())
        dx = (cx - px + W / 2) % W - W / 2
        offset = float(np.hypot(dx, cy - py))
        contrast = float(lum[y, x] / median) if median > 0 else float("inf")
        row = {"raDeg": ra, "decDeg": dec, "vmag": vmag, "pixel": [x, y], "contrastOverMedian": round(contrast, 1),
               "offsetToCentroidPx": round(offset, 2)}
        out.append(row)
        if contrast < CHECK_MIN_CONTRAST or offset > CHECK_MAX_OFFSET_PX:
            raise SystemExit(f"star map does not line up with the Bright Star Catalogue: {row}")
    return out


def main() -> None:
    rgb = fetch_exr()
    checks = check_alignment(rgb)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    files = {}
    big = srgb(rgb)
    Image.fromarray(big).save(OUT_DIR / "starmap_8k.jpg", quality=JPEG_QUALITY["8k"], optimize=True, progressive=True)
    files["8k"] = {"file": "starmap_8k.jpg", "width": W, "height": H}
    small = srgb(rgb.reshape(H // 2, 2, W // 2, 2, 3).mean(axis=(1, 3)))
    Image.fromarray(small).save(OUT_DIR / "starmap_4k.jpg", quality=JPEG_QUALITY["4k"], optimize=True, progressive=True)
    files["4k"] = {"file": "starmap_4k.jpg", "width": W // 2, "height": H // 2}
    for f in files.values():
        f["bytes"] = (OUT_DIR / f["file"]).stat().st_size
    meta = {
        "format": 1,
        "files": files,
        "layout": "equirectangular, J2000 right ascension and declination; centre column at 0 h, right ascension grows to the left; row 0 is declination +90",
        "encoding": "JPEG (quality 75 at 8k, 85 at 4k), sRGB transfer curve applied to the linear EXR values (no other tone mapping)",
        "frame": "J2000 equator and equinox (ICRS to well under a pixel)",
        "transformation": "8k: sRGB encode only; 4k: 2 x 2 area mean of the linear values, then sRGB encode",
        "source": {
            "product": "Deep Star Maps 2020, starmap_2020_8k.exr (celestial coordinates)",
            "url": EXR_URL,
            "page": SVS_PAGE,
            "agency": "NASA Goddard Space Flight Center Scientific Visualization Studio",
            "catalogues": "Hipparcos-2, Tycho-2, Gaia Data Release 2",
            "released": "2020-09-09",
            "updated": "2022-08-12",
        },
        "citation": "NASA/Goddard Space Flight Center Scientific Visualization Studio. Deep Star Maps 2020 (visualization 4851). Gaia DR2: ESA/Gaia/DPAC. Ernie Wright (USRA/STC).",
        "validation": {
            "rule": f"the {CHECK_STARS} brightest Bright Star Catalogue stars fall on a pixel >= {CHECK_MIN_CONTRAST} x the sky median and within {CHECK_MAX_OFFSET_PX} px of the brightness-weighted centroid",
            "skyMedianLinear": float(np.median(rgb.mean(axis=2))),
            "stars": checks,
        },
        "built": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    (OUT_DIR / "sky.json").write_text(json.dumps(meta, indent=1), encoding="utf-8")
    print(f"wrote {', '.join(f['file'] + ' (' + str(f['bytes'] // 1024) + ' KB)' for f in files.values())}; "
          f"{len(checks)} catalogue stars line up (worst offset {max(c['offsetToCentroidPx'] for c in checks)} px, "
          f"lowest contrast {min(c['contrastOverMedian'] for c in checks)} x)")


if __name__ == "__main__":
    main()
