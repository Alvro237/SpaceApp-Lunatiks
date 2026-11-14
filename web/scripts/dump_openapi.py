"""Write the API's OpenAPI document to stdout without starting a server.

Run from web/:  uv run --project ../api python scripts/dump_openapi.py > src/api/openapi.json
The frontend's typed client (src/api/schema.gen.ts) is generated from that file with openapi-typescript,
so a change in the API contract breaks the frontend build instead of failing on screen.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "api"))

from app.main import create_app  # noqa: E402

json.dump(create_app().openapi(), sys.stdout, indent=1, sort_keys=True)
sys.stdout.write("\n")
