import re
from typing import Any, Self

from pydantic import BaseModel, Field, field_validator, model_validator

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
        "landing_story_step_viewed",
        "landing_cta_clicked",
        "signup_started",
        "signup_completed",
        "signup_validation_failed",
        "experiment_exposed",
    }
)

# Property keys an anonymous event must never carry. The endpoint stores no
# tenant/user identity and no PII; rejecting these keys keeps a client from
# smuggling identity/PII into the coarse metadata blob.
FORBIDDEN_PROPERTY_KEYS = frozenset(
    {
        "tenant_id",
        "user_id",
        "email",
        "name",
        "phone",
        "password",
        "amount",
        "total_amount",
        "amount_minor_units",
        "query",
        "query_string",
        "full_url",
    }
)

COMMON_CONTEXT_KEYS = frozenset(
    {
        "client_id",
        "path",
        "device_class",
        "viewport_bucket",
        "source",
        "medium",
        "campaign",
        "cta",
        "section",
        "experiment_id",
        "variant",
        "step",
        "trigger",
    }
)
DEVICE_CLASSES = frozenset({"mobile", "tablet", "desktop"})
VIEWPORT_BUCKETS = frozenset(
    {"mobile_320", "mobile_390", "tablet", "desktop", "desktop_wide"}
)
SIGNUP_VALIDATION_FIELDS = frozenset({"business", "email", "password", "terms", "form"})
SIGNUP_VALIDATION_REASONS = frozenset(
    {
        "required",
        "invalid_format",
        "too_short",
        "too_long",
        "weak_password",
        "not_accepted",
        "server_validation",
    }
)
SALE_VALIDATION_FIELDS = frozenset(
    {"cart", "cash_tendered", "payment_total", "open_shift", "permission"}
)
SALE_VALIDATION_REASONS = frozenset(
    {
        "empty_cart",
        "insufficient_cash",
        "split_mismatch",
        "cash_requires_shift",
        "permission_denied",
    }
)
CHECKOUT_STATES = frozenset(
    {
        "available",
        "trialing",
        "active",
        "past_due",
        "incomplete",
        "canceled",
        "unpaid",
        "return_success_pending",
        "return_success_active",
        "return_cancel",
    }
)
EXPERIMENTS = frozenset({"exp_01_cta_specificity"})
EXPERIMENT_VARIANTS = frozenset({"control", "treatment"})
LANDING_STORY_STEPS = frozenset({"sale", "inventory", "cash", "reports"})
LANDING_STORY_TRIGGERS = frozenset({"scroll", "control"})
ATTRIBUTION_PATTERN = re.compile(r"^[a-z0-9][a-z0-9._~-]{0,79}$")
CLIENT_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$")


def _bound_property_blob(value: dict[str, Any]) -> dict[str, Any]:
    # Cap the unbounded JSON blob so a client can't store arbitrarily large
    # payloads in the telemetry table (cheap storage-abuse / DoS vector).
    if len(value) > MAX_PROPERTIES:
        raise ValueError(f"properties supports at most {MAX_PROPERTIES} keys")
    for key, val in value.items():
        if str(key).lower() in FORBIDDEN_PROPERTY_KEYS:
            raise ValueError(f"telemetry events may not carry '{key}'")
        if len(str(key)) > MAX_PROPERTY_KEY_LEN:
            raise ValueError("property key is too long")
        if isinstance(val, str) and len(val) > MAX_PROPERTY_VALUE_LEN:
            raise ValueError("property value is too long")
    return value


def _validate_common_context(value: dict[str, Any]) -> None:
    client_id = value.get("client_id")
    if client_id is not None and (
        not isinstance(client_id, str) or not CLIENT_ID_PATTERN.fullmatch(client_id)
    ):
        raise ValueError("client_id is not a valid pseudonymous identifier")
    device_class = value.get("device_class")
    if device_class is not None and device_class not in DEVICE_CLASSES:
        raise ValueError("device_class is not an allowed category")
    viewport_bucket = value.get("viewport_bucket")
    if viewport_bucket is not None and viewport_bucket not in VIEWPORT_BUCKETS:
        raise ValueError("viewport_bucket is not an allowed category")
    path = value.get("path")
    if path is not None and (
        not isinstance(path, str) or not path.startswith("/") or "?" in path or "#" in path
    ):
        raise ValueError("path must not contain a query string or fragment")
    for key in ("source", "medium", "campaign"):
        item = value.get(key)
        if item is not None and (
            not isinstance(item, str) or not ATTRIBUTION_PATTERN.fullmatch(item)
        ):
            raise ValueError(f"{key} is not a valid attribution category")


def _require_category(
    properties: dict[str, Any], key: str, categories: frozenset[str]
) -> None:
    if properties.get(key) not in categories:
        raise ValueError(f"{key} is not an allowed category")


def _validate_diagnostic_event(event_name: str, properties: dict[str, Any]) -> None:
    specific_keys: frozenset[str]
    if event_name == "signup_validation_failed":
        specific_keys = frozenset({"field", "reason_code"})
        _require_category(properties, "field", SIGNUP_VALIDATION_FIELDS)
        _require_category(properties, "reason_code", SIGNUP_VALIDATION_REASONS)
    elif event_name == "sale_validation_blocked":
        specific_keys = frozenset({"field", "reason_code"})
        _require_category(properties, "field", SALE_VALIDATION_FIELDS)
        _require_category(properties, "reason_code", SALE_VALIDATION_REASONS)
    elif event_name == "checkout_state_viewed":
        specific_keys = frozenset({"state"})
        _require_category(properties, "state", CHECKOUT_STATES)
    elif event_name == "experiment_exposed":
        specific_keys = frozenset({"experiment_id", "variant", "cta"})
        _require_category(properties, "experiment_id", EXPERIMENTS)
        _require_category(properties, "variant", EXPERIMENT_VARIANTS)
        if not isinstance(properties.get("cta"), str) or not properties["cta"]:
            raise ValueError("cta is required")
    elif event_name == "landing_story_step_viewed":
        specific_keys = frozenset({"step", "trigger"})
        _require_category(properties, "step", LANDING_STORY_STEPS)
        _require_category(properties, "trigger", LANDING_STORY_TRIGGERS)
    else:
        return

    unexpected = set(properties) - COMMON_CONTEXT_KEYS - specific_keys
    if unexpected:
        raise ValueError("diagnostic event contains unsupported properties")


class TelemetryEventCreate(StrictModel):
    event_name: str = Field(min_length=1, max_length=120, pattern=r"^[a-z0-9_.:-]+$")
    client_event_id: str = Field(min_length=1, max_length=80)
    properties: dict[str, Any] = Field(default_factory=dict)

    @field_validator("properties")
    @classmethod
    def _bound_properties(cls, value: dict[str, Any]) -> dict[str, Any]:
        return _bound_property_blob(value)

    @model_validator(mode="after")
    def _validate_cro_categories(self) -> Self:
        _validate_common_context(self.properties)
        _validate_diagnostic_event(self.event_name, self.properties)
        return self


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
        return _bound_property_blob(value)

    @model_validator(mode="after")
    def _validate_cro_categories(self) -> Self:
        _validate_common_context(self.properties)
        _validate_diagnostic_event(self.event_name, self.properties)
        return self


class TelemetryEventResponse(BaseModel):
    accepted: bool = True
