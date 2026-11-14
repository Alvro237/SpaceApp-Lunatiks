"""Global LOLA topography for the web globe (the whole Moon, rotated with the mouse before entering the polar map).

Source: LRO LOLA Gridded Data Record LDEM_16 (PDS data set LRO-L-LOLA-4-GDR-V1.0, product version 3.1), NASA
PDS Geosciences Node. 5760 x 2880 int16, 16 pixels per degree, simple cylindrical, Mean Earth / polar axis frame,
height = DN x 0.5 m above the 1737.4 km sphere: the same frame and datum as every other dataset here.

Normalisation:
1. The PDS label must declare the frame, sphere, scaling and size used below, or the build stops.
2. 4 x 4 area mean to 4 pixels per degree (1440 x 720, about 7.6 km per pixel at the equator): a whole globe on
   a 900 px screen shows about 6 km per screen pixel, and closer views use the polar map's finer LOLA tiles.
3. Heights stay in metres above the 1737.4 km sphere; the image is normalised to its own minimum and maximum
   and packed as 16 bits in the red (high byte) and green (low byte) channels of a lossless PNG, the encoding of
   the web terrain tiles (docs/web-tileset.md).
4. Validation stored in the sidecar: height at each catalogue site with terrain against its groundHeightM.

Output: ``data/globe/lola_global_4ppd.png`` and ``data/globe/globe.json`` (source, citation, encoding, build).
Row 0 is 90 N, column 0 starts at longitude 0 and longitude grows east to 360.

Run:  uv run python -m lunarnav.globe      (downloads LDEM_16 into data/raw/lola_global if missing, 33 MB)
"""
from __future__ import annotations

import json
import re
import struct
import zlib
from datetime import datetime, timezone

import numpy as np
import requests

from .config import DATA_DIR, DATASET_DIR

PDS_BASE = "https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img"
RAW_DIR = DATA_DIR / "lola_global"
OUT_DIR = DATASET_DIR / "globe"
PRODUCT = "ldem_16"
COLS, ROWS, PPD = 5760, 2880, 16
FACTOR = 4                                   # 16 -> 4 pixels per degree


def _fetch(name: str) -> bytes:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    path = RAW_DIR / name
    if not path.exists():
        for attempt in range(3):             # PDS occasionally drops long transfers
            try:
                with requests.get(f"{PDS_BASE}/{name}", stream=True, timeout=120) as r:
                    r.raise_for_status()
                    tmp = path.with_suffix(".part")
                    with open(tmp, "wb") as fh:
                        for chunk in r.iter_content(1 << 20):
                            fh.write(chunk)
                    tmp.rename(path)
                break
            except requests.RequestException:
                if attempt == 2:
                    raise
    return path.read_bytes()


def _check_label(label: str) -> None:
    expect = {
        "LINES": str(ROWS), "LINE_SAMPLES": str(COLS), "SAMPLE_BITS": "16", "SAMPLE_TYPE": "LSB_INTEGER",
        "SCALING_FACTOR": "0.5", "OFFSET": "1737400.", "MAP_RESOLUTION": "16", "A_AXIS_RADIUS": "1737.4",
        "POSITIVE_LONGITUDE_DIRECTION": '"EAST"', "WESTERNMOST_LONGITUDE": "0", "MAXIMUM_LATITUDE": "90",
    }
    for key, value in expect.items():
        m = re.search(rf"^\s*{key}\s*=\s*(\S+)", label, re.M)
        if not m or m.group(1) != value:
            raise ValueError(f"{PRODUCT}.lbl: {key} = {m.group(1) if m else 'missing'}, expected {value}")
    if "MEAN EARTH/POLAR AXIS" not in label:
        raise ValueError(f"{PRODUCT}.lbl: frame is not Mean Earth / polar axis")


def _png_rg16(values: np.ndarray, path) -> tuple[float, float]:
    lo, hi = float(values.min()), float(values.max())
    q = np.round((values - lo) / (hi - lo) * 65535.0).astype(np.uint16)
    h, w = q.shape
    rgb = np.zeros((h, w, 3), dtype=np.uint8)
    rgb[..., 0] = q >> 8
    rgb[..., 1] = q & 0xFF
    raw = np.concatenate([np.zeros((h, 1), dtype=np.uint8), rgb.reshape(h, -1)], axis=1)

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw.tobytes(), 9)) + chunk(b"IEND", b"")
    path.write_bytes(png)
    return lo, hi


def build() -> dict:
    label = _fetch(f"{PRODUCT}.lbl").decode("ascii", "replace")
    _check_label(label)
    dn = np.frombuffer(_fetch(f"{PRODUCT}.img"), dtype="<i2")
    if dn.size != ROWS * COLS:
        raise ValueError(f"{PRODUCT}.img: {dn.size} samples, expected {ROWS * COLS}")
    height = dn.reshape(ROWS, COLS).astype(np.float64) * 0.5
    coarse = height.reshape(ROWS // FACTOR, FACTOR, COLS // FACTOR, FACTOR).mean(axis=(1, 3))

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / "lola_global_4ppd.png"
    lo, hi = _png_rg16(coarse, out)

    sites = json.loads((DATASET_DIR / "sites.json").read_text(encoding="utf-8"))["sites"]
    checks = []
    ppd = PPD // FACTOR
    for s in sites:
        t = s.get("terrain", {})
        if not t.get("available"):
            continue
        row = min(int((90.0 - s["lat"]) * ppd), coarse.shape[0] - 1)
        col = int((s["lon"] % 360.0) * ppd) % coarse.shape[1]
        checks.append({"site": s["id"], "catalogueGroundM": t["groundHeightM"], "globeM": round(float(coarse[row, col]), 1),
                       "differenceM": round(float(coarse[row, col]) - t["groundHeightM"], 1)})

    meta = {
        "format": 1,
        "file": out.name,
        "width": int(coarse.shape[1]),
        "height": int(coarse.shape[0]),
        "pixelsPerDegree": ppd,
        "layout": "simple cylindrical; row 0 is 90 N, column 0 starts at longitude 0, longitude grows east",
        "encoding": "RGB PNG, 16-bit value in red (high byte) and green (low byte); height = min + value / 65535 x (max - min), metres above the 1737.4 km sphere",
        "min": round(lo, 2),
        "max": round(hi, 2),
        "frame": "Mean Earth / polar axis (as LOLA, PDS label: DE421 orientation)",
        "transformation": f"{FACTOR} x {FACTOR} area mean of LDEM_16 (16 ppd) to {ppd} ppd",
        "source": {
            "product": "LRO LOLA Gridded Data Record LDEM_16, version 3.1",
            "dataSet": "LRO-L-LOLA-4-GDR-V1.0",
            "url": f"{PDS_BASE}/{PRODUCT}.img",
            "agency": "NASA PDS Geosciences Node (LRO LOLA team, Smith et al.)",
            "bytes": int(dn.size * 2),
        },
        "citation": "Smith, D. E., et al. (2010). The Lunar Orbiter Laser Altimeter investigation on the Lunar Reconnaissance Orbiter mission. Space Sci. Rev. 150, 209-241.",
        "validation": {"siteHeights": checks, "maxAbsSiteDifferenceM": max((abs(c["differenceM"]) for c in checks), default=None),
                       "note": "groundHeightM is the finest DEM at each site; the globe pixel is a 7.6 km-wide mean."},
        "builtUtc": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "builtBy": "pipeline/lunarnav/globe.py",
    }
    (OUT_DIR / "globe.json").write_text(json.dumps(meta, indent=1), encoding="utf-8")
    return meta


if __name__ == "__main__":
    m = build()
    size = (OUT_DIR / m["file"]).stat().st_size
    print(f"wrote {m['file']} {m['width']}x{m['height']} ({size / 1e6:.1f} MB), heights {m['min']}..{m['max']} m; "
          f"site check max |difference| {m['validation']['maxAbsSiteDifferenceM']} m")
