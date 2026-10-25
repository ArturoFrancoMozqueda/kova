"""Bounded signature verification and parsing for one trusted account binding.

The HTTP pilot supplies trusted account bindings. Authenticity alone never establishes
a tenant, replay protection, a customer-service window, consent, or permission to execute actions.
"""

import hashlib
import hmac
import json
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Literal

from pydantic import SecretStr

from app.messaging.whatsapp import ChannelError

MAX_WEBHOOK_BYTES = 262144
MAX_EVENTS = 100
_ID = re.compile(r"[1-9][0-9]{0,31}\Z")
_MESSAGE = re.compile(r"wamid\.[A-Za-z0-9_=+/.-]{1,500}\Z")


@dataclass(frozen=True)
class ChannelEvent:
    kind: Literal["inbound", "receipt"]
    dedupe_key: str
    message_id: str = field(repr=False)
    timestamp: datetime
    message_type: str | None = None
    status: str | None = None
    sender: str | None = field(default=None, repr=False)
    text: str | None = field(default=None, repr=False)
    recipient: str | None = field(default=None, repr=False)
    error_code: int | None = None


@dataclass(frozen=True)
class VerifiedEnvelope:
    waba_id: str = field(repr=False)
    phone_number_id: str = field(repr=False)
    events: tuple[ChannelEvent, ...]


def _secret(value: SecretStr):
    if not isinstance(value, SecretStr) or not value.get_secret_value():
        raise ChannelError("webhook_secret_required")
    return value.get_secret_value().encode("utf-8")


def verify_subscription(*, mode: str, token: str, challenge: str, expected_token: SecretStr) -> str:
    expected = _secret(expected_token)
    if (
        mode != "subscribe"
        or not isinstance(token, str)
        or len(token) > 4096
        or not hmac.compare_digest(token.encode("utf-8"), expected)
        or not isinstance(challenge, str)
        or not re.fullmatch(r"[0-9]{1,128}", challenge)
    ):
        raise ChannelError("webhook_verification_failed")
    return challenge


def verify_signature(*, raw_body: bytes, signature: str, app_secret: SecretStr) -> None:
    if not isinstance(raw_body, bytes) or len(raw_body) > MAX_WEBHOOK_BYTES:
        raise ChannelError("webhook_payload_invalid")
    if not isinstance(signature, str) or not re.fullmatch(r"sha256=[0-9a-f]{64}", signature):
        raise ChannelError("webhook_signature_invalid")
    expected = "sha256=" + hmac.new(_secret(app_secret), raw_body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(signature, expected):
        raise ChannelError("webhook_signature_invalid")


def _object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate_json_key")
        result[key] = value
    return result


def _constant(_value):
    raise ValueError("invalid_json_constant")


def _list(value, *, limit=100):
    if not isinstance(value, list) or len(value) > limit:
        raise ValueError("invalid_array")
    return value


def _mapping(value):
    if not isinstance(value, dict):
        raise ValueError("invalid_object")
    return value


def _message_id(value):
    if not isinstance(value, str) or not _MESSAGE.fullmatch(value):
        raise ValueError("invalid_message_id")
    return value


def _party(value):
    # This parser does not normalize identities or infer that they are customers.
    if not isinstance(value, str) or not 1 <= len(value) <= 256 or any(ord(c) < 32 for c in value):
        raise ValueError("invalid_identity")
    return value


def _timestamp(value):
    if not isinstance(value, str) or not re.fullmatch(r"[0-9]{1,12}", value):
        raise ValueError("invalid_timestamp")
    return datetime.fromtimestamp(int(value), UTC)


def parse_verified_webhook(
    *,
    raw_body: bytes,
    signature: str,
    app_secret: SecretStr,
    expected_waba_id: str,
    expected_phone_number_id: str,
    allow_other_accounts: bool = False,
) -> VerifiedEnvelope:
    # Verify RAW bytes first, before interpreting any account ID or message text.
    verify_signature(raw_body=raw_body, signature=signature, app_secret=app_secret)
    if (
        not isinstance(expected_waba_id, str)
        or not _ID.fullmatch(expected_waba_id)
        or not isinstance(expected_phone_number_id, str)
        or not _ID.fullmatch(expected_phone_number_id)
    ):
        raise ChannelError("trusted_channel_binding_required")
    try:
        payload = _mapping(
            json.loads(raw_body, object_pairs_hook=_object, parse_constant=_constant)
        )
        if payload.get("object") != "whatsapp_business_account":
            raise ValueError
        events, seen = [], set()
        for entry in _list(payload.get("entry"), limit=50):
            entry = _mapping(entry)
            if entry.get("id") != expected_waba_id:
                if allow_other_accounts:
                    continue
                raise ChannelError("webhook_account_mismatch")
            for change in _list(entry.get("changes"), limit=50):
                change = _mapping(change)
                if change.get("field") != "messages":
                    continue
                value = _mapping(change.get("value"))
                metadata = _mapping(value.get("metadata"))
                if (
                    allow_other_accounts
                    and metadata.get("phone_number_id") != expected_phone_number_id
                ):
                    continue
                if (
                    value.get("messaging_product") != "whatsapp"
                    or metadata.get("phone_number_id") != expected_phone_number_id
                ):
                    raise ChannelError("webhook_account_mismatch")
                for message in _list(value.get("messages", []), limit=MAX_EVENTS):
                    message = _mapping(message)
                    mid, timestamp = (
                        _message_id(message.get("id")),
                        _timestamp(message.get("timestamp")),
                    )
                    message_type = message.get("type")
                    if not isinstance(message_type, str) or not re.fullmatch(
                        r"[a-z_]{1,40}", message_type
                    ):
                        raise ValueError
                    text = None
                    if message_type == "text":
                        text = _mapping(message.get("text")).get("body")
                        if not isinstance(text, str) or len(text) > 4096 or "\x00" in text:
                            raise ValueError
                    dedupe = hashlib.sha256(
                        f"{expected_waba_id}:{expected_phone_number_id}:inbound:{mid}".encode()
                    ).hexdigest()
                    if dedupe not in seen:
                        events.append(
                            ChannelEvent(
                                kind="inbound",
                                dedupe_key=dedupe,
                                message_id=mid,
                                timestamp=timestamp,
                                message_type=message_type,
                                sender=_party(message.get("from")),
                                text=text,
                            )
                        )
                        seen.add(dedupe)
                for receipt in _list(value.get("statuses", []), limit=MAX_EVENTS):
                    receipt = _mapping(receipt)
                    mid, timestamp = (
                        _message_id(receipt.get("id")),
                        _timestamp(receipt.get("timestamp")),
                    )
                    status = receipt.get("status")
                    if status not in {"sent", "delivered", "read", "failed"}:
                        raise ValueError
                    error_code = None
                    errors = _list(receipt.get("errors", []), limit=10)
                    if errors:
                        code = _mapping(errors[0]).get("code")
                        if type(code) is not int or not 0 <= code <= 2147483647:
                            raise ValueError
                        error_code = code
                    dedupe = hashlib.sha256(
                        f"{expected_waba_id}:{expected_phone_number_id}:receipt:{mid}:{status}:{timestamp.isoformat()}".encode()
                    ).hexdigest()
                    if dedupe not in seen:
                        events.append(
                            ChannelEvent(
                                kind="receipt",
                                dedupe_key=dedupe,
                                message_id=mid,
                                timestamp=timestamp,
                                status=status,
                                recipient=_party(receipt.get("recipient_id")),
                                error_code=error_code,
                            )
                        )
                        seen.add(dedupe)
                if len(events) > MAX_EVENTS:
                    raise ValueError
        return VerifiedEnvelope(
            waba_id=expected_waba_id, phone_number_id=expected_phone_number_id, events=tuple(events)
        )
    except (ValueError, TypeError, KeyError, OverflowError, OSError, RecursionError):
        raise ChannelError("webhook_payload_invalid") from None
