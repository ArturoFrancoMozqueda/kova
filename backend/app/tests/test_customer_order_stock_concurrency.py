from concurrent.futures import ThreadPoolExecutor
from threading import Event
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.customer_orders import service as customer_order_service
from app.customer_orders.schemas import CustomerOrderCheckout
from app.db import set_tenant_context
from app.inventory import service as inventory_service
from app.inventory.schemas import InventoryAdjustmentCreate


@pytest.fixture
def reserved_order(owner_engine):
    ids = {
        "tenant": uuid4(),
        "user": uuid4(),
        "product": uuid4(),
        "second_product": uuid4(),
        "order": uuid4(),
        "item": uuid4(),
        "reservation": uuid4(),
        "movement": uuid4(),
    }
    with owner_engine.begin() as conn:
        conn.execute(
            text("INSERT INTO tenants (id, name, slug) VALUES (:id, 'Race', :slug)"),
            {"id": ids["tenant"], "slug": f"stock-race-{ids['tenant']}"},
        )
        conn.execute(
            text(
                "INSERT INTO users (id, email, hashed_password, is_email_verified) "
                "VALUES (:id, :email, 'hash', true)"
            ),
            {"id": ids["user"], "email": f"stock-race-{ids['user']}@example.com"},
        )
        conn.execute(
            text(
                "INSERT INTO memberships (tenant_id, user_id, role) "
                "VALUES (:tenant_id, :user_id, 'owner')"
            ),
            {"tenant_id": ids["tenant"], "user_id": ids["user"]},
        )
        conn.execute(
            text(
                "INSERT INTO products "
                "(id, tenant_id, name, price_amount, track_inventory) "
                "VALUES (:id, :tenant_id, 'Reservado', 10.00, true), "
                "(:second_id, :tenant_id, 'Segundo', 20.00, true)"
            ),
            {
                "id": ids["product"],
                "second_id": ids["second_product"],
                "tenant_id": ids["tenant"],
            },
        )
        conn.execute(
            text(
                "INSERT INTO inventory_movements "
                "(id, tenant_id, product_id, movement_type, quantity_delta, "
                "created_by_user_id, created_at) "
                "VALUES (:id, :tenant_id, :product_id, 'adjustment', 1, :user_id, now())"
            ),
            {
                "id": ids["movement"],
                "tenant_id": ids["tenant"],
                "product_id": ids["product"],
                "user_id": ids["user"],
            },
        )
        conn.execute(
            text(
                "INSERT INTO customer_orders "
                "(id, tenant_id, folio, status, fulfillment_type, source_channel, "
                "subtotal_amount, total_amount, version, created_by_user_id, "
                "updated_by_user_id, confirmed_at, created_at, updated_at) "
                "VALUES (:id, :tenant_id, 'PED-RACE001', 'confirmed', 'pickup', "
                "'counter', 10.00, 10.00, 1, :user_id, :user_id, now(), now(), now())"
            ),
            {
                "id": ids["order"],
                "tenant_id": ids["tenant"],
                "user_id": ids["user"],
            },
        )
        conn.execute(
            text(
                "INSERT INTO customer_order_items "
                "(id, tenant_id, customer_order_id, product_id, product_name, quantity, "
                "unit_price_amount, line_total_amount) "
                "VALUES (:id, :tenant_id, :order_id, :product_id, 'Reservado', 1, 10.00, 10.00)"
            ),
            {
                "id": ids["item"],
                "tenant_id": ids["tenant"],
                "order_id": ids["order"],
                "product_id": ids["product"],
            },
        )
        conn.execute(
            text(
                "INSERT INTO inventory_reservations "
                "(id, tenant_id, customer_order_id, product_id, quantity, status, "
                "created_at, updated_at) "
                "VALUES (:id, :tenant_id, :order_id, :product_id, 1, 'active', now(), now())"
            ),
            {
                "id": ids["reservation"],
                "tenant_id": ids["tenant"],
                "order_id": ids["order"],
                "product_id": ids["product"],
            },
        )
    try:
        yield ids
    finally:
        with owner_engine.begin() as conn:
            conn.execute(text("SELECT set_config('app.allow_fiscal_history_delete', 'on', true)"))
            for table in (
                "order_item_tax_snapshots",
                "order_item_fiscal_snapshots",
                "order_fiscal_snapshots",
            ):
                conn.execute(
                    text(f"DELETE FROM {table} WHERE tenant_id = :tenant_id"),
                    {"tenant_id": ids["tenant"]},
                )
            for table in (
                "order_item_modifiers",
                "payments",
                "inventory_movements",
                "order_items",
                "orders",
                "inventory_reservations",
                "customer_order_item_modifiers",
                "customer_order_items",
                "customer_orders",
                "idempotency_keys",
                "audit_logs",
            ):
                conn.execute(
                    text(f"DELETE FROM {table} WHERE tenant_id = :tenant_id"),
                    {"tenant_id": ids["tenant"]},
                )
            conn.execute(
                text("DELETE FROM memberships WHERE tenant_id = :tenant_id"),
                {"tenant_id": ids["tenant"]},
            )
            conn.execute(
                text("DELETE FROM users WHERE id = :user_id"),
                {"user_id": ids["user"]},
            )
            conn.execute(
                text("DELETE FROM products WHERE tenant_id = :tenant_id"),
                {"tenant_id": ids["tenant"]},
            )
            conn.execute(
                text("DELETE FROM tenants WHERE id = :tenant_id"),
                {"tenant_id": ids["tenant"]},
            )


def test_product_locks_use_the_same_uuid_order_for_reversed_inputs(
    kova_app_engine, reserved_order: dict[str, UUID]
) -> None:
    first_input = {reserved_order["product"], reserved_order["second_product"]}
    second_input = {reserved_order["second_product"], reserved_order["product"]}

    observed_orders: list[list[UUID]] = []
    for product_ids in (first_input, second_input):
        with Session(kova_app_engine) as db:
            set_tenant_context(db, reserved_order["tenant"])
            products = customer_order_service._lock_products_for_update(
                db,
                tenant_id=reserved_order["tenant"],
                product_ids=product_ids,
            )
            observed_orders.append(list(products))
            db.rollback()

    expected = sorted(first_input, key=lambda value: value.int)
    assert observed_orders == [expected, expected]


def test_checkout_revalidates_reserved_stock_after_concurrent_adjustment(
    kova_app_engine,
    owner_engine,
    reserved_order: dict[str, UUID],
    monkeypatch,
) -> None:
    precheck_complete = Event()
    adjustment_complete = Event()
    original_stock_conflict = customer_order_service._stock_conflict

    def pause_after_precheck(db: Session, *, order) -> bool:
        result = original_stock_conflict(db, order=order)
        assert result is False
        precheck_complete.set()
        assert adjustment_complete.wait(timeout=10)
        return result

    monkeypatch.setattr(customer_order_service, "_stock_conflict", pause_after_precheck)

    def checkout() -> HTTPException | None:
        with Session(kova_app_engine) as db:
            set_tenant_context(db, reserved_order["tenant"])
            try:
                customer_order_service.checkout_customer_order(
                    db,
                    tenant_id=reserved_order["tenant"],
                    user_id=reserved_order["user"],
                    order_id=reserved_order["order"],
                    body=CustomerOrderCheckout.model_validate(
                        {
                            "version": 1,
                            "payments": [{"method": "bank_transfer", "amount": "10.00"}],
                        }
                    ),
                    idempotency_key=f"checkout-{uuid4()}",
                )
            except HTTPException as exc:
                db.rollback()
                return exc
        return None

    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(checkout)
        assert precheck_complete.wait(timeout=10)
        try:
            with Session(kova_app_engine) as db:
                set_tenant_context(db, reserved_order["tenant"])
                status, response = inventory_service.adjust_stock(
                    db,
                    tenant_id=reserved_order["tenant"],
                    user_id=reserved_order["user"],
                    product_id=reserved_order["product"],
                    body=InventoryAdjustmentCreate(
                        quantity_delta=-1,
                        reason="Merma concurrente",
                        reason_code="merma",
                    ),
                    idempotency_key=f"adjust-{uuid4()}",
                )
                assert status == 201
                assert response["stock_on_hand"] == 0
        finally:
            adjustment_complete.set()
        error = future.result(timeout=15)

    assert error is not None
    assert error.status_code == 422
    assert error.detail["code"] == "OUT_OF_STOCK"
    with owner_engine.connect() as conn:
        sale_order_id = conn.scalar(
            text("SELECT sale_order_id FROM customer_orders WHERE id = :order_id"),
            {"order_id": reserved_order["order"]},
        )
        sale_count = conn.scalar(
            text("SELECT count(*) FROM orders WHERE tenant_id = :tenant_id"),
            {"tenant_id": reserved_order["tenant"]},
        )
        payment_count = conn.scalar(
            text("SELECT count(*) FROM payments WHERE tenant_id = :tenant_id"),
            {"tenant_id": reserved_order["tenant"]},
        )
        stock = conn.scalar(
            text(
                "SELECT coalesce(sum(quantity_delta), 0) FROM inventory_movements "
                "WHERE tenant_id = :tenant_id AND product_id = :product_id"
            ),
            {
                "tenant_id": reserved_order["tenant"],
                "product_id": reserved_order["product"],
            },
        )
    assert sale_order_id is None
    assert sale_count == 0
    assert payment_count == 0
    assert stock == 0
