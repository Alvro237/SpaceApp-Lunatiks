"""Horizon profile: elevation angle of the skyline per azimuth."""
from __future__ import annotations

import numpy as np

from .constants import MOON_R_KM


class HorizonProfile:
    """Elevation (degrees) of the horizon per azimuth, azimuth clockwise from north, evenly spaced
    starting at 0. ``kind`` records where it came from: "terrain" (LOLA ray-marched mask) or
    "smooth_sphere" (geometric dip only)."""

    def __init__(self, values: np.ndarray, kind: str = "terrain"):
        self.values = np.asarray(values, dtype=np.float64)
        self.kind = kind
        self.az_step_deg = 360.0 / self.values.size
        self.min = float(self.values.min())
        self.max = float(self.values.max())

    @property
    def is_flat(self) -> bool:
        return self.max - self.min < 1e-9

    def at(self, az_deg) -> np.ndarray:
        """Linear interpolation, wrapping at 360 degrees."""
        n = self.values.size
        x = (np.asarray(az_deg, dtype=np.float64) / self.az_step_deg) % n
        i = np.floor(x).astype(np.int64) % n
        f = x - np.floor(x)
        a = self.values[i]
        b = self.values[(i + 1) % n]
        return a + (b - a) * f


def spherical_horizon_deg(mast_m: float, ground_m: float = 0.0) -> float:
    """Geometric dip of the horizon over a smooth reference sphere, degrees (negative or zero)."""
    ro = MOON_R_KM * 1000.0 + ground_m + mast_m
    return -float(np.degrees(np.arccos(min(1.0, MOON_R_KM * 1000.0 / ro))))


def flat_profile(deg: float, n: int = 720) -> HorizonProfile:
    return HorizonProfile(np.full(n, deg), kind="smooth_sphere")


def decode_centideg(raw: np.ndarray) -> np.ndarray:
    """int16 hundredths of a degree (the pipeline's storage unit) to degrees."""
    return np.asarray(raw, dtype=np.float64) / 100.0
