"""Bright stars for the first-person horizon view: the Yale Bright Star Catalogue (BSC5P) reduced to what the eye sees.

Input (fetched by hand, not in git): data/raw/stars/heasarc_bsc5p.tdat, the HEASARC table ``heasarc_bsc5p``
(https://heasarc.gsfc.nasa.gov/FTP/heasarc/dbase/tdat_files/heasarc_bsc5p.tdat.gz; Hoffleit & Warren 1991, Bright
Star Catalogue, 5th revised edition, 9 110 objects).

Output: web/src/horizon/stars.json: ``{"source", "maxVmag", "stars": [[ra_deg, dec_deg, vmag, b_v], ...]}`` for the
stars with V magnitude at or below MAX_VMAG, brightest first, J2000 (ICRS to well under the drawing accuracy),
positions rounded to 0.001 degrees, no proper motion applied (under 0.1 degrees in a century for all but a few).
B-V is null when the catalogue has none.

    uv run python -m lunarnav.stars
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw" / "stars" / "heasarc_bsc5p.tdat"
OUT = ROOT / "web" / "src" / "horizon" / "stars.json"
MAX_VMAG = 5.5        # a dark-sky naked-eye view without the faintest crowd (presentation choice)


def read_rows(path: Path = RAW) -> list[dict]:
    fields: list[str] = []
    rows: list[dict] = []
    data = False
    for line in path.read_text(encoding="latin-1").splitlines():
        if line.startswith("field["):
            fields.append(re.match(r"field\[(\w+)\]", line).group(1))
        elif line.strip() == "<DATA>":
            data = True
        elif line.strip() == "<END>":
            break
        elif data and line:
            rows.append(dict(zip(fields, line.split("|"))))
    return rows


def reduce(rows: list[dict], max_vmag: float = MAX_VMAG) -> list[list]:
    out = []
    for r in rows:
        try:
            ra, dec, v = float(r["ra"]), float(r["dec"]), float(r["vmag"])
        except ValueError:
            continue                      # the catalogue's 14 non-stellar or removed entries have no position
        if v > max_vmag:
            continue
        bv = float(r["bv_color"]) if r["bv_color"].strip() else None
        out.append([round(ra, 3), round(dec, 3), round(v, 2), None if bv is None else round(bv, 2)])
    out.sort(key=lambda s: s[2])
    return out


def main() -> None:
    stars = reduce(read_rows())
    doc = {"source": "Yale Bright Star Catalogue, 5th rev. ed. (Hoffleit & Warren 1991), NASA HEASARC table heasarc_bsc5p",
           "maxVmag": MAX_VMAG, "stars": stars}
    OUT.write_text(json.dumps(doc, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"{len(stars)} stars with V <= {MAX_VMAG} -> {OUT.relative_to(ROOT)} ({OUT.stat().st_size / 1024:.0f} KB)")
    print("brightest:", stars[:3])


if __name__ == "__main__":
    main()
