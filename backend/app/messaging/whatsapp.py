"""Small official Cloud API transport, deliberately not wired to a dispatcher.

No credentials are loaded here. A caller must inject the server-resolved account and
an explicit transport. Global setup does not authorize a tenant or an outbound send.
"""

import json
import re
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any

import httpx
from pydantic import SecretStr

API_HOST = "https://graph.facebook.com"
MAX_RESPONSE_BYTES = 65536
_VERSION = re.compile(r"v[1-9][0-9]{0,2}\.0\Z")
_ACCOUNT_ID = re.compile(r"[1-9][0-9]{0,31}\Z")
_PHONE = re.compile(r"[1-9][0-9]{7,14}\Z")
_MESSAGE_ID = re.compile(r"wamid\.[A-Za-z0-9_=+/.-]{1,500}\Z")


class ChannelError(Exception):
    """Fixed error codes only; no provider text, token, recipient or content."""

    def __init__(self, code: str, *, ambiguous=False, status_code: int | None = None):
        self.code = code
        self.ambiguous = ambiguous
        self.status_code = status_code
        super().__init__(code)


@dataclass(frozen=True)
class AcceptedMessage:
    message_id: str = field(repr=False)
    state: str = "accepted"


def _recipient(value: str):
    if not isinstance(value, str) or not _PHONE.fullmatch(value):
        raise ChannelError("invalid_recipient")
    return value


def _text(value: str, *, limit=4096):
    if not isinstance(value, str) or not value.strip() or len(value) > limit or "\x00" in value:
        raise ChannelError("invalid_message_text")
    return value


def text_payload(*, to: str, text: str) -> dict:
    return {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": _recipient(to),
        "type": "text",
        "text": {"preview_url": False, "body": _text(text)},
    }


def template_payload(
    *, to: str, name: str, language: str, body_parameters: Sequence[str] = ()
) -> dict:
    if not isinstance(name, str) or not re.fullmatch(r"[a-z0-9_]{1,512}", name):
        raise ChannelError("invalid_template_name")
    if not isinstance(language, str) or not re.fullmatch(r"[a-z]{2,3}(?:_[A-Z]{2})?", language):
        raise ChannelError("invalid_template_language")
    if (
        not isinstance(body_parameters, Sequence)
        or isinstance(body_parameters, str | bytes)
        or len(body_parameters) > 10
    ):
        raise ChannelError("invalid_template_parameters")
    template: dict[str, Any] = {"name": name, "language": {"code": language}}
    if body_parameters:
        template["components"] = [
            {
                "type": "body",
                "parameters": [
                    {"type": "text", "text": _text(value, limit=1024)} for value in body_parameters
                ],
            }
        ]
    return {
        "messaging_product": "whatsapp",
        "to": _recipient(to),
        "type": "template",
        "template": template,
    }


def _reject_constant(_value):
    raise ValueError("invalid_json")


class WhatsAppCloudAdapter:
    def __init__(
        self,
        *,
        access_token: SecretStr,
        phone_number_id: str,
        api_version: str,
        transport: httpx.BaseTransport,
        timeout_seconds: float = 10,
    ):
        if not isinstance(api_version, str) or not _VERSION.fullmatch(api_version):
            raise ChannelError("invalid_api_version")
        if not isinstance(phone_number_id, str) or not _ACCOUNT_ID.fullmatch(phone_number_id):
            raise ChannelError("invalid_phone_number_id")
        if not isinstance(access_token, SecretStr):
            raise ChannelError("invalid_access_token")
        token = access_token.get_secret_value()
        if (
            not token
            or not token.isascii()
            or len(token) > 4096
            or any(character.isspace() for character in token)
        ):
            raise ChannelError("invalid_access_token")
        if not 0 < timeout_seconds <= 30:
            raise ChannelError("invalid_timeout")
        if transport is None:
            raise ChannelError("explicit_transport_required")
        self._access_token = access_token
        self._url = f"{API_HOST}/{api_version}/{phone_number_id}/messages"
        self._transport = transport
        self._timeout_seconds = timeout_seconds

    def send_text(self, *, to: str, text: str) -> AcceptedMessage:
        return self._submit(text_payload(to=to, text=text))

    def send_template(
        self, *, to: str, name: str, language: str, body_parameters: Sequence[str] = ()
    ) -> AcceptedMessage:
        return self._submit(
            template_payload(to=to, name=name, language=language, body_parameters=body_parameters)
        )

    def _submit(self, payload: dict) -> AcceptedMessage:
        # No retry transport and no provider-controlled URL. Receipt reconciliation is
        # the future dispatcher's responsibility; repeating a timeout risks duplicates.
        try:
            with httpx.Client(
                transport=self._transport,
                timeout=self._timeout_seconds,
                follow_redirects=False,
                trust_env=False,
            ) as client:
                with client.stream(
                    "POST",
                    self._url,
                    headers={
                        "Authorization": f"Bearer {self._access_token.get_secret_value()}",
                        "Content-Type": "application/json",
                    },
                    json=payload,
                ) as response:
                    if not 200 <= response.status_code < 300:
                        raise ChannelError(
                            "provider_rejected",
                            status_code=response.status_code,
                            ambiguous=response.status_code >= 500 or response.status_code == 408,
                        )
                    chunks, size = [], 0
                    for chunk in response.iter_bytes():
                        size += len(chunk)
                        if size > MAX_RESPONSE_BYTES:
                            raise ChannelError("provider_response_invalid", ambiguous=True)
                        chunks.append(chunk)
                    try:
                        body = json.loads(b"".join(chunks), parse_constant=_reject_constant)
                        messages = body["messages"]
                        message_id = messages[0]["id"] if len(messages) == 1 else None
                        if not isinstance(message_id, str) or not _MESSAGE_ID.fullmatch(message_id):
                            raise ValueError
                    except (ValueError, TypeError, KeyError, IndexError, RecursionError):
                        raise ChannelError("provider_response_invalid", ambiguous=True) from None
                    return AcceptedMessage(message_id=message_id)
        except httpx.RequestError:
            raise ChannelError("provider_result_ambiguous", ambiguous=True) from None
