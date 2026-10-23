from uuid import UUID, uuid4

import pytest
from sqlalchemy.exc import IntegrityError

from app.customer_orders.models import CustomerOrder
from app.customer_orders.service import _hash_payload
from app.customers.models import Customer
from app.idempotency.models import IdempotencyKey
from app.orders.models import Order
from app.tenants.models import Tenant
from app.tests.test_customer_orders import _confirm, _product, _seed, _signup_login
from app.tests.test_customers_barcodes import _customer

pytestmark = pytest.mark.usefixtures("fast_business_auth")
BASE = "/api/v1/customer-orders"


def prepare(client):
    tenant = _signup_login(client, prefix="order-identity")
    customer = _customer(client)
    product = _product(client)
    _seed(client, product["id"], 10)
    return tenant, customer, {
        "items": [{"product_id": product["id"], "quantity": 2}],
        "customer_name": customer["name"],
    }


def post(client, path, body, key=None):
    return client.post(
        BASE + path, json=body, headers={"Idempotency-Key": key or str(uuid4())},
    )


def test_direct_order_customer_flows_to_sale_history_and_branch_activity(client, db):
    tenant, customer, body = prepare(client)
    body["customer_id"] = customer["id"]
    created = post(client, "", body, "direct-order")
    assert created.status_code == 201, created.text
    order = created.json()
    assert order["customer_id"] == customer["id"]
    assert post(client, "", body, "direct-order").json() == order
    activity = client.get(f"/api/v1/customers/{customer['id']}/activity").json()
    section = next(s for s in activity["sections"] if s["source"] == "customer_orders")
    assert section["items"][0]["id"] == order["id"]
    assert section["items"][0]["title"] == order["folio"]
    confirmed = _confirm(client, order)
    assert confirmed.status_code == 200, confirmed.text
    version = confirmed.json()["version"]
    checkout = post(client, f"/{order['id']}/checkout", {
        "version": version, "payments": [{"method": "manual_card", "amount": "50.00"}],
    }, "pay-direct")
    assert checkout.status_code == 201, checkout.text
    sale = checkout.json()["sale_order"]
    assert sale["customer_id"] == customer["id"]
    assert db.query(Order).filter_by(tenant_id=tenant).count() == 1
    history = client.get(f"/api/v1/customers/{customer['id']}/history").json()
    assert history["purchases"][0]["id"] == sale["id"]


def test_optional_identity_is_not_inferred_from_matching_contact_or_name(client, db):
    _tenant, customer, body = prepare(client)
    body["customer_phone"] = customer["phone"]
    result = post(client, "", body)
    assert result.status_code == 201, result.text
    assert result.json()["customer_id"] is None
    row = db.get(CustomerOrder, UUID(result.json()["id"]))
    assert row.customer_id is None
    assert _hash_payload({**body, "customer_id": None}) == _hash_payload(body)


def test_identity_is_immutable_and_legacy_edits_preserve_it_even_after_deactivation(client, db):
    # The suite can contain sales from other businesses. Exercise that state
    # explicitly, and prove the rejected checkout neither adds nor removes one.
    _foreign_tenant, _foreign_customer, foreign_body = prepare(client)
    foreign_sale = client.post(
        "/api/v1/orders",
        json={
            "items": foreign_body["items"],
            "payments": [{"method": "manual_card", "amount": "50.00"}],
        },
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert foreign_sale.status_code == 201, foreign_sale.text
    tenant, customer, body = prepare(client)
    order = post(client, "", {**body, "customer_id": customer["id"]}).json()
    path = BASE + "/" + order["id"]
    row = db.get(Customer, UUID(customer["id"]))
    row.is_active = False
    db.commit()
    # Older clients omit customer_id; edits preserve the explicit association.
    changed = client.patch(path, json={**body, "version": 1}, headers={"Idempotency-Key": str(uuid4())})
    assert changed.status_code == 200, changed.text
    assert changed.json()["customer_id"] == customer["id"]
    cleared = client.patch(path, json={**body, "customer_id": None, "version": 2}, headers={"Idempotency-Key": str(uuid4())})
    assert cleared.status_code == 409, cleared.text
    assert cleared.json()["detail"]["code"] == "CUSTOMER_IMMUTABLE"
    confirmed = _confirm(client, changed.json()).json()
    sales_before = {row.id for row in db.query(Order.id).all()}
    checkout = post(client, f"/{order['id']}/checkout", {
        "version": confirmed["version"], "payments": [{"method": "manual_card", "amount": "50.00"}],
    })
    assert checkout.status_code == 409, checkout.text
    assert checkout.json()["detail"]["code"] == "CUSTOMER_INACTIVE"
    assert db.query(Order).filter_by(tenant_id=tenant).count() == 0
    assert {row.id for row in db.query(Order.id).all()} == sales_before
    assert UUID(foreign_sale.json()["id"]) in sales_before


def test_inactive_unknown_and_foreign_identity_fail_without_creating_orders(client, db):
    _tenant, customer, body = prepare(client)
    row = db.get(Customer, UUID(customer["id"]))
    row.is_active = False
    db.commit()
    assert post(client, "", {**body, "customer_id": customer["id"]}).status_code == 409
    assert post(client, "", {**body, "customer_id": str(uuid4())}).status_code == 404
    other = _signup_login(client, prefix="foreign-order-identity")
    assert post(client, "", {**body, "customer_id": customer["id"]}).status_code == 404
    assert db.query(CustomerOrder).count() == 0
    with pytest.raises(IntegrityError), db.begin_nested():
        db.add(CustomerOrder(
            tenant_id=other, branch_id=other, folio="PED-FOREIGN", customer_id=UUID(customer["id"]),
            subtotal_amount=0, total_amount=0,
        ))
        db.flush()


def test_customer_orders_activity_respects_existing_feature_gate(client, db):
    tenant, customer, body = prepare(client)
    assert post(client, "", {**body, "customer_id": customer["id"]}).status_code == 201
    row = db.get(Tenant, tenant)
    row.feature_overrides = {**row.feature_overrides, "customer_orders": False}
    db.commit()
    result = client.get(f"/api/v1/customers/{customer['id']}/activity")
    assert result.status_code == 200, result.text
    assert len(result.json()["sections"]) == 4
    assert all(s["source"] != "customer_orders" for s in result.json()["sections"])


def test_legacy_stored_response_replays_and_update_null_is_distinct_from_omitted(client, db):
    tenant, customer, body = prepare(client)
    old = post(client, "", body, "legacy-anonymous")
    assert old.status_code == 201, old.text
    stored = db.query(IdempotencyKey).filter_by(tenant_id=tenant, key="legacy-anonymous").one()
    # A response stored by the previous release has no customer_id field.
    stored.response_body = {key: value for key, value in stored.response_body.items() if key != "customer_id"}
    db.commit()
    replay = post(client, "", body, "legacy-anonymous")
    assert replay.status_code == 201, replay.text
    assert replay.json()["id"] == old.json()["id"]
    assert replay.json()["customer_id"] is None
    assert db.query(CustomerOrder).count() == 1
    identified = post(client, "", {**body, "customer_id": customer["id"]}).json()
    path = BASE + "/" + identified["id"]
    update = {**body, "version": identified["version"]}
    headers = {"Idempotency-Key": "legacy-update"}
    first = client.patch(path, json=update, headers=headers)
    assert first.status_code == 200, first.text
    assert client.patch(path, json=update, headers=headers).json() == first.json()
    explicit_null = client.patch(path, json={**update, "customer_id": None}, headers=headers)
    assert explicit_null.status_code == 400, explicit_null.text
    assert db.get(CustomerOrder, UUID(identified["id"])).customer_id == UUID(customer["id"])
