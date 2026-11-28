"""Coupons: a code with dates and limits whose discount the server computes at checkout."""

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from sqlalchemy.orm import Session

from app.coupons.models import CouponRedemption
from app.customers.models import Customer
from app.tests.test_customer_order_deposits import _as_role, _owner

pytestmark = pytest.mark.usefixtures("fast_business_auth")


def _product(client, name: str = "Latte", price: str = "55.00") -> dict:
    response = client.post("/api/v1/catalog/products", headers={"Idempotency-Key": str(uuid4())},
                           json={"name": name, "price_amount": price})
    assert response.status_code == 201, response.text
    return response.json()


def _coupon(client, **body) -> dict:
    response = client.post("/api/v1/coupons", json={"code": "verano10", "kind": "percent",
                                                     "value": "10", **body})
    assert response.status_code == 201, response.text
    return response.json()


def _order(product: dict, quantity: int = 2, customer_id: str | None = None, **extra) -> dict:
    order = {"items": [{"product_id": product["id"], "quantity": quantity}],
             "payments": extra.pop("payments", None), **extra}
    if customer_id:
        order["customer_id"] = customer_id
    return order


def _checkout(client, product, discount: str, *, code: str = "VERANO10", quantity: int = 2,
              customer_id: str | None = None, key: str | None = None, **extra):
    total = f"{float(product['price_amount']) * quantity - float(discount):.2f}"
    order = _order(product, quantity, customer_id,
                   payments=[{"method": "bank_transfer", "amount": total}], **extra)
    return client.post("/api/v1/coupons/checkout",
                       json={"code": code, "order": order, "expected_discount": discount},
                       headers={"Idempotency-Key": key or str(uuid4())})


def test_cashier_applies_a_coupon_the_server_prices(client, db: Session) -> None:
    tenant_id, email = _owner(client, db, "cupon")
    latte = _product(client)
    coupon = _coupon(client, description="Promo de verano")
    assert coupon["code"] == "VERANO10"
    _as_role(client, db, tenant_id, email, "cashier")
    assert client.post("/api/v1/coupons", json={"code": "OTRO", "kind": "amount",
                                                "value": "5"}).status_code == 403

    preview = client.post("/api/v1/coupons/preview", json={
        "code": " verano10 ", "order": _order(latte, payments=[])})
    assert preview.status_code == 200, preview.text
    assert (preview.json()["subtotal_amount"], preview.json()["discount_amount"]) == (
        "110.00", "11.00")

    sale = _checkout(client, latte, "11.00", key="cupon-1")
    assert sale.status_code == 201, sale.text
    body = sale.json()
    assert (body["discount_amount"], body["total_amount"]) == ("11.00", "99.00")
    assert body["coupon"] == {"code": "VERANO10", "discount_amount": "11.00", "status": "applied"}
    assert _checkout(client, latte, "11.00", key="cupon-1").json() == body
    assert db.query(CouponRedemption).count() == 1
    receipt = client.get(f"/api/v1/orders/{body['id']}/receipt").json()
    assert receipt["coupon"]["code"] == "VERANO10"
    listed = client.get("/api/v1/coupons").json()
    assert listed[0]["uses"] == 1


def test_coupon_rules_explain_why_it_does_not_apply(client, db: Session) -> None:
    _owner(client, db, "reglas")
    latte = _product(client)
    now = datetime.now(UTC)
    _coupon(client, code="MINIMO", min_purchase="200.00")
    _coupon(client, code="FUTURO", starts_at=(now + timedelta(days=1)).isoformat())
    _coupon(client, code="VENCIDO", starts_at=(now - timedelta(days=3)).isoformat(),
            ends_at=(now - timedelta(days=1)).isoformat())
    paused = _coupon(client, code="PAUSA")
    assert client.patch(f"/api/v1/coupons/{paused['id']}",
                        json={"version": paused["version"], "is_active": False}).status_code == 200

    def reason(code):
        response = client.post("/api/v1/coupons/preview",
                               json={"code": code, "order": _order(latte, payments=[])})
        return response.status_code, response.json()["detail"]

    assert reason("MINIMO") == (409, "Este cupón aplica en compras desde $200.00.")
    assert reason("FUTURO") == (409, "Este cupón aún no está vigente.")
    assert reason("VENCIDO") == (409, "Este cupón ya venció.")
    assert reason("PAUSA") == (409, "Este cupón está pausado.")
    assert reason("NOEXISTE") == (404, "No encontramos ese cupón. Revisa el código.")

    _coupon(client)
    stale = _checkout(client, latte, "5.00")
    assert stale.status_code == 409
    assert stale.json()["detail"] == "El descuento del cupón cambió. Revisa antes de cobrar."
    combined = _checkout(client, latte, "11.00", discount_amount="5.00")
    assert combined.status_code == 400
    assert db.query(CouponRedemption).count() == 0


def test_use_limits_hold_and_a_voided_sale_gives_the_use_back(client, db: Session) -> None:
    tenant_id, _ = _owner(client, db, "limites")
    latte = _product(client)
    _coupon(client, code="UNAVEZ", kind="amount", value="500.00", max_uses=1)
    first = _checkout(client, latte, "110.00", code="UNAVEZ")  # capped at the subtotal
    assert first.status_code == 201, first.text
    assert first.json()["total_amount"] == "0.00"
    used_up = _checkout(client, latte, "110.00", code="UNAVEZ")
    assert used_up.json()["detail"] == "Este cupón ya alcanzó su límite de usos."

    voided = client.post(f"/api/v1/orders/{first.json()['id']}/void",
                         json={"reason": "operator_error"}, headers={"Idempotency-Key": str(uuid4())})
    assert voided.status_code == 201, voided.text
    assert client.get(f"/api/v1/orders/{first.json()['id']}").json()["coupon"]["status"] == (
        "released")
    assert _checkout(client, latte, "110.00", code="UNAVEZ").status_code == 201

    customer = Customer(tenant_id=tenant_id, name="Ana")
    db.add(customer)
    db.commit()
    _coupon(client, code="CLIENTE", max_uses_per_customer=1)
    anonymous = _checkout(client, latte, "11.00", code="CLIENTE")
    assert anonymous.json()["detail"] == "Selecciona al cliente para usar este cupón."
    assert _checkout(client, latte, "11.00", code="CLIENTE",
                     customer_id=str(customer.id)).status_code == 201
    again = _checkout(client, latte, "11.00", code="CLIENTE", customer_id=str(customer.id))
    assert again.json()["detail"] == "Este cliente ya usó este cupón las veces permitidas."


def test_coupons_are_a_gestion_feature_and_stay_inside_the_business(client, db: Session) -> None:
    from app.billing.models import Subscription
    from app.tenants.models import Tenant

    tenant_id, _ = _owner(client, db, "plan")
    latte = _product(client)
    _coupon(client)
    order_id = UUID(_checkout(client, latte, "11.00").json()["id"])
    assert order_id

    db.get(Tenant, tenant_id).billing_cohort = "tiered"
    subscription = Subscription(tenant_id=tenant_id, stripe_subscription_id=f"sub_{uuid4().hex}",
                                current_period_end=datetime.now(UTC) + timedelta(days=30))
    subscription.status = "active"
    subscription.plan_code = "esencial"
    subscription.plan_effective_until = None
    db.add(subscription)
    db.commit()
    blocked = client.post("/api/v1/coupons", json={"code": "NUEVO", "kind": "amount", "value": "5"})
    assert blocked.status_code == 403
    assert blocked.json()["detail"]["reason"] == "plan_feature_required"

    client.post("/api/v1/auth/logout")
    client.cookies.clear()
    _owner(client, db, "otro-negocio")
    other = client.post("/api/v1/coupons/preview",
                        json={"code": "VERANO10", "order": _order(_product(client), payments=[])})
    assert other.status_code == 404
    assert client.get("/api/v1/coupons").json() == []
