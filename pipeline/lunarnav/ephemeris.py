"""Precompute Sun and Earth position tables in the Moon Mean-Earth frame.

One table serves every site: the browser subtracts the site vector (parallax) and projects on
the local east/north/up basis. Positions are light-time and stellar-aberration corrected
(``LT+S``), which reproduces JPL Horizons' "airless apparent" azimuth/elevation to the sixth
decimal (checked 2026-11-13).

Time grid: sample ``i`` is at the *calendar* UTC instant ``start + i * step`` computed with plain
datetime arithmetic. That is exactly what JavaScript's ``Date`` does (POSIX time, no leap
seconds), so the browser can index the table with ``(unix_ms - startUnixMs) / step`` with no
leap-second bookkeeping. Each instant is converted to ET individually with ``str2et``.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import numpy as np
import spiceypy as spice

from .config import KERNELS, WEB_DATA_DIR
from .spice_setup import load_kernels

BODIES = ("sun", "earth")

# id, UTC start (inclusive), UTC end (inclusive), step in seconds
SEGMENTS = [
    {"id": "2025_2035", "start": "2025-01-01T00:00:00", "end": "2036-01-01T00:00:00", "step_s": 3600},
    # Apollo era, for historical replay and validation against documented landing conditions.
    # UTC before 1972 is a SPICE extrapolation (error of seconds, < 0.001 deg).
    {"id": "apollo_1969_1972", "start": "1969-01-01T00:00:00", "end": "1973-01-01T00:00:00", "step_s": 3600},
]


def utc_grid(start_iso: str, end_iso: str, step_s: int) -> list[datetime]:
    t0 = datetime.fromisoformat(start_iso)
    t1 = datetime.fromisoformat(end_iso)
    n = int((t1 - t0).total_seconds() // step_s) + 1
    return [t0 + timedelta(seconds=step_s * i) for i in range(n)]


def compute_positions(start_iso: str, end_iso: str, step_s: int) -> np.ndarray:
    """Return float64 array (n, 2, 3): Sun and Earth vectors (km) from the Moon centre, MOON_ME."""
    load_kernels()
    strings = [t.strftime("%Y-%m-%d %H:%M:%S") + " UTC" for t in utc_grid(start_iso, end_iso, step_s)]
    ets = np.asarray(spice.str2et(strings))
    out = np.empty((len(ets), 2, 3))
    for i, name in enumerate(("SUN", "EARTH")):
        pos, _lt = spice.spkpos(name, ets, "MOON_ME", "LT+S", "MOON")
        out[:, i, :] = pos
    return out


def _to_unix_ms(iso: str) -> int:
    return int(datetime.fromisoformat(iso).replace(tzinfo=timezone.utc).timestamp() * 1000)


def _max_direction_error_deg(a: np.ndarray, b: np.ndarray) -> float:
    """Largest angle between corresponding vectors (float32 quantisation check)."""
    a = a.reshape(-1, 3)
    b = b.reshape(-1, 3)
    cross = np.linalg.norm(np.cross(a, b), axis=1)
    dot = np.einsum("ij,ij->i", a, b)
    return float(np.degrees(np.arctan2(cross, dot)).max())


def write_ephemeris(kernel_manifest: dict | None = None) -> dict:
    WEB_DATA_DIR.mkdir(parents=True, exist_ok=True)
    segments = []
    for seg in SEGMENTS:
        pos = compute_positions(seg["start"], seg["end"], seg["step_s"])
        data = pos.astype("<f4")
        fname = f"ephemeris_{seg['id']}.f32"
        (WEB_DATA_DIR / fname).write_bytes(data.tobytes())
        err_deg = _max_direction_error_deg(data.astype(np.float64), pos)
        segments.append({
            "id": seg["id"],
            "file": fname,
            "startUtc": seg["start"] + "Z",
            "startUnixMs": _to_unix_ms(seg["start"]),
            "stepSeconds": seg["step_s"],
            "count": int(pos.shape[0]),
            "bytes": int(data.nbytes),
            "maxFloat32DirectionErrorDeg": err_deg,
        })
        print(f"{fname}: {pos.shape[0]} samples, {data.nbytes/1e6:.2f} MB, "
              f"max float32 direction error {err_deg:.2e} deg")
    index = {
        "format": 1,
        "layout": "float32 little-endian [sample][body][x,y,z], kilometres from the Moon centre",
        "bodies": list(BODIES),
        "frame": "MOON_ME (Moon Mean-Earth / polar axis), DE440 orientation",
        "correction": "LT+S (light time + stellar aberration), airless",
        "interpolation": "4-point cubic Lagrange in the browser",
        "segments": segments,
        "kernels": {role: {"file": KERNELS[role]["file"], **(kernel_manifest or {}).get(role, {})}
                    for role in KERNELS},
    }
    (WEB_DATA_DIR / "ephemeris.json").write_text(json.dumps(index, indent=2))
    return index
