from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.auth.models import Membership, User
from app.fiscal import repository as fiscal_repo
from app.fiscal.models import (
    FiscalGlobalDraftBatch,
    OrderFiscalSnapshot,
    OrderItemFiscalSnapshot,
)
from app.fiscal.service import FISCAL_TIMEZONE, resolve_period
from app.idempotency.models import IdempotencyKey
from app.orders import service as order_service
from app.orders.models import InventoryMovement, Order, Payment
from app.orders.schemas import OrderCreate
from app.tenants.models import Tenant


def _signup_login(client, *, prefix: str) -> UUID:
    email = f"fiscal-{prefix}-{uuid4().hex}@example.com"
    signup = client.post(
        "/api/v1/auth/signup",
        json={
            "email": email,
            "password": "S3cur3pass!",
            "tenant_name": f"Fiscal {prefix}",
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
    login = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "S3cur3pass!"},
    )
    assert login.status_code == 200, login.text
    return UUID(body["tenant_id"])


def _enable(db: Session, tenant_id: UUID) -> None:
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).one()
    tenant.feature_overrides = {
        **tenant.feature_overrides,
        "fiscal_global_drafts": True,
        "customer_orders": True,
    }
    db.commit()


def _product(client, *, price: str = "100.00") -> dict:
    response = client.post(
        "/api/v1/catalog/products",
        headers={"Idempotency-Key": f"fiscal-product-{uuid4().hex}"},
        json={"name": "Producto fiscal", "price_amount": price},
    )
    assert response.status_code == 201, response.text
    return response.json()


def _sale(client, product_id: str, *, quantity: int = 1, key: str | None = None) -> dict:
    amount = Decimal("100.00") * quantity
    response = client.post(
        "/api/v1/orders",
        headers={"Idempotency-Key": key or f"fiscal-sale-{uuid4().hex}"},
        json={
            "items": [{"product_id": product_id, "quantity": quantity}],
            "payments": [{"method": "bank_transfer", "amount": str(amount)}],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def _set_sale_day(db: Session, order_id: str, day: date) -> None:
    order = db.get(Order, UUID(order_id))
    assert order is not None
    order.occurred_at = datetime.combine(day, datetime.min.time(), tzinfo=UTC) + timedelta(hours=12)
    db.commit()


def _daily_settings(client) -> None:
    response = client.put(
        "/api/v1/fiscal/global-drafts/settings",
        json={
            "frequency": "daily",
            "weekly_close_day": 7,
            "monthly_close_day": 31,
            "auto_close_enabled": False,
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["scheduler_status"] == "active"


def test_period_contract_uses_iso_weekdays_and_month_end_normalization() -> None:
    assert resolve_period(
        frequency="monthly",
        period_end=date(2026, 2, 28),
        weekly_close_day=7,
        monthly_close_day=31,
    ) == (date(2026, 2, 1), date(2026, 2, 28))
    assert resolve_period(
        frequency="weekly",
        period_end=date(2026, 8, 16),  # Sunday, ISO 7
        weekly_close_day=7,
        monthly_close_day=31,
    ) == (date(2026, 8, 10), date(2026, 8, 16))
    with pytest.raises(HTTPException):
        resolve_period(
            frequency="weekly",
            period_end=date(2026, 8, 15),
            weekly_close_day=7,
            monthly_close_day=31,
        )


def test_feature_flag_defaults_closed(client, db: Session) -> None:
    _signup_login(client, prefix="gate")
    response = client.get("/api/v1/fiscal/global-drafts/settings")
    assert response.status_code == 403
    assert "borradores internos por periodo" in response.json()["detail"]


def test_online_sale_writes_reconciling_immutable_baseline_snapshot(client, db: Session) -> None:
    tenant_id = _signup_login(client, prefix="snapshot")
    product = _product(client)
    sale = _sale(client, product["id"], quantity=2)

    header = (
        db.query(OrderFiscalSnapshot)
        .filter(
            OrderFiscalSnapshot.tenant_id == tenant_id,
            OrderFiscalSnapshot.order_id == UUID(sale["id"]),
        )
        .one()
    )
    lines = (
        db.query(OrderItemFiscalSnapshot)
        .filter(
            OrderItemFiscalSnapshot.tenant_id == tenant_id,
            OrderItemFiscalSnapshot.order_id == UUID(sale["id"]),
        )
        .all()
    )
    assert header.pricing_engine_version == "baseline-v1"
    assert header.tax_catalog_version is None
    assert header.gross_amount == Decimal("200.00")
    assert header.discount_total_amount == Decimal("0.00")
    assert header.tax_total_amount == Decimal("0.00")
    assert header.total_amount == Decimal("200.00")
    assert sum(line.line_total_amount for line in lines) == header.total_amount

    with pytest.raises(DBAPIError), db.begin_nested():
        db.execute(
            text(
                "UPDATE order_fiscal_snapshots SET total_amount = 1 "
                "WHERE tenant_id = :tenant_id AND order_id = :order_id"
            ),
            {"tenant_id": tenant_id, "order_id": UUID(sale["id"])},
        )


def test_customer_order_checkout_uses_same_snapshot_path(client, db: Session) -> None:
    tenant_id = _signup_login(client, prefix="customer-checkout")
    _enable(db, tenant_id)
    product = _product(client)
    created = client.post(
        "/api/v1/customer-orders",
        headers={"Idempotency-Key": "fiscal-customer-create"},
        json={
            "fulfillment_type": "pickup",
            "source_channel": "counter",
            "items": [{"product_id": product["id"], "quantity": 1}],
        },
    )
    assert created.status_code == 201, created.text
    confirmed = client.post(
        f"/api/v1/customer-orders/{created.json()['id']}/confirm",
        headers={"Idempotency-Key": "fiscal-customer-confirm"},
        json={"version": created.json()["version"]},
    )
    assert confirmed.status_code == 200, confirmed.text
    checkout = client.post(
        f"/api/v1/customer-orders/{created.json()['id']}/checkout",
        headers={"Idempotency-Key": "fiscal-customer-checkout"},
        json={
            "version": confirmed.json()["version"],
            "payments": [{"method": "bank_transfer", "amount": "100.00"}],
        },
    )
    assert checkout.status_code == 201, checkout.text
    sale_id = UUID(checkout.json()["sale_order"]["id"])
    assert (
        db.query(OrderFiscalSnapshot)
        .filter(
            OrderFiscalSnapshot.tenant_id == tenant_id,
            OrderFiscalSnapshot.order_id == sale_id,
        )
        .count()
        == 1
    )


def test_preview_and_close_freeze_refunds_and_are_idempotent(client, db: Session) -> None:
    tenant_id = _signup_login(client, prefix="close")
    _enable(db, tenant_id)
    _daily_settings(client)
    product = _product(client)
    sale = _sale(client, product["id"], quantity=2)
    yesterday = datetime.now(FISCAL_TIMEZONE).date() - timedelta(days=1)
    _set_sale_day(db, sale["id"], yesterday)

    refund = client.post(
        f"/api/v1/orders/{sale['id']}/refunds",
        headers={"Idempotency-Key": "fiscal-refund-before-close"},
        json={
            "items": [{"order_item_id": sale["items"][0]["id"], "quantity": 1}],
            "reason": "customer_return",
            "refund_payment_method": "bank_transfer",
        },
    )
    assert refund.status_code == 201, refund.text

    preview = client.get(
        "/api/v1/fiscal/global-drafts/preview",
        params={"period_end": yesterday.isoformat()},
    )
    assert preview.status_code == 200, preview.text
    assert preview.json()["total_amount"] == "200.00"
    assert preview.json()["refund_total_amount"] == "100.00"
    assert preview.json()["net_total_amount"] == "100.00"
    assert preview.json()["fiscal_status"] == "not_issued"

    payload = {"period_end": yesterday.isoformat()}
    first = client.post(
        "/api/v1/fiscal/global-drafts/close",
        headers={"Idempotency-Key": "fiscal-close-once"},
        json=payload,
    )
    replay = client.post(
        "/api/v1/fiscal/global-drafts/close",
        headers={"Idempotency-Key": "fiscal-close-once"},
        json=payload,
    )
    assert first.status_code == 201, first.text
    assert replay.status_code == 201, replay.text
    assert replay.json() == first.json()
    batch = db.get(FiscalGlobalDraftBatch, UUID(first.json()["id"]))
    assert batch is not None
    assert batch.refund_total_amount == Decimal("100.00")
    assert batch.net_total_amount == Decimal("100.00")

    other_client = TestClient(client.app)
    other_tenant_id = _signup_login(other_client, prefix="other-tenant")
    _enable(db, other_tenant_id)
    hidden = other_client.get(f"/api/v1/fiscal/global-drafts/batches/{batch.id}")
    assert hidden.status_code == 404

    second_refund = client.post(
        f"/api/v1/orders/{sale['id']}/refunds",
        headers={"Idempotency-Key": "fiscal-refund-after-close"},
        json={
            "items": [{"order_item_id": sale["items"][0]["id"], "quantity": 1}],
            "reason": "customer_return",
            "refund_payment_method": "bank_transfer",
        },
    )
    assert second_refund.status_code == 201, second_refund.text
    db.refresh(batch)
    assert batch.refund_total_amount == Decimal("100.00")
    assert batch.net_total_amount == Decimal("100.00")

    different_period = client.post(
        "/api/v1/fiscal/global-drafts/close",
        headers={"Idempotency-Key": "fiscal-close-once"},
        json={"period_end": (yesterday - timedelta(days=1)).isoformat()},
    )
    assert different_period.status_code == 400
    assert "different request body" in different_period.json()["detail"]

    with pytest.raises(DBAPIError), db.begin_nested():
        db.execute(
            text("DELETE FROM fiscal_global_draft_batches WHERE id = :id"),
            {"id": batch.id},
        )


def test_preview_rejects_incomplete_period_and_manual_close_rejects_empty(
    client, db: Session
) -> None:
    tenant_id = _signup_login(client, prefix="empty")
    _enable(db, tenant_id)
    _daily_settings(client)
    today = datetime.now(FISCAL_TIMEZONE).date()
    assert (
        client.get(
            "/api/v1/fiscal/global-drafts/preview",
            params={"period_end": today.isoformat()},
        ).status_code
        == 400
    )
    response = client.post(
        "/api/v1/fiscal/global-drafts/close",
        headers={"Idempotency-Key": "fiscal-empty-close"},
        json={"period_end": (today - timedelta(days=1)).isoformat()},
    )
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "EMPTY_GLOBAL_DRAFT_PERIOD"


def test_internal_auto_close_requires_constant_time_key(client, monkeypatch) -> None:
    from app.config import settings

    monkeypatch.setattr(settings, "internal_api_key", "fiscal-internal-secret")
    url = "/api/v1/fiscal/internal/global-drafts/auto-close"
    assert client.post(url, json={}).status_code == 403
    response = client.post(
        url,
        headers={"X-Internal-Key": "fiscal-internal-secret"},
        json={"tenant_limit": 10, "periods_per_tenant": 3},
    )
    assert response.status_code == 200, response.text
    assert set(response.json()) == {
        "tenants_examined",
        "batches_created",
        "batches_replayed",
        "periods_skipped_empty",
        "failures",
    }


def test_offline_legacy_replay_creates_one_snapshot(client, db: Session) -> None:
    tenant_id = _signup_login(client, prefix="offline")
    product = _product(client, price="100.00")
    client_uuid = str(uuid4())
    payload = {
        "client_uuid": client_uuid,
        "legacy_version": 1,
        "order": {
            "items": [{"product_id": product["id"], "quantity": 1}],
            "payments": [{"method": "bank_transfer", "amount": "100.00"}],
            "legacy_total": "100.00",
        },
    }
    first = client.post("/api/v1/sync/offline-sales", json={"sales": [payload]})
    payload["order"].pop("legacy_total")
    payload.pop("legacy_version")
    replay = client.post("/api/v1/sync/offline-sales", json={"sales": [payload]})
    assert first.status_code == replay.status_code == 200
    first_id = UUID(first.json()["results"][0]["order_id"])
    assert replay.json()["results"][0]["order_id"] == str(first_id)
    assert (
        db.query(OrderFiscalSnapshot)
        .filter(
            OrderFiscalSnapshot.tenant_id == tenant_id,
            OrderFiscalSnapshot.order_id == first_id,
        )
        .count()
        == 1
    )


def test_manager_can_view_but_only_owner_can_manage(client, db: Session) -> None:
    tenant_id = _signup_login(client, prefix="manager")
    _enable(db, tenant_id)
    _daily_settings(client)
    membership = db.query(Membership).filter(Membership.tenant_id == tenant_id).one()
    membership.role = "manager"
    db.commit()
    assert client.get("/api/v1/fiscal/global-drafts/settings").status_code == 200
    denied = client.put(
        "/api/v1/fiscal/global-drafts/settings",
        json={
            "frequency": "weekly",
            "weekly_close_day": 7,
            "monthly_close_day": 31,
            "auto_close_enabled": False,
        },
    )
    assert denied.status_code == 403


def test_auto_close_empty_period_advances_cursor_without_duplicate_batch(
    client, db: Session, monkeypatch
) -> None:
    tenant_id = _signup_login(client, prefix="auto-empty")
    _enable(db, tenant_id)
    response = client.put(
        "/api/v1/fiscal/global-drafts/settings",
        json={
            "frequency": "daily",
            "weekly_close_day": 7,
            "monthly_close_day": 31,
            "auto_close_enabled": True,
        },
    )
    assert response.status_code == 200
    settings = fiscal_repo.get_settings(db, tenant_id=tenant_id)
    assert settings is not None
    settings.created_at = datetime.now(UTC) - timedelta(days=3)
    db.commit()
    monkeypatch.setattr("app.config.settings.internal_api_key", "auto-secret")
    url = "/api/v1/fiscal/internal/global-drafts/auto-close"
    headers = {"X-Internal-Key": "auto-secret"}
    first = client.post(url, headers=headers, json={"periods_per_tenant": 10})
    second = client.post(url, headers=headers, json={"periods_per_tenant": 10})
    assert first.status_code == second.status_code == 200
    assert first.json()["periods_skipped_empty"] >= 1
    assert second.json()["periods_skipped_empty"] == 0
    db.refresh(settings)
    assert settings.auto_processed_through == datetime.now(FISCAL_TIMEZONE).date() - timedelta(
        days=1
    )
    assert (
        db.query(FiscalGlobalDraftBatch)
        .filter(FiscalGlobalDraftBatch.tenant_id == tenant_id)
        .count()
        == 0
    )


def test_snapshot_failure_rolls_back_entire_sale(client, db: Session, monkeypatch) -> None:
    tenant_id = _signup_login(client, prefix="rollback")
    product = _product(client)
    user = (
        db.query(User)
        .join(Membership, Membership.user_id == User.id)
        .filter(Membership.tenant_id == tenant_id)
        .one()
    )
    before = {
        "orders": db.query(Order).filter(Order.tenant_id == tenant_id).count(),
        "payments": db.query(Payment).filter(Payment.tenant_id == tenant_id).count(),
        "movements": db.query(InventoryMovement)
        .filter(InventoryMovement.tenant_id == tenant_id)
        .count(),
        "keys": db.query(IdempotencyKey).filter(IdempotencyKey.tenant_id == tenant_id).count(),
    }
    original = fiscal_repo.capture_baseline_snapshot

    def fail_after_snapshot(*args, **kwargs):
        original(*args, **kwargs)
        raise RuntimeError("forced snapshot failure")

    monkeypatch.setattr(fiscal_repo, "capture_baseline_snapshot", fail_after_snapshot)
    body = OrderCreate.model_validate(
        {
            "items": [{"product_id": product["id"], "quantity": 1}],
            "payments": [{"method": "bank_transfer", "amount": "100.00"}],
        }
    )
    with pytest.raises(RuntimeError), db.begin_nested():
        order_service.create_order(
            db,
            tenant_id=tenant_id,
            user_id=user.id,
            body=body,
            idempotency_key="forced-snapshot-rollback",
        )
    after = {
        "orders": db.query(Order).filter(Order.tenant_id == tenant_id).count(),
        "payments": db.query(Payment).filter(Payment.tenant_id == tenant_id).count(),
        "movements": db.query(InventoryMovement)
        .filter(InventoryMovement.tenant_id == tenant_id)
        .count(),
        "keys": db.query(IdempotencyKey).filter(IdempotencyKey.tenant_id == tenant_id).count(),
    }
    assert after == before
