"""Load the Sun/Earth vector tables (data/ephemeris.json + *.f32) into an EphemerisTable."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from ..logic.ephemeris import EphemerisTable, Segment


def load_ephemeris(data_dir: Path) -> tuple[EphemerisTable, dict]:
    """Returns the table and the index document (frame, correction, kernels: provenance for the UI)."""
    index = json.loads((data_dir / "ephemeris.json").read_text(encoding="utf-8"))
    segments = []
    for meta in index["segments"]:
        data = np.fromfile(data_dir / meta["file"], dtype="<f4")
        if data.size != meta["count"] * 6:
            raise ValueError(f"{meta['file']}: expected {meta['count'] * 6} floats, got {data.size}")
        segments.append(Segment(id=meta["id"], start_ms=int(meta["startUnixMs"]), step_s=int(meta["stepSeconds"]),
                                data=data.reshape(-1, 6)))
    return EphemerisTable(segments), index
