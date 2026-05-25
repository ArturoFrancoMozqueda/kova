import os

import pytest
from fastapi.testclient import TestClient


def test_health_ok(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


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
