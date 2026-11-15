"""Ground-station dataset for the radio link: antennas, their elevation limits and the Moon in the Earth-fixed frame.

Two outputs, both read by the API through ``api/app/db/stations.py``:

``data/moon_itrf_2025_2035.f32``
    Hourly geocentric Moon vector in the Earth-fixed frame ITRF93 (km, float32, ``[sample][x, y, z]``), light time and
    stellar aberration corrected (``LT+S``), on the same hourly grid as the Sun/Earth tables. One table serves every
    antenna, including antennas the user types in: the API subtracts the antenna's own ECEF vector and projects on its
    local east/north/up basis. The Earth's rotation and polar motion come from NAIF's Earth orientation PCKs
    (high-precision where available, predicted afterwards).

``data/ground_stations.json``
    The catalogue (``dsn``, ``estrack``, ``jaxa``): geodetic position, antenna and elevation limits, with the source of
    every value. Elevation limits are per-azimuth masks for the DSN (NASA/JPL 810-005 module 301 horizon-mask
    workbook) and JAXA (its published horizon masks) and a single 6 deg estimate for ESA, flagged
    ``owner_estimate`` because ESA publishes no figure (6 deg is the mechanical limit the DSN handbook gives for
    azimuth-elevation antennas).

Run: ``uv run python -m lunarnav.ground_stations`` (downloads kernels and the mask files into data/raw first).

CSPICE cannot open files under a path with non-ASCII characters on Windows, so the kernels are furnished by relative
name from the kernel directory.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
from datetime import datetime, timezone

import numpy as np
import requests
import spiceypy as spice

from .config import DATA_DIR, DATASET_DIR, FIXTURE_DIR, KERNELS, KERNEL_DIR, STATION_KERNELS
from .download import download_kernels, download_station_kernels
from .ephemeris import SEGMENTS, utc_grid

MASK_DIR = DATA_DIR / "ground_stations"
MOON_TABLE_FILE = "moon_itrf_2025_2035.f32"
CATALOG_FILE = "ground_stations.json"

EARTH_RADIUS_KM = 6378.137          # WGS84 equatorial radius
EARTH_FLATTENING = 1.0 / 298.257223563
RETRIEVED = datetime.now(timezone.utc).date().isoformat()

DSN_MASKS_URL = "https://deepspace.jpl.nasa.gov/dsndocs/810-005/301/Horizon-Masks-Download-V2-301O.xlsx"
DSN_HANDBOOK_URL = "https://deepspace.jpl.nasa.gov/dsndocs/810-005/301/301N.pdf"
JAXA_PAGE_URL = "https://ddor.nav.isas.jaxa.jp/station_coordinates"
JAXA_MASKS = {
    "misasa": "Misasa_horizon_mask.xls",
    "usuda": "UDSC_horizon_mask.xls",
    "uchinoura": "USC_horizon_mask.xls",
}

# DSN antennas that have a horizon mask in the 301-O workbook (effective 2024-05-01), grouped by complex.
DSN_COMPLEXES = {
    "Goldstone": {"country": "United States", "dss": (14, 24, 25, 26)},
    "Canberra": {"country": "Australia", "dss": (34, 35, 36, 43)},
    "Madrid": {"country": "Spain", "dss": (54, 55, 63, 65)},
}

# ESA deep-space antennas (35 m). Positions: ITRF coordinates of the ESA GNSS station on each site, from the IGS site
# logs. They are not the dish reference points (a few hundred metres away at most), which is far below what the Moon's
# visibility needs: 1 km shifts the direction to the Moon by 0.009 deg.
ESA_STATIONS = [
    {"id": "esa-dsa1-new-norcia", "name": "New Norcia (DSA 1)", "site": "New Norcia", "country": "Australia",
     "ecef_m": (-2414151.326, 4907778.436, -3270645.333), "bands": None,
     "position_source": "IGS site log NNOR (2025-11-07), ITRF XYZ",
     "position_url": "https://files.igs.org/pub/station/log/nnor00aus_20251107.log"},
    {"id": "esa-dsa2-cebreros", "name": "Cebreros (DSA 2)", "site": "Cebreros", "country": "Spain",
     "ecef_m": (4846664.918, -370195.200, 4116929.526), "bands": {"transmit": ["X"], "receive": ["X", "Ka"]},
     "position_source": "IGS site log CEBR (2025-11-07), ITRF XYZ",
     "position_url": "https://files.igs.org/pub/station/log/cebr00esp_20251107.log"},
    {"id": "esa-dsa3-malargue", "name": "Malargüe (DSA 3)", "site": "Malargüe", "country": "Argentina",
     "ecef_m": (1823327.909, -4850352.447, -3709085.536), "bands": {"transmit": ["X"], "receive": ["X", "Ka"]},
     "position_source": "IGS site log MGUE (2026-10-21), ITRF XYZ",
     "position_url": "https://files.igs.org/pub/station/log/mgue00arg_20261021.log"},
]
ESA_MIN_ELEVATION_DEG = 6.0

# JAXA antennas: GRS80 geodetic position at epoch 2026.0 from the JAXA station coordinates page (updated 2026-01-11).
JAXA_STATIONS = [
    {"id": "jaxa-misasa-54m", "key": "misasa", "name": "Misasa 54 m (DSS-30)", "diameter_m": 54.0, "dss": 30,
     "lat": 36.140984502, "lon": 138.35212867, "height_m": 1655.993},
    {"id": "jaxa-usuda-64m", "key": "usuda", "name": "Usuda 64 m (DSS-48)", "diameter_m": 64.0, "dss": 48,
     "lat": 36.132403748, "lon": 138.362773862, "height_m": 1532.8122},
    {"id": "jaxa-uchinoura-34m", "key": "uchinoura", "name": "Uchinoura 34 m (DSS-38)", "diameter_m": 34.0, "dss": 38,
     "lat": 31.25430804, "lon": 131.078392333, "height_m": 375.7827},
]


# ------------------------------------------------------------------------------------------------ receive G/T

# Downlink bands for the Moon (space-to-Earth, near-Earth / category A): S 2200-2290 MHz, X 8450-8500 MHz,
# Ka 25.5-27.0 GHz. The DSN's 32 GHz Ka and 8400-8450 MHz X are deep-space (category B) bands, not used for the Moon.
DSN_101 = "DSN 810-005 module 101 Rev. G (70 m), gains p. 13/18, Top Table 4 p. 22-23"
DSN_103 = "DSN 810-005 module 103 Rev. D (34 m HEF), gains p. 15, Top Table 5 p. 19-20"
DSN_104 = "DSN 810-005 module 104 Rev. O (34 m BWG), gains p. 38-42, Top Table 11 p. 48-51"
DSN_CONDITIONS = ("G/T = gain - 10 log10(Top), Top at zenith with 25% CD average clear weather, LNA-1 / HEMT-1, first "
                  "listed configuration; G/T drops at low elevation")
# DSS number -> band -> (antenna gain dBi, system operating noise temperature Top K, source)
DSN_RX = {
    14: {"S": (63.59, 16.90, DSN_101), "X": (74.55, 16.69, DSN_101)},
    43: {"S": (63.59, 18.43, DSN_101), "X": (74.63, 17.49, DSN_101)},
    63: {"S": (63.59, 20.10, DSN_101), "X": (74.66, 16.73, DSN_101)},
    65: {"S": (56.07, 38.80, DSN_103), "X": (68.41, 20.70, DSN_103)},
    24: {"S": (56.74, 30.78, DSN_104), "X": (68.27, 26.32, DSN_104), "Ka": (77.2, 27.8, DSN_104)},
    25: {"X": (68.32, 21.20, DSN_104)},
    26: {"S": (56.74, 22.30, DSN_104), "X": (68.32, 21.33, DSN_104), "Ka": (77.2, 41.9, DSN_104)},
    34: {"S": (56.74, 29.74, DSN_104), "X": (68.32, 21.67, DSN_104), "Ka": (77.2, 38.5, DSN_104)},
    35: {"X": (68.32, 20.09, DSN_104)},
    36: {"S": (56.74, 26.43, DSN_104), "X": (68.32, 17.98, DSN_104), "Ka": None},   # K-band receiver, Top not listed
    54: {"S": (56.74, 30.53, DSN_104), "X": (68.32, 23.58, DSN_104), "Ka": (77.2, 40.0, DSN_104)},
    55: {"X": (68.32, 22.69, DSN_104)},
}
ESA_BANDS = {"esa-dsa1-new-norcia": ("S", "X"), "esa-dsa2-cebreros": ("X",), "esa-dsa3-malargue": ("X",)}
ESA_BANDS_SOURCE = "ESA ESOC ground station pages: New Norcia S and X; Cebreros and Malargue X (their Ka is 32 GHz deep space)"
JAXA_BANDS = {"misasa": ("X",), "usuda": ("S", "X"), "uchinoura": ("S", "X")}
JAXA_BANDS_SOURCE = "JAXA station coordinates page (S/X VLBI at Usuda and Uchinoura; the Misasa 54 m has no S-band receiver)"
MISASA_GT = {"gt_db_per_k": 53.35, "basis": "spec", "source": "JAXA GREAT2 project page",
             "note": "design specification, at least this value at 15-80 deg elevation, propagation loss included"}


def _cited(gain_dbi: float, top_k: float, source: str) -> dict:
    return {"gt_db_per_k": round(gain_dbi - 10.0 * np.log10(top_k), 2), "basis": "cited", "gain_dbi": gain_dbi,
            "system_noise_k": top_k, "source": source, "note": DSN_CONDITIONS}


def _supported(source: str) -> dict:
    """The antenna receives in this band but no G/T is published: the API estimates one from the diameter."""
    return {"gt_db_per_k": None, "basis": "unpublished", "source": source}


def receive_gt(station_id: str, dss: int | None = None, jaxa_key: str | None = None) -> dict:
    """Band -> G/T entry for one antenna. A band that is absent means the antenna has no receiver there."""
    if dss is not None:
        return {band: (_cited(*v) if v else _supported(DSN_104)) for band, v in DSN_RX.get(dss, {}).items()}
    if station_id in ESA_BANDS:
        return {band: _supported(ESA_BANDS_SOURCE) for band in ESA_BANDS[station_id]}
    if jaxa_key is not None:
        out = {band: _supported(JAXA_BANDS_SOURCE) for band in JAXA_BANDS[jaxa_key]}
        if jaxa_key == "misasa":
            out["X"] = dict(MISASA_GT)
        return out
    return {}


# ------------------------------------------------------------------------------------------------ downloads

def _sha256(path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _fetch(url: str, name: str) -> dict:
    MASK_DIR.mkdir(parents=True, exist_ok=True)
    target = MASK_DIR / name
    if not target.exists():
        print(f"downloading {url}", flush=True)
        resp = requests.get(url, timeout=120)
        resp.raise_for_status()
        target.write_bytes(resp.content)
    return {"file": name, "url": url, "bytes": target.stat().st_size, "sha256": _sha256(target)}


# ------------------------------------------------------------------------------------------------ mask parsing

def resample_nodes(az_deg: list[float], el_deg: list[float], step_deg: float = 1.0) -> list[float]:
    """Piecewise-linear mask from (azimuth, elevation) nodes onto a uniform grid 0, step, ... 360 - step.
    The nodes wrap around north: the first node is repeated at 360."""
    az = np.asarray(az_deg, dtype=float)
    el = np.asarray(el_deg, dtype=float)
    order = np.argsort(az)
    az, el = az[order], el[order]
    grid = np.arange(0.0, 360.0, step_deg)
    return [round(float(v), 2) for v in np.interp(grid, np.append(az, az[0] + 360.0), np.append(el, el[0]))]


def parse_dsn_workbook(path) -> dict[int, dict]:
    """DSS number -> {dish, diameter_m, receive, transmit_low, transmit_high} with 360 values at 1 deg (az 0..359)."""
    import openpyxl

    wb = openpyxl.load_workbook(path, data_only=True)
    out: dict[int, dict] = {}
    for ws in wb.worksheets:
        m = re.fullmatch(r"DSS-(\d+)", ws.title)
        if not m:
            continue
        hdr = next(((r, c) for r in range(1, 30) for c in range(1, ws.max_column + 1)
                    if isinstance(ws.cell(r, c).value, str) and ws.cell(r, c).value.strip().upper() == "AZIM"), None)
        if hdr is None:
            continue
        r0, c0 = hdr
        rows: dict[int, list] = {}
        for r in range(r0 + 1, ws.max_row + 1):
            az = ws.cell(r, c0).value
            if isinstance(az, (int, float)) and 0 <= az < 360:
                rows[int(round(az))] = [ws.cell(r, c0 + k).value for k in range(1, 5)]
        number = int(m.group(1))
        if len(rows) != 360 or not all(isinstance(rows[a][0], (int, float)) for a in rows):
            continue          # a planned antenna with no mask yet ("NOT AVAILABLE")
        label = str(ws.cell(2, 1).value or "")
        # DSS-43: column 3 is "N/A"; its 80 kW X-band / 100 kW S-band limit (17.5 deg) is in column 4.
        hp_col = 3 if number == 43 and isinstance(rows[0][3], (int, float)) else 2
        out[number] = {
            "dish": "70 m" if "70" in label else ("34 m HEF" if "HEF" in label else "34 m BWG"),
            "diameter_m": 70.0 if "70" in label else 34.0,
            "receive": [round(float(rows[a][0]), 2) for a in range(360)],
            "transmit_low": [round(float(rows[a][1]), 2) for a in range(360)],
            "transmit_high": [round(float(rows[a][hp_col]), 2) for a in range(360)],
        }
    return out


def parse_jaxa_mask(key: str, path) -> list[float]:
    """JAXA horizon mask on a 1 deg azimuth grid (0..359)."""
    import xlrd

    book = xlrd.open_workbook(str(path))
    if key == "misasa":
        sheet = book.sheet_by_name("GREAT Ant Skyline")          # 1 deg steps, columns Az and EL
        pts = [(sheet.cell_value(i, 0), sheet.cell_value(i, 1)) for i in range(sheet.nrows)
               if isinstance(sheet.cell_value(i, 0), float) and isinstance(sheet.cell_value(i, 1), float)]
    elif key == "uchinoura":
        sheet = book.sheet_by_index(0)                            # 5 deg steps listed from 360 down to 0
        pts = [(sheet.cell_value(i, 1), sheet.cell_value(i, 2)) for i in range(sheet.nrows)
               if isinstance(sheet.cell_value(i, 1), float) and isinstance(sheet.cell_value(i, 2), float)]
        pts = [(a % 360.0, e) for a, e in pts if a < 360.0]       # 360 repeats 0
    elif key == "usuda":
        sheet = book.sheet_by_name("value")                       # 25 nodes: node, azimuth, elevation
        pts = []
        for i in range(sheet.nrows):
            node, az, el = sheet.cell_value(i, 0), sheet.cell_value(i, 1), sheet.cell_value(i, 2)
            try:
                if float(node) >= 1 and az != "" and el != "":
                    pts.append((float(az), float(el)))
            except (TypeError, ValueError):
                continue
    else:
        raise KeyError(key)
    if len(pts) < 20:
        raise ValueError(f"JAXA mask {key}: only {len(pts)} nodes parsed")
    return resample_nodes([p[0] for p in pts], [p[1] for p in pts])


# ------------------------------------------------------------------------------------------------ SPICE

def _furnish() -> None:
    spice.kclear()
    # The Earth PCKs overlap; a kernel loaded later takes priority, so predicts first, then high precision.
    names = [KERNELS["lsk"]["file"], KERNELS["pck_constants"]["file"], KERNELS["spk"]["file"],
             STATION_KERNELS["earth_pck_predict"]["file"], STATION_KERNELS["earth_pck_high_precision"]["file"],
             STATION_KERNELS["station_spk"]["file"], STATION_KERNELS["station_fk"]["file"]]
    for name in names:
        if not (KERNEL_DIR / name).exists():
            raise FileNotFoundError(f"{KERNEL_DIR / name} missing")
        spice.furnsh(name)


def _geodetic(ecef_km: np.ndarray) -> tuple[float, float, float]:
    lon, lat, alt = spice.recgeo(np.asarray(ecef_km, dtype=float), EARTH_RADIUS_KM, EARTH_FLATTENING)
    return float(np.degrees(lat)), float(np.degrees(lon)), float(alt * 1000.0)


def moon_itrf_table() -> np.ndarray:
    seg = SEGMENTS[0]
    strings = [t.strftime("%Y-%m-%d %H:%M:%S") + " UTC" for t in utc_grid(seg["start"], seg["end"], seg["step_s"])]
    ets = np.asarray(spice.str2et(strings))
    pos, _lt = spice.spkpos("MOON", ets, "ITRF93", "LT+S", "EARTH")
    return np.asarray(pos)


def _reference_fixtures(stations: dict[str, dict]) -> dict:
    """SPICE's own topocentric azimuth/elevation of the Moon at instants that are NOT on the hourly grid: the API test
    compares its interpolation and its numpy frame conversion against these."""
    instants = ["2025-03-14 03:17:42", "2026-11-14 18:41:05", "2027-03-01 07:29:31", "2027-09-12 22:03:58",
                "2029-06-21 11:11:11", "2031-01-30 15:45:20", "2033-08-08 01:25:50", "2034-12-24 09:50:09"]
    out = []
    for sid, dss in (("dss-14", 14), ("dss-43", 43), ("dss-63", 63)):
        for ts in instants:
            et = spice.str2et(ts + " UTC")
            vec, _ = spice.spkpos("MOON", et, f"DSS-{dss:02d}_TOPO", "LT+S", f"{399000 + dss}")
            # NAIF's DSS-nn_TOPO frames are X north, Y west, Z up (earth_topo_*.tf), so east = -Y.
            az = float(np.degrees(np.arctan2(-vec[1], vec[0])) % 360.0)
            el = float(np.degrees(np.arcsin(vec[2] / np.linalg.norm(vec))))
            out.append({"station": sid, "utc": ts + "Z", "az_deg": round(az, 6), "el_deg": round(el, 6)})
    return {"description": "Moon azimuth/elevation from SPICE (topocentric DSS frames, LT+S) at off-grid instants",
            "stations": {sid: {"lat_deg": stations[sid]["lat_deg"], "lon_deg": stations[sid]["lon_deg"],
                               "height_m": stations[sid]["height_m"]} for sid in ("dss-14", "dss-43", "dss-63")},
            "cases": out}


# ------------------------------------------------------------------------------------------------ build

def _kernel_provenance() -> list[dict]:
    rows = []
    for manifest_name in ("kernels_manifest.json", "station_kernels_manifest.json"):
        manifest = json.loads((DATA_DIR / manifest_name).read_text())["kernels"]
        for role, k in manifest.items():
            if role in ("lsk", "pck_constants", "spk") or manifest_name.startswith("station"):
                rows.append({"file": k["file"], "url": k["url"], "bytes": k["bytes"], "sha256": k["sha256"],
                             "description": k["description"]})
    return rows


def build() -> dict:
    download_kernels()
    download_station_kernels()
    dsn_file = _fetch(DSN_MASKS_URL, "Horizon-Masks-Download-V2-301O.xlsx")
    jaxa_files = {key: _fetch(f"{JAXA_PAGE_URL}/{name}", name) for key, name in JAXA_MASKS.items()}

    cwd = os.getcwd()
    os.chdir(KERNEL_DIR)
    try:
        _furnish()
        et0 = spice.str2et("2027-01-01 00:00:00 UTC")
        masks = parse_dsn_workbook(MASK_DIR / dsn_file["file"])
        stations: list[dict] = []

        for complex_name, spec in DSN_COMPLEXES.items():
            for number in spec["dss"]:
                mask = masks[number]
                ecef, _ = spice.spkpos(f"{399000 + number}", et0, "ITRF93", "NONE", "399")
                lat, lon, h = _geodetic(ecef)
                stations.append({
                    "id": f"dss-{number}", "name": f"DSS-{number} ({complex_name})", "network": "dsn",
                    "agency": "NASA / JPL Deep Space Network", "site": complex_name, "country": spec["country"],
                    "lat_deg": round(lat, 6), "lon_deg": round(lon, 6), "height_m": round(h, 1),
                    "diameter_m": mask["diameter_m"], "dish": mask["dish"], "bands": None,
                    "receive_gt": receive_gt(f"dss-{number}", dss=number),
                    "position_source": "NAIF station SPK earthstns_itrf93_260814.bsp (ITRF93, epoch 2027-01-01)",
                    "elevation_limits": {
                        "source": "cited",
                        "source_note": "DSN 810-005 module 301 horizon-mask workbook (301-O, effective 2024-05-01): "
                                       "receive, low-power (<= 20 kW) and high-power transmit limits per azimuth",
                        "azimuth_step_deg": 1.0,
                        "receive_deg": mask["receive"],
                        "transmit_low_deg": mask["transmit_low"],
                        "transmit_high_deg": mask["transmit_high"],
                    },
                })

        for e in ESA_STATIONS:
            lat, lon, h = _geodetic(np.asarray(e["ecef_m"]) / 1000.0)
            stations.append({
                "id": e["id"], "name": e["name"], "network": "estrack", "agency": "ESA ESTRACK",
                "site": e["site"], "country": e["country"], "lat_deg": round(lat, 6), "lon_deg": round(lon, 6),
                "height_m": round(h, 1), "diameter_m": 35.0, "dish": "35 m deep-space antenna", "bands": e["bands"],
                "receive_gt": receive_gt(e["id"]),
                "position_source": e["position_source"] + "; the GNSS station of the site, not the dish reference point",
                "position_url": e["position_url"],
                "elevation_limits": {
                    "source": "owner_estimate",
                    "source_note": "ESA publishes no minimum elevation (its stations are licensed with one). "
                                   "6 deg is the mechanical limit the DSN handbook gives for azimuth-elevation "
                                   "antennas (810-005 module 301, section 2.2.2); not an ESA figure.",
                    "azimuth_step_deg": None,
                    "receive_deg": ESA_MIN_ELEVATION_DEG,
                    "transmit_low_deg": None,
                    "transmit_high_deg": None,
                },
            })

        for j in JAXA_STATIONS:
            mask = parse_jaxa_mask(j["key"], MASK_DIR / jaxa_files[j["key"]]["file"])
            stations.append({
                "id": j["id"], "name": j["name"], "network": "jaxa", "agency": "JAXA", "site": j["key"].capitalize(),
                "country": "Japan", "lat_deg": j["lat"], "lon_deg": j["lon"], "height_m": j["height_m"],
                "diameter_m": j["diameter_m"], "dish": f"{j['diameter_m']:.0f} m deep-space antenna", "bands": None,
                "receive_gt": receive_gt(j["id"], jaxa_key=j["key"]),
                "position_source": f"JAXA station coordinates page, GRS80 at epoch 2026.0 (DSN id DSS-{j['dss']})",
                "elevation_limits": {
                    "source": "cited",
                    "source_note": "JAXA published downlink horizon mask (skyline) for this antenna; it is a terrain "
                                   "mask and goes below the 6 deg mechanical limit of the DSN antennas in places",
                    "azimuth_step_deg": 1.0,
                    "receive_deg": mask,
                    "transmit_low_deg": None,
                    "transmit_high_deg": None,
                },
            })

        by_id = {s["id"]: s for s in stations}
        table = moon_itrf_table()
        fixtures = _reference_fixtures(by_id)
    finally:
        spice.kclear()
        os.chdir(cwd)

    seg = SEGMENTS[0]
    start_ms = int(datetime.fromisoformat(seg["start"]).replace(tzinfo=timezone.utc).timestamp() * 1000)
    (DATASET_DIR / MOON_TABLE_FILE).write_bytes(table.astype("<f4").tobytes())
    catalog = {
        "frame": "Positions: WGS84 geodetic (latitude north-positive, longitude east-positive, height above the "
                 "ellipsoid in metres). Azimuth clockwise from north. Elevation limits in degrees.",
        "networks": {
            "dsn": "NASA Deep Space Network (Goldstone, Canberra, Madrid)",
            "estrack": "ESA ESTRACK deep-space antennas (New Norcia, Cebreros, Malargüe)",
            "jaxa": "JAXA deep-space antennas (Misasa, Usuda, Uchinoura)",
        },
        "moon_table": {
            "file": MOON_TABLE_FILE, "startUnixMs": start_ms, "stepSeconds": seg["step_s"], "count": int(table.shape[0]),
            "layout": "float32 little-endian [sample][x, y, z], km, geocentric, Earth-fixed frame ITRF93",
            "correction": "LT+S", "kernels": _kernel_provenance(),
        },
        "sources": {
            "dsn_horizon_masks": {**dsn_file, "retrieved": RETRIEVED, "handbook": DSN_HANDBOOK_URL},
            "jaxa_horizon_masks": {k: {**v, "retrieved": RETRIEVED} for k, v in jaxa_files.items()},
            "jaxa_page": JAXA_PAGE_URL,
        },
        "stations": stations,
    }
    (DATASET_DIR / CATALOG_FILE).write_text(json.dumps(catalog, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    FIXTURE_DIR.mkdir(parents=True, exist_ok=True)
    (FIXTURE_DIR / "station_reference.json").write_text(json.dumps(fixtures, indent=1) + "\n", encoding="utf-8")
    return catalog


if __name__ == "__main__":
    cat = build()
    print(f"{len(cat['stations'])} stations, Moon table {cat['moon_table']['count']} samples")
