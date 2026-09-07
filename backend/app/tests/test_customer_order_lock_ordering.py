from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from decimal import Decimal
from threading import Event
from time import monotonic
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy import event, text
from sqlalchemy.orm import Session

from app.audit.models import AuditLog
from app.auth.models import User
from app.catalog.models import Product
from app.customer_orders import service
from app.customer_orders.models import CustomerOrder, CustomerOrderItem, InventoryReservation
from app.customer_orders.schemas import VersionedAction
from app.idempotency.models import IdempotencyKey
from app.orders.models import InventoryMovement
from app.tenants.models import Tenant


def _inverse_set_iteration_product_ids() -> tuple[UUID, UUID]:
    """Choose unique UUIDs whose unsorted set order follows insertion order.

    This makes the behavioral regression deterministic: if the production
    helper stops sorting UUIDs, carts A/B and B/A acquire their first product
    locks in opposite order and PostgreSQL detects the resulting deadlock.
    """
    prefix = uuid4().int & ~0xFFFF
    candidates = [UUID(int=prefix + offset) for offset in range(1, 257)]
    for index, first in enumerate(candidates):
        for second in candidates[index + 1 :]:
            if list(set({first: 1, second: 1})) == [first, second] and list(
                set({second: 1, first: 1})
            ) == [second, first]:
                return first, second
    raise AssertionError("could not construct inverse product set iteration")


def _seed_inverse_orders(owner_engine) -> dict:
    tenant_id = uuid4()
    user_id = uuid4()
    first_order_id = uuid4()
    second_order_id = uuid4()
    product_a_id, product_b_id = _inverse_set_iteration_product_ids()
    item_prefix = uuid4().int & ~0xFFFF
    now = datetime.now(UTC)

    with Session(owner_engine) as seed:
        seed.add(Tenant(id=tenant_id, name="Inverse lock orders", slug=f"locks-{uuid4().hex}"))
        seed.flush()
        seed.add(
            User(
                id=user_id,
                email=f"inverse-locks-{uuid4().hex}@example.com",
                hashed_password="test-only",
                is_email_verified=True,
                is_active=True,
                created_at=now,
                updated_at=now,
            )
        )
        seed.add_all(
            [
                Product(
                    id=product_id,
                    tenant_id=tenant_id,
                    name=name,
                    price_amount=Decimal("10.00"),
                    track_inventory=True,
                    is_active=True,
                )
                for product_id, name in (
                    (product_a_id, "Product A"),
                    (product_b_id, "Product B"),
                )
            ]
        )
        seed.flush()
        seed.add_all(
            [
                InventoryMovement(
                    tenant_id=tenant_id,
                    product_id=product_id,
                    movement_type="adjustment",
                    quantity_delta=1,
                    stock_on_hand_after=1,
                    reason="Concurrency seed",
                    created_by_user_id=user_id,
                )
                for product_id in (product_a_id, product_b_id)
            ]
        )
        seed.add_all(
            [
                CustomerOrder(
                    id=order_id,
                    tenant_id=tenant_id,
                    folio=folio,
                    status="new",
                    fulfillment_type="pickup",
                    source_channel="counter",
                    subtotal_amount=Decimal("20.00"),
                    total_amount=Decimal("20.00"),
                    version=1,
                    created_by_user_id=user_id,
                    updated_by_user_id=user_id,
                )
                for order_id, folio in (
                    (first_order_id, "PED-LOCK-A"),
                    (second_order_id, "PED-LOCK-B"),
                )
            ]
        )
        seed.flush()
        seed.add_all(
            [
                CustomerOrderItem(
                    id=UUID(int=item_prefix + offset),
                    tenant_id=tenant_id,
                    customer_order_id=order_id,
                    product_id=product_id,
                    product_name=product_name,
                    quantity=1,
                    unit_price_amount=Decimal("10.00"),
                    line_total_amount=Decimal("10.00"),
                )
                for offset, order_id, product_id, product_name in (
                    (1, first_order_id, product_a_id, "Product A"),
                    (2, first_order_id, product_b_id, "Product B"),
                    (3, second_order_id, product_b_id, "Product B"),
                    (4, second_order_id, product_a_id, "Product A"),
                )
            ]
        )
        seed.commit()

    return {
        "tenant_id": tenant_id,
        "user_id": user_id,
        "first_order_id": first_order_id,
        "second_order_id": second_order_id,
        "product_a_id": product_a_id,
        "product_b_id": product_b_id,
    }


def _cleanup(owner_engine, *, context: dict) -> None:
    tenant_id = context["tenant_id"]
    with Session(owner_engine) as cleanup:
        cleanup.query(InventoryReservation).filter_by(tenant_id=tenant_id).delete()
        cleanup.query(CustomerOrderItem).filter_by(tenant_id=tenant_id).delete()
        cleanup.query(CustomerOrder).filter_by(tenant_id=tenant_id).delete()
        cleanup.query(AuditLog).filter_by(tenant_id=tenant_id).delete()
        cleanup.query(IdempotencyKey).filter_by(tenant_id=tenant_id).delete()
        cleanup.query(InventoryMovement).filter_by(tenant_id=tenant_id).delete()
        cleanup.query(Product).filter_by(tenant_id=tenant_id).delete()
        cleanup.query(User).filter_by(id=context["user_id"]).delete()
        cleanup.query(Tenant).filter_by(id=tenant_id).delete()
        cleanup.commit()


def test_inverse_product_orders_confirm_without_deadlock_and_preserve_stock_conflict(
    owner_engine,
) -> None:
    context = _seed_inverse_orders(owner_engine)
    first_product_locked = Event()
    allow_first_to_continue = Event()
    second_first_lock_attempted = Event()
    second_first_product_locked = Event()
    connection_ids: dict[str, int] = {}
    lock_attempts = {"first": 0, "second": 0}

    def is_product_lock(statement: str) -> bool:
        normalized = " ".join(statement.lower().split())
        return "from products" in normalized and "for update" in normalized

    def before_cursor_execute(
        connection, cursor, statement, parameters, execution_context, executemany
    ):
        label = connection.info.get("customer_order_lock_worker")
        if label and is_product_lock(statement):
            lock_attempts[label] += 1
            if label == "second" and lock_attempts[label] == 1:
                second_first_lock_attempted.set()

    def after_cursor_execute(
        connection, cursor, statement, parameters, execution_context, executemany
    ):
        label = connection.info.get("customer_order_lock_worker")
        if label == "first" and lock_attempts[label] == 1 and is_product_lock(statement):
            first_product_locked.set()
            assert allow_first_to_continue.wait(timeout=5)
        if label == "second" and lock_attempts[label] == 1 and is_product_lock(statement):
            second_first_product_locked.set()

    def confirm(label: str, order_id: UUID) -> tuple[int, int, dict]:
        with Session(owner_engine) as worker_db:
            connection = worker_db.connection()
            connection_info = connection.info
            connection_info["customer_order_lock_worker"] = label
            connection_id = worker_db.execute(text("SELECT pg_backend_pid()")).scalar_one()
            connection_ids[label] = connection_id
            worker_db.execute(text("SET LOCAL lock_timeout = '4s'"))
            try:
                status, body = service.confirm_customer_order(
                    worker_db,
                    tenant_id=context["tenant_id"],
                    user_id=context["user_id"],
                    order_id=order_id,
                    body=VersionedAction(version=1),
                    idempotency_key=f"confirm-{label}-{uuid4().hex}",
                )
                return connection_id, status, body
            except HTTPException as exc:
                worker_db.rollback()
                return connection_id, exc.status_code, exc.detail
            finally:
                connection_info.pop("customer_order_lock_worker", None)

    def second_acquired_before_waiting_on_first() -> bool:
        deadline = monotonic() + 3
        while monotonic() < deadline:
            if second_first_product_locked.is_set():
                return True
            with owner_engine.connect() as probe:
                wait_event_type = probe.execute(
                    text("SELECT wait_event_type FROM pg_stat_activity WHERE pid = :pid"),
                    {"pid": connection_ids["second"]},
                ).scalar_one()
            if second_first_product_locked.is_set():
                return True
            if wait_event_type == "Lock":
                return False
            second_first_product_locked.wait(timeout=0.01)
        raise AssertionError("second worker neither acquired nor waited for its first lock")

    event.listen(owner_engine, "before_cursor_execute", before_cursor_execute)
    event.listen(owner_engine, "after_cursor_execute", after_cursor_execute)
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            first_future = pool.submit(confirm, "first", context["first_order_id"])
            assert first_product_locked.wait(timeout=5)
            second_future = pool.submit(confirm, "second", context["second_order_id"])
            assert second_first_lock_attempted.wait(timeout=5)
            second_acquired_before_release = second_acquired_before_waiting_on_first()
            allow_first_to_continue.set()
            first_result = first_future.result(timeout=8)
            second_result = second_future.result(timeout=8)

        assert second_acquired_before_release is False
        assert first_result[0] != second_result[0]
        assert first_result[1] == 200
        assert first_result[2]["id"] == str(context["first_order_id"])
        assert second_result[1] == 422
        assert second_result[2]["code"] == "OUT_OF_STOCK"
        assert lock_attempts == {"first": 2, "second": 2}

        with Session(owner_engine) as check:
            first_order = check.get(CustomerOrder, context["first_order_id"])
            second_order = check.get(CustomerOrder, context["second_order_id"])
            reservations = (
                check.query(InventoryReservation)
                .filter_by(tenant_id=context["tenant_id"], status="active")
                .all()
            )
            stock = {
                product_id: sum(
                    movement.quantity_delta
                    for movement in check.query(InventoryMovement)
                    .filter_by(tenant_id=context["tenant_id"], product_id=product_id)
                    .all()
                )
                for product_id in (context["product_a_id"], context["product_b_id"])
            }
            assert first_order is not None
            assert first_order.status == "confirmed"
            assert first_order.version == 2
            assert second_order is not None
            assert second_order.status == "new"
            assert second_order.version == 1
            assert stock == {
                context["product_a_id"]: 1,
                context["product_b_id"]: 1,
            }
            assert {
                (row.customer_order_id, row.product_id, row.quantity) for row in reservations
            } == {
                (context["first_order_id"], context["product_a_id"], 1),
                (context["first_order_id"], context["product_b_id"], 1),
            }
            assert (
                check.query(AuditLog)
                .filter_by(tenant_id=context["tenant_id"], action="customer_orders.confirm")
                .count()
                == 1
            )
    finally:
        allow_first_to_continue.set()
        event.remove(owner_engine, "after_cursor_execute", after_cursor_execute)
        event.remove(owner_engine, "before_cursor_execute", before_cursor_execute)
        _cleanup(owner_engine, context=context)
