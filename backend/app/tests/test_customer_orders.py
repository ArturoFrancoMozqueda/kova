from uuid import UUID, uuid4

import pytest
from sqlalchemy.orm import Session

from app.customer_orders.models import CustomerOrder, InventoryReservation
from app.orders.models import InventoryMovement, Order, OrderItem
from app.tenants.models import Tenant

# Password cost is incidental to these business scenarios; real auth routes stay active.
pytestmark = pytest.mark.usefixtures("fast_business_auth")


def _signup_login(client, *, prefix: str) -> UUID:
    email = f"{prefix}-{uuid4().hex}@example.com"
    signup = client.post(
        "/api/v1/auth/signup",
        json={
            "email": email,
            "password": "S3cur3pass!",
            "tenant_name": f"Pedidos {prefix}",
            "accepted_terms": True,
        },
    )
    assert signup.status_code == 201, signup.text
    body = signup.json()
    verify = client.post(
        "/api/v1/auth/verify", json={"token": body["dev_verification_token"]}
    )
    assert verify.status_code == 200, verify.text
    login = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "S3cur3pass!"},
    )
    assert login.status_code == 200, login.text
    return UUID(body["tenant_id"])


def _enable_customer_orders(db: Session, tenant_id: UUID) -> None:
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).one()
    tenant.feature_overrides = {**tenant.feature_overrides, "customer_orders": True}
    db.commit()


def _product(client, *, name: str = "Producto pedido", price: str = "25.00") -> dict:
    response = client.post(
        "/api/v1/catalog/products",
        headers={"Idempotency-Key": f"product-{uuid4().hex}"},
        json={"name": name, "price_amount": price, "track_inventory": True},
    )
    assert response.status_code == 201, response.text
    return response.json()


def _seed(client, product_id: str, quantity: int) -> None:
    response = client.post(
        f"/api/v1/inventory/products/{product_id}/adjustments",
        headers={"Idempotency-Key": f"seed-{uuid4().hex}"},
        json={"quantity_delta": quantity, "reason": "Inventario de prueba"},
    )
    assert response.status_code == 201, response.text


def _create(client, product_id: str, *, quantity: int = 2, key: str | None = None):
    return client.post(
        "/api/v1/customer-orders",
        headers={"Idempotency-Key": key or f"create-{uuid4().hex}"},
        json={
            "fulfillment_type": "pickup",
            "source_channel": "counter",
            "customer_name": "Cliente Prueba",
            "items": [
                {
                    "product_id": product_id,
                    "quantity": quantity,
                    "modifier_option_ids": [],
                    "note": "Empacar por separado",
                }
            ],
        },
    )


def _confirm(client, order: dict, *, key: str | None = None):
    return client.post(
        f"/api/v1/customer-orders/{order['id']}/confirm",
        headers={"Idempotency-Key": key or f"confirm-{uuid4().hex}"},
        json={"version": order["version"]},
    )


def test_feature_flag_blocks_customer_order_api(client, db: Session) -> None:
    tenant_id = _signup_login(client, prefix="flag-off")
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).one()
    tenant.feature_overrides = {**tenant.feature_overrides, "customer_orders": False}
    db.commit()
    response = client.get("/api/v1/customer-orders")
    assert response.status_code == 403


def test_delivery_requires_name_and_address(client, db: Session) -> None:
    tenant_id = _signup_login(client, prefix="delivery")
    _enable_customer_orders(db, tenant_id)
    product = _product(client)
    response = client.post(
        "/api/v1/customer-orders",
        headers={"Idempotency-Key": "delivery-required"},
        json={
            "fulfillment_type": "delivery",
            "source_channel": "phone_whatsapp",
            "items": [{"product_id": product["id"], "quantity": 1}],
        },
    )
    assert response.status_code == 422


def test_confirmation_reserves_stock_and_blocks_immediate_sale(client, db: Session) -> None:
    tenant_id = _signup_login(client, prefix="reservation")
    _enable_customer_orders(db, tenant_id)
    product = _product(client)
    _seed(client, product["id"], 3)
    created = _create(client, product["id"], quantity=2)
    assert created.status_code == 201, created.text
    confirmed = _confirm(client, created.json())
    assert confirmed.status_code == 200, confirmed.text

    stock = client.get("/api/v1/inventory/stock")
    row = next(item for item in stock.json() if item["product_id"] == product["id"])
    assert row["stock_on_hand"] == 3
    assert row["reserved_quantity"] == 2
    assert row["available_quantity"] == 1

    sale = client.post(
        "/api/v1/orders",
        headers={"Idempotency-Key": "sale-reservation-conflict"},
        json={
            "items": [{"product_id": product["id"], "quantity": 2}],
            "payments": [{"method": "bank_transfer", "amount": "50.00"}],
        },
    )
    assert sale.status_code == 422, sale.text
    assert sale.json()["detail"]["code"] == "OUT_OF_STOCK"


def test_replaying_save_and_confirmation_keeps_one_order_and_reservation(client, db: Session) -> None:
    tenant_id = _signup_login(client, prefix="confirmation-replay")
    _enable_customer_orders(db, tenant_id)
    product = _product(client)
    _seed(client, product["id"], 3)
    create_key, confirm_key = f"create-{uuid4()}", f"confirm-{uuid4()}"
    created = _create(client, product["id"], quantity=2, key=create_key)
    assert created.status_code == 201, created.text
    confirmed = _confirm(client, created.json(), key=confirm_key)
    assert confirmed.status_code == 200, confirmed.text

    # Simulate a lost confirmation response: the form retries its save/confirm
    # sequence using the original payload, keys and pre-confirmation version.
    replayed_create = _create(client, product["id"], quantity=2, key=create_key)
    assert replayed_create.status_code == 201, replayed_create.text
    assert replayed_create.json() == created.json()
    replayed_confirm = _confirm(client, replayed_create.json(), key=confirm_key)
    assert replayed_confirm.status_code == 200, replayed_confirm.text
    assert replayed_confirm.json() == confirmed.json()
    assert db.query(CustomerOrder).filter_by(tenant_id=tenant_id).count() == 1
    reservations = db.query(InventoryReservation).filter_by(tenant_id=tenant_id, status="active").all()
    assert len(reservations) == 1
    assert reservations[0].quantity == 2
    stock = client.get("/api/v1/inventory/stock").json()
    row = next(item for item in stock if item["product_id"] == product["id"])
    assert row["reserved_quantity"] == 2
    assert row["available_quantity"] == 1


def test_version_conflict_and_cancel_release_reservation(client, db: Session) -> None:
    tenant_id = _signup_login(client, prefix="cancel")
    _enable_customer_orders(db, tenant_id)
    product = _product(client)
    _seed(client, product["id"], 5)
    created = _create(client, product["id"]).json()
    confirmed = _confirm(client, created).json()

    stale = client.post(
        f"/api/v1/customer-orders/{confirmed['id']}/status",
        headers={"Idempotency-Key": "stale-status"},
        json={"version": created["version"], "status": "in_progress"},
    )
    assert stale.status_code == 409
    assert stale.json()["detail"]["code"] == "VERSION_CONFLICT"

    cancelled = client.post(
        f"/api/v1/customer-orders/{confirmed['id']}/cancel",
        headers={"Idempotency-Key": "cancel-release"},
        json={"version": confirmed["version"], "reason": "customer_request"},
    )
    assert cancelled.status_code == 200, cancelled.text
    reservation = (
        db.query(InventoryReservation)
        .filter(InventoryReservation.customer_order_id == UUID(confirmed["id"]))
        .one()
    )
    assert reservation.status == "released"


def test_checkout_is_idempotent_and_uses_frozen_price_and_current_cost(
    client, db: Session
) -> None:
    tenant_id = _signup_login(client, prefix="checkout")
    _enable_customer_orders(db, tenant_id)
    product = _product(client, name="Nombre prometido", price="25.00")
    _seed(client, product["id"], 5)
    created = _create(client, product["id"], quantity=2).json()
    confirmed = _confirm(client, created).json()

    update = client.patch(
        f"/api/v1/catalog/products/{product['id']}",
        headers={"Idempotency-Key": "catalog-after-confirm"},
        json={"name": "Nombre nuevo", "price_amount": "99.00", "cost_price": "11.50"},
    )
    assert update.status_code == 200, update.text

    payload = {
        "version": confirmed["version"],
        "payments": [{"method": "bank_transfer", "amount": "50.00"}],
    }
    first = client.post(
        f"/api/v1/customer-orders/{confirmed['id']}/checkout",
        headers={"Idempotency-Key": "checkout-once"},
        json=payload,
    )
    second = client.post(
        f"/api/v1/customer-orders/{confirmed['id']}/checkout",
        headers={"Idempotency-Key": "checkout-once"},
        json=payload,
    )
    assert first.status_code == 201, first.text
    assert second.status_code == 201, second.text
    assert second.json() == first.json()
    body = first.json()
    assert body["sale_order"]["total_amount"] == "50.00"
    assert db.query(Order).filter(Order.id == UUID(body["sale_order"]["id"])).count() == 1
    item = (
        db.query(OrderItem)
        .filter(OrderItem.order_id == UUID(body["sale_order"]["id"]))
        .one()
    )
    assert item.product_name == "Nombre prometido"
    assert str(item.unit_price_amount) == "25.00"
    assert str(item.unit_cost) == "11.50"
    reservation = (
        db.query(InventoryReservation)
        .filter(InventoryReservation.customer_order_id == UUID(confirmed["id"]))
        .one()
    )
    assert reservation.status == "consumed"
    movement = (
        db.query(InventoryMovement)
        .filter(InventoryMovement.order_id == UUID(body["sale_order"]["id"]))
        .one()
    )
    assert movement.quantity_delta == -2


def test_paid_order_requires_financial_reversal_before_cancel(client, db: Session) -> None:
    tenant_id = _signup_login(client, prefix="paid-cancel")
    _enable_customer_orders(db, tenant_id)
    product = _product(client, price="10.00")
    _seed(client, product["id"], 1)
    confirmed = _confirm(client, _create(client, product["id"], quantity=1).json()).json()
    checkout = client.post(
        f"/api/v1/customer-orders/{confirmed['id']}/checkout",
        headers={"Idempotency-Key": "paid-cancel-checkout"},
        json={
            "version": confirmed["version"],
            "payments": [{"method": "manual_card", "amount": "10.00"}],
        },
    )
    assert checkout.status_code == 201, checkout.text
    paid = checkout.json()["customer_order"]
    cancelled = client.post(
        f"/api/v1/customer-orders/{paid['id']}/cancel",
        headers={"Idempotency-Key": "paid-cancel-attempt"},
        json={"version": paid["version"], "reason": "customer_request"},
    )
    assert cancelled.status_code == 409
    assert cancelled.json()["detail"]["code"] == "PAID_ORDER_REQUIRES_REVERSAL"


def test_cash_checkout_requires_open_shift(client, db: Session) -> None:
    tenant_id = _signup_login(client, prefix="cash-shift")
    _enable_customer_orders(db, tenant_id)
    product = _product(client, price="12.00")
    _seed(client, product["id"], 1)
    confirmed = _confirm(client, _create(client, product["id"], quantity=1).json()).json()

    response = client.post(
        f"/api/v1/customer-orders/{confirmed['id']}/checkout",
        headers={"Idempotency-Key": "cash-without-shift"},
        json={
            "version": confirmed["version"],
            "payments": [
                {"method": "cash", "amount": "12.00", "amount_tendered": "20.00"}
            ],
        },
    )
    assert response.status_code == 400
    assert "shift" in response.json()["detail"].lower()


def test_list_supports_search_filters_counts_and_pagination(client, db: Session) -> None:
    tenant_id = _signup_login(client, prefix="list")
    _enable_customer_orders(db, tenant_id)
    product = _product(client, price="8.00")
    _seed(client, product["id"], 2)
    first = _create(client, product["id"], quantity=1).json()
    second = _create(client, product["id"], quantity=1).json()
    _confirm(client, second)

    response = client.get(
        "/api/v1/customer-orders",
        params={"search": first["folio"], "status": "new", "limit": 1, "offset": 0},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["id"] == first["id"]
    assert body["status_counts"]["new"] == 1
    assert body["status_counts"]["confirmed"] == 1



def test_zero_total_order_is_paid_and_can_be_fulfilled(client, db: Session) -> None:
    tenant_id = _signup_login(client, prefix="zero-total")
    _enable_customer_orders(db, tenant_id)
    product = _product(client, price="0.00")
    _seed(client, product["id"], 1)
    created = _create(client, product["id"], quantity=1)
    assert created.status_code == 201, created.text
    confirmed = _confirm(client, created.json())
    assert confirmed.status_code == 200, confirmed.text
    checkout = client.post(
        f"/api/v1/customer-orders/{confirmed.json()['id']}/checkout",
        headers={"Idempotency-Key": "zero-total-checkout"},
        json={"version": confirmed.json()["version"],
              "payments": [{"method": "bank_transfer", "amount": "0.00"}]},
    )
    assert checkout.status_code == 201, checkout.text
    order = checkout.json()["customer_order"]
    assert order["payment_status"] == "paid"
    detail = client.get(f"/api/v1/customer-orders/{order['id']}")
    assert detail.json()["payment_status"] == "paid"
    paid_list = client.get("/api/v1/customer-orders", params={"payment_status": "paid"})
    assert [item["id"] for item in paid_list.json()["items"]] == [order["id"]]
    refunded_list = client.get("/api/v1/customer-orders", params={"payment_status": "refunded"})
    assert refunded_list.json()["items"] == []
    for status in ["in_progress", "ready", "fulfilled"]:
        response = client.post(
            f"/api/v1/customer-orders/{order['id']}/status",
            headers={"Idempotency-Key": f"zero-total-{status}"},
            json={"version": order["version"], "status": status},
        )
        assert response.status_code == 200, response.text
        order = response.json()
    assert order["status"] == "fulfilled"
    assert order["payment_status"] == "paid"
