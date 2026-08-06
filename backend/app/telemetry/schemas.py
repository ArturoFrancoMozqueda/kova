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
        "product_demo_viewed",
        "product_demo_step_changed",
        "pricing_viewed",
        "whatsapp_clicked",
        "login_clicked",
        "faq_opened",
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
        "product_id",
        "customer_id",
        "employee_id",
        "supplier_id",
        "order_id",
        "subscription_id",
        "query",
        "query_string",
        "full_url",
    }
)
FORBIDDEN_PROPERTY_KEY_PATTERN = re.compile(
    r"(^|_)(email|name|phone|password|amount|tenant_id|user_id|order_id|product_id|"
    r"customer_id|employee_id|supplier_id|subscription_id|query|url)($|_)",
    re.IGNORECASE,
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
ADOPTION_CONTEXT_KEYS = frozenset(
    {
        "client_id",
        "path",
        "device_class",
        "viewport_bucket",
        "source",
        "medium",
        "campaign",
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
ANALYSIS_EVENT_NAMES = frozenset(
    {
        "analysis_viewed",
        "analysis_recommendation_opened",
        "analysis_action_started",
        "analysis_action_completed",
        "analysis_action_reopened",
        "analysis_action_feedback",
    }
)
ANALYSIS_DECISION_AREAS = frozenset(
    {"caja", "inventario", "margen", "gasto", "cliente", "empleado", "crecimiento"}
)
ANALYSIS_PRIORITIES = frozenset({"alta", "media", "baja"})
ANALYSIS_SURFACES = frozenset({"prioridad", "plan"})
ANALYSIS_PRESETS = frozenset({"today", "seven_days", "month", "custom"})
ANALYSIS_TEMPLATE_PATTERN = re.compile(r"^R(?:[1-9]|1[0-3])$")
ANALYSIS_ACTION_TEMPLATE_PATTERN = re.compile(r"^R(?:[1-9]|1[0-2])$")
ANALYSIS_HELPFULNESS = frozenset({"helpful", "not_yet"})
ACTIVATION_EVENT_NAMES = frozenset(
    {"first_product_created", "first_sale_completed", "open_shift", "close_shift"}
)
EXPERIMENTS = frozenset({"exp_01_cta_specificity"})
EXPERIMENT_VARIANTS = frozenset({"control", "treatment"})
LANDING_STORY_STEPS = frozenset({"sale", "inventory", "cash", "reports"})
LANDING_STORY_TRIGGERS = frozenset({"scroll", "control"})
LANDING_CONTACT_SECTIONS = frozenset({"faq", "footer"})
LANDING_LOGIN_SECTIONS = frozenset({"navigation", "footer"})
LANDING_FAQ_ITEMS = frozenset({f"faq_{index}" for index in range(1, 9)})
ATTRIBUTION_PATTERN = re.compile(r"^[a-z0-9][a-z0-9._~-]{0,79}$")
CLIENT_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$")


def _bound_property_blob(value: dict[str, Any]) -> dict[str, Any]:
    # Cap the unbounded JSON blob so a client can't store arbitrarily large
    # payloads in the telemetry table (cheap storage-abuse / DoS vector).
    if len(value) > MAX_PROPERTIES:
        raise ValueError(f"properties supports at most {MAX_PROPERTIES} keys")
    for key, val in value.items():
        if (
            str(key).lower() in FORBIDDEN_PROPERTY_KEYS
            or FORBIDDEN_PROPERTY_KEY_PATTERN.search(str(key))
        ):
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
    elif event_name in {"landing_story_step_viewed", "product_demo_step_changed"}:
        specific_keys = frozenset({"step", "trigger"})
        _require_category(properties, "step", LANDING_STORY_STEPS)
        _require_category(properties, "trigger", LANDING_STORY_TRIGGERS)
    elif event_name == "product_demo_viewed":
        specific_keys = frozenset({"section"})
        _require_category(properties, "section", frozenset({"producto"}))
    elif event_name == "pricing_viewed":
        specific_keys = frozenset({"section"})
        _require_category(properties, "section", frozenset({"precio"}))
    elif event_name == "whatsapp_clicked":
        specific_keys = frozenset({"section"})
        _require_category(properties, "section", LANDING_CONTACT_SECTIONS)
    elif event_name == "login_clicked":
        specific_keys = frozenset({"section"})
        _require_category(properties, "section", LANDING_LOGIN_SECTIONS)
    elif event_name == "faq_opened":
        specific_keys = frozenset({"section"})
        _require_category(properties, "section", LANDING_FAQ_ITEMS)
    else:
        return

    unexpected = set(properties) - COMMON_CONTEXT_KEYS - specific_keys
    if unexpected:
        raise ValueError("diagnostic event contains unsupported properties")


def _validate_analysis_event(event_name: str, properties: dict[str, Any]) -> None:
    """Keep product-adoption telemetry categorical and free of business data.

    Exact sales, product identifiers and recommendation copy stay in the
    tenant's operational tables. Telemetry records only enough information to
    measure whether Kova's analysis leads owners from a finding to an action.
    """
    if event_name not in ANALYSIS_EVENT_NAMES:
        return

    if event_name == "analysis_viewed":
        specific_keys = frozenset(
            {"range_days", "preset", "has_previous_period", "recommendation_count"}
        )
        range_days = properties.get("range_days")
        recommendation_count = properties.get("recommendation_count")
        if (
            not isinstance(range_days, int)
            or isinstance(range_days, bool)
            or not 1 <= range_days <= 366
        ):
            raise ValueError("range_days must be an integer between 1 and 366")
        if (
            not isinstance(recommendation_count, int)
            or isinstance(recommendation_count, bool)
            or not 0 <= recommendation_count <= 20
        ):
            raise ValueError("recommendation_count must be an integer between 0 and 20")
        _require_category(properties, "preset", ANALYSIS_PRESETS)
        if not isinstance(properties.get("has_previous_period"), bool):
            raise ValueError("has_previous_period must be boolean")
    else:
        specific_keys = frozenset({"template_id", "decision_area", "priority", "surface"})
        template_id = properties.get("template_id")
        if not isinstance(template_id, str) or not ANALYSIS_TEMPLATE_PATTERN.fullmatch(template_id):
            raise ValueError("template_id is not an allowed analysis template")
        actionable_template = ANALYSIS_ACTION_TEMPLATE_PATTERN.fullmatch(template_id)
        if event_name != "analysis_recommendation_opened" and not actionable_template:
            raise ValueError("template_id is not an actionable analysis template")
        _require_category(properties, "decision_area", ANALYSIS_DECISION_AREAS)
        _require_category(properties, "priority", ANALYSIS_PRIORITIES)
        _require_category(properties, "surface", ANALYSIS_SURFACES)
        if event_name == "analysis_action_feedback":
            specific_keys = specific_keys | {"helpfulness"}
            _require_category(properties, "helpfulness", ANALYSIS_HELPFULNESS)

    unexpected = set(properties) - ADOPTION_CONTEXT_KEYS - specific_keys
    if unexpected:
        raise ValueError("analysis event contains unsupported properties")


def _validate_activation_event(event_name: str, properties: dict[str, Any]) -> None:
    if event_name not in ACTIVATION_EVENT_NAMES:
        return
    if set(properties) - ADOPTION_CONTEXT_KEYS:
        raise ValueError("activation event contains unsupported properties")


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
        _validate_analysis_event(self.event_name, self.properties)
        _validate_activation_event(self.event_name, self.properties)
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


class AnalysisAdoptionWindow(StrictModel):
    days: int
    start: str
    end: str


class AnalysisAdoptionTenants(StrictModel):
    active: int
    viewed: int
    active_viewed: int
    completed_action: int
    helpful_action: int
    not_yet_action: int
    active_completed_action: int
    active_helpful_action: int


class AnalysisAdoptionRates(StrictModel):
    active_view_rate: float
    viewer_completion_rate: float
    viewer_helpful_rate: float
    active_completion_rate: float
    active_helpful_rate: float


class AnalysisAdoptionRetention(StrictModel):
    previous_viewed: int
    returning_viewed: int
    return_rate: float


class AnalysisAdoptionJourney(StrictModel):
    sold: int
    closed_shift: int
    sale_close_analysis: int
    sale_close_analysis_rate: float


class AnalysisAdoptionReport(StrictModel):
    window: AnalysisAdoptionWindow
    tenants: AnalysisAdoptionTenants
    rates: AnalysisAdoptionRates
    retention: AnalysisAdoptionRetention
    journey: AnalysisAdoptionJourney
    events: dict[str, int]
    decision_areas: dict[str, int]
    completed_decision_areas: dict[str, int]
