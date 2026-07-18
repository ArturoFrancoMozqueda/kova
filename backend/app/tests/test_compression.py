"""GZip response compression (perf pass 2026-07).

Large JSON payloads (reports/business-story) must be compressed when the
client negotiates it; tiny responses stay uncompressed (below minimum_size).
"""
from fastapi.testclient import TestClient


def test_large_response_is_gzipped_when_negotiated(client: TestClient) -> None:
    # /openapi.json is available in the local test env and is far above the
    # 1 KB compression threshold.
    response = client.get("/openapi.json", headers={"Accept-Encoding": "gzip"})
    assert response.status_code == 200
    assert response.headers.get("content-encoding") == "gzip"
    # httpx transparently decompresses; the body must still be valid JSON.
    assert response.json()["info"]["title"] == "POS API"


def test_small_response_is_not_gzipped(client: TestClient) -> None:
    response = client.get("/health", headers={"Accept-Encoding": "gzip"})
    assert response.status_code == 200
    assert "content-encoding" not in response.headers


def test_no_gzip_without_accept_encoding(client: TestClient) -> None:
    response = client.get("/openapi.json", headers={"Accept-Encoding": "identity"})
    assert response.status_code == 200
    assert "content-encoding" not in response.headers
