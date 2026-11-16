import asyncio
import sys
from types import SimpleNamespace

import httpx
import pytest

from app.messaging.whatsapp import ChannelError
from app.messaging.worker_transport import GraphWorkerTransport


@pytest.mark.parametrize(
    "method,status,body",
    [("GET", 200, b'{"data":[]}'), ("POST", 200, b'{"messages":[]}'), ("GET", 302, b"")],
)
def test_worker_uses_async_transport_with_bounded_response_and_no_redirects(
    monkeypatch, method, status, body
):
    original = httpx.AsyncClient
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(status, content=body, headers={"Location": "https://other.test"})

    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda **kwargs: original(transport=httpx.MockTransport(handler), **kwargs),
    )
    monkeypatch.setitem(sys.modules, "pyodide.ffi", SimpleNamespace(run_sync=asyncio.run))
    request = httpx.Request(method, "https://graph.facebook.com/v26.0/123/messages", content=b"{}")
    response = GraphWorkerTransport().handle_request(request)
    assert response.status_code == status and response.content == body and len(requests) == 1


@pytest.mark.parametrize("method,ambiguous", [("GET", False), ("POST", True)])
def test_worker_timeout_never_retains_provider_details_and_post_is_ambiguous(
    monkeypatch, method, ambiguous
):
    original = httpx.AsyncClient

    def handler(request):
        raise httpx.ReadTimeout("synthetic-private-token")

    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda **kwargs: original(transport=httpx.MockTransport(handler), **kwargs),
    )
    request = httpx.Request(method, "https://graph.facebook.com/v26.0/123/messages")
    with pytest.raises(ChannelError) as error:
        asyncio.run(GraphWorkerTransport()._request(request))
    assert str(error.value) == "provider_request_failed" and error.value.ambiguous is ambiguous


def test_worker_rejects_other_hosts_before_io():
    with pytest.raises(ChannelError, match="provider_host_invalid"):
        GraphWorkerTransport().handle_request(
            httpx.Request("POST", "https://graph.facebook.com.evil.test/messages")
        )


def test_template_values_cannot_interpolate_each_other():
    from app.messaging.reservation_templates import render

    assert (
        render("kova_reserva_confirmacion_v1", ["{{2}}", "Mi negocio", "20/11/2026", "10:00"])
        == "Hola {{2}}. Tu reserva en Mi negocio está confirmada para el 20/11/2026 a las 10:00."
    )
