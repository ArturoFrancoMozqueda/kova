import csv
import hashlib
import io
import json
import zipfile
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.audit.models import AuditLog
from app.auth.models import Membership, User
from app.fiscal import repository as fiscal_repo
from app.fiscal.models import (
    FiscalGlobalDraftAdjustment,
    FiscalGlobalDraftBatch,
    FiscalGlobalDraftSettings,
    FiscalIndividualInvoiceEvent,
    OrderFiscalSnapshot,
    OrderItemFiscalSnapshot,
)
from app.fiscal.service import FISCAL_TIMEZONE, _csv_safe, resolve_period
from app.idempotency.models import IdempotencyKey
from app.orders import service as order_service
from app.orders.models import InventoryMovement, Order, Payment, Refund, Void
from app.orders.schemas import OrderCreate
from app.tenants.models import Tenant

# Password cost is incidental to these business scenarios; real auth routes stay active.
pytestmark = pytest.mark.usefixtures("fast_business_auth")


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
        frequency="monthly",
        period_end=date(2024, 2, 29),
        weekly_close_day=7,
        monthly_close_day=31,
    ) == (date(2024, 2, 1), date(2024, 2, 29))
    assert resolve_period(
        frequency="weekly",
        period_end=date(2026, 8, 16),  # Sunday, ISO 7
        weekly_close_day=7,
        monthly_close_day=31,
    ) == (date(2026, 8, 10), date(2026, 8, 16))
    with pytest.raises(HTTPException) as exc_info:
        resolve_period(
            frequency="weekly",
            period_end=date(2026, 8, 15),
            weekly_close_day=7,
            monthly_close_day=31,
        )
    assert exc_info.value.status_code == 400
    assert exc_info.value.detail["code"] == "FISCAL_PERIOD_END_MISMATCH"


def test_settings_defaults_are_explicitly_unconfigured_and_get_does_not_persist(
    client, db: Session
) -> None:
    tenant_id = _signup_login(client, prefix="unconfigured")
    assert db.get(FiscalGlobalDraftSettings, tenant_id) is None

    response = client.get("/api/v1/fiscal/global-drafts/settings")

    assert response.status_code == 200, response.text
    assert response.json() == {
        "configured": False,
        "frequency": "monthly",
        "weekly_close_day": 7,
        "monthly_close_day": 31,
        "auto_close_enabled": False,
        "timezone": "America/Mexico_City",
        "scheduler_status": "active",
    }
    assert db.get(FiscalGlobalDraftSettings, tenant_id) is None

    preview = client.get(
        "/api/v1/fiscal/global-drafts/preview",
        params={"period_end": "2026-07-16"},
    )
    assert preview.status_code == 400
    assert preview.json()["detail"] == {
        "code": "FISCAL_SETTINGS_REQUIRED",
        "message": "Configure global draft settings before preparing a preview",
    }

    close = client.post(
        "/api/v1/fiscal/global-drafts/close",
        headers={"Idempotency-Key": "unconfigured-close"},
        json={"period_end": "2026-07-16"},
    )
    assert close.status_code == 400
    assert close.json()["detail"]["code"] == "FISCAL_SETTINGS_REQUIRED"
    assert db.get(FiscalGlobalDraftSettings, tenant_id) is None


def test_put_settings_marks_configuration_as_persisted(client, db: Session) -> None:
    tenant_id = _signup_login(client, prefix="configured")

    response = client.put(
        "/api/v1/fiscal/global-drafts/settings",
        json={
            "frequency": "monthly",
            "weekly_close_day": 7,
            "monthly_close_day": 31,
            "auto_close_enabled": False,
        },
    )

    assert response.status_code == 200, response.text
    assert response.json()["configured"] is True
    assert db.get(FiscalGlobalDraftSettings, tenant_id) is not None
    assert client.get("/api/v1/fiscal/global-drafts/settings").json()["configured"] is True


def test_preview_enforces_persisted_monthly_weekly_and_completed_periods(
    client, db: Session
) -> None:
    tenant_id = _signup_login(client, prefix="period-validation")
    _enable(db, tenant_id)
    monthly = client.put(
        "/api/v1/fiscal/global-drafts/settings",
        json={
            "frequency": "monthly",
            "weekly_close_day": 7,
            "monthly_close_day": 31,
            "auto_close_enabled": False,
        },
    )
    assert monthly.status_code == 200, monthly.text

    mismatch = client.get(
        "/api/v1/fiscal/global-drafts/preview",
        params={"period_end": "2026-07-16"},
    )
    assert mismatch.status_code == 400
    assert mismatch.json()["detail"]["code"] == "FISCAL_PERIOD_END_MISMATCH"

    valid_month = client.get(
        "/api/v1/fiscal/global-drafts/preview",
        params={"period_end": "2026-07-31"},
    )
    assert valid_month.status_code == 200, valid_month.text
    assert valid_month.json()["period_start"] == "2026-07-01"
    assert valid_month.json()["period_end"] == "2026-07-31"

    weekly = client.put(
        "/api/v1/fiscal/global-drafts/settings",
        json={
            "frequency": "weekly",
            "weekly_close_day": 7,
            "monthly_close_day": 31,
            "auto_close_enabled": False,
        },
    )
    assert weekly.status_code == 200, weekly.text
    wrong_weekday = client.get(
        "/api/v1/fiscal/global-drafts/preview",
        params={"period_end": "2026-07-16"},
    )
    assert wrong_weekday.status_code == 400
    assert wrong_weekday.json()["detail"]["code"] == "FISCAL_PERIOD_END_MISMATCH"
    wrong_weekday_close = client.post(
        "/api/v1/fiscal/global-drafts/close",
        headers={"Idempotency-Key": "weekly-wrong-close-day"},
        json={"period_end": "2026-07-16"},
    )
    assert wrong_weekday_close.status_code == 400
    assert wrong_weekday_close.json()["detail"]["code"] == "FISCAL_PERIOD_END_MISMATCH"

    valid_week = client.get(
        "/api/v1/fiscal/global-drafts/preview",
        params={"period_end": "2026-07-12"},
    )
    assert valid_week.status_code == 200, valid_week.text
    assert valid_week.json()["period_start"] == "2026-07-06"
    assert valid_week.json()["period_end"] == "2026-07-12"

    _daily_settings(client)
    today = datetime.now(FISCAL_TIMEZONE).date()
    incomplete = client.get(
        "/api/v1/fiscal/global-drafts/preview",
        params={"period_end": today.isoformat()},
    )
    assert incomplete.status_code == 400
    assert incomplete.json()["detail"]["code"] == "FISCAL_PERIOD_NOT_COMPLETED"
    incomplete_close = client.post(
        "/api/v1/fiscal/global-drafts/close",
        headers={"Idempotency-Key": "daily-incomplete-period"},
        json={"period_end": today.isoformat()},
    )
    assert incomplete_close.status_code == 400
    assert incomplete_close.json()["detail"]["code"] == "FISCAL_PERIOD_NOT_COMPLETED"

    invalid_date = client.get(
        "/api/v1/fiscal/global-drafts/preview",
        params={"period_end": "2026-02-30"},
    )
    assert invalid_date.status_code == 422
    assert client.get("/api/v1/fiscal/global-drafts/preview").status_code == 422


def test_feature_flag_defaults_available_and_explicit_opt_out_closes_gate(
    client, db: Session
) -> None:
    tenant_id = _signup_login(client, prefix="gate")
    response = client.get("/api/v1/fiscal/global-drafts/settings")
    assert response.status_code == 200

    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).one()
    tenant.feature_overrides = {"fiscal_global_drafts": False}
    db.commit()
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
    refund_row = db.get(Refund, UUID(refund.json()["id"]))
    assert refund_row is not None
    refund_row.created_at = datetime.combine(
        yesterday, datetime.min.time(), tzinfo=UTC
    ) + timedelta(hours=18)
    db.commit()

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


def test_auto_close_excludes_explicit_tenant_opt_out(client, db: Session, monkeypatch) -> None:
    tenant_id = _signup_login(client, prefix="auto-opt-out")
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
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).one()
    tenant.feature_overrides = {"fiscal_global_drafts": False}
    db.commit()

    monkeypatch.setattr("app.config.settings.internal_api_key", "opt-out-secret")
    result = client.post(
        "/api/v1/fiscal/internal/global-drafts/auto-close",
        headers={"X-Internal-Key": "opt-out-secret"},
        json={},
    )
    assert result.status_code == 200
    assert result.json()["tenants_examined"] == 0

    tenant.feature_overrides = {"fiscal_global_drafts": "false"}
    db.commit()
    malformed = client.post(
        "/api/v1/fiscal/internal/global-drafts/auto-close",
        headers={"X-Internal-Key": "opt-out-secret"},
        json={},
    )
    assert malformed.status_code == 200
    assert malformed.json()["tenants_examined"] == 1


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


def test_accountant_csv_is_frozen_safe_and_viewable_by_owner_manager_only(
    client, db: Session
) -> None:
    tenant_id = _signup_login(client, prefix="accountant-export")
    _daily_settings(client)
    product = _product(client)
    sale = _sale(client, product["id"])
    yesterday = datetime.now(FISCAL_TIMEZONE).date() - timedelta(days=1)
    _set_sale_day(db, sale["id"], yesterday)
    closed = client.post(
        "/api/v1/fiscal/global-drafts/close",
        headers={"Idempotency-Key": "accountant-export-close"},
        json={"period_end": yesterday.isoformat()},
    )
    assert closed.status_code == 201, closed.text
    batch = closed.json()

    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).one()
    tenant.name = ' \t=HYPERLINK("https://invalid.example")'
    db.commit()

    url = f"/api/v1/fiscal/global-drafts/batches/{batch['id']}/accountant-report.csv"
    owner = client.get(url)
    assert owner.status_code == 200, owner.text
    assert owner.content.startswith(b"\xef\xbb\xbf")
    assert owner.headers["content-type"].startswith("text/csv")
    assert owner.headers["cache-control"] == "no-store"
    assert owner.headers["x-content-type-options"] == "nosniff"
    assert owner.headers["content-disposition"] == (
        f'attachment; filename="kova-reporte-contador-{yesterday.isoformat()}_'
        f'{yesterday.isoformat()}.csv"'
    )

    rows = list(csv.DictReader(io.StringIO(owner.content.decode("utf-8-sig"))))
    assert len(rows) == 1
    row = rows[0]
    assert row["folio_venta"] == UUID(sale["id"]).hex[-8:].upper()
    assert row["id_venta"] == sale["id"]
    assert row["nombre_negocio"] == "Fiscal accountant-export"
    assert row["id_negocio"] == str(tenant_id)
    assert row["zona_horaria"] == "America/Mexico_City"
    assert row["periodo_inicio"] == yesterday.isoformat()
    assert row["periodo_fin"] == yesterday.isoformat()
    assert row["cerrado_en"]
    assert row["importe_bruto"] == batch["gross_amount"]
    assert row["descuentos"] == batch["discount_total_amount"]
    assert row["impuestos"] == ""
    assert row["total"] == batch["total_amount"]
    assert row["reembolsos"] == batch["refund_total_amount"]
    assert row["neto"] == batch["net_total_amount"]
    assert row["moneda"] == "MXN"
    assert row["version_motor_precios"] == "baseline-v1"
    assert row["tipo_documento"] == "BORRADOR_INTERNO"
    assert row["origen_documento"] == "RECIBO_OPERATIVO"
    assert row["estado_fiscal"] == "NO_EMITIDO"
    assert row["estado_impuestos"] == "BASELINE_IMPUESTOS_NO_CALCULADOS"
    assert row["aviso"] == "NO_ES_CFDI"
    assert "no es CFDI" in row["nota"]
    assert "está" in row["nota"]
    assert "@example.com" not in owner.content.decode("utf-8-sig")
    for column, batch_key in (
        ("importe_bruto", "gross_amount"),
        ("descuentos", "discount_total_amount"),
        ("total", "total_amount"),
        ("reembolsos", "refund_total_amount"),
        ("neto", "net_total_amount"),
    ):
        assert sum((Decimal(item[column]) for item in rows), Decimal("0.00")) == Decimal(
            batch[batch_key]
        )
    assert _csv_safe('=HYPERLINK("https://invalid.example")').startswith("'=")
    assert _csv_safe('\r\n=HYPERLINK("https://invalid.example")').startswith("'\r\n=")

    membership = db.query(Membership).filter(Membership.tenant_id == tenant_id).one()
    membership.role = "manager"
    db.commit()
    assert client.get(url).status_code == 200
    membership.role = "cashier"
    db.commit()
    assert client.get(url).status_code == 403
    membership.role = "staff"
    db.commit()
    assert client.get(url).status_code == 403
    membership.role = "owner"
    db.commit()

    other_client = TestClient(client.app)
    _signup_login(other_client, prefix="accountant-export-other")
    assert other_client.get(url).status_code == 404


def test_accountant_csv_allows_empty_closed_batch_and_rejects_open_batch(
    client, db: Session
) -> None:
    tenant_id = _signup_login(client, prefix="accountant-empty")
    yesterday = datetime.now(FISCAL_TIMEZONE).date() - timedelta(days=1)
    empty = FiscalGlobalDraftBatch(
        tenant_id=tenant_id,
        frequency="daily",
        period_start=yesterday,
        period_end=yesterday,
        timezone="America/Mexico_City",
        status="closed",
        document_kind="operational_draft",
        fiscal_status="not_issued",
        gross_amount=Decimal("0.00"),
        discount_total_amount=Decimal("0.00"),
        tax_total_amount=Decimal("0.00"),
        total_amount=Decimal("0.00"),
        refund_total_amount=Decimal("0.00"),
        net_total_amount=Decimal("0.00"),
        order_count=0,
        excluded_individually_confirmed_count=0,
    )
    draft = FiscalGlobalDraftBatch(
        tenant_id=tenant_id,
        frequency="daily",
        period_start=yesterday - timedelta(days=1),
        period_end=yesterday - timedelta(days=1),
        timezone="America/Mexico_City",
        status="draft",
        document_kind="operational_draft",
        fiscal_status="not_issued",
        gross_amount=Decimal("0.00"),
        discount_total_amount=Decimal("0.00"),
        tax_total_amount=Decimal("0.00"),
        total_amount=Decimal("0.00"),
        refund_total_amount=Decimal("0.00"),
        net_total_amount=Decimal("0.00"),
        order_count=0,
        excluded_individually_confirmed_count=0,
    )
    db.add_all([empty, draft])
    db.commit()

    prefix = "/api/v1/fiscal/global-drafts/batches"
    response = client.get(f"{prefix}/{empty.id}/accountant-report.csv")
    assert response.status_code == 200
    assert len(response.content.decode("utf-8-sig").splitlines()) == 1
    assert client.get(f"{prefix}/{draft.id}/accountant-report.csv").status_code == 409


def test_fiscal_kill_switch_hides_session_flag_and_blocks_routes_and_scheduler(
    client, db: Session, monkeypatch
) -> None:
    tenant_id = _signup_login(client, prefix="kill-switch")
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).one()
    tenant.feature_overrides = {"fiscal_global_drafts": True}
    db.commit()

    monkeypatch.setattr("app.config.settings.fiscal_global_drafts_kill_switch", True)
    session = client.get("/api/v1/auth/session")
    assert session.status_code == 200
    assert session.json()["feature_flags"]["fiscal_global_drafts"] is False
    assert client.get("/api/v1/fiscal/global-drafts/settings").status_code == 403

    monkeypatch.setattr("app.config.settings.internal_api_key", "kill-switch-key")
    response = client.post(
        "/api/v1/fiscal/internal/global-drafts/auto-close",
        headers={"X-Internal-Key": "kill-switch-key"},
        json={},
    )
    assert response.status_code == 403


def test_accountant_csv_requires_active_billing_access(client, monkeypatch) -> None:
    _signup_login(client, prefix="accountant-billing")
    monkeypatch.setattr("app.config.settings.billing_trial_days", -1)

    response = client.get(f"/api/v1/fiscal/global-drafts/batches/{uuid4()}/accountant-report.csv")
    assert response.status_code == 402
    assert response.json()["detail"]["reason"] == "trial_expired"


def test_individual_invoice_ledger_is_idempotent_excludes_and_reopens(
    client, db: Session
) -> None:
    tenant_id = _signup_login(client, prefix="individual-ledger")
    _daily_settings(client)
    product = _product(client)
    sale = _sale(client, product["id"])
    yesterday = datetime.now(FISCAL_TIMEZONE).date() - timedelta(days=1)
    _set_sale_day(db, sale["id"], yesterday)
    url = f"/api/v1/fiscal/global-drafts/orders/{sale['id']}/individual-invoice"
    payload = {
        "status": "confirmed",
        "external_reference": "CFDI-EXTERNO-001",
        "issued_at": f"{yesterday.isoformat()}T18:00:00Z",
    }

    first = client.post(url, headers={"Idempotency-Key": "confirm-external-1"}, json=payload)
    replay = client.post(url, headers={"Idempotency-Key": "confirm-external-1"}, json=payload)
    assert first.status_code == replay.status_code == 201
    assert first.json() == replay.json()
    assert first.json()["status"] == "confirmed"
    assert (
        db.query(AuditLog)
        .filter(
            AuditLog.tenant_id == tenant_id,
            AuditLog.action == "fiscal.individual_invoice.confirmed",
            AuditLog.resource_id == UUID(sale["id"]),
        )
        .count()
        == 1
    )
    with pytest.raises(DBAPIError), db.begin_nested():
        db.execute(
            text(
                "UPDATE fiscal_individual_invoice_events SET status = 'reopened' "
                "WHERE id = :id"
            ),
            {"id": UUID(first.json()["id"])},
        )

    preview = client.get(
        "/api/v1/fiscal/global-drafts/preview",
        params={"period_end": yesterday.isoformat()},
    )
    assert preview.status_code == 200
    assert preview.json()["order_count"] == 0
    assert preview.json()["excluded_individually_confirmed_count"] == 1

    membership = db.query(Membership).filter(Membership.tenant_id == tenant_id).one()
    membership.role = "manager"
    db.commit()
    current = client.get(url)
    assert current.status_code == 200
    assert current.json()["status"] == "confirmed"
    assert current.json()["external_reference"] == "CFDI-EXTERNO-001"
    denied = client.post(
        url,
        headers={"Idempotency-Key": "manager-cannot-reopen"},
        json={"status": "reopened"},
    )
    assert denied.status_code == 403
    membership.role = "owner"
    db.commit()

    reopened = client.post(
        url,
        headers={"Idempotency-Key": "reopen-external-1"},
        json={"status": "reopened"},
    )
    assert reopened.status_code == 201
    assert reopened.json()["status"] == "reopened"
    assert client.post(
        url,
        headers={"Idempotency-Key": "duplicate-reopen"},
        json={"status": "reopened"},
    ).status_code == 409

    other_client = TestClient(client.app)
    _signup_login(other_client, prefix="individual-ledger-other")
    assert other_client.post(
        url,
        headers={"Idempotency-Key": "cross-tenant-confirm"},
        json=payload,
    ).status_code == 404


def test_accountant_package_is_deterministic_reconciled_and_tax_unknown(
    client, db: Session
) -> None:
    tenant_id = _signup_login(client, prefix="package")
    _daily_settings(client)
    product = _product(client)
    sale = _sale(client, product["id"])
    yesterday = datetime.now(FISCAL_TIMEZONE).date() - timedelta(days=1)
    _set_sale_day(db, sale["id"], yesterday)
    closed = client.post(
        "/api/v1/fiscal/global-drafts/close",
        headers={"Idempotency-Key": "package-close"},
        json={"period_end": yesterday.isoformat()},
    )
    assert closed.status_code == 201, closed.text
    batch = closed.json()
    assert batch["package_schema_version"] == "accountant-package-v2"
    assert batch["business_name_snapshot"] == "Fiscal package"
    assert batch["tax_calculation_status"] == "not_calculated"

    url = (
        f"/api/v1/fiscal/global-drafts/batches/{batch['id']}"
        "/accountant-package.zip"
    )
    first = client.get(url)
    second = client.get(url)
    assert first.status_code == second.status_code == 200
    assert first.content == second.content
    assert first.headers["content-type"] == "application/zip"
    assert first.headers["cache-control"] == "no-store"
    assert first.headers["x-content-type-options"] == "nosniff"

    with zipfile.ZipFile(io.BytesIO(first.content)) as archive:
        assert set(archive.namelist()) == {
            "resumen.pdf",
            "operaciones.csv",
            "partidas.csv",
            "ajustes.csv",
            "manifest.json",
        }
        files = {name: archive.read(name) for name in archive.namelist()}
    assert files["resumen.pdf"].startswith(b"%PDF")
    manifest = json.loads(files["manifest.json"])
    assert manifest["batch_id"] == batch["id"]
    assert manifest["schema_version"] == "accountant-package-v2"
    assert manifest["tax_calculation_status"] == "not_calculated"
    for filename, metadata in manifest["files"].items():
        assert metadata["bytes"] == len(files[filename])
        assert metadata["sha256"] == hashlib.sha256(files[filename]).hexdigest()

    operations = list(
        csv.DictReader(io.StringIO(files["operaciones.csv"].decode("utf-8-sig")))
    )
    items = list(csv.DictReader(io.StringIO(files["partidas.csv"].decode("utf-8-sig"))))
    assert len(operations) == len(items) == 1
    assert operations[0]["id_venta"] == sale["id"]
    assert operations[0]["impuestos"] == ""
    assert operations[0]["estado_calculo_impuestos"] == "NOT_CALCULATED"
    assert operations[0]["estado_factura_individual"] == "NO_CONFIRMADA_AL_CIERRE"
    assert items[0]["impuestos"] == ""
    assert Decimal(operations[0]["total"]) == Decimal(batch["total_amount"])

    membership = db.query(Membership).filter(Membership.tenant_id == tenant_id).one()
    membership.role = "manager"
    db.commit()
    assert client.get(url).status_code == 200
    membership.role = "cashier"
    db.commit()
    assert client.get(url).status_code == 403


def test_late_refund_creates_adjustment_only_close_without_rewriting_origin(
    client, db: Session
) -> None:
    tenant_id = _signup_login(client, prefix="late-refund")
    _daily_settings(client)
    product = _product(client)
    sale = _sale(client, product["id"])
    original_day = datetime.now(FISCAL_TIMEZONE).date() - timedelta(days=3)
    adjustment_day = original_day + timedelta(days=1)
    _set_sale_day(db, sale["id"], original_day)

    original = client.post(
        "/api/v1/fiscal/global-drafts/close",
        headers={"Idempotency-Key": "late-refund-origin"},
        json={"period_end": original_day.isoformat()},
    )
    assert original.status_code == 201, original.text
    assert original.json()["net_total_amount"] == "100.00"

    refunded = client.post(
        f"/api/v1/orders/{sale['id']}/refunds",
        headers={"Idempotency-Key": "late-refund-created"},
        json={
            "items": [{"order_item_id": sale["items"][0]["id"], "quantity": 1}],
            "reason": "customer_return",
            "refund_payment_method": "bank_transfer",
        },
    )
    assert refunded.status_code == 201, refunded.text
    refund_row = db.get(Refund, UUID(refunded.json()["id"]))
    assert refund_row is not None
    refund_row.created_at = datetime.combine(
        adjustment_day, datetime.min.time(), tzinfo=UTC
    ) + timedelta(hours=18)
    db.commit()

    preview = client.get(
        "/api/v1/fiscal/global-drafts/preview",
        params={"period_end": adjustment_day.isoformat()},
    )
    assert preview.status_code == 200, preview.text
    assert preview.json()["order_count"] == 0
    assert preview.json()["adjustment_count"] == 1
    assert preview.json()["adjustment_total_amount"] == "-100.00"
    assert preview.json()["adjusted_net_amount"] == "-100.00"

    adjusted = client.post(
        "/api/v1/fiscal/global-drafts/close",
        headers={"Idempotency-Key": "late-refund-adjustment"},
        json={"period_end": adjustment_day.isoformat()},
    )
    assert adjusted.status_code == 201, adjusted.text
    assert adjusted.json()["order_ids"] == []
    assert adjusted.json()["adjustment_count"] == 1
    with pytest.raises(DBAPIError), db.begin_nested():
        db.execute(
            text(
                "DELETE FROM fiscal_global_draft_adjustments "
                "WHERE tenant_id = :tenant_id AND batch_id = :batch_id"
            ),
            {
                "tenant_id": tenant_id,
                "batch_id": UUID(adjusted.json()["id"]),
            },
        )
    original_row = db.get(FiscalGlobalDraftBatch, UUID(original.json()["id"]))
    assert original_row is not None
    db.refresh(original_row)
    assert original_row.net_total_amount == Decimal("100.00")

    package = client.get(
        f"/api/v1/fiscal/global-drafts/batches/{adjusted.json()['id']}"
        "/accountant-package.zip"
    )
    assert package.status_code == 200, package.text
    with zipfile.ZipFile(io.BytesIO(package.content)) as archive:
        rows = list(
            csv.DictReader(
                io.StringIO(archive.read("ajustes.csv").decode("utf-8-sig"))
            )
        )
    assert len(rows) == 1
    assert rows[0]["tipo_ajuste"] == "LATE_REFUND"
    assert rows[0]["importe_ajuste"] == "-100.00"
    assert rows[0]["id_cierre_original"] == original.json()["id"]


def test_invoice_corrections_reverse_in_later_adjustment_only_closes(
    client, db: Session
) -> None:
    tenant_id = _signup_login(client, prefix="invoice-corrections")
    _daily_settings(client)
    product = _product(client)
    sale = _sale(client, product["id"])
    original_day = datetime.now(FISCAL_TIMEZONE).date() - timedelta(days=4)
    excluded_day = original_day + timedelta(days=1)
    included_day = original_day + timedelta(days=2)
    _set_sale_day(db, sale["id"], original_day)
    original = client.post(
        "/api/v1/fiscal/global-drafts/close",
        headers={"Idempotency-Key": "correction-origin"},
        json={"period_end": original_day.isoformat()},
    )
    assert original.status_code == 201, original.text
    membership = db.query(Membership).filter(Membership.tenant_id == tenant_id).one()

    db.add(
        FiscalIndividualInvoiceEvent(
            tenant_id=tenant_id,
            order_id=UUID(sale["id"]),
            status="confirmed",
            external_reference="CFDI-EXTERNO-CORRECCION",
            issued_at=datetime.combine(excluded_day, datetime.min.time(), tzinfo=UTC),
            created_by_user_id=membership.user_id,
            created_at=datetime.combine(excluded_day, datetime.min.time(), tzinfo=UTC)
            + timedelta(hours=18),
        )
    )
    db.commit()
    excluded = client.post(
        "/api/v1/fiscal/global-drafts/close",
        headers={"Idempotency-Key": "correction-exclude"},
        json={"period_end": excluded_day.isoformat()},
    )
    assert excluded.status_code == 201, excluded.text
    assert excluded.json()["order_count"] == 0
    assert excluded.json()["adjustment_total_amount"] == "-100.00"

    db.add(
        FiscalIndividualInvoiceEvent(
            tenant_id=tenant_id,
            order_id=UUID(sale["id"]),
            status="reopened",
            external_reference=None,
            issued_at=None,
            created_by_user_id=membership.user_id,
            created_at=datetime.combine(included_day, datetime.min.time(), tzinfo=UTC)
            + timedelta(hours=18),
        )
    )
    db.commit()
    included = client.post(
        "/api/v1/fiscal/global-drafts/close",
        headers={"Idempotency-Key": "correction-include"},
        json={"period_end": included_day.isoformat()},
    )
    assert included.status_code == 201, included.text
    assert included.json()["order_count"] == 0
    assert included.json()["adjustment_total_amount"] == "100.00"


def test_late_sale_is_included_once_in_the_next_closed_period(
    client, db: Session
) -> None:
    tenant_id = _signup_login(client, prefix="late-sale")
    _daily_settings(client)
    product = _product(client)
    original_day = datetime.now(FISCAL_TIMEZONE).date() - timedelta(days=4)
    adjustment_day = original_day + timedelta(days=1)

    on_time_sale = _sale(client, product["id"])
    _set_sale_day(db, on_time_sale["id"], original_day)
    original = client.post(
        "/api/v1/fiscal/global-drafts/close",
        headers={"Idempotency-Key": "late-sale-origin"},
        json={"period_end": original_day.isoformat()},
    )
    assert original.status_code == 201, original.text

    late_sale = _sale(client, product["id"])
    late_order = db.get(Order, UUID(late_sale["id"]))
    assert late_order is not None
    late_order.occurred_at = datetime.combine(
        original_day, datetime.min.time(), tzinfo=UTC
    ) + timedelta(hours=12)
    late_order.created_at = datetime.combine(
        adjustment_day, datetime.min.time(), tzinfo=UTC
    ) + timedelta(hours=18)
    db.commit()

    preview = client.get(
        "/api/v1/fiscal/global-drafts/preview",
        params={"period_end": adjustment_day.isoformat()},
    )
    assert preview.status_code == 200, preview.text
    assert preview.json()["order_count"] == 0
    assert preview.json()["adjustment_count"] == 1
    assert preview.json()["adjustment_total_amount"] == "100.00"

    adjusted = client.post(
        "/api/v1/fiscal/global-drafts/close",
        headers={"Idempotency-Key": "late-sale-adjustment"},
        json={"period_end": adjustment_day.isoformat()},
    )
    assert adjusted.status_code == 201, adjusted.text
    assert adjusted.json()["adjusted_net_amount"] == "100.00"
    rows = (
        db.query(FiscalGlobalDraftAdjustment)
        .filter(
            FiscalGlobalDraftAdjustment.tenant_id == tenant_id,
            FiscalGlobalDraftAdjustment.order_id == UUID(late_sale["id"]),
        )
        .all()
    )
    assert len(rows) == 1
    assert rows[0].adjustment_type == "late_inclusion"
    assert rows[0].source_refund_id is None
    assert rows[0].source_event_id is None
    assert rows[0].original_batch_id == UUID(original.json()["id"])


def test_exclusion_refund_and_reopening_move_only_the_remaining_balance(
    client, db: Session
) -> None:
    tenant_id = _signup_login(client, prefix="fiscal-balance")
    _daily_settings(client)
    product_70 = _product(client, price="70.00")
    product_30 = _product(client, price="30.00")
    sale_response = client.post(
        "/api/v1/orders",
        headers={"Idempotency-Key": "fiscal-balance-sale"},
        json={
            "items": [
                {"product_id": product_70["id"], "quantity": 1},
                {"product_id": product_30["id"], "quantity": 1},
            ],
            "payments": [{"method": "bank_transfer", "amount": "100.00"}],
        },
    )
    assert sale_response.status_code == 201, sale_response.text
    sale = sale_response.json()
    original_day = datetime.now(FISCAL_TIMEZONE).date() - timedelta(days=6)
    excluded_day = original_day + timedelta(days=1)
    refunded_day = original_day + timedelta(days=2)
    reopened_day = original_day + timedelta(days=3)
    _set_sale_day(db, sale["id"], original_day)
    original = client.post(
        "/api/v1/fiscal/global-drafts/close",
        headers={"Idempotency-Key": "fiscal-balance-origin"},
        json={"period_end": original_day.isoformat()},
    )
    assert original.status_code == 201, original.text
    assert original.json()["adjusted_net_amount"] == "100.00"

    membership = db.query(Membership).filter(Membership.tenant_id == tenant_id).one()
    db.add(
        FiscalIndividualInvoiceEvent(
            tenant_id=tenant_id,
            order_id=UUID(sale["id"]),
            status="confirmed",
            external_reference="CFDI-SALDO",
            issued_at=datetime.combine(excluded_day, datetime.min.time(), tzinfo=UTC),
            created_by_user_id=membership.user_id,
            created_at=datetime.combine(excluded_day, datetime.min.time(), tzinfo=UTC)
            + timedelta(hours=18),
        )
    )
    db.commit()
    excluded = client.post(
        "/api/v1/fiscal/global-drafts/close",
        headers={"Idempotency-Key": "fiscal-balance-exclude"},
        json={"period_end": excluded_day.isoformat()},
    )
    assert excluded.status_code == 201, excluded.text
    assert excluded.json()["adjustment_total_amount"] == "-100.00"

    item_30 = next(
        item for item in sale["items"] if Decimal(item["unit_price_amount"]) == Decimal("30.00")
    )
    refunded = client.post(
        f"/api/v1/orders/{sale['id']}/refunds",
        headers={"Idempotency-Key": "fiscal-balance-refund"},
        json={
            "items": [{"order_item_id": item_30["id"], "quantity": 1}],
            "reason": "customer_return",
            "refund_payment_method": "bank_transfer",
        },
    )
    assert refunded.status_code == 201, refunded.text
    refund_row = db.get(Refund, UUID(refunded.json()["id"]))
    assert refund_row is not None
    refund_row.created_at = datetime.combine(
        refunded_day, datetime.min.time(), tzinfo=UTC
    ) + timedelta(hours=18)
    db.commit()
    refund_close = client.post(
        "/api/v1/fiscal/global-drafts/close",
        headers={"Idempotency-Key": "fiscal-balance-refund-close"},
        json={"period_end": refunded_day.isoformat()},
    )
    assert refund_close.status_code == 201, refund_close.text
    assert refund_close.json()["adjustment_count"] == 1
    assert refund_close.json()["adjustment_total_amount"] == "0.00"

    db.add(
        FiscalIndividualInvoiceEvent(
            tenant_id=tenant_id,
            order_id=UUID(sale["id"]),
            status="reopened",
            external_reference=None,
            issued_at=None,
            created_by_user_id=membership.user_id,
            created_at=datetime.combine(reopened_day, datetime.min.time(), tzinfo=UTC)
            + timedelta(hours=18),
        )
    )
    db.commit()
    reopened = client.post(
        "/api/v1/fiscal/global-drafts/close",
        headers={"Idempotency-Key": "fiscal-balance-reopen"},
        json={"period_end": reopened_day.isoformat()},
    )
    assert reopened.status_code == 201, reopened.text
    assert reopened.json()["adjustment_total_amount"] == "70.00"
    contributions = (
        db.query(FiscalGlobalDraftAdjustment)
        .filter(
            FiscalGlobalDraftAdjustment.tenant_id == tenant_id,
            FiscalGlobalDraftAdjustment.order_id == UUID(sale["id"]),
        )
        .order_by(FiscalGlobalDraftAdjustment.occurred_at)
        .all()
    )
    assert [(row.adjustment_type, row.amount) for row in contributions] == [
        ("late_exclusion", Decimal("100.00")),
        ("late_refund", Decimal("0.00")),
        ("late_inclusion", Decimal("70.00")),
    ]


def test_void_after_close_reverses_the_remaining_contribution_once(
    client, db: Session
) -> None:
    tenant_id = _signup_login(client, prefix="late-void")
    _daily_settings(client)
    product = _product(client)
    sale = _sale(client, product["id"])
    original_day = datetime.now(FISCAL_TIMEZONE).date() - timedelta(days=4)
    void_day = original_day + timedelta(days=1)
    _set_sale_day(db, sale["id"], original_day)
    original = client.post(
        "/api/v1/fiscal/global-drafts/close",
        headers={"Idempotency-Key": "late-void-origin"},
        json={"period_end": original_day.isoformat()},
    )
    assert original.status_code == 201, original.text

    response = client.post(
        f"/api/v1/orders/{sale['id']}/void",
        headers={"Idempotency-Key": "late-void-created"},
        json={"reason": "operator_error"},
    )
    assert response.status_code == 201, response.text
    void = db.get(Void, UUID(response.json()["id"]))
    assert void is not None
    void.created_at = datetime.combine(void_day, datetime.min.time(), tzinfo=UTC) + timedelta(
        hours=18
    )
    db.commit()

    adjusted = client.post(
        "/api/v1/fiscal/global-drafts/close",
        headers={"Idempotency-Key": "late-void-adjustment"},
        json={"period_end": void_day.isoformat()},
    )
    assert adjusted.status_code == 201, adjusted.text
    assert adjusted.json()["adjustment_count"] == 1
    assert adjusted.json()["adjustment_total_amount"] == "-100.00"
    row = (
        db.query(FiscalGlobalDraftAdjustment)
        .filter(
            FiscalGlobalDraftAdjustment.tenant_id == tenant_id,
            FiscalGlobalDraftAdjustment.order_id == UUID(sale["id"]),
        )
        .one()
    )
    assert row.adjustment_type == "late_void"
    assert row.amount == Decimal("100.00")
    assert row.original_batch_id == UUID(original.json()["id"])
    package = client.get(
        f"/api/v1/fiscal/global-drafts/batches/{adjusted.json()['id']}"
        "/accountant-package.zip"
    )
    assert package.status_code == 200, package.text
    with zipfile.ZipFile(io.BytesIO(package.content)) as archive:
        adjustments = list(
            csv.DictReader(
                io.StringIO(archive.read("ajustes.csv").decode("utf-8-sig"))
            )
        )
    assert len(adjustments) == 1
    assert adjustments[0]["tipo_ajuste"] == "LATE_VOID"
    assert adjustments[0]["importe_ajuste"] == "-100.00"
