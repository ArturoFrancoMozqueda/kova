import json
from email.parser import BytesParser
from email.policy import default

import httpx
import pytest

from app.cfdi.managed_provider import MAX_CERTIFICATE_BYTES, FacturapiManagementProvider
from app.cfdi.provider import MAX_JSON_BYTES, FacturapiProvider, ProviderError
from app.integrations.schemas import FiscalIdentity

ID = "5a2a307be93a2f00129ea035"
NAME = "Kova-01111111-2222-3333-4444-555555555555"
USER_KEY = "sk_user_management_test_only"
IDENTITY = FiscalIdentity(
    rfc="AAA010101AAA", legal_name="Sweet Home", postal_code="01000", tax_regime="601"
)


def organization(identifier=ID, name=NAME):
    return {"id": identifier, "legal": {"name": name}, "is_production_ready": False}


def provider(handler, **kwargs):
    return FacturapiManagementProvider(USER_KEY, transport=httpx.MockTransport(handler), **kwargs)


def test_create_get_update_use_management_auth_and_documented_legal_contract():
    calls = []

    def handle(request):
        calls.append((request.method, request.url.path))
        assert request.url.host == "www.facturapi.io"
        assert request.headers["Authorization"] == f"Bearer {USER_KEY}"
        assert request.headers["Accept-Language"] == "es"
        assert request.headers["Content-Type"] == "application/json"
        if request.method == "POST":
            assert json.loads(request.content) == {"name": NAME}
        if request.url.path.endswith("/legal"):
            assert json.loads(request.content) == {
                "name": NAME,
                "legal_name": "Sweet Home",
                "tax_system": "601",
                "address": {"zip": "01000"},
            }
        return httpx.Response(200, json=organization())

    with provider(handle) as client:
        assert client.create_organization(NAME)["id"] == ID
        assert client.get_organization(ID)["id"] == ID
        assert client.update_legal(ID, IDENTITY, name=NAME)["id"] == ID
    assert calls == [
        ("POST", "/v2/organizations"),
        ("GET", f"/v2/organizations/{ID}"),
        ("PUT", f"/v2/organizations/{ID}/legal"),
    ]


def test_search_exhausts_pages_and_matches_exact_nested_name():
    calls = []

    def handle(request):
        page = int(request.url.params["page"])
        calls.append(page)
        assert dict(request.url.params) == {"q": NAME, "page": str(page), "limit": "100"}
        return httpx.Response(
            200,
            json={
                "data": [organization(name=NAME + " extra")] if page == 1 else [organization()],
                "page": page,
                "total_pages": 2,
                "total_results": 2,
                "totals_are_capped": False,
            },
        )

    with provider(handle) as client:
        assert client.find_organization(NAME)["id"] == ID
    assert calls == [1, 2]


@pytest.mark.parametrize("rows", [[], [organization(name="Other business")]])
def test_search_never_adopts_fuzzy_result(rows):
    with provider(
        lambda _: httpx.Response(
            200, json={"data": rows, "page": 1, "total_pages": 1, "total_results": len(rows)}
        )
    ) as client:
        assert client.find_organization(NAME) is None


@pytest.mark.parametrize(
    "updates,code",
    [
        (
            {"data": [organization(), organization()], "total_results": 2},
            "provider_lookup_ambiguous",
        ),
        ({"totals_are_capped": True}, "provider_lookup_ambiguous"),
        ({"total_pages": 31}, "provider_invalid_response"),
        ({"total_results": True}, "provider_invalid_response"),
        ({"page": 2}, "provider_invalid_response"),
        ({"total_results": 2}, "provider_invalid_response"),
        ({"data": ["invalid"]}, "provider_invalid_response"),
    ],
)
def test_search_rejects_ambiguous_or_incomplete_results(updates, code):
    body = {"data": [organization()], "page": 1, "total_pages": 1, "total_results": 1, **updates}
    with provider(lambda _: httpx.Response(200, json=body)) as client:
        with pytest.raises(ProviderError) as error:
            client.find_organization(NAME)
    assert error.value.code == code and error.value.definitive is False


def test_duplicate_exact_match_on_later_page_is_not_adopted():
    with provider(
        lambda request: httpx.Response(
            200,
            json={
                "data": [organization()],
                "page": int(request.url.params["page"]),
                "total_pages": 2,
                "total_results": 2,
            },
        )
    ) as client:
        with pytest.raises(ProviderError, match="provider_lookup_ambiguous"):
            client.find_organization(NAME)


def test_environment_keys_are_json_strings_and_live_put_has_no_retry():
    calls = []

    def handle(request):
        calls.append((request.method, request.url.path))
        environment = request.url.path.rsplit("/", 1)[-1]
        return httpx.Response(200, json=f"sk_{environment}_test_only")

    with provider(handle) as client:
        assert client.test_key(ID) == "sk_test_test_only"
        assert client.live_key(ID) == "sk_live_test_only"
    assert calls == [
        ("GET", f"/v2/organizations/{ID}/apikeys/test"),
        ("PUT", f"/v2/organizations/{ID}/apikeys/live"),
    ]


@pytest.mark.parametrize(
    "body", ["sk_live_wrong", "sk_user_wrong", {"key": "sk_test_wrong"}, "sk_test_", None]
)
def test_key_response_never_accepts_wrong_environment_or_shape(body):
    with provider(lambda _: httpx.Response(200, json=body)) as client:
        with pytest.raises(ProviderError, match="provider_invalid_response"):
            client.test_key(ID)


def test_certificate_is_bounded_memory_multipart_not_json_or_disk_path():
    def handle(request):
        assert request.method == "PUT"
        assert request.url.path == f"/v2/organizations/{ID}/certificate"
        content_type = request.headers["Content-Type"]
        assert content_type.startswith("multipart/form-data; boundary=")
        message = BytesParser(policy=default).parsebytes(
            f"Content-Type: {content_type}\r\n\r\n".encode() + request.content
        )
        parts = {
            part.get_param("name", header="content-disposition"): part
            for part in message.iter_parts()
        }
        assert set(parts) == {"cer", "key", "password"}
        assert parts["cer"].get_payload(decode=True) == b"\x00test-cer\xff"
        assert parts["key"].get_payload(decode=True) == b"\x00test-key\xff"
        assert parts["password"].get_payload(decode=True).decode() == "Sólo-pruebas"
        assert parts["cer"].get_filename() == "csd.cer"
        assert parts["key"].get_filename() == "csd.key"
        return httpx.Response(200, json=organization())

    with provider(handle) as client:
        assert (
            client.upload_certificate(ID, b"\x00test-cer\xff", b"\x00test-key\xff", "Sólo-pruebas")[
                "id"
            ]
            == ID
        )


@pytest.mark.parametrize(
    "cer,key,password",
    [
        (b"", b"key", "password"),
        (b"cer", b"", "password"),
        (b"cer", b"key", ""),
        (b"cer", b"key", "x\x00y"),
        (b"x" * (MAX_CERTIFICATE_BYTES + 1), b"key", "password"),
    ],
    ids=["empty-cer", "empty-key", "empty-password", "nul-password", "oversized-cer"],
)
def test_invalid_certificate_inputs_do_not_leave_process(cer, key, password):
    with provider(lambda _: pytest.fail("Unexpected provider request")) as client:
        with pytest.raises(ProviderError, match="provider_invalid_payload"):
            client.upload_certificate(ID, cer, key, password)


def test_unencodable_password_does_not_escape_as_unicode_exception_context():
    with provider(lambda _: pytest.fail("Unexpected provider request")) as client:
        with pytest.raises(ProviderError, match="provider_invalid_payload") as error:
            client.upload_certificate(ID, b"cer", b"key", "secret\ud800password")
    assert error.value.__context__ is None


@pytest.mark.parametrize("operation", ["create", "live_key", "certificate"])
@pytest.mark.parametrize("failure", ["timeout", "redirect", "server", "too_large", "malformed"])
def test_management_failures_are_sanitized_bounded_and_never_retried(operation, failure):
    calls = []

    def handle(request):
        calls.append(request)
        if failure == "timeout":
            raise httpx.ReadTimeout(f"SECRET {USER_KEY} password", request=request)
        if failure == "redirect":
            return httpx.Response(
                302, headers={"Location": "https://attacker.invalid"}, content=USER_KEY
            )
        if failure == "server":
            return httpx.Response(503, content=f"{USER_KEY} password taxpayer")
        if failure == "too_large":
            return httpx.Response(200, headers={"Content-Length": str(MAX_JSON_BYTES + 1)})
        return httpx.Response(200, content=b"invalid JSON")

    with provider(handle) as client:
        with pytest.raises(ProviderError) as error:
            if operation == "create":
                client.create_organization(NAME)
            elif operation == "live_key":
                client.live_key(ID)
            else:
                client.upload_certificate(ID, b"cer", b"key", "password")
    assert len(calls) == 1
    assert USER_KEY not in repr(error.value)
    assert "password" not in str(error.value)
    assert error.value.definitive is False
    assert error.value.__cause__ is None
    assert error.value.__context__ is None


@pytest.mark.parametrize("key", ["sk_test_only", "sk_live_only", "sk_user_", "sk_user_x\n", None])
def test_only_user_keys_can_manage_organizations(key):
    with pytest.raises(ProviderError, match="provider_invalid_credentials"):
        FacturapiManagementProvider(key)
    with pytest.raises(ProviderError, match="provider_invalid_credentials"):
        FacturapiProvider(USER_KEY)


@pytest.mark.parametrize("identifier", ["../me", "https://attacker.invalid", "id?x=secret", ""])
def test_unsafe_organization_identifier_never_calls_provider(identifier):
    with provider(lambda _: pytest.fail("Unexpected provider request")) as client:
        with pytest.raises(ProviderError, match="provider_invalid_identifier"):
            client.get_organization(identifier)


def test_long_legal_name_not_truncated_and_wrong_resource_response_rejected():
    identity = IDENTITY.model_copy(update={"legal_name": "x" * 101})
    with provider(lambda _: pytest.fail("Unexpected provider request")) as client:
        with pytest.raises(ProviderError, match="provider_invalid_payload"):
            client.update_legal(ID, identity, name=NAME)
    with provider(lambda _: httpx.Response(200, json=organization(identifier="other"))) as client:
        with pytest.raises(ProviderError, match="provider_identifier_mismatch"):
            client.get_organization(ID)
