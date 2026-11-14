"""Runtime settings. Everything is overridable with environment variables so the same code runs
locally, in tests and on the host."""
from __future__ import annotations

import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]

# Folder with the committed datasets (see data/README.md).
DATA_DIR = Path(os.environ.get("LUNATIKS_DATA_DIR", REPO_ROOT / "data"))

# Comma-separated list of allowed browser origins; "*" while the frontend host is undecided.
CORS_ORIGINS = [o.strip() for o in os.environ.get("LUNATIKS_CORS_ORIGINS", "*").split(",") if o.strip()]

API_PREFIX = "/api/v1"
API_VERSION = "0.1.0"
