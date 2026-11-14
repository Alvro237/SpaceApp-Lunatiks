"""Radio link, level 1: geometric contact between a lunar site and the Earth's ground antennas.

There is contact at an instant when
  (a) the lunar site sees the Earth: at least ``comms_min_fraction`` of its disc is above the local horizon
      (the engine's rule, passed in as a boolean array), and
  (b) at least one of the selected antennas sees the Moon: the Moon is at or above that antenna's elevation limit,
      a number or a per-azimuth mask (``logic/stations.py``).

Both are needed: the Earth being in the lunar sky says nothing about whether an antenna can point at the Moon, and
the reverse. Geometry only: a visible Moon does not mean the antenna is scheduled, and there is no link budget
(level 2). Pure functions over NumPy arrays: no files, no network, no FastAPI.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .stations import limit_at, moon_az_el, sees_moon


@dataclass(frozen=True)
class StationSpec:
    """An antenna reduced to what the geometry needs."""
    id: str
    lat_deg: float
    lon_deg: float
    height_m: float
    limit: float | np.ndarray | None      # elevation limit: one number, a per-azimuth mask, or None (not defined)
    step_deg: float | None = None         # azimuth step of the mask


@dataclass(frozen=True)
class StationView:
    az_deg: np.ndarray
    el_deg: np.ndarray
    limit_deg: np.ndarray                 # the antenna's limit in the Moon's direction at each sample
    sees_moon: np.ndarray                 # bool


def station_view(spec: StationSpec, moon_ecef_km: np.ndarray) -> StationView:
    """The Moon from one antenna over the samples of ``moon_ecef_km`` (n, 3)."""
    az, el = moon_az_el(moon_ecef_km, spec.lat_deg, spec.lon_deg, spec.height_m)
    limit = limit_at(az, spec.limit, spec.step_deg)
    return StationView(az_deg=az, el_deg=el, limit_deg=limit, sees_moon=sees_moon(az, el, spec.limit, spec.step_deg))


@dataclass(frozen=True)
class Contact:
    earth_visible: np.ndarray                    # bool (n,): the lunar site sees the Earth
    any_station: np.ndarray                      # bool (n,): at least one antenna sees the Moon
    contact: np.ndarray                          # bool (n,): both
    contact_by_station: dict[str, np.ndarray]    # per antenna: the site sees the Earth and this antenna sees the Moon


def combine_contact(earth_visible: np.ndarray, station_sees_moon: dict[str, np.ndarray]) -> Contact:
    """Level-1 contact from the lunar site's Earth visibility and each antenna's Moon visibility."""
    earth = np.asarray(earth_visible, dtype=bool)
    if not station_sees_moon:
        raise ValueError("at least one antenna is needed")
    flags = {k: np.asarray(v, dtype=bool) for k, v in station_sees_moon.items()}
    if any(v.shape != earth.shape for v in flags.values()):
        raise ValueError("every series must have the same number of samples")
    any_station = np.logical_or.reduce(list(flags.values()))
    return Contact(earth_visible=earth, any_station=any_station, contact=earth & any_station,
                   contact_by_station={k: earth & v for k, v in flags.items()})
