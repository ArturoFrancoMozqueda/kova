"""Unit coverage for the security/validation hardening.

- APP_ENV=local with live Stripe keys must refuse to boot (dev token leak).
- Telemetry properties are bounded (storage-abuse / DoS guard).
"""

import pytest
from pydantic import ValidationError

from app.config import settings
from app.main import _validate_config
from app.telemetry.schemas import MAX_PROPERTIES, TelemetryEventCreate


def test_config_rejects_local_with_live_stripe_key(monkeypatch) -> None:
    monkeypatch.setattr(settings, "app_env", "local")
    monkeypatch.setattr(settings, "stripe_secret_key", "sk_live_abc123")
    with pytest.raises(RuntimeError, match="APP_ENV=local with live Stripe keys"):
        _validate_config()


def test_config_allows_local_with_test_stripe_key(monkeypatch) -> None:
    monkeypatch.setattr(settings, "app_env", "local")
    monkeypatch.setattr(settings, "stripe_secret_key", "sk_test_abc123")
    # Should not raise (default secret key is fine in local).
    _validate_config()


def test_telemetry_rejects_too_many_properties() -> None:
    props = {f"k{i}": i for i in range(MAX_PROPERTIES + 1)}
    with pytest.raises(ValidationError):
        TelemetryEventCreate(event_name="test.event", client_event_id="abc", properties=props)


def test_telemetry_rejects_oversized_value() -> None:
    with pytest.raises(ValidationError):
        TelemetryEventCreate(
            event_name="test.event",
            client_event_id="abc",
            properties={"note": "x" * 501},
        )


@pytest.mark.parametrize(
    "key",
    [
        "email",
        "password",
        "total_amount",
        "query_string",
        "product_id",
        "recommended_product_id",
    ],
)
def test_telemetry_rejects_pii_and_financial_properties(key: str) -> None:
    with pytest.raises(ValidationError):
        TelemetryEventCreate(
            event_name="test.event",
            client_event_id="abc",
            properties={key: "must-not-be-stored"},
        )


def test_telemetry_rejects_email_like_attribution() -> None:
    with pytest.raises(ValidationError):
        TelemetryEventCreate(
            event_name="test.event",
            client_event_id="abc",
            properties={"source": "owner@example.com"},
        )


def test_telemetry_accepts_normal_payload() -> None:
    event = TelemetryEventCreate(
        event_name="funnel.first_sale",
        client_event_id="evt-1",
        properties={"source": "register", "count": 3},
    )
    assert event.event_name == "funnel.first_sale"


def test_activation_events_accept_context_only() -> None:
    event = TelemetryEventCreate(
        event_name="close_shift",
        client_event_id="evt-close-shift",
        properties={"path": "/shifts", "device_class": "desktop"},
    )
    assert event.event_name == "close_shift"

    with pytest.raises(ValidationError):
        TelemetryEventCreate(
            event_name="close_shift",
            client_event_id="evt-close-shift-invalid",
            properties={"variance": "120.00"},
        )


def test_telemetry_accepts_categorical_analysis_view() -> None:
    event = TelemetryEventCreate(
        event_name="analysis_viewed",
        client_event_id="evt-analysis-view",
        properties={
            "range_days": 7,
            "preset": "seven_days",
            "has_previous_period": True,
            "recommendation_count": 3,
        },
    )
    assert event.properties["preset"] == "seven_days"


def test_telemetry_accepts_categorical_analysis_action() -> None:
    event = TelemetryEventCreate(
        event_name="analysis_action_completed",
        client_event_id="evt-analysis-action",
        properties={
            "template_id": "R2",
            "decision_area": "inventario",
            "priority": "alta",
            "surface": "prioridad",
        },
    )
    assert event.properties["decision_area"] == "inventario"


def test_telemetry_accepts_categorical_analysis_feedback() -> None:
    event = TelemetryEventCreate(
        event_name="analysis_action_feedback",
        client_event_id="evt-analysis-feedback",
        properties={
            "template_id": "R2",
            "decision_area": "inventario",
            "priority": "alta",
            "surface": "prioridad",
            "helpfulness": "helpful",
        },
    )
    assert event.properties["helpfulness"] == "helpful"


@pytest.mark.parametrize(
    ("event_name", "properties"),
    [
        (
            "analysis_viewed",
            {
                "range_days": 7,
                "preset": "seven_days",
                "has_previous_period": True,
                "recommendation_count": 3,
                "net_sales": "1200.00",
            },
        ),
        (
            "analysis_action_started",
            {
                "template_id": "R99",
                "decision_area": "inventario",
                "priority": "alta",
                "surface": "prioridad",
            },
        ),
        (
            "analysis_action_completed",
            {
                "template_id": "R2",
                "decision_area": "unknown",
                "priority": "alta",
                "surface": "prioridad",
            },
        ),
        (
            "analysis_action_completed",
            {
                "template_id": "R13",
                "decision_area": "caja",
                "priority": "baja",
                "surface": "prioridad",
            },
        ),
        (
            "analysis_action_feedback",
            {
                "template_id": "R2",
                "decision_area": "inventario",
                "priority": "alta",
                "surface": "plan",
                "helpfulness": "maybe",
            },
        ),
    ],
)
def test_telemetry_rejects_invalid_analysis_payloads(
    event_name: str, properties: dict[str, object]
) -> None:
    with pytest.raises(ValidationError):
        TelemetryEventCreate(
            event_name=event_name,
            client_event_id="evt-invalid-analysis",
            properties=properties,
        )
