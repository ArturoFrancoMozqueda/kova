"""Fixed Meta Graph operations for Embedded Signup v4; never arbitrary URLs."""

import json
from datetime import UTC, datetime, timedelta

import httpx
from pydantic import SecretStr

from app.config import settings
from app.messaging.whatsapp import MAX_RESPONSE_BYTES, ChannelError


class SignupProvider:
    def __init__(self, *, transport=None):
        self.transport = transport

    def _request(self, method, path, *, token=None, params=None, body=None):
        headers = {"Authorization": f"Bearer {token.get_secret_value()}"} if token else {}
        # Query parameters are required by Meta's code exchange/debug endpoints.
        # HTTPX request logging is disabled centrally and telemetry redacts each
        # of these sensitive keys. Never propagate a RequestError/response body.
        try:
            with httpx.Client(
                transport=self.transport or httpx.HTTPTransport(retries=0),
                timeout=8,
                follow_redirects=False,
                trust_env=False,
            ) as client:
                with client.stream(
                    method,
                    f"https://graph.facebook.com/{settings.whatsapp_graph_api_version}/{path}",
                    headers=headers,
                    params=params,
                    json=body,
                ) as response:
                    if response.status_code != 200:
                        raise ChannelError(
                            "meta_request_failed", ambiguous=response.status_code >= 500
                        )
                    raw = bytearray()
                    for chunk in response.iter_bytes():
                        if len(raw) + len(chunk) > MAX_RESPONSE_BYTES:
                            raise ChannelError("meta_response_invalid", ambiguous=True)
                        raw.extend(chunk)
                    payload = json.loads(raw)
                    if not isinstance(payload, dict) or "error" in payload:
                        raise ChannelError("meta_response_invalid", ambiguous=True)
                    return payload
        except (httpx.RequestError, ValueError, TypeError):
            raise ChannelError("meta_response_unknown", ambiguous=True) from None

    def exchange(self, code):
        payload = self._request(
            "GET",
            "oauth/access_token",
            params={
                "client_id": settings.whatsapp_app_id,
                "client_secret": settings.whatsapp_app_secret.get_secret_value(),
                "code": code.get_secret_value(),
            },
        )
        token = payload.get("access_token")
        if (
            not isinstance(token, str)
            or not 1 <= len(token) <= 4096
            or not token.isascii()
            or any(c.isspace() for c in token)
        ):
            raise ChannelError("meta_response_invalid", ambiguous=True)
        return SecretStr(token)

    def verify(self, token, waba, phone):
        app_token = SecretStr(
            f"{settings.whatsapp_app_id}|{settings.whatsapp_app_secret.get_secret_value()}"
        )
        data = self._request(
            "GET", "debug_token", token=app_token, params={"input_token": token.get_secret_value()}
        ).get("data", {})
        if (
            not isinstance(data, dict)
            or not isinstance(data.get("scopes"), list)
            or not isinstance(data.get("granular_scopes"), list)
            or not all(isinstance(scope, str) for scope in data["scopes"])
        ):
            raise ChannelError("meta_assets_not_authorized")
        permissions = {"whatsapp_business_management", "whatsapp_business_messaging"}
        grants = {}
        for item in data["granular_scopes"]:
            if not isinstance(item, dict) or not isinstance(item.get("scope"), str):
                raise ChannelError("meta_assets_not_authorized")
            scope = item["scope"]
            if scope not in permissions:
                continue
            targets = item.get("target_ids")
            if not isinstance(targets, list) or not all(
                isinstance(value, str) for value in targets
            ):
                raise ChannelError("meta_assets_not_authorized")
            grants.setdefault(scope, set()).update(targets)
        if (
            data.get("is_valid") is not True
            or data.get("app_id") != settings.whatsapp_app_id
            or not permissions.issubset(set(data.get("scopes", [])))
            or any(waba not in grants.get(permission, []) for permission in permissions)
        ):
            raise ChannelError("meta_assets_not_authorized")
        numbers = self._request(
            "GET",
            f"{waba}/phone_numbers",
            token=token,
            params={"fields": "id,code_verification_status,platform_type", "limit": "100"},
        ).get("data", [])
        if not isinstance(numbers, list):
            raise ChannelError("meta_response_invalid")
        exact = next(
            (item for item in numbers if isinstance(item, dict) and item.get("id") == phone), None
        )
        if exact is None or exact.get("code_verification_status") != "VERIFIED":
            raise ChannelError("meta_number_not_verified")
        expiry = data.get("expires_at")
        expires = None
        if expiry not in (None, 0):
            if type(expiry) is not int or not 0 < expiry < 253402300799:
                raise ChannelError("meta_response_invalid")
            expires = datetime.fromtimestamp(expiry, UTC)
            if expires <= datetime.now(UTC) + timedelta(minutes=5):
                raise ChannelError("meta_authorization_expired")
        return expires

    def subscribe(self, token, waba):
        if self._request("POST", f"{waba}/subscribed_apps", token=token).get("success") is not True:
            raise ChannelError("meta_subscription_unknown", ambiguous=True)

    def register(self, token, phone, pin):
        if (
            self._request(
                "POST",
                f"{phone}/register",
                token=token,
                body={"messaging_product": "whatsapp", "pin": pin},
            ).get("success")
            is not True
        ):
            raise ChannelError("meta_registration_unknown", ambiguous=True)
