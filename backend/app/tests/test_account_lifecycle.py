import io
import json
import zipfile
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.account_lifecycle import service as account_lifecycle_service
from app.account_lifecycle.models import AccountDeletionRequest
from app.account_lifecycle.service import (
    _EXPORTABLE_TENANT_TABLES,
    _NON_EXPORTABLE_TENANT_TABLES,
    AccountPurgeBatchError,
    purge_due_accounts,
)
from app.auth.models import Membership, User
from app.config import settings
from app.fiscal.models import FiscalGlobalDraftBatch, FiscalGlobalDraftSettings
from app.ops.models import OpsNote
from app.orders.models import Order, Refund, RefundItem
from app.tenants.models import Tenant


def _signup_login(client: TestClient, email: str, tenant_name: str) -> dict:
    signup = client.post(
        "/api/v1/auth/signup",
        json={
            "email": email,
            "password": "S3cur3pass!",
            "tenant_name": tenant_name,
            "accepted_terms": True,
        },
    )
    token = signup.json()["dev_verification_token"]
    client.post("/api/v1/auth/verify", json={"token": token})
    login = client.post("/api/v1/auth/login", json={"email": email, "password": "S3cur3pass!"})
    assert login.status_code == 200, login.text
    return signup.json()


def _sale_with_refund(client: TestClient, *, label: str) -> dict[str, str]:
    shift = client.post(
        "/api/v1/shifts",
        json={"opening_cash_amount": "100.00"},
        headers={"Idempotency-Key": f"{label}-shift-{uuid4().hex}"},
    )
    assert shift.status_code == 201, shift.text
    product = client.post(
        "/api/v1/catalog/products",
        json={"name": f"Producto {label}", "price_amount": "20.00"},
        headers={"Idempotency-Key": f"{label}-product-{uuid4().hex}"},
    )
    assert product.status_code == 201, product.text
    order = client.post(
        "/api/v1/orders",
        json={
            "items": [{"product_id": product.json()["id"], "quantity": 2}],
            "payments": [{"method": "cash", "amount": "40.00", "amount_tendered": "40.00"}],
        },
        headers={"Idempotency-Key": f"{label}-order-{uuid4().hex}"},
    )
    assert order.status_code == 201, order.text
    refund = client.post(
        f"/api/v1/orders/{order.json()['id']}/refunds",
        json={
            "items": [{"order_item_id": order.json()["items"][0]["id"], "quantity": 1}],
            "reason": "customer_return",
            "refund_payment_method": "cash",
        },
        headers={"Idempotency-Key": f"{label}-refund-{uuid4().hex}"},
    )
    assert refund.status_code == 201, refund.text
    return {
        "order_id": order.json()["id"],
        "refund_id": refund.json()["id"],
        "refund_item_id": refund.json()["items"][0]["id"],
    }


def test_owner_exports_tenant_data_as_zip(client: TestClient) -> None:
    signup = _signup_login(client, "export-owner@example.com", "Panadería Exportable")
    product = client.post(
        "/api/v1/catalog/products",
        json={"name": "Concha", "price_amount": "18.00", "sku": "CON-1"},
        headers={"Idempotency-Key": "export-product"},
    )
    assert product.status_code == 201, product.text
    formula_product = client.post(
        "/api/v1/catalog/products",
        json={"name": "=2+2", "price_amount": "1.00", "sku": "SAFE-CSV"},
        headers={"Idempotency-Key": "export-formula-product"},
    )
    assert formula_product.status_code == 201, formula_product.text

    response = client.get("/api/v1/export/account")

    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/zip"
    assert "kova-export-" in response.headers["content-disposition"]
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        names = archive.namelist()
        assert "manifest.json" in names
        assert "datos/products.csv" in names
        assert "datos/miembros.csv" in names
        assert "datos/sessions.csv" not in names
        products = archive.read("datos/products.csv").decode()
        assert "Concha" in products
        assert "'=2+2" in products
        assert signup["tenant_id"] in products
        assert "export-owner@example.com" in archive.read("datos/miembros.csv").decode()


def test_export_allowlist_excludes_ops_and_includes_only_owners_refund_graph(
    client: TestClient,
    db: Session,
) -> None:
    first = _signup_login(client, "export-a@example.com", "Export A")
    first_sale = _sale_with_refund(client, label="export-a")
    second_client = TestClient(client.app)
    second = _signup_login(second_client, "export-b@example.com", "Export B")
    second_sale = _sale_with_refund(second_client, label="export-b")

    first_user = db.scalar(select(User).where(User.email == "export-a@example.com"))
    second_user = db.scalar(select(User).where(User.email == "export-b@example.com"))
    assert first_user is not None
    assert second_user is not None
    internal_canaries = {
        "ops-a-internal-canary",
        "ops-b-internal-canary",
        "ops-general-internal-canary",
    }
    now = datetime.now(UTC)
    db.add_all(
        [
            OpsNote(
                author_user_id=first_user.id,
                entity_type="tenant",
                tenant_id=UUID(first["tenant_id"]),
                body="ops-a-internal-canary",
                created_at=now,
                updated_at=now,
            ),
            OpsNote(
                author_user_id=second_user.id,
                entity_type="tenant",
                tenant_id=UUID(second["tenant_id"]),
                body="ops-b-internal-canary",
                created_at=now,
                updated_at=now,
            ),
            OpsNote(
                author_user_id=first_user.id,
                entity_type="general",
                body="ops-general-internal-canary",
                created_at=now,
                updated_at=now,
            ),
        ]
    )
    db.commit()

    response = client.get("/api/v1/export/account")

    assert response.status_code == 200, response.text
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        names = set(archive.namelist())
        assert "datos/ops_notes.csv" not in names
        assert "datos/refund_items.csv" in names
        manifest = json.loads(archive.read("manifest.json"))
        assert manifest["format"] == "Kova account export v2"
        assert manifest["tables"]["refund_items"] == 1
        refund_items = archive.read("datos/refund_items.csv").decode()
        assert first_sale["refund_item_id"] in refund_items
        assert second_sale["refund_item_id"] not in refund_items
        rendered_text = "\n".join(archive.read(name).decode(errors="replace") for name in names)
        assert all(canary not in rendered_text for canary in internal_canaries)


def test_export_policy_classifies_every_tenant_table(db: Session) -> None:
    tenant_tables = set(
        db.execute(
            text(
                "SELECT table_name FROM information_schema.columns "
                "WHERE table_schema = 'public' AND column_name = 'tenant_id'"
            )
        ).scalars()
    )

    assert tenant_tables == _EXPORTABLE_TENANT_TABLES | _NON_EXPORTABLE_TENANT_TABLES
    assert not (_EXPORTABLE_TENANT_TABLES & _NON_EXPORTABLE_TENANT_TABLES)


def test_only_owner_can_export_or_schedule(client: TestClient, db: Session) -> None:
    signup = _signup_login(client, "manager-export@example.com", "Negocio Gerente")
    membership = db.scalar(select(Membership).where(Membership.tenant_id == signup["tenant_id"]))
    assert membership is not None
    membership.role = "manager"
    db.commit()

    assert client.get("/api/v1/export/account").status_code == 403
    response = client.post(
        "/api/v1/account/deletion",
        json={"password": "S3cur3pass!", "tenant_name": "Negocio Gerente"},
    )
    assert response.status_code == 403


def test_deletion_requires_reauthentication_and_exact_name(client: TestClient) -> None:
    _signup_login(client, "delete-confirm@example.com", "Café Confirmado")

    wrong_password = client.post(
        "/api/v1/account/deletion",
        json={"password": "incorrecta", "tenant_name": "Café Confirmado"},
    )
    assert wrong_password.status_code == 401
    wrong_name = client.post(
        "/api/v1/account/deletion",
        json={"password": "S3cur3pass!", "tenant_name": "Otro negocio"},
    )
    assert wrong_name.status_code == 400


def test_owner_schedules_and_cancels_deletion(client: TestClient) -> None:
    _signup_login(client, "delete-owner@example.com", "Tienda Reversible")

    requested_after = datetime.now(UTC)
    scheduled = client.post(
        "/api/v1/account/deletion",
        json={"password": "S3cur3pass!", "tenant_name": "Tienda Reversible"},
    )
    assert scheduled.status_code == 200, scheduled.text
    assert scheduled.json()["status"] == "pending"
    assert scheduled.json()["purge_after"]
    purge_after = datetime.fromisoformat(scheduled.json()["purge_after"])
    assert purge_after >= requested_after + timedelta(days=settings.account_deletion_grace_days)
    assert settings.account_deletion_grace_days >= 30
    assert client.get("/api/v1/account/deletion").json()["status"] == "pending"

    canceled = client.delete("/api/v1/account/deletion")
    assert canceled.status_code == 200
    assert canceled.json()["status"] == "canceled"
    assert client.get("/api/v1/account/deletion").json()["status"] == "none"


def test_internal_purge_is_guarded(client: TestClient, monkeypatch) -> None:
    from app.config import settings

    monkeypatch.setattr(settings, "internal_api_key", "lifecycle-secret")
    assert client.post("/api/v1/account/internal/deletions/purge").status_code == 403
    response = client.post(
        "/api/v1/account/internal/deletions/purge",
        headers={"X-Internal-Key": "lifecycle-secret"},
    )
    assert response.status_code == 200
    assert response.json() == {"purged": 0}


def test_due_purge_removes_only_requested_tenant(client: TestClient, db: Session) -> None:
    first = _signup_login(client, "purge-a@example.com", "Purge A")
    second_client = TestClient(client.app)
    second = _signup_login(second_client, "purge-b@example.com", "Purge B")
    first_user = db.scalar(select(User).where(User.email == "purge-a@example.com"))
    assert first_user is not None
    first_tenant_id = UUID(first["tenant_id"])
    second_tenant_id = UUID(second["tenant_id"])
    db.add(
        Membership(
            tenant_id=second_tenant_id,
            user_id=first_user.id,
            role="manager",
            is_active=True,
            created_at=datetime.now(UTC),
        )
    )
    db.add(
        FiscalGlobalDraftSettings(
            tenant_id=first_tenant_id,
            frequency="daily",
            weekly_close_day=7,
            monthly_close_day=31,
            auto_close_enabled=False,
            created_by_user_id=first_user.id,
            updated_by_user_id=first_user.id,
        )
    )
    db.add(
        FiscalGlobalDraftBatch(
            tenant_id=first_tenant_id,
            frequency="daily",
            period_start=date(2026, 1, 1),
            period_end=date(2026, 1, 1),
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
            created_by_user_id=first_user.id,
        )
    )
    db.add(
        AccountDeletionRequest(
            id=uuid4(),
            tenant_id=first["tenant_id"],
            requested_by_user_id=first_user.id,
            purge_after=datetime.now(UTC) - timedelta(minutes=1),
        )
    )
    db.commit()

    assert purge_due_accounts(db) == 1
    assert db.get(Tenant, first["tenant_id"]) is None
    assert db.scalar(select(User).where(User.email == "purge-a@example.com")) is not None
    assert db.get(Tenant, second["tenant_id"]) is not None
    assert (
        db.scalar(
            select(Membership).where(
                Membership.tenant_id == second_tenant_id,
                Membership.user_id == first_user.id,
            )
        )
        is not None
    )
    tombstone = db.scalar(
        select(AccountDeletionRequest).where(AccountDeletionRequest.tenant_id == first["tenant_id"])
    )
    assert tombstone is not None
    assert tombstone.status == "completed"
    assert tombstone.requested_by_user_id is None


def test_due_purge_removes_populated_sales_refunds_and_fiscal_graph(
    client: TestClient,
    db: Session,
) -> None:
    first = _signup_login(client, "purge-graph-a@example.com", "Purge Graph A")
    first_sale = _sale_with_refund(client, label="purge-graph-a")
    second_client = TestClient(client.app)
    second = _signup_login(second_client, "purge-graph-b@example.com", "Purge Graph B")
    second_sale = _sale_with_refund(second_client, label="purge-graph-b")
    first_user = db.scalar(select(User).where(User.email == "purge-graph-a@example.com"))
    assert first_user is not None
    request = AccountDeletionRequest(
        tenant_id=UUID(first["tenant_id"]),
        requested_by_user_id=first_user.id,
        purge_after=datetime.now(UTC) - timedelta(minutes=1),
    )
    db.add(request)
    db.commit()

    assert purge_due_accounts(db) == 1

    assert db.get(Tenant, first["tenant_id"]) is None
    assert db.get(Order, first_sale["order_id"]) is None
    assert db.get(Refund, first_sale["refund_id"]) is None
    assert db.get(RefundItem, first_sale["refund_item_id"]) is None
    assert db.scalar(select(User).where(User.email == "purge-graph-a@example.com")) is None
    assert db.get(Tenant, second["tenant_id"]) is not None
    assert db.get(Order, second_sale["order_id"]) is not None
    assert db.get(Refund, second_sale["refund_id"]) is not None
    assert db.get(RefundItem, second_sale["refund_item_id"]) is not None
    db.refresh(request)
    assert request.status == "completed"
    assert request.requested_by_user_id is None


def test_failed_account_does_not_block_batch_and_can_retry_without_pii(
    client: TestClient,
    db: Session,
    monkeypatch,
    caplog,
) -> None:
    failed = _signup_login(client, "purge-failure@example.com", "Private Failure Tenant")
    failed_sale = _sale_with_refund(client, label="purge-failure-private")
    success_client = TestClient(client.app)
    success = _signup_login(success_client, "purge-success@example.com", "Purge Success")
    success_sale = _sale_with_refund(success_client, label="purge-success")
    due_at = datetime.now(UTC) - timedelta(minutes=1)
    failed_user = db.scalar(select(User).where(User.email == "purge-failure@example.com"))
    success_user = db.scalar(select(User).where(User.email == "purge-success@example.com"))
    assert failed_user is not None
    assert success_user is not None
    failed_request = AccountDeletionRequest(
        tenant_id=UUID(failed["tenant_id"]),
        requested_by_user_id=failed_user.id,
        purge_after=due_at - timedelta(seconds=1),
    )
    success_request = AccountDeletionRequest(
        tenant_id=UUID(success["tenant_id"]),
        requested_by_user_id=success_user.id,
        purge_after=due_at,
    )
    db.add_all([failed_request, success_request])
    db.commit()

    original_purge = account_lifecycle_service._purge_account_graph

    def fail_one_account(db_session, *, request, completed_at):
        if request.id == failed_request.id:
            original_purge(db_session, request=request, completed_at=completed_at)
            raise RuntimeError("purge-failure@example.com Private Failure Tenant private-db-detail")
        return original_purge(db_session, request=request, completed_at=completed_at)

    monkeypatch.setattr(
        account_lifecycle_service,
        "_purge_account_graph",
        fail_one_account,
    )
    with caplog.at_level("ERROR", logger="app.account_lifecycle.service"):
        with pytest.raises(AccountPurgeBatchError) as exc_info:
            purge_due_accounts(db)
    assert exc_info.value.purged == 1
    assert exc_info.value.failed == 1

    assert db.get(Tenant, failed["tenant_id"]) is not None
    assert db.get(Order, failed_sale["order_id"]) is not None
    assert db.get(Tenant, success["tenant_id"]) is None
    assert db.get(Order, success_sale["order_id"]) is None
    db.refresh(failed_request)
    db.refresh(success_request)
    assert failed_request.status == "pending"
    assert success_request.status == "completed"
    rendered_logs = "\n".join(record.getMessage() for record in caplog.records)
    assert str(failed_request.id) in rendered_logs
    assert "RuntimeError" in rendered_logs
    assert "purge-failure@example.com" not in rendered_logs
    assert "Private Failure Tenant" not in rendered_logs
    assert "private-db-detail" not in rendered_logs

    monkeypatch.setattr(
        account_lifecycle_service,
        "_purge_account_graph",
        original_purge,
    )
    assert purge_due_accounts(db) == 1
    assert db.get(Tenant, failed["tenant_id"]) is None
    assert db.get(Order, failed_sale["order_id"]) is None
    db.refresh(failed_request)
    assert failed_request.status == "completed"
