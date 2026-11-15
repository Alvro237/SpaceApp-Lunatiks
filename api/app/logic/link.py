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

from .stations import geodetic_to_ecef_km, limit_at, moon_az_el, sees_moon

SPEED_OF_LIGHT_M_S = 299_792_458.0
BOLTZMANN_J_PER_K = 1.380649e-23
BOLTZMANN_DBW_PER_K_HZ = 10.0 * np.log10(BOLTZMANN_J_PER_K)      # -228.599 dBW/(K Hz)


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
    range_km: np.ndarray                  # distance from the antenna to the Moon's centre


def station_view(spec: StationSpec, moon_ecef_km: np.ndarray) -> StationView:
    """The Moon from one antenna over the samples of ``moon_ecef_km`` (n, 3)."""
    moon = np.atleast_2d(np.asarray(moon_ecef_km, dtype=np.float64))
    az, el = moon_az_el(moon, spec.lat_deg, spec.lon_deg, spec.height_m)
    limit = limit_at(az, spec.limit, spec.step_deg)
    rng = np.linalg.norm(moon - geodetic_to_ecef_km(spec.lat_deg, spec.lon_deg, spec.height_m), axis=1)
    return StationView(az_deg=az, el_deg=el, limit_deg=limit, sees_moon=sees_moon(az, el, spec.limit, spec.step_deg),
                       range_km=rng)


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


# ---------------------------------------------------------------------------- level 2: link budget

@dataclass(frozen=True)
class LinkBudgetParams:
    """Every value is an input of the user; nothing here is a catalogue figure (no source publishes them).

    transmit_eirp_dbw: EIRP of the transmitting end for the chosen direction (the lunar terminal for a downlink, the
                       antenna for an uplink), dBW.
    receive_gt_db_per_k: G/T of the receiving end, dB/K.
    """
    frequency_ghz: float
    transmit_eirp_dbw: float
    receive_gt_db_per_k: float
    data_rate_bps: float
    required_ebn0_db: float
    other_losses_db: float = 0.0
    min_margin_db: float = 0.0


def free_space_loss_db(range_km, frequency_ghz: float):
    """Free-space path loss, dB: 20 log10(4 pi d f / c), d in metres and f in hertz."""
    d_m = np.asarray(range_km, dtype=np.float64) * 1000.0
    return 20.0 * np.log10(4.0 * np.pi * d_m * frequency_ghz * 1e9 / SPEED_OF_LIGHT_M_S)


def ebn0_db(range_km, p: LinkBudgetParams):
    """Received Eb/N0, dB:  EIRP - L_fs - L_other + G/T - 10 log10(k) - 10 log10(R).

    The textbook link equation (Wertz and Larson, Space Mission Analysis and Design; Pratt et al., Satellite
    Communications): the carrier-to-noise-density ratio C/N0 = EIRP - L + G/T - 10 log10(k), and Eb/N0 = C/N0 - 10 log10(R).
    Left out: atmosphere and rain at the antenna, pointing and polarisation losses (unless the user puts them in
    ``other_losses_db``), Doppler, solar noise, implementation loss.
    """
    return (p.transmit_eirp_dbw - free_space_loss_db(range_km, p.frequency_ghz) - p.other_losses_db
            + p.receive_gt_db_per_k - BOLTZMANN_DBW_PER_K_HZ - 10.0 * np.log10(p.data_rate_bps))


def margin_db(range_km, p: LinkBudgetParams):
    """Eb/N0 available minus the Eb/N0 required, dB (positive = the link closes with room to spare)."""
    return ebn0_db(range_km, p) - p.required_ebn0_db


def max_data_rate_bps(range_km, p: LinkBudgetParams):
    """Highest data rate that still leaves ``min_margin_db`` of margin, bits per second (the margin is 0 dB at this rate
    when min_margin_db = 0)."""
    spare_db = margin_db(range_km, p) - p.min_margin_db          # dB of rate headroom at the requested rate
    return p.data_rate_bps * 10.0 ** (np.asarray(spare_db) / 10.0)


# ---------------------------------------------------------------------------- bands and G/T estimates

#: Lunar (near-Earth, category A) bands. Space-to-Earth edges: S 2200-2290 MHz, X 8450-8500 MHz, Ka 25.5-27.0 GHz
#: (SFCG / ITU allocations for missions within 2 million km; the DSN's 8400-8450 MHz and 31.8-32.3 GHz are deep-space
#: bands). Earth-to-space: S 2025-2110 MHz; X 7190-7235 MHz and Ka 22.55-23.15 GHz are listed as to be confirmed.
#: The representative frequency is the centre of each range: within a band the free-space loss changes by less
#: than 0.1 dB, so a mission's exact channel does not change the answer.
LUNAR_BANDS: dict[str, dict] = {
    "S": {"downlink_ghz": (2.200, 2.290), "uplink_ghz": (2.025, 2.110)},
    "X": {"downlink_ghz": (8.450, 8.500), "uplink_ghz": (7.190, 7.235)},
    "Ka": {"downlink_ghz": (25.5, 27.0), "uplink_ghz": (22.55, 23.15)},
}


def band_frequency_ghz(band: str, direction: str = "downlink") -> float:
    """Centre of the band for that direction, GHz."""
    lo, hi = LUNAR_BANDS[band]["downlink_ghz" if direction == "downlink" else "uplink_ghz"]
    return (lo + hi) / 2.0


def band_of_frequency(frequency_ghz: float, direction: str = "downlink") -> str:
    """The band whose range contains the frequency, or the nearest one by its centre (a typed frequency outside every
    range still gets the G/T of the closest band)."""
    key = "downlink_ghz" if direction == "downlink" else "uplink_ghz"
    for band, spec in LUNAR_BANDS.items():
        lo, hi = spec[key]
        if lo <= frequency_ghz <= hi:
            return band
    return min(LUNAR_BANDS, key=lambda b: abs(np.log(frequency_ghz / band_frequency_ghz(b, direction))))


def scale_gt_db_per_k(reference_gt_db_per_k: float, reference_diameter_m: float, diameter_m: float) -> float:
    """G/T of a dish of another diameter in the same band and receiver class: G grows with the aperture area (D^2)
    and the system noise temperature of a cryogenic deep-space receiver is about the same, so
    G/T = G/T_ref + 20 log10(D / D_ref). An estimate, flagged as such wherever it is used."""
    return reference_gt_db_per_k + 20.0 * np.log10(diameter_m / reference_diameter_m)
