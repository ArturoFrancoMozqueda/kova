from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.idempotency.models import IdempotencyKey
from app.orders.models import Order, Refund
from app.shifts.models import CashMovement


def _expire_marker(db: Session, *, tenant_id: UUID, key: str) -> None:
    record = db.scalar(
        select(IdempotencyKey).where(
            IdempotencyKey.tenant_id == tenant_id,
            IdempotencyKey.key == key,
        )
    )
    assert record is not None
    record.expires_at = datetime.now(UTC) - timedelta(days=1)
    db.flush()


def _signup_login(client) -> UUID:
    suffix = uuid4().hex
    email = f"idempotency-retention-{suffix}@example.com"
    signup = client.post(
        "/api/v1/auth/signup",
        json={
            "email": email,
            "password": "S3cur3pass!",
            "tenant_name": f"Retention {suffix}",
            "accepted_terms": True,
        },
    )
    assert signup.status_code == 201, signup.text
    body = signup.json()
    assert (
        client.post(
            "/api/v1/auth/verify", json={"token": body["dev_verification_token"]}
        ).status_code
        == 200
    )
    assert (
        client.post(
            "/api/v1/auth/login",
            json={"email": email, "password": "S3cur3pass!"},
        ).status_code
        == 200
    )
    return UUID(body["tenant_id"])


def test_expired_markers_never_duplicate_order_refund_or_cash_effects(client, db: Session):
    tenant_id = _signup_login(client)

    shift = client.post(
        "/api/v1/shifts",
        headers={"Idempotency-Key": f"retention-shift-{uuid4().hex}"},
        json={"opening_cash_amount": "100.00"},
    )
    assert shift.status_code == 201, shift.text

    product = client.post(
        "/api/v1/catalog/products",
        headers={"Idempotency-Key": f"retention-product-{uuid4().hex}"},
        json={"name": "Concha retenida", "price_amount": "10.00"},
    )
    assert product.status_code == 201, product.text

    order_key = f"retention-order-{uuid4().hex}"
    order_payload = {
        "items": [{"product_id": product.json()["id"], "quantity": 1}],
        "payments": [{"method": "cash", "amount": "10.00", "amount_tendered": "10.00"}],
    }
    order = client.post(
        "/api/v1/orders",
        headers={"Idempotency-Key": order_key},
        json=order_payload,
    )
    assert order.status_code == 201, order.text
    _expire_marker(db, tenant_id=tenant_id, key=order_key)
    order_replay = client.post(
        "/api/v1/orders",
        headers={"Idempotency-Key": order_key},
        json=order_payload,
    )
    assert order_replay.status_code == 201, order_replay.text
    assert order_replay.json() == order.json()

    changed_order = client.post(
        "/api/v1/orders",
        headers={"Idempotency-Key": order_key},
        json={
            "items": [{"product_id": product.json()["id"], "quantity": 2}],
            "payments": [{"method": "cash", "amount": "20.00", "amount_tendered": "20.00"}],
        },
    )
    assert changed_order.status_code == 400
    assert "different request body" in changed_order.text

    cash_key = f"retention-cash-{uuid4().hex}"
    cash_url = f"/api/v1/shifts/{shift.json()['id']}/cash-movements"
    cash_payload = {"type": "cash_out", "amount": "5.00", "reason": "Insumos"}
    cash = client.post(
        cash_url,
        headers={"Idempotency-Key": cash_key},
        json=cash_payload,
    )
    assert cash.status_code == 201, cash.text
    _expire_marker(db, tenant_id=tenant_id, key=cash_key)
    cash_replay = client.post(
        cash_url,
        headers={"Idempotency-Key": cash_key},
        json=cash_payload,
    )
    assert cash_replay.status_code == 201, cash_replay.text
    assert cash_replay.json() == cash.json()

    refund_key = f"retention-refund-{uuid4().hex}"
    refund_payload = {
        "items": [{"order_item_id": order.json()["items"][0]["id"], "quantity": 1}],
        "reason": "customer_return",
        "refund_payment_method": "cash",
    }
    refund_url = f"/api/v1/orders/{order.json()['id']}/refunds"
    refund = client.post(
        refund_url,
        headers={"Idempotency-Key": refund_key},
        json=refund_payload,
    )
    assert refund.status_code == 201, refund.text
    _expire_marker(db, tenant_id=tenant_id, key=refund_key)
    refund_replay = client.post(
        refund_url,
        headers={"Idempotency-Key": refund_key},
        json=refund_payload,
    )
    assert refund_replay.status_code == 201, refund_replay.text
    assert refund_replay.json() == refund.json()

    assert (
        db.scalar(select(func.count()).select_from(Order).where(Order.tenant_id == tenant_id)) == 1
    )
    assert (
        db.scalar(select(func.count()).select_from(Refund).where(Refund.tenant_id == tenant_id))
        == 1
    )
    assert (
        db.scalar(
            select(func.count())
            .select_from(CashMovement)
            .where(
                CashMovement.tenant_id == tenant_id,
                CashMovement.type == "cash_out",
            )
        )
        == 1
    )
