"""Reproduce every data file the web app serves.

    cd pipeline
    uv sync
    uv run python -m lunarnav.build            # everything (first run downloads ~50 MB of kernels
                                               # and reads DEM windows from NASA PGDA, then caches)
    uv run python -m lunarnav.build --no-dem   # only kernels + ephemeris + provenance
"""
from __future__ import annotations

import sys

from .basemap import build_basemap
from .build_sites import build_sites
from .download import download_kernels
from .ephemeris import write_ephemeris
from .provenance import write_provenance
from .validate import write_validation


def main() -> None:
    skip_dem = "--no-dem" in sys.argv
    manifest = download_kernels()
    write_ephemeris(manifest)
    if not skip_dem:
        build_sites()
        build_basemap()
    write_provenance(manifest)
    write_validation()


if __name__ == "__main__":
    main()
