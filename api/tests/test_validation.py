"""Validation report: every model check passes on the real datasets and the endpoint serves them."""
from __future__ import annotations

from fastapi.testclient import TestClient

from app.db.store import get_store
from app.main import app
from app.validation_checks import run_all

client = TestClient(app)


def test_every_model_check_passes():
    checks = run_all(get_store())
    failed = [(c.id, c.computed) for c in checks if not c.passed]
    assert not failed, failed
    assert len({c.id for c in checks}) == len(checks) and all(c.source and c.reference for c in checks)


def test_validation_endpoint():
    r = client.get("/api/v1/validation")
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["all_passed"] is True and b["passed"] == b["total"] >= 8
    assert b["pipeline"]["ephemerisVsHorizons"]["maxElevationErrorDeg"] < 0.01
    ids = {c["id"] for c in b["model_checks"]}
    assert "eclipse-blue-ghost-2025-03-14" in ids and "thermal-radiative-equilibrium" in ids
