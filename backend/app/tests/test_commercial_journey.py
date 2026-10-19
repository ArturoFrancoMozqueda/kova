"""Attribution uses explicit links and never treats a pipeline stage as payment."""

from uuid import uuid4

import pytest

from app.tests.test_crm import create as create_opportunity
from app.tests.test_customer_orders import _confirm, _seed, _signup_login
from app.tests.test_quotes import action, create, setup

pytestmark = pytest.mark.usefixtures("fast_business_auth")


def test_quote_journey_tracks_only_explicit_sale_and_recorded_payments(client, db):
    _, customer, product = setup(client, db)
    opportunity = create_opportunity(client, customer).json()
    quote = create(client, customer, product, opportunity_id=opportunity["id"])
    assert quote.status_code == 201, quote.text
    quote = quote.json()
    path = f"/api/v1/quotes/{quote['id']}/journey"
    before = client.get(path)
    assert before.status_code == 200, before.text
    assert before.json()["opportunity_id"] == opportunity["id"]
    assert before.json()["sale_total_amount"] is None
    assert before.json()["external_collection_verified"] is False
    assert (
        client.patch(
            f"/api/v1/crm/opportunities/{opportunity['id']}",
            headers={"Idempotency-Key": str(uuid4())},
            json={"expected_version": 1, "stage": "won"},
        ).status_code
        == 200
    )
    assert client.get(path).json()["recorded_payments_amount"] is None
    quote = action(client, quote, "mark-sent", confirmed_shared=True).json()
    quote = action(client, quote, "accept", confirmed_customer_acceptance=True).json()
    order = client.get(f"/api/v1/customer-orders/{quote['customer_order_id']}").json()
    _seed(client, product["id"], 5)
    confirmed = _confirm(client, order).json()
    paid = client.post(
        f"/api/v1/customer-orders/{confirmed['id']}/checkout",
        headers={"Idempotency-Key": str(uuid4())},
        json={
            "version": confirmed["version"],
            "payments": [{"method": "bank_transfer", "amount": "50.60"}],
        },
    )
    assert paid.status_code == 201, paid.text
    assert paid.json()["sale_order"]["customer_id"] == customer["id"]
    after = client.get(path).json()
    assert after["customer_order_id"] == order["id"]
    assert after["sale_order_id"] == paid.json()["sale_order"]["id"]
    assert after["sale_status"] == "completed"
    assert after["sale_total_amount"] == after["recorded_payments_amount"] == "50.60"
    assert after["external_collection_verified"] is False
    _signup_login(client, prefix="journey-other")
    assert client.get(path).status_code == 404


def test_quote_rejects_opportunity_from_another_customer_and_unknown_identity(client, db):
    _, customer, product = setup(client, db)
    opportunity = create_opportunity(client, customer).json()
    other = client.post(
        "/api/v1/customers",
        headers={"Idempotency-Key": str(uuid4())},
        json={"name": "Otra persona"},
    ).json()
    assert create(client, other, product, opportunity_id=opportunity["id"]).status_code == 404
    assert create(client, customer, product, opportunity_id=str(uuid4())).status_code == 404


def test_unlinked_quote_has_no_guessed_attribution(client, db):
    _, customer, product = setup(client, db)
    create_opportunity(client, customer)
    quote = create(client, customer, product).json()
    trace = client.get(f"/api/v1/quotes/{quote['id']}/journey").json()
    assert quote["opportunity_id"] is None
    assert trace["opportunity_id"] is None
    assert trace["sale_order_id"] is None
