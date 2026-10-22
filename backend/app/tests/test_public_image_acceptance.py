import importlib.util
import sys
from pathlib import Path
from unittest.mock import MagicMock
from uuid import uuid4

import httpx
import pytest

_scripts = Path(__file__).resolve().parents[2] / "scripts"
_spec = importlib.util.spec_from_file_location("public_image_acceptance", _scripts / "check_public_image_cache.py")
script = importlib.util.module_from_spec(_spec)
sys.path.insert(0, str(_scripts))
try:
    _spec.loader.exec_module(script)
finally:
    sys.path.remove(str(_scripts))

OWNER = "postgresql://postgres:synthetic-owner@db.example.com:5432/postgres?sslmode=require"


def connection(row):
    conn = MagicMock()
    conn.__enter__.return_value = conn
    conn.execute.return_value.fetchone.return_value = row
    connect = MagicMock(return_value=conn)
    return connect, conn


def test_discovery_is_read_only_and_never_reads_image_bytes():
    product = uuid4()
    connect, conn = connection((product, f"/api/v1/catalog/products/{product}/image?v=123"))
    assert script.discover_photo(OWNER, connect=connect).endswith("?v=123&w=160")
    sql = [call.args[0] for call in conn.execute.call_args_list]
    assert sql[0] == "SET TRANSACTION READ ONLY"
    assert sql[1] == "SET LOCAL statement_timeout = '5s'"
    assert len(sql) == 3 and sql[2].startswith("SELECT p.id, p.image_url ")
    assert "bytes_data" not in sql[2] and "t.is_active" in sql[2]
    assert connect.call_args.kwargs["prepare_threshold"] is None


@pytest.mark.parametrize("url", ["https://evil.invalid/image?v=123", "/other?v=123", "/image?v=123&token=private"])
def test_discovery_never_follows_a_stored_url_to_another_path_or_origin(url):
    connect, _ = connection((uuid4(), url))
    with pytest.raises(script.VerificationError, match="URL"):
        script.discover_photo(OWNER, connect=connect)


def test_discovery_fails_without_images_and_never_creates_data():
    connect, conn = connection(None)
    with pytest.raises(script.VerificationError, match="no data was created"):
        script.discover_photo(OWNER, connect=connect)
    assert len(conn.execute.call_args_list) == 3


def test_database_errors_do_not_expose_credentials():
    connect = MagicMock(side_effect=RuntimeError("sensitive-connection-material"))
    with pytest.raises(script.VerificationError) as caught:
        script.discover_photo(OWNER, connect=connect)
    assert "sensitive" not in str(caught.value)


def test_real_photo_acceptance_requires_cache_hits_and_keeps_private_api_uncached(monkeypatch):
    calls = []
    image_counts = {}

    def respond(request):
        calls.append(request)
        if request.url.path == "/health":
            return httpx.Response(200, json={"release_sha": "a" * 40}, headers={"x-kova-runtime": "native-resident"})
        if request.url.path.endswith("/image"):
            image_counts[request.url.host] = image_counts.get(request.url.host, 0) + 1
            return httpx.Response(200, content=b"synthetic-image", headers={
                "content-type": "image/webp", "cache-control": "public, max-age=300",
                "x-kova-image-cache": "MISS" if image_counts[request.url.host] == 1 else "HIT",
            })
        if request.url.path.endswith("/session"):
            return httpx.Response(200, json={"authenticated": False}, headers={"cache-control": "private, no-store"})
        return httpx.Response(401, headers={"cache-control": "private, no-store"})

    monkeypatch.setattr(script.time, "sleep", lambda _: None)
    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        result = script.verify(client, "/api/v1/catalog/products/image?v=123&w=160", "a" * 40)
    assert result["same_image"] and result["private_api_no_store"]
    assert len(result["samples"]) == 2
    assert all(request.method == "GET" and "cookie" not in request.headers for request in calls)


@pytest.mark.parametrize("headers", [
    {"cache-control": "private, no-store"}, {"set-cookie": "session=synthetic"},
    {"content-type": "text/html"}, {"x-kova-image-cache": "unknown"},
])
def test_public_photo_acceptance_rejects_unsafe_or_uncached_responses(headers):
    safe = {"content-type": "image/webp", "cache-control": "public, max-age=300", "x-kova-image-cache": "HIT"}
    safe.update(headers)
    with httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(200, content=b"image", headers=safe))) as client:
        with pytest.raises(script.VerificationError):
            script.observe_photo(client, "https://kovasuite.com/api/image")
