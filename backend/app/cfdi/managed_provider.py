"""Server-only Facturapi organization management; never retry mutations implicitly.

Contract: https://docs.facturapi.io/api/ (organizations, legal, certificate,
apikeys). RFC is assigned by Facturapi from the CSD, not PUT legal.
"""

import json
import re
from typing import Any

import httpx

from app.cfdi.provider import FacturapiProvider, ProviderError, _resource_id
from app.integrations.schemas import FiscalIdentity

MAX_CERTIFICATE_BYTES = 512 * 1024
MAX_CERTIFICATE_PASSWORD_CHARS = 1024
MAX_LOOKUP_PAGES = 30


def _name(value: str) -> str:
    if not isinstance(value, str) or not 1 <= len(value) <= 100 or not value.strip():
        raise ProviderError("provider_invalid_payload")
    return value


def _organization_name(value: dict[str, Any]) -> str | None:
    legal = value.get("legal")
    nested = legal.get("name") if isinstance(legal, dict) else None
    root = value.get("name")
    if root is not None and nested is not None and root != nested:
        raise ProviderError("provider_invalid_response", definitive=False)
    name = nested if nested is not None else root
    if name is not None and (not isinstance(name, str) or not 1 <= len(name) <= 100):
        raise ProviderError("provider_invalid_response", definitive=False)
    return name


class FacturapiManagementProvider(FacturapiProvider):
    def __init__(
        self,
        api_key: str,
        *,
        timeout_seconds: float = 20,
        transport: httpx.BaseTransport | None = None,
    ):
        if (
            not isinstance(api_key, str)
            or len(api_key) > 4096
            or not re.fullmatch(r"sk_user_[\x21-\x7e]+", api_key)
        ):
            raise ProviderError("provider_invalid_credentials")
        self._initialize_client(api_key, timeout_seconds, transport)

    @staticmethod
    def _organization(value: dict[str, Any], expected_id: str | None = None) -> dict[str, Any]:
        identifier = value.get("id")
        try:
            _resource_id(identifier)
        except ProviderError:
            raise ProviderError("provider_invalid_response", definitive=False) from None
        if expected_id is not None and identifier != expected_id:
            raise ProviderError("provider_identifier_mismatch", definitive=False)
        _organization_name(value)
        return value

    def create_organization(self, name: str) -> dict[str, Any]:
        name = _name(name)
        value = self._organization(self._json("POST", "/organizations", payload={"name": name}))
        if _organization_name(value) != name:
            raise ProviderError("provider_external_id_mismatch", definitive=False)
        return value

    def get_organization(self, organization_id: str) -> dict[str, Any]:
        identifier = _resource_id(organization_id)
        return self._organization(self._json("GET", f"/organizations/{identifier}"), identifier)

    def find_organization(self, name: str) -> dict[str, Any] | None:
        """Exhaust the bounded fuzzy search before accepting one exact name."""
        name = _name(name)
        match = None
        seen = 0
        expected_total = None
        expected_pages = None
        for page in range(1, MAX_LOOKUP_PAGES + 1):
            value = self._json(
                "GET", "/organizations", params={"q": name, "page": page, "limit": 100}
            )
            rows = value.get("data")
            total = value.get("total_results")
            pages = value.get("total_pages")
            if (
                not isinstance(rows, list)
                or len(rows) > 100
                or any(not isinstance(row, dict) for row in rows)
                or type(total) is not int
                or not 0 <= total <= 3000
                or type(pages) is not int
                or not 0 <= pages <= MAX_LOOKUP_PAGES
                or value.get("page") != page
            ):
                raise ProviderError("provider_invalid_response", definitive=False)
            if value.get("totals_are_capped"):
                raise ProviderError("provider_lookup_ambiguous", definitive=False)
            if expected_total is not None and (total != expected_total or pages != expected_pages):
                raise ProviderError("provider_lookup_ambiguous", definitive=False)
            expected_total, expected_pages = total, pages
            for row in rows:
                self._organization(row)
                if _organization_name(row) == name:
                    if match is not None:
                        raise ProviderError("provider_lookup_ambiguous", definitive=False)
                    match = row
            seen += len(rows)
            if page >= pages:
                if seen != total:
                    raise ProviderError("provider_invalid_response", definitive=False)
                return match
            if not rows:
                raise ProviderError("provider_invalid_response", definitive=False)
        raise ProviderError("provider_lookup_ambiguous", definitive=False)

    def update_legal(
        self, organization_id: str, identity: FiscalIdentity, *, name: str
    ) -> dict[str, Any]:
        identifier = _resource_id(organization_id)
        if not isinstance(identity, FiscalIdentity) or len(identity.legal_name) > 100:
            raise ProviderError("provider_invalid_payload")
        value = self._organization(
            self._json(
                "PUT",
                f"/organizations/{identifier}/legal",
                payload={
                    "name": _name(name),
                    "legal_name": identity.legal_name,
                    "tax_system": identity.tax_regime,
                    "address": {"zip": identity.postal_code},
                },
            ),
            identifier,
        )
        if _organization_name(value) != name:
            raise ProviderError("provider_external_id_mismatch", definitive=False)
        return value

    def _api_key(self, method: str, organization_id: str, environment: str) -> str:
        identifier = _resource_id(organization_id)
        _status, data = self._request(
            method, f"/organizations/{identifier}/apikeys/{environment}", limit=8192
        )
        try:
            value = json.loads(data)
        except (ValueError, UnicodeError, RecursionError):
            value = None
        if (
            not isinstance(value, str)
            or len(value) > 4096
            or not re.fullmatch(rf"sk_{environment}_[\x21-\x7e]+", value)
        ):
            raise ProviderError("provider_invalid_response", definitive=False)
        return value

    def test_key(self, organization_id: str) -> str:
        return self._api_key("GET", organization_id, "test")

    def live_key(self, organization_id: str) -> str:
        # PUT creates an additional live key; it is not an idempotent rotation.
        return self._api_key("PUT", organization_id, "live")

    def upload_certificate(
        self, organization_id: str, cer_bytes: bytes, key_bytes: bytes, password: str
    ) -> dict[str, Any]:
        identifier = _resource_id(organization_id)
        if (
            not isinstance(cer_bytes, bytes)
            or not 1 <= len(cer_bytes) <= MAX_CERTIFICATE_BYTES
            or not isinstance(key_bytes, bytes)
            or not 1 <= len(key_bytes) <= MAX_CERTIFICATE_BYTES
            or not isinstance(password, str)
            or not 1 <= len(password) <= MAX_CERTIFICATE_PASSWORD_CHARS
            or "\x00" in password
        ):
            raise ProviderError("provider_invalid_payload")
        valid_encoding = True
        try:
            password.encode("utf-8")
        except UnicodeError:
            valid_encoding = False
        # Raise outside the exception handler: UnicodeError contains the secret.
        if not valid_encoding:
            raise ProviderError("provider_invalid_payload")
        return self._organization(
            self._json(
                "PUT",
                f"/organizations/{identifier}/certificate",
                files={
                    "cer": ("csd.cer", cer_bytes, "application/octet-stream"),
                    "key": ("csd.key", key_bytes, "application/octet-stream"),
                },
                form={"password": password},
            ),
            identifier,
        )
