"""Earth answers over a mission window, built on the engine's Series (positions and horizon are inputs).

- Direct-to-Earth link possible when at least ``comms_min_fraction`` of the Earth's disc is above the local
  horizon (engine convention, a parameter). Geometry only: no link budget, no ground-station visibility.
- Libration: seen from a fixed site the Earth does not stay still; it wanders a few degrees in azimuth and
  elevation over a month. ``libration_wander`` reports that excursion over the window.

Pure functions over NumPy arrays: no files, no network, no FastAPI.
"""
from __future__ import annotations

import numpy as np


def _wrap180(a: np.ndarray) -> np.ndarray:
    return (np.asarray(a, dtype=np.float64) + 180.0) % 360.0 - 180.0


def libration_wander(earth_az: np.ndarray, earth_el: np.ndarray) -> dict:
    """Excursion of the Earth's centre in the local sky, degrees.

    Azimuth is unwrapped around its circular mean so a path crossing north (0/360) is not counted as 360 degrees.
    Near the zenith azimuth is ill-defined; the elevation span is the robust number there.
    """
    az = np.asarray(earth_az, dtype=np.float64)
    el = np.asarray(earth_el, dtype=np.float64)
    mean_az = float(np.degrees(np.arctan2(np.sin(np.radians(az)).mean(), np.cos(np.radians(az)).mean())) % 360.0)
    d = _wrap180(az - mean_az)
    return {"azimuth_span_deg": float(d.max() - d.min()), "elevation_span_deg": float(el.max() - el.min()),
            "mean_azimuth_deg": mean_az, "mean_elevation_deg": float(el.mean())}
