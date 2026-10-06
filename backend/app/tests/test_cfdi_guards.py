"""A live CFDI reserves money and fiscal inclusion until definitively released."""

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Event
from time import monotonic, sleep
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth.models import Membership, User
from app.cfdi.models import ACTIVE_STATES, CfdiConnection, CfdiDocument
from app.fiscal import repository as fiscal_repo
from app.fiscal.models import FiscalIndividualInvoiceEvent, OrderFiscalSnapshot
from app.fiscal.service import FISCAL_TIMEZONE
from app.integrations.models import InvoiceRequest
from app.orders.models import Order, Refund, Void
from app.tenants.models import Tenant
from app.tests.test_fiscal_global_drafts import (
    _daily_settings,
    _enable,
    _product,
    _sale,
    _set_sale_day,
    _signup_login,
)


def _reserve(db, tenant, sale, *, environment="live", state="prepared", commit=True):
    order = db.get(Order, UUID(sale["id"]))
    owner = db.query(Membership).filter_by(tenant_id=tenant).one()
    connection = CfdiConnection(
        tenant_id=tenant,
        environment=environment,
        organization_id=str(uuid4()),
        encrypted_api_key="opaque-test-only-ciphertext",
    )
    request = InvoiceRequest(
        tenant_id=tenant,
        branch_id=order.branch_id,
        order_id=order.id,
        issuer_snapshot={},
        recipient_snapshot={},
        pricing_snapshot={},
        total_amount=order.total_amount,
    )
    db.add_all([connection, request])
    db.flush()
    document = CfdiDocument(
        tenant_id=tenant,
        branch_id=order.branch_id,
        order_id=order.id,
        request_id=request.id,
        connection_id=connection.id,
        environment=environment,
        organization_id=connection.organization_id,
        state=state,
        idempotency_key=str(uuid4()),
        request_hash="0" * 64,
        external_id=str(uuid4()),
        provider_key=str(uuid4()),
        payload={},
        total_amount=order.total_amount,
        created_by_user_id=owner.user_id,
    )
    db.add(document)
    db.flush()
    if commit:
        db.commit()
    return document


def _operation(client, sale, operation):
    headers = {"Idempotency-Key": str(uuid4())}
    if operation == "refund":
        return client.post(
            f"/api/v1/orders/{sale['id']}/refunds",
            headers=headers,
            json={
                "items": [{"order_item_id": sale["items"][0]["id"], "quantity": 1}],
                "reason": "customer_return",
                "refund_payment_method": "bank_transfer",
            },
        )
    if operation == "void":
        return client.post(
            f"/api/v1/orders/{sale['id']}/void",
            headers=headers,
            json={"reason": "operator_error"},
        )
    body = {"status": operation}
    if operation == "confirmed":
        body.update(
            external_reference="external-manual-reference", issued_at=datetime.now(UTC).isoformat()
        )
    return client.post(
        f"/api/v1/fiscal/global-drafts/orders/{sale['id']}/individual-invoice",
        headers=headers,
        json=body,
    )


@pytest.mark.parametrize("state", ACTIVE_STATES)
@pytest.mark.parametrize("operation", ("refund", "void", "confirmed", "reopened"))
def test_live_reservation_blocks_money_and_manual_fiscal_changes(client, db, state, operation):
    tenant = _signup_login(client, prefix="cfdi-guard")
    _enable(db, tenant)
    sale = _sale(client, _product(client)["id"])
    _reserve(db, tenant, sale, state=state)
    response = _operation(client, sale, operation)
    assert response.status_code == 409, response.text
    assert "CFDI" in response.json()["detail"]
    assert db.get(Order, UUID(sale["id"])).status == "completed"
    assert db.query(Refund).filter_by(tenant_id=tenant).count() == 0
    assert db.query(Void).filter_by(tenant_id=tenant).count() == 0
    assert db.query(FiscalIndividualInvoiceEvent).filter_by(tenant_id=tenant).count() == 0


@pytest.mark.parametrize("operation", ("refund", "void", "confirmed"))
@pytest.mark.parametrize(
    "environment,state", (("test", "issued"), ("live", "canceled"), ("live", "rejected"))
)
def test_test_or_released_documents_preserve_existing_operations(
    client, db, operation, environment, state
):
    tenant = _signup_login(client, prefix="cfdi-released")
    _enable(db, tenant)
    sale = _sale(client, _product(client)["id"])
    _reserve(db, tenant, sale, environment=environment, state=state)
    response = _operation(client, sale, operation)
    assert response.status_code == 201, response.text


@pytest.mark.parametrize("state", ACTIVE_STATES)
def test_global_preview_and_close_exclude_live_reservations_before_ledger_confirmation(
    client, db, state
):
    tenant = _signup_login(client, prefix="cfdi-global")
    _enable(db, tenant)
    _daily_settings(client)
    reserved = _sale(client, _product(client)["id"])
    ordinary = _sale(client, _product(client)["id"])
    day = datetime.now(FISCAL_TIMEZONE).date() - timedelta(days=2)
    for sale in (reserved, ordinary):
        _set_sale_day(db, sale["id"], day)
    _reserve(db, tenant, reserved, state=state)
    preview = client.get(
        "/api/v1/fiscal/global-drafts/preview", params={"period_end": day.isoformat()}
    )
    assert preview.status_code == 200, preview.text
    assert preview.json()["order_count"] == 1
    close = client.post(
        "/api/v1/fiscal/global-drafts/close",
        headers={"Idempotency-Key": str(uuid4())},
        json={"period_end": day.isoformat()},
    )
    assert close.status_code == 201, close.text
    assert close.json()["order_count"] == 1
    ids = fiscal_repo.batch_order_ids(db, tenant_id=tenant, batch_id=UUID(close.json()["id"]))
    assert ids == [UUID(ordinary["id"])]


def test_late_sale_is_deferred_while_reserved_then_included_after_cancel(client, db):
    tenant = _signup_login(client, prefix="cfdi-late")
    _enable(db, tenant)
    _daily_settings(client)
    old_day = datetime.now(FISCAL_TIMEZONE).date() - timedelta(days=4)
    late_day = old_day + timedelta(days=1)
    original = _sale(client, _product(client)["id"])
    _set_sale_day(db, original["id"], old_day)
    closed = client.post(
        "/api/v1/fiscal/global-drafts/close",
        headers={"Idempotency-Key": str(uuid4())},
        json={"period_end": old_day.isoformat()},
    )
    assert closed.status_code == 201, closed.text
    late = _sale(client, _product(client)["id"])
    order = db.get(Order, UUID(late["id"]))
    order.occurred_at = datetime.combine(old_day, datetime.min.time(), tzinfo=UTC) + timedelta(
        hours=18
    )
    order.created_at = datetime.combine(late_day, datetime.min.time(), tzinfo=UTC) + timedelta(
        hours=18
    )
    db.commit()
    document = _reserve(db, tenant, late, state="cancel_pending")
    start = datetime.combine(late_day, datetime.min.time(), tzinfo=FISCAL_TIMEZONE).astimezone(UTC)
    end = start + timedelta(days=1)
    assert fiscal_repo.due_adjustments(db, tenant_id=tenant, start_utc=start, end_utc=end) == []
    document.state = "canceled"
    db.commit()
    adjustments = fiscal_repo.due_adjustments(
        db, tenant_id=tenant, start_utc=start, end_utc=end, lock=True
    )
    assert len(adjustments) == 1
    assert adjustments[0]["order_id"] == UUID(late["id"])
    assert adjustments[0]["adjustment_type"] == "late_inclusion"
    assert adjustments[0]["amount"] == 100
    assert (
        client.get(f"/api/v1/fiscal/global-drafts/batches/{closed.json()['id']}").json()["order_count"] == 1
    )


def test_pending_cancel_preserves_exclusion_and_defers_reopened_inclusion(client, db):
    tenant = _signup_login(client, prefix="cfdi-reopen")
    _enable(db, tenant)
    _daily_settings(client)
    sale = _sale(client, _product(client)["id"])
    day = datetime.now(FISCAL_TIMEZONE).date() - timedelta(days=5)
    _set_sale_day(db, sale["id"], day)
    closed = client.post(
        "/api/v1/fiscal/global-drafts/close",
        headers={"Idempotency-Key": str(uuid4())},
        json={"period_end": day.isoformat()},
    )
    assert closed.status_code == 201, closed.text
    document = _reserve(db, tenant, sale, state="cancel_pending")
    owner = db.query(Membership).filter_by(tenant_id=tenant).one()
    for offset, status in ((1, "confirmed"), (2, "reopened")):
        event_time = datetime.combine(
            day + timedelta(days=offset), datetime.min.time(), tzinfo=UTC
        ) + timedelta(hours=18)
        db.add(
            FiscalIndividualInvoiceEvent(
                tenant_id=tenant,
                order_id=UUID(sale["id"]),
                status=status,
                created_by_user_id=owner.user_id,
                created_at=event_time,
                external_reference="issued-reference" if status == "confirmed" else None,
                issued_at=event_time if status == "confirmed" else None,
            )
        )
    db.commit()
    excluded = client.post(
        "/api/v1/fiscal/global-drafts/close",
        headers={"Idempotency-Key": str(uuid4())},
        json={"period_end": (day + timedelta(days=1)).isoformat()},
    )
    assert excluded.status_code == 201, excluded.text
    assert excluded.json()["adjustment_total_amount"] == "-100.00"
    reopen_day = day + timedelta(days=2)
    start = datetime.combine(reopen_day, datetime.min.time(), tzinfo=FISCAL_TIMEZONE).astimezone(
        UTC
    )
    end = start + timedelta(days=1)
    assert fiscal_repo.due_adjustments(db, tenant_id=tenant, start_utc=start, end_utc=end) == []
    document.state = "canceled"
    db.commit()
    adjustments = fiscal_repo.due_adjustments(
        db, tenant_id=tenant, start_utc=start, end_utc=end, lock=True
    )
    assert len(adjustments) == 1
    assert adjustments[0]["adjustment_type"] == "late_inclusion"
    assert adjustments[0]["amount"] == 100
    original = client.get(f"/api/v1/fiscal/global-drafts/batches/{closed.json()['id']}")
    assert original.status_code == 200
    assert original.json()["total_amount"] == "100.00"


@pytest.mark.parametrize("kind", ("current_period", "late_inclusion"))
@pytest.mark.parametrize("commit_reservation", (True, False))
def test_global_waits_for_sale_reservation_commit_or_rollback(kind, commit_reservation):
    """Use real independent transactions and prove the waiter is blocked by PG."""
    from migration_tests.test_0065_tenant_hardening import _run_alembic, _temporary_database

    with _temporary_database() as (url, engine):
        _run_alembic(url, "head")
        tenant, user, sale_id = uuid4(), uuid4(), uuid4()
        start = datetime(2026, 9, 20, 6, tzinfo=UTC)
        end = start + timedelta(days=1)
        sale_time = start + timedelta(hours=6)
        if kind == "late_inclusion":
            sale_time -= timedelta(days=1)
        with Session(engine) as seed:
            seed.add(Tenant(id=tenant, name="Concurrent fiscal shop", slug=str(tenant)))
            seed.add(
                User(
                    id=user,
                    email=f"{user}@example.com",
                    hashed_password="test-hash",
                    created_at=start,
                    updated_at=start,
                )
            )
            seed.flush()
            seed.add(Membership(tenant_id=tenant, user_id=user, role="owner", created_at=start))
            sale = Order(
                id=sale_id,
                tenant_id=tenant,
                branch_id=tenant,
                status="completed",
                subtotal_amount=100,
                total_amount=100,
                occurred_at=sale_time,
                created_at=start + timedelta(hours=6),
            )
            seed.add(sale)
            seed.flush()
            seed.add(
                OrderFiscalSnapshot(
                    tenant_id=tenant,
                    order_id=sale_id,
                    gross_amount=100,
                    discount_total_amount=0,
                    tax_total_amount=0,
                    total_amount=100,
                    pricing_engine_version="baseline-v1",
                    tax_calculation_status="not_calculated",
                    currency="MXN",
                )
            )
            if kind == "late_inclusion":
                # This is an already-closed operational period; the newly synced
                # sale belongs there, but was not part of its original assignment.
                day = sale_time.astimezone(FISCAL_TIMEZONE).date()
                fiscal_repo.create_batch(
                    seed,
                    tenant_id=tenant,
                    user_id=user,
                    frequency="daily",
                    period_start=day,
                    period_end=day,
                    snapshots=[],
                    refund_totals={},
                    excluded_individually_confirmed_count=0,
                    business_name="Concurrent shop",
                    adjustments=[],
                )
            seed.commit()

        waiter_ready = Event()
        waiter_pid = []

        def close_candidate():
            with Session(engine) as closing:
                closing.execute(text("SET LOCAL statement_timeout = '10s'"))
                waiter_pid.append(closing.scalar(text("SELECT pg_backend_pid()")))
                waiter_ready.set()
                if kind == "late_inclusion":
                    rows = fiscal_repo.due_adjustments(
                        closing, tenant_id=tenant, start_utc=start, end_utc=end, lock=True
                    )
                    return [row["order_id"] for row in rows]
                rows = fiscal_repo.eligible_order_snapshots(
                    closing, tenant_id=tenant, start_utc=start, end_utc=end, lock=True
                )
                return [row.order_id for row in rows]

        with Session(engine) as issuing, ThreadPoolExecutor(max_workers=1) as executor:
            issuing.query(Order).filter_by(tenant_id=tenant, id=sale_id).with_for_update().one()
            _reserve(issuing, tenant, {"id": str(sale_id)}, commit=False)
            result = executor.submit(close_candidate)
            try:
                assert waiter_ready.wait(5), "global closer did not start"
                deadline = monotonic() + 5
                blocked = False
                while monotonic() < deadline:
                    with engine.connect() as monitor:
                        blocked = monitor.scalar(
                            text(
                                "SELECT wait_event_type = 'Lock' FROM pg_stat_activity "
                                "WHERE pid = :pid"
                            ),
                            {"pid": waiter_pid[0]},
                        )
                    if blocked or result.done():
                        break
                    sleep(0.01)
                assert blocked, "global closer must wait for the issuer's actual sale lock"
                if commit_reservation:
                    issuing.commit()
                else:
                    issuing.rollback()
                assert result.result(timeout=10) == ([] if commit_reservation else [sale_id])
            finally:
                # Release the lock even if an assertion fails, before joining the
                # worker, so failed tests cannot hang the rest of the suite.
                issuing.rollback()
