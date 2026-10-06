"""Facturapi v2 transport. No implicit retries or provider-controlled URLs.

Contract: https://docs.facturapi.io/api/ (invoice, organization, downloads)
and https://docs.facturapi.io/docs/guides/invoices/intermitencias/ .
Error codes: https://docs.facturapi.io/docs/getting-started/errors/ .
Credential encryption and stamped XML integrity belong to the lifecycle service.
"""

import json
import math
import re
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

import httpx

API_BASE = "https://www.facturapi.io/v2"
MAX_JSON_BYTES = 4 * 1024 * 1024
MAX_ERROR_BYTES = 64 * 1024
MAX_REQUEST_BYTES = 2 * 1024 * 1024
MAX_XML_BYTES = 10 * 1024 * 1024
MAX_PDF_BYTES = 20 * 1024 * 1024
_ID = re.compile(r"[A-Za-z0-9_-]{1,128}\Z")


class ProviderError(Exception):
    """Only fixed codes/status escape the transport; never bodies or credentials."""

    def __init__(
        self,
        code: str,
        *,
        status_code: int | None = None,
        transient: bool = False,
        definitive: bool = True,
    ):
        self.code = code
        self.status_code = status_code
        self.transient = transient
        self.definitive = definitive
        super().__init__(code)


def _decimal_json(value: Any, depth: int = 0) -> str:
    """Emit exact Decimal JSON numbers, without lossy conversion or quoted amounts."""
    if depth > 32:
        raise ProviderError("provider_invalid_payload")
    if isinstance(value, Decimal):
        if not value.is_finite() or abs(value.adjusted()) > 40:
            raise ProviderError("provider_invalid_payload")
        return format(value, "f")
    if value is None or isinstance(value, str | bool | int):
        return json.dumps(value, ensure_ascii=False, allow_nan=False)
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ProviderError("provider_invalid_payload")
        return json.dumps(value, allow_nan=False)
    if isinstance(value, dict):
        if not all(isinstance(key, str) for key in value):
            raise ProviderError("provider_invalid_payload")
        return (
            "{"
            + ",".join(
                json.dumps(key, ensure_ascii=False) + ":" + _decimal_json(item, depth + 1)
                for key, item in value.items()
            )
            + "}"
        )
    if isinstance(value, list | tuple):
        return "[" + ",".join(_decimal_json(item, depth + 1) for item in value) + "]"
    raise ProviderError("provider_invalid_payload")


def _resource_id(value: str) -> str:
    if not isinstance(value, str) or not _ID.fullmatch(value):
        raise ProviderError("provider_invalid_identifier")
    return value


def _reject_json_constant(_value: str):
    raise ValueError("Invalid JSON number")


class FacturapiProvider:
    def __init__(
        self,
        api_key: str,
        environment: Literal["test", "live"] = "test",
        *,
        timeout_seconds: float = 20,
        transport: httpx.BaseTransport | None = None,
    ):
        if environment not in ("test", "live"):
            raise ProviderError("provider_invalid_environment")
        # Organization environment prefixes are documented; the suffix is opaque.
        if (
            not isinstance(api_key, str)
            or len(api_key) > 4096
            or not re.fullmatch(rf"sk_{environment}_[\x21-\x7e]+", api_key)
        ):
            raise ProviderError("provider_invalid_credentials")
        if not isinstance(timeout_seconds, int | float) or not 1 <= timeout_seconds <= 60:
            raise ProviderError("provider_invalid_timeout")
        self.environment = environment
        self._client = httpx.Client(
            headers={
                "Authorization": f"Bearer {api_key}",
                "Accept": "application/json",
                "Accept-Language": "es",
                "Content-Type": "application/json",
            },
            timeout=httpx.Timeout(timeout_seconds, connect=min(10, timeout_seconds)),
            follow_redirects=False,
            trust_env=False,
            transport=transport,
        )

    def close(self) -> None:
        self._client.close()

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        self.close()

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, str | int] | None = None,
        payload: dict[str, Any] | None = None,
        limit: int = MAX_JSON_BYTES,
        accept: str = "application/json",
    ) -> tuple[int, bytes]:
        content = _decimal_json(payload).encode("utf-8") if payload is not None else None
        if content is not None and len(content) > MAX_REQUEST_BYTES:
            raise ProviderError("provider_payload_too_large")
        try:
            with self._client.stream(
                method,
                API_BASE + path,
                params=params,
                content=content,
                headers={"Accept": accept},
            ) as response:
                status = response.status_code
                response_limit = limit if status in (200, 201, 202) else min(limit, MAX_ERROR_BYTES)
                length = response.headers.get("Content-Length")
                if length is not None:
                    try:
                        size = int(length)
                    except ValueError:
                        raise ProviderError("provider_invalid_response", definitive=False) from None
                    if size < 0 or size > response_limit:
                        raise ProviderError("provider_response_too_large", definitive=False)
                chunks = []
                total = 0
                for chunk in response.iter_bytes(chunk_size=64 * 1024):
                    total += len(chunk)
                    if total > response_limit:
                        raise ProviderError("provider_response_too_large", definitive=False)
                    chunks.append(chunk)
                data = b"".join(chunks)
                if status not in (200, 201, 202):
                    self._raise_status(status, data)
                return status, data
        except httpx.TimeoutException:
            error = ProviderError("provider_timeout", transient=True, definitive=False)
        except httpx.HTTPError:
            error = ProviderError("provider_transport_error", transient=True, definitive=False)
        # The HTTP exception retains authorization headers; do not preserve it
        # as the sanitized exception's context.
        raise error

    @staticmethod
    def _raise_status(status: int, body: bytes) -> None:
        # Only documented fixed codes influence classification; messages,
        # paths and SAT/PAC payloads are never copied into exceptions.
        try:
            value = json.loads(body, parse_constant=_reject_json_constant)
        except (ValueError, UnicodeError, RecursionError):
            value = None
        details = value.get("errors", []) if isinstance(value, dict) else []
        details = details if isinstance(details, list) else [None]
        root = value.get("code") if isinstance(value, dict) else None
        codes = {
            detail.get("code")
            for detail in details
            if isinstance(detail, dict) and isinstance(detail.get("code"), str)
        }
        if isinstance(root, str):
            codes.add(root)
        pending = {
            "idempotency_key_in_use": "provider_idempotency_in_use",
            "stamping_in_progress": "provider_stamping_in_progress",
            "invoice_cancellation_in_progress": "provider_cancellation_in_progress",
        }
        for source, code in pending.items():
            if source in codes:
                raise ProviderError(code, status_code=status, transient=True, definitive=False)
        if "invoice_already_stamped" in codes:
            raise ProviderError("provider_already_stamped", status_code=status, definitive=False)
        if "rate_limit_exceeded" in codes:
            raise ProviderError(
                "provider_rate_limited", status_code=status, transient=True, definitive=False
            )
        if status in (400, 422):
            local_codes = {
                "invalid_json",
                "payload_too_large",
                "invalid_date",
                "invalid_country_code",
                "legal_name_mismatch",
                "tax_address_zip_mismatch",
                "tax_id_not_found",
                "tax_system_not_allowed_for_tax_id",
                "tax_system_not_in_catalog",
                "product_key_not_found",
                "unit_key_not_found",
                "organization_incomplete",
                "certificate_expired",
                "certificate_invalid",
                "certificate_not_yet_valid",
            }
            detail_codes = {
                "invalid_format",
                "invalid_length",
                "invalid_type",
                "not_found",
                "not_allowed",
                "required",
                "too_large",
                "too_small",
                "unknown_field",
                "invalid_value",
                *local_codes,
            }
            local_details = all(
                isinstance(detail, dict)
                and detail.get("source") == "facturapi"
                and isinstance(detail.get("code"), str)
                and detail["code"] in detail_codes
                for detail in details
            )
            # External stamping errors (even HTTP400), unknown codes or malformed
            # responses keep the durable reservation until GET reconciliation.
            definite = (
                local_details
                and isinstance(root, str)
                and (root in local_codes or root == "invalid_request")
            )
            raise ProviderError("provider_invalid_request", status_code=status, definitive=definite)
        if status in (401, 402, 403, 404):
            code = {
                400: "provider_invalid_request",
                401: "provider_authentication_failed",
                402: "provider_subscription_required",
                403: "provider_access_denied",
                404: "provider_not_found",
                422: "provider_invalid_request",
            }[status]
            raise ProviderError(code, status_code=status)
        if status == 429:
            raise ProviderError(
                "provider_rate_limited", status_code=status, transient=True, definitive=False
            )
        if status >= 500 or status == 408:
            raise ProviderError(
                "provider_unavailable", status_code=status, transient=True, definitive=False
            )
        if status == 409:
            raise ProviderError("provider_conflict", status_code=status, definitive=False)
        raise ProviderError("provider_unexpected_status", status_code=status, definitive=False)

    def _json(self, method: str, path: str, **kwargs) -> dict[str, Any]:
        _status, data = self._request(method, path, **kwargs)
        try:
            value = json.loads(data, parse_float=Decimal, parse_constant=_reject_json_constant)
        except (ValueError, UnicodeError, RecursionError):
            value = None
        if not isinstance(value, dict):
            raise ProviderError("provider_invalid_response", definitive=False)
        return value

    def _invoice(self, value: dict[str, Any], expected_id: str | None = None) -> dict[str, Any]:
        identifier = value.get("id")
        if not isinstance(identifier, str) or not _ID.fullmatch(identifier):
            raise ProviderError("provider_invalid_response", definitive=False)
        if expected_id is not None and identifier != expected_id:
            raise ProviderError("provider_identifier_mismatch", definitive=False)
        if not isinstance(value.get("livemode"), bool):
            raise ProviderError("provider_invalid_response", definitive=False)
        if value["livemode"] != (self.environment == "live"):
            raise ProviderError("provider_environment_mismatch", definitive=False)
        if value.get("status") not in ("pending", "valid", "canceled", "draft", "failed"):
            raise ProviderError("provider_invalid_response", definitive=False)
        if value["status"] in ("valid", "canceled"):
            try:
                UUID(value.get("uuid"))
            except (ValueError, TypeError, AttributeError):
                raise ProviderError("provider_invalid_response", definitive=False) from None
        return value

    def organization(self) -> dict[str, Any]:
        value = self._json("GET", "/organizations/me")
        if not isinstance(value.get("id"), str) or not _ID.fullmatch(value["id"]):
            raise ProviderError("provider_invalid_response", definitive=False)
        return value

    def create_invoice(self, payload: dict[str, Any], idempotency_key: str) -> dict[str, Any]:
        if not isinstance(idempotency_key, str) or not 1 <= len(idempotency_key) <= 100:
            raise ProviderError("provider_invalid_idempotency_key")
        # Facturapi's idempotency key is a BODY parameter, not an HTTP header.
        body = {**payload, "idempotency_key": idempotency_key}
        value = self._invoice(
            self._json("POST", "/invoices", params={"async": "true"}, payload=body)
        )
        if payload.get("external_id") and value.get("external_id") != payload["external_id"]:
            raise ProviderError("provider_external_id_mismatch", definitive=False)
        return value

    def get_invoice(self, invoice_id: str) -> dict[str, Any]:
        identifier = _resource_id(invoice_id)
        return self._invoice(self._json("GET", f"/invoices/{identifier}"), identifier)

    def find_invoice(self, external_id: str) -> dict[str, Any] | None:
        if not isinstance(external_id, str) or not 1 <= len(external_id) <= 100:
            raise ProviderError("provider_invalid_identifier")
        value = self._json(
            "GET", "/invoices", params={"external_id": external_id, "limit": 2, "page": 1}
        )
        rows = value.get("data")
        if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
            raise ProviderError("provider_invalid_response", definitive=False)
        # external_id is not unique at Facturapi. Never silently select one.
        total = value.get("total_results")
        if (
            len(rows) > 1
            or value.get("next_cursor")
            or value.get("totals_are_capped")
            or isinstance(total, int)
            and total > 1
            or isinstance(value.get("total_pages"), int)
            and value["total_pages"] > 1
        ):
            raise ProviderError("provider_lookup_ambiguous", definitive=False)
        if total is not None and total != len(rows):
            raise ProviderError("provider_invalid_response", definitive=False)
        if not rows:
            return None
        invoice = self._invoice(rows[0])
        if invoice.get("external_id") != external_id:
            raise ProviderError("provider_external_id_mismatch", definitive=False)
        return invoice

    def cancel_invoice(
        self, invoice_id: str, motive: str, substitution_uuid: str | None = None
    ) -> dict[str, Any]:
        identifier = _resource_id(invoice_id)
        if motive not in ("01", "02", "03"):
            raise ProviderError("provider_invalid_cancellation")
        params = {"motive": motive}
        if motive == "01":
            try:
                params["substitution"] = str(UUID(substitution_uuid))
            except (ValueError, TypeError, AttributeError):
                raise ProviderError("provider_invalid_cancellation") from None
        elif substitution_uuid is not None:
            raise ProviderError("provider_invalid_cancellation")
        # A 200 response may still be valid + cancellation_status=pending/verifying.
        return self._invoice(
            self._json("DELETE", f"/invoices/{identifier}", params=params), identifier
        )

    def download_xml(self, invoice_id: str) -> bytes:
        _, data = self._request(
            "GET",
            f"/invoices/{_resource_id(invoice_id)}/xml",
            limit=MAX_XML_BYTES,
            accept="application/xml",
        )
        if not data or not data.lstrip(b"\xef\xbb\xbf \r\n\t").startswith(b"<"):
            raise ProviderError("provider_invalid_document", definitive=False)
        return data

    def download_pdf(self, invoice_id: str) -> bytes:
        _, data = self._request(
            "GET",
            f"/invoices/{_resource_id(invoice_id)}/pdf",
            limit=MAX_PDF_BYTES,
            accept="application/pdf",
        )
        if not data.startswith(b"%PDF-"):
            raise ProviderError("provider_invalid_document", definitive=False)
        return data
