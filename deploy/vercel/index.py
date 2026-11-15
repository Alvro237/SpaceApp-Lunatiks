"""Vercel entry point: the FastAPI app of ``api/app``, served on the same domain as the web.

The staging script (``deploy/vercel/stage.sh``) copies ``api/app`` to ``server/app`` and the datasets to ``data/``,
so ``app.config.REPO_ROOT`` (two folders above ``server/app/config.py``) is the deployment root and finds ``data/``.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "server"))

from app.main import app  # noqa: E402,F401  (Vercel serves the ASGI object named ``app``)
