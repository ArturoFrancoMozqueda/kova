from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor, TimeoutError
from datetime import UTC, datetime
from decimal import Decimal
from threading import Event
from uuid import UUID, uuid4

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.audit.models import AuditLog
from app.auth.models import User
from app.catalog.models import Product
from app.idempotency.models import IdempotencyKey
from app.orders import repository as order_repo
from app.orders import service as order_service
from app.orders.models import Order, OrderItem, Payment, Refund, RefundItem
from app.orders.schemas import (
    OrderCreate,
    OrderItemCreate,
    PaymentCreate,
    RefundCreate,
    RefundItemCreate,
)
from app.shifts import repository as shift_repo
from app.shifts import service as shift_service
from app.shifts.models import CashMovement, Shift
from app.shifts.schemas import CashMovementCreate, ShiftCloseCreate
from app.tenants.models import Tenant


def _signup_and_open_shift(client) -> dict:
    suffix = uuid4().hex
    signup_response = client.post(
        "/api/v1/auth/signup",
        json={
            "email": f"shift-integrity-{suffix}@example.com",
            "password": "S3cur3pass!",
            "tenant_name": f"Shift Integrity {suffix}",
            "accepted_terms": True,
        },
    )
    assert signup_response.status_code == 201, signup_response.text
    signup = signup_response.json()
    verify = client.post("/api/v1/auth/verify", json={"token": signup["dev_verification_token"]})
    assert verify.status_code == 200, verify.text
    login = client.post(
        "/api/v1/auth/login",
        json={"email": f"shift-integrity-{suffix}@example.com", "password": "S3cur3pass!"},
    )
    assert login.status_code == 200, login.text
    opened = client.post(
        "/api/v1/shifts",
        headers={"Idempotency-Key": f"open-{suffix}"},
        json={"opening_cash_amount": "100.00"},
    )
    assert opened.status_code == 201, opened.text
    return opened.json()


def _seed_concurrent_drawer(owner_engine, *, existing_sale: bool = False) -> dict:
    tenant_id = uuid4()
    shift_id = uuid4()
    user_id = uuid4()
    product_id = uuid4()
    order_id = uuid4() if existing_sale else None
    order_item_id = uuid4() if existing_sale else None
    now = datetime.now(UTC)
    with Session(owner_engine) as seed:
        seed.add(Tenant(id=tenant_id, name="Concurrent Drawer", slug=f"drawer-{uuid4().hex}"))
        seed.flush()
        seed.add(
            User(
                id=user_id,
                email=f"concurrent-drawer-{uuid4().hex}@example.com",
                hashed_password="test-only",
                is_email_verified=True,
                is_active=True,
                created_at=now,
                updated_at=now,
            )
        )
        seed.add(
            Product(
                id=product_id,
                tenant_id=tenant_id,
                name="Concurrent sale product",
                price_amount=Decimal("25.00"),
                track_inventory=False,
                is_active=True,
            )
        )
        seed.add(
            Shift(
                id=shift_id,
                tenant_id=tenant_id,
                opened_by_user_id=user_id,
                status="open",
                opening_cash_amount=Decimal("100.00"),
            )
        )
        seed.flush()
        seed.add(
            CashMovement(
                tenant_id=tenant_id,
                shift_id=shift_id,
                type="opening_balance",
                amount=Decimal("100.00"),
                reason="Opening balance",
                created_by_user_id=user_id,
            )
        )
        if existing_sale:
            seed.add(
                Order(
                    id=order_id,
                    tenant_id=tenant_id,
                    shift_id=shift_id,
                    created_by_user_id=user_id,
                    status="completed",
                    subtotal_amount=Decimal("50.00"),
                    total_amount=Decimal("50.00"),
                    occurred_at=now,
                )
            )
            seed.flush()
            seed.add(
                OrderItem(
                    id=order_item_id,
                    tenant_id=tenant_id,
                    order_id=order_id,
                    product_id=product_id,
                    product_name="Concurrent sale product",
                    quantity=2,
                    unit_price_amount=Decimal("25.00"),
                    line_total_amount=Decimal("50.00"),
                )
            )
            seed.add(
                Payment(
                    tenant_id=tenant_id,
                    order_id=order_id,
                    method="cash",
                    amount_amount=Decimal("50.00"),
                    amount_tendered_amount=Decimal("50.00"),
                    change_due_amount=Decimal("0.00"),
                )
            )
        seed.commit()
    return {
        "tenant_id": tenant_id,
        "shift_id": shift_id,
        "user_id": user_id,
        "product_id": product_id,
        "order_id": order_id,
        "order_item_id": order_item_id,
    }


def _cleanup_concurrent_drawer(owner_engine, *, tenant_id, user_id) -> None:
    with Session(owner_engine) as cleanup:
        refund_ids = [
            refund_id
            for (refund_id,) in cleanup.query(Refund.id).filter_by(tenant_id=tenant_id).all()
        ]
        if refund_ids:
            cleanup.query(RefundItem).filter(RefundItem.refund_id.in_(refund_ids)).delete(
                synchronize_session=False
            )
        cleanup.query(Refund).filter_by(tenant_id=tenant_id).delete()
        cleanup.query(Payment).filter_by(tenant_id=tenant_id).delete()
        cleanup.query(OrderItem).filter_by(tenant_id=tenant_id).delete()
        cleanup.query(Order).filter_by(tenant_id=tenant_id).delete()
        cleanup.query(AuditLog).filter_by(tenant_id=tenant_id).delete()
        cleanup.query(IdempotencyKey).filter_by(tenant_id=tenant_id).delete()
        cleanup.query(CashMovement).filter_by(tenant_id=tenant_id).delete()
        cleanup.query(Shift).filter_by(tenant_id=tenant_id).delete()
        cleanup.query(Product).filter_by(tenant_id=tenant_id).delete()
        cleanup.query(User).filter_by(id=user_id).delete()
        cleanup.query(Tenant).filter_by(id=tenant_id).delete()
        cleanup.commit()


def _assert_still_waiting(future, *, operation: str) -> None:
    try:
        future.result(timeout=0.25)
    except TimeoutError:
        return
    raise AssertionError(f"shift close did not wait for the in-flight {operation}")


def _run_close_against_writer(
    owner_engine,
    monkeypatch,
    *,
    context: dict,
    writer: Callable[[Session], tuple[int, dict]],
    writer_holds_shift: Event,
    allow_writer_to_finish: Event,
    operation: str,
) -> tuple[int, dict, dict]:
    close_attempted_shift_lock = Event()
    original_lock_shift = shift_repo.get_shift_for_update

    def observe_close_lock_attempt(*args, **kwargs):
        close_attempted_shift_lock.set()
        return original_lock_shift(*args, **kwargs)

    def run_writer() -> tuple[int, int, dict]:
        with Session(owner_engine) as worker_db:
            connection_id = worker_db.execute(text("SELECT pg_backend_pid()")).scalar_one()
            status, body = writer(worker_db)
            return connection_id, status, body

    def close_drawer() -> tuple[int, int, dict]:
        with Session(owner_engine) as worker_db:
            connection_id = worker_db.execute(text("SELECT pg_backend_pid()")).scalar_one()
            status, body = shift_service.close_shift(
                worker_db,
                tenant_id=context["tenant_id"],
                user_id=context["user_id"],
                shift_id=context["shift_id"],
                body=ShiftCloseCreate(actual_cash_amount=Decimal("125.00")),
                idempotency_key=f"close-{uuid4().hex}",
            )
            return connection_id, status, body

    with ThreadPoolExecutor(max_workers=2) as pool:
        writer_future = pool.submit(run_writer)
        assert writer_holds_shift.wait(timeout=5)
        monkeypatch.setattr(shift_repo, "get_shift_for_update", observe_close_lock_attempt)
        close_future = pool.submit(close_drawer)
        assert close_attempted_shift_lock.wait(timeout=5)
        _assert_still_waiting(close_future, operation=operation)

        allow_writer_to_finish.set()
        writer_connection, writer_status, writer_body = writer_future.result(timeout=5)
        close_connection, close_status, closed = close_future.result(timeout=5)

    assert writer_connection != close_connection
    assert close_status == 201
    return writer_status, writer_body, closed


def test_cash_movement_requires_and_replays_idempotency_key(client) -> None:
    shift = _signup_and_open_shift(client)
    url = f"/api/v1/shifts/{shift['id']}/cash-movements"
    payload = {"type": "cash_out", "amount": "20.00", "reason": "Compra de insumos"}

    missing_key = client.post(url, json=payload)
    assert missing_key.status_code == 400

    key = f"cash-movement-{uuid4().hex}"
    first = client.post(url, headers={"Idempotency-Key": key}, json=payload)
    replay = client.post(url, headers={"Idempotency-Key": key}, json=payload)

    assert first.status_code == 201, first.text
    assert replay.status_code == 201, replay.text
    assert replay.json() == first.json()

    detail = client.get(f"/api/v1/shifts/{shift['id']}")
    assert detail.status_code == 200, detail.text
    cash_out = [
        movement for movement in detail.json()["movements"] if movement["type"] == "cash_out"
    ]
    assert len(cash_out) == 1
    assert cash_out[0]["amount"] == "20.00"

    different_payload = client.post(
        url,
        headers={"Idempotency-Key": key},
        json={**payload, "amount": "25.00"},
    )
    assert different_payload.status_code == 400
    assert "different request body" in different_payload.text


def test_close_waits_for_inflight_movement_and_includes_it(owner_engine, monkeypatch) -> None:
    tenant_id = uuid4()
    shift_id = uuid4()
    user_id = uuid4()
    with Session(owner_engine) as seed:
        seed.add(Tenant(id=tenant_id, name="Concurrent Drawer", slug=f"drawer-{uuid4().hex}"))
        now = datetime.now(UTC)
        seed.add(
            User(
                id=user_id,
                email=f"concurrent-drawer-{uuid4().hex}@example.com",
                hashed_password="test-only",
                is_email_verified=True,
                is_active=True,
                created_at=now,
                updated_at=now,
            )
        )
        seed.add(
            Shift(
                id=shift_id,
                tenant_id=tenant_id,
                opened_by_user_id=user_id,
                status="open",
                opening_cash_amount=Decimal("100.00"),
            )
        )
        seed.flush()
        seed.add(
            CashMovement(
                tenant_id=tenant_id,
                shift_id=shift_id,
                type="opening_balance",
                amount=Decimal("100.00"),
                reason="Opening balance",
                created_by_user_id=user_id,
            )
        )
        seed.commit()

    writer_holds_shift = Event()
    allow_writer_to_finish = Event()
    close_attempted_shift_lock = Event()
    original_create_movement = shift_repo.create_cash_movement
    original_lock_shift = shift_repo.get_shift_for_update

    def pause_while_holding_shift(*args, **kwargs):
        writer_holds_shift.set()
        assert allow_writer_to_finish.wait(timeout=5)
        return original_create_movement(*args, **kwargs)

    monkeypatch.setattr(shift_repo, "create_cash_movement", pause_while_holding_shift)

    def observe_close_lock_attempt(*args, **kwargs):
        close_attempted_shift_lock.set()
        return original_lock_shift(*args, **kwargs)

    def record_movement() -> tuple[int, dict]:
        with Session(owner_engine) as worker_db:
            return shift_service.record_cash_movement(
                worker_db,
                tenant_id=tenant_id,
                user_id=user_id,
                shift_id=shift_id,
                body=CashMovementCreate(
                    type="cash_in", amount=Decimal("10.00"), reason="Cambio adicional"
                ),
                idempotency_key=f"movement-{uuid4().hex}",
            )

    def close_drawer() -> tuple[int, dict]:
        with Session(owner_engine) as worker_db:
            return shift_service.close_shift(
                worker_db,
                tenant_id=tenant_id,
                user_id=user_id,
                shift_id=shift_id,
                body=ShiftCloseCreate(actual_cash_amount=Decimal("110.00")),
                idempotency_key=f"close-{uuid4().hex}",
            )

    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            movement_future = pool.submit(record_movement)
            assert writer_holds_shift.wait(timeout=5)
            monkeypatch.setattr(shift_repo, "get_shift_for_update", observe_close_lock_attempt)
            close_future = pool.submit(close_drawer)
            assert close_attempted_shift_lock.wait(timeout=5)

            # The close must be waiting on the same shift row while the cash
            # writer is still in flight. Without the common lock it completes
            # with a stale 100.00 snapshot here.
            try:
                close_future.result(timeout=0.25)
            except TimeoutError:
                pass
            else:
                raise AssertionError("shift close did not wait for the cash writer")

            allow_writer_to_finish.set()
            movement_status, _ = movement_future.result(timeout=5)
            close_status, closed = close_future.result(timeout=5)

        assert movement_status == 201
        assert close_status == 201
        assert closed["expected_cash_amount"] == "110.00"
        assert closed["variance_amount"] == "0.00"

        with Session(owner_engine) as check:
            persisted = check.get(Shift, shift_id)
            assert persisted is not None
            assert persisted.status == "closed"
            assert persisted.expected_cash_amount == Decimal("110.00")
            total = sum(
                movement.amount
                for movement in check.query(CashMovement).filter_by(shift_id=shift_id).all()
            )
            assert total == Decimal("110.00")
    finally:
        allow_writer_to_finish.set()
        with Session(owner_engine) as cleanup:
            cleanup.query(AuditLog).filter_by(tenant_id=tenant_id).delete()
            cleanup.query(IdempotencyKey).filter_by(tenant_id=tenant_id).delete()
            cleanup.query(CashMovement).filter_by(tenant_id=tenant_id).delete()
            cleanup.query(Shift).filter_by(tenant_id=tenant_id).delete()
            cleanup.query(User).filter_by(id=user_id).delete()
            cleanup.query(Tenant).filter_by(id=tenant_id).delete()
            cleanup.commit()


def test_close_waits_for_inflight_cash_sale_and_freezes_committed_total(
    owner_engine, monkeypatch
) -> None:
    context = _seed_concurrent_drawer(owner_engine)
    tenant_id = context["tenant_id"]
    shift_id = context["shift_id"]
    user_id = context["user_id"]
    product_id = context["product_id"]
    sale_holds_shift = Event()
    allow_sale_to_finish = Event()
    original_create_order = order_repo.create_order

    def pause_sale_while_holding_shift(*args, **kwargs):
        sale_holds_shift.set()
        assert allow_sale_to_finish.wait(timeout=5)
        return original_create_order(*args, **kwargs)

    monkeypatch.setattr(order_repo, "create_order", pause_sale_while_holding_shift)
    # Fiscal immutability is covered separately; keeping this test focused on
    # the drawer transaction also lets its committed rows be cleaned normally.
    monkeypatch.setattr(
        order_service.fiscal_repo,
        "capture_baseline_snapshot",
        lambda *_, **__: None,
    )

    def create_cash_sale(worker_db: Session) -> tuple[int, dict]:
        return order_service.create_order(
            worker_db,
            tenant_id=tenant_id,
            user_id=user_id,
            body=OrderCreate(
                items=[OrderItemCreate(product_id=product_id, quantity=1)],
                payments=[
                    PaymentCreate(
                        method="cash",
                        amount=Decimal("25.00"),
                        amount_tendered=Decimal("25.00"),
                    )
                ],
            ),
            idempotency_key=f"sale-{uuid4().hex}",
        )

    try:
        sale_status, sale, closed = _run_close_against_writer(
            owner_engine,
            monkeypatch,
            context=context,
            writer=create_cash_sale,
            writer_holds_shift=sale_holds_shift,
            allow_writer_to_finish=allow_sale_to_finish,
            operation="cash sale",
        )

        assert sale_status == 201
        assert closed["expected_cash_amount"] == "125.00"
        assert closed["variance_amount"] == "0.00"

        with Session(owner_engine) as check:
            persisted = check.get(Shift, shift_id)
            persisted_order = check.get(Order, UUID(sale["id"]))
            assert persisted is not None
            assert persisted.status == "closed"
            assert persisted.expected_cash_amount == Decimal("125.00")
            assert persisted_order is not None
            assert persisted_order.shift_id == shift_id
    finally:
        allow_sale_to_finish.set()
        _cleanup_concurrent_drawer(owner_engine, tenant_id=tenant_id, user_id=user_id)


def test_close_waits_for_inflight_cash_refund_and_freezes_committed_total(
    owner_engine, monkeypatch
) -> None:
    context = _seed_concurrent_drawer(owner_engine, existing_sale=True)
    tenant_id = context["tenant_id"]
    shift_id = context["shift_id"]
    user_id = context["user_id"]
    order_id = context["order_id"]
    order_item_id = context["order_item_id"]
    refund_holds_shift = Event()
    allow_refund_to_finish = Event()
    original_create_refund = order_repo.create_refund

    def pause_refund_while_holding_shift(*args, **kwargs):
        refund_holds_shift.set()
        assert allow_refund_to_finish.wait(timeout=5)
        return original_create_refund(*args, **kwargs)

    monkeypatch.setattr(order_repo, "create_refund", pause_refund_while_holding_shift)

    def create_cash_refund(worker_db: Session) -> tuple[int, dict]:
        return order_service.create_refund(
            worker_db,
            tenant_id=tenant_id,
            user_id=user_id,
            order_id=order_id,
            body=RefundCreate(
                items=[RefundItemCreate(order_item_id=order_item_id, quantity=1)],
                reason="customer_return",
                refund_payment_method="cash",
            ),
            idempotency_key=f"refund-{uuid4().hex}",
        )

    try:
        refund_status, _, closed = _run_close_against_writer(
            owner_engine,
            monkeypatch,
            context=context,
            writer=create_cash_refund,
            writer_holds_shift=refund_holds_shift,
            allow_writer_to_finish=allow_refund_to_finish,
            operation="cash refund",
        )

        assert refund_status == 201
        assert closed["expected_cash_amount"] == "125.00"
        assert closed["variance_amount"] == "0.00"

        with Session(owner_engine) as check:
            persisted = check.get(Shift, shift_id)
            payouts = (
                check.query(CashMovement)
                .filter_by(shift_id=shift_id, type="refund_payout")
                .all()
            )
            assert persisted is not None
            assert persisted.status == "closed"
            assert persisted.expected_cash_amount == Decimal("125.00")
            assert len(payouts) == 1
            assert payouts[0].amount == Decimal("25.00")
    finally:
        allow_refund_to_finish.set()
        _cleanup_concurrent_drawer(owner_engine, tenant_id=tenant_id, user_id=user_id)
