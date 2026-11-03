"""Portal configuration must include the product details used by server safety gates."""

import io
import json
from urllib.parse import parse_qs, quote, urlsplit

import pytest
from fastapi import HTTPException

from app.billing import service, stripe_client
from app.config import settings


def _configuration():
    return {
        "id": "bpc_synthetic", "active": True, "livemode": False,
        "features": {"subscription_update": {
            "enabled": True, "default_allowed_updates": ["price"],
            "products": [{
                "product": "prod_synthetic", "prices": ["price_esencial", "price_gestion"],
                "adjustable_quantity": {"enabled": False},
            }],
            "proration_behavior": "always_invoice",
            "schedule_at_period_end": {"conditions": [{"type": "decreasing_item_amount"}]},
        }},
    }


@pytest.mark.parametrize("configuration_id", ["bpc_synthetic", "bpc_synthetic/unsafe?x=1"])
def test_configuration_http_request_expands_product_settings(monkeypatch, configuration_id):
    captured = []
    configuration = _configuration()

    def fake_urlopen(request, timeout):
        captured.append((request, timeout))
        return io.BytesIO(json.dumps(configuration).encode())

    monkeypatch.setattr(stripe_client, "urlopen", fake_urlopen)
    result = stripe_client.StripePortalClient().retrieve_configuration(
        secret_key="synthetic-restricted-test-only", configuration_id=configuration_id,
    )

    assert result == configuration
    request, timeout = captured[0]
    url = urlsplit(request.full_url)
    assert request.get_method() == "GET"
    assert url.scheme == "https" and url.netloc == "api.stripe.com"
    assert url.path == "/v1/billing_portal/configurations/" + quote(configuration_id, safe="")
    assert parse_qs(url.query) == {"expand[]": ["features.subscription_update.products"]}
    assert request.data is None
    assert request.get_header("Authorization") == "Bearer synthetic-restricted-test-only"
    assert timeout == 10


@pytest.mark.parametrize("adjustable", [None, False, True])
def test_plan_changes_accept_only_fixed_quantity_configuration(monkeypatch, adjustable):
    monkeypatch.setattr(settings, "app_env", "local")
    monkeypatch.setattr(settings, "stripe_esencial_price_id", "price_esencial")
    monkeypatch.setattr(settings, "stripe_gestion_price_id", "price_gestion")
    configuration = _configuration()
    product = configuration["features"]["subscription_update"]["products"][0]
    if adjustable is None:
        product.pop("adjustable_quantity")
    else:
        product["adjustable_quantity"]["enabled"] = adjustable

    if adjustable:
        with pytest.raises(HTTPException) as error:
            service._validate_portal_configuration(
                configuration, configuration_id="bpc_synthetic", tiered=True,
            )
        assert error.value.status_code == 503
    else:
        service._validate_portal_configuration(
            configuration, configuration_id="bpc_synthetic", tiered=True,
        )


@pytest.mark.parametrize("updates_enabled", [False, True])
def test_two_product_catalog_can_only_use_payment_and_cancellation_portal(monkeypatch, updates_enabled):
    monkeypatch.setattr(settings, "app_env", "local")
    monkeypatch.setattr(settings, "stripe_esencial_price_id", "price_esencial")
    monkeypatch.setattr(settings, "stripe_gestion_price_id", "price_gestion")
    configuration = _configuration()
    update = configuration["features"]["subscription_update"]
    update["enabled"] = updates_enabled
    update["products"] = [
        {"product": "prod_esencial", "prices": ["price_esencial"]},
        {"product": "prod_gestion", "prices": ["price_gestion"]},
    ]
    if updates_enabled:
        with pytest.raises(HTTPException) as error:
            service._validate_portal_configuration(
                configuration, configuration_id="bpc_synthetic", tiered=True,
            )
        assert error.value.status_code == 503
    else:
        service._validate_portal_configuration(
            configuration, configuration_id="bpc_synthetic", tiered=True,
        )
