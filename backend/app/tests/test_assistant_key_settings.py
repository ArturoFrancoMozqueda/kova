"""Provisioned-name compatibility never changes provider or approval defaults."""

from app.config import Settings


def test_provisioned_open_route_key_is_private_and_preserves_activation_gates(monkeypatch):
    monkeypatch.delenv("ASSISTANT_OPENROUTER_API_KEY", raising=False)
    monkeypatch.setenv("ASSISTANT_OPEN_ROUTE", "test-only-provisioned-token")
    configured = Settings(_env_file=None)
    assert configured.assistant_openrouter_api_key.get_secret_value() == (
        "test-only-provisioned-token"
    )
    assert "test-only-provisioned-token" not in configured.model_dump_json()
    assert not configured.assistant_openrouter_quality_verified
    assert not configured.assistant_documents_enabled
    assert configured.assistant_openrouter_monthly_usd == 0
    assert configured.assistant_generation_provider == "cloudflare"


def test_canonical_environment_key_takes_precedence(monkeypatch):
    monkeypatch.setenv("ASSISTANT_OPEN_ROUTE", "test-only-alternate-token")
    monkeypatch.setenv("ASSISTANT_OPENROUTER_API_KEY", "test-only-canonical-token")
    configured = Settings(_env_file=None)
    assert configured.assistant_openrouter_api_key.get_secret_value() == (
        "test-only-canonical-token"
    )


def test_canonical_constructor_field_remains_supported(monkeypatch):
    monkeypatch.delenv("ASSISTANT_OPENROUTER_API_KEY", raising=False)
    monkeypatch.delenv("ASSISTANT_OPEN_ROUTE", raising=False)
    configured = Settings(_env_file=None, assistant_openrouter_api_key="test-only-direct-token")
    assert configured.assistant_openrouter_api_key.get_secret_value() == "test-only-direct-token"
