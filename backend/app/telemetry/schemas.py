from typing import Any

from pydantic import BaseModel, Field, field_validator

from app.shared.validation import StrictModel

MAX_PROPERTIES = 50
MAX_PROPERTY_KEY_LEN = 80
MAX_PROPERTY_VALUE_LEN = 500

# Fixed allowlist of pre-authentication event types the anonymous endpoint will
# accept. Anything not on this list is rejected — the endpoint is unauthenticated
# so it must never become a general-purpose write vector.
ANONYMOUS_EVENT_NAMES = frozenset(
    {
        "landing_viewed",
        "landing_section_viewed",
        "landing_cta_clicked",
        "signup_started",
    }
)

# Property keys an anonymous event must never carry. The endpoint stores no
# tenant/user identity and no PII; rejecting these keys keeps a client from
# smuggling identity/PII into the coarse metadata blob.
FORBIDDEN_ANONYMOUS_PROPERTY_KEYS = frozenset(
    {"tenant_id", "user_id", "email", "name", "phone", "password"}
)


def _bound_property_blob(value: dict[str, Any]) -> dict[str, Any]:
    # Cap the unbounded JSON blob so a client can't store arbitrarily large
    # payloads in the telemetry table (cheap storage-abuse / DoS vector).
    if len(value) > MAX_PROPERTIES:
        raise ValueError(f"properties supports at most {MAX_PROPERTIES} keys")
    for key, val in value.items():
        if len(str(key)) > MAX_PROPERTY_KEY_LEN:
            raise ValueError("property key is too long")
        if isinstance(val, str) and len(val) > MAX_PROPERTY_VALUE_LEN:
            raise ValueError("property value is too long")
    return value


class TelemetryEventCreate(StrictModel):
    event_name: str = Field(min_length=1, max_length=120, pattern=r"^[a-z0-9_.:-]+$")
    client_event_id: str = Field(min_length=1, max_length=80)
    properties: dict[str, Any] = Field(default_factory=dict)

    @field_validator("properties")
    @classmethod
    def _bound_properties(cls, value: dict[str, Any]) -> dict[str, Any]:
        return _bound_property_blob(value)


class AnonymousTelemetryEventCreate(StrictModel):
    """Body for the unauthenticated pre-auth telemetry path.

    Strictly validated: the event type must be on :data:`ANONYMOUS_EVENT_NAMES`,
    no tenant/user identifiers are accepted (``StrictModel`` forbids unknown
    top-level fields, and ``properties`` rejects identity/PII keys), and the
    metadata blob is bounded like the authenticated schema.
    """

    event_name: str = Field(min_length=1, max_length=120)
    client_event_id: str = Field(min_length=1, max_length=80)
    client_id: str = Field(min_length=1, max_length=80)
    properties: dict[str, Any] = Field(default_factory=dict)

    @field_validator("event_name")
    @classmethod
    def _allowlisted_event(cls, value: str) -> str:
        if value not in ANONYMOUS_EVENT_NAMES:
            raise ValueError("event_name is not an allowed anonymous event")
        return value

    @field_validator("properties")
    @classmethod
    def _bound_and_scrub_properties(cls, value: dict[str, Any]) -> dict[str, Any]:
        for key in value:
            if str(key).lower() in FORBIDDEN_ANONYMOUS_PROPERTY_KEYS:
                raise ValueError(f"anonymous events may not carry '{key}'")
        return _bound_property_blob(value)


class TelemetryEventResponse(BaseModel):
    accepted: bool = True
