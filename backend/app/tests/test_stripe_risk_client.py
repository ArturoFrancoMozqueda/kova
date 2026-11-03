"""HTTP contract only; no Stripe API writes or real credentials."""
from io import BytesIO
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlsplit

import pytest

from app.billing import stripe_client
from app.billing.stripe_client import StripeRiskClient, StripeRiskError


def test_risk_client_only_reads_current_object_graph_and_paginated_paid_invoice_payments(monkeypatch):
    requests = []
    def respond(request, **kwargs):
        requests.append(request)
        return BytesIO(b'{"data":[],"has_more":false}')
    monkeypatch.setattr(stripe_client, "urlopen", respond)
    client = StripeRiskClient()
    client.invoice_payments(secret_key="synthetic-key", payment_intent="pi_synthetic",
                            starting_after="inpay_page")
    client.retrieve(secret_key="synthetic-key", resource="charges", object_id="ch_synthetic")
    client.retrieve(secret_key="synthetic-key", resource="invoices", object_id="in_synthetic")
    client.retrieve(secret_key="synthetic-key", resource="subscriptions", object_id="sub_synthetic")
    assert all(request.get_method() == "GET" for request in requests)
    assert all(request.headers["Stripe-version"] == "2026-09-30.endive" for request in requests)
    assert parse_qs(urlsplit(requests[0].full_url).query) == {
        "payment[type]": ["payment_intent"], "payment[payment_intent]": ["pi_synthetic"],
        "status": ["paid"], "limit": ["100"], "starting_after": ["inpay_page"],
    }
    with pytest.raises(StripeRiskError):
        client.retrieve(secret_key="synthetic-key", resource="refunds", object_id="re_synthetic")


@pytest.mark.parametrize("failure", ["private_error", "invalid_json", "too_large"])
def test_risk_client_does_not_expose_provider_bodies_or_unbounded_content(monkeypatch, failure):
    def respond(request, **kwargs):
        if failure == "private_error":
            raise HTTPError(request.full_url, 403, "NEVER_PERSIST", {},
                            BytesIO(b"private provider response"))
        return BytesIO(b"invalid NEVER_PERSIST" if failure == "invalid_json" else b"x"*1_048_577)
    monkeypatch.setattr(stripe_client, "urlopen", respond)
    with pytest.raises(StripeRiskError) as error:
        StripeRiskClient().retrieve(secret_key="synthetic-key", resource="charges", object_id="ch_qa")
    assert "NEVER_PERSIST" not in str(error.value)
    assert "private provider response" not in str(error.value)
