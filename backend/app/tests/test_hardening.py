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


@pytest.mark.parametrize("key", ["email", "password", "total_amount", "query_string"])
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
