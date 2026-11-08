import os

import pytest
from fastapi.testclient import TestClient


def test_health_ok(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "release_sha": "unknown"}


def test_health_head_ok(client: TestClient) -> None:
    response = client.head("/health")
    assert response.status_code == 200
    assert response.content == b""


def test_root_ok(client: TestClient) -> None:
    response = client.get("/")
    assert response.status_code == 200
    assert response.json()["app"] == "pos-backend"


@pytest.mark.skipif(
    not os.getenv("DATABASE_URL"),
    reason="DATABASE_URL not set; skipping DB connectivity test (CI provides it)",
)
def test_health_db_reachable(client: TestClient) -> None:
    response = client.get("/health/db")
    assert response.status_code == 200
    assert response.json()["db"] == "reachable"


@pytest.mark.skipif(
    not os.getenv("DATABASE_URL"),
    reason="DATABASE_URL not set; skipping DB connectivity test (CI provides it)",
)
def test_health_db_head_ok(client: TestClient) -> None:
    response = client.head("/health/db")
    assert response.status_code == 200
    assert response.content == b""


def test_database_connection_timeout_has_safe_actionable_classification(caplog):
    from psycopg.errors import ConnectionTimeout

    from app.health.router import _log_database_failure

    try:
        try:
            raise ConnectionTimeout("private-database-location-and-credentials")
        except ConnectionTimeout as exc:
            raise RuntimeError("private-driver-details") from exc
    except RuntimeError as exc:
        _log_database_failure(exc)

    assert "type=RuntimeError reason=timeout" in caplog.text
    assert "private-" not in caplog.text
