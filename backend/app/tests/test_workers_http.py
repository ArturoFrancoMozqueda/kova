from urllib.error import HTTPError, URLError
from urllib.request import Request

import httpx
import pytest

from app.workers import http


def mock_provider(monkeypatch, handler):
    client = httpx.Client
    monkeypatch.setattr(
        http.httpx, "Client",
        lambda **kwargs: client(transport=httpx.MockTransport(handler), **kwargs),
    )


def test_provider_response_and_http_error_preserve_urllib_contract(monkeypatch):
    def handler(request):
        assert request.method == "POST"
        assert request.content == b"cancel_at_period_end=true"
        assert request.headers["Idempotency-Key"] == "synthetic-idempotency-key"
        return httpx.Response(429, json={"error": "retry"}, headers={"Retry-After": "2"})

    mock_provider(monkeypatch, handler)
    request = Request(
        "https://provider.test/subscription", data=b"cancel_at_period_end=true",
        headers={"Idempotency-Key": "synthetic-idempotency-key"}, method="POST",
    )
    with pytest.raises(HTTPError) as raised:
        http.urlopen(request, timeout=3)
    assert raised.value.code == 429
    assert raised.value.headers["Retry-After"] == "2"
    assert raised.value.read() == b'{"error":"retry"}'


def test_provider_network_failure_does_not_retain_request_details(monkeypatch):
    def handler(request):
        raise httpx.ConnectTimeout("synthetic-private-provider-detail", request=request)

    mock_provider(monkeypatch, handler)
    with pytest.raises(URLError) as raised:
        http.urlopen(Request("https://provider.test"), timeout=3)
    assert raised.value.reason == "Provider request failed"
    assert raised.value.__cause__ is None


def test_provider_response_buffer_is_bounded(monkeypatch):
    mock_provider(monkeypatch, lambda request: httpx.Response(200, content=b"123456789"))
    monkeypatch.setattr(http, "MAX_RESPONSE_BYTES", 8)
    with pytest.raises(URLError, match="resource limit"):
        http.urlopen(Request("https://provider.test"), timeout=3)


def test_provider_empty_success_response_keeps_status_and_context_manager(monkeypatch):
    mock_provider(monkeypatch, lambda request: httpx.Response(204))
    with http.urlopen(Request("https://provider.test"), timeout=3) as response:
        assert response.status == 204
        assert response.geturl() == "https://provider.test"
        assert response.read() == b""
