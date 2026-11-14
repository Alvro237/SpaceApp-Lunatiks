"""Single place for paths, physical constants and data-source URLs.

Conventions (see CLAUDE.md, they must not drift):
  * Frame: Moon Mean-Earth / polar axis (SPICE ``MOON_ME``), the frame of LOLA products and of
    Horizons lunar surface sites.
  * Reference sphere radius 1737.4 km, east-positive longitude, planetocentric latitude.
  * Time: UTC outside, TDB (ET) inside SPICE.
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PIPELINE_DIR = ROOT / "pipeline"
DATASET_DIR = ROOT / "data"               # committed datasets read by the API (see data/README.md)
DATA_DIR = DATASET_DIR / "raw"            # git-ignored: raw downloads and caches
KERNEL_DIR = DATA_DIR / "kernels"
DEM_CACHE_DIR = DATA_DIR / "dem"
WEB_DATA_DIR = DATASET_DIR                # historical name: where the build output is written
FIXTURE_DIR = ROOT / "api" / "tests" / "fixtures"
GRID_DIR = DATASET_DIR / "grids"
CRATER_DIR = DATASET_DIR / "craters"

MOON_RADIUS_KM = 1737.4            # LOLA / Horizons reference radius
SUN_RADIUS_KM = 695_700.0          # IAU nominal solar radius (Horizons uses the same)
EARTH_RADIUS_KM = 6378.137         # equatorial radius used by Horizons as interfering body
SOLAR_CONSTANT_W_M2 = 1361.0       # total solar irradiance at 1 au (nominal)
AU_KM = 149_597_870.700

NAIF_BASE = "https://naif.jpl.nasa.gov/pub/naif/generic_kernels"

# role -> (relative url, description). File names are verified against the NAIF listing of
# 2026-11-13. moon_de440_220930.tf is archived (404); the current frame kernel is 250416.
KERNELS: dict[str, dict[str, str]] = {
    "lsk": {
        "file": "naif0012.tls",
        "url": f"{NAIF_BASE}/lsk/naif0012.tls",
        "description": "Leapseconds kernel (UTC <-> TDB)",
    },
    "pck_constants": {
        "file": "pck00011.tpc",
        "url": f"{NAIF_BASE}/pck/pck00011.tpc",
        "description": "Planetary constants (body radii)",
    },
    "spk": {
        "file": "de440s.bsp",
        "url": f"{NAIF_BASE}/spk/planets/de440s.bsp",
        "description": "JPL DE440 planetary ephemeris, 1849-2150 (short version)",
    },
    "pck_moon": {
        "file": "moon_pa_de440_200625.bpc",
        "url": f"{NAIF_BASE}/pck/moon_pa_de440_200625.bpc",
        "description": "High-accuracy lunar orientation (principal axes) from DE440",
    },
    "fk_moon": {
        "file": "moon_de440_250416.tf",
        "url": f"{NAIF_BASE}/fk/satellites/moon_de440_250416.tf",
        "description": "Lunar frame kernel: defines MOON_ME / MOON_PA aliases for DE440",
    },
}

# Kernels for the ground-station (radio link) dataset. They are NOT used by the Sun/Earth ephemeris build,
# so they live apart from KERNELS and write their own manifest. File names and sizes were read from the NAIF
# directory listings on 2026-11-14. Dated names are used instead of the moving `earth_latest_high_prec.bpc`
# so that a rebuild is reproducible (the manifest records the SHA-256).
#   station SPK: position of the DSN antennas in the Earth-fixed frame ITRF93 (DSS-14/15/24/25/26 Goldstone,
#                DSS-34/35/36/43/45 Canberra, DSS-54/55/63/65 Madrid; read from the kernel's comment file).
#   topocentric FK: local east/north/up frame of every station.
#   Earth PCKs: orientation of the Earth (rotation and polar motion). The high-precision file ends in 2027-02;
#               the predict file continues to 2126 at lower accuracy.
STATION_KERNELS: dict[str, dict[str, str]] = {
    "station_spk": {
        "file": "earthstns_itrf93_260814.bsp",
        "url": f"{NAIF_BASE}/spk/stations/earthstns_itrf93_260814.bsp",
        "description": "DSN station positions in ITRF93 (NAIF, 2026-08-14)",
    },
    "station_fk": {
        "file": "earth_topo_260814.tf",
        "url": f"{NAIF_BASE}/fk/stations/earth_topo_260814.tf",
        "description": "Topocentric (east/north/up) frames of the DSN stations (NAIF, 2026-08-14)",
    },
    "earth_pck_high_precision": {
        "file": "earth_000101_270208_261113.bpc",
        "url": f"{NAIF_BASE}/pck/earth_000101_270208_261113.bpc",
        "description": "High-precision Earth orientation, 2000-01-01 to 2027-02-08 (NAIF, 2026-11-13)",
    },
    "earth_pck_predict": {
        "file": "earth_2026_260806_2126_predict.bpc",
        "url": f"{NAIF_BASE}/pck/earth_2026_260806_2126_predict.bpc",
        "description": "Predicted Earth orientation, 2026 to 2126, lower accuracy (NAIF, 2026-08-08)",
    },
}

# NASA PGDA LOLA south pole products (Barker et al.). Cloud-Optimized GeoTIFFs that answer HTTP
# range requests, so windows are read without downloading the multi-gigabyte files.
PGDA_LOLA_BASE = "https://pgda.gsfc.nasa.gov/data/LOLA_20mpp"

# NASA PGDA lunar polar illumination products (Mazarico et al. 2011), product 69.
PGDA_ILLUMINATION_BASE = "https://pgda.gsfc.nasa.gov/data/MoonIllumination"

# USGS Astrogeology: Robbins (2018) lunar crater database, craters >= 1-2 km (zip, ~96 MB).
ROBBINS_URL = ("https://astrogeology.usgs.gov/ckan/dataset/f89f5478-b69a-486c-b9b5-30d7b0c5ad2b/resource/"
               "c4f25cc2-4f8a-4207-a845-5e176da3ac5a/download/lunar_crater_database_robbins_2018")
