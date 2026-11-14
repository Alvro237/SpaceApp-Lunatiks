"""Sun and Earth position tables in the Moon Mean-Earth frame.

The tables are produced by the pipeline with SPICE (DE440, light time + stellar aberration, LT+S).
One table serves every site: the caller subtracts the site vector and projects on the local basis.

Time grid: sample i is at the calendar-UTC instant start + i * step (plain datetime arithmetic,
no leap-second bookkeeping). Times are Unix milliseconds everywhere in the logic layer.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np


class OutOfCoverage(ValueError):
    """Requested time is outside the loaded ephemeris tables."""


@dataclass(frozen=True)
class Segment:
    id: str
    start_ms: int
    step_s: int
    data: np.ndarray  # (count, 6) float32: sun xyz, earth xyz, km from the Moon centre

    @property
    def count(self) -> int:
        return self.data.shape[0]

    @property
    def end_ms(self) -> int:
        return self.start_ms + (self.count - 1) * self.step_s * 1000


class EphemerisTable:
    def __init__(self, segments: list[Segment]):
        for s in segments:
            if s.data.ndim != 2 or s.data.shape[1] != 6 or s.count < 4:
                raise ValueError(f"ephemeris segment {s.id}: expected shape (n >= 4, 6), got {s.data.shape}")
        self.segments = list(segments)

    def coverage(self) -> list[tuple[int, int]]:
        """[start_ms, end_ms] pairs covered by the tables."""
        return [(s.start_ms, s.end_ms) for s in self.segments]

    def covers(self, t_ms: float) -> bool:
        return any(s.start_ms <= t_ms <= s.end_ms for s in self.segments)

    def positions(self, t_ms) -> np.ndarray:
        """Sun and Earth vectors (n, 6) in km at the given times, 4-point cubic Lagrange interpolation
        (maximum error against SPICE is far below the 0.01 degree test tolerance)."""
        t = np.atleast_1d(np.asarray(t_ms, dtype=np.float64))
        out = np.empty((t.size, 6), dtype=np.float64)
        done = np.zeros(t.size, dtype=bool)
        for seg in self.segments:
            m = ~done & (t >= seg.start_ms) & (t <= seg.end_ms)
            if not m.any():
                continue
            u = (t[m] - seg.start_ms) / (seg.step_s * 1000.0)
            # four consecutive samples s0..s0+3 around u, clamped at the segment edges
            s0 = np.clip(np.floor(u).astype(np.int64) - 1, 0, seg.count - 4)
            f = u - (s0 + 1)
            w0 = -f * (f - 1) * (f - 2) / 6
            w1 = (f + 1) * (f - 1) * (f - 2) / 2
            w2 = -(f + 1) * f * (f - 2) / 2
            w3 = (f + 1) * f * (f - 1) / 6
            d = seg.data
            out[m] = (w0[:, None] * d[s0] + w1[:, None] * d[s0 + 1]
                      + w2[:, None] * d[s0 + 2] + w3[:, None] * d[s0 + 3])
            done |= m
        if not done.all():
            bad = float(t[~done][0])
            raise OutOfCoverage(f"time {bad:.0f} ms (Unix) is outside the ephemeris tables {self.coverage()}")
        return out
