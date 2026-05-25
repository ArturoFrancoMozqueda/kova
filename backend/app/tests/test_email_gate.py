import pytest

from app.config import settings
from app.main import _validate_config


def test_production_requires_resend_api_key(monkeypatch) -> None:
    monkeypatch.setattr(settings, "app_env", "production")
    monkeypatch.setattr(settings, "secret_key", "a-real-long-secret-value-not-the-default")
    monkeypatch.setattr(settings, "stripe_secret_key", "sk_live_123")
    monkeypatch.setattr(settings, "resend_api_key", None)
    monkeypatch.setattr(settings, "email_from", "hola@kova.example")

    with pytest.raises(RuntimeError, match="RESEND_API_KEY"):
        _validate_config()


def test_production_rejects_default_email_from(monkeypatch) -> None:
    monkeypatch.setattr(settings, "app_env", "production")
    monkeypatch.setattr(settings, "secret_key", "a-real-long-secret-value-not-the-default")
    monkeypatch.setattr(settings, "stripe_secret_key", "sk_live_123")
    monkeypatch.setattr(settings, "resend_api_key", "re_test_123")
    monkeypatch.setattr(settings, "email_from", "onboarding@resend.dev")

    with pytest.raises(RuntimeError, match="EMAIL_FROM"):
        _validate_config()


def test_production_passes_with_complete_email_config(monkeypatch) -> None:
    monkeypatch.setattr(settings, "app_env", "production")
    monkeypatch.setattr(settings, "secret_key", "a-real-long-secret-value-not-the-default")
    monkeypatch.setattr(settings, "stripe_secret_key", "sk_live_123")
    monkeypatch.setattr(settings, "resend_api_key", "re_live_123")
    monkeypatch.setattr(settings, "email_from", "hola@kova.example")

    _validate_config()


def test_local_env_does_not_require_email_config(monkeypatch) -> None:
    monkeypatch.setattr(settings, "app_env", "local")
    monkeypatch.setattr(settings, "resend_api_key", None)
    monkeypatch.setattr(settings, "email_from", "onboarding@resend.dev")

    _validate_config()
