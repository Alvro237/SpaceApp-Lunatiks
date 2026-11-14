"""Download the SPICE kernels and record their provenance (size, hash, server date)."""
from __future__ import annotations

import hashlib
import json
import sys
from datetime import datetime, timezone

import requests

from .config import DATA_DIR, KERNEL_DIR, KERNELS


def _sha256(path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def download_kernels(force: bool = False) -> dict:
    KERNEL_DIR.mkdir(parents=True, exist_ok=True)
    manifest: dict[str, dict] = {}
    for role, spec in KERNELS.items():
        target = KERNEL_DIR / spec["file"]
        if force or not target.exists():
            print(f"downloading {spec['url']}", flush=True)
            with requests.get(spec["url"], stream=True, timeout=120) as resp:
                resp.raise_for_status()
                last_modified = resp.headers.get("Last-Modified", "")
                with open(target, "wb") as fh:
                    for chunk in resp.iter_content(chunk_size=1 << 20):
                        fh.write(chunk)
        else:
            head = requests.head(spec["url"], timeout=60, allow_redirects=True)
            last_modified = head.headers.get("Last-Modified", "")
        manifest[role] = {
            "file": spec["file"],
            "url": spec["url"],
            "description": spec["description"],
            "bytes": target.stat().st_size,
            "sha256": _sha256(target),
            "server_last_modified": last_modified,
        }
    manifest_path = DATA_DIR / "kernels_manifest.json"
    manifest_path.write_text(
        json.dumps(
            {"retrieved_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"), "kernels": manifest},
            indent=2,
        )
    )
    return manifest


if __name__ == "__main__":
    download_kernels(force="--force" in sys.argv)
    print("kernels ready in", KERNEL_DIR)
