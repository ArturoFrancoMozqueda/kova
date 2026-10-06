import json
from decimal import Decimal
from uuid import uuid4

import httpx
import pytest

from app.cfdi.provider import MAX_XML_BYTES, FacturapiProvider, ProviderError

ID = "58e93bd8e86eb318b019743d"
UUID = str(uuid4())
TEST_KEY = "sk_test_test_only"


def invoice(**updates):
    return {
        "id": ID,
        "livemode": False,
        "status": "valid",
        "uuid": UUID,
        "external_id": "kova-document",
        **updates,
    }


def provider(handler, **kwargs):
    return FacturapiProvider(TEST_KEY, transport=httpx.MockTransport(handler), **kwargs)


def test_create_exact_numeric_payload_body_idempotency_and_pending_202():
    def handle(request):
        assert request.url == "https://www.facturapi.io/v2/invoices?async=true"
        assert request.method == "POST"
        assert request.headers["Authorization"] == f"Bearer {TEST_KEY}"
        assert request.headers["Accept-Language"] == "es"
        assert "Idempotency-Key" not in request.headers
        payload = json.loads(request.content, parse_float=Decimal)
        assert payload["idempotency_key"] == "document-stable-key"
        item = payload["items"][0]
        assert item["quantity"] == 3
        assert item["discount"] == Decimal("10.07")
        assert item["product"]["price"] == Decimal("9999999999.123456")
        assert item["product"]["taxes"][0]["rate"] == Decimal("0.16")
        assert item["product"]["description"] == 'Producto "especial"'
        return httpx.Response(202, json=invoice(status="pending", uuid=None))

    with provider(handle) as client:
        result = client.create_invoice(
            {
                "external_id": "kova-document",
                "items": [
                    {
                        "quantity": 3,
                        "discount": Decimal("10.07"),
                        "product": {
                            "description": 'Producto "especial"',
                            "price": Decimal("9999999999.123456"),
                            "taxes": [{"type": "IVA", "rate": Decimal("0.16")}],
                        },
                    }
                ],
            },
            "document-stable-key",
        )
    assert result["status"] == "pending" and result["uuid"] is None


def test_get_organization_and_invoice_keep_decimal_and_verify_id_mode():
    def handle(request):
        assert request.url.host == "www.facturapi.io"
        if request.url.path.endswith("/organizations/me"):
            return httpx.Response(
                200,
                json={
                    "id": ID,
                    "is_production_ready": True,
                    "legal": {"tax_id": "AAA010101AAA"},
                    "certificate": {"has_certificate": True, "expires_at": "2030-01-01T00:00:00Z"},
                },
            )
        return httpx.Response(
            200, content=json.dumps(invoice()).removesuffix("}") + ',"total":9999999999.99}'
        )

    with provider(handle) as client:
        organization = client.organization()
        assert organization["is_production_ready"] is True
        assert organization["legal"]["tax_id"] == "AAA010101AAA"
        assert client.get_invoice(ID)["total"] == Decimal("9999999999.99")


@pytest.mark.parametrize(
    "updates,code",
    [
        ({"livemode": True}, "provider_environment_mismatch"),
        ({"livemode": None}, "provider_invalid_response"),
        ({"uuid": None}, "provider_invalid_response"),
        ({"id": "another"}, "provider_identifier_mismatch"),
        ({"status": "other"}, "provider_invalid_response"),
    ],
)
def test_untrusted_invoice_identity_and_valid_without_uuid_are_not_success(updates, code):
    with provider(lambda _: httpx.Response(200, json=invoice(**updates))) as client:
        with pytest.raises(ProviderError) as error:
            client.get_invoice(ID)
    assert error.value.code == code
    assert error.value.definitive is False


def test_exact_external_id_lookup_not_fuzzy_q():
    def handle(request):
        assert dict(request.url.params) == {
            "external_id": "kova-document",
            "limit": "2",
            "page": "1",
        }
        return httpx.Response(
            200,
            json={
                "data": [invoice()],
                "total_results": 1,
                "total_pages": 1,
                "next_cursor": None,
                "totals_are_capped": False,
            },
        )

    with provider(handle) as client:
        assert client.find_invoice("kova-document")["id"] == ID
    with provider(lambda _: httpx.Response(200, json={"data": [], "total_results": 0})) as client:
        assert client.find_invoice("kova-document") is None


@pytest.mark.parametrize(
    "body,code",
    [
        ({"data": [invoice(), invoice()]}, "provider_lookup_ambiguous"),
        ({"data": [invoice()], "total_results": 2}, "provider_lookup_ambiguous"),
        ({"data": [invoice()], "next_cursor": "cursor"}, "provider_lookup_ambiguous"),
        ({"data": [invoice()], "totals_are_capped": True}, "provider_lookup_ambiguous"),
        ({"data": [invoice(external_id="different")]}, "provider_external_id_mismatch"),
        ({"data": [], "total_results": 1}, "provider_invalid_response"),
    ],
)
def test_ambiguous_or_incomplete_lookup_never_selects_one_invoice(body, code):
    with provider(lambda _: httpx.Response(200, json=body)) as client:
        with pytest.raises(ProviderError) as error:
            client.find_invoice("kova-document")
    assert error.value.code == code and error.value.definitive is False


@pytest.mark.parametrize("state", ["pending", "verifying"])
def test_cancel_200_preserves_pending_sat_status_and_substitution_query(state):
    replacement = str(uuid4())

    def handle(request):
        assert request.method == "DELETE"
        assert request.url.path == f"/v2/invoices/{ID}"
        assert dict(request.url.params) == {"motive": "01", "substitution": replacement}
        return httpx.Response(200, json=invoice(cancellation_status=state))

    with provider(handle) as client:
        result = client.cancel_invoice(ID, "01", replacement)
    assert result["status"] == "valid" and result["cancellation_status"] == state


@pytest.mark.parametrize(
    "status,code,definitive,transient",
    [
        (400, "provider_invalid_request", False, False),
        (401, "provider_authentication_failed", True, False),
        (402, "provider_subscription_required", True, False),
        (403, "provider_access_denied", True, False),
        (404, "provider_not_found", True, False),
        (409, "provider_conflict", False, False),
        (429, "provider_rate_limited", False, True),
        (503, "provider_unavailable", False, True),
        (302, "provider_unexpected_status", False, False),
    ],
)
def test_error_responses_sanitized_and_no_blind_retries(status, code, definitive, transient):
    calls = []

    def handle(request):
        calls.append(request)
        return httpx.Response(
            status,
            headers={"Location": "https://attacker.invalid"},
            content=f"SECRET {TEST_KEY} taxpayer RFC ABC010101ABC",
        )

    with provider(handle) as client:
        with pytest.raises(ProviderError) as error:
            client.create_invoice({"external_id": "kova-document"}, "stable-key")
    assert len(calls) == 1
    assert error.value.code == code and error.value.status_code == status
    assert error.value.definitive is definitive and error.value.transient is transient
    assert str(error.value) == code
    assert TEST_KEY not in repr(error.value)
    assert "ABC010101ABC" not in str(error.value)


def test_timeout_ambiguous_sanitized_and_malformed_json_are_not_retried():
    def timeout(request):
        raise httpx.ReadTimeout(f"SECRET {TEST_KEY}", request=request)

    with provider(timeout) as client:
        with pytest.raises(ProviderError) as error:
            client.create_invoice({}, "stable")
    assert error.value.code == "provider_timeout" and error.value.definitive is False
    assert error.value.__cause__ is None
    assert error.value.__context__ is None
    with provider(lambda _: httpx.Response(202, content=b"")) as client:
        with pytest.raises(ProviderError) as error:
            client.create_invoice({}, "stable")
    assert error.value.code == "provider_invalid_response" and error.value.definitive is False


@pytest.mark.parametrize(
    "identifier",
    ["https://attacker.invalid", "../organizations/me", "x?token=secret", "x#fragment", ""],
)
def test_identifiers_cannot_change_resource_path(identifier):
    calls = []
    with provider(lambda request: calls.append(request)) as client:
        with pytest.raises(ProviderError) as error:
            client.get_invoice(identifier)
    assert error.value.code == "provider_invalid_identifier" and not calls


@pytest.mark.parametrize(
    "motive,replacement", [("01", None), ("01", "not-uuid"), ("02", str(uuid4())), ("04", None)]
)
def test_invalid_cancellation_never_calls_provider(motive, replacement):
    with provider(lambda _: pytest.fail("Unexpected external request")) as client:
        with pytest.raises(ProviderError):
            client.cancel_invoice(ID, motive, replacement)


@pytest.mark.parametrize(
    "key,environment",
    [
        ("sk_live_live_only", "test"),
        ("sk_test_test_only", "live"),
        ("sk_user_unsafe", "test"),
        ("sk_test_bad\nheader", "test"),
    ],
)
def test_wrong_environment_and_user_keys_rejected_before_client(key, environment):
    with pytest.raises(ProviderError) as error:
        FacturapiProvider(key, environment)
    assert error.value.code == "provider_invalid_credentials"


def test_document_routes_magic_and_size_bounds():
    xml = b'<?xml version="1.0"?><Comprobante />'

    def handle(request):
        if request.url.path.endswith("/xml"):
            assert request.headers["Accept"] == "application/xml"
            return httpx.Response(200, content=xml)
        assert request.headers["Accept"] == "application/pdf"
        return httpx.Response(200, content=b"%PDF-1.7 test")

    with provider(handle) as client:
        assert client.download_xml(ID) == xml
        assert client.download_pdf(ID).startswith(b"%PDF-")
    with provider(
        lambda _: httpx.Response(
            200, headers={"Content-Length": str(MAX_XML_BYTES + 1)}, content=b"xml"
        )
    ) as client:
        with pytest.raises(ProviderError) as error:
            client.download_xml(ID)
    assert error.value.code == "provider_response_too_large"
    with provider(lambda _: httpx.Response(200, content=b"<html>Error</html>")) as client:
        with pytest.raises(ProviderError) as error:
            client.download_pdf(ID)
    assert error.value.code == "provider_invalid_document"


class ChunkedResponse(httpx.SyncByteStream):
    def __iter__(self):
        yield b"12345"
        yield b"67890"


def test_stream_limit_is_enforced_without_content_length():
    with provider(lambda _: httpx.Response(200, stream=ChunkedResponse())) as client:
        with pytest.raises(ProviderError) as error:
            client._request("GET", "/organizations/me", limit=8)
    assert error.value.code == "provider_response_too_large"


@pytest.mark.parametrize(
    "value", [Decimal("NaN"), Decimal("Infinity"), Decimal("1e10000"), float("nan"), object()]
)
def test_invalid_numeric_payload_rejected_locally(value):
    with provider(lambda _: pytest.fail("Unexpected external request")) as client:
        with pytest.raises(ProviderError) as error:
            client.create_invoice({"price": value}, "stable")
    assert error.value.code == "provider_invalid_payload"


@pytest.mark.parametrize("status", [400, 409])
@pytest.mark.parametrize("nested", [False, True])
def test_idempotency_in_use_reserves_unknown_even_when_http400(status, nested):
    body = (
        {
            "code": "invalid_request",
            "errors": [
                {
                    "code": "idempotency_key_in_use",
                    "source": "facturapi",
                    "message": f"secret {TEST_KEY}",
                }
            ],
        }
        if nested
        else {"code": "idempotency_key_in_use", "message": f"secret {TEST_KEY}"}
    )
    with provider(lambda _: httpx.Response(status, json=body)) as client:
        with pytest.raises(ProviderError) as error:
            client.create_invoice({}, "stable")
    assert error.value.code == "provider_idempotency_in_use"
    assert error.value.definitive is False and error.value.transient is True
    assert TEST_KEY not in str(error.value)


@pytest.mark.parametrize(
    "body",
    [
        {"code": "invoice_stamping_failed"},
        {"code": "invoice_stamping_service_unavailable"},
        {
            "code": "invoice_stamping_validation_error",
            "errors": [{"source": "pac", "code": "402", "message": "taxpayer secret"}],
        },
        {"code": "invalid_request", "errors": [{"source": "sat", "code": "CFDI40145"}]},
        {"code": "future_provider_error"},
        {"code": []},
        {"code": "invalid_request", "errors": [{"source": "facturapi", "code": []}]},
    ],
)
def test_external_or_unrecognized_400_cannot_release_invoice_reservation(body):
    with provider(lambda _: httpx.Response(400, json=body)) as client:
        with pytest.raises(ProviderError) as error:
            client.create_invoice({}, "stable")
    assert error.value.definitive is False
    assert error.value.code == "provider_invalid_request"


@pytest.mark.parametrize(
    "body",
    [
        {"code": "invalid_request", "errors": [{"source": "facturapi", "code": "required"}]},
        {"code": "invalid_json"},
        {"code": "product_key_not_found"},
        {"code": "tax_system_not_in_catalog"},
    ],
)
def test_documented_local_validation_is_definitive(body):
    with provider(lambda _: httpx.Response(400, json=body)) as client:
        with pytest.raises(ProviderError) as error:
            client.create_invoice({}, "stable")
    assert error.value.definitive is True
    assert error.value.code == "provider_invalid_request"


def test_opaque_printable_key_suffix_accepts_dot_padding_and_keeps_mode_check():
    key = "sk_test_opaque.part+/padded=="

    def handle(request):
        assert request.headers["Authorization"] == f"Bearer {key}"
        return httpx.Response(200, json={"id": ID})

    with FacturapiProvider(key, "test", transport=httpx.MockTransport(handle)) as client:
        assert client.organization()["id"] == ID
    for tail in ("white space", "line\nfeed", "control\x00", "del\x7f", "nonasciié"):
        with pytest.raises(ProviderError):
            FacturapiProvider("sk_test_" + tail)


def test_error_body_has_small_independent_stream_limit():
    from app.cfdi.provider import MAX_ERROR_BYTES

    with provider(
        lambda _: httpx.Response(
            400, headers={"Content-Length": str(MAX_ERROR_BYTES + 1)}, content=b"error"
        )
    ) as client:
        with pytest.raises(ProviderError) as error:
            client.download_xml(ID)
    assert error.value.code == "provider_response_too_large"
    assert error.value.definitive is False
