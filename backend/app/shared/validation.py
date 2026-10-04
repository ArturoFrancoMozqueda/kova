"""Centralized, reusable input-validation primitives.

Kept in one place so every endpoint shares the same rules: request schemas
reject unknown fields, collections are bounded, and uploaded bytes are checked
against their declared type. The real XSS boundary is React's auto-escaping and
plain-text rendering; the HTML check here is defense-in-depth, not a sanitizer.
"""

import re

from pydantic import BaseModel, ConfigDict

from app.shared.exceptions import bad_request


class StrictModel(BaseModel):
    """Base for request bodies: unknown/unexpected fields are rejected (422).

    Prevents mass-assignment and surfaces client/contract drift instead of
    silently dropping fields. Do NOT use for schemas that must stay
    backward-compatible with older clients (e.g. offline-sync order payloads).
    """

    model_config = ConfigDict(extra="forbid")


# Collection-size caps — bound request payloads against resource exhaustion.
MAX_ORDER_ITEMS = 200
MAX_PAYMENTS = 10
MAX_MODIFIER_OPTIONS = 50
MAX_REFUND_ITEMS = 200
MAX_OFFLINE_SALES_BATCH = 100
MAX_MODIFIER_GROUP_ASSIGNMENTS = 50


def reject_null(value: object) -> object:
    """Reject explicit null for PATCH fields backed by NOT NULL columns.

    Use as a field validator on optional update fields. Omitted fields keep
    their default, so partial updates still leave existing values unchanged.
    """
    if value is None:
        raise ValueError("El campo no puede ser nulo")
    return value


def omit_null_default(schema: dict[str, object]) -> None:
    """Omitted PATCH fields preserve stored values, rather than defaulting to null."""
    if schema.get("default") is None:
        schema.pop("default", None)


_HTML_TAG_RE = re.compile(r"<[^>]+>")


def reject_html(value: str | None) -> str | None:
    """Reject values containing HTML-like tags. Defense-in-depth for names that
    are always rendered as plain text downstream."""
    if value is None:
        return value
    if _HTML_TAG_RE.search(value):
        raise ValueError("El texto no puede contener etiquetas HTML")
    return value


# Magic-byte signatures for the only image types we accept. Each entry maps a
# declared content-type to a predicate over the leading bytes. The declared MIME
# is never trusted on its own — the actual bytes must match.
def _is_png(data: bytes) -> bool:
    return data.startswith(b"\x89PNG\r\n\x1a\n")


def _is_jpeg(data: bytes) -> bool:
    return data.startswith(b"\xff\xd8\xff")


def _is_webp(data: bytes) -> bool:
    return len(data) >= 12 and data[0:4] == b"RIFF" and data[8:12] == b"WEBP"


_IMAGE_SIGNATURES = {
    "image/png": _is_png,
    "image/jpeg": _is_jpeg,
    "image/webp": _is_webp,
}


def verify_image_signature(content_type: str, data: bytes) -> None:
    """Confirm the file's actual bytes match its declared image content-type.

    Blocks MIME spoofing and polyglot uploads (e.g. a script body declared as
    image/png). Raises HTTP 400 on mismatch. Callers should still validate the
    content-type against their allowlist first.
    """
    check = _IMAGE_SIGNATURES.get(content_type)
    if check is None or not check(data):
        raise bad_request("El archivo no coincide con el tipo de imagen declarado.")
