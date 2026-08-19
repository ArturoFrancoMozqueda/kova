"""Allowlist-based sanitization for anything derived from raw external data.

The ops dashboard surfaces Stripe webhook payloads and telemetry properties for
debugging. Those blobs can carry card data, PII, and secrets, so we extract an
explicit allowlist of fields rather than redacting a blacklist — a field we
didn't think of can never leak this way.
"""
from typing import Any

# Top-level Stripe event fields safe to surface.
_EVENT_ALLOWED = ("id", "type", "created", "livemode")

# Fields of the event's `data.object` safe to surface. Deliberately excludes
# card/payment_method_details/client_secret/receipt_* and all customer PII
# (name/email/address/phone) — the tenant is identified by tenant_id and
# stripe_customer_id, never by personal data.
_OBJECT_ALLOWED = (
    "id",
    "object",
    "status",
    "customer",
    "subscription",
    "cancel_at_period_end",
    "current_period_start",
    "current_period_end",
    "trial_end",
    "amount_due",
    "amount_paid",
    "amount_remaining",
    "currency",
)

_MAX_PROPERTY_LEN = 100


def sanitize_webhook_payload(payload: dict[str, Any] | None) -> dict[str, Any]:
    """Reduce a raw Stripe event payload to a safe allowlisted subset."""
    if not isinstance(payload, dict):
        return {}
    result: dict[str, Any] = {
        key: payload[key] for key in _EVENT_ALLOWED if key in payload
    }
    data = payload.get("data")
    obj = data.get("object") if isinstance(data, dict) else None
    if isinstance(obj, dict):
        safe_obj = {key: obj[key] for key in _OBJECT_ALLOWED if key in obj}
        # tenant_id is the one metadata key we rely on for correlation.
        metadata = obj.get("metadata")
        if isinstance(metadata, dict) and "tenant_id" in metadata:
            safe_obj["metadata"] = {"tenant_id": metadata["tenant_id"]}
        result["object"] = safe_obj
    return result


def sanitize_properties(properties: dict[str, Any] | None) -> dict[str, Any]:
    """Keep only scalar telemetry properties, truncating long strings."""
    if not isinstance(properties, dict):
        return {}
    safe: dict[str, Any] = {}
    for key, value in properties.items():
        if isinstance(value, str):
            safe[key] = value[:_MAX_PROPERTY_LEN]
        elif isinstance(value, (int, float, bool)) or value is None:
            safe[key] = value
        # dicts/lists are dropped — they can nest arbitrary unvetted data.
    return safe
